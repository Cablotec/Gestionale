-- ═══════════════════════════════════════════════════════════════════
-- ACCESSO PER CLAUDE, PARTE 2: CORREGGERE DATI ESISTENTI
--
-- Complemento di `accesso-claude.sql` (che dà solo: aggiungi colonna,
-- crea indice, scrivi su attivita_extra). Qui si aggiunge la possibilità
-- di CORREGGERE righe che esistono già in `operazioni` e `aziende`.
--
-- Perché serve: le correzioni in blocco — allineare 190 posizioni,
-- rinominare 6 clienti, rimettere 54 scadenze — oggi passano tutte da SQL
-- che tu incolli nel pannello. L'account tecnico non può farle: l'RLS
-- sulle commesse vuole ruolo admin e rifiuta IN SILENZIO (HTTP 200, zero
-- righe toccate — non un errore, proprio niente).
--
-- Stessa filosofia del primo file: il permesso sta sull'OPERAZIONE, non
-- sul ruolo. NON si promuove claude ad admin (resta `user` in `profili`).
--
-- ═══ COSA APRE ═══
--   UPDATE su public.operazioni   — correggere commesse che ci sono già
--   UPDATE su public.aziende      — correggere anagrafiche che ci sono già
--
-- ═══ COSA RESTA FUORI, DI PROPOSITO ═══
--   INSERT  — non posso creare righe: le commesse nuove nascono dall'app,
--             dove c'è un'anteprima e una persona che conferma
--   DELETE  — è l'operazione da cui non si torna indietro, e resta tua.
--             Il 25 ago i 51 doppioni li hai cancellati tu dopo aver
--             visto i numeri: quel passaggio è il valore, non l'attrito.
--   Tutto il resto delle tabelle (timbri, fasi, addetti, spedizioni…)
--
-- ⚠ CONSEGUENZA ACCETTATA: con l'UPDATE su `operazioni` posso toccare
-- QUALSIASI colonna, `stato` compreso — quindi in teoria riaprire una
-- commessa spedita. Postgres non sa limitare una policy a certe colonne.
-- Resta valida la regola di sempre: prima di qualunque scrittura in
-- blocco dichiaro quante righe tocca, salvo le righe su file e aspetto
-- il tuo ok.
--
-- Rieseguibile: le policy si cancellano e si ricreano.
-- ═══════════════════════════════════════════════════════════════════

-- ── operazioni: correggere sì, creare e cancellare no ──────────────────
drop policy if exists operazioni_claude_update on public.operazioni;
create policy operazioni_claude_update on public.operazioni
  for update to authenticated
  using      (coalesce(auth.jwt() ->> 'email', '') = 'claude@cablotec.local')
  with check (coalesce(auth.jwt() ->> 'email', '') = 'claude@cablotec.local');

-- ── aziende: idem ──────────────────────────────────────────────────────
drop policy if exists aziende_claude_update on public.aziende;
create policy aziende_claude_update on public.aziende
  for update to authenticated
  using      (coalesce(auth.jwt() ->> 'email', '') = 'claude@cablotec.local')
  with check (coalesce(auth.jwt() ->> 'email', '') = 'claude@cablotec.local');

-- ── VERIFICA ───────────────────────────────────────────────────────────
-- Devono comparire due righe, entrambe con cmd = UPDATE.
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and policyname in ('operazioni_claude_update', 'aziende_claude_update')
order by tablename;

-- Le policy sono PERMISSIVE: si aggiungono a quelle che ci sono già e non
-- tolgono niente a nessuno. Per chiudere di nuovo il rubinetto basta:
--   drop policy operazioni_claude_update on public.operazioni;
--   drop policy aziende_claude_update    on public.aziende;
