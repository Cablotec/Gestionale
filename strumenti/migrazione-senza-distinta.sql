-- DICHIARARE CHE UNA COMMESSA NON HA DISTINTA — 17 set 2026.
-- Da eseguire dal pannello Supabase (SQL Editor), non da qui.
--
-- Chiesto da Nico: una spunta dentro l'ordine, nella scheda Materiali, per
-- dire "quest'ordine non ha distinta" e spegnere l'avviso su quella riga.
--
-- ⚠⚠ E' IL TERZO E PIU' BASSO DEI TRE LIVELLI. La stessa cosa si puo' gia'
-- dire piu' in alto, e quasi sempre e' li' che va detta:
--
--   CLIENTE   `aziende.materiale_dal_cliente`  il materiale lo manda lui.
--                                              Vale per tutte le sue commesse,
--                                              anche quelle che devono ancora
--                                              nascere.
--   PRODOTTO  `articoli.distinta = '[]'`       questo prodotto non ha
--                                              materiali. Vale per tutte le
--                                              commesse di quel prodotto.
--   COMMESSA  `operazioni.senza_distinta`      questa riga qui, e basta.
--
-- Sui dati del 17 set: **64 commesse segnalate, 58 si spengono con TRE spunte**
-- sui clienti (Senzani 43, Tema Sinergie 11, Bucci 4 — lavorano come Elcotec
-- ma il flag non ce l'hanno). Ne restano 6, una per prodotto.
-- Spuntare 64 caselle a mano per dire una cosa che il cliente diceva gia' e'
-- il modo di ritrovarsi fra sei mesi con trecento caselle e nessuna regola.
--
-- ⚠ Il default e' FALSE e non NULL: "non dichiarato" e "dichiarato che ce
-- l'ha" qui sono la stessa cosa — l'avviso si accende in entrambi i casi.
-- Un NULL in piu' sarebbe uno stato senza significato proprio.
--
-- ⚠ L'app e' INERTE finche' questa colonna non esiste (si accorge dalle righe
-- gia' caricate): la casella non compare, e nessuno puo' spuntarla per poi
-- vedersi rifiutare il salvataggio da un database che non conosce il campo.

alter table operazioni
  add column if not exists senza_distinta boolean not null default false;

comment on column operazioni.senza_distinta is
  'Dichiarazione manuale: questa commessa non ha distinta, quindi non ci sara '
  'una lista materiali. Spegne l''avviso "⚠ distinta" in Ordini cliente e il '
  '"nessuna lista" al kiosk. Da usare solo quando la cosa NON e gia detta dal '
  'cliente (aziende.materiale_dal_cliente) o dal prodotto (articoli.distinta = []).';
