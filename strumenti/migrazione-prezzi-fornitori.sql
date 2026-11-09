-- ═══════════════════════════════════════════════════════════════════
-- PREZZI FORNITORI NELLA SCHEDA PRODOTTO (Nico, 9 nov 2026)
-- "Sul codice EL50811EMAN003K3GD44790 scrivo che Angela ce lo fa a 40 € a pz."
-- articoli.prezzi_fornitori = [{ "fornitore": "<azienda_id>", "prezzo_pz": 40 }]
-- Il conto della commessa lo moltiplica per i pezzi se quel fornitore e'
-- sulla commessa; l'importo scritto sulla commessa (operazioni_fornitori.
-- importo) resta l'eccezione che vince. Finche' la colonna non c'e' la
-- sezione non compare. Nessuna tabella nuova: niente GRANT da aggiungere.
-- ═══════════════════════════════════════════════════════════════════
alter table articoli add column if not exists prezzi_fornitori jsonb;

-- VERIFICA: deve uscire una riga "prezzi_fornitori | jsonb".
select column_name, data_type from information_schema.columns
 where table_name = 'articoli' and column_name = 'prezzi_fornitori';
