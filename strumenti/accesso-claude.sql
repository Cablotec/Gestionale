-- ═══════════════════════════════════════════════════════════════════
-- ACCESSO PER CLAUDE — scrittura sì, DROP impossibile
--
-- Perché così e non con un utente Postgres: aggiungere una colonna richiede
-- di essere PROPRIETARIO della tabella, e il proprietario può anche fare
-- DROP. "ADD COLUMN sì, DROP no" come ruolo Postgres non esiste.
-- Qui il permesso non è sul ruolo ma sulle OPERAZIONI: esistono due funzioni
-- che sanno fare solo due cose additive. Il DROP non è vietato, è assente —
-- non c'è nessuna funzione che lo faccia. Se un domani servirà, la scrivi tu.
--
-- PRIMA di eseguire: crea l'utente dalla dashboard Supabase
--   Authentication → Users → Add user
--   email:    ai@cablotec.local
--   password: scegline una e mettila in un file LOCALE, fuori dal repo
--             (il repo è pubblico). Non serve che me la scriva in chat:
--             dimmi solo dove l'hai messa.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Aggiungere una colonna ──────────────────────────────────────────
create or replace function public.mig_aggiungi_colonna(
  p_tabella text, p_colonna text, p_tipo text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tipi text[] := array['text','boolean','integer','bigint','numeric',
                         'date','timestamptz','uuid','jsonb'];
begin
  -- Chi può: solo l'utente dedicato. La chiave anon è pubblica (il repo lo è),
  -- quindi il controllo sta QUI dentro e non sul grant.
  if lower(coalesce(auth.jwt() ->> 'email', '')) <> 'ai@cablotec.local' then
    raise exception 'non autorizzato';
  end if;
  -- Nomi: solo identificatori semplici. Niente virgolette, niente spazi,
  -- niente da cui si possa uscire.
  if p_tabella !~ '^[a-z_][a-z0-9_]*$' or p_colonna !~ '^[a-z_][a-z0-9_]*$' then
    raise exception 'nome non valido';
  end if;
  -- Il tipo non è un identificatore e va messo nel testo: per questo è una
  -- lista chiusa, non qualcosa che arriva da fuori.
  if not (p_tipo = any(v_tipi)) then
    raise exception 'tipo non ammesso: %', p_tipo;
  end if;
  if not exists (select 1 from information_schema.tables
                 where table_schema = 'public' and table_name = p_tabella) then
    raise exception 'tabella inesistente: %', p_tabella;
  end if;
  -- Idempotente: rilanciarla non è un errore.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = p_tabella
               and column_name = p_colonna) then
    return 'la colonna ' || p_tabella || '.' || p_colonna || ' esiste già';
  end if;
  execute format('alter table public.%I add column %I %s', p_tabella, p_colonna, p_tipo);
  return 'aggiunta ' || p_tabella || '.' || p_colonna || ' ' || p_tipo;
end $$;

-- ── 2. Creare un indice ────────────────────────────────────────────────
create or replace function public.mig_crea_indice(
  p_tabella text, p_colonna text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nome text;
begin
  if lower(coalesce(auth.jwt() ->> 'email', '')) <> 'ai@cablotec.local' then
    raise exception 'non autorizzato';
  end if;
  if p_tabella !~ '^[a-z_][a-z0-9_]*$' or p_colonna !~ '^[a-z_][a-z0-9_]*$' then
    raise exception 'nome non valido';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = p_tabella
                   and column_name = p_colonna) then
    raise exception 'colonna inesistente: %.%', p_tabella, p_colonna;
  end if;
  v_nome := 'idx_' || p_tabella || '_' || p_colonna;
  execute format('create index if not exists %I on public.%I (%I)',
                 v_nome, p_tabella, p_colonna);
  return 'indice ' || v_nome;
end $$;

-- Le funzioni girano come il proprietario: il grant deve essere stretto.
revoke all on function public.mig_aggiungi_colonna(text, text, text) from public;
revoke all on function public.mig_crea_indice(text, text) from public;
grant execute on function public.mig_aggiungi_colonna(text, text, text) to authenticated;
grant execute on function public.mig_crea_indice(text, text) to authenticated;

-- ── 3. Scrittura sull'anagrafica delle attività ────────────────────────
-- Oggi l'account kiosk è bloccato in scrittura qui (giustamente): serviva a
-- te dal pannello per ogni riga. Questa policy apre la scrittura al SOLO
-- utente dedicato, in aggiunta alle regole esistenti (che restano com'erano).
-- ⚠ Il drop davanti serve a poterlo RIESEGUIRE: senza, la seconda volta
-- Postgres si ferma con "policy already exists" e il resto del file non
-- viene applicato. Rieseguirlo e successo davvero, il 4 set, quando
-- l account tecnico ha cambiato nome.
drop policy if exists attivita_extra_claude on public.attivita_extra;
create policy attivita_extra_claude on public.attivita_extra
  for all to authenticated
  using      (lower(coalesce(auth.jwt() ->> 'email', '')) = 'ai@cablotec.local')
  with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'ai@cablotec.local');

-- PARTE 2: `accesso-claude-scritture.sql` aggiunge l UPDATE su operazioni
-- e aziende (correggere righe esistenti). INSERT e DELETE restano fuori
-- anche la.
--
-- ═══ COSA RESTA FUORI, DI PROPOSITO ═══
--  · DROP di tabelle o colonne          · TRUNCATE
--  · CREATE TABLE                       · modifiche a RLS e permessi
-- Sono le operazioni da cui non si torna indietro o che cambiano chi può
-- fare cosa: restano tue. Le tabelle nuove sono poche volte l'anno ed è il
-- momento in cui un secondo paio d'occhi serve di più.
