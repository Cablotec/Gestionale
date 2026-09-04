-- ═══════════════════════════════════════════════════════════════════
-- RITIRA LA TABELLA `distinta` — l'ultimo residuo della vecchia lista Alnus
--
-- Il 4 set le distinte sono state travasate dentro i prodotti
-- (`articoli.distinta`, 155 prodotti e 3.822 righe) e da quel momento
-- NESSUNA riga di codice legge piu' questa tabella: zero occorrenze di
-- `from('distinta')` in app.js e nei quattro gusci, e gli strumenti che la
-- usavano sono stati cancellati. Restava solo lei, con 38.461 righe che non
-- rispondono piu' a nessuno.
--
-- ═══ PRIMA DI ESEGUIRE ═══
-- Le righe sono gia' salvate FUORI dal repo:
--   Z:\SOFTWARE\MegaAPP\backup-gestionale\distinta-archivio-2026-09-04.json
--   38.461 righe · 5.366 padri distinti · 14 MB
-- Controlla che il file ci sia. Questa e' un'operazione da cui non si torna
-- indietro se non da li'.
--
-- ⚠ NON tocca `materiali` (9.327 codici): quella e' ANAGRAFICA, non la
-- distinta, e il gestionale la legge ancora per descrizioni, unita' di
-- misura e tipo parte.
--
-- ⚠ Il DROP lo devi fare tu: l'account tecnico non puo' e non deve poterlo
-- fare. Il permesso di questo progetto sta sulle OPERAZIONI, non sul ruolo,
-- e non esiste nessuna funzione che cancelli.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Controllo prima: quante righe stai per buttare ──────────────────
select count(*) as righe, count(distinct padre) as padri from public.distinta;
-- Atteso il 4 set 2026: 38461 righe, 5366 padri.
-- Se i numeri non tornano, FERMATI e chiedi: vuol dire che qualcuno ci
-- scrive ancora, e allora non e' un residuo.

-- ── 2. Il ritiro ───────────────────────────────────────────────────────
-- Scommenta ed esegui solo dopo aver visto i numeri qui sopra.

-- drop table public.distinta;

-- ── 3. Controllo dopo ──────────────────────────────────────────────────
-- Deve tornare zero righe.
select tablename from pg_tables
where schemaname = 'public' and tablename = 'distinta';
