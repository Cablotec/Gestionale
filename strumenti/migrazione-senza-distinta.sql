-- DICHIARARE CHE UNA COMMESSA NON HA DISTINTA — 17 set 2026.
-- Da eseguire dal pannello Supabase (SQL Editor), non da qui.
--
-- PARTE 1 (la colonna) e' GIA' ESEGUITA. Resta sotto per memoria.
-- PARTE 2 (il backfill su Elcotec) e' quella da lanciare.
--
-- ⚠⚠ IL CODICE NUOVO NON VA IN PRODUZIONE PRIMA DELLA PARTE 2.
-- Misurato sui dati del 17 set: senza il backfill si accendono **245 avvisi**
-- ⚠ distinta tutti insieme. Con il backfill ne restano **65** — cioe' uno in
-- piu' dei 64 di oggi, e quell'uno e' un'anomalia vera (vedi in fondo).
--
-- ⚠⚠ QUI NON SI DICHIARA NIENTE DI NUOVO. Il backfill scrive sulle commesse
-- una cosa che Nico ha gia' dichiarato in anagrafica Elcotec: sposta una
-- dichiarazione, non ne inventa una.
-- Una prima stesura di questo file spuntava anche `materiale_dal_cliente` su
-- Senzani, Tema Sinergie e Bucci, perche' le loro commesse non hanno distinta.
-- **Tolto: e' una deduzione, non una dichiarazione.** Nico, 17 set: *"non
-- voglio dichiarare che quei clienti non usano distinte perche' non e' detto"*.
-- E' la stessa regola gia' scritta qui dentro per la tariffa: un indizio non
-- basta per tacere un avviso. Quei 54 avvisi restano accesi e dicono il vero
-- — *questo prodotto non ha una distinta in archivio* — che e' un fatto,
-- indipendentemente da come poi il materiale arrivi in reparto.
--
-- ══ PERCHE' IL CLIENTE ADESSO SEMINA INVECE DI GOVERNARE ══
-- Fino al 16 set `aziende.materiale_dal_cliente` zittiva l'avviso DAL VIVO: la
-- tabella lo rileggeva a ogni disegno. Era rimasta l'ultima regola-cliente di
-- questa casa a fare cosi' — `tariffa_cliente` decide alla nascita e poi "in
-- modifica MAI automatica", i minuti seminano l'articolo solo se vuoto,
-- `operazioni.materiali` si congela.
-- Il motivo del cambio non e' l'eleganza, e' una richiesta di Nico: *"se per
-- caso un ordine dovesse avere qualche componente io potrei cambiarlo
-- togliendo la spunta dall'ordine specifico"*. Finche' il cliente parlava dal
-- vivo quella spunta tolta non aveva effetto — il flag zittiva l'avviso
-- comunque, e la casella sembrava rotta.
--
-- ⚠ IL PREZZO, DICHIARATO: da adesso togliere il flag a un cliente **non
-- riaccende piu' le sue commesse gia' nate**. E' il patto del seme, ed e'
-- anche il pregio: una commessa non cambia sotto i piedi a chi ci lavora.
--
-- I due livelli che restano, e chi li legge:
--   CLIENTE   `aziende.materiale_dal_cliente`  SEMINA `senza_distinta` sulle
--                                              commesse che nascono. Non lo
--                                              legge piu' nessun avviso.
--   PRODOTTO  `articoli.distinta`              una distinta che c'e' toglie
--                                              la domanda da sola.
--   COMMESSA  `operazioni.senza_distinta`      **l'unica cosa che l'avviso
--                                              guarda.** Chi decide e' la riga.
--
-- ⚠ Il default e' FALSE e non NULL: "non dichiarato" e "dichiarato che ce
-- l'ha" qui sono la stessa cosa — l'avviso si accende in entrambi i casi.
-- Un NULL in piu' sarebbe uno stato senza significato proprio.
--
-- ⚠ L'app e' INERTE finche' questa colonna non esiste (`senzaDistintaDichiarabile`
-- se ne accorge dalle righe gia' caricate): l'avviso resta spento del tutto e
-- la casella non compare, invece di comparire e fallire al salvataggio.


-- ══════════════════════════════════════════════════════════════════
-- PARTE 1 — la colonna.  ⚠ GIA' ESEGUITA il 17 set.
-- ══════════════════════════════════════════════════════════════════

alter table operazioni
  add column if not exists senza_distinta boolean not null default false;

comment on column operazioni.senza_distinta is
  'Questa commessa non ha distinta, quindi non ci sara una lista materiali. '
  'E l''UNICA fonte dell''avviso "distinta" in Ordini cliente e del "senza '
  'distinta" al kiosk. La scrive da sola creaMaterialiPerCommesse quando il '
  'cliente ha materiale_dal_cliente e la lista non nasce; si toglie a mano '
  'dalla scheda Materiali della commessa quando quell''ordine, per una volta, '
  'dei componenti ce li ha.';


-- ══════════════════════════════════════════════════════════════════
-- PARTE 2 — il backfill.  ⚠ DA ESEGUIRE.
-- Una riga sola: scrive sulle commesse gia' nate la dichiarazione che il
-- loro cliente porta gia' in anagrafica. Oggi vuol dire Elcotec e basta.
-- ⚠ Non nomina nessun cliente: legge il flag. Se domani un altro cliente
-- venisse dichiarato conto lavoro, questa stessa query lo copre — ma va
-- rilanciata di proposito, perche' il seme da solo vale sulle commesse NUOVE.
-- ══════════════════════════════════════════════════════════════════

-- ⚠⚠ NON su quelle che una lista CE L'HANNO GIA': scriverebbe "questa
-- commessa non ha distinta" su una che ce l'ha — una bugia nel database,
-- anche se nessuno la guarda. Su Elcotec e' 1 commessa su 181, ed e' proprio
-- il caso che la spunta serve a gestire a mano.
-- ⚠ `jsonb_typeof` prima di `jsonb_array_length`: la seconda va in errore se
-- il valore non e' un array, e fermerebbe la query.
update operazioni o set senza_distinta = true
from aziende a
where a.id = o.cliente_id
  and a.materiale_dal_cliente is true
  and o.senza_distinta is not true
  and (o.materiali is null
       or jsonb_typeof(o.materiali) <> 'array'
       or jsonb_array_length(o.materiali) = 0);


-- ══════════════════════════════════════════════════════════════════
-- LA PROVA — cosa deve venire fuori (dati del 17 set).
-- ══════════════════════════════════════════════════════════════════
--
--   select count(*) from operazioni where senza_distinta;
--     atteso: 180   (tutte Elcotec)
--
--   select count(*) from aziende where materiale_dal_cliente;
--     atteso: 1     (Elcotec, invariato — qui non si dichiara niente)
--
--   -- la commessa di conto lavoro NON seminata perche' una lista ce l'ha:
--   select o.numero_op, a.nome, jsonb_array_length(o.materiali) as righe
--   from operazioni o join aziende a on a.id = o.cliente_id
--   where a.materiale_dal_cliente and not o.senza_distinta;
--     attesa: 1 riga (Elcotec, senza numero OP, 1 riga di materiali)
--
-- Dopo, in Ordini cliente l'avviso ⚠ distinta resta acceso su **65**
-- commesse, contro le 64 di oggi:
--   43 Senzani · 11 Tema Sinergie · 4 Bucci   → i tre non dichiarati: l'avviso
--                                               dice il vero, il prodotto una
--                                               distinta in archivio non ce l'ha
--    3 Sacmi · 3 N.P.C.                       → gia' accesi oggi
--    1 Elcotec                                → LA DIFFERENZA, ed e' un'anomalia:
--        commessa senza numero OP la cui unica riga di materiali e' il codice
--        dell'articolo FINITO, su un articolo con distinta vuota. Prima il flag
--        del cliente la zittiva dal vivo; adesso si vede. Vale la pena
--        guardarla, non zittirla.
-- ⚠ Di quei 65 solo **30 sono su commesse ancora aperte o sospese**: le altre
-- 35 stanno su commesse completate o spedite, dove nessuno le va a leggere.
