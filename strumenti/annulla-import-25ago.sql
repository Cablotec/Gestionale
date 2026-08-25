-- ═══════════════════════════════════════════════════════════════════
-- ANNULLA I DOPPIONI DELL'IMPORT ORDINI DEL 25 AGO 2026
--
-- Cosa e' successo: l'import confrontava la posizione come TESTO con gli
-- zeri davanti ("0040"), ma 191 commesse su 468 ce l'hanno corta ("40").
-- Non riconoscendole, invece di aggiornarle ne ha create di nuove accanto:
-- 51 commesse doppie su 72 create. In piu' ha creato 3 schede cliente
-- accanto a quelle che c'erano gia', perche' l'ERP scrive "CABLOTECH SRL"
-- e il gestionale "Cablotech S.r.l.".
--
-- Il codice e' gia' corretto (versione 2026-08-25.3): la posizione si
-- confronta come numero e il cliente per forma giuridica normalizzata.
-- Questo file ripulisce quello che la versione sbagliata ha scritto.
--
-- STATO ACCERTATO PRIMA DI SCRIVERE QUESTO FILE (letto dal database):
--   · 51 commesse doppie, tutte create il 2026-08-25 alle 06:46
--   · ZERO timbri e ZERO addetti attaccati: nessuno ci ha lavorato sopra
--   · 28 di loro hanno fasi generate in automatico, che se ne vanno con loro
--   · 3 schede cliente doppie, con ZERO commesse e zero riferimenti
--   · restano fuori 4 coppie doppie PREESISTENTI (giugno/luglio): non le ha
--     fatte l'import e non si toccano
--   · le righe intere sono salvate in scratchpad/doppioni_25ago.json
--
-- COME SI USA: eseguire i blocchi UNO ALLA VOLTA, guardando cosa torna.
-- Il blocco 1 non cancella niente: serve a confermare i numeri.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. VERIFICA (non cancella niente) ──────────────────────────────────
-- Deve tornare 51 righe. Se ne torna un numero diverso, FERMARSI e ridire:
-- vuol dire che nel frattempo qualcosa e' cambiato.
with doppie as (
  select id, numero_ordine, pos, quantita, scadenza, stato, created_at,
         row_number() over (
           partition by numero_ordine, (pos)::int
           order by created_at
         ) as n
  from operazioni
  where pos ~ '^[0-9]+$'
)
select count(*) as da_cancellare
from doppie
where n > 1
  and created_at::date = date '2026-08-25';

-- Elenco per esteso, da guardare prima di cancellare:
with doppie as (
  select id, numero_ordine, pos, quantita, scadenza, stato, created_at,
         row_number() over (
           partition by numero_ordine, (pos)::int
           order by created_at
         ) as n
  from operazioni
  where pos ~ '^[0-9]+$'
)
select id, numero_ordine, pos, quantita, scadenza, stato, created_at
from doppie
where n > 1
  and created_at::date = date '2026-08-25'
order by numero_ordine, (pos)::int;

-- Controprova di sicurezza: deve tornare ZERO.
-- Se torna qualcosa, su un doppione c'e' del lavoro attaccato: NON cancellare
-- e ridire, si guarda caso per caso.
with doppie as (
  select id, created_at,
         row_number() over (
           partition by numero_ordine, (pos)::int
           order by created_at
         ) as n
  from operazioni
  where pos ~ '^[0-9]+$'
)
select count(*) as con_lavoro_attaccato
from doppie d
where d.n > 1
  and d.created_at::date = date '2026-08-25'
  and (exists (select 1 from sessioni_lavoro s where s.operazione_id = d.id)
    or exists (select 1 from operazioni_addetti a where a.operazione_id = d.id));


-- ── 2. CANCELLAZIONE DELLE 51 COMMESSE DOPPIE ─────────────────────────
-- Eseguire SOLO dopo che il blocco 1 ha dato 51 e zero.
-- Le fasi collegate si cancellano prima, a mano: se la chiave esterna non
-- fosse in cascata resterebbero orfane.
begin;

create temporary table _doppioni_25ago as
with doppie as (
  select id, created_at,
         row_number() over (
           partition by numero_ordine, (pos)::int
           order by created_at
         ) as n
  from operazioni
  where pos ~ '^[0-9]+$'
)
select id from doppie
where n > 1 and created_at::date = date '2026-08-25';

-- deve dire 51
select count(*) as in_lista from _doppioni_25ago;

delete from operazioni_fasi     where operazione_id in (select id from _doppioni_25ago);
delete from operazioni_addetti  where operazione_id in (select id from _doppioni_25ago);
delete from operazioni_fornitori where operazione_id in (select id from _doppioni_25ago);
delete from operazioni          where id in (select id from _doppioni_25ago);

-- Se i numeri tornano: commit. Altrimenti: rollback;
commit;


-- ── 3. LE TRE SCHEDE CLIENTE DOPPIE ───────────────────────────────────
-- Prima la verifica: le tre righe devono avere ZERO commesse.
select a.id, a.nome, a.created_at,
       (select count(*) from operazioni o where o.cliente_id = a.id) as commesse,
       (select count(*) from operazioni_fornitori f where f.azienda_id = a.id) as come_fornitore,
       (select count(*) from utenti u where u.azienda_id = a.id) as utenti
from aziende a
where a.id in ('264044d6-62bb-4cb6-91a4-1f55c00f349b',   -- FABBRI ELIO S.n.c.
               'f574590e-0ae9-4f88-8bd0-4057af54c636',   -- METALMECCANICA ROSSI S.R.L.
               '84e6a307-fb08-4b01-ab69-edf6ec127218');  -- CABLOTECH SRL

-- Solo se tutte e tre hanno 0 / 0 / 0:
delete from aziende
where id in ('264044d6-62bb-4cb6-91a4-1f55c00f349b',
             'f574590e-0ae9-4f88-8bd0-4057af54c636',
             '84e6a307-fb08-4b01-ab69-edf6ec127218')
  and not exists (select 1 from operazioni o where o.cliente_id = aziende.id);


-- ── 4. DOPO LA PULIZIA ────────────────────────────────────────────────
-- Rifare l'import con la versione 2026-08-25.3: le commesse che prima
-- venivano duplicate adesso vengono AGGIORNATE (quantita', scadenza,
-- prezzo). Sul file di oggi l'anteprima deve dire circa:
--   21 nuove · 103 aggiornamenti · 6 gia uguali · 31 chiuse non toccate
--   nessun cliente da creare
-- Se dice ancora 72 nuove, la pagina sta usando la versione vecchia:
-- guardare il numero di versione sotto il logo.

-- ── NOTA su cosa NON tocca questo file ────────────────────────────────
-- Restano com'erano 4 coppie ordine+posizione doppie piu' vecchie:
--   2026/OC/00308 pos 10 (6 lug) · 2026/OC/00000 pos 10 (20 lug)
--   2026/OC/00233 pos 10 e pos 20 (4 giu)
-- Non le ha fatte l'import. La 2026/OC/00000 e' quella gia' segnalata
-- nell'handoff come possibile riga di prova.
