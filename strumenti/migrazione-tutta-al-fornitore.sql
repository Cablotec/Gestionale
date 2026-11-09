-- ═══════════════════════════════════════════════════════════════════
-- ⚠ NON PIU LETTA dal 9 nov sera (2026-11-09.04): la casella e stata tolta, la colonna resta.
-- «LA FA TUTTA LUI» AL POSTO DELLE FASI SUL FORNITORE (Nico, 9 nov 2026)
-- Nico: le fasi sul fornitore non le vuole; se un fornitore fa tutta la
-- commessa o solo una parte "dipende". Casella sulla riga fornitore:
--   true  → commessa tutta sua: nostre ore previste 0 (salvo timbri nostri)
--   false → il fornitore e' solo un costo: le ore restano nostre
-- Le righe di prima che oggi valgono "tutta fuori" (fornitore senza fase su
-- commessa senza fasi complete) nascono a true: per loro non cambia niente.
-- Le righe CON una fase restano come sono (la fase va fuori, il resto nostro).
-- Nessuna tabella nuova: niente GRANT da aggiungere.
-- ═══════════════════════════════════════════════════════════════════
alter table operazioni_fornitori add column if not exists tutta_fuori boolean not null default false;

update operazioni_fornitori f set tutta_fuori = true
 where f.fase_id is null
   and not (
     exists (select 1 from operazioni_fasi p where p.operazione_id = f.operazione_id)
     and not exists (select 1 from operazioni_fasi p where p.operazione_id = f.operazione_id
                       and coalesce(p.minuti_unitari, 0) <= 0));

-- VERIFICA: quante righe per valore (vero = come prima "tutta fuori").
select tutta_fuori, count(*) from operazioni_fornitori group by tutta_fuori order by 1;
