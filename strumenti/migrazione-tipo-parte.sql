-- ═══════════════════════════════════════════════════════════════════
-- mancanti.tipo_parte  (27 ago 2026)
--
-- L'estrazione "Fabbisogno Massivo" ha una colonna nuova, **Tipo Parte**,
-- che divide i mancanti in tre mestieri diversi:
--   ACQ  = lo compriamo noi      -> c'e' un ordine da emettere
--   C/L  = conto lavoro          -> arriva dal CLIENTE, non si ordina
--   MAC  = materiale di consumo  -> il filo c'e' sempre, non ferma niente
--
-- PERCHE' SERVE: senza questa colonna finiscono tutti nello stesso rosso
-- "da ordinare". Sul file del 27 ago sono 24 ACQ, 222 C/L e 41 MAC: su 31
-- commesse toccate, **16 mostravano un rosso da 48, 36, 28 codici** quando
-- non c'era niente da ordinare — si aspettava il cliente. Un rosso che si
-- accende sempre smette di voler dire qualcosa.
--
-- SENZA QUESTA MIGRAZIONE l'import continua a funzionare: si accorge che
-- la colonna non c'e', salva tutto il resto e lo dichiara nell'anteprima.
-- Semplicemente la distinzione non viene registrata e tutto resta
-- "da ordinare" come prima. Nessuna fretta, nessun rischio ad aspettare.
-- ═══════════════════════════════════════════════════════════════════

alter table public.mancanti add column if not exists tipo_parte text;

-- Verifica: deve comparire una riga, tipo_parte / text.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'mancanti' and column_name = 'tipo_parte';

-- NB: le righe gia' in archivio restano con tipo_parte NULL, ed e' giusto —
-- sono state importate da un file che quella colonna non ce l'aveva. Il
-- codice le tratta ESATTAMENTE come prima (da ordinare se la quantita' e'
-- maggiore di zero): un dato vecchio non deve cambiare significato solo
-- perche' e' arrivata una colonna nuova. Si popolano al primo reimport.
