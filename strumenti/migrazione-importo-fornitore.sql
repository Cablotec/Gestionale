-- IMPORTO ORDINE AL FORNITORE (Nico, 9 nov 2026)
-- Il prezzo fisso concordato col fornitore per quella commessa: il TOTALE
-- dell'ordine (40 EUR al pezzo x 10 pezzi = 400). Serve al "Conto della
-- commessa" nel Consuntivo: prezzo al cliente - fornitori = quello che resta
-- per noi, diviso le ore nostre = quanto ha reso un'ora. Non serve la fase.
-- Un fornitore su piu' fasi ha piu' righe: l'importo e' lo stesso su tutte
-- e il conto lo prende una volta sola.
alter table operazioni_fornitori add column if not exists importo numeric(12,2);
alter table operazioni_fornitori drop constraint if exists operazioni_fornitori_importo_check;
alter table operazioni_fornitori add constraint operazioni_fornitori_importo_check
  check (importo is null or importo >= 0);

-- VERIFICA: deve uscire una riga "importo | numeric".
select column_name, data_type from information_schema.columns
 where table_name = 'operazioni_fornitori' and column_name = 'importo';
