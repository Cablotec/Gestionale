# Handoff — Gestionale Cablotec (aggiornato 28 lug 2026)

> Fonte per i fili aperti. CLAUDE.md è derivato da qui: se cambia questo, rigenerare quello.

## Contesto lampo
- **Cos'è**: ERP Cablotec. Backend **Supabase**, hosting **GitHub Pages**, script classici (niente ES module), scope globale condiviso. Deploy = git push.
- **Pubblicazione Pages**: workflow esplicito `.github/workflows/pages.yml` (Source = "GitHub Actions"). NON tornare a "Deploy from a branch" (pipeline legacy incastrata il 5-6 lug: build fermi ore, run non cancellabili). Deploy fallito → Actions → Re-run jobs o commit vuoto.
- **Struttura**: `index.html`/`kiosk.html` (gusci gemelli), `app.js` (~14k r) + `app.css`, `core/db.js` (Supabase condiviso + `fetchTutte` paginata), `domain/scheduling.js` (motore PURO, no DOM/Supabase), `mobile.html`/`prelievo.html` autonome.
- **Cache**: a ogni deploy bump `?v=YYYY-MM-DD.N` nei 4 gusci. Attuale: `v=2026-07-28.1`. La **versione è visibile sotto il logo** (gestionale e kiosk): prima cosa da controllare quando "non si vede una modifica" (quasi sempre è cache).
- **Kiosk**: auto-update ogni 5 min (ricarica da solo se c'è versione nuova e la postazione è sulla schermata identificazione).

## Nico (titolare) — stile
- Italiano, conciso, pratico, odia il superfluo. Ragionamento PRIMA di toccare numeri visibili o modello dati. Su scelte aperte "dimmi tu" = raccomandazione secca.
- **Diciture (UNA, SEMPRE quella)**: `min/pz` per tempo a pezzo (mai `'`), `min` per totali fase, `h` per totali commessa (1 decimale, virgola), "N commesse" per esteso.

## Workflow dopo OGNI modifica
1. `node --check app.js && node --check core/db.js && node --check domain/scheduling.js`.
2. Verificare doppioni/orfani/`onclick=""` nell'HTML statico.
3. Passi piccoli e reversibili. Per layout: riprodurre in pagina di test + **misurare nel browser** (getBoundingClientRect), non a occhio — metodo collaudato il 13 lug.

## Stato migrazioni DB (eseguite dal pannello Supabase da Nico)
- `prezzo_unitario` su operazioni: **ESEGUITA** (colonna attiva, campo €/pz visibile).
- `gruppo_id` su operazioni (accorpamento): **ESEGUITA** (verificata a DB il 28 lug: la colonna c'è). Resta il collaudo sul campo.
- `tariffa_oraria` su aziende (traccia fornitori): **ESEGUITA** (14 lug).
- `tariffa_cliente` su aziende (regola prezzo→tempo pagato, es. Elcotec): **ESEGUITA** (14 lug, tariffa Elcotec impostata). NB: `operazioni.minuti_unitari` è **INTEGER** → la regola arrotonda al minuto intero (scoperto sul campo: 131,87 rifiutato).
- `azienda_id` su utenti (ditta degli esterni in sede): **DA ESEGUIRE** — codice inerte senza (il campo "Ditta di provenienza" non compare e gli esterni si raggruppano sotto "Esterni in sede"):
  ```sql
  ALTER TABLE utenti ADD COLUMN azienda_id uuid REFERENCES aziende(id);
  ```
- Tabella `produttori` (scheda Codifica): **DA ESEGUIRE** — codice inerte senza (sigla produttore a mano):
  ```sql
  CREATE TABLE produttori (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sigla text NOT NULL UNIQUE,
    nome text,
    created_at timestamptz DEFAULT now()
  );
  ALTER TABLE produttori ENABLE ROW LEVEL SECURITY;
  CREATE POLICY produttori_all ON produttori FOR ALL TO authenticated USING (true) WITH CHECK (true);
  ```

## ▶ Fili aperti (in ordine di priorità)

### 1. Nuovo ordine — grana estetica residua (NON cancellare la feature)
- "+ Nuovo ordine" è l'UNICA porta d'inserimento (griglia: intestazione cliente+OC, 5 righe pos/articolo/OP/rif/qtà/€pz/scadenza, POS auto 0010/0020…, aggiungi-N, autocomplete con creazione al volo, prezzo dal listino, fasi auto). **Funziona.** Il vecchio modal resta per MODIFICARE (click sulla riga).
- MA Nico vede ancora un disallineamento che lo disturba (ultimo messaggio: "vabè lasceremo perdere… troppo complicato?"). Stato tecnico: griglia unica header+righe → colonne misurate a **delta 0**; intestazione cliente/OC allineata al pixel in pagina di test (121→153 entrambi). Se lo rivede sulla `.8`: riprendere col metodo misura-nel-browser ma sulla **pagina reale loggata** (la test page potrebbe non replicare tutto il contesto del modal). Da riprendere con calma, con suo screenshot segnato.

### 2. Prezzi — step 3 (dopo step 1+2 FATTI)
- FATTO: `prezzo_unitario` sulla riga + **listino vivo** (`prezzoListino`: ultimo prezzo per articolo+cliente, per created_at, ripiego altro cliente) + `storicoPrezziArticolo` (domain, 7 test) + griglia multi-riga + **sezione listino nell'anagrafica articolo** (13 lug, `.9`: blocco per cliente ordinato per data ultimo prezzo, drill-down andamento con `entityTimeline`, derivato e sola lettura — in `openArticoloModal`, tra Fasi e Note) + **€/ora per cliente** in Analisi clienti (14 lug, `2026-07-14.1`: `analisiClienti()` ritorna `euroOra`/`ricavo`/`nConPrezzo`, ricavo ÷ ore timbrate SOLO su commesse con prezzo — stesso sottoinsieme sopra e sotto la frazione; copertura dichiarata in card quando non tutte hanno prezzo; 9 test in scratchpad/test_eurora.js). NB: `prezzo_unitario` è nuovo (13 lug) → all'inizio quasi tutte le chiuse sono senza prezzo, €/h comparirà man mano.
- Traccia **fornitori** FATTA lato codice (14 lug, `.2`): campo "Tariffa oraria (€/h)" in scheda azienda (visibile solo se fornitore, si accende solo a colonna presente) + nel modal commessa, riga fornitore, "prezzo suggerito ≈ € X (Yh × Z €/h)" live — ore = somma min/pz delle SUE fasi (nessuna chip = tutta la commessa; senza fasi = budget pagato) × qtà corrente; si aggiorna su chip/qtà/minuti via `aggiornaSuggFornitori`. Nulla viene salvato: solo suggerimento. **Manca la migrazione** (vedi sezione migrazioni) e il collaudo con una tariffa vera.
- Analisi fatta sui dati: % ripartizione per cliente NON predittiva (±35 punti); il numero d'oro è **reale/pagato per cliente** (Elcotec ×1,45 = sottoprezzato; Sacmi ×0,69). Già in scheda Analisi clienti.
- **Prezzo consigliato DAL CONSUNTIVO** (28 lug, `2026-07-28.1`, richiesta Nico) — il verso opposto della regola tariffa: lì il prezzo genera il tempo pagato, qui le ore **realmente timbrate** generano il prezzo da chiedere. `prezzoDaTempoEffettivo(articoloId, clienteId)` e `scostamentiPrezzoCliente(clienteId)` in `domain/scheduling.js` (puri, 26 test in scratchpad/test_prezzo_consuntivo.js). Base = somma min/pz delle **sole fasi con fonte 'storico'** (il template è stima, non consuntivo: finisce in `fasiSenzaStorico` e viene dichiarato), × `tariffa_cliente`. `nCommesse` = **minimo** tra le fasi (la fase col campione più magro decide la fiducia); `debole` = una sola commessa.
  - **Dove**: (a) modal commessa, box `#prezzo-da-consuntivo` sotto il campo prezzo — `da consuntivo: € X (Yh × Z €/h · N commesse) · ±S%` + bottone "usa", **mai automatico** come tutto il resto; (b) Analisi clienti, sezione `entityTimeline` "Prezzi vs consuntivo" per cliente, articoli ordinati per **scarto assoluto** (i peggiori in cima nei DUE versi).
  - **Dato debole dichiarato** (decisione Nico): con 1 sola commessa il numero si mostra ma marcato giallo (`etl-debole` + ⚠). Oggi su Elcotec **tutti e 8** gli articoli con consuntivo hanno campione 1 — se si nascondessero sotto le 2 commesse non si vedrebbe niente.
  - **In sospeso**: la commessa `2026/OC/00000` (numero segnaposto in mezzo a OC reali 00329…00361, articolo EL50612MEBE015K3GI10080) — Nico ha allineato i minuti (erano 1873 contro i 1859 della regola: prezzo inserito DOPO la creazione, quindi minuti presi dal default articolo — comportamento corretto, non un bug). Resta da chiarire **se è una riga di prova**: è l'unico prezzo di quell'articolo (quindi ne è il listino) ed è 'spedita', quindi pesa nel €/h Elcotec. Se va cancellata serve SQL dal pannello (l'account kiosk non può DELETE).
  - **Scoperta sui dati** (28 lug): Elcotec NON è sottoprezzata in blocco. 4 articoli sopra e 4 sotto, scarto pesato complessivo solo **+13%**, ma dispersione da **−67% a +184%**. Il problema è la dispersione per articolo, non il livello: il ×1,45 medio la nascondeva. Da rivedere quando i campioni saranno ≥2.

### 3. Accorpamento commesse (gruppi) — da collaudare
- Admin: Ordini cliente (ex Pianificazione, rinominata 14 lug — id interno resta `pianificazione`) → `⊞ Raggruppa` → selezione → Crea gruppo; badge `⊞N`, click per sciogliere. Kiosk: gruppo = UNA card (banner), split del timbro alla chiusura **proporzionale al peso = qtà × min/pz** (5+2+7 → 500/200/700, 18 test). Insert+update, mai delete (RLS: l'account kiosk NON può cancellare).
- Manca: conferma migrazione + prova sul campo. Limiti v1: "fine fase" non propaga al gruppo; fase_id null sulle copie.

### 4. Gantt — restano C ed E delle proposte
- FATTO (A+B+D): ritardi ancorati a oggi (barra rossa `⚠ RIT. Ng`), barre = QUOTA operatore coi SUOI timbri, fornitori dichiarati (etichetta `⚙ nome` sulla barra + badge nel modal), legenda nuova in alto, buchi su ferie/festivi.
- IN CANNA: C = dieta chips stati (→ "Aperte/Tutte"?), E = riga REPARTO in cima (capacità vs carico totale). Decidere con Nico.

### 5. Prospettiva "tutta l'azienda su questo gestionale" (domanda di Nico, 12 lug)
- Risposta data: Supabase regge (volumi minuscoli); fatturazione FUORI (integrare servizio dedicato); il salto è di SICUREZZA: **repo PUBBLICO con anon key + password kiosk in core/db.js** (verificato leggibile da chiunque) → repo privato + rotazione password; RPC per scritture critiche; backup. Nessuna azione ora, ma il repo pubblico è il primo punto quando si concretizza.

## Codifica articoli — scheda generatore codici 20 caratteri (15 lug, `2026-07-15.1`)
- Dai documenti di Matteo (piano dei conti scansionato + 12 tabelle): codice = **5** classificazione (1 famiglia + 2 categoria + 2 caratteristiche) + **4** sigla produttore + **11** codice produttore con **zeri PRIMA** (padStart — decisione Nico). Voci cancellate in rosso NON trascritte; appunti a mano trascritti e marcati ✎.
- Dati in `domain/codifica.js` (NUOVO file, caricato da index+kiosk): `TABELLE_CODIFICA` (tab 1-8, 11, 12 — le 9/10 sono descrittive, fuori), `PIANO_CODIFICA` (75 gruppi, 462 voci), `codificaComponi` (composizione+validazioni), `codificaVerificaDati` (sanity). Test in scratchpad/test_codifica.js (10 test).
- UI: tab **Codifica** in Gestione (dopo Articoli), `renderCodifica`: gruppo → voce → select per tabella (o input libero per schemi non 2+2, es. famiglia 3) → produttore → codice → 20 caratteri con blocchi colorati + Copia. I codici generati sono A SÉ STANTI (materiali interni/acquisto/conto lavoro), NON legati all'anagrafica articoli (solo prodotti finiti Cablotec) — collegamento = punto futuro.
- **Anagrafica produttori**: tabella `produttori` (migrazione DA ESEGUIRE, vedi sezione migrazioni) con mini-gestione inline (aggiungi/elimina); senza tabella il campo è un input libero a 4 caratteri. Multi-marca (filo/fusibili/dadi): sigla neutra (es. 0000).
- **Ambiguità dei fogli da chiarire con Matteo** (note ⚠ visibili nella scheda): 2.71 `5+0` (dattiloscritto "sonde" vs appunto "ciabatta M8/M12"); 2.65 appunti `9 contagiri / 10 switch ethernet`; famiglia 3 (schema progressivo, lasciato libero); 8.03 "pressacavi passo gas" (barrato a metà); 8.21 TUBI (solo appunto a mano).

## UI Ordini cliente (14 lug, `.7` — richiesta Nico)
- Tab "Pianificazione" → **"Ordini cliente"** (id interno invariato: `pianificazione`).
- **Ordine per intero**: numero OC sottolineato-punteggiato in tabella → `openOrdineClienteModal` (posizioni con €/pz, totale riga, totale ordine, posizioni senza prezzo dichiarate; click riga → apre la commessa). Il click sul resto della riga apre la singola commessa come prima.
- **Margine live nel modal commessa**: sotto "Totale riga", `− fornitori ≈ € X → margine ≈ € Y (Z%)` (`aggiornaMargineRiga`, stessa stima ore×tariffa della riga fornitore; fornitori senza tariffa dichiarati, mai ignorati). Unica voce di costo per ora: fornitori.

## UI Articoli (14 lug, `.5` — richiesta Nico)
- Tab Articoli PRIMA in Gestione. Tabella senza colonna Azioni: click sulla riga apre la scheda; Elimina vive nel footer della scheda (a sinistra, chiude solo a eliminazione avvenuta — `deleteArticolo` ora ritorna bool). Scheda a sezioni (`── Tempo pagato e fasi ──`, `── Listino ──`, `── Note ──`), hint accorciati, codice+categoria+stato su una riga.

## Esterni IN SEDE — flag `utenti.esterno` ridefinito (28 lug, `2026-07-28.2`)
- **Il problema**: Nico ha inserito 4 persone di ditte terze che vengono a lavorare in sede (TECNOCAB 1/2, SINTEC 1/2) come `esterno=true` e non le vedeva al kiosk. Non era un errore suo: `kioskRenderId` escludeva gli esterni **apposta**.
- **Perché**: `esterno` nasceva come "terzista che lavora FUORI e non timbra". Quel ruolo è passato ai **fornitori sulla commessa** (7 aziende, 122 righe `operazioni_fornitori`) → il ramo era **morto**: 0 utenti esterni, 0 timbri, 0 assegnazioni prima del 28 lug.
- **Decisione (Nico)**: il flag NON si pota, si **ridefinisce** → "persona di un'altra ditta che lavora IN SEDE e timbra al kiosk". Scartata l'ipotesi di farli interni normali: violerebbe *esterne dichiarate, mai nascoste* e mescolerebbe le loro ore con la manodopera Cablotec proprio dentro la macchina dei prezzi.
- NB: Tecnocab e SINTEC esistono **anche** come fornitori (19 e 6 commesse). **Non è un doppione**: sono due rapporti veri con la stessa ditta — lavoro mandato fuori (fornitore) e loro persone che lavorano qui (utenti). Il modello ora sa esprimerli entrambi.
- **Cosa cambia**: kiosk → gli esterni compaiono, in **sezioni finali per ditta** (o "Esterni in sede" senza `azienda_id`); Gantt Live e Calendario mese → **inclusi** (occupano capacità, si pianificano), sempre marcati ✦/giallo; **Riepilogo assenze → esclusi DI PROPOSITO** (ferie e monte ore sono col loro datore, non con Cablotec). Scheda utente: etichetta "Esterno in sede (timbra qui)" + campo **Ditta di provenienza** (elenco = fornitori; si azzera se torna interno).
- **Da fare**: migrazione `utenti.azienda_id` + assegnare la ditta ai 4. **Quando se ne vanno: `attivo=false`, MAI rimettere `esterno`** — i timbri devono restare nello storico.
- **Aperto**: le loro ore entrano nelle medie effettive come tutte le altre. Per la **durata** di un articolo è corretto (il tempo è tempo); per i numeri di **costo/efficienza** (reale/pagato, €/h) andrebbe deciso se separarle. Non toccato: sono numeri visibili, serve una decisione di Nico.

## Sospesi tecnici (invariati)
- **Step 1b**: timbri di mobile.html con `sb.from()` nudo → avvolgere in `eseguiConRetry`. Il più importante dei sospesi (protegge i timbri).
- De-dup helper mobile/prelievo (`core/util.js`), `domain/formato.js` mai estratto.
- Togliere fallback `?kiosk` quando postazioni confermate su kiosk.html.
- Colonne `lead_giorni` inerti su aziende/operazioni_fornitori (DROP mai fatto).
- Potatura CSS/rami morti. Cancellare `beta/` e `index-vecchio.html` dal repo GitHub (non presenti nella checkout locale).

## Decisioni consolidate (mantenere)
- **Regole per-cliente = DATI d'anagrafica azienda, mai hardcode** (14 lug): `tariffa_cliente` (€/h) su aziende = "il prezzo riga è solo manodopera" → nei NUOVI ordini (griglia) il tempo pagato esce dal prezzo (`min/pz = prezzo ÷ tariffa × 60`, arrotondato al minuto intero; toast dichiara quante posizioni). Elcotec = 27,3 €/h (impostata in scheda azienda). In MODIFICA la regola NON è mai automatica: suggerimento `da prezzo: N min/pz` + bottone "usa" sotto il campo minuti (`aggiornaSuggDaPrezzo`, `.6`) — per gli ordini nati prima della regola. Il "posto ordinato" delle regole ad hoc è la scheda azienda + questa sezione.
- **Griglia nuovo ordine: colonna Min/pz** (15 lug, `.2` — richiesta Nico) con **priorità a 3 livelli**: 1) minuti digitati a mano vincono su tutto → 2) regola tariffa cliente (da prezzo) → 3) default articolo. Il placeholder della casella mostra LIVE il valore automatico che verrà usato se resta vuota (si aggiorna su prezzo/articolo/cliente via `aggiornaMinHint`); tooltip dichiara la fonte. Niente di silenzioso: la regola propone, la mano decide.
- **Semina minuti in anagrafica dalla griglia** (15 lug, `.3`): alla creazione dell'ordine, i minuti pagati salvati (mano o regola) vengono scritti anche su `articoli.minuti_unitari` SOLO se lì mancano — copre i codici creati al volo. Stesso pattern del modal commessa: si popola il vuoto, MAI si sovrascrive. Toast dichiara quanti articoli.
- **Fasi effettive = media storica VIVA** (spedite+completate, finestra ULTIME 5 per articolo+tipo — `MEDIA_ULTIME_COMMESSE`), template solo fallback senza storico. Modal commessa: fasi SOLA LETTURA dall'anagrafica (matita ✎ apre l'articolo con ritorno), riallineate al salvataggio (mai cancellazioni). Anagrafica: righe auto-compilate dalle effettive.
- **Esterne dichiarate, mai nascoste**: `opCalcOreInterne` (stessa base di opCalcOre: opFasiPianif), confronti interno-vs-interno ovunque, fornitori "su tutta la commessa" col badge.
- **Listino/storico prezzi derivati** (mai tabelle), come le fasi. Ultimo prezzo, non media.
- Derivati live, mai materializzati. `domain/` puro. Prima di cancellare funzioni: cercare chiamanti anche in `onclick=""`.
- Tetto 1000 righe PostgREST: tabelle a crescita libera SEMPRE via `fetchTutte` (successo: 3 timbri persi silenziosamente il 7 lug).

## Strumenti della sessione (riusabili)
- **DB in lettura via API REST** con account kiosk (`kiosk@cablotec.local` / vedi core/db.js): per diagnosi su dati reali. curl con `--ssl-no-revoke` su questa macchina. L'account NON può DELETE (RLS) — per cancellazioni: SQL dal pannello (Nico).
- **Test Node a tavolino** in scratchpad: suite test_livella/finestra/fasi_eff/mero/interne/quote/stima/gruppo/listino — caricano domain/scheduling.js con stub. Rilanciarle dopo modifiche al domain.
- **Data realistica** nel modal commessa nuova: motore `livellaOperatore` + `stimaFineCommessaNuova` (coda addetti + ferie → fine in avanti). Fondamenta per Gantt livellato / autodistribuzione futuri.
