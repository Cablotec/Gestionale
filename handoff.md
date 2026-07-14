# Handoff — Gestionale Cablotec (aggiornato 13 lug 2026)

> Fonte per i fili aperti. CLAUDE.md è derivato da qui: se cambia questo, rigenerare quello.

## Contesto lampo
- **Cos'è**: ERP Cablotec. Backend **Supabase**, hosting **GitHub Pages**, script classici (niente ES module), scope globale condiviso. Deploy = git push.
- **Pubblicazione Pages**: workflow esplicito `.github/workflows/pages.yml` (Source = "GitHub Actions"). NON tornare a "Deploy from a branch" (pipeline legacy incastrata il 5-6 lug: build fermi ore, run non cancellabili). Deploy fallito → Actions → Re-run jobs o commit vuoto.
- **Struttura**: `index.html`/`kiosk.html` (gusci gemelli), `app.js` (~14k r) + `app.css`, `core/db.js` (Supabase condiviso + `fetchTutte` paginata), `domain/scheduling.js` (motore PURO, no DOM/Supabase), `mobile.html`/`prelievo.html` autonome.
- **Cache**: a ogni deploy bump `?v=YYYY-MM-DD.N` nei 4 gusci. Attuale: `v=2026-07-14.5`. La **versione è visibile sotto il logo** (gestionale e kiosk): prima cosa da controllare quando "non si vede una modifica" (quasi sempre è cache).
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
- `gruppo_id` su operazioni (accorpamento): **DA VERIFICARE** se eseguita — il codice è inerte senza; nessun collaudo sul campo ancora fatto.
- `tariffa_oraria` su aziende (traccia fornitori): **ESEGUITA** (14 lug).
- `tariffa_cliente` su aziende (regola prezzo→tempo pagato, es. Elcotec): **ESEGUITA** (14 lug, tariffa Elcotec impostata). NB: `operazioni.minuti_unitari` è **INTEGER** → la regola arrotonda al minuto intero (scoperto sul campo: 131,87 rifiutato).

## ▶ Fili aperti (in ordine di priorità)

### 1. Nuovo ordine — grana estetica residua (NON cancellare la feature)
- "+ Nuovo ordine" è l'UNICA porta d'inserimento (griglia: intestazione cliente+OC, 5 righe pos/articolo/OP/rif/qtà/€pz/scadenza, POS auto 0010/0020…, aggiungi-N, autocomplete con creazione al volo, prezzo dal listino, fasi auto). **Funziona.** Il vecchio modal resta per MODIFICARE (click sulla riga).
- MA Nico vede ancora un disallineamento che lo disturba (ultimo messaggio: "vabè lasceremo perdere… troppo complicato?"). Stato tecnico: griglia unica header+righe → colonne misurate a **delta 0**; intestazione cliente/OC allineata al pixel in pagina di test (121→153 entrambi). Se lo rivede sulla `.8`: riprendere col metodo misura-nel-browser ma sulla **pagina reale loggata** (la test page potrebbe non replicare tutto il contesto del modal). Da riprendere con calma, con suo screenshot segnato.

### 2. Prezzi — step 3 (dopo step 1+2 FATTI)
- FATTO: `prezzo_unitario` sulla riga + **listino vivo** (`prezzoListino`: ultimo prezzo per articolo+cliente, per created_at, ripiego altro cliente) + `storicoPrezziArticolo` (domain, 7 test) + griglia multi-riga + **sezione listino nell'anagrafica articolo** (13 lug, `.9`: blocco per cliente ordinato per data ultimo prezzo, drill-down andamento con `entityTimeline`, derivato e sola lettura — in `openArticoloModal`, tra Fasi e Note) + **€/ora per cliente** in Analisi clienti (14 lug, `2026-07-14.1`: `analisiClienti()` ritorna `euroOra`/`ricavo`/`nConPrezzo`, ricavo ÷ ore timbrate SOLO su commesse con prezzo — stesso sottoinsieme sopra e sotto la frazione; copertura dichiarata in card quando non tutte hanno prezzo; 9 test in scratchpad/test_eurora.js). NB: `prezzo_unitario` è nuovo (13 lug) → all'inizio quasi tutte le chiuse sono senza prezzo, €/h comparirà man mano.
- Traccia **fornitori** FATTA lato codice (14 lug, `.2`): campo "Tariffa oraria (€/h)" in scheda azienda (visibile solo se fornitore, si accende solo a colonna presente) + nel modal commessa, riga fornitore, "prezzo suggerito ≈ € X (Yh × Z €/h)" live — ore = somma min/pz delle SUE fasi (nessuna chip = tutta la commessa; senza fasi = budget pagato) × qtà corrente; si aggiorna su chip/qtà/minuti via `aggiornaSuggFornitori`. Nulla viene salvato: solo suggerimento. **Manca la migrazione** (vedi sezione migrazioni) e il collaudo con una tariffa vera.
- Analisi fatta sui dati: % ripartizione per cliente NON predittiva (±35 punti); il numero d'oro è **reale/pagato per cliente** (Elcotec ×1,45 = sottoprezzato; Sacmi ×0,69). Già in scheda Analisi clienti.

### 3. Accorpamento commesse (gruppi) — da collaudare
- Admin: Pianificazione → `⊞ Raggruppa` → selezione → Crea gruppo; badge `⊞N`, click per sciogliere. Kiosk: gruppo = UNA card (banner), split del timbro alla chiusura **proporzionale al peso = qtà × min/pz** (5+2+7 → 500/200/700, 18 test). Insert+update, mai delete (RLS: l'account kiosk NON può cancellare).
- Manca: conferma migrazione + prova sul campo. Limiti v1: "fine fase" non propaga al gruppo; fase_id null sulle copie.

### 4. Gantt — restano C ed E delle proposte
- FATTO (A+B+D): ritardi ancorati a oggi (barra rossa `⚠ RIT. Ng`), barre = QUOTA operatore coi SUOI timbri, fornitori dichiarati (etichetta `⚙ nome` sulla barra + badge nel modal), legenda nuova in alto, buchi su ferie/festivi.
- IN CANNA: C = dieta chips stati (→ "Aperte/Tutte"?), E = riga REPARTO in cima (capacità vs carico totale). Decidere con Nico.

### 5. Prospettiva "tutta l'azienda su questo gestionale" (domanda di Nico, 12 lug)
- Risposta data: Supabase regge (volumi minuscoli); fatturazione FUORI (integrare servizio dedicato); il salto è di SICUREZZA: **repo PUBBLICO con anon key + password kiosk in core/db.js** (verificato leggibile da chiunque) → repo privato + rotazione password; RPC per scritture critiche; backup. Nessuna azione ora, ma il repo pubblico è il primo punto quando si concretizza.

## UI Articoli (14 lug, `.5` — richiesta Nico)
- Tab Articoli PRIMA in Gestione. Tabella senza colonna Azioni: click sulla riga apre la scheda; Elimina vive nel footer della scheda (a sinistra, chiude solo a eliminazione avvenuta — `deleteArticolo` ora ritorna bool). Scheda a sezioni (`── Tempo pagato e fasi ──`, `── Listino ──`, `── Note ──`), hint accorciati, codice+categoria+stato su una riga.

## Sospesi tecnici (invariati)
- **Step 1b**: timbri di mobile.html con `sb.from()` nudo → avvolgere in `eseguiConRetry`. Il più importante dei sospesi (protegge i timbri).
- De-dup helper mobile/prelievo (`core/util.js`), `domain/formato.js` mai estratto.
- Togliere fallback `?kiosk` quando postazioni confermate su kiosk.html.
- Colonne `lead_giorni` inerti su aziende/operazioni_fornitori (DROP mai fatto).
- Potatura CSS/rami morti. Cancellare `beta/` e `index-vecchio.html` dal repo GitHub (non presenti nella checkout locale).

## Decisioni consolidate (mantenere)
- **Regole per-cliente = DATI d'anagrafica azienda, mai hardcode** (14 lug): `tariffa_cliente` (€/h) su aziende = "il prezzo riga è solo manodopera" → nei NUOVI ordini (griglia) il tempo pagato esce dal prezzo (`min/pz = prezzo ÷ tariffa × 60`, vince sul default articolo; senza prezzo resta il default; toast dichiara quante posizioni). Elcotec = 27,3 €/h (la mette Nico in scheda azienda dopo la migrazione). Il "posto ordinato" delle regole ad hoc è la scheda azienda + questa sezione.
- **Fasi effettive = media storica VIVA** (spedite+completate, finestra ULTIME 5 per articolo+tipo — `MEDIA_ULTIME_COMMESSE`), template solo fallback senza storico. Modal commessa: fasi SOLA LETTURA dall'anagrafica (matita ✎ apre l'articolo con ritorno), riallineate al salvataggio (mai cancellazioni). Anagrafica: righe auto-compilate dalle effettive.
- **Esterne dichiarate, mai nascoste**: `opCalcOreInterne` (stessa base di opCalcOre: opFasiPianif), confronti interno-vs-interno ovunque, fornitori "su tutta la commessa" col badge.
- **Listino/storico prezzi derivati** (mai tabelle), come le fasi. Ultimo prezzo, non media.
- Derivati live, mai materializzati. `domain/` puro. Prima di cancellare funzioni: cercare chiamanti anche in `onclick=""`.
- Tetto 1000 righe PostgREST: tabelle a crescita libera SEMPRE via `fetchTutte` (successo: 3 timbri persi silenziosamente il 7 lug).

## Strumenti della sessione (riusabili)
- **DB in lettura via API REST** con account kiosk (`kiosk@cablotec.local` / vedi core/db.js): per diagnosi su dati reali. curl con `--ssl-no-revoke` su questa macchina. L'account NON può DELETE (RLS) — per cancellazioni: SQL dal pannello (Nico).
- **Test Node a tavolino** in scratchpad: suite test_livella/finestra/fasi_eff/mero/interne/quote/stima/gruppo/listino — caricano domain/scheduling.js con stub. Rilanciarle dopo modifiche al domain.
- **Data realistica** nel modal commessa nuova: motore `livellaOperatore` + `stimaFineCommessaNuova` (coda addetti + ferie → fine in avanti). Fondamenta per Gantt livellato / autodistribuzione futuri.
