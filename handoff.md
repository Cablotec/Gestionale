# Handoff — Gestionale Cablotec (aggiornato 28 lug 2026)

> Fonte per i fili aperti. CLAUDE.md è derivato da qui: se cambia questo, rigenerare quello.

## Contesto lampo
- **Cos'è**: ERP Cablotec. Backend **Supabase**, hosting **GitHub Pages**, script classici (niente ES module), scope globale condiviso. Deploy = git push.
- **Pubblicazione Pages**: workflow esplicito `.github/workflows/pages.yml` (Source = "GitHub Actions"). NON tornare a "Deploy from a branch" (pipeline legacy incastrata il 5-6 lug: build fermi ore, run non cancellabili). Deploy fallito → Actions → Re-run jobs o commit vuoto.
- **Struttura**: `index.html`/`kiosk.html` (gusci gemelli), `app.js` (~14k r) + `app.css`, `core/db.js` (Supabase condiviso + `fetchTutte` paginata), `domain/scheduling.js` (motore PURO, no DOM/Supabase), `mobile.html`/`prelievo.html` autonome.
- **Cache**: a ogni deploy bump `?v=YYYY-MM-DD.N` nei 4 gusci. Attuale: `v=2026-07-31.3`. La **versione è visibile sotto il logo** (gestionale e kiosk): prima cosa da controllare quando "non si vede una modifica" (quasi sempre è cache).
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
- `azienda_id` su utenti (ditta degli esterni in sede): **ESEGUITA** (28 lug, verificata a DB). I 4 esterni hanno già la ditta collegata: SINTEC 1/2 → SINTEC DI SINANI QERIM, TECNOCAB 1/2 → Tecnocab SNC. Al kiosk compaiono in due sezioni finali coi nomi delle ditte.
- Tabella `ore_esterne` (consuntivo ore fornitori dichiarate): **ESEGUITA** (28 lug, verificata via REST: esiste, vuota). SQL usata:
  ```sql
  CREATE TABLE ore_esterne (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    operazione_id uuid NOT NULL REFERENCES operazioni(id) ON DELETE CASCADE,
    azienda_id uuid NOT NULL REFERENCES aziende(id),
    fase_id uuid REFERENCES operazioni_fasi(id) ON DELETE SET NULL,
    ore numeric NOT NULL CHECK (ore > 0),
    tariffa numeric,
    data date,
    riferimento text,
    note text,
    created_at timestamptz DEFAULT now()
  );
  ALTER TABLE ore_esterne ENABLE ROW LEVEL SECURITY;
  CREATE POLICY ore_esterne_all ON ore_esterne FOR ALL TO authenticated USING (true) WITH CHECK (true);
  CREATE INDEX ore_esterne_op ON ore_esterne (operazione_id);
  ```
- Tabella `produttori` (scheda Codifica): **ESEGUITA** (28 lug, verificata via REST: lettura OK, cache PostgREST aggiornata, anagrafica ATTIVA). Tabella vuota, da popolare.
- Tabella `mancanti` (fabbisogno materiale): **ESEGUITA** (31 lug, verificata via REST: lettura, insert e delete OK). Primo import fatto: 314 codici, 33 commesse agganciate. SQL usata:
  ```sql
  CREATE TABLE mancanti (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    numero_op text NOT NULL,
    codice text NOT NULL,
    descrizione text,
    qta_da_ordinare numeric,
    qta_richiesta numeric,
    giacenza numeric,
    um text,
    data_arrivo date,
    fornitore text,
    import_data date,
    created_at timestamptz DEFAULT now()
  );
  ALTER TABLE mancanti ENABLE ROW LEVEL SECURITY;
  CREATE POLICY mancanti_all ON mancanti FOR ALL TO authenticated USING (true) WITH CHECK (true);
  CREATE INDEX mancanti_op ON mancanti (numero_op);
  ```

## Fabbisogno — materiale mancante agganciato alle commesse (31 lug, `2026-07-31.1`)
- **Richiesta Nico**: agganciare i mancanti dell'estrazione "Fabbisogno Massivo" agli ordini, per vederli quando la preparazione materiale è parziale.
- **La chiave è il numero OP**: colonna `OdL Prossimo Impegno` dell'estrazione (`2026OP1727`) → `numero_op` del gestionale (`2026/OP/01727`), via `odlANumeroOp` in domain. Sul file del 28 lug: 364 righe, **317 mancanti** (`Qta da ord` > 0), 42 OdL distinti, **39 agganciano** una commessa.
- **Aggancio per CHIAVE SCRITTA, non per FK**: le righe di OdL che nel gestionale non esistono (erano 3: 2026OP1830/1458/1797) si salvano lo stesso e si agganciano **da sole** se quelle commesse verranno inserite, senza reimportare.
- **Ogni import SOSTITUISCE il precedente** (delete + insert a blocchi da 500): un fabbisogno è una fotografia, accumularlo mostrerebbe come mancanti codici già arrivati. La data dell'estrazione resta scritta (`import_data`) e visibile ovunque.
- **Scheda Gestione → Fabbisogno**: file picker, anteprima (quanti codici, quante commesse agganciate, quali OP orfani, quante righe si sostituiscono) e conferma esplicita. Le colonne si cercano **per NOME e non per posizione** (`FABB_COLONNE`), così se il gestionale di magazzino sposta una colonna l'import regge; il foglio giusto è quello che ha "Codice" + "Qta da ord", non si va per nome del foglio.
- **La libreria xlsx (SheetJS) si carica da CDN SOLO all'apertura della scheda** (`caricaXLSX`, ~1 MB): non deve pesare sull'avvio del gestionale. Secondo CDN dopo quello di Supabase.
- **Dove si vedono**: (a) modal commessa, sotto "Preparazione materiale", elenco `entityTimeline` **sempre** se ci sono mancanti; (b) badge `⚠N` nella colonna prep. della lista Ordini cliente. **Incoerenza dichiarata** (decisione Nico): se la tendina dice "completo" ma il fabbisogno riporta mancanti, la contraddizione si vede in rosso invece di restare nascosta.
- **Dato inutile scoperto sui dati**: la colonna "Data Prossima Previsione Entrata" è compilata su **2 righe su 317** (se manca ed è da ordinare, una data d'arrivo non c'è ancora). Importata ma non ci si costruisce niente sopra.
- 19 test in scratchpad/test_mancanti.js.

### Mancanti v2 — sotto scorta, consegne e ritardi (31 lug, `2026-07-31.3`, idee di Nico)
- **Migrazione aggiuntiva** (DA ESEGUIRE): `ALTER TABLE mancanti ADD COLUMN impegno numeric; ADD COLUMN consegne jsonb; ADD COLUMN prima_consegna date;` — dopo va **rifatto l'import**, il vecchio archivio non ha le consegne.
- **Scoperta che ha ribaltato il disegno**: l'import teneva solo `Qta da ord > 0` (317 righe) — ma **quelle righe non hanno quasi mai una data** (2 su 317). Le date ce l'hanno solo le righe **già ordinate** (47 su 47), che venivano **scartate**. La vista "prossime consegne" chiesta da Nico era quindi impossibile: stavo buttando via esattamente la metà utile del file.
- **Nuova definizione**: si importa tutto ciò che è **sotto scorta** (`giacenza < impegno`) o da ordinare → 364 righe. Due categorie, sempre distinte:
  - **DA ORDINARE** (317): nessuno l'ha comprato → **ferma la commessa**, nessuna data.
  - **IN ARRIVO** (47): già ordinato, con consegna prevista.
- **Fino a 5 previsioni di entrata per riga** (`FABB_CONSEGNE`, colonne "Prossima" + "2..5"), salvate in `consegne` jsonb con qta/data/ordine fornitore/fornitore. Sul file del 31 lug: 51 consegne, **35 future e 16 GIÀ IN RITARDO**.
- **I 16 ritardi sono il dato più utile dell'intero file** e prima non si vedevano da nessuna parte: roba attesa il 05/05, il 09/06, mai arrivata. Blocco rosso in cima alla scheda.
- **Scheda rinominata "Mancanti"** (era "Fabbisogno"): il file si chiama così nel gestionale di magazzino, ma quello che si guarda sono i mancanti — e "mancanti" è la parola che usa Nico (regola: una dicitura sola, sempre quella).
- **Contenuto scheda**: ritardi (rosso) → prossime consegne (5) → tabella completa filtrabile per commessa e per tipo, con link diretto alla commessa. Bloccanti sempre in cima.
- **Triangolo a due numeri** `⚠7/67`: bloccanti su totale. **Rosso se c'è almeno un bloccante, giallo se è tutto in arrivo** — distingue una commessa ferma da una che parte, cosa che il numero unico non diceva. Tooltip con i primi 8 codici bloccanti + "e altri N" (con 67 righe un tooltip intero è illeggibile), prossima consegna e ritardi. **Clic → scheda Mancanti già filtrata** su quella commessa (`apriMancantiFiltrati`).
- Nel modal commessa il sommario dice per primo quanti **fermano** la commessa; ⛔ bloccante, 📦 in arrivo con la data (in rosso se scaduta).
- **Verificato facendo girare il codice di import VERO sull'Excel vero**: 364 righe, 317+47, 361 agganciabili, 51 consegne, 35 future / 16 in ritardo. 25 test in scratchpad/test_mancanti2.js.

## ▶ Fili aperti (in ordine di priorità)

### 1. Nuovo ordine — grana estetica residua (NON cancellare la feature)
- "+ Nuovo ordine" è l'UNICA porta d'inserimento (griglia: intestazione cliente+OC, 5 righe pos/articolo/OP/rif/qtà/€pz/scadenza, POS auto 0010/0020…, aggiungi-N, autocomplete con creazione al volo, prezzo dal listino, fasi auto). **Funziona.** Il vecchio modal resta per MODIFICARE (click sulla riga).
- MA Nico vede ancora un disallineamento che lo disturba (ultimo messaggio: "vabè lasceremo perdere… troppo complicato?"). Stato tecnico: griglia unica header+righe → colonne misurate a **delta 0**; intestazione cliente/OC allineata al pixel in pagina di test (121→153 entrambi). Se lo rivede sulla `.8`: riprendere col metodo misura-nel-browser ma sulla **pagina reale loggata** (la test page potrebbe non replicare tutto il contesto del modal). Da riprendere con calma, con suo screenshot segnato.

### 2. Prezzi — step 3 (dopo step 1+2 FATTI)
- FATTO: `prezzo_unitario` sulla riga + **listino vivo** (`prezzoListino`: ultimo prezzo per articolo+cliente, per created_at, ripiego altro cliente) + `storicoPrezziArticolo` (domain, 7 test) + griglia multi-riga + **sezione listino nell'anagrafica articolo** (13 lug, `.9`: blocco per cliente ordinato per data ultimo prezzo, drill-down andamento con `entityTimeline`, derivato e sola lettura — in `openArticoloModal`, tra Fasi e Note) + **€/ora per cliente** in Analisi clienti (14 lug, `2026-07-14.1`: `analisiClienti()` ritorna `euroOra`/`ricavo`/`nConPrezzo`, ricavo ÷ ore timbrate SOLO su commesse con prezzo — stesso sottoinsieme sopra e sotto la frazione; copertura dichiarata in card quando non tutte hanno prezzo; 9 test in scratchpad/test_eurora.js). NB: `prezzo_unitario` è nuovo (13 lug) → all'inizio quasi tutte le chiuse sono senza prezzo, €/h comparirà man mano.
- Traccia **fornitori** FATTA lato codice (14 lug, `.2`): campo "Tariffa oraria (€/h)" in scheda azienda (visibile solo se fornitore, si accende solo a colonna presente) + nel modal commessa, riga fornitore, "prezzo suggerito ≈ € X (Yh × Z €/h)" live — ore = somma min/pz delle SUE fasi (nessuna chip = tutta la commessa; senza fasi = budget pagato) × qtà corrente; si aggiorna su chip/qtà/minuti via `aggiornaSuggFornitori`. Nulla viene salvato: solo suggerimento. Migrazione ESEGUITA; manca il collaudo con tariffe vere — dei 7 fornitori solo Simone Botturi ne ha una (18 EUR/h).
- Analisi fatta sui dati: % ripartizione per cliente NON predittiva (±35 punti); il numero d'oro è **reale/pagato per cliente** (Elcotec ×1,45 = sottoprezzato; Sacmi ×0,69). Già in scheda Analisi clienti.
- **Prezzo consigliato DAL CONSUNTIVO** (28 lug, `2026-07-28.1`, richiesta Nico) — il verso opposto della regola tariffa: lì il prezzo genera il tempo pagato, qui le ore **realmente timbrate** generano il prezzo da chiedere. `prezzoDaTempoEffettivo(articoloId, clienteId)` e `scostamentiPrezzoCliente(clienteId)` in `domain/scheduling.js` (puri, 26 test in scratchpad/test_prezzo_consuntivo.js). Base = somma min/pz delle **sole fasi con fonte 'storico'** (il template è stima, non consuntivo: finisce in `fasiSenzaStorico` e viene dichiarato), × `tariffa_cliente`. `nCommesse` = **minimo** tra le fasi (la fase col campione più magro decide la fiducia); `debole` = una sola commessa.
  - **Dove**: (a) modal commessa, box `#prezzo-da-consuntivo` sotto il campo prezzo — `da consuntivo: € X (Yh × Z €/h · N commesse) · ±S%` + bottone "usa", **mai automatico** come tutto il resto; (b) Analisi clienti, sezione `entityTimeline` "Prezzi vs consuntivo" per cliente, articoli ordinati per **scarto assoluto** (i peggiori in cima nei DUE versi).
  - **Dato debole dichiarato** (decisione Nico): con 1 sola commessa il numero si mostra ma marcato giallo (`etl-debole` + ⚠). Oggi su Elcotec **tutti e 8** gli articoli con consuntivo hanno campione 1 — se si nascondessero sotto le 2 commesse non si vedrebbe niente.
  - **In sospeso**: la commessa `2026/OC/00000` (numero segnaposto in mezzo a OC reali 00329…00361, articolo EL50612MEBE015K3GI10080) — Nico ha allineato i minuti (erano 1873 contro i 1859 della regola: prezzo inserito DOPO la creazione, quindi minuti presi dal default articolo — comportamento corretto, non un bug). Resta da chiarire **se è una riga di prova**: è l'unico prezzo di quell'articolo (quindi ne è il listino) ed è 'spedita', quindi pesa nel €/h Elcotec. Se va cancellata serve SQL dal pannello (l'account kiosk non può DELETE).
  - **Scoperta sui dati** (28 lug): Elcotec NON è sottoprezzata in blocco. 4 articoli sopra e 4 sotto, scarto pesato complessivo solo **+13%**, ma dispersione da **−67% a +184%**. Il problema è la dispersione per articolo, non il livello: il ×1,45 medio la nascondeva. Da rivedere quando i campioni saranno ≥2.

### 2-bis. ORE ESTERNE a consuntivo — la quadra sul lavoro di terzi (28 lug, `2026-07-28.5`)
- **Il nodo posto da Nico**: evitare che tre cose facciano lo stesso mestiere. La distinzione che lo scioglie: il **prezzo suggerito** sulla riga fornitore (ore stimate dai min/pz × tariffa) è un **PREVENTIVO**; le **ore timbrate dagli esterni in sede** e le **ore dichiarate dal fornitore su rapportino** sono **CONSUNTIVO**. Preventivo e consuntivo non si fondono e non si sommano — è la stessa frattura fra "tempo pagato" e "tempo timbrato" che regge tutto il resto.
- **Soluzione**: UNA sezione "── Ore esterne ──" con **due fonti sempre dichiarate**: `⏱ timbrate qui` e `📄 da rapportino`. Un posto solo dove guardare, due sorgenti che non possono confondersi.
- **Sta nella scheda CONSUNTIVO**, non in Lavorazione (28 lug, `.6` — segnalato da Nico: prima l'avevo messa accanto ai fornitori, sbagliato). Motivo strutturale, non estetico: Lavorazione = **previsto** (fasi, addetti, fornitori, stime), Consuntivo = **fatto**. E soprattutto la sezione è la **scomposizione PER DITTA** dello stesso monte ore che il "Riepilogo per fase" lì sopra spacca **per fase** → le due viste vanno adiacenti.
- **Riconciliazione obbligatoria** (scoperta grazie a quella domanda): `faseCalcOreReali` conta TUTTI i timbri, esterni compresi → le ore `⏱` sono **già dentro** il riepilogo per fase, le `📄` **no** (nessuno le ha timbrate). Senza dirlo, uno legge 12,59 h sopra e 12,59 h sotto e pensa che siano 25. La sezione ora chiude con: *"⏱ N h sono già dentro il riepilogo per fase qui sopra · 📄 M h non sono timbrate da nessuno: si sommano a quelle ore"*.
- **Fusione Lavorazione+Consuntivo: SCARTATA** (proposta di Nico, discussa). Motivi: (1) sono le due facce del confronto previsto-vs-fatto, che è il meccanismo economico centrale dell'app — fonderle non toglie la distinzione, la rende meno leggibile; (2) cicli di vita diversi — Lavorazione sono campi che si modificano, Consuntivo sono fatti già avvenuti: mescolarli invita modifiche accidentali; (3) `pCons` non esiste su una commessa nuova (`isNew`); (4) il confronto previsto-vs-fatto **è già dentro Consuntivo** (ore previste / consuntivate / avanzamento per fase), quindi la fusione non aggiungerebbe niente che non ci sia.
- `oreEsterneCommessa(operazioneId)` in `domain/scheduling.js` (puro, 25 test in scratchpad/test_ore_esterne.js) ritorna `{righe, oreTot, costoTot, senzaTariffa, conflitti}`.
- **Le timbrate sono DERIVATE** dai timbri chiusi degli utenti `esterno` con `azienda_id` (mai copiate in tabella: regola "derivati live, mai materializzati"), tariffa presa **live** dall'anagrafica. Un esterno **senza** `azienda_id` resta fuori: non si indovina a chi attribuirlo, si completa l'anagrafica.
- **Le dichiarate stanno in `ore_esterne`** con la **tariffa CONGELATA sulla riga** (decisione Nico): un costo già sostenuto è un fatto e non si riscrive quando l'anagrafica cambia — stesso principio di `prezzo_unitario`. Se la riga non ha tariffa si ripiega sull'anagrafica **dichiarandolo** (`tariffaDaAnagrafica`). Asimmetria accettata e voluta: timbrate = tariffa corrente (sono derivate), dichiarate = congelata.
- **Fatturazione a ore × tariffa** (confermato da Nico): la tabella registra ORE, il costo si calcola. Se un domani ci fosse un forfait per fase servirebbe un campo importo.
- **Rischio n.1 = doppio conteggio.** Le due fonti sono fisicamente disgiunte (lavoro fatto QUI vs DA LORO) ma è l'errore che si nasconderebbe meglio → le ditte presenti in **entrambe** le fonti finiscono in `conflitti` e la sezione lo dichiara in giallo. Non si somma in silenzio.
- **Ditta senza tariffa**: ore contate, costo no (mai gonfiato), ditta nominata sotto l'elenco.
- **Margine riga rifatto**: usa le ore VERE dove ci sono e la stima solo per le ditte che non ne hanno ancora, **ditta per ditta** (così non somma mai stima + consuntivo della stessa ditta). Dichiara la composizione: `− esterni ≈ € X → margine ≈ € Y (Z%) · ore vere € A + stima € B`. Il `≈` compare solo se c'è ancora una stima dentro.
- Solo le righe **dichiarate** si cancellano dalla sezione; le timbrate si correggono sui timbri, non lì.
- **Le ore esterne INCIDONO su totali e sfori** (28 lug, `.7`, segnalato da Nico) — `consuntivoCommessa(op)` in domain, 28 test in scratchpad/test_consuntivo.js.
  - **Verità di partenza**: le ore **timbrate** dagli esterni in sede incidevano **già** (sono `sessioni_lavoro`, e `opCalcOreReali` le contava). Su OC/00236 l'avanzamento del 32% comprende le 12,59 h di Tecnocab: senza sarebbe 14%. Nico non lo vedeva perché nessuna delle due commesse è in sforo e il costo è 0 (Tecnocab senza tariffa). Le **dichiarate** invece non incidevano su niente: quello era il buco vero.
  - **Difetto trovato**: il codice assumeva *"i timbri sono SOLO interni"* — vero finché gli esterni non timbravano. Con una fase affidata a un fornitore, il suo budget **usciva** da `opCalcOreInterne` ma le ore timbrate dai suoi uomini **entravano** in `opCalcOreReali` → **sforo falso**. Su OC/00236 non si vedeva solo perché le fasi non sono pianificabili e quindi l'esclusione non scattava: fortuna, non correttezza.
  - **Decisione Nico**: contare TUTTO nell'avanzamento (la differenza interno/esterno è di **costo**, non di **durata**) + riga "di cui esterne" sotto il totale.
  - **Regola della base** (documentata nel domain): *se conto ore esterne, riconto anche il budget esterno*. Nessuna ora esterna → base = previsto INTERNO (comportamento storico invariato); almeno una → base = previsto TOTALE, e l'etichetta cambia in "Ore previste (totali)" dichiarando il perché. Dove nessuna fase è esternalizzata i due valori coincidono e non cambia nulla.
  - **I totali si RIDISEGNANO** (28 lug, `.8` — segnalato da Nico: "ho messo 5 ore di Botturi e non ha spostato niente"). Aveva ragione: la riga si salvava (verificata a DB, tariffa 18 congelata) e la sezione si aggiornava, ma il blocco totali era costruito **una volta sola all'apertura del modal** → i numeri si muovevano solo salvando e riaprendo. Ora `renderTotali()` è una funzione ridisegnabile, esposta alla sezione via `aggiornaTotaliCons`, richiamata a ogni riga aggiunta o rimossa. Lezione: in questo modal i blocchi che dipendono da dati modificabili DENTRO il modal vanno resi ridisegnabili, non costruiti inline.
  - **Sessioni APERTE degli esterni** (`.8`): prima `oreEsterneCommessa` contava solo le chiuse, mentre `opCalcOreReali` conta anche le aperte → le ore di un esterno **ancora al lavoro** finivano nella quota INTERNA per differenza. Ora contano anche le aperte (stessa convenzione), la riga dichiara *"N ancora aperto, il totale sta salendo"*, e la scomposizione "di cui esterne" quadra sempre col totale.
  - **Guardia anti-NaN**: sessione con `inizio` mancante o illeggibile → 0 secondi, non `NaN`. Prima `new Date(undefined)` propagava NaN e faceva sparire un intero totale (scoperto perché ha rotto 10 test).
  - **Anche la BARRA ORE in intestazione** (`.9` — "la barra a colori in alto non sembra muoversi, è voluto?"). Non era voluto: aveva gli **stessi due difetti** (non includeva le ore da rapportino, non si ridisegnava). Il suo riferimento non è il previsto ma il **TEMPO PAGATO**, quindi `consuntivoCommessa` ora ritorna anche `pagato` / `percPagato` / `sforoPagato` con la **stessa regola**: se conto ore esterne, il pagato di confronto è quello INTERO e non la sola quota interna (altrimenti confronto il lavoro di tutti con la paga di una parte sola). La barra è diventata `renderSum()`, ridisegnata via `aggiornaBarraOre` insieme ai totali. Nell'etichetta compare `· di cui est. N` accanto alle ore.
  - **Non-regressione verificata**: rieseguito su **204 commesse con timbri**, su ENTRAMBI i confronti (avanzamento e barra ore): zero differenze di percentuale o di sforo. Oggi cambia solo la comparsa della riga "di cui esterne"; la correzione morde quando arriveranno i primi rapportini o un caso di fase esternalizzata con timbri esterni.
- **Aperto**: le ore degli esterni in sede entrano ancora nelle medie effettive (`storicoMinutiPz`) come quelle dei dipendenti. Per la DURATA di un articolo è corretto (il tempo è tempo), per i numeri di **efficienza Cablotec** (reale/pagato, €/h in Analisi clienti) andrebbe deciso se separarle. Non toccato: numeri visibili, serve una decisione. Da riprendere quando gli esterni avranno timbrato qualcosa.

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
- **Sigle più corte di 4 → ZERI IN FONDO** (28 lug, `2026-07-28.4`, decisione Nico): `TDK` → `TDK0`, `3M` → `3M00`. La quarta casella esiste sempre perché il codice ha **posizioni fisse** (il produttore sta ai caratteri 6-9): una sigla a 3 farebbe slittare tutto il resto. Lo zero è preferito a una quarta lettera (`TDKE`) perché è automatico, non si confonde con una lettera del marchio e non richiede una scelta marchio-per-marchio che fra sei mesi qualcun altro farebbe diversa. Zeri **in fondo** e non davanti: la sigla si legge come un nome (diverso dagli 11 caratteri del codice articolo, dove gli zeri vanno DAVANTI perché è un numero).
- **Marchi più lunghi di 4: abbreviati A MANO**, nessun taglio automatico (`PHOE` o `PHCO` per Phoenix Contact è buon senso, non una regola). La UI rifiuta oltre 4 e lo dice.
- Il riempimento avviene **all'inserimento**, non alla composizione: `codificaComponi` resta severo e pretende 4 caratteri esatti, così ciò che è salvato in `produttori.sigla` è già la sigla definitiva e il vincolo UNIQUE fa da rete sulle collisioni. Vale sia nella mini-anagrafica sia nel campo libero pre-migrazione (lì il riempimento scatta all'uscita dal campo, non a ogni tasto). 18 test in scratchpad/test_sigla.js.
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

## Sospesi tecnici
- ~~**Step 1b**: timbri con `sb.from()` nudo~~ **FATTO** (28 lug, `2026-07-28.3`) — vedi sezione dedicata sotto.
- De-dup helper mobile/prelievo (`core/util.js`), `domain/formato.js` mai estratto.
- Togliere fallback `?kiosk` quando postazioni confermate su kiosk.html.
- Colonne `lead_giorni` inerti su aziende/operazioni_fornitori (DROP mai fatto).
- Potatura CSS/rami morti. (`beta/` e `index-vecchio.html`: **già assenti dal repo**, verificato 28 lug con `git ls-files` — voce chiusa.)

## Step 1b — retry sulle scritture di timbro (28 lug, `2026-07-28.3`)
- **Scoperta**: il sospeso segnalava solo `mobile.html`, ma **anche il kiosk** aveva gli stessi `sb.from()` nudi (`kioskAvviaSessione`, `kioskChiudiOScarta`, `kioskSelectAttivita`, `kioskFineFase`, `kioskAssicuraAddetto`, `kioskRiapriFaseSeCompletata`, `kioskRisolviOCreaFase`) — ed è la postazione che timbra di più. Coperti entrambi.
- **Coperto** (tutto il flusso di cattura del timbro, non solo la sessione): avvio timbratura, chiusura, chiusura con split del gruppo + insert delle quote, avvio attività extra, completamento fase, riapertura fase, iscrizione addetto, creazione fase al volo. `mobile.html` non ha **più nessuna** scrittura nuda su `sessioni_lavoro`/`operazioni_addetti`/`operazioni_fasi`.
- **NON coperto di proposito**: i percorsi **admin** (`app.js` 1112, 8551, 8821, 14134, 14160 — sync fasi/addetti dal modal commessa, chiusure su eliminazione commessa, modifica/eliminazione sessione in Storico consuntivi). Lì c'è una persona davanti allo schermo che vede l'errore e ritenta: profilo di rischio diverso dalla cattura non presidiata in reparto.
- **Due trappole trovate e risolte, da ricordare se si estende il pattern**:
  1. **Un builder Supabase è monouso**: `await q` dopo un timeout non rieseguirebbe nulla. Dove la query si costruisce a pezzi (filtri condizionali) va avvolta in una `buildQ = () => …` che la **ricostruisce a ogni tentativo**. Fatto in `fineFase`, `riapriFaseSilenziosa` (mobile), `kioskFineFase`, `kioskRiapriFaseSeCompletata`.
  2. **Il timestamp si calcola PRIMA del retry**, mai dentro la closure: altrimenti il secondo tentativo scriverebbe l'ora del retry invece di quella in cui l'operatore ha premuto. Fatto in `stopSessione` e `kioskSelectAttivita`.
- **Limite noto (accettato)**: `eseguiConRetry` ritenta solo sul TIMEOUT (10s). Su una INSERT andata a buon fine ma con risposta persa, il secondo tentativo può creare un doppione. È il compromesso già scelto dal progetto (stesso helper ovunque in app.js) e resta preferibile al timbro perso: il 7 lug se ne sono persi 3 in silenzio.

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
