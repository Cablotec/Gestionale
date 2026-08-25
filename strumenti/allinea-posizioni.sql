-- ═══════════════════════════════════════════════════════════════════
-- ALLINEA LE POSIZIONI A 4 CIFRE (25 ago 2026)
--
-- Il database ha due forme della stessa cosa: `0010` e `10`. Su 417
-- commesse, 191 hanno la forma corta — sono quelle nate prima che la
-- convenzione a 4 cifre esistesse, o digitate a mano. E' il disallineamento
-- che il 25 ago ha fatto creare all'import 51 commesse doppie.
--
-- Il codice non ne ha piu' bisogno (dalla `.5` la pos si confronta come
-- numero e si normalizza in tutte e due le porte d'inserimento): questo
-- serve a togliere di mezzo la doppia forma una volta per tutte, cosi' la
-- prossima cosa che confronta le pos come TESTO non ci ricasca.
--
-- Perche' dal pannello e non dall'app: l'account tecnico non puo' scrivere
-- sulle commesse — l'RLS rifiuta in silenzio (HTTP 200, zero righe toccate).
--
-- MARCIA INDIETRO: le 190 righe con la pos originale sono salvate in
-- scratchpad/pos_prima_del_cambio.json.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. VERIFICA (non scrive niente) ───────────────────────────────────
-- Quante sono, per forma. Atteso: 225 a 4 cifre, 181 a 2, 10 a 3, 1 vuota.
select coalesce(length(pos)::text || ' cifre', '(vuota)') as forma, count(*)
from operazioni
group by 1
order by 2 desc;

-- Le righe che verranno toccate. Atteso: 190.
-- La condizione `not exists` esclude il caso in cui la posizione allineata
-- andrebbe a sovrapporsi a un'altra riga dello STESSO ordine: la'
-- l'allineamento creerebbe una coppia identica invece di sistemarne una.
-- Sui dati di oggi ne esclude UNA SOLA: 2026/OC/00000 pos "10", che si
-- scontrerebbe con la "0010" dello stesso ordine (sono le due righe gia'
-- doppie segnalate nell'handoff, probabile riga di prova).
select count(*) as da_allineare
from operazioni o
where o.pos ~ '^[0-9]{1,3}$'
  and not exists (
    select 1 from operazioni a
    where a.numero_ordine = o.numero_ordine
      and a.id <> o.id
      and lpad(a.pos, 4, '0') = lpad(o.pos, 4, '0')
  );

-- Chi resta fuori, e perche' (atteso: 1 riga)
select o.id, o.numero_ordine, o.pos, o.stato
from operazioni o
where o.pos ~ '^[0-9]{1,3}$'
  and exists (
    select 1 from operazioni a
    where a.numero_ordine = o.numero_ordine
      and a.id <> o.id
      and lpad(a.pos, 4, '0') = lpad(o.pos, 4, '0')
  );


-- ── 2. ALLINEAMENTO ───────────────────────────────────────────────────
-- Eseguire solo dopo che il blocco 1 ha dato 190 e 1.
-- Il RETURNING chiude il blocco: si vedono le righe cambiate, devono essere 190.
begin;

update operazioni o
set pos = lpad(o.pos, 4, '0')
where o.pos ~ '^[0-9]{1,3}$'
  and not exists (
    select 1 from operazioni a
    where a.numero_ordine = o.numero_ordine
      and a.id <> o.id
      and lpad(a.pos, 4, '0') = lpad(o.pos, 4, '0')
  )
returning numero_ordine, pos;

commit;

-- Se le righe non sono 190: `rollback;` e ridimmelo.


-- ── 3. CONTROPROVA ────────────────────────────────────────────────────
-- Devono restare solo: 415 a 4 cifre, 1 a 2 cifre (quella esclusa), 1 vuota.
select coalesce(length(pos)::text || ' cifre', '(vuota)') as forma, count(*)
from operazioni
group by 1
order by 2 desc;
