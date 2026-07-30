# CLAUDE.md — Gestionale Cablotec

> Derivato da `handoff.md` (fonte per i fili aperti: aggiornare lì e rigenerare qui).

## Contesto lampo
- **Cos'è**: ERP Cablotec. Backend **Supabase**, hosting **GitHub Pages** (deploy = git push, nessun build tool, **script classici — niente ES module**, scope globale condiviso).
- **Pubblicazione Pages**: workflow esplicito `.github/workflows/pages.yml` (Source = "GitHub Actions"). NON tornare a "Deploy from a branch" (pipeline legacy incastrata il 5-6 lug 2026). Deploy fallito → Actions → Re-run jobs o commit vuoto.
- **Struttura**: `index.html`/`kiosk.html` (gusci gemelli), `app.js` (~14k r) + `app.css`, `core/db.js` (Supabase condiviso + `fetchTutte` paginata oltre il tetto 1000 righe), `domain/scheduling.js` (motore PURO: no DOM, no Supabase), `domain/codifica.js` (dati piano dei conti + tabelle + composizione codici 20 caratteri, PURO), `mobile.html`/`prelievo.html` autonome.
- **Cache**: a ogni deploy bump `?v=YYYY-MM-DD.N` nei 4 gusci. Attuale: `v=2026-07-28.5`. **Versione visibile sotto il logo** (gestionale e kiosk): prima verifica quando "non si vede una modifica".
- **Kiosk**: auto-update ogni 5 min (ricarica da solo su versione nuova, solo da schermata identificazione).

## Nico (titolare) — stile
- Italiano, conciso, pratico, odia il superfluo. **Ragionamento PRIMA** di toccare numeri visibili o modello dati. Su scelte aperte "dimmi tu" = raccomandazione secca.

## Diciture unità (UNA dicitura, SEMPRE quella)
- Tempo per pezzo: **`min/pz`** (mai `'`). Totali di fase/minuti assoluti: **`min`**. Totali di commessa: **`h`** (1 decimale, virgola). Conteggi per esteso ("2 commesse", mai "comm.").

## Workflow dopo OGNI modifica
1. `node --check app.js && node --check core/db.js && node --check domain/scheduling.js` (scope globale condiviso: verificare che i simboli esistano).
2. Verificare doppioni/orfani/`onclick=""` nell'HTML statico.
3. Passi piccoli e reversibili. Per il layout: riprodurre in pagina di test + **misurare nel browser** (getBoundingClientRect), mai a occhio.

## Stato migrazioni DB (le esegue Nico dal pannello Supabase)
- `operazioni.prezzo_unitario`: **ESEGUITA** (campo €/pz attivo).
- `operazioni.gruppo_id` (accorpamento): **ESEGUITA** (verificata a DB il 28 lug); resta il collaudo sul campo.
- `aziende.tariffa_oraria` (traccia fornitori): **ESEGUITA** (14 lug).
- `aziende.tariffa_cliente` (regola prezzo→tempo pagato): **ESEGUITA** (14 lug). NB: `operazioni.minuti_unitari` è **INTEGER** → arrotondare sempre al minuto intero.
- `utenti.azienda_id` (ditta degli esterni in sede): **ESEGUITA** (28 lug); i 4 esterni hanno già la ditta collegata (Tecnocab SNC, SINTEC DI SINANI QERIM).
- Tabella `produttori` (scheda Codifica): **ESEGUITA** (28 lug, verificata via REST); vuota, da popolare.
- Tabella `ore_esterne` (ore fornitori dichiarate): **DA ESEGUIRE** — SQL in handoff.md; codice inerte senza (si vedono solo le ore timbrate).

## ▶ Fili aperti (priorità)
0. **Codifica articoli** (15 lug, `2026-07-15.1`): tab Codifica in Gestione genera codici a 20 caratteri (5 classificazione da `domain/codifica.js` + 4 produttore + 11 codice con zeri PRIMA). Manca: migrazione `produttori` + chiarire con Matteo le ambiguità dei fogli (note ⚠ in scheda e in handoff). Codici a sé stanti: collegamento all'anagrafica articoli = futuro.
   - **Sigle produttore più corte di 4 → zeri IN FONDO** (28 lug): `TDK`→`TDK0`, `3M`→`3M00`. Le posizioni sono fisse (produttore = caratteri 6-9), la quarta casella esiste sempre. Zero e non quarta lettera: automatico, non ambiguo, nessuna scelta marchio-per-marchio. Marchi più lunghi: **abbreviati a mano**, mai tagliati in automatico. Il riempimento sta all'INSERIMENTO — `codificaComponi` resta severo a 4 caratteri esatti.
1. **Nuovo ordine — grana estetica residua** (NON cancellare la feature): "+ Nuovo ordine" è l'unica porta d'inserimento (griglia 5 righe, POS auto, aggiungi-N, autocomplete con creazione al volo, prezzo dal listino, fasi auto; il vecchio modal resta per MODIFICARE). Funziona, ma Nico vede ancora un disallineamento ("lasceremo perdere… troppo complicato?"). Tecnicamente: colonne a delta 0 misurato, intestazione allineata al pixel in pagina di test. Se lo rivede sulla `.8`: misurare sulla **pagina reale loggata**, con suo screenshot segnato.
2. **Prezzi step 3**: sezione listino nell'anagrafica articolo **FATTA** (13 lug) + **€/ora per cliente FATTO** (14 lug) + **traccia fornitori FATTA lato codice** (14 lug, `.2`: tariffa €/h in scheda azienda + prezzo suggerito live nella riga fornitore del modal commessa; manca il collaudo con una tariffa vera) + **prezzo consigliato dal CONSUNTIVO FATTO** (28 lug, `2026-07-28.1`). Dati: % per cliente NON predittive (±35); il numero d'oro è **reale/pagato per cliente**. Attenzione: Elcotec non è sottoprezzata in blocco — 4 articoli sopra e 4 sotto, scarto pesato +13% ma dispersione da −67% a +184%; è la **dispersione per articolo** il problema, non il livello.
3. **Accorpamento commesse**: collaudare (vedi migrazione). Limiti v1: "fine fase" non propaga al gruppo; fase_id null sulle copie.
4. **Gantt**: fatti A+B+D (ritardi ancorati a oggi `⚠ RIT. Ng`, barre = quota operatore coi suoi timbri, fornitori dichiarati, legenda in alto, buchi su ferie). Restano **C** (dieta chips stati) ed **E** (riga REPARTO).
5. **Prospettiva "tutta l'azienda"**: Supabase regge; fatturazione fuori; il salto è SICUREZZA — **repo PUBBLICO con anon key + password kiosk in core/db.js** → privatizzare + ruotare, RPC, backup. Nessuna azione ora.

## Sospesi tecnici
- ~~Step 1b: timbri con `sb.from()` nudo~~ **FATTO** 28 lug (`2026-07-28.3`): `eseguiConRetry` su TUTTO il flusso di cattura, in `mobile.html` **e nel kiosk** (esposto uguale, non era segnalato). Admin esclusi di proposito (c'è una persona che vede l'errore e ritenta). Due trappole da ricordare: un **builder Supabase è monouso** → ricostruirlo in una `buildQ = () => …` a ogni tentativo; il **timestamp si calcola prima** del retry, mai dentro la closure, o il secondo tentativo scrive l'ora sbagliata.
- De-dup helper mobile/prelievo (`core/util.js`); `domain/formato.js` mai estratto.
- Fallback `?kiosk` da togliere; colonne `lead_giorni` inerti; potatura CSS/rami morti. (`beta/` e `index-vecchio.html` già assenti dal repo: voce chiusa.)

## Decisioni consolidate (mantenere)
- **Regole per-cliente = DATI d'anagrafica azienda, mai hardcode**: `tariffa_cliente` €/h = prezzo solo manodopera → nei nuovi ordini tempo pagato = prezzo ÷ tariffa × 60 (toast dichiara). In modifica MAI automatica: suggerimento "da prezzo" + usa. Elcotec 27,3 €/h. Griglia nuovo ordine: colonna Min/pz con priorità mano > regola > default articolo, placeholder live col valore automatico; i minuti salvati SEMINANO `articoli.minuti_unitari` solo se vuoto (mai sovrascrivere).
- **Fasi effettive = media storica VIVA** (spedite+completate, finestra **ULTIME 5** per articolo+tipo — `MEDIA_ULTIME_COMMESSE` in domain), template solo fallback senza storico. Modal commessa: fasi **SOLA LETTURA** dall'anagrafica (matita ✎ apre l'articolo con ritorno via `opts.dopoChiusura`), riallineate al salvataggio (aggiorna/aggiunge, MAI cancella). Anagrafica articolo: righe auto-compilate dalle effettive. Toggle sequenza/parallelo rimosso (motore sempre sequenziale).
- **Esterne dichiarate, mai nascoste**: `opCalcOreInterne` (stessa base di `opCalcOre`: `opFasiPianif`), confronti interno-vs-interno ovunque; fornitore "su tutta la commessa" = badge dedicato; `⚙ nome` sulle barre Gantt.
- **PREVENTIVO e CONSUNTIVO del lavoro esterno non si fondono** (28 lug): il "prezzo suggerito" sulla riga fornitore (ore stimate dai min/pz × tariffa) è un preventivo; `oreEsterneCommessa` è il consuntivo, con **due fonti sempre dichiarate** — `⏱` ore timbrate dagli esterni in sede (DERIVATE dai timbri, tariffa live, esterni senza `azienda_id` esclusi) e `📄` ore da rapportino (tabella `ore_esterne`, **tariffa congelata sulla riga**: un costo sostenuto non si riscrive). Doppio conteggio = rischio n.1: le ditte in entrambe le fonti finiscono in `conflitti` e si dichiarano in giallo, mai sommate in silenzio. Il **margine riga** usa le ore vere dove ci sono e la stima solo per le ditte che non ne hanno, ditta per ditta, dichiarando la composizione.
- **Listino/storico prezzi derivati** (mai tabelle): `prezzoListino` = ultimo prezzo per articolo+cliente (created_at, ripiego altro cliente), non media. `storicoPrezziArticolo` per l'andamento.
- **Prezzo dal consuntivo = verso opposto della regola tariffa** (28 lug): `prezzoDaTempoEffettivo` / `scostamentiPrezzoCliente` in domain — ore **realmente timbrate** × tariffa cliente, sulle sole fasi con fonte `storico` (il template è stima: dichiarato negli esclusi, mai sommato). `nCommesse` = minimo tra le fasi, `debole` = campione 1 → mostrato ma **marcato giallo**, mai nascosto. Propone e basta: bottone "usa" nel modal commessa, elenco scostamenti (ordinati per scarto ASSOLUTO, entrambi i versi) in Analisi clienti.
- **Accorpamento**: split del timbro proporzionale al peso = qtà × min/pz (`ripartisciTimbroGruppo` + `commesseGruppoLavorabili`, 18 test); insert+update, mai delete (RLS kiosk non può cancellare).
- Derivati **live**, mai materializzati. `domain/` resta PURO. Prima di cancellare funzioni: cercare chiamanti anche in `onclick=""`. Tabelle a crescita libera SEMPRE via `fetchTutte`.
- Il controllo economico è il **tempo pagato** (mai auto-aggiornato). Kiosk "Riprendi" = ultime timbrate non finite in cima.
- **`utenti.esterno` = "esterno IN SEDE"** (ridefinito 28 lug): persona di un'altra ditta che lavora QUI e **timbra al kiosk**. Il terzista che lavora FUORI è un **fornitore sulla commessa**, non un utente — quel ramo era morto (0 utenti, 0 timbri) e non si pota, si riusa. Gli esterni compaiono al kiosk in sezioni per ditta, entrano in Gantt Live e Calendario (occupano capacità) marcati ✦/giallo, e restano **fuori dal Riepilogo assenze** (ferie = rapporto col loro datore). Fine rapporto → `attivo=false`, MAI rimettere `esterno`: i timbri restano storico. Una ditta può essere insieme fornitore e datore di esterni in sede: due rapporti veri, non un doppione.

## Strumenti riusabili
- **DB in lettura** via REST con account kiosk (credenziali in core/db.js) — diagnosi su dati reali; curl con `--ssl-no-revoke`; l'account NON può DELETE → cancellazioni via SQL dal pannello (Nico).
- **Suite test Node** in scratchpad (test_livella/finestra/fasi_eff/mero/interne/quote/stima/gruppo/listino): stub + eval di domain/scheduling.js. Rilanciare dopo modifiche al domain.
- **Data realistica** nel modal commessa nuova (`livellaOperatore` + `stimaFineCommessaNuova`): fondamenta per Gantt livellato/autodistribuzione futuri.
