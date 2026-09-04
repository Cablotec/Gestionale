-- ═══════════════════════════════════════════════════════════════════
-- ACCESSO PER CLAUDE, PARTE 3: CORREGGERE I PRODOTTI
--
-- Complemento di `accesso-claude-scritture.sql` (che apre l'UPDATE su
-- `operazioni` e `aziende`). Qui si aggiunge `articoli`.
--
-- Perché serve: il travaso delle distinte dentro i prodotti
-- (`materializza-distinte.js`, 155 update) e ogni correzione in blocco
-- successiva. Oggi l'RLS rifiuta IN SILENZIO — HTTP 200, zero righe
-- toccate, non un errore: proprio niente. Lo strumento se ne accorge solo
-- perché chiede `Prefer: return=representation` e conta le righe tornate.
--
-- ⚠⚠ PERCHÉ NON BASTA ESEGUIRE QUESTO FILE. Gli strumenti in `strumenti/`
-- entrano con l'account tecnico scritto in `core/db.js`, che è
-- `kiosk@cablotec.local`: lo stesso di tutte le postazioni di reparto,
-- di `mobile.html` e di `prelievo.html`. Aprire `articoli` a QUELLO
-- vorrebbe dire dare a ogni kiosk il permesso di riscrivere le distinte
-- dei prodotti. Non si fa.
-- Quindi questa policy è legata a `ai@cablotec.local`, e perché
-- serva a qualcosa quell'utente deve (1) esistere e (2) avere una
-- password in un file locale fuori dal repo — `PW.txt` oggi contiene il
-- kiosk, non lui.
--
-- ═══ COSA APRE ═══
--   UPDATE su public.articoli — correggere prodotti che ci sono già
--
-- ═══ COSA RESTA FUORI, DI PROPOSITO ═══
--   INSERT — i prodotti nuovi nascono dall'app o dall'import, dove c'è
--            un'anteprima e una persona che conferma
--   DELETE — è l'operazione da cui non si torna indietro, e resta tua
--
-- ⚠ CONSEGUENZA ACCETTATA: con l'UPDATE posso toccare QUALSIASI colonna
-- di `articoli`, `fasi` e `minuti_unitari` compresi. Postgres non sa
-- limitare una policy a certe colonne. Resta la regola di sempre: prima
-- di ogni scrittura in blocco dichiaro quante righe tocca, salvo il
-- contenuto su file e aspetto il tuo ok.
--
-- Rieseguibile: la policy si cancella e si ricrea.
-- ═══════════════════════════════════════════════════════════════════

drop policy if exists articoli_claude_update on public.articoli;
create policy articoli_claude_update on public.articoli
  for update to authenticated
  using      (lower(coalesce(auth.jwt() ->> 'email', '')) = 'ai@cablotec.local')
  with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'ai@cablotec.local');

-- ── VERIFICA ───────────────────────────────────────────────────────────
-- Deve comparire una riga, con cmd = UPDATE.
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and policyname = 'articoli_claude_update';

-- La policy è PERMISSIVE: si aggiunge a quelle che ci sono già e non toglie
-- niente a nessuno. Per richiudere il rubinetto:
--   drop policy articoli_claude_update on public.articoli;
