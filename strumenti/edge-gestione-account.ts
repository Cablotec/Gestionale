// ═══════════════════════════════════════════════════════════
// EDGE FUNCTION: gestione-account
// Crea account utente e resetta password — SOLO per il super admin
// (18 nov 2026, Nico: "utenti solo io")
//
// COPIA DI RIFERIMENTO: la funzione vera vive su Supabase (Edge Functions →
// gestione-account) e si aggiorna da li' (incolla + Deploy). Deployata da Nico
// il 18 nov 2026, verificata (reset password dal super admin funziona).
// Nessuna chiave qui dentro: le legge dalle variabili d'ambiente di Supabase.
// ═══════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  // Preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── 1. Variabili d'ambiente (iniettate da Supabase) ──
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

    // ── 2. Verifica che il chiamante sia autenticato ──
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Non autenticato' }, 401);
    }

    // Client "utente" per leggere chi sta chiamando
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: 'Sessione non valida' }, 401);
    }
    const callerId = userData.user.id;

    // ── 3. Verifica che il chiamante sia il SUPER ADMIN ──
    // Client "admin" con service key per le operazioni privilegiate.
    // Account e password li gestisce solo il super admin: un admin
    // normale viene rifiutato anche chiamando la funzione a mano.
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: prof, error: profErr } = await adminClient
      .from('profili')
      .select('ruolo, super_admin')
      .eq('id', callerId)
      .maybeSingle();
    if (profErr || !prof || prof.ruolo !== 'admin' || prof.super_admin !== true) {
      return json({ error: 'Operazione riservata al super admin' }, 403);
    }

    // ── 4. Leggi la richiesta ──
    const body = await req.json();
    const azione = body.azione; // 'crea' | 'reset_password'

    // ── AZIONE: crea nuovo account ──
    if (azione === 'crea') {
      const { email, password, nome } = body;
      if (!email || !password) {
        return json({ error: 'Email e password obbligatorie' }, 400);
      }
      if (password.length < 6) {
        return json({ error: 'La password deve avere almeno 6 caratteri' }, 400);
      }
      const { data, error } = await adminClient.auth.admin.createUser({
        email: email,
        password: password,
        email_confirm: true, // niente verifica email (email aziendali fittizie)
        user_metadata: { nome: nome || '' },
      });
      if (error) {
        return json({ error: error.message }, 400);
      }
      return json({ ok: true, user: { id: data.user.id, email: data.user.email } });
    }

    // ── AZIONE: reset password ──
    if (azione === 'reset_password') {
      const { user_id, password } = body;
      if (!user_id || !password) {
        return json({ error: 'user_id e password obbligatori' }, 400);
      }
      if (password.length < 6) {
        return json({ error: 'La password deve avere almeno 6 caratteri' }, 400);
      }
      const { data, error } = await adminClient.auth.admin.updateUserById(
        user_id,
        { password: password }
      );
      if (error) {
        return json({ error: error.message }, 400);
      }
      return json({ ok: true, user: { id: data.user.id, email: data.user.email } });
    }

    return json({ error: 'Azione non riconosciuta' }, 400);

  } catch (e) {
    return json({ error: 'Errore interno: ' + (e?.message || String(e)) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
