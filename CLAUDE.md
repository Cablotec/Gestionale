# CLAUDE.md — Gestionale Cablotec

> Derivato da `handoff.md` (fonte per i fili aperti: aggiornare lì e rigenerare qui).

## Contesto lampo
- **Cos'è**: ERP Cablotec. Backend **Supabase**, hosting **GitHub Pages** (deploy = git push, nessun build tool, **script classici — niente ES module**, scope globale condiviso).
- **Pubblicazione Pages**: workflow esplicito `.github/workflows/pages.yml` (Source = "GitHub Actions"). NON tornare a "Deploy from a branch" (pipeline legacy incastrata il 5-6 lug 2026). Deploy fallito → Actions → Re-run jobs o commit vuoto.
- **Struttura**: `index.html`/`kiosk.html` (gusci gemelli), `app.js` (~14k r) + `app.css`, `core/db.js` (Supabase condiviso + `fetchTutte` paginata oltre il tetto 1000 righe), `domain/scheduling.js` (motore PURO: no DOM, no Supabase), `mobile.html`/`prelievo.html` autonome.
- **Cache**: a ogni deploy bump `?v=YYYY-MM-DD.N` nei 4 gusci. Attuale: `v=2026-07-14.1`. **Versione visibile sotto il logo** (gestionale e kiosk): prima verifica quando "non si vede una modifica".
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
- `operazioni.gruppo_id` (accorpamento): **DA VERIFICARE** — codice inerte senza; collaudo sul campo mai fatto.

## ▶ Fili aperti (priorità)
1. **Nuovo ordine — grana estetica residua** (NON cancellare la feature): "+ Nuovo ordine" è l'unica porta d'inserimento (griglia 5 righe, POS auto, aggiungi-N, autocomplete con creazione al volo, prezzo dal listino, fasi auto; il vecchio modal resta per MODIFICARE). Funziona, ma Nico vede ancora un disallineamento ("lasceremo perdere… troppo complicato?"). Tecnicamente: colonne a delta 0 misurato, intestazione allineata al pixel in pagina di test. Se lo rivede sulla `.8`: misurare sulla **pagina reale loggata**, con suo screenshot segnato.
2. **Prezzi step 3**: sezione listino nell'anagrafica articolo **FATTA** (13 lug) + **€/ora per cliente FATTO** (14 lug, solo commesse con prezzo, copertura dichiarata) → resta traccia fornitori (tariffa €/h → prezzo fase suggerito). Dati: % per cliente NON predittive (±35); il numero d'oro è **reale/pagato per cliente** (Elcotec ×1,45).
3. **Accorpamento commesse**: collaudare (vedi migrazione). Limiti v1: "fine fase" non propaga al gruppo; fase_id null sulle copie.
4. **Gantt**: fatti A+B+D (ritardi ancorati a oggi `⚠ RIT. Ng`, barre = quota operatore coi suoi timbri, fornitori dichiarati, legenda in alto, buchi su ferie). Restano **C** (dieta chips stati) ed **E** (riga REPARTO).
5. **Prospettiva "tutta l'azienda"**: Supabase regge; fatturazione fuori; il salto è SICUREZZA — **repo PUBBLICO con anon key + password kiosk in core/db.js** → privatizzare + ruotare, RPC, backup. Nessuna azione ora.

## Sospesi tecnici
- **Step 1b** (il più importante): timbri di mobile.html con `sb.from()` nudo → `eseguiConRetry`.
- De-dup helper mobile/prelievo (`core/util.js`); `domain/formato.js` mai estratto.
- Fallback `?kiosk` da togliere; colonne `lead_giorni` inerti; potatura CSS/rami morti; cancellare `beta/` e `index-vecchio.html` dal repo GitHub.

## Decisioni consolidate (mantenere)
- **Fasi effettive = media storica VIVA** (spedite+completate, finestra **ULTIME 5** per articolo+tipo — `MEDIA_ULTIME_COMMESSE` in domain), template solo fallback senza storico. Modal commessa: fasi **SOLA LETTURA** dall'anagrafica (matita ✎ apre l'articolo con ritorno via `opts.dopoChiusura`), riallineate al salvataggio (aggiorna/aggiunge, MAI cancella). Anagrafica articolo: righe auto-compilate dalle effettive. Toggle sequenza/parallelo rimosso (motore sempre sequenziale).
- **Esterne dichiarate, mai nascoste**: `opCalcOreInterne` (stessa base di `opCalcOre`: `opFasiPianif`), confronti interno-vs-interno ovunque; fornitore "su tutta la commessa" = badge dedicato; `⚙ nome` sulle barre Gantt.
- **Listino/storico prezzi derivati** (mai tabelle): `prezzoListino` = ultimo prezzo per articolo+cliente (created_at, ripiego altro cliente), non media. `storicoPrezziArticolo` per l'andamento.
- **Accorpamento**: split del timbro proporzionale al peso = qtà × min/pz (`ripartisciTimbroGruppo` + `commesseGruppoLavorabili`, 18 test); insert+update, mai delete (RLS kiosk non può cancellare).
- Derivati **live**, mai materializzati. `domain/` resta PURO. Prima di cancellare funzioni: cercare chiamanti anche in `onclick=""`. Tabelle a crescita libera SEMPRE via `fetchTutte`.
- Il controllo economico è il **tempo pagato** (mai auto-aggiornato). Kiosk "Riprendi" = ultime timbrate non finite in cima.

## Strumenti riusabili
- **DB in lettura** via REST con account kiosk (credenziali in core/db.js) — diagnosi su dati reali; curl con `--ssl-no-revoke`; l'account NON può DELETE → cancellazioni via SQL dal pannello (Nico).
- **Suite test Node** in scratchpad (test_livella/finestra/fasi_eff/mero/interne/quote/stima/gruppo/listino): stub + eval di domain/scheduling.js. Rilanciare dopo modifiche al domain.
- **Data realistica** nel modal commessa nuova (`livellaOperatore` + `stimaFineCommessaNuova`): fondamenta per Gantt livellato/autodistribuzione futuri.
