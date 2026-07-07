/* ═══════════════════════════════════════════════════════════════════
   CORE/DB.JS — Connessione Supabase condivisa (Cablotec Gestionale)

   Unico punto che crea e cura il client Supabase per TUTTI i frontend
   (index/kiosk, mobile, prelievo). Contiene:
     - config (URL + anon key)
     - creazione client con lock no-op (cura del bug freeze-tab di gotrue-js)
     - ricreaConnessione(): ricrea il client da zero preservando la sessione
     - eseguiConRetry(): scritture con timeout + retry su connessione fresca
     - assicuraSessioneValida(): refresh preventivo del token

   Script CLASSICO (niente ES module): va caricato PRIMA dello script
   della pagina, che poi usa direttamente le globali qui definite.

   Uso tipico nella pagina:
     <script src="core/db.js?v=..."></script>
     <script>
       creaClientSupabase('sb-cablotec-mobile');   // storage key della app
       onRiconnessione(() => { ...riavvia realtime della pagina... });
       ...
       const { data, error } = await eseguiConRetry(
         () => sb.from('sessioni').insert(riga), { label: 'timbro' });
     </script>
   ═══════════════════════════════════════════════════════════════════ */

// ─── Config backend (unica copia per tutto il gestionale) ───
const SUPABASE_URL      = "https://cuiakdyatsuhioyubpne.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1aWFrZHlhdHN1aGlveXVicG5lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NjQ0NDYsImV4cCI6MjA5MzA0MDQ0Nn0.kaC1n1ABHxxcUAOIcxQlUxQva25KBKWOTJbPSo9C-l8";

// Account tecnico condiviso (kiosk / app di reparto)
const APP_EMAIL    = 'kiosk@cablotec.local';
const APP_PASSWORD = 'kiosk-cablotec-2026';

// ─── Client globale ───
// Le pagine usano direttamente `sb`. Viene (ri)assegnato qui dentro.
let sb = null;

// Storage key della pagina corrente (impostata da creaClientSupabase).
let _sbStorageKey = 'sb-cablotec-auth';

// Lock no-op: il bug di supabase-js v2 nasce dal lock interno per il refresh
// del token che, dopo un freeze della tab, non viene mai rilasciato.
// Disattivandolo, eventuali refresh concorrenti sono comunque innocui
// (il refresh token è valido finché non viene consumato).
const SB_NOOP_LOCK = (_name, _acquireTimeout, fn) => fn();

// Esegue una promise di sb.auth.* con un timeout duro.
// Se scade, rifiuta con Error('auth timeout') invece di restare appesa.
function conTimeoutAuth(promise, ms = 5000) {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, rej) => setTimeout(() => rej(new Error('auth timeout')), ms))
  ]);
}

// ─── Creazione client ───
// storageKey: chiave localStorage dedicata alla app (così app diverse sullo
// stesso dispositivo non si calpestano la sessione a vicenda).
function creaClientSupabase(storageKey) {
  if (storageKey) _sbStorageKey = storageKey;
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: _sbStorageKey,
      lock: SB_NOOP_LOCK,
    },
  });
  return sb;
}

// ─── Hook di riconnessione ───
// La pagina registra qui cosa va riavviato dopo una ricreazione del client
// (tipicamente le sottoscrizioni realtime). Più hook ammessi.
const _hookRiconnessione = [];
function onRiconnessione(fn) { if (typeof fn === 'function') _hookRiconnessione.push(fn); }

// ─── PEZZO A: ricrea il client Supabase da zero ───
// Conserva la sessione di login (token) e la reinstalla nel nuovo client.
let _ricreazioneInCorso = null; // promise condivisa per evitare ricreazioni doppie

async function ricreaConnessione() {
  if (_ricreazioneInCorso) return _ricreazioneInCorso;

  _ricreazioneInCorso = (async () => {
    try {
      // 1. Recupera la sessione corrente dal client vecchio (prima che muoia).
      //    Timeout duro: se il client vecchio è già bloccato, NON aspettare per sempre.
      let sessioneSalvata = null;
      try {
        const { data } = await conTimeoutAuth(sb.auth.getSession(), 3000);
        sessioneSalvata = data?.session || null;
      } catch (e) { /* il client vecchio è già morto o appeso: pazienza */ }

      // Fallback: recupera la sessione dal localStorage (persistSession la salva lì).
      if (!sessioneSalvata) {
        try {
          const raw = localStorage.getItem(_sbStorageKey);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.access_token && parsed?.refresh_token) {
              sessioneSalvata = parsed;
            } else if (parsed?.currentSession?.access_token) {
              sessioneSalvata = parsed.currentSession;
            }
          }
        } catch (e) {}
      }

      // 2. Chiudi il realtime del client vecchio (niente connessioni zombie).
      try { await sb.removeAllChannels(); } catch (e) {}

      // 2b. Ferma i timer di auto-refresh interni del client vecchio
      //     (evita il warning "Multiple GoTrueClient instances detected").
      try {
        if (typeof sb?.auth?.stopAutoRefresh === 'function') {
          await sb.auth.stopAutoRefresh();
        }
      } catch (e) {}
      sb = null;

      // 3. Crea un client NUOVO con lock no-op (cura del bug).
      creaClientSupabase();

      // 4. Reinstalla la sessione di login sul nuovo client (con timeout).
      if (sessioneSalvata) {
        try {
          await conTimeoutAuth(sb.auth.setSession({
            access_token: sessioneSalvata.access_token,
            refresh_token: sessioneSalvata.refresh_token,
          }), 5000);
        } catch (e) {
          console.warn('[recovery] impossibile ripristinare sessione:', e?.message || e);
        }
      }

      // 5. Avvisa la pagina: riavvii ciò che le serve (realtime ecc.).
      for (const fn of _hookRiconnessione) {
        try { fn(); } catch (e) {}
      }

      console.log('[recovery] connessione ricreata');
    } finally {
      _ricreazioneInCorso = null;
    }
  })();

  return _ricreazioneInCorso;
}

// ─── PEZZO B: esegue un'operazione con timeout + retry automatico ───
// fn: funzione che RITORNA la promise/query (es. () => sb.from(...).insert(...)).
//     Deve essere una funzione, non la query già avviata: al retry va rifatta.
// Ritorna { data, error }. error._timeout=true se ha fallito anche dopo il retry.
async function eseguiConRetry(fn, opts) {
  const TIMEOUT = (opts && opts.timeout) || 10000;
  const etichetta = (opts && opts.label) || 'operazione';

  function conTimeout(promise) {
    return new Promise((resolve) => {
      let fatto = false;
      const t = setTimeout(() => {
        if (!fatto) { fatto = true; resolve({ __timeout: true }); }
      }, TIMEOUT);
      Promise.resolve(promise).then(
        (res) => { if (!fatto) { fatto = true; clearTimeout(t); resolve(res); } },
        (err) => { if (!fatto) { fatto = true; clearTimeout(t); resolve({ error: { message: err?.message || String(err) } }); } }
      );
    });
  }

  // Tentativo 1
  let res = await conTimeout(fn());
  if (!res || !res.__timeout) return res;

  // Timeout → la connessione è probabilmente morta. Ricreala e riprova.
  console.warn('[recovery] timeout su', etichetta, '— ricreo la connessione e riprovo');
  await ricreaConnessione();

  // Tentativo 2 (sulla connessione fresca)
  res = await conTimeout(fn());
  if (!res || !res.__timeout) return res;

  return { data: null, error: {
    message: 'Connessione non disponibile. Controlla la rete e riprova.',
    _timeout: true,
  }};
}

// ─── Caricamento COMPLETO oltre il tetto di 1000 righe ───
// PostgREST restituisce max 1000 righe per richiesta: una select su una
// tabella cresciuta oltre PERDE SILENZIOSAMENTE le righe più vecchie.
// Questa helper pagina finché le pagine arrivano piene.
// costruisciQuery: funzione che RITORNA la query base (from/select/order/filtri),
// rifatta a ogni pagina. Ritorna { data, error } come una query normale.
async function fetchTutte(costruisciQuery) {
  const PAGINA = 1000;
  const out = [];
  for (let da = 0; ; da += PAGINA) {
    const { data, error } = await costruisciQuery().range(da, da + PAGINA - 1);
    if (error) return { data: null, error };
    out.push(...(data || []));
    if (!data || data.length < PAGINA) break;
  }
  return { data: out, error: null };
}

// ─── Refresh preventivo: rinnova la sessione se scade entro 5 minuti ───
async function assicuraSessioneValida() {
  try {
    const { data } = await conTimeoutAuth(sb.auth.getSession(), 4000);
    const sess = data?.session;
    if (!sess) return;
    const expiresAt = (sess.expires_at || 0) * 1000;
    if (Date.now() > expiresAt - 5 * 60 * 1000) {
      await conTimeoutAuth(sb.auth.refreshSession(), 6000);
    }
  } catch (e) {
    console.warn('[sessione] refresh preventivo fallito:', e?.message || e);
    // Client probabilmente "morto": ricreazione preventiva così le
    // scritture successive non restano appese.
    if (e?.message === 'auth timeout') {
      ricreaConnessione().catch(() => {});
    }
  }
}
