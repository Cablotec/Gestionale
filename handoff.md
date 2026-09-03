# Handoff — Gestionale Cablotec (aggiornato 28 lug 2026)

> Fonte per i fili aperti. CLAUDE.md è derivato da qui: se cambia questo, rigenerare quello.

## Contesto lampo
- **Cos'è**: ERP Cablotec. Backend **Supabase**, hosting **GitHub Pages**, script classici (niente ES module), scope globale condiviso. Deploy = git push.
- **Pubblicazione Pages**: workflow esplicito `.github/workflows/pages.yml` (Source = "GitHub Actions"). NON tornare a "Deploy from a branch" (pipeline legacy incastrata il 5-6 lug: build fermi ore, run non cancellabili). Deploy fallito → Actions → Re-run jobs o commit vuoto.
- **Struttura**: `index.html`/`kiosk.html` (gusci gemelli), `app.js` (~14k r) + `app.css`, `core/db.js` (Supabase condiviso + `fetchTutte` paginata), `domain/scheduling.js` (motore PURO, no DOM/Supabase), `mobile.html`/`prelievo.html` autonome.
- **Cache**: a ogni deploy bump `?v=YYYY-MM-DD.N` nei 4 gusci. Attuale: `v=2026-08-24.5`. La **versione è visibile sotto il logo** (gestionale e kiosk): prima cosa da controllare quando "non si vede una modifica" (quasi sempre è cache).
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
- **Migrazione aggiuntiva ESEGUITA** (31 lug, verificata via REST: scrittura/rilettura del jsonb `consegne` OK, torna un array vero): `impegno numeric`, `consegne jsonb`, `prima_consegna date`. **Dopo la migrazione va RIFATTO l import**: il vecchio archivio (314 righe) non ha le consegne.
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

## Attività extra — struttura, ripresa dopo la pausa, ricerca (6 ago, `2026-08-06.1`)

### Cosa dicevano i dati (misurato via REST prima di toccare qualsiasi cosa)
- **143 timbri, 228 h dal 27 mag** = il **6,3%** di tutto il timbrato (commesse: 2005 timbri, 3404 h). Non è una voce marginale: circa una giornata di reparto a settimana.
- **In anagrafica c'era UNA sola voce**, chiamata "Attività extra": tutto finiva lì. L'unica cosa che diceva *cosa* fosse stato fatto era la nota, e **137 timbri su 143 non l'avevano** (la nota obbligatoria è del 4 ago).
- **14 timbri (34,4 h) chiusi dalla pausa delle 12:30, tutti e 14 senza nota**: il 15% delle ore extra, troncato e senza spiegazione. Il punto sollevato da Nico, misurato.
- Rumore trovato: **8 timbri sotto i 3 minuti** (clic per sbaglio) e **1 timbro da 64,6 h** (Raoul, 26→29 giu) che da solo è il 28% delle ore extra. Quest'ultimo è sfuggito perché **la pausa chiude solo le sessioni iniziate PRIMA delle 12:30**: quella era partita alle 15:40 e non l'ha toccata nessuno. **Non esiste una chiusura di fine giornata** — buco aperto, vedi fili.

### 1. Struttura: le note rapide diventano attività (decisione Nico)
Le 6 chip di `KIOSK_NOTE_RAPIDE` erano **già una tassonomia** che non era mai diventata dato: restavano testo dentro la nota. Ora sono voci vere in `attivita_extra` → il "cosa" si sceglie con un bottone grande, diventa contabile e ricercabile, e la nota resta per il dettaglio (che funziona bene quando c'è: "PERFOREX", "carico QE Barilla D23634").
- **DA ESEGUIRE DAL PANNELLO** (l'account kiosk è bloccato da RLS sull'anagrafica: `42501 new row violates row-level security policy`):
  ```sql
  INSERT INTO attivita_extra (nome, descrizione, ordine, colore, attivo) VALUES
    ('Pulizia e riordino','Pulizia del reparto, riordino postazioni e attrezzatura.',10,'#92D050',true),
    ('Manutenzione','Manutenzione di macchine e attrezzature (scrivi quale nella nota).',20,'#00B0F0',true),
    ('Aiuto a un collega','Lavoro dato a un collega su una sua commessa.',30,'#FFC000',true),
    ('Riunione','Riunioni e allineamenti.',40,'#7030A0',true),
    ('Formazione','Formazione, affiancamento, addestramento.',50,'#FF6600',true),
    ('Attesa materiale','Fermo: manca il materiale per andare avanti.',60,'#FF7575',true);
  -- La voce generica NON si cancella: 143 timbri la usano. Si rinomina per
  -- quello che è sempre stata e si toglie dal kiosk (attivo=false), così
  -- resta leggibile nello storico ma non compare più fra le scelte.
  UPDATE attivita_extra
     SET nome = 'Non classificata', attivo = false, ordine = 99
   WHERE id = 'cbd0535c-fbbd-464a-aee4-f15c8dcbc1fb';
  ```
- Il codice **non dipende** da questa SQL: senza, il kiosk mostra quello che trova in anagrafica come prima.
- **Aperto**: con le 6 attività, le chip della schermata nota **ripetono** il nome dell'attività appena scelta. Da rivedere quando saranno in uso: le chip servono ancora sulla schermata di ripresa, meno sulla chiusura.

### 2. Ripresa dopo la pausa (decisione Nico: chiedi la nota e offri la ripresa)
- All'identificazione, se l'operatore ha un'**attività extra troncata dalla pausa oggi e rimasta senza nota**, prima del menu compare una schermata sola: *"Prima della pausa stavi facendo: X — dalle HH:MM alle 12:30 il timbro si è chiuso da solo"*, chip + testo libero, e i bottoni **▶ Riprendi — X** / **✔ Ho finito** / **← Lo scrivo dopo**.
- La nota finisce **sulla riga della mattina**, che è quella che la mancava. "Riprendi" apre una sessione nuova sulla stessa attività (via `kioskSelectAttivita`, la stessa strada di sempre): i due spezzoni restano due fatti distinti, non si fondono.
- **Riconoscimento senza marcatori**: lo spezzone si riconosce dall'ora esatta di chiusura (12:30:00 spaccate, quello che scrive la pausa). **Nessun marcatore nelle note** — quel campo è solo degli operatori (decisione 5 ago). Una chiusura a mano allo stesso secondo è improbabile; alle 12:30:14 non scatta.
- **"Lo scrivo dopo" esiste apposta**: senza via d'uscita un operatore senza parole resterebbe piantato davanti al kiosk, e piantare il terminale di reparto è peggio del buco che stiamo chiudendo. Chi salta finisce nella scheda di ricerca col filtro "solo senza nota".
- **Niente assillo**: `kioskState.spezzoniSaltati` evita di richiederlo a ogni identificazione. Si azzera al ricaricamento della pagina (il kiosk si ricarica da solo), quindi un buco resta comunque recuperabile il giorno stesso.
- `kioskChiediNota` è stata riscritta come sottile involucro di **`kioskNotaSchermata`** (titolo, sottotitolo, casella facoltativa, N bottoni): una schermata sola per chiusura e ripresa, o le due direbbero la stessa cosa in due modi diversi. 12 test in scratchpad/test_spezzone_pausa.js.

### 4. Note rapide TOLTE, nota facoltativa (7 ago, `2026-08-07.2`, decisione Nico)
- **Le sei chip non ci sono più** (`KIOSK_NOTE_RAPIDE` cancellata, in app.js **e** in mobile.html che ne aveva una copia sua). Erano nate quando l'attività extra era UNA SOLA e la nota era l'unico posto dove dire cos'era quel tempo. Adesso quelle sei voci **sono** le attività, scelte all'inizio con un bottone grande: ripeterle alla fine faceva scegliere due volte la stessa cosa.
- **La nota è FACOLTATIVA**: la schermata di chiusura diventa "Hai finito?" con la casella per il dettaglio e il bottone sempre attivo. Nessun bottone si disabilita più — un bottone spento su un kiosk di reparto è un operatore fermo che non sa cosa fare.
- Resta la casella perché le uniche due note utili di tutto lo storico erano dettagli che l'attività non dice ("PERFOREX", "carico del QE di Barilla con Ryan, Mauro e Raoul").
- **La schermata di ripresa non chiede più niente**: solo *"Prima della pausa stavi facendo X — vuoi riprendere da lì?"* con Riprendi / No, ho finito. Di conseguenza `kioskSpezzoneDaPausa` **non filtra più sulle note**: un lavoro interrotto va ripreso anche se una nota c'era già.

### 3. Scheda "Attività extra" in Lavoro (visibile a tutti, decisione Nico)
- Nuova scheda dopo Storico: ricerca su nota/attività/operatore, filtri per attività, operatore e mese, interruttore **"solo senza nota"**, totali **per attività** (ore, timbri, quanti senza nota) e elenco. Clic sulla riga → `openSessioneModal` per correggere orari o nota (**solo admin**, la modal se ne occupa già da sé).
- L'anagrafica resta in Gestione: **qui si guarda cosa è stato fatto, lì si decide cosa si può fare**.
- I timbri troncati dalla pausa sono marcati **⏸** e, se senza nota, la cella lo dice: *"— troncato dalla pausa, mai scritto —"*. Le sessioni aperte contano fino ad adesso (stessa convenzione del resto dell'app).
- Tetto a 500 righe mostrate (oggi sono 143): la tabella cresce da sola e una scheda che si pianta non la sistema nessuno.
- 24 test in scratchpad/test_timbri_extra.js (la funzione vera estratta da app.js e fatta girare su un DOM finto).

## Attività extra v2 — il RIFERIMENTO (7 ago, `2026-08-07.1`)

### La distinzione che regge tutto (ragionamento con Nico)
Dentro "attività extra" vivono **due bestie diverse**, e non differiscono per nome ma per struttura:
- **Attività a monte ore** (pulizia, riunione, formazione, fermo): interessa il **totale del periodo**, gli spezzoni non hanno legame fra loro. Non c'è niente a cui riferirsi.
- **Lavori con un OGGETTO** (riparazione, modifica, lavoro a ore senza ordine): non esiste "un'ora di riparazione", esiste "3,5 ore **su quella cosa**". Il totale che conta è **per riferimento**, e il lavoro si riprende nei giorni perché è uno solo anche se il tempo è spezzato.

Da qui discende il resto: **si può riprendere solo ciò che ha un oggetto**. La pulizia non si riprende perché non c'è niente da riprendere.

### Decisioni
- **Il riferimento NON sta nella nota** (correzione all'idea iniziale di Nico): come testo libero, "OC 329", "0329" e "ordine 329" sono tre cose diverse per il gestionale, e la somma per riferimento — che è il punto — non si potrebbe fare. Campo suo su `sessioni_lavoro`, chiesto **all'inizio**: senza, il timbro non parte.
- **Riparazioni per ora SLEGATE dalla commessa** (decisione Nico): il riferimento è testo battezzato dall'operatore ("quadro Barilla giugno"). Il collegamento alla commessa vera e la domanda "le ore di rilavorazione entrano nel consuntivo?" restano aperte: si guarda prima cosa scrivono davvero. Stesso metodo dei mancanti — prima si raccoglie in forma strutturata, poi si stringe.
- **Domanda di Nico: "se la battezzo 'quadro Barilla giugno' rimane quello il riferimento?"** Sì, con una condizione che è tutta nel meccanismo: i riferimenti già usati sono **BOTTONI** nella schermata del kiosk (strada normale), e se uno lo riscrive a mano in modo equivalente (`rifChiave`: minuscole, spazi compattati) **si riusa la forma del battesimo** invece di crearne un gemello. Due totali per lo stesso lavoro sarebbero un errore invisibile.
- **Il nome buono è quello del PRIMO uso**: una digitazione distratta tre settimane dopo non ribattezza il lavoro. Nella riga dell'elenco resta però scritto quello che l'operatore ha scritto davvero — è un fatto; a normalizzare è il raggruppamento.
- Nico ha creato da sé 4 voci: **Pulizia/Riordino, Manutenzione, Modifica, Riparazione**. Il flag "richiede riferimento" si mette dalla scheda, voce per voce (previsto: sì su Modifica e Riparazione).

### Migrazione **ESEGUITA** (7 ago, prima volta col nuovo accesso — vedi sezione sotto)
`sessioni_lavoro.riferimento text` + `attivita_extra.richiede_riferimento boolean` + indice `idx_sessioni_lavoro_riferimento`. Flag acceso su **Riparazione** e **Modifica**; Pulizia/Riordino e Manutenzione restano a monte ore. NB: la colonna è **nullable senza default** (le funzioni di migrazione fanno solo `ADD COLUMN` nudo) — il codice legge sempre `!!a.richiede_riferimento`, quindi NULL vale falso e va bene così.
Il codice comunque regge anche senza la migrazione: `attivitaRifAttivo()` / `sessioniRifAttivo()` accendono i pezzi solo a colonna presente (stesso schema di `utenti.azienda_id`), e la colonna non viene mai mandata negli insert.

### Cosa c'è nel codice
- **Kiosk**: scelta l'attività che lo richiede, esce *"<attività> — su cosa?"* con i lavori aperti di recente come bottoni (ore già timbrate + ultima volta) e una casella per battezzarne uno nuovo. Si chiede **prima** di chiudere la sessione precedente: tornando indietro non ci si ritrova la vecchia già chiusa.
- **Ripresa dopo la pausa**: se lo spezzone aveva un riferimento, "Riprendi" torna sullo **stesso lavoro** senza rifare il giro della schermata.
- **Scheda Attività extra**: nuova sezione **"Per lavoro"** (ore sommate su tutti gli spezzoni, su quali attività, ultima volta, clic → filtra), colonna Lavoro nell'elenco, ricerca anche sul riferimento.
- 45 test (32 scheda + 13 spezzone pausa).

## Striscia "timbrature sospette" sopra tutte le schede (7 ago, `2026-08-07.4`)
- **Sta SOLO nella scheda Live** (decisione finale di Nico, `2026-08-07.6`): provata sopra tutte le schede per un giro e poi riportata dentro Live, dove viveva il vecchio banner. `#sospette-bar` è ora dentro `renderGanttLiveTab`, non più in `index.html`.
- **Ha sostituito `aggiornaLiveWarnBanner`**, che è stata cancellata: elencava solo le sessioni oltre 7 h aperte più quelle chiuse **iniziate oggi**, cioè una vista del solo presente — ed è il motivo per cui la sessione da 64,6 h chiusa a giugno non si vedeva da nessuna parte. `sessioneTroppoLunga` resta: la usano le card e lo storico per ingiallire.
- **TUTTE le anomalie di sempre, nessun tetto** (richiesta Nico): l'elenco esiste per sistemarle una per una, e troncarlo lascerebbe le più vecchie invisibili per sempre. Scorre dentro il suo riquadro (max-height 300px) invece di spingere giù le card.
- **Compare SOLO quando c'è qualcosa, e NON si può mettere via** (`2026-08-07.7`): c'era un "✕ Per oggi basta" che la nascondeva fino al giorno dopo, **tolto su richiesta di Nico dopo averlo provato una volta**. Serviva l'esatto contrario: l'elenco esiste per essere svuotato, e una lista che si può zittire si zittisce e basta. Sparisce da sola quando le timbrature sono sistemate — l'unico modo giusto di farla sparire. `renderSospette` ripulisce anche la vecchia chiave `localStorage`, o chi l'aveva premuta se la ritroverebbe attiva senza più un bottone per annullarla. Aperto/chiuso dell'**elenco** vive in `state.sospetteAperto`: il riquadro si ridisegna da solo **una volta al minuto** (non a ogni secondo come il vecchio banner: sarebbe sprecato) e senza quello si richiuderebbe sotto le dita mentre lo si legge.
- **Parte APERTA** (25 ago, `2026-08-25.1`, richiesta Nico): `state.sospetteAperto` era `undefined` alla prima apertura, cioè chiusa. Col primo stato chiuso il numero in intestazione si legge come un'insegna e nessuno preme "Vedi quali": la striscia annunciava un lavoro invece di mostrarlo. Ora il flag nasce `true` in `state` e la visibilità dell'elenco si deriva da lì alla costruzione (non più `display:none` inline corretto subito dopo). Il bottone resta: si può mettere via mentre si lavora, e torna aperta al ricarico. Non spinge giù le card degli operatori — l'elenco scorre già dentro il suo riquadro (`max-height:300px`).
- `timbratureSospette(soloOggiIso?)` in `domain/scheduling.js` (pura, **29 test** in scratchpad/test_sospette.js) → `{ righe, n, perTipo }`, tipi `aperta` / `lunga` / `doppione` / `sovrapposta` / `zero`. Ordine: **aperte** per prime (le uniche su cui si può intervenire adesso), poi le **durate assurde** (finché restano, quelle ore falsano i conti). Clic sulla riga → `openSessioneModal` (admin).
- **`lunga` = sessione CHIUSA oltre 7 h** (`2026-08-07.5`): aggiunta perché la prima versione della striscia aveva **lo stesso buco del banner di Live** — segnalava solo le aperte, e quella da 64,6 h è chiusa dal 29 giugno. Nessuno lavora 60 ore di fila: da qualche parte c'è un orario sbagliato, e finché non lo si corregge quelle ore restano nei conti (da sole valgono il 28% delle ore extra di sempre). In tutto lo storico ne esiste **una**, quindi la riga non fa volume. La lezione: **una vista "sospette" che guarda solo il presente ripete il buco che doveva chiudere.**
- **LA PARTE DIFFICILE NON È TROVARLE, È NON GRIDARE AL LUPO.** Sui dati veri (2.208 sessioni) le coppie con lo **stesso identico intervallo** erano **65** e sembravano ore contate doppie. Non lo erano:
  - **41 sono lo split a mano di `2026/OC/00198`** fra i due articoli gemelli (/20 e /40, 62,4 h per lato) — quello annotato a mano trovato il 5 ago. Voluto da una persona.
  - **24 sono le quote dell'accorpamento** (un timbro spalmato sul gruppo): funzionamento previsto.
  Elencarle tutte avrebbe prodotto 65 righe di rumore. Per questo il **doppione si segnala solo sulla STESSA commessa**: quello non ha nessuna spiegazione buona (ed è 1).
- **Scoperta sui "durata zero"**: erano **17 righe da DUE tocchi sbagliati**. Toccando per un secondo una commessa **raggruppata**, lo split genera una quota a zero per **ogni** commessa del gruppo → 8 e 9 righe nello stesso istante (Contoli 05:56, Fabbri 07:26 del 4 ago). Ora si raggruppano per persona+secondo e la riga lo dice: *"9 timbri a durata zero nello stesso secondo · quote di un tocco su un gruppo"*. **Sui dati veri la striscia è passata da 23 righe a 8.**
## Accavallamenti: si IMPEDISCONO (7 ago, `2026-08-07.6`)
- **Da dove nascevano**: i 5 accavallamenti nei dati (giu-ago) avevano **tutti `sede: kiosk`** — nessuno veniva da correzioni a mano. Il motivo: `kioskAvviaSessione` non controllava affatto se l'operatore avesse già un timbro aperto, e gli altri percorsi si fidavano di **`state.sessioni`, la copia locale della postazione**. Con due postazioni, la seconda non sa che sulla prima c'è un timbro aperto: crede l'operatore libero, ne apre un altro, e le ore si contano due volte finché qualcuno chiude il primo.
- **`kioskChiudiAperteRimaste(uid)`**: prima di ogni avvio (commessa e attività extra) chiede **al server** se ci sono sessioni aperte di quell'operatore e le chiude. Non guarda lo stato locale — è proprio quello il punto. Costa un giro di rete su un'operazione che ne fa già diversi.
- **`sessioneInConflitto(utenteId, inizio, fine, escludiId)`** in domain (pura, 11 test): ritorna la prima sessione che si interseca davvero. Estremi che si toccano NON sono conflitto (chiudo alle 10:00 e riparto alle 10:00 è la normalità); una sessione a durata zero non blocca niente; una aperta occupa fino ad adesso.
- **Bloccante nel modal di modifica sessione** (admin): lì il conflitto è certo e c'è una persona davanti allo schermo che corregge subito — diverso dall'avviso sulle assenze dei mezzi, dove il conflitto è solo probabile.
- **Resta scoperto `mobile.html`**: ha un percorso di avvio suo e non ha la guardia. Sono 6 sessioni su 2.208, ma se il telefono prende piede va messa anche lì.

- **Aperto, conseguenza della scoperta**: lo split del gruppo **non ha una soglia minima**, quindi un tocco da 1 secondo si moltiplica per la dimensione del gruppo. Coi timbri sotto i 3 minuti al 9,7% capiterà ancora. Basterebbe non generare le quote sotto N secondi — da decidere con Nico (è diverso dal "cancellare i timbri corti", che ha già scartato).

## Sessione di pulizia delle timbrature (7 ago) — da 9 anomalie a 0
Fatta insieme a Nico, caso per caso, con la giornata intera dell'operatore davanti. **Sempre: backup prima, righe salvate su file prima di toccarle, controprova rileggendo dal DB dopo.**
- **6 correzioni di orario** (`rollback_correzioni.json` ha lo stato precedente): la sessione da **64,6 h** di Raoul (ven 26/06, aperta alle 15:40 e mai chiusa per tutto il weekend) chiusa alle **16:00**, come tutti gli altri quel venerdì; e 5 accavallamenti chiusi all'ora in cui parte il timbro successivo. **67 ore mai lavorate sono uscite dai conti**, di cui 64 dal weekend di Raoul.
- **18 cancellazioni** (`da_cancellare.json`): 17 righe a durata zero + **una sola** delle due gemelle di Marco Ceroni su `2026/OC/00209/30`, dove 1,87 h erano contate due volte. **La DELETE su `sessioni_lavoro` è riservata agli admin**: l'account applicativo viene bloccato dall'RLS **in silenzio** (nessun errore, zero righe toccate) → serve la SQL dal pannello, `strumenti/cancella-sospette.sql`.
- **SCOPERTA, da un collega di Nico**: entrare pochi secondi in una commessa **per chiudere la propria fase** è un gesto voluto e frequente. Verificato sui dati: dei 215 timbri sotto i 3 minuti, **112 sono su commesse dove quell'operatore ha una fase completata**, e per 86 la chiusura avviene entro 5 minuti — **mediana 6 secondi**. Ci sono anche 13 fasi finite dove *tutti* i timbri di quell'operatore durano meno di 3 minuti: il tempo vero l'ha fatto un collega, la chiusura la fa lui.
  - **Conseguenza**: i timbri corti NON sono rumore da buttare, sono la traccia di chi ha chiuso cosa. La decisione del 6 ago di lasciarli stare era giusta per un motivo che allora non conoscevamo.
  - **Domanda di Nico, e la risposta**: cancellare quei timbri **non riapre la fase**. Il "finita" sta su `operazioni_addetti.completata_il`, non sul timbro; e la pulizia delle fasi orfane salta esplicitamente quelle con un addetto collegato. Prova sui dati: esistono **2 fasi dichiarate finite senza nemmeno un timbro** di quell'operatore.
  - **Da fare se un domani si segnalano i timbri corti**: escludere quelli che hanno chiuso una fase, o si griderebbe al lupo su un'abitudine sana.

## ⚠ Cancellare un'attività extra: la trappola (7 ago, successa davvero)
- Nico ha cancellato per sbaglio la voce "Attività extra" dalla scheda. **Nessun dato perso**: la FK `sessioni_lavoro.attivita_id` è **ON DELETE SET NULL**, quindi i timbri sono rimasti — ma **scollegati**, cioè ore di nessuno, invisibili in ogni conteggio. **144 sessioni, 238 h.**
- Riconosciute e separate con certezza grazie al backup letto via REST il giorno prima (`scratchpad/sess.json`, 143 righe): **3 sessioni erano già orfane da prima** (12/06, 15/06, 25/06) e non vanno riagganciate; 1 era nata dopo il backup ed era ancora aperta.
- SQL di ripristino in `scratchpad/sql_ripristino.sql`: ricrea la voce **con lo stesso id** e riaggancia tutto ciò che è senza commessa e senza attività, **tranne** quei 3 id.
- **Porta chiusa**: `deleteAttivitaExtra` ora conta i timbri attaccati. Se ce ne sono, la cancellazione **non si offre più** — propone di **disattivare** (sparisce dal kiosk, lo storico resta leggibile). L'avviso vecchio lo diceva a parole ("resteranno senza riferimento") ma senza numeri, che è come non dirlo.

## Export dello Storico — colonne (7 ago, `2026-08-07.9`, chiesto da Cocco)
- **Aggiunte le ore**, che a schermo ci sono e nell'Excel mancavano: `Ore consuntivate`, `Ore pagate`, `Sforo (h)` e `Pagato solo interno`. A schermo stanno in una cella sola (`12,3/10,0`) perché è una colonna; **in Excel vanno divise e come NUMERI veri**, o non ci si può sommare né filtrare sopra.
- `Pagato solo interno` traduce il `·int` della tabella: quando ci sono fasi a terzisti il pagato scende alla sola parte interna, e senza dirlo uno legge un numero più basso senza sapere perché.
- **Tolte** `Destinatario` e `Note spedizione`: non servono a nessuno nel foglio.
- **Si esporta QUELLO CHE SI VEDE** (`2026-08-07.10`, richiesta Nico, vale per **Storico E Ordini cliente**). Prima portavano via tutto l'archivio: chi filtrava per mese o cliente se ne accorgeva solo aprendo il file.
  - **Una strada sola per scheda**: `storicoFiltrate()` e `pianificazioneFiltrate(includiSpedite)` sono usate SIA dalla tabella SIA dall'export. Se fossero due, l'Excel direbbe una cosa diversa da quella che si vede — che è esattamente il bug di partenza.
  - **Il toast dichiara quante righe e con quali filtri**: senza, un file corto sembra un errore.
  - **Nel modal delle commesse sono sparite le caselle degli stati**: erano un secondo filtro accanto a quello della scheda, e i due potevano dire cose diverse. Resta una sola casella, **"includi anche le spedite"**, perché quelle la scheda le nasconde sempre (vivono nello Storico) e chi esporta può volerle. Via anche `STATI_OPERAZIONE`, che serviva solo a quelle caselle.
  - 24 test in scratchpad/test_export_filtri.js, con le funzioni vere e una libreria Excel finta.

## Segnalazione di Cocco: due commesse raggruppate con consuntivi diversi (24 ago)
- **La sua ipotesi era giusta a metà**: il gruppo di `2026/OC/00209` pos 20+40 è nato il **10 luglio**, e fino a lì la pos 40 aveva già 60,5 h contro 11,1. Quello sbilancio non si divide all'indietro: le ore timbrate sono fatti, il raggruppamento non le riscrive.
- **L'altra metà era un difetto nostro.** La chiusura automatica delle 12:30 faceva un update secco del campo `fine`, mentre la chiusura normale del kiosk passa da `kioskChiudiOScarta`, che contiene lo split. **Due strade per chiudere la stessa cosa, e una sola sapeva del gruppo.** Su tutte le commesse raggruppate: **87 timbri, 305 h** finite su una sola commessa.
- Scomposizione su pos 20 / pos 40: prima del gruppo 11,1 / 60,5 — spalmato 24,7 / 25,2 (**lo split funziona**) — chiuso dalla pausa e non spalmato 29,9 / 4,7.
- **Estratta `chiudiConSplitGruppo(sess, fineIso, nota)`**: una strada sola, tre chiamanti — kiosk, pausa pranzo e `kioskChiudiAperteRimaste` (la guardia anti-accavallamento, che aveva **lo stesso identico buco**). Perché la pausa possa spalmare le serve la riga intera: la sua `select` passa da quattro campi a `*`.
- **RIDISTRIBUITO IL PASSATO** (decisione Nico): 87 timbri, 444 righe nuove, **305,2 h prima e 305,2 h dopo** — nessuna ora persa né inventata. Ordine voluto: **prima l'INSERT, poi l'UPDATE** che accorcia; se si interrompe le ore risultano doppie (visibile e riparabile) invece di sparire (silenzioso e no). Registro di avanzamento per poter rilanciare senza rifare.
  - Effetto su OC/00209: pos 20 da 65,6 a **75,4 h**, pos 40 da 90,4 a **80,6 h** — lo scarto scende da 24,7 a 5,2 h.
  - Le sospette restano **46 prima e 46 dopo**: la ridistribuzione non ha creato accavallamenti, le fette sono contigue.
  - Costo dichiarato e accettato: sui gruppi da 11 commesse (Senzani) 390 righe su 444 spostano **meno di sei minuti a commessa**, perché i pesi sono identici e i timbri erano già sparsi. Il movimento vero è tutto nei gruppi da 2-3.
- **Arretrato da guardare**: 46 timbrature sospette accumulate dal 7 al 24 ago (24 a durata zero, 17 accavallate, 4 lunghe, 1 doppione). **I 17 accavallamenti erano UNO SOLO** — vedi la sezione qui sotto: una chiusura partita due volte. Negli altri giorni: zero.
## I 17 accavallamenti del 13 agosto: erano UNO (24 ago, `2026-08-24.2`)
- Non erano 17 fatti, era **una chiusura partita due volte**. Giacomo Biagi, 13 ago: due lotti di 10 quote creati a **3 secondi** di distanza, sfalsati di 2 secondi. Ogni riga del primo lotto si accavalla con la gemella del secondo → 17 coppie segnalate, **un solo evento**.
- Cercando lo stesso schema in tutto lo storico: **9 chiusure partite due volte**. Una da doppio tocco (3 s) e **sette di Fabrizio Scordo il 21 ago a 10-12 secondi** — che è **esattamente il timeout di `eseguiConRetry`**: insert riuscita, risposta persa, secondo tentativo che rifà tutto. È il rischio dichiarato nel handoff dal 28 lug, e per la prima volta si vede nei dati.
- **Ore contate due volte: 1,82 h** (solo il caso di Giacomo; gli altri otto lotti erano quote a durata zero da micro-tocchi).
- **CAUSA CHIUSA**: `chiudiConSplitGruppo` ora aggiorna **solo se la sessione è ancora aperta** (`.is('fine', null)`), e se non tocca nessuna riga **non crea le quote**. Una chiusura può partire dieci volte: le quote restano una serie sola. 8 test in scratchpad/test_chiusura_idempotente.js, con un finto Supabase che rispetta il filtro.
- **Da eseguire**: `strumenti/cancella-doppioni-chiusura.sql` toglie le 90 righe della seconda serie (la DELETE resta agli admin).
- Lezione: **un retry senza guardia di idempotenza non è una rete, è un moltiplicatore.** Vale per tutte le scritture che creano righe, non solo per queste.

## ⚠ DA FARE A FINE TURNO (preparato il 24 ago, non ancora eseguito)
Due sistemazioni pronte, tutte e due nate da **errori miei** della stessa giornata. Niente scritture in orario di lavoro: si eseguono a reparto fermo.

**1. Annullare la parte retroattiva della ridistribuzione** — ordine: prima le durate, poi la DELETE.
- Ridistribuendo i timbri chiusi dalla pausa ho diviso anche **25 timbri fatti PRIMA che il loro gruppo esistesse**: 28,9 h spostate applicando all'indietro un raggruppamento che a quella data non c'era. È il contrario del principio detto a Cocco — *le ore timbrate prima del raggruppamento sono fatti e restano dove sono*.
- `scratchpad/ripristina_durate.json` ha gli orari originali dei 25 (69,7 h che tornano intere); `strumenti/annulla-retroattivi.sql` cancella le 62 quote.
- **Prima le durate, poi la DELETE**: così nella finestra fra le due le ore risultano in più (si vede) e non in meno (non si vede).
- Effetto su OC/00209: pos 40 **+13,1 h**, pos 20 **−13,1**, pos 10 **+8,0**, pos 30 **−8,0**.

**2. Ridistribuire le 9 timbrature di agosto** che la prima passata non aveva visto — 39,3 h, 54 righe nuove.
- **Perché mancavano**: la query aveva letto **1000 righe su 1620**, il tetto di PostgREST. È la trappola scritta in questo stesso handoff (*"tabelle a crescita libera SEMPRE via `fetchTutte`"*), e il numero tondo 1000 nel primo conteggio avrebbe dovuto insospettirmi. `scratchpad/piano9.js` ora pagina.
- Nessuna delle 9 è pre-gruppo, quindi non ricade nel problema del punto 1.
- Spostamento netto quasi tutto su OC/00209: pos 20 **−9,2 h**, pos 40 **+9,2**.

**Stato di SP-GD2587807 (OC/00209 pos 20 e 40), la segnalazione di Cocco**
- Le due sono gemelle: stessa qtà, stesso min/pz, **100,8 h pagate ciascuna**. Adesso 75,4 e 80,6 h.
- **Più si corregge, più si allontanano**: fatte tutte e due le sistemazioni qui sopra diventano ~53 e ~103 h. Il 5,3 h di scarto di oggi è basso *per caso*, perché i due errori si compensavano.
- Lo squilibrio vero c'è ed è storico: la pos 40 è stata lavorata da sola dal 29 giu al 10 lug, e ad agosto quattro mattinate intere sono finite sulla sola pos 20.
- **Decisione di Nico**: non si pareggia adesso. Le due sono ancora aperte; **il pareggio si fa alla fine**, quando il gruppo ha chiuso e i consuntivi non si muovono più — prima non ha senso, perché ogni timbro nuovo lo sbilancia di nuovo.
- Sul gruppo nel suo insieme il numero è solido comunque: **156,0 h consuntivate su 201,7 pagate = 77%**. Confrontare le due metà significa confrontare quando è nato il gruppo e quale card è stata toccata.

**Da valutare più avanti (Nico: "li analizziamo più avanti")**: un'azione "pareggia il gruppo" disponibile solo a gruppo chiuso, che mostri come starebbero le ore prima di toccarle. NON fatta.

**Lo split in sé NON ha problemi** (verificato): 101 timbri spalmati, 501 righe, proporzioni esatte anche coi pesi non uniformi. Erano rotte le due cose *attorno* — la pausa che non lo chiamava e la chiusura che poteva partire due volte — entrambe corrette il 24 ago.
## Le 19 timbrature sospette: erano 2 (24 ago, `2026-08-24.4`)
Guardate una per una con Nico. **Diciannove righe, quattro cause, due problemi veri.**
- **15 a durata zero → NON si segnalano più** (decisione Nico). Entrare pochi secondi in una commessa per chiuderla è un **gesto voluto** — lo stesso raccontato dal collega per le fasi. Se la commessa è raggruppata, lo split di quel tocco genera una quota a zero **per ogni membro**: erano il sottoprodotto normale di un gesto normale, e riempivano la lista fino a renderla inutile. **Lo split resta com'è, nessuna soglia minima**: era il segnale a essere sbagliato, non il meccanismo.
- **PRINCIPIO (deciso qui, vale in generale): segnalare NON è chiedere di intervenire.** La stessa soglia di 7 h vive in due posti con due mestieri diversi, e devono restare diversi:
  - **card in Live e ⚠ nello storico** = *marcatore informativo*, "questa è stata una giornata fuori dall'ordinario". Le mattinate di Vasile ci restano, **e va bene così** (Nico: *"orari così eccezionali è bene che vengano segnalati"*).
  - **striscia delle timbrature sospette** = *elenco di cose da sistemare*. Lì una giornata regolare non ci deve stare, o l'elenco smette di essere una lista di lavoro.
  - Non unificarle: hanno lo stesso numero ma non la stessa domanda.
- **2 "lunghe" di Vasile → non erano anomalie**: 05:02→12:30 e 05:05→12:30, **chiuse dalla pausa**. Chi attacca alle 5 arriva a 7,5 h prima di pranzo. Ora la categoria `lunga` **salta i timbri chiusi alle 12:30 spaccate**: li ha chiusi il gestionale, per definizione non sono sfuggiti a nessuno. Restano segnalati quelli chiusi a mano alla stessa ora (anche 12:30:14).
- **Restano 2, e Nico le vuole segnalate**: che gli admin indaghino, non le corregge il gestionale.
  - **Rudin, 7 ago**: 13:01 → 06:47 del mattino dopo, 17,75 h su Manutenzione. A chiuderlo è stata la guardia anti-accavallamento quando è tornato a timbrare: ha fatto il suo mestiere ma ha scritto "adesso".
  - **Mirko, 18 ago**: 08:00→16:01, 8,02 h col pranzo dentro. **La pausa non ha saltato niente**: la riga è stata `created_at` alle **14:01** (alle 12:30 non esisteva) e `updated_at` **il giorno dopo alle 14:29**. Gli 08:00→16:01 li ha messi a mano un admin, pranzo compreso. Quando si corregge un timbro a mano, la pausa non c'è a togliere il pranzo.
- 38 test in scratchpad/test_sospette.js.

## Quota egress Supabase sforata: la causa era il kiosk (24 ago, `2026-08-24.6`)
Mail di Supabase: **6,26 GB usati su 5 GB** inclusi, restrizione dal 22 set 2026 se non si rientra.

**Come si è trovata.** Il primo modello (peso di un'apertura × aperture al giorno) dava ~5 GB e non spiegava il divario. Due scoperte l'hanno ribaltato:
1. **Le risposte di Supabase viaggiano gzippate** (misurato: 508 KB → 107 KB, `Content-Encoding: gzip`, ~4,8×). Tutte le misure fatte "a occhio" sul peso dei dati sono quindi ~5 volte più grandi del traffico vero: il volume di richieste doveva per forza essere molto più alto del previsto.
2. **`kioskStartRealtime` chiamava `kioskLoadAll()` su OGNI evento**, di tutte e 8 le tabelle sottoscritte. Ogni timbro genera **due** eventi (inserimento + chiusura), e la chiusura di una commessa raggruppata ne genera uno **per ogni commessa del gruppo**.

**Il conto, sui dati veri** (ultimi 7 giorni): 939 sessioni create + 1015 modificate + 99 commesse = **293 eventi al giorno**. Ogni evento = 215 KB di rete **per ogni postazione accesa**. Con 2 postazioni fa 3,6 GB al mese, con 4 fa 7,2. Il grafico giornaliero del dashboard conferma: barre solo nei giorni lavorativi, **zero il 9-10 e il 15-17 agosto**, giornata tipo ~200 MB, quasi tutto **Database egress** (non Realtime), Cached Egress **0,00 GB**.

**La correzione.** La riga cambiata arriva **dentro** il messaggio realtime: applicarla costa zero traffico. È già quello che fa il gestionale admin con `applyChange`. Ora il kiosk fa lo stesso per le due tabelle che cambiano di continuo:
- `kioskApplySessione(p)` — applica la riga e tiene aggiornati **`kioskState.opOreCons` e `opIniziate`** (che `kioskLoadAll` ricalcolava con una query a parte) lavorando **per delta**: ore dopo − ore prima. Lo stesso evento due volte non raddoppia niente, una durata corretta a mano non si somma.
- ⚠ **`p.old` contiene SOLO la chiave primaria** senza `REPLICA IDENTITY FULL`: lo stato precedente va letto da `state.sessioni` *prima* di applicare il cambio, mai da `p.old`.
- `kioskApplyOperazione(p)` — riapplica il filtro del kiosk: una commessa che diventa spedita/completata deve **sparire**, come faceva la ricarica.
- ⚠ **`operazioni_addetti` non ha un canale suo**: finora si aggiornava *di rimbalzo*, perché ogni timbro faceva ricaricare tutto. Senza quella ricarica una postazione resterebbe indietro e la chiusura fase, non trovando la riga in cache, **ne inserirebbe una doppia**. Perciò `kioskSyncAddetti(opId)` rilegge le righe della **sola commessa toccata**: qualche centinaio di byte invece di 215 KB.
- Le altre 6 tabelle (mezzi, utenti, prenotazioni, aziende, articoli, tipi_lavorazione) ricaricano ancora tutto, **e va bene così — misurato**: articoli 12 modifiche in 7 giorni, aziende e tipi_lavorazione 0, prenotazioni mezzi 15 (≈4 eventi/giorno con uscita e rientro) = **0,11 GB al mese** anche con 4 postazioni. Convertirle non varrebbe il rischio: `prenotazioni_utenti` è nella stessa condizione di `operazioni_addetti` (nessun canale, si aggiorna di rimbalzo) e da lì passa il controllo sovrapposizioni del check-out mezzi.
- 16 test in `scratchpad/test_kiosk_realtime.js`.

**Nota di metodo**: la barra più alta del mese è il 24 ago, 647 MB — erano le mie scritture massive (500 righe = 500 ricariche per postazione). Una correzione dati in blocco, finché quel meccanismo esisteva, costava più di una settimana di lavoro vero.

## Import ordini dall'estrazione ERP (25 ago, `2026-08-25.4`)
Nico voleva "caricare in automatico gli ordini" da `Cartel1.xlsx`, l'estrazione del portafoglio ordini dell'ERP (420 righe, 117 ordini, 16 clienti, esercizi 2024→2026).

**Un import c'era già, e su quel file avrebbe importato ZERO righe.** `operazioniImportExcel` esisteva dal principio, col pulsante in Pianificazione, ma cercava le colonne per **uguaglianza esatta** del nome ed era tarato sull'export *del gestionale stesso* (`Scadenza`, `Quantità`, `Cliente`). L'ERP le chiama `Data Rich. Evasione`, `Quantita UMI Ordine/Offerta`, `Ragione Sociale`: tre campi obbligatori senza colonna → 420 lette, 0 pronte. Il commento diceva "coerenti con l'import ERP" ma nessuno aveva mai avuto il file vero davanti. **Lezione: un mapping scritto su un formato immaginato è codice non provato, anche se il codice è giusto.**

**Le regole stanno in `analizzaImportOrdini(righe, ctx)` in `domain/scheduling.js`** — pura, nessun DOM, nessun Supabase, **114 test in `scratchpad/test_import_ordini.js`**. Ritorna il PIANO (nuove / aggiornamenti / bloccate / scartate / anagrafiche da creare) e non scrive niente: la UI disegna soltanto.

**Decisioni prese con Nico, tutte nel codice:**
- **Solo sezionale OC.** Le 89 righe OD si scartano *dichiarandole*. Il formato numero ordine dell'app è ancora `AAAA/OC/NNNNN` fisso ([app.js:6549], [app.js:9676]): se un domani gli OD devono entrare, va allargata quella validazione.
- **Senzani + riferimento che inizia per `EL` → le righe si FONDONO in una commessa sola**: articolo `BOX_<riferimento>`, descrizione `SBNE`, pos `0010`, quantità `1`, prezzo = **somma degli imponibili**. ⚠ Fusione di righe DEL FILE: **non c'entra la funzione "⊞ Raggruppa"** (`gruppo_id`), che spalma le ore fra commesse diverse. L'import non tocca nessun gruppo.
  - La regola **non è stata inventata: è stata verificata**. Gli 11 gruppi EL del file corrispondono uno a uno alle 11 commesse BOX già a sistema (`BOX_EL000506`→`2026/OC/00282`, …), stessi codice/descrizione/pos/qtà, articoli già in anagrafica con 775 o 990 min/pz. Il codice riproduce esattamente quello che c'era.
  - Il vincolo sul **cliente** resta esplicito anche se sui dati veri `EL` è esclusivo di Senzani (177 righe su 177): un altro cliente potrebbe usare la stessa sigla per cose sue.
- **quantità = `Quantita UMI Ordine/Offerta`** (l'ordinato). La `Quantità Residua` per ora non entra.
- **scadenza = `Data Rich. Evasione`**.
- **Prezzo importato in `prezzo_unitario`**, e **si applica la regola tariffa cliente** (prezzo ÷ €/h × 60 → minuti pagati), stessa scala di priorità di "+ Nuovo ordine". Oggi tocca solo Elcotec (unica con `tariffa_cliente`, 27,3): 13 voci.
- **Il file è una FOTOGRAFIA**: una commessa già presente si **aggiorna**, non si duplica. Chiave = `numero_ordine` + `pos`, unica su tutte e 420 le righe. Si toccano **solo quantità, scadenza e prezzo** — i campi che vengono davvero dall'ERP. Stato, fasi, addetti, note, gruppi e ore restano.
- **Una commessa `completata` o `spedita` non si tocca mai**, nemmeno per aggiornarla: si conta e si dichiara. Una fotografia dell'ERP non deve poter riaprire un lavoro finito. Sul file di oggi sono 19, fra cui **tutti e 11 i BOX**.
- **Clienti e articoli mancanti si creano al volo, elencati nome per nome nell'anteprima** prima di premere Importa: un refuso dell'ERP diventerebbe un'anagrafica nuova.

**Esito sul file vero** (provato con la libreria SheetJS vera, non con un parser mio): 420 lette → 93 scartate (89 OD + 4 senza codice articolo) → 327 righe utili → **150 singole + 11 BOX = 161 commesse**: 72 nuove, 64 da aggiornare, 6 già uguali, 19 chiuse e intoccate. 3 clienti e 8 articoli da creare.

**Tre difetti trovati provando sui dati veri, non ragionando:**
1. **`Riferimento Cliente` è DOPPIA nel file** (una vuota su 420, una piena su 393). SheetJS rinomina la seconda `Riferimento Cliente _1` — e le intestazioni dell'ERP **finiscono con uno spazio**, quindi togliendo il suffisso restava `"riferimento cliente "` che non combaciava con niente. Il riferimento arrivava vuoto e **nessuna riga Senzani veniva fusa**: la regola centrale non scattava, in silenzio. Ora fra colonne omonime vince **quella che ha davvero i dati dentro**.
2. **La sentinella 9999 non veniva riconosciuta sulla strada vera.** L'app legge con `cellDates:true`, quindi `2958465` arriva come **Date**, e il controllo sulla sentinella stava solo nel ramo numerico: una commessa sarebbe entrata con scadenza **31/12/9999**. Ora il filtro è su tutte e tre le strade (Date, seriale, testo). Trovato solo perché ho confrontato le due letture riga per riga — i **conteggi erano identici**, quindi non si vedeva da nessuna parte.
3. `instanceof Date` è falso fra contesti diversi: la data si riconosce dai metodi, non dal costruttore.

**Verificato anche il verso opposto**: il giro **esporta → reimporta** con l'export del gestionale continua a funzionare (le intestazioni dell'app restano fra i candidati, dopo quelle dell'ERP).

**`valoreAData` cancellata** da app.js: era la conversione date del vecchio import, rimasta senza chiamanti. Passava per l'ora locale e d'estate poteva arretrare di un giorno. La sostituisce `importOrdiniData` in domain.

**⚠ IL PRIMO IMPORT VERO HA CREATO 51 COMMESSE DOPPIE (25 ago, `2026-08-25.3`)** — e la segnalazione di Nico è arrivata su tutt'altro: *"hai creato duplicati di clienti già esistenti"*. I clienti erano 3; le commesse 51, e non si vedevano.
- **Causa**: la posizione veniva confrontata come TESTO con gli zeri davanti (`"0040"`), ma **191 commesse su 468 ce l'hanno corta** (`"40"`) — sono quelle create prima che la convenzione a 4 cifre esistesse. Non riconoscendole, l'import invece di aggiornarle ne creava una accanto. Ora `chiaveOp()` confronta la pos come **numero**; le nuove continuano a nascere con gli zeri, cambia solo il modo di CERCARE.
- **Secondo difetto, quello che si vedeva**: il cliente si cercava per nome minuscolo, e `CABLOTECH SRL` (ERP) non combacia con `Cablotech S.r.l.` (gestionale). Ora `importOrdiniChiaveNome()` toglie tutto ciò che non è lettera o cifra — la differenza sta **sempre** nella forma giuridica, mai nel nome. Provata su tutte e 32 le aziende: 32 chiavi distinte, **nessuna coppia di ditte diverse collassa**. E l'anteprima ora **dichiara** i clienti riconosciuti sotto altra dicitura: prima li collegava in silenzio o ne creava uno nuovo, e in entrambi i casi non lo diceva.
- **Perché l'anteprima non ha salvato niente**: elencava i 3 nomi sotto "anagrafiche create al volo" dicendo *"se vedi un nome che non riconosci, annulla"*. Ma quei nomi Nico li riconosceva benissimo — erano i suoi clienti. **Il controllo era tarato sui refusi, non sulle diciture diverse della stessa ditta**: chiedeva di riconoscere un nome, quando la domanda giusta era "questo esiste già?". E delle 51 commesse doppie l'anteprima non diceva proprio nulla: le contava fra le "nuove".
- **Lezione**: *le chiavi di confronto vanno provate contro i dati veri del database, non contro il file*. Il file era pulito e coerente; erano le **convenzioni interne accumulate negli anni** (pos corta, diciture diverse) a non combaciare. Un import è un innesto fra due storie, e la parte fragile è sempre quella di casa.
- **Effetto della correzione sullo stesso file**: da *72 nuove / 64 aggiornamenti / 19 bloccate* a **21 nuove / 103 aggiornamenti / 31 bloccate**, e **nessun cliente da creare**.
- **Pulizia**: `strumenti/annulla-import-25ago.sql`, a blocchi, con le verifiche prima delle DELETE. Stato accertato a database prima di scriverlo: i 51 doppioni hanno **zero timbri e zero addetti** (nessuno ci ha lavorato), 28 hanno fasi automatiche che se ne vanno con loro; le 3 schede cliente hanno zero riferimenti ovunque. Righe intere salvate in `scratchpad/doppioni_25ago.json` **prima** di proporre qualsiasi cancellazione. Restano fuori **4 coppie doppie preesistenti** (giugno/luglio, fra cui `2026/OC/00000`): non le ha fatte l'import.
- **ALNUS DETTA IL NOME DEL CLIENTE** (25 ago, `2026-08-25.4`, decisione di Nico dopo la domanda *"i clienti avranno lo stesso identico nome del file?"* — la risposta era **no**, ed era il caso peggiore). Prima: gli esistenti tenevano la dicitura del gestionale, i nuovi nascevano con quella di Alnus → col tempo si accumulava un **misto**. Ora l'import **RINOMINA** la scheda esistente per allinearla al file. Cambia solo `nome`: **l'id resta**, quindi commesse, storico, tariffe e ruoli non si muovono. Sul file di oggi sono **6 rinomine** (`Cablotech S.r.l.`→`CABLOTECH SRL`, `Teknox S.r.l.`→`TEKNOX S.R.L.`, `Senzani Brevetti S.p.a.`→`SENZANI BREVETTI S.p.a.`, `Metalmeccanica Rossi SRL`, `Fabbri Elio snc`, `Dal Pozzo Verricelli SRL`).
  - È **l'unica cosa in tutto l'import che riscrive un dato d'anagrafica**, quindi l'anteprima la mostra in giallo prima di eseguirla. Conseguenza accettata: i nomi diventano quelli di Alnus, maiuscole comprese, ovunque compaiano (Gantt, export, analisi); e un nome corretto a mano nel gestionale viene riscritto al prossimo import.
  - **Due casi in cui NON si rinomina**, entrambi dichiarati: (a) lo stesso cliente compare con **due diciture diverse dentro lo stesso file** — non c'è un nome giusto da scegliere; (b) il nome di arrivo è **già occupato da un'altra scheda** (tipicamente un doppione non ancora ripulito) — rinominare farebbe due schede identiche. *Un nome sbagliato è peggio di un nome vecchio.*
  - **Fra due copie della stessa ditta vince la PIÙ VECCHIA** (stessa regola delle commesse): è quella con le commesse attaccate. Serve davvero — finché i 3 doppioni del 25 ago sono lì, cercare per nome esatto aggancerebbe la scheda **vuota** nata quel giorno invece di quella vera. Per questo l'indice dei clienti è **uno solo, per chiave**, e non più "prima il nome esatto, poi la chiave".
- **I FORNITORI l'import non li tocca mai**: crea sempre e solo clienti (`is_cliente` sì, `is_fornitore` no) e nel file non c'è nessuna colonna fornitore. Oggi nessuna azienda è cliente e fornitore insieme.
- **✅ PULITO E RIFATTO, verificato a database il 25 ago.** Eseguito `strumenti/annulla-import-25ago.sql` (Nico, dal pannello) e poi il reimport con la `.4`. Esito controllato riga per riga contro il backup del 24 ago:
  - commesse **468 → 417** (51 doppioni tolti), **21** create oggi legittime tutte al loro posto;
  - aziende **35 → 32**, zero clienti doppi, **6 rinomine su 6 applicate** (`Cablotech S.r.l.`→`CABLOTECH SRL` ecc.);
  - timbri, fasi e addetti **orfani: 0**; commesse con cliente inesistente: 0;
  - **righe del backup del 24 ago sparite: 0** — la pulizia non ha toccato niente di vecchio;
  - restano le **4 coppie doppie preesistenti** di giugno/luglio, che l'import non aveva fatto e non ha toccato.
- **LA PROVA CHE CONTA: adesso l'import è IDEMPOTENTE.** Rilanciandolo sullo stesso file non fa più niente — `0 nuove · 0 aggiornamenti · 130 già uguali · 0 rinomine`. È la definizione di una fotografia fatta bene; stamattina la stessa identica operazione produceva 51 commesse doppie. **Questo è il controllo da rifare dopo ogni modifica all'import**: importare due volte di fila e pretendere che la seconda passata non cambi niente.
- 118 test in `scratchpad/test_import_ordini.js`, con tutte le regressioni dentro.

### La scadenza: ALNUS COMANDA, e il primo import l'ha dimostrato scomodo (25 ago)
Subito dopo il reimport le commesse **in ritardo sono passate da 4 a 49**. Non era un difetto: era la regola "il file è una fotografia, aggiorna la scadenza" che faceva il suo mestiere.
- **54 scadenze cambiate, 54 anticipate, ZERO posticipate.** Una distribuzione tutta da un lato non è mai casuale: è il segnale che qualcosa di sistematico sta succedendo, non che i dati sono cambiati.
- **Tutte e 67 le commesse toccate erano state modificate A MANO nel gestionale** dopo la creazione (`updated_at` ≠ `created_at`, quasi tutte luglio-agosto). E le due colonne data del file dicono la stessa cosa (differiscono su 2 righe su 420), quindi non era la colonna sbagliata. L'import stava riportando indietro la **ripianificazione fatta in reparto**.
- **Decisione di Nico: si lascia così.** *"Alnus dovrebbe sempre essere lo specchio del nostro programma"* — quindi la fonte è quella, e il gestionale fa bene ad allinearsi. **Nessun ripristino**: le 54 date restano quelle di Alnus.
- **Il ritardo diventa allora un SEGNALE UTILE, non un difetto**: dice che in Alnus 54 date sono rimaste indietro rispetto a quello che il reparto ha ripianificato, e 46 di quelle sono già scadute là dentro. L'elenco per allinearle è in `strumenti/date-da-allineare-in-alnus.xlsx` (31 Sacmi, 10 Elcotec, il resto sparso). I due ordini Sacmi `2025/OC/00497` e `00498` erano stati spostati di **303 giorni**.
- `strumenti/ripristina-scadenze-25ago.sql` esiste ma **NON è stato eseguito**: resta come marcia indietro se un giorno si cambia idea. Le date pre-import stanno comunque nel backup del 24 ago.
- **Da ricordare quando si tocca l'import**: guardare sempre il VERSO degli scostamenti, non solo quanti sono. "54 aggiornamenti" non dice niente; "54 su 54 nella stessa direzione" dice tutto.
- **I DUE SISTEMI DEVONO VIAGGIARE IN PARALLELO** (25 ago, `2026-08-25.7`, detto da Nico). Chiave di lettura che mancava: **l estrazione contiene SOLO gli ordini ancora in corso su Alnus**, ed e voluto. Quindi la presenza o l ASSENZA di una riga nel file **e essa stessa un informazione di stato**, e si legge nei due versi:
  - **nel file ma chiusa qui** = per Alnus e ancora da fare (oggi **20**, BOX esclusi);
  - **viva qui ma assente dal file** = per Alnus e finita (oggi **8**, tutte aperte). Fra queste `2026/OC/00209/0020`, quella della segnalazione di Cocco. Si distingue se e sparita **la riga** (l ordine c e ancora nel file: 3 casi) o **tutto l ordine** (5).
  - **I BOX Senzani restano FUORI dal conto** (decisione Nico): la la divergenza e strutturale — Alnus segue le 15-18 righe singole e le chiude quando sono evase tutte, qui c e un kit solo — e sarebbe rumore fisso a ogni import. Sono 11.
  - L import **non tocca nessuno stato**: nessuno dei due sistemi ha ragione per definizione. Dichiara e basta.
  - ⚠ **Le chiavi del confronto si prendono da TUTTE le righe OC lette, non dalle sole importabili**: una riga scartata (codice mancante) o fusa in un BOX sta comunque nel file, e guardando solo le voci la sua commessa sarebbe risultata **sparita da Alnus** quando invece e li. Sui dati di oggi non cambia il numero, ma il difetto c era.
  - **Le righe senza codice sono 5, non 4** — la quinta e `2026/OC/00395/0010` di **Elcotec** (SCHEMA ELETTRICO AVV.PARTISANI). Il 4 veniva da un mio lettore XML artigianale usato per le diagnosi; il conto giusto e quello di SheetJS, che e la strada vera dell app. Verificato sulla cella: e assente per tutte e cinque. **Morale: i numeri si prendono dallo stesso codice che gira in produzione, non da uno strumento parallelo scritto per l occasione.**
- ⚠ **`completata` NON e una divergenza** (27 ago, `2026-08-27.2`, segnalato da Nico: *"Alnus dice che l ordine e chiuso se spedito tutto"*). **I due sistemi chiudono in momenti diversi**: qui `completata` vuol dire che la PRODUZIONE ha finito, in Alnus l ordine si chiude solo a merce SPEDITA. Quindi prodotta-ma-non-spedita e lo stato normale di ogni commessa finita in attesa di partire.
  - Segnalarle riempiva l elenco di roba giusta: **14 righe su 18**. Ora in `chiuseQui` finisce solo `spedita` (la merce e partita e Alnus non lo sa) e le completate stanno in `prodotteNonSpedite`, dichiarate come contesto e non come problema. Sul file del 27: **da 18 a 4**.
- ⚠⚠ **...MA VALE SOLO SE LA RIGA STA NEL FILE** (28 ago, `2026-08-28.1`, trovato da Nico: *"perche 030/040 non ci sono? sempre del 2026/OC/00174"*). La regola qui sopra era stata ricopiata **anche sul verso opposto**, dove non regge: se la riga **non c e** nel file, per Alnus quell ordine e chiuso, e Alnus chiude **solo a merce spedita**. Quindi una commessa `completata` assente dal file dice il CONTRARIO di Alnus — la merce per loro e partita, per noi no — esattamente come una `aperta`.
  - `viveQui` usava `eChiusa` (completata **o** spedita) e ne **taceva 10**, tutte con **zero spedizioni registrate**. Ora l unico stato che si tace e `spedita`: li i due archivi concordano davvero. Sul file del 28: da 5 segnalazioni a **13** (5 aperte + 8 completate).
  - **La lezione e il rovescio di quella del 27**: la stessa parola (`completata`) risponde a due domande diverse a seconda del verso in cui si guarda. Prima di riusare una regola sull altro lato di un confronto, **rileggere che cosa significa l assenza di un dato da quel lato**.
  - Nello stesso giro: i **BOX Senzani** erano esclusi da `chiuseQui` ma **non** da `viveQui` — quel ramo parte dalle commesse a database, dove il marchio `origine:'box'` non esiste. Aggiunto `importOrdiniCommessaBox(codice, cliente)`: cliente Senzani **e** codice `BOX_*` o `*_BOX`. Il vincolo sul cliente non e decorativo — `PJS-BOX_TOUCH` e un prodotto vero e va segnalato.
- **I KIT BOX: si giudicano sul RIFERIMENTO** (28 ago, `2026-08-28.2`, chiesto da Nico: *"con i box come si fa? si fa un riferimento alle righe su Alnus?"*). La risposta e si, e **il legame c era gia nei dati**: `riferimento_cliente` e valorizzato su tutte e 16 le commesse BOX, e per le 11 create dall import il riferimento sta anche dentro il codice articolo (`BOX_EL000511`). Nessun campo nuovo da aggiungere.
  - **Perche la posizione non serve**: qui il kit e UNA commessa, in Alnus sono le 15-18 righe da cui e stato fuso. Le posizioni non combaciano mai — i kit vecchi stanno in pos `0020`, l import ne crea a `0010` — quindi il confronto per chiave li dichiarava sempre spariti. Da li l esclusione in blocco, che pero' voleva dire **non guardarli mai**.
  - **La regola**: il kit e finito per Alnus quando **di quel riferimento non resta nessuna riga nel file**. `rifSenzaniFile` raccoglie TUTTI i riferimenti Senzani, non solo gli `EL` che vengono fusi: i kit piu vecchi hanno riferimenti di altra forma (`A09102`, `D34807`) e vanno confrontati con la stessa domanda. Si raccolgono **prima degli scarti**, perche anche una riga scartata (scadenza mancante) resta la prova che quel kit di la e ancora aperto.
  - ⚠ **Il codice articolo batte la colonna**: su `BOX_EL000515` il `riferimento_cliente` dice `EL0000515` — uno zero di troppo — e preso da solo avrebbe dichiarato finito un kit con **18 righe ancora aperte** in Alnus. Il codice lo genera l import da quello stesso riferimento, la colonna la scrive una persona. Dove non c e ne l uno ne l altra **non si tace**: si torna alla regola generale, perche tacere per mancanza di dati e' il buco che si stava chiudendo.
  - **Sui dati del 28 ago**: 11 kit ancora aperti di la (taciuti a ragione: prodotti qui, Alnus aspetta la spedizione), 3 spediti e d accordo, **2 divergenze vere** — `2026/OC/00195/0020` (`SZ-A09103_BOX`) e `2026/OC/00202/0020` (`SZ-D34807_BOX`), completate qui con zero spedizioni e sparite da Alnus. **Zero falsi allarmi.**
  - **Le quantita restano fuori dal confronto**: 1 kit contro 15-18 righe non e paragonabile, e non lo diventa. Si confronta solo la PRESENZA.
  - E la stessa lezione della striscia sospette: *la difficolta non e trovare le anomalie, e non gridare al lupo*. Una segnalazione giusta 4 volte su 18 non si guarda piu.
  - **Regola da ricordare quando si confrontano i due sistemi**: prima di chiamare divergenza uno scarto, chiedersi se i due archivi stanno rispondendo alla STESSA domanda. Qui rispondevano a due domande diverse — "la produzione ha finito?" e "la merce e partita?".
- **SENZA CODICE ARTICOLO la riga NON si carica** (27 ago, regola di Nico che **sostituisce** quella del 25): sono voci **descrittive** — manodopera, minuteria — non pezzi da produrre. Il 25 le avevamo trattate come un ERRORE da correggere in Alnus, con un riquadro rosso: sbagliato, e cosi l ERP descrive certe voci. Restano **elencate** nell anteprima (sapere cosa non e entrato serve) ma senza rosso e senza "da correggere". Oggi sono le 4 righe di `2026/OC/00393` di Capirossi.
- **Gli OD NON ci riguardano** (25 ago, deciso): le 89 righe (tutte JMA, 26 ordini) restano scartate e dichiarate. Il formato numero ordine resta `AAAA/OC/NNNNN`. Punto chiuso, non riaprirlo per istinto.
- **QUANTITA RESIDUA: non si importa, si CONFRONTA** (25 ago, `2026-08-25.6`). Il gestionale la sa gia calcolare — ordinato meno spedito — e **la mostrava gia**: la cella `pronti / da spedire` nella tabella Ordini cliente (col dettaglio nel tooltip) e la sezione Spedizioni del modal. Provata la formula sui dati veri: **149 righe su 163 combaciano** con la residua di Alnus usando la tabella `spedizioni`. Quindi niente da costruire e niente da importare: e un derivato, e i derivati restano vivi (regola di casa).
  - Quello che mancava e il **controllo incrociato**: dove i due numeri non tornano non c e un dato da correggere, c e **una spedizione che uno dei due sistemi non ha registrato**. L anteprima ora le elenca dicendo da che parte sta il buco. Sui dati di oggi: **10 righe, 6 da sistemare in Alnus e 4 qui**.
  - **Due di quelle hanno anche l ORDINATO diverso** e vengono marcate a parte: sono commesse chiuse, che l import non aggiorna mai, quindi le due residue non partono nemmeno dalla stessa base. Confrontarle senza dirlo avrebbe fatto leggere una riga che non sta in piedi.
- **Gli ACCENTI nelle intestazioni** (25 ago): lo stesso foglio scrive `Quantita UMI Ordine/Offerta` senza accento e `Quantità Residua` con. Il riconoscimento colonne ora li toglie da tutte e due le parti (`senzaAccenti`) invece di inseguire le varianti nella lista dei candidati — la colonna residua era gia sfuggita proprio cosi.
- **UNA FORMA SOLA PER LA POSIZIONE** (25 ago, `2026-08-25.5`, richiesta Nico): `posNormalizzata()` in domain (10 test) porta a 4 cifre con gli zeri davanti, e si applica in ENTRAMBE le porte d inserimento — modal commessa e griglia nuovo ordine — piu un `onblur` che la mostra gia mentre si scrive. Prima la pos auto della griglia era paddata ma una digitata a mano no: bastava quello per rimettere in circolo la doppia forma.
  - Le 191 gia a database si allineano con `strumenti/allinea-posizioni.sql` (**dal pannello**: l account tecnico non puo scrivere sulle commesse, l RLS rifiuta in silenzio con HTTP 200 e zero righe — provato). **Una resta fuori**: `2026/OC/00000` pos `10`, che allineata si scontrerebbe con la `0010` dello stesso ordine. E la stessa riga di prova gia segnalata. Marcia indietro in `scratchpad/pos_prima_del_cambio.json`.
  - Non serve piu al codice (il confronto e numerico dalla `.3`): serve a non lasciare in giro due forme della stessa cosa, che e la trappola in cui e caduto l import.

**Cosa NON c'è ancora / da chiarire con Nico:**
- **`numero_op` non è nel file** e resta vuoto: è l'unico campo che l'estrazione non porta.
- Le **4 righe senza codice articolo** (Capirossi, una è `MANODOPERA`) restano fuori: non si indovina un codice.
- La **`Quantità Residua`** non entra da nessuna parte — Nico ha detto che dovrebbe allinearsi a quanto resta da spedire, ma non abbiamo deciso se e dove mostrarla.
- Un **BOX nuovo nasce senza min/pz** (l'articolo `BOX_...` non esiste ancora): l'anteprima lo dichiara in giallo. Le 11 esistenti hanno 775/990 messi a mano.
- **L ANTEPRIMA E RIORDINATA IN TRE BLOCCHI** (27 ago, `2026-08-27.11`, richiesta Nico: *"la schermata di riassunto e bella piena, si puo allargare e ordinare in maniera che un non addetto ci capisca?"*). Erano **tredici sezioni in fila**, cresciute per accumulo: ognuna aggiunta senza ripensare l insieme, e messe insieme non raccontavano niente. Ora rispondono a tre domande, in quest ordine:
  1. **Cosa entra nel gestionale** — KPI, aggiornamenti, anagrafiche create, rinomine, BOX Senzani, note sul tempo pagato. *Solo questo viene scritto premendo Importa.*
  2. **Cosa resta fuori** — commesse chiuse non toccate, righe descrittive, nomi lasciati come sono, righe scartate.
  3. **Da guardare: Alnus e gestionale non concordano** — stati e spedizioni. *Nessuna di queste righe viene modificata.*
  - Larghezza da 820 a **1100px**.
  - **Come e fatto, che e la parte da non rompere**: ogni sezione appende in una variabile `dest`, e i tre contenitori (`bScrive`, `bFuori`, `bGuarda`) si assemblano in fondo. **Riordinare non vuol dire spostare codice**: basta cambiare la riga `dest = ...` prima della sezione — per questo la modifica non ha toccato una riga di logica. Aggiungendone una nuova, ricordarsi di assegnarle un blocco o finisce nell ultimo usato.
  - Le KPI usano `prepend`: a quel punto le sezioni hanno gia scritto dentro `bScrive` e un append le metterebbe in fondo.
- **Non è "automatico" nel senso di "parte da solo"**: GitHub Pages è statico. Si trascina il file, si guarda l'anteprima, si conferma. Il passo successivo (una cartella guardata da uno script) sarebbe infrastruttura nuova.

## Accesso di Claude alle scritture (25 ago 2026)
Domanda di Nico: *"ma tu non avevi un account per poter far tutto sull app?"* — e la risposta era **no, non per quello**.
- `claude@cablotec.local` esiste ed e nei profili, ma con **`ruolo = user`**, e `accesso-claude.sql` gli dava solo tre cose: aggiungi colonna, crea indice, scrivi su `attivita_extra`. **Niente su `operazioni` e `aziende`** — quindi l allineamento delle 190 posizioni sarebbe stato rifiutato uguale. Quello che avevo usato era l account **kiosk**, che e `user` anche lui.
- **L RLS rifiuta in silenzio**: HTTP 200 e zero righe toccate. Non un errore, proprio niente. E il modo piu facile per credere che una scrittura sia andata.
- **Decisione: si apre il solo UPDATE** su `operazioni` e `aziende` (`strumenti/accesso-claude-scritture.sql`), con policy mirate sull utente dedicato e **senza promuoverlo admin** — stessa filosofia del primo file, il permesso sta sull operazione e non sul ruolo. **INSERT e DELETE restano fuori.**
- Onesta sul perche: la protezione attuale **non ha impedito il danno del 25 ago**, perche l import e passato dalla sessione admin di Nico nel browser. La frizione non proteggeva le scritture; sulle **cancellazioni** invece si — i 51 doppioni li ha cancellati lui dopo aver visto i numeri, e quel passaggio e il valore, non l attrito.
- ⚠ **L UPDATE non si puo limitare a certe colonne** (Postgres non lo fa nelle policy): `stato` compreso, quindi in teoria si puo riaprire una commessa spedita. Resta la regola di sempre: dichiarare quante righe tocca, salvarle su file, aspettare l ok.
- **La password sta in un file locale e in questa sessione la lettura e stata bloccata** — non e stata aggirata. Da rivedere quando servira davvero l accesso.

## Egress, secondo atto: la porta piu grossa era il GESTIONALE, non il kiosk (27 ago, `2026-08-25.9`)
Il grafico del 26 ago — **giornata pulita**: Nico assente, nessuno script mio — dice **~125 MB** (110,5 PostgREST + 14,7 Realtime + 0,35 Auth). La correzione del kiosk ha morso, ma **a meta**: da ~200 MB a 125, non a 10. Come diceva l handoff, *se il numero non crolla la diagnosi era incompleta*.
**Misurato, non stimato** — peso reale in rete (byte compressi) di una passata:
- **kiosk `kioskLoadAll`: 205 KB** -> servirebbero **551 ricariche** al giorno per fare 110 MB. Non credibile.
- **admin `loadAllData`: 604 KB** -> **187 ricariche**. Su 7 admin fanno **27 ritorni-sulla-scheda a testa**: del tutto ordinario.
- Dentro i 604 KB, **316 sono `sessioni_lavoro`**: il gestionale riscarica **tutto lo storico timbri** (3.548 righe, 4 pagine) ogni volta.
**Il difetto**: `visibilitychange` chiamava `loadAllData()` a OGNI ritorno sulla scheda del browser. E sopra i 30 s di assenza ne partivano **DUE**: `ricreaConnessione()` uccide il canale, la ri-sottoscrizione fa gia il suo recupero, e poi `visibilitychange` ne faceva un altro. Stessa famiglia del difetto del kiosk: **ricaricare tutto dove bastava non ricaricare niente.**
**La cura**: il recupero del realtime e ora l UNICO padrone della ricarica. `onRiconnessione` segna `_rtNeedCatchup`, la ri-sottoscrizione ricarica **una volta sola** e ripristina la scheda con `switchToTab`. Al rientro veloce, se il canale e ancora agganciato (`realtimeVivo`) **non si scarica niente**: `applyChange` tiene gia aggiornate tutte e 20 le tabelle riga per riga. `ricreaConnessione()` NON e stata toccata: la cura del freeze dei salvataggi resta identica.
**Rete di sicurezza** (`ricaricaSeIlRealtimeNonRisponde`, 8 s): se il realtime resta giu mentre il resto della rete va, il recupero non arriverebbe mai e i dati resterebbero fermi — prima quel caso era coperto dalla ricarica incondizionata. Ora si ricarica lo stesso, **una volta**, non a ogni rientro.
**Da verificare sul campo**: la giornata tipo deve scendere **sotto i 20 MB**. Se resta sopra i 100, la porta e ancora un altra e si ricomincia a misurare — il metodo che ha funzionato e stato **pesare i byte veri di ogni passata** e dividere, non ragionare su chi sembrava colpevole.
**Nota di metodo, pagata due volte oggi**: avevo prima accusato il `visibilitychange` sui numeri sbagliati, poi l avevo scagionato perche Nico era assente — ed era vero che lui non c era, ma gli **altri sei admin** si. La stessa ipotesi era giusta per una ragione che non avevo guardato. Misurare prima, incolpare dopo.

## Fabbisogno: TIPO PARTE, tre mestieri che prima erano uno solo (27 ago, `2026-08-27.1`)
L estrazione ha una colonna nuova, **Tipo Parte**. Nico ne annunciava due, **nel file ce ne sono TRE**:
- **ACQ** (24 righe) = lo compriamo noi -> c e un ordine da emettere
- **C/L** (222) = conto lavoro -> arriva dal **CLIENTE**, non si ordina. Nessuna di queste ha fornitore o data prevista: coerente, non le ordina nessuno.
- **MAC** (41) = materiale di consumo, tutte `FILO ...` -> **non ferma niente** (decisione Nico).
**Il problema che risolve**: `mancanteBloccante` era solo `qta_da_ordinare > 0`, quindi tutte e 283 le righe finivano nel rosso "da ordinare". Su 29 commesse toccate, **20 mostravano un rosso da 48, 36, 28 codici** quando non c era niente da ordinare. **Un rosso che si accende sempre smette di voler dire qualcosa.**
**Effetto misurato sul file vero: commesse col badge rosso da 29 a 9.**
- `mancanteCategoria(m)` in domain (20 test) ritorna `da_ordinare` / `attesa_cliente` / `in_arrivo` / `consumo`. L ordine dei controlli e la regola: prima cosa manca davvero, poi di chi e la mossa.
- Tre colori: **rosso** tocca a noi, **arancio** lo manda il cliente, **giallo** ordinato con data. `nBloccanti`, `nAttesaCliente`, `nConsumo`, `nInArrivoVero` in `mancantiCommessa`; `nInArrivo` resta com era (tutto cio che non blocca) per non cambiare significato sotto ai punti che lo usavano gia.
- ⚠ **RETROCOMPATIBILITA**: le righe importate PRIMA del 27 ago non hanno `tipo_parte` e si comportano **esattamente come prima** (da ordinare se qta > 0). *Un dato vecchio non deve cambiare significato solo perche e arrivata una colonna nuova.*
- ⚠ **Un tipo mai visto finisce fra i "da ordinare"** e l anteprima lo dichiara in giallo: meglio un falso allarme che una riga che sparisce.
- **Migrazione `mancanti.tipo_parte`**: `strumenti/migrazione-tipo-parte.sql`. **Senza, l import NON si rompe**: si accorge che la colonna manca (stesso trucco di `aziende.tariffa_oraria`: `'tipo_parte' in m`), salva tutto il resto e lo dichiara. Nessuna fretta.
- Il CSV e in **Windows-1252**, non UTF-8 (`Disponibilità` arriva rotta se letto come UTF-8). L app lo legge gia da se, la libreria xlsx non entra in gioco.
## 34 commesse che non si vedevano da NESSUNA parte (27 ago, `2026-08-27.3`)
Nico, due volte in mezz ora: *"2026/OC/00011 perche non lo vedo sull app?"*, poi *"2026/OC/00128 anche questo non lo vedo"*. Non era lui a cercare male.
- **Ordini cliente filtra via le `spedita`** (`pianificazioneFiltrate`): stanno nello Storico, e fin qui e voluto.
- **Ma lo Storico e EVENTO-centrico**: ogni riga e una SPEDIZIONE, letta da `state.spedizioni`. Una commessa marcata `spedita` **senza nessuna riga in `spedizioni`** non compare nemmeno li.
- Il commento in `storicoFiltrate` diceva *"sono visibili dalla Pianificazione"* ed era **SBAGLIATO**: la Pianificazione le filtra via. Quindi erano invisibili in tutte e due le schede dove uno le cerca. **Nemmeno il Gantt le mostra tutte** (corretto dopo l obiezione di Nico: *"il gantt deve riprendere gli ordini, come e possibile che contenga ordini che non si vedono in ordini o storico?"*). Il Gantt disegna per **operatore o fornitore assegnato**: serve una riga in `operazioni_addetti` o `operazioni_fornitori`. Delle 34: 10 hanno un addetto, 6 un fornitore, **21 nessuno dei due -> invisibili in TUTTA l app**. `2026/OC/00011` e `2026/OC/00128` sono fra queste.
  - La ricerca del Gantt le TROVA (cerca su `state.operazioni` senza filtri) ma cliccando si atterra su un Gantt dove non c e nessuna barra: e una seconda caccia a vuoto, peggio della prima.
  - **Il buco non e del Gantt: e delle tre viste che insieme non coprono tutto.** Ordini cliente nasconde le spedite (voluto), lo Storico elenca le SPEDIZIONI, il Gantt elenca il LAVORO ASSEGNATO. Una commessa spedita, senza spedizioni e senza addetti non e in nessuno dei tre insiemi.
- **Sono 34**, tutte create il **19 mag 2026** col primo popolamento: ordini gia chiusi prima che il gestionale esistesse, inseriti come spediti. Le spedizioni si registrano dal 28 mag, e da giugno in poi ogni spedita ne ha almeno una. **Non sono un difetto di dati**: e il caricamento iniziale.
- **Cura**: la schermata vuota di Ordini cliente ora dice **dove sta davvero** quello che cerchi, in TRE casi — con spedizioni -> bottone allo Storico; senza spedizioni ma con addetti -> bottone al Gantt; **ne l uno ne l altro -> la commessa si mostra LI**, cliccabile per aprirla, perche non c e nessun posto dove mandarti. Prima diceva solo *"Nessuna operazione corrisponde ai filtri"*, che si legge come **non esiste**.
- **Lezione**: *"non lo trovo" e "non esiste" sono due risposte diverse, e una schermata vuota le confonde.* Quando una vista nasconde qualcosa per scelta, la schermata vuota deve dire dove e finito.
## Ordini cliente e Storico: due schede, nessun buco (27 ago, `2026-08-27.5`)
Nato dalla domanda di Nico *"il gantt deve riprendere gli ordini, come e possibile che contenga ordini che non si vedono in ordini o storico?"*. Aveva ragione: **21 commesse non si vedevano da nessuna parte**. Ordini cliente nascondeva le spedite, lo Storico elencava le SPEDIZIONI e il Gantt il LAVORO ASSEGNATO — una commessa spedita, senza spedizioni registrate e senza addetti non stava in nessuno dei tre insiemi.
**La regola ora e UNA SOLA e sta in domain** (`commessaInStorico`, 16 test), cosi le due schede non possono contraddirsi:
- non spedita -> **Ordini cliente**
- spedita da meno di **30 giorni** (`GIORNI_SPEDITE_IN_ORDINI`) -> **Ordini cliente**, sotto il chip SPEDITE
- spedita da piu di 30 -> **Storico**
- spedita **senza data di spedizione** -> **Storico** (sono le 34 del caricamento del 19 mag: non avendo una data da cui contare il mese, tenerle in Ordini cliente vorrebbe dire tenercele per sempre)
**Verificato sui dati veri: 422 commesse = 221 + 201, zero in tutte e due, zero in nessuna.** E la prova da rifare dopo ogni modifica a queste due schede (`scratchpad/prova_coperture.js`).
- **Lo Storico e diventato COMMESSA-centrico**: una riga per commessa invece che una per spedizione. Costo misurato prima di deciderlo: solo **9 commesse su 219 hanno piu di una spedizione**, e il dettaglio resta nella sezione Spedizioni del modal. La riga porta data e DDT dell ULTIMA spedizione ma la quantita e il TOTALE spedito (con un `*` quando le spedizioni sono piu d una). Le righe senza spedizione dicono **"non registrata"** invece di inventare una data.
- **"Tutte" vuol dire TUTTE** (`2026-08-27.6`, corretto subito da Nico: *"con filtro tutte non vedo le spedite"*). Avevo fatto in modo che il chip `all` escludesse le spedite dell ultimo mese, e **un filtro che si chiama Tutte e nasconde qualcosa dice una cosa falsa** — per giunta il conteggio in alto (221) non corrispondeva alla lista sotto (173). Ora `all` non toglie niente: cosa la scheda non mostra e gia deciso dal confine con lo Storico, e non serve una seconda regola sopra.
- **L etichetta del chip dice la REGOLA, non il numero**: "Spedite (ultimi 30gg)" e non "Spedite (48)". Il numero non spiega perche sono quelle e non altre; la regola si, e chi apre la scheda capisce da solo dove sono finite le piu vecchie.
- ⚠ **Effetto a catena sull export**: con le spedite recenti dentro la scheda, la spunta "Includi anche le spedite" diceva il falso e contava 249 commesse che in gran parte c erano gia. Ora e "Includi anche lo Storico" e conta solo quelle che AGGIUNGE davvero (201).
- **Ordini cliente: tre colonne ORDINATI / PRODOTTI / SPEDITI** al posto della cella unica `prodotti/ordinati`, che non diceva quanto era uscito.
- **Scheda MAGAZZINO tolta**: elencava le commesse con giacenza (prodotti meno spediti), ed e diventata ridondante — la giacenza e la differenza fra le ultime due colonne nuove. `pezziInMagazzino()` resta: serve al controllo "non puoi spedire quel che non hai prodotto".
- **La schermata vuota di Ordini cliente** non avvisa piu di buchi (non ce ne sono): dice in quale delle due schede sta quello che cerchi e ci porta, distinguendo *spedita di recente* (chip SPEDITE) da *nello Storico*.
- ⚠ **Trappola trovata scrivendolo**: l export ha una spunta "includi anche le spedite"; con l esclusione delle spedite applicata anche al ramo `all`, la spunta non avrebbe piu fatto niente. Il filtro di stato ora si salta quando chi chiama chiede esplicitamente lo storico.
## Registrare una spedizione scriveva solo META del gesto (27 ago, `2026-08-27.7`)
Nico, guardando le colonne nuove: *"non vedo lo stato Spedita per quelle che hanno i 3 campi completi"*. Ha ragione, ed era **una sola commessa** — `2026/OC/00107/0020`, 4 ordinati / 4 prodotti / 4 spediti e ancora `completata`. Ma la causa era strutturale.
- **L asimmetria**: il bottone "Registra spedizione" faceva subito la INSERT su `spedizioni`, poi per lo stato si limitava a impostare il campo nel form con un toast *"salva per confermare"*. Chi chiudeva il modal senza salvare lasciava la spedizione scritta e lo stato indietro.
- **Regola**: *le due meta dello stesso gesto devono avere la stessa sorte.* Se una scrive subito, l altra non puo aspettare un salvataggio che e facilissimo saltare. Ora lo stato (e `consegnato_il` se vuota) si scrive nella stessa mossa; se quella UPDATE fallisce lo dice, perche la spedizione a quel punto e gia registrata.
- **Il contrario e molto piu diffuso e NON e un difetto**: 34 commesse sono `spedita` con spediti < ordinati, e sono tutte quelle del caricamento del 19 mag, senza nessuna spedizione registrata. Non toccarle per uniformare i numeri: non sono mai passate dal registro spedizioni perche a quell epoca non esisteva.
- La riga anomala resta da sistemare a mano (bastano due clic dalla tendina Stato), **ma va guardata**: su quella stessa commessa Alnus dichiara ancora 2 pezzi residui, quindi marcarla spedita qui e una decisione, non un adempimento.
## Lo stato resta una DICHIARAZIONE, ma deve reggere ai fatti (27 ago, `2026-08-27.8`)
Nico aveva prima proposto uno stato **derivato** dai fatti, poi ci ha ripensato e ha scelto meglio: *"un ordine nuovo si apre con aperta; se lo sposto in completata mi deve dire di dover produrre tutto; se sposto in spedita stessa cosa deve chiedermi di spedire tutto"*.
**Perche la derivazione pura era sbagliata, misurato prima di scartarla**: su 422 commesse ne sarebbero cambiate 35, e **34 nella direzione sbagliata** — 28 da `spedita` ad `aperta` e 6 a `completata`, tutte del caricamento del 19 mag. Sono `spedita` **per dichiarazione**, non per registrazione: non hanno spedizioni sotto perche il registro non esisteva. **Derivare tratta "nessun dato" come "nessun fatto", e sono due cose diverse.**
**La forma scelta**: lo stato lo decide una persona, ma se lo stato che dichiara non e sostenuto dai dati, il gestionale **avvisa e poi CREA i fatti mancanti** — un lotto di produzione, una spedizione — e solo dopo cambia stato. Cosi lo stato non dice mai una cosa che i numeri non confermano. Lo schema esisteva gia per `completata`; ora c e anche per `spedita`, che in piu registra il lotto se manca pure la produzione (non si spedisce quel che non si e prodotto).
- ⚠ **C erano DUE porte per cambiare stato e una sola era sorvegliata**: la tendina nella lista passava da `quickStato` e chiedeva conferma, il **modal salvava `stato` dritto nel payload** senza nessun controllo. Da li si poteva dichiarare spedita una commessa con zero spedizioni. E la stessa trappola dei timbri chiusi da due strade diverse: **se esistono due porte, una si dimentichera del controllo.**
- Il controllo sta ora in `fattiPerStato(op, nuovoStato)` (costruisce e chiede) e `scriviFattiPerStato` (scrive), usati da **tutte e due** le porte. I fatti si scrivono SEMPRE prima dello stato: se falliscono, non resta una commessa dichiarata chiusa senza le righe che lo dimostrano.
- Il toast dice **cosa e stato scritto** ("prodotti 4 pz e spediti 4 pz · commessa spedita"), non solo che e andata: quei pezzi entrano nei conti, e devono comparire da qualche parte.
- ⚠ **La tendina di stato in Ordini cliente restava VUOTA sulle spedite** (`2026-08-27.9`, segnalato da Nico). Aveva solo tre opzioni — Aperta, Sospesa, Completata — perche prima le spedite in quella scheda non arrivavano mai; portandocele, `sel.value = 'spedita'` non trovava nessuna opzione e il menu si svuotava. **Quando una vista comincia a mostrare dati nuovi, i controlli che li disegnano vanno ripassati.** Scegliere "Spedita" non cambia lo stato di colpo: apre `quickSpedizione`, che chiede data, quantita e DDT e non lascia spedire quel che non e stato prodotto.
- ⚠ **I fatti si creano solo se lo stato AVANZA** (`aperta`/`sospesa` 0 < `completata` 1 < `spedita` 2). Tornando indietro non si inventa niente: sulle 34 caricate a maggio — spedite con zero produzione registrata — passarle a "completata" avrebbe proposto un lotto pari all intero ordine, cioe **produzione mai avvenuta inventata per far quadrare una marcia indietro**. 10 test in scratchpad/test_fatti_stato.js.
- **Non toccare le 34 del caricamento** per uniformare i numeri: la loro dichiarazione e l unica verita che c e.
## ▶ Fili aperti (in ordine di priorità)

### 0-bis. DA VERIFICARE il 25 ago: la correzione egress ha morso davvero?
Due controlli, cinque minuti, **da fare prima di dichiarare chiusa la faccenda quota**:
1. **Dashboard Supabase → org Cablotec SRL → Usage → Egress → grafico "Egress per day"**. La barra del 25 ago deve essere **una frazione** di quelle del 18-24 (giornata tipo ~200 MB, attesa ~10 MB). Se è ancora sui 200 MB la diagnosi era incompleta: **il divario è altrove e va ripreso a scavare**, non è il caso di aggiungere altre ottimizzazioni a caso.
2. **Prova sul campo con due postazioni kiosk** (tocca il pezzo che non deve rompersi): A avvia un lavoro → B lo deve vedere comparire; A chiude una fase → B la deve vedere chiusa. Se B resta indietro, il sospetto n.1 è `kioskSyncAddetti`.

Numeri di riferimento per il confronto: ciclo 27 lug-27 ago chiuso a **6,26 GB su 5 inclusi** (1,26 di sforo), restrizione annunciata dal **22 set 2026** se l'organizzazione resta sopra. Il ciclo che conta è quello che parte il **27 ago**: atteso **1-1,5 GB**. Se il numero regge, **Pro non serve**.

### 0. ~~Timbri extra: due buchi~~ **CHIUSI da Nico il 7 ago: si lascia stare, tutti e due**
Contati sui dati veri prima di decidere (backup del 7 ago, 2.208 sessioni):
- **Sessioni oltre 7 h in TUTTO lo storico: UNA.** Quella da 64,6 h. Una chiusura automatica di fine turno preverrebbe un evento ogni dieci settimane, col rischio concreto di troncare il timbro a chi lavora davvero fino a tardi. **Decisione: niente chiusura automatica.** Se ricapita più spesso, se ne riparla coi numeri in mano.
- **Timbri sotto i 3 minuti: 215, il 9,7% di TUTTE le timbrature** (non 8: quelli erano solo gli extra). 140 durano meno di 10 secondi. **186 su 215 sono seguite entro 5 minuti da un altro timbro della stessa persona**, e solo 28 sulla stessa commessa: la firma del bottone sbagliato, chiuso subito e ripreso su quello giusto. Non è l'abitudine di uno — Fabrizio 45, Alessio 44, Massimo 30, Raoul 29. **Valgono 1,43 h in totale su ~3.600**: non spostano nessun numero economico, sporcano solo gli elenchi. **Decisione: si lasciano.**
- Il banner della scheda **Live** (`aggiornaLiveWarnBanner`, soglia 7 h) copriva già il caso lungo **mentre succedeva**: quel timbro c'era, dal venerdì sera al lunedì mattina. Non è mancata la rilevazione, è mancato qualcuno davanti allo schermo. È una vista del PRESENTE (aperte + chiuse iniziate oggi), non dello storico: per questo oggi quella sessione non compare più.
- **Difetto corretto lì dentro** (7 ago, `2026-08-07.3`): `iniziataOggi` confrontava `s.inizio.substring(0,10)`, cioè la data **UTC**, con la data **locale** di oggi. D'estate un timbro fatto prima delle 02:00 porta ancora la data del giorno prima e sarebbe stato escluso dal banner proprio il giorno in cui è stato fatto. Ora si confronta `toLocalISO(new Date(s.inizio))`. Da Cablotec non mordeva (primo timbro alle 5:20) ma era lì in attesa. Stessa trappola della sezione ⚠ ORARI.

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

### 3. Accorpamento commesse (gruppi) — **COLLAUDATO DAI DATI** (7 ago)
- Admin: Ordini cliente (ex Pianificazione, rinominata 14 lug — id interno resta `pianificazione`) → `⊞ Raggruppa` → selezione → Crea gruppo; badge `⊞N`, click per sciogliere. Kiosk: gruppo = UNA card (banner), split del timbro alla chiusura **proporzionale al peso = qtà × min/pz** (5+2+7 → 500/200/700, 18 test). Insert+update, mai delete (RLS: l'account kiosk NON può cancellare).
- **Non serviva una prova: era gia' in produzione.** Verificato sul database il 7 ago: **13 gruppi attivi, 101 timbri spalmati, 501 righe di quota** generate dal 14 lug. Lo split e' **esatto anche nel caso non uniforme** (Fabrizio su OC/00329: pesi 365/1440/1440 → quote 5,2 / 20,5 / 20,5 min), zero scostamenti su tutte le catene. NB: le quote NON sono sovrapposte, sono **fette consecutive** dell'intervallo — cercarle come timbri sovrapposti non le trova.
- Limiti v1 che restano: "fine fase" non propaga al gruppo; **fase_id null sulle copie**, quindi quelle ore non finiscono in nessuna fase del consuntivo per fase.

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

## ACCESSO DI CLAUDE AL DATABASE (7 ago 2026)
- **Account dedicato** `claude@cablotec.local` (password in un file **locale fuori dal repo**, percorso noto a Nico; mai in chat, mai nel repo — che è pubblico). Distinto dall'account kiosk.
- **Migrazioni additive da solo, DROP impossibile per costruzione.** Il permesso non sta sul ruolo ma sulle OPERAZIONI: due funzioni `SECURITY DEFINER` in `strumenti/accesso-claude.sql` — `mig_aggiungi_colonna(tabella, colonna, tipo)` e `mig_crea_indice(tabella, colonna)` — chiamabili via RPC REST. Il DROP non è vietato: **non esiste una funzione che lo faccia**.
  - **Perché così**: `ADD COLUMN` richiede di essere **proprietario** della tabella, e il proprietario può anche fare `DROP`. "Scrittura sì, DROP no" come ruolo Postgres **non esiste**. In più su questa macchina non c'è `psql`: il canale è REST, quindi un utente Postgres non sarebbe nemmeno utilizzabile.
  - Nomi validati con regex, tipi da lista chiusa, idempotenti (rilanciarle non è un errore). Il controllo di **chi** può chiamarle sta DENTRO le funzioni (`auth.jwt() ->> 'email'`) e non sul grant, perché la chiave anon è pubblica come tutto il repo.
  - Policy `attivita_extra_claude`: scrittura sull'anagrafica attività per il solo utente dedicato, in aggiunta alle regole esistenti.
- **Restano a Nico, di proposito**: `DROP`, `TRUNCATE`, `CREATE TABLE`, modifiche a RLS e permessi. Le tabelle nuove capitano poche volte l'anno ed è il momento in cui un secondo paio d'occhi serve di più.
- **Regole di condotta**: migrazioni sempre additive; su qualsiasi cosa distruttiva prima si dichiara **quante righe tocca** e si aspetta l'ok, e le righe interessate si salvano su file **prima**. Il 7 ago la differenza fra disastro e fastidio è stata esattamente un file salvato il giorno prima.
- **Collaudato subito** sulla migrazione del riferimento: colonna + colonna + indice, e la riesecuzione risponde "esiste già" senza rompere niente.

## BACKUP — `strumenti/backup.js`
- `node strumenti/backup.js` scarica **ogni tabella** via REST in `..\backup-gestionale\AAAA-MM-GG_HHMM\`, un JSON per tabella. Provato: **6.521 righe in 24 tabelle**.
- **Fuori dal repo apposta**: il repo è PUBBLICO, un backup dentro pubblicherebbe i dati di tutta l'azienda. C'è anche `.gitignore` come seconda rete.
- Paginato come `fetchTutte` (oltre 1000 righe PostgREST perde il resto in silenzio, e `sessioni_lavoro` è a 2205). Esce con **errore se scarica zero righe**: un backup vuoto è peggio di nessun backup, perché sembra che ci sia.
- **SCHEDULATO** (7 ago): operazione pianificata **"Backup Gestionale Cablotec"**, ogni giorno alle **22:00**. Provata lanciandola davvero: `LastTaskResult 0`, riga nel log, cartella creata.
  - **Percorsi UNC, mai `Z:`** — è la cosa da non dimenticare. `Z:` è un drive **mappato** su `\\srv02\dati` e le lettere di unità vivono nella sessione interattiva: un'operazione pianificata non le vede, e con `Z:` il backup notturno fallirebbe **in silenzio**.
  - Gira come **utente interattivo**: senza credenziali salvate è l'unico modo di raggiungere la condivisione di rete (un task "anche se l'utente non ha eseguito l'accesso" senza password usa S4U, che non ha accesso alla rete). Conseguenza accettata: se alle 22:00 il PC è spento, il backup **non salta** — parte alla prima occasione utile (`-StartWhenAvailable`).
  - **Rotazione**: si tengono tutte le cartelle degli ultimi **45 giorni**, e delle più vecchie solo la **prima di ogni mese**. A 2,4 MB a botta, senza rotazione sarebbero 875 MB l'anno.
  - **Log** in coda in `backup-gestionale\backup.log`: se una notte salta, si vede da lì invece di scoprirlo il giorno in cui il backup serviva.
  - Comando di ricreazione e comandi di controllo: in fondo a `strumenti/backup.js`.
- **Resta aperto**: il backup sta sullo **stesso server** dei dati di lavoro (`\\srv02\dati`). Protegge dagli errori umani — che è il caso successo — non dalla perdita del server. Una copia fuori sede sarebbe il passo dopo.

## Strumenti della sessione (riusabili)
- **DB in lettura via API REST** con account kiosk (`kiosk@cablotec.local` / vedi core/db.js): per diagnosi su dati reali. curl con `--ssl-no-revoke` su questa macchina. L'account NON può DELETE (RLS) — per cancellazioni: SQL dal pannello (Nico).
- **Test Node a tavolino** in scratchpad: suite test_livella/finestra/fasi_eff/mero/interne/quote/stima/gruppo/listino — caricano domain/scheduling.js con stub. Rilanciarle dopo modifiche al domain.
- **Data realistica** nel modal commessa nuova: motore `livellaOperatore` + `stimaFineCommessaNuova` (coda addetti + ferie → fine in avanti). Fondamenta per Gantt livellato / autodistribuzione futuri.
## Leggibilità e temi (31 lug, `2026-07-31.7`)
- **Si MISURA, non si stima** — come per il layout. `scratchpad/contrasto.js` calcola il rapporto WCAG di ogni testo su ogni fondo nei due temi: **rilanciarlo dopo ogni ritocco ai colori**. Soglia 4,5:1 (qui quasi tutto è a 10-11px, quindi vale per intero). Prima: **18 combinazioni su 54 sotto soglia**; ora **0**.
- Corretto `--mut` (era 2,97 nel tema scuro: illeggibile, ed è il colore **più usato** dell'app — `.sub`, note, meta) e i colori accesi del tema **chiaro** (acc/grn/yel/blu/or), scuriti quel tanto che basta. Tinte invariate.
- **Regola**: testo su fondo TEMATICO (`var(--acc)`, `var(--blu)`, `var(--red)`) → `color:var(--bg)`, che segue il tema. Prima erano fissi (`#0f0f0e`, `#fff`) e si rompevano in una delle due modalità: dark-on-dark in chiaro (3,6) o white-on-lightblue in scuro (2,18).
- **Eccezioni volute, con testo FISSO**: `.gantt-bar` e `.asscal-ass` (sfondo = colore scelto in anagrafica, sempre acceso → testo scuro fisso) e `.gantt-cmbar-txt` (sfondi fissi e scuri → testo chiaro fisso; per questo `.gantt-cmbar.inritardo` usa un rosso FISSO e non `var(--red)`, che nel tema chiaro darebbe 2,6).
- **Resta aperto**: se in anagrafica si sceglie un colore CUPO per un tipo di lavorazione, il testo scuro sulla sua barra Gantt scende a 3,44. È un problema di dato, non di CSS; si risolverebbe scegliendo il testo in base alla luminosità del colore.

## Sospesi tecnici

### Mancanti v3 — import CSV (31 lug, `2026-07-31.9`)
- **La "matrice" NON è cambiata**: le 39 colonne del nuovo export sono le stesse dell'xlsx, nomi identici. È cambiato il **formato del file**, ed è lì che si rompeva.
- Cinque differenze, tutte gestite: separatore `;` (indovinato sull'intestazione fra `;`, tab e `,`); **decimali con virgola** (`20,00`); **date gg/mm/aaaa** (`01/12/2025`) invece del seriale Excel — questa era quella che rompeva davvero, `fabbData` non le riconosceva; **codifica Windows-1252** (le `à` di "Disponibilità" e i `RELÈ`); virgolette CSV.
- **La codifica si indovina**: prima UTF-8, e se compaiono caratteri di sostituzione si rilegge in Windows-1252. Così valgono sia gli export vecchi sia eventuali futuri in UTF-8, senza chiedere niente a Nico.
- `fabbNumero` sostituisce il vecchio parser: toglie il punto **solo** quando fa da separatore di migliaia (`1.234,56`), mai quando è il decimale (l'xlsx dà `20.5`, il CSV `20,5`).
- **Il CSV non usa SheetJS**: si legge da sé, nessun download, nessuna attesa. La libreria si scarica solo se il file è xlsx. Entrambi i formati restano accettati (`accept=".csv,.xlsx,.xls,.txt"`).
- **Verificato col codice VERO sul CSV VERO**: 396 righe, 313 da ordinare + 83 in arrivo, 394 agganciabili, 90 consegne (82 future, 8 in ritardo), **zero numeri illeggibili, zero date malformate, zero accenti rotti**. Un articolo con 5 previsioni di entrata legge tutte e 5.

## Campo note delle timbrature — ripulito (5 ago 2026)
- **Da qui in avanti il campo `sessioni_lavoro.note` contiene SOLO note scritte dagli operatori.** Tutti i marcatori automatici o manuali sono stati tolti (decisione Nico), copie di sicurezza in scratchpad (`note_cancellate_backup.json`, `gruppo_backup.json`, `dimezzata_backup.json`, `split_backup.json`).
- **`[gruppo]`** — l'UNICO che il codice scriveva davvero, sulle quote generate chiudendo un timbro di una commessa raggruppata. Tolto dal codice **e** dai dati (127 note). Conseguenza accettata: una quota generata dal sistema non è più distinguibile a colpo d'occhio da un timbro vero; restano riconoscibili solo perché la commessa ha `gruppo_id` e più sessioni condividono lo stesso intervallo.
- **`[dimezzata → SZ-A09103QE_EST]`** (41) e **`[split da SZ-A09102QE_EST]`** (41) — **mai esistiti nel codice**, verificato anche con `git log -S` su tutta la storia: erano annotazioni **a mano**, le due facce della stessa operazione. Qualcuno ha spaccato 62,4 h fra due articoli gemelli: lato originale `2026/OC/00198/20` (SZ-A091**02**QE_EST), lato creato `2026/OC/00198/40` (SZ-A091**03**QE_EST), 41 sessioni e 62,4 h per lato. Tolti entrambi.
- **Prima prova sul campo della nota obbligatoria** (5 ago, il giorno dopo il rilascio): due note vere, entrambe su attività extra — una voce rapida ("Aiuto a un collega") e una scritta a mano con contenuto reale ("CARICO DEL QE DI BARILLA D23634 CON RYAN, MAURO E RAOUL"). Il meccanismo funziona e non produce solo la prima voce dell'elenco.

## ⚠ ORARI: il DB è in UTC, la UI è in ora locale
- `sessioni_lavoro.inizio/fine` sono **UTC**. L'interfaccia li mostra in **ora locale** (Europe/Rome: **+2 in estate**, +1 in inverno).
- **Quando si estraggono orari via REST per riferirli a Nico vanno CONVERTITI**, altrimenti si indicano timbrature a un'ora che sullo schermo non esiste. Successo due volte il 5 ago: i timbri di Fabrizio Scordo dati come `07:23→10:30` (veri: `09:23→12:30`) e la sessione di Alessio data come `11:15→13:24` (vera: `13:15→15:24`) — Nico l'ha cercata a lungo nella scheda Live convinto di un bug che non c'era.
- Durate e totali NON sono affetti: sbaglia solo il collocamento nella giornata.

## Trappola: `.append()` del DOM scrive "null", `el()` no (5 ago, `2026-08-05.2`)
- `el()` scarta i figli `null`/`false`. **`Element.append()` NO**: gli passi `null` e lui inserisce un nodo di testo con dentro la parola **"null"**.
- Sintomo trovato sul campo: nella scheda Live, sulla card di chi era su un'**attività extra**, compariva `null` al posto del codice articolo — che per le extra non esiste, e infatti il codice diceva correttamente `d.codice ? el(...) : null`. Il guaio era il `.append()` attorno.
- **Regola**: su un elemento già creato mai `x.append(cond ? el(...) : null)`, sempre `x.append(...(cond ? [el(...)] : []))`. Dentro `el(...)` invece il ternario con `null` va benissimo.
- Sistemati tutti e 6 i punti di `app.js` (card Live, bottoni "usa" dei due suggerimenti, avviso OP orfani nell'import, descrizione attività, tipo lavorazione nel modal sessione). `mobile.html` e `prelievo.html` erano puliti. Commento di avvertimento lasciato accanto a `el()`.

## ▶▶ PROSSIMI (chiesti da Nico il 5 ago, chat chiusa qui per contesto pieno)

### A. Scheda Mancanti spostata in Lavoro — **FATTO** (`2026-08-05.3`, visibilità chiusa il 5 ago con `.4`)
Era in Gestione, ora è in **Lavoro**, dopo Magazzino. **La vedono tutti** (`adminOnly: false`, decisione Nico 5 ago): serve in reparto per sapere se il materiale c'è.
- **L'import resta agli admin.** Non è una limitazione di comodo: sostituisce l'INTERO archivio (delete + insert) ed è l'unica azione distruttiva della scheda; la policy RLS è `FOR ALL TO authenticated`, quindi il freno può stare solo nella UI. Chi non è admin vede tutto l'elenco e una riga che dice chi lo aggiorna.
- `state.mancanti` era già caricato per tutti (`caricaMancanti` sta nel caricamento generale, senza gate admin): il badge `⚠N` in Ordini cliente e `apriMancantiFiltrati` ora funzionano anche per loro — prima il clic portava a una scheda che non potevano aprire.

### B. Import Mancanti per trascinamento — **FATTO** (`2026-08-05.4`)
Il file si può **trascinare sul riquadro** della scheda Mancanti; il selettore resta dentro lo stesso riquadro (le due strade convivono, nessuna è stata tolta).
- **Una sola strada per l'analisi**: `inFile.onchange` è stata svuotata in una `analizzaFile(f)` chiamata da entrambe. Era il punto su cui si sarebbero sdoppiati i bug.
- **Il formato si controlla a mano**: l'attributo `accept` del selettore **non vale per il trascinamento** — un `.pdf` sarebbe finito dentro il lettore xlsx con un errore muto. Ora è respinto per nome (`.csv/.txt/.xlsx/.xls`) con un messaggio in chiaro.
- **`dragleave` scatta anche passando da un figlio all'altro** (il riquadro contiene label, input, note): senza contare la profondità (`dzProf`) l'evidenziazione lampeggerebbe. Verificato in browser: entrata zona → entrata figlio → uscita figlio resta acceso, uscita zona spegne.
- **Il riquadro è un QUADRATO di 220×220** (5 ago, richiesta Nico: "più capibile che si possa trascinare"). Un bordo tratteggiato attorno a un campo file non si legge come area di rilascio: ci vuole un'area grande e vuota, con freccia grande, "Trascina qui il file", ".csv o .xlsx" e "oppure fai clic per sceglierlo". Il selettore di sistema è **nascosto dentro il quadrato** (`display:none`) e il quadrato stesso fa da bottone: una cosa sola, non due. Accanto, a destra, la nota sui formati.
- **Trappola del click**: `inFile.click()` genera un evento che **BOLLE fino al quadrato** → il gestore richiamerebbe se stesso all'infinito. Guardia `if (e.target !== inFile)`. Misurato in browser: un clic = **una** apertura del selettore.
- Nascondendo il selettore, il nome del file non lo direbbe più nessuno → si scrive dentro il quadrato (`nomeScelto`, `📄 nome`), impostato in `analizzaFile` così vale per entrambe le strade. Il quadrato è raggiungibile da tastiera (`tabindex`, Invio/Spazio).
- **Il file rilasciato viene messo anche dentro l'input** (`inFile.files = dt.files`, in try/catch): è da lì che si rilegge, ed è la stessa strada delle due. Funziona sui browser attuali; se non fosse scrivibile il resto regge lo stesso.
- **Rete di sicurezza sul documento**: `dragover`/`drop` con `preventDefault` registrati **una volta sola** (`window.__dropGuard`, perché `renderFabbisogno` viene richiamata a ogni import) — se il file cade FUORI dal riquadro il browser lo aprirebbe buttando via la pagina.
- Effetto collaterale utile: trascinando **lo stesso file due volte di fila** l'analisi si rifà, cosa che col solo selettore non succede (`onchange` non scatta se il file non cambia).
- Provato in browser su pagina di test (`scratchpad/test_drop.html` + `serve.js`, servita su http perché `file://` è bloccato): 9 casi, tutti passati — quadrato 220×220 misurato, un clic = una apertura, evidenziazione coi figli in mezzo, drop CSV letto giusto, `.pdf` respinto, nome mostrato, Invio da tastiera.

### C. Calendario mezzi: avvisare se l'operatore prenotato è assente — **FATTO** (`2026-08-05.4`)
Prenotando un mezzo, se un operatore collegato ha ferie/permesso/malattia in quel periodo il gestionale lo **dichiara**.
- **Avvisa, NON blocca** (decisione Nico, 5 ago, scelta fra bloccante e misto): un rientro anticipato o un permesso che non tocca la trasferta sono casi veri, e il gestionale non li conosce. Coerente col resto: dichiara e la persona decide. Gli altri due controlli della stessa `save()` (mezzo già prenotato, operatore su un altro mezzo) restano **bloccanti** — lì è un conflitto certo, qui no.
- **Due punti, non uno**: riquadro giallo **live** dentro il modal (sotto l'elenco operatori, ridisegnato a ogni operatore aggiunto/tolto e a ogni cambio di data — la lezione del 28 lug sui blocchi costruiti una volta sola) + **conferma al salvataggio**, perché le date si cambiano all'ultimo. Testo prodotto da una sola `testoAssenze`: se fossero due, alla prima modifica direbbero due cose diverse.
- `assenzeInPrenotazione(utentiIds, dataInizio, dataFine)` in `domain/scheduling.js` (pura, **29 test** in scratchpad/test_assenze_pren.js) → `[{ utenteId, giorni:[{data, ore, intera, tipo}], nIntere, nParziali }]`. Guarda le assenze di **OGNI** operatore collegato, non solo di chi prenota.
- **Giornata intera vs permesso parziale**, come chiesto: soglia `ORE_STANDARD_GIORNO` (la stessa delle card Live). Più righe nello stesso giorno **si sommano** (mattina 4 + pomeriggio 4 = intera, non due permessi). Dove compaiono le ore la scheda dice che è parziale e che non impedisce per forza la trasferta.
- **Assenza senza ore scritte = intera**: non si può dedurre che sia un mezzo permesso, e il caso da segnalare è quello. Tipo cancellato dall'anagrafica → etichetta "Assenza", mai vuoto.
- Solo `stato === 'valida'`: una richiesta non approvata non è un'assenza.
- NB: il modal è **solo admin-side** (`openPrenotazioneModal` non è mai chiamato dal kiosk, verificato) — lì `state.assenze` è caricato per intero; `kioskLoadAll` ne carica solo il giorno corrente e non c'entra.

### D. Prenotazione mezzo: UN SOLO campo "chi userà il mezzo" — **FATTO** (`2026-08-05.5`)
- Erano **due riquadri impilati** sotto la stessa etichetta: le pillole degli operatori scelti (`.util-selected`) e sotto la casella di ricerca (`.util-search`). Richiesta Nico: un campo solo. Ora pillole e casella stanno **dentro lo stesso riquadro** (`.util-field`), con la lista che scende sotto tutto il campo.
- Il bordo è **uno solo**, quello del campo, e si accende col focus **dentro** (`:focus-within`); la casella perde il proprio. Cliccando lo spazio vuoto del riquadro si scrive nella casella (`mousedown` con `e.target === campoUtenti`), altrimenti "un campo solo" resterebbe un'illusione.
- **`renderSelected` non può più svuotare il contenitore**: casella e lista ci vivono dentro e `innerHTML = ''` le distruggerebbe. Toglie solo le `.util-pill` e reinserisce le nuove **prima** della casella.
- La scritta "Nessun utente selezionato" è sparita: lo dice il **placeholder**, che diventa "aggiungi…" quando c'è già qualcuno. Una cosa in meno che ripete quello che si vede.
- **Toccato SOLO il modal prenotazione.** Lo stesso schema a due box è anche nel modal commessa (addetti e fornitori, `addSelectedWrap`/`forSelectedWrap`): lì è invariato, e le classi vecchie restano perché servono a quelli. Se piace, si allineano dopo.
- Misurato in browser sul CSS **vero** (pagina di test che carica `app.css` dal repo, `scratchpad/test_campo.html`): un bordo solo (campo 1px, casella 0), casella dentro il riquadro e sulla riga delle pillole, lista 1px sotto il campo e larga quanto lui, il fuoco entra cliccando lo spazio vuoto, e togliendo una pillola casella e lista restano al loro posto.

## ▶▶ PROSSIMI (31 ago 2026, chat chiusa qui per contesto pieno)

### Fatto in questa chat
- **Spostate 3 timbrature di Raoul** da `2026/OC/00155/0010` a `0030`, spalmate 50/50 sul gruppo 758+760 con `ripartisciTimbroGruppo`. 24.601 s in ingresso = 24.601 s in uscita. ⚠ **`sessioni_lavoro.durata_secondi` e una COLONNA GENERATA**: scriverla fa rifiutare tutta la richiesta (`428C9`) — si scrivono solo `inizio` e `fine`, il resto lo calcola Postgres.
- **`completata` assente dal file non si tace piu** (`2026-08-28.1`) — vedi il blocco sopra. Ne nascondeva 10.
- **I kit BOX si giudicano sul riferimento** (`2026-08-28.2`) — vedi il blocco sopra. Ne nascondeva 2.
- **Strumenti messi al sicuro nel repo** (prima vivevano solo nello scratchpad della chat, che muore con la chat):
  - `strumenti/test/test-import-ordini.js` — **138 test** su `analizzaImportOrdini`. `node strumenti/test/test-import-ordini.js .`
  - `strumenti/test/prova-coperture.js` — Ordini cliente + Storico coprono tutte le commesse, zero doppie e zero orfane.
  - `strumenti/anomalie-alnus.js` — genera il workbook delle anomalie. `node strumenti/anomalie-alnus.js . strumenti/test <file-alnus.xlsx> <out.xlsx>`
  - `strumenti/test/xlsx.full.min.js` — SheetJS per i tool Node (l app la prende dal CDN; qui serve locale).

### Aperti
1. **Le anomalie rimaste** — `strumenti/anomalie-31ago.xlsx`, rigenerabile in qualsiasi momento col comando qui sopra. Al 31 ago: **11 stati** (aperte + completate senza spedizioni + 2 kit), 0 spedizioni, 4 righe descrittive, 2 aggiornamenti di scadenza, 13 in ritardo. ⚠ Il numero **si muove mentre Nico lavora**: fra due giri a un minuto di distanza e passato da 12 a 11. Si rilegge, non si ricorda.
2. ⚠ **L estrazione Alnus e ferma al 28/08 14:59** mentre il gestionale si legge dal vivo: cio che Nico sistema **in Alnus** non si vede finche non arriva un export nuovo. Il Riepilogo del workbook dichiara sempre le due date — **leggerle prima di dare i numeri per buoni**.
3. **Dato da correggere**: su `BOX_EL000515` la colonna `riferimento_cliente` dice `EL0000515` (uno zero di troppo). Oggi non fa danno perche il codice articolo ha la precedenza, ma e un dato sbagliato.
4. `strumenti/migrazione-tipo-parte.sql` **non ancora eseguita** (l import funziona lo stesso e lo dichiara).
5. **Egress**: verificare che i giorni dopo il 27 ago stiano sotto i 20 MB.


## ▶▶ PROSSIMI (1 set 2026, chat chiusa qui per contesto pieno)

### Fatto in questa chat — Ordini cliente, Storico, export (`2026-08-31.1` → `2026-09-01.1`)

- **Il campo OP nasce col prefisso dell'anno** (`prefissoOpCorrente()` in domain: `new Date().getFullYear() + '/OP/'`). Vale nei due posti dove si scrive un OP — griglia "+ Nuovo ordine" e form dell'ordine singolo — e **l'anno lo prende dall'orologio**: il 1 gennaio 2027 propone `2027/OP/` da solo, nessuna data scritta a mano nel codice.
  - ⚠ **Il solo prefisso è un campo VUOTO, non un OP sbagliato** (`opSoloPrefisso()`, domain). Senza questa distinzione il salvataggio si sarebbe fermato su **ogni riga in cui l'OP non viene compilato**, che è il caso normale: l'OP è opzionale. La regola c'era già nel form singolo, scritta a mano; ora è una sola funzione condivisa. Chi aggiunge un terzo campo OP usi quelle due, non riscriva la regex.
  - Il ⚠ da ricordare: nel submit del form singolo il locale si chiamava `opSoloPrefisso` e **ombreggiava** la funzione globale appena introdotta. Rinominato `opVuoto`. Scope globale condiviso: un nome nuovo in domain può spegnere un locale omonimo in app.js, e nessuno se ne accorge finché non si rompe.

- **OP modificabile direttamente in tabella** (Ordini cliente, solo admin). L'OP **arriva quasi sempre dopo l'ordine** e non c'è nel file di Alnus (vedi "Aperti" della sezione import): finché si doveva aprire la scheda e salvare tutto il modal, aggiungerlo era una pratica. Ora si scrive nella cella: al fuoco si precompila `AAAA/OP/`, Invio conferma, Esc annulla, il salvataggio parte al blur con `eseguiConRetry`. Stessa normalizzazione di ovunque (`odlANumeroOp`). **Da adesso questa è la porta principale per inserire un OP.**

- **Storico spostato subito dopo Ordini cliente** nella barra di Lavoro. Sono le due metà della stessa cosa — la regola che decide dove vive una commessa è una sola (`commessaInStorico`) — e in mezzo c'erano Mancanti e Prelievi da scavalcare a ogni salto.

- **Stesso ordine di colonne nelle due schede.** L'unica inversione era la **Scadenza**: in Ordini cliente viene prima delle Note, nello Storico veniva dopo. Ora lo Storico la mette subito dopo la quantità. Sequenza condivisa, identica nelle due: Ordine · Pos · OP · Rif. cliente · Cliente · Codice · quantità · Scadenza · Note · Azioni.

- **⚠⚠ L'EXPORT NON DEVE SOMIGLIARE ALL'IMPORT** (domanda di Nico: *"perché non puoi fare export pari pari a quello che vedo, dato che l'import ora è legato al file di Alnus?"*). L'export delle commesse ricalcava il tracciato dell'ERP — numero ordine spezzato in `Eser` / `Sz Cl` / `Ord/Off cliente`, intestazioni loro — per restare **reimportabile**. Quella cautela non era solo senza oggetto: era **dannosa**. L'import legge l'estrazione di Alnus **come una fotografia di cosa è ancora aperto di là**, dove l'ASSENZA di una riga è essa stessa informazione di stato ("per Alnus è finita"). Dare in pasto all'import un export di qui — che per giunta esce **filtrato** per quello che si stava guardando — non ricaricherebbe le commesse: **farebbe dichiarare finite tutte quelle che il filtro ha lasciato fuori**.
  - Lezione generale: **un file che non deve mai essere reimportato non ha motivo di somigliare a quello che si importa**. Prima di conservare un vincolo di formato, chiedersi chi legge davvero quel file.
  - Ora tutti e due gli export **sono la tabella**: stesse colonne, stesso ordine, stesse intestazioni (`Ordine` intero, `Pos`, `OP`, `Rif. cliente`, `Codice`, `Ordinati`, `Qtà`…), e le poche che a schermo non ci sono dichiarate **in coda**. Le tendine escono con la parola che si legge (`Completo`, `Aperta`), non con la chiave interna. Cancellata `splitNumeroOrdine`, che serviva solo a quello.
  - Aggiunte le colonne che si vedevano ma non uscivano: **Prodotti** e **Spediti** (commesse), **Destinatario** e **Note** (storico).
  - **Eccezione voluta**: nello storico la cella "Ore (cons/pag.)" resta divisa in **due numeri** (7 ago, chieste così da Cocco — unite non ci si può sommare né filtrare sopra). Stanno al posto della colonna che sostituiscono.
  - **La data dello storico resta ISO** (`2026-08-14`, non `14/08/2026`): è l'asse principale di quel file e come testo `gg/mm/aaaa` Excel la ordinerebbe per giorno. Deciso da Nico l'1 set, sapendo che è l'unico punto in cui il file non è "pari pari".

- **Colonna Azioni: solo il 🚚.** Il ✓ non diceva cosa faceva. **L'elimina è sparito dalla riga**: stava a un pixel dall'unica azione che si usa davvero, su una riga che al clic apre la scheda, e cancellare una commessa non è un gesto da fare di sfuggita in mezzo alla lista. Non si è perso niente — resta il 🗑 dentro la scheda, dove si vede cosa si cancella.

- **Tolto il bottone "⠿ Ordina priorità"** da Ordini cliente (deciso da Nico dopo la sua domanda *"ha ancora un senso?"*). **Il campo `operazioni.priorita` RESTA e conta**: ordina le card del kiosk (`cmpCommessaKiosk`) e la coda "prossime assegnate a te" in domain. A sparire è **la porta sbagliata**: in Ordini cliente non si vedeva niente di quello che faceva — nessuna colonna priorità, nessun ordinamento — e la lista che apriva erano **tutte** le commesse aperte, **senza i filtri, la ricerca e i clienti esclusi che si avevano davanti**: si riordinava altro da quello che si stava guardando. Il riordino vive al kiosk (`kioskAttachReorder`), dove si trascinano le schede vere e l'effetto si vede mentre lo si fa.
  - Con lui se ne sono andate `openPrioritaModal`, `salvaPriorita`, `buildPrioList` e le classi `.prio-*` della sua lista. Restano `persistPriorita` e `.prio-hint`: le usa il kiosk.
  - Regola che ne esce: **un comando che agisce su un insieme diverso da quello che l'utente ha davanti è un comando sbagliato**, anche quando funziona.

- **Misurato in browser, non deciso a occhio** (banco di prova con `app.css` vera, riga a 16 colonne, contenuti lunghi come i reali, `getBoundingClientRect`):
  - casella OP: input 110px in una colonna da 130, non esce dalla cella, altezza riga invariata (41px). Sulla larghezza totale pesa **16px** (1805 → 1821): **la tabella chiedeva già lo scorrimento orizzontale prima**, non è la casella ad averlo introdotto.
  - furgoncino: a 13px in un bottone 38×23 si leggeva a fatica → **15px** (bottone 41×25, riga invariata). A 17px il bottone sale a 44×27, più del necessario.

### Mancanti: il messaggio ingannevole (1 set, `2026-09-01.2` e `.3`)
- **Tooltip completo in Ordini cliente** (richiesta Nico): elenco di TUTTI i codici, in arrivo compresi, raggruppati per categoria con la conta di ognuna e la data della prima consegna (marcata se gia passata). Prima erano i primi 8 di UNA categoria sola. In cima la data del fabbisogno: e una fotografia e puo essere vecchia di giorni. Il testo esce da `mancantiTooltip()`.
  - Sul caso peggiore dell archivio (`2025/OP/03158`, 49 codici) il tooltip e di **56 righe**: e quello che e stato chiesto, ma su una commessa cosi il riquadro e alto quanto lo schermo. Se dara fastidio, tetto per categoria.
- **⚠⚠ Poi la domanda vera di Nico**: *"perche 2026/OP/01917 (scad 04/09) ha mancanti e 2026/OP/01918 (scad 03/11) no?"* — stesso articolo `30 010 0510`, stesso ordine `2026/OC/00385`, pos 0010 e 0020. Vedi il blocco in CLAUDE.md: il fabbisogno attribuisce il mancante a **una commessa sola**, quella del "prossimo impegno". `01918` non era servita: era **gia contata sulla sorella**. Prova nei numeri: `30 010 0510_K` richiesta 150 = 100 + 50.
- **Diagnosi fatta sui DATI VERI** in sola lettura (account kiosk via REST, la strada documentata qui sotto). Senza guardare il database si sarebbe potuto solo tirare a indovinare: il `150` e la prova, e non stava nel codice.
- **Rimedio**: `mancantiRiflessi(op)` in domain + badge `⚠↗` in Ordini cliente + riquadro giallo nel modal. Copre le sorelle dello **stesso articolo**; il caso del componente condiviso fra articoli diversi **resta scoperto e non e risolvibile** con questa estrazione (serve la distinta base). ⚠ Non far credere che il badge veda tutto.
- **19 commesse vive su 116 erano in questo caso**, 5 con codici da ordinare: `2026/OC/00385/0020` (l esempio), `00385/0090`, `00385/0100`, `2026/OC/00391/0010`, `2026/OC/00394/0010`. `node strumenti/test/prova-mancanti-riflessi.js .`

### ▶ DIREZIONE PRESA: MRP in casa, per tappe (1 set, decisione Nico)
- **Nico**: *"io invece vorrei piano piano arrivare a un MRP completo"* — cioè calcolare i mancanti da soli invece di importare la fotografia che Alnus sbaglia. Piano completo (6 tappe, dipendenze, numeri veri e decisioni aperte): **https://claude.ai/code/artifact/bce6255d-b481-48c1-8829-12f051216a46**
- **La catena**: `fabbisogno = Σ(distinta × pezzi)` · `disponibile = giacenza + ordinato con data` · `mancante = fabbisogno − disponibile, RIPARTITO fra le commesse`. L'ultimo termine è quello che Alnus sbaglia, ed è l'unico fatto di sola logica.
- **Tappe**: 0 anagrafica materiali · 1 **distinta base** · 2 fabbisogno calcolato in casa (in parallelo ad Alnus) — **⚠ CANCELLO** — 3 movimenti di magazzino · 4 ordini fornitore con righe · 5 allocazione e proposte d'acquisto · 6 spegnere l'import.
- ⚠ **Il problema dei mancanti ingannevoli si chiude alla TAPPA 2, non alla 5**: le prime tre non toccano il magazzino e si appoggiano ancora ad Alnus per giacenze e arrivi. Se il cancello non si apre ci si ferma lì e si è comunque guadagnata la cosa che serviva. Non venderlo come "serve tutto l'MRP".
- ⚠⚠ **IL CANCELLO NON È CODICE**: dalla tappa 3 il gestionale tiene il magazzino suo, e un magazzino vale quanto i movimenti che ci si scrivono. Oggi: **30 prelievi in due mesi e mezzo su 10 commesse** — un assaggio, non un'abitudine. Senza quella disciplina il magazzino di casa mente dopo una settimana, e mente PEGGIO di Alnus perché ci si fida di più. Si decide con le persone, PRIMA di costruire la tappa 3.
- **La tappa 1 è il muro**: la distinta base non è ricavabile da nessun dato che c'è. Prima strada: **chiederla ad Alnus** (il fabbisogno lo calcola lui, quindi ce l'ha). Seconda strada: **proporla dallo storico dei PRELIEVI** e farla confermare — stessa idea dei minuti/pz dedotti dalla media dei consuntivi. Trasforma il muro in una salita.
- **Ricognizione a database (1 set)**: 423 commesse · 334 articoli (tutti prodotti finiti) · **0 dei 358 codici componente esiste in `articoli`** · 0 righe di distinta · **110 dei 358 codici Alnus sono già nella codifica a 20 caratteri** · 30 prelievi (tutti a 20 caratteri, `articolo_id` sempre null) · produttori in anagrafica: 2 · UM nei mancanti: nr 320, mt 38.
- **Da decidere PRIMA di scrivere codice** (la prima blocca la tappa 0):
  1. **Chiave del materiale**: codice a 20 caratteri della Codifica o codice Alnus? Oggi convivono. Sbagliarla vuol dire riscrivere tutto ciò che ci si appende.
  2. **Metri e sfridi**: 38 codici a metri portano virgole, bobine e scarto di taglio. Una distinta senza sfrido sul cavo dirà sempre che basta.
  3. **Chi carica il magazzino**: una persona con un'abitudine, non una funzione. Da nominare prima della tappa 3.

### ▶ DA CHIEDERE AD ALNUS: il file mancanti esploso per OdL (1 set)
Il foglio "Fabbisogno Massivo" è una query fatta su misura per Cablotec, quindi si può chiedere di cambiarla. **La richiesta principale non è una colonna: è la GRANA.**
- **Oggi**: una riga per CODICE, con accanto l'OdL che lo consumerà per primo (`OdL Prossimo Impegno`) → il mancante finisce su una commessa sola.
- **Chiedere**: una riga per CODICE **e per OdL**, cioè gli impegni esplosi invece che sommati. Alnus li ha per forza: la colonna `Impegno` è la loro somma.
- ⚠⚠ **QUESTO DA SOLO SISTEMA IL BADGE SENZA TOCCARE CODICE**: `fabbRigaNormalizza` fa **una riga di `mancanti` per ogni riga del foglio** e legge l'OdL da quella riga — non deduplica per codice. Se il foglio arriva esploso, ogni commessa riceve i suoi codici. Il file passa da 358 righe a un migliaio: l'import scrive già a blocchi di 500.
- **Colonne da aggiungere, in ordine di valore**:
  1. **`Qta impegnata dall'OdL`** — la più importante. Oggi c'è `Impegno` (totale su TUTTI gli ordini) e `Qta richiesta` (= impegno − giacenza, lo scoperto GLOBALE): si sa chi è coinvolto, non quanto. Senza, dopo l'esplosione le quantità sarebbero ripetute su ogni riga.
  2. **`Data fabbisogno dell'OdL`** — quando quell'ordine consuma il pezzo: è la chiave per assegnare la giacenza a chi la usa per primo. Senza, si ripiega sulla scadenza commessa.
  3. **`Qta in ordine`** esplicita — oggi dedotta da `Qta da ord` = 0 + presenza di una data.
  4. **`Codice interno` a 20 caratteri** su ogni riga — oggi ce l'hanno 110 righe su 358. Risolve gratis anche la decisione sulla chiave dei materiali.
  5. **`Scorta minima`** / punto di riordino — oggi "sotto scorta" e "manca per una commessa" sono la stessa cosa.
  6. **`Data e ora dell'estrazione`** in colonna — oggi `import_data` la mette l'app al momento dell'import.
  7. `Lotto minimo` e `lead time` fornitore — servono per le proposte d'ordine, tanto vale chiederli ora.
- **Da scrivere nella richiesta**: (a) **aggiungere, non sostituire, e NON rinominare le colonne esistenti** — l'import cerca per NOME, quindi le colonne in più sono ignorate senza rompere niente e il file nuovo si può importare anche prima che l'app le usi; (b) dire **quale colonna porta l'OdL della riga**: se resta `OdL Prossimo Impegno` non si tocca niente.
- **La distinta base si chiede a parte**, come export separato: è quella che sblocca il calcolo in casa, ma non deve far arenare questa richiesta, che è piccola e risolve subito.

### ▶ DISTINTE: il file c e, ed e buono (2 set)
Nico ha estratto da Alnus **tutte le distinte** (`CAPRTESP0101.xls`). Non e una tabella: e un **REPORT a blocchi** — [riga padre][riga intestazioni][componenti...] e poi da capo — e va ricostruito. Strumento: `node strumenti/copertura-distinte.js . <file> [out.xlsx]`.
- **Sul file vero**: 5.366 distinte · 38.461 righe componente · 7,2 componenti di media · 4.156 codici componente distinti · solo 10 marcate NON USARE/ANNULLATO.
- **Copertura**: 229 dei 341 articoli in anagrafica hanno la distinta; **99 delle 141 commesse vive (70%)**.
- ⚠⚠ **I CODICI COMBACIANO GIA**: **357 dei 358** codici che Alnus riporta come mancanti compaiono come componente nelle distinte, e **3.213 dei 4.156** componenti sono nel formato a 20 caratteri della Codifica. **La decisione sulla chiave dei materiali — il primo scoglio del piano MRP — l hanno gia presa i dati**: la chiave e il codice componente. Niente tabella di corrispondenza.
- ⚠⚠ **LA DISTINTA E MULTILIVELLO**: **197 componenti sono a loro volta padri** (es. `EL50511CABL...`, e verosimilmente i codici `_K` tipo `30 010 0510_K` "Lavorazione Botturi"). **L esplosione dev essere RICORSIVA, con una guardia sui cicli** o una distinta che si richiama fa girare il calcolo all infinito.
- **UM dei componenti**: nr 30.278 · mt 8.174 · pz 8 · gr 1. Tipo parte dei padri: PRD 5.251 · C/L 70 · ACQ 30 · FAN 12 · MAC 1.
- ⚠ **IL FILE E SPARITO MENTRE CI LAVORAVO**: stava in `C:\alnustmp\mater\spltmp\Cestino\`, una cartella temporanea di Alnus che **si e svuotata da sola**, portandosi via anche un PDF di DDT. **Al prossimo export: copia in un posto stabile.** E chiedere a chi ha fatto l estrazione **se si puo rigenerare a comando**: una distinta cambia nel tempo, e cosi e utile una volta sola.
- Lo strumento **classifica**, non conta: `AGGANCIO PERSO` (la distinta c e ma il codice combacia solo a meno di spazi o punteggiatura → si recupera) · `e un COMPONENTE` (si compra, giusto che non abbia distinta) · `kit BOX` (codice inventato dall import per fondere le righe Senzani: in Alnus non esiste) · `distinta DA SCARTARE` · `assente dal file`. La scala di normalizzazione (esatto → a meno di spazi → a meno di punteggiatura) e la lezione del 25 ago, dove "0040" contro "40" aveva prodotto 51 commesse doppie.
- **GIRATO SUL FILE VERO (2 set)**: 99 commesse vive coperte (70%), **42 no**, e **zero agganci persi** — i codici che combaciano, combaciano esatti. Il file sta ora in `C:/Users/User006/Desktop/CAPRTESP0101.xls` e **Nico puo rigenerarlo quando vuole**: la distinta non e una fotografia una tantum.
- ⚠⚠ **TERZO PUNTO CIECO, e il peggiore: tutte e 42 le scoperte hanno ZERO righe di fabbisogno.** Non sono due mancanze, e la stessa: **Alnus il fabbisogno lo calcola DALLA distinta**, quindi senza distinta non calcola niente. Quelle commesse non mostrano nessun avviso materiale — e non perche il materiale ci sia, ma perche per loro non e mai stato chiesto. `mancantiRiflessi` non le salva: righe non ne ha nemmeno una sorella.
- **Non sono articoli nuovi**: coperte e scoperte hanno lo stesso arco di creazione (19 mag → 2 set) e la stessa quota di recenti (6/99 contro 5/42). L ipotesi eta e esclusa dai dati.
- **Si concentrano per CLIENTE**: **Senzani 22 su 22 (100%)**, Elcotec 13/39, Tema Sinergie 5/16, Bucci 2/6. Sacmi 0 su 34. Un cliente al 100% non e un caso: **e la domanda da fare a chi tiene Alnus** (conto lavoro puro? versione della distinta esclusa dall export? mai create?). ⚠ Attenzione a non concludere in fretta "conto lavoro = niente distinta": 13 delle COPERTE hanno righe C/L, quindi un C/L la distinta puo averla.
- **IPOTESI "e tutto C/L, materiale del cliente": ESCLUSA dai dati** (2 set, ipotesi di Nico). Tre prove indipendenti: **114 distinte sono fatte SOLO di componenti C/L** (quindi essere tutto conto lavoro non impedisce di avere una distinta) · **70 padri hanno tipo parte C/L** e la distinta ce l hanno · **tutti e 22 gli OP con righe C/L nei mancanti hanno la distinta (22/22)**. Nel file ci sono 3.551 righe componente C/L su 38.461: il conto lavoro e pienamente rappresentato.
- **Non e nemmeno il CLIENTE**: nel file ci sono **1.180 padri Senzani** (`SZ-*`), 2.591 Elcotec, 413 Sacmi, 343 Tema, 141 Bucci. Senzani le distinte ce le ha: non le hanno **questi 22 articoli**.
- **Nota per chi creera le distinte (NON e una pista da seguire).** ⚠ Detto da Nico: *"se non ci sono BOM vorra dire che ne hanno bisogno"* — e ha ragione, non c e niente da indagare. Il controllo che avrebbe segnalato una vera incoerenza (l app mostra mancanti dove Alnus non ha la distinta) **da ZERO su 141**, e l unico codice sospetto era una lavorazione. I due sistemi sono coerenti. Quello che segue e solo un dettaglio utile a chi le distinte le creera: **la grana dei codici non coincide.** Le 22 scoperte Senzani sono la famiglia `SZ-T127xxBM` / `SZ-T127xxQE` (verosimilmente due assiemi per macchina). Nel file esistono 13 padri `SZ-T127*`, ma sono i **particolari** — `SZ-T12704002002` CASSETTA, `SZ-T12704003002` SCATOLA, `SZ-T12704004028` PIASTRA — non gli assiemi BM/QE, che come padri **non esistono con nessuna grafia**. Alnus tiene le distinte a livello di PARTICOLARE, il gestionale lavora a livello di ASSIEME. Chiedere a Nico se `BM`/`QE` sono codici di Alnus senza distinta o una convenzione Cablotec: nel secondo caso quella distinta non esistera mai a quel livello. **Ma non e urgente, e non e un anomalia: e una distinta da fare.**
- ✅ **RISPOSTE DI NICO (2 set), tre punti chiusi**:
  1. **I codici `_K` / `_KF` sono LAVORAZIONI**, non assiemi: `30 010 0510_K` e il promemoria che quella lavorazione va ordinata a Botturi. **Non hanno sottodistinta e non devono averla.** ⚠ Conseguenza per l esplosione: sono **FOGLIE**, non distinte mancanti — non cercarle e non segnalarle come buchi. E il loro posto naturale nel gestionale non e il magazzino ma la **riga fornitore** della commessa, dove gia vivono gli OF/OL.
  2. **L estrazione prende le distinte valide a OGGI.** Quindi una commessa aperta a giugno viene esplosa con la distinta di oggi: quasi sempre e cio che si vuole, ma va **DICHIARATO a schermo** ("fabbisogno calcolato con le distinte del <data>") invece di lasciar credere che sia quella con cui il pezzo e stato preventivato. Nico puo rigenerare l export quando vuole, quindi la freschezza si gestisce.
  3. Il multilivello e confermato dai dati suoi: `TS-342015G00` "CABLAGGIO ALIMENTAZIONE ENVIRO" e padre di 11 componenti **ed e figlio** di `TS-342010003` "ENVIRO-RAD".
- **MANCANTI SENZA DISTINTA: uno solo su 358** — `TKX-181413_KF` (ACQ, "KIT FILI", su `2026/OP/02009`). Il suffisso `_KF` e la stessa famiglia di `30 010 0510_K` "Lavorazione Botturi": **i codici kit sono il livello che nell export c e a meta**. Da chiedere insieme al resto.
- ✅ **Verso opposto, zero eccezioni**: commesse vive **con** righe di fabbisogno ma **senza** distinta: **0 su 141**. Conferma pulita che le due assenze sono la stessa: il fabbisogno si calcola dalla distinta, sempre.
- ⚠ Le classificazioni `AGGANCIO PERSO`, `e un COMPONENTE`, `kit BOX` e `distinta DA SCARTARE` sul file del 2 set non scattano mai: sono state **collaudate su un file finto**. Restano utili al prossimo export, quando i codici cambieranno.

### ▶ TAPPA 2 FATTA: fabbisogno calcolato in casa (2 set)
`domain/materiali.js` (PURO, **non ancora agganciato ai gusci**: lo usa solo `strumenti/prova-fabbisogno.js`, cosi l app non corre rischi finche i numeri non sono verificati). Tre funzioni per tre domande diverse: `esplodiDistinta` · `fabbisognoPerCodice` · `ripartisciGiacenza`.
- **E `fabbisognoPerCodice` a chiudere il problema di partenza**: la domanda si costruisce dalle COMMESSE invece che dal magazzino, quindi ogni commessa sa del suo fabbisogno e nessuna eredita il conto della sorella. La ripartizione segue una regola **dichiarata** — chi scade prima serve prima — che vale piu di una implicita perche si puo discutere.
- **Il fabbisogno si calcola sul RESIDUO da produrre**, non sull ordinato: sui pezzi gia fatti il materiale e stato prelevato. Da solo porta i codici concordi da 212 a 231 su 358.
- **Sui dati veri**: 241 codici entro il 2% da Alnus, 265 entro il 20%, 37 oltre, 56 che lui segnala e noi non vediamo. **Segnaliamo 61 commesse scoperte contro le 42 di Alnus, e 26 oggi non hanno nessun avviso** — quelle che il prossimo impegno copriva con una sorella.

- ⚠⚠ **IL VALORE NUMERICO DELLE CELLE E SBAGLIATO, IL TESTO NO.** Nell estrazione distinte la cella della quantita ha valore `45` e testo `"0,45"`: il separatore decimale si e perso nel numero ma non nella stringa. **Non e uno scarto costante** — dipende da quante cifre decimali aveva il valore (`0,45`->45, `0,435`->435, `0,08`->8), quindi NON si rimedia dividendo per 100: provato, peggiora tutto (da 212 a 2 codici concordi). Sono **2.820 celle su 38.460 (7%)**, poche ma sono quelle dei FILI, cioe le quantita piu grosse: bastavano a rendere il fabbisogno totale CINQUE VOLTE il vero. Si legge con `raw:false` + `cellText:true` e si interpreta la stringa all italiana. **Prima di fidarsi di un numero letto da un foglio, confrontarlo con quello che il foglio MOSTRA.**
- ⚠ **Lezione sul mio stesso strumento**: la prima versione stampava solo i dieci scarti peggiori, e leggendoli mi ero convinto che non tornasse niente — erano i peggiori per costruzione, e 212 codici su 302 combaciavano gia. Ora il riepilogo dice PRIMA quanto si va d accordo. **Un report che mostra solo le code fa sembrare rotto tutto il resto.**
- ⚠⚠ **IL CONFRONTO CON `impegno` NON E UN METRO** (2 set, contestato da Nico: *"il doppio rispetto a cosa che non ha altro per confrontare?"* — e aveva ragione). Le due cifre rispondono a domande diverse: il nostro dice **quanto materiale serve in tutto per fare quell ordine**, il suo **quanto e impegnato a quel livello**. Per comprare serve il primo.
  - **Il caso che lo dimostra**: `84545CEMB000000F405P` risultava +100%. Non e un difetto — `TS-342010003` lo usa in TRE punti: x6 direttamente, x5 dentro `TS-342015G00`, x1 dentro `TS-342015G10`, cioe **12 per pezzo**. Su 92 pezzi (5 commesse Tema) fanno **1.104**, e il conto torna da solo. Alnus dice 552 = 92 x 6: conta **solo il primo livello**, perche i sottoassiemi da lui sono OdL a se e il loro materiale e impegnato li. E di nuovo il "prossimo impegno".
  - **Conseguenza generale**: **ogni codice che compare a piu livelli risultera piu alto del suo, per costruzione.** Il confronto e sano sui codici a un livello solo e fuorviante sui multilivello. Non trattarlo come una verifica finche non distingue i due casi.
- **Restano 36 codici fuori soglia**, di cui una parte spiegata dal multilivello qui sopra. I fili (`83010FILO*`, +260/326%) restano da capire.
- ✅ **SEGNAPOSTO ESCLUSI** (decisione Nico, 2 set): `MATERIALI_SEGNAPOSTO` in domain — `COMP GENERICO` (in 3.409 distinte) e `VARIE` (in 404). Non sono mai padri, UM `nr`: sono riempitivi che il progettista mette dove il dettaglio non serve, non pezzi da comprare. ⚠ Si escludono **al CALCOLO, non all import**: a database le righe restano come stanno nel file — un dato non si cancella perche non lo si sa usare, si cancella la pretesa di usarlo. Si contano a parte in `out.segnaposto`, cosi non spariscono in silenzio. Aggiungerne uno: una riga nella lista.

### ▶ LA STRADA UNICA sui materiali (2 set, `2026-09-02.5`)
Richiesta di Nico: *"dalla schermata ordini clienti voglio vedere l avviso come adesso col triangolino... cliccando vorrei passare a una schermata che mi dice se quel codice e in ritardo o manca l ordine, di conseguenza sapere in quale OF si trova. E il percorso che unisce e semplifica tutto quello fatto oggi."*
- **UNA SCHEDA SOLA, `Materiali`**: le due schede Mancanti e Fabbisogno sono diventate una, con un bottone che passa fra le due FONTI (quello che dice Alnus / quello che calcoliamo dalle distinte). Due schede per lo stesso argomento erano due posti dove cercare.
- **Il triangolino in Ordini cliente NON e cambiato** — Nico l ha chiesto "come adesso". Cambia dove porta.
- **`statoMateriale(m, oggi)` in domain**: la lettura che mancava. `mancanteCategoria` metteva nello stesso `in_arrivo` la roba che arriva domani e quella che doveva arrivare a maggio. Qui `in_arrivo` si spacca sulla data e si tira su l ORDINE FORNITORE. Ritorna `{stato, data, of, fornitore, qta}` con stato = `da_ordinare` · `in_ritardo` · `in_arrivo` · `attesa_cliente` · `consumo`.
- **`riquadroRispostaMateriali(numeroOp)`**: arrivando dal triangolino la domanda non e "quali codici mancano" (quella e la tabella) ma **"posso finire questa commessa, e se no di chi e la mossa"**. Tre gruppi in ordine di urgenza — ⛔ manca l ordine (tocca a noi) · ⏰ in ritardo (si sollecita l OF) · 📦 in arrivo (si aspetta) — piu conto lavoro e consumo, e una riga finale che dice quanti codici fermano davvero la commessa.
- ⚠ **L OF sta in chiaro perche e la cosa con cui si va a sollecitare**: sapere che un pezzo e in ritardo senza sapere su quale ordine non serve a muoversi.
- **Sui dati veri (2 set)**: 227 attesa cliente · 63 in arrivo · 41 consumo · **14 in ritardo, tutti e 14 con OF e fornitore** (es. `20 080 2455` doveva arrivare il 31/08, OF `2026OF581`, FABBRI S.R.L.) · 13 da ordinare.
- ⚠ `apriMancantiFiltrati` forza la vista Alnus: restando sull ultima scelta si poteva atterrare sul fabbisogno calcolato, che risponde a un altra domanda.
- ⚠ Togliendo la scheda `fabb_calc` erano rimasti **due `renderTab(fabb_calc)`** nei bottoni della vista calcolata: bottoni che non avrebbero fatto piu niente, in silenzio. Trovati col grep prima di committare — **dopo aver tolto una scheda, cercare il suo id in tutto il file.**

### ▶ LE QUANTITA PER COMMESSA, e gli IMPEGNI (2 set, `2026-09-02.6`)
- **La domanda di Nico che ha trovato il buco**: *"dove vedo che mi mancano 24 pz del cod 20 080 2455 per completare 2026/OP/01917?"* — **non si vedeva da nessuna parte**. Il riquadro mostrava le quantita GLOBALI di Alnus (324 mancanti su 400 impegnati su TUTTI gli ordini), che di quella commessa non dicono niente.
- Ora ogni riga del riquadro dice **`servono N · mancano M`** per QUELLA commessa, e la riga finale conta i codici che mancano a lei, non quelli che Alnus segnala in generale. Le quantita arrivano dopo il resto: servono la distinta e la ripartizione, e la distinta non sta in memoria.
- **Verificato sul caso che Nico conosce**: `20 080 2455`, giacenza 76, tre commesse dello stesso ordine — OP 01917 (100 pz, scad 04/09) · 01918 (50, 03/11) · 01921 (250, 02/12). La giacenza va alla scadenza piu vicina: **01917 coperto 76, MANCA 24**. Esattamente il numero che aveva in testa lui.
- ⚠⚠ **GLI IMPEGNI** (chiesto da Nico: *"stai tenendo conto anche degli impegni giusto?"*). Alnus dichiara per ogni codice quanto e gia promesso (`impegno`); noi la domanda ce la calcoliamo dalle commesse VIVE NEL GESTIONALE. **Se il suo impegno e piu grande della nostra domanda, la differenza e domanda che non vediamo** — commesse chiuse qui e aperte la, ordini che non passano da noi — e quella parte di magazzino **e gia parlata**. `disponibilePerNoi(giacenza, impegno, nostraDomanda)` in domain la mette da parte prima di ripartire.
  - Distribuirla lo stesso vorrebbe dire dire a una commessa che e coperta mentre il pezzo e destinato a un altro: **l errore piu caro, perche si scopre in linea.**
  - **Sui dati veri: 40 codici su 301 hanno impegno Alnus > nostra domanda**, quindi la riserva morde davvero. Su `20 080 2455` invece impegno 400 = nostra domanda 400: riserva 0, e i 24 restano 24.
  - La stessa regola vale nella vista calcolata: due numeri nella stessa scheda non possono dire cose diverse.

### ▶ FATTO: i materiali dalla distinta alla commessa (2-3 set)
Sequenza completata in due giorni, tutte le migrazioni ESEGUITE da Nico. Il dettaglio delle regole sta in CLAUDE.md, sezione "I MATERIALI". Qui restano le cose che si perdono.
- **Stato finale sui dati veri**: 9.325 materiali e 38.461 righe di distinta caricate · **68 commesse vive con la lista congelata, 2.735 righe**, coerenza `qta = qta_pz × pezzi` verificata 2735/2735 · 42 commesse senza distinta in Alnus · 31 con distinta fatta solo di segnaposto.
- ⚠⚠ **CI SONO CASCATO SULL RLS, che era gia scritto qui da agosto.** Lo strumento in blocco ha stampato "67/67 scritte" senza aver scritto niente: la PATCH su `operazioni` torna HTTP 200 con ZERO righe. Ora ogni scrittura si fa restituire la riga (`return=representation`) e se non torna niente si ferma. **Un comando che dichiara successo senza averlo fatto e peggio di uno che fallisce.** La strada buona e `--sql` + pannello.
- ⚠ **I CONTI DEVONO TORNARE, sempre.** La prima passata diceva 67 + 42 su 140 candidate: **31 sparivano in silenzio**, ed erano quelle con la distinta fatta solo di segnaposto. Ora lo strumento verifica da solo che la somma faccia il totale e lo stampa. Una categoria che manca all appello e un difetto, non un dettaglio.
- ⚠ **Un errore preso per un pelo**: uno script di modifica si e interrotto PRIMA di salvare mentre una correzione successiva era gia andata a segno -> `pMat` usato due volte e mai dichiarato. `node --check` passava (errore di RUNTIME) e la commessa sarebbe esplosa all apertura. **Dopo una modifica interrotta, contare dichiarazioni e usi: il --check non basta.**
- **Sequenza delle correzioni di Nico, tutte giuste**: "voglio semplicita" (la distinta va nella scheda articolo, non in una schermata nuova) -> "deve essere una scheda a se" (Materiali e una linguetta della commessa, non una sezione dentro Dati) -> "tutti i componenti, in ordine di codice" (la scheda risponde a *di cosa e fatta*, cosa manca e una colonna) -> "non deve essere un calcolo live" (e un impegno preso con l ordine).

### ▶ CHIUSO: il triangolino porta dentro l ordine (3 set, `2026-09-03.6`)
- **Il conto viene dalla LISTA CONGELATA**, non dall attribuzione di Alnus: il triangolino dice quanti codici mancano a QUELLA riga, e il clic apre la sua scheda Materiali. Sui dati veri: 68 commesse col conto esatto, **57 con almeno un codice mancante**, 984 codici in tutto. Su `2026/OP/01917` escono i due giusti (20 080 2455 con 24 mancanti, e la lavorazione Botturi) piu 10 coperti.
- **`disponibile` ≠ `coperto`** (domanda di Nico, ed era la prova che le etichette non si spiegavano): disponibile = non e nemmeno sotto scorta · coperto = **E** sotto scorta ma la fetta di questa commessa c e perche scade prima. **Coperto e FRAGILE**: il tooltip dice quante altre commesse se lo contendono, che e il numero che dice quanto.

- ⚠⚠ **DUE DIFETTI MIEI IN FILA, e la seconda lezione vale piu della prima.**
  1. *"esco da una commessa e rientro e non ritrova la situazione, a meno che non clicco rigenera"*: `renderMancanti()` gira 500 righe prima di `openModal()`, e dentro c era `if (!sezMateriali.isConnected) return`. La guardia era **giusta finche il calcolo era asincrono**; reso sincrono, scattava sempre. **Una guardia scritta per del codice asincrono diventa un difetto il giorno che quel codice smette di esserlo** — non basta togliere l `await`.
  2. Sistemando la 1, ho tolto il wrapper `(async () => {…})()` e i `return` che stavano dentro sono passati a uscire da TUTTA `openOperazioneModal`, saltando `openModal()`: il caso piu comune (nessun codice mancante, 11 su 68) avrebbe impedito alla scheda di aprirsi. Preso prima di committare con un controllo mirato. **Togliendo un wrapper di funzione, ogni `return` che c era dentro cambia significato.**

### ▶ RAGIONAMENTI SU DDT, FATTURA E SDI (1 set, per il futuro — nessuna azione ora)
**Nessun vincolo legale sull'MRP.** Pianificazione, distinta, magazzino, ordini fornitore sono strumenti interni: nessuna omologazione, nessun obbligo di comprare. I vincoli cominciano solo sui documenti fiscalmente rilevanti.

**DDT — si può fare in casa, ed è FUORI dal percorso MRP** (non serve distinta né magazzino, non passa dal cancello).
- Deve contenere quanto chiede il DPR 472/96: data, **numero progressivo**, mittente/destinatario/vettore, natura-qualità-quantità dei beni, causale del trasporto. Va conservato. Regge la **fattura differita**.
- **Il furgoncino è il posto giusto**, ma ⚠ **un DDT non è una spedizione: è un VIAGGIO**. Misurato sullo storico: 124 gruppi cliente+giorno, **63 con più di una riga** (fino a 8). "Un clic = un DDT" avrebbe stampato 2-8 bolle per un carico solo, una volta su due.
- **Disegno a due tempi**: il furgoncino mette la riga in una **bolla aperta** per quel cliente/giorno → si chiude la bolla e nasce il DDT con tutte le righe. Stessa forma di "vedi l'ordine per intero", raggruppata per cliente.
- ⚠ **La numerazione la dà il DATABASE**, progressiva e senza buchi: due postazioni che chiudono insieme stamperebbero lo stesso numero. È la trappola degli accavallamenti dei timbri, già pagata una volta.
- ⚠ **Il DDT deve esistere PRIMA che il furgone parta** (accompagna la merce): il gesto di chiusura va dove si carica — kiosk o telefono — non solo alla scrivania.
- ⚠ **Chiave della bolla**: cliente + giorno, **o cliente + destinazione + giorno?** `spedizioni.destinatario` è **vuoto su tutte e 264**, quindi dai dati non si sa se capita di spedire allo stesso cliente in posti diversi. **Domanda da fare a Nico prima di costruire**: aggiungerla dopo vuol dire rifare la chiave.
- ⚠ **È un interruttore, non una transizione**: dal giorno che il DDT lo emette il gestionale, in Alnus non se ne devono più fare per la stessa merce, o si hanno due numerazioni sulla stessa consegna. E se oggi Alnus fattura dai suoi DDT, spostando il DDT qui **gli si toglie l'origine della fattura**: si decide con chi fattura, non da soli.
- **Oggi NON si registrano DDT qui, ed è giusto così**: sarebbe doppio lavoro con Alnus. I 17 numeri DDT su 244 spedizioni **non sono un rischio**, sono copie a mano di numeri nati altrove.

**Fattura — il confine è netto.**
- **Sapere COSA fatturare**: zero vincoli, ed è dove il gestionale è imbattibile (è l'unico che sa commessa, pos, pezzi spediti e prezzo; il software del commercialista non sa cosa sia una `pos`).
- **EMETTERE**: XML FatturaPA via SdI + conservazione a norma 10 anni + registri. Resta fuori. Decisione già presa e coerente con il filo aperto 5.
- **Volume reale**: 8-16 fatture al mese (giugno 16, luglio 16, agosto 8). A questa scala **il portale AdE manuale basta**: niente provider per trasmettere.
- ⚠ **Ma i dati non ci sono**: sulle spedizioni degli ultimi 90 giorni **solo il 22% ha un prezzo** (54 su 244), e **0 clienti su 26 hanno la p.iva** (gli indirizzi invece ci sono quasi tutti). Prima di qualsiasi cosa: p.iva, e il prezzo che diventa un dato che c'è SEMPRE (249 commesse su 423 non ce l'hanno).
- **Ordine giusto**: p.iva → prezzo sempre presente → DDT generato → **prospetto di fatturazione mensile** → (solo se serve) XML a un intermediario. Le prime quattro non hanno vincoli legali e danno quasi tutto il valore.
- ⚠ **Il rischio vero non è sbagliare l'XML** (lo scarta lo SdI e te ne accorgi): è **dimenticarsi di fatturare una spedizione**.

**SdI — cosa comporta davvero.**
- Non si manda la fattura al cliente: si manda allo SdI, che valida e consegna. Serve il **codice destinatario** (7 caratteri) o la PEC del cliente: **due campi che l'anagrafica non ha**, insieme alla p.iva.
- Canali: portale AdE (manuale, gratis) · PEC · SDICoop (accreditamento, certificati, collaudo) · SDIFTP · **intermediario** (quello che fa ogni PMI). **Il canale proprio non va costruito mai**: non dà niente che non si compri per poche decine di euro al mese.
- ⚠ **Le notifiche sono la parte che si dimentica**: consegnata / **scartata** (= NON emessa, pochi giorni per correggere senza perdere la data) / mancata consegna (va avvisato il cliente). Sono **due passaggi al mese, non uno**.
- ⚠ **La conservazione non è inclusa nel caricamento**: 10 anni a norma, convenzione gratuita AdE o provider. Facile dimenticarsene perché caricare sembra "fatto".
- ⚠ **L'XML non è prezzo × quantità**: aliquota IVA per riga, natura dove non imponibile (**il conto lavoro può portare reverse charge**), modalità e termini di pagamento, IBAN, riferimento ai DDT (numero e data, è ciò che legittima la differita), bollo dove ricorre.
- **La differita è una scelta PER CLIENTE**, non una legge del sistema: va messa come impostazione sulla scheda azienda dall'inizio.
- ⚠⚠ **INVARIANTE, vale per DDT e doppio per la fattura: UN SISTEMA SOLO NUMERA ED EMETTE.** Due serie progressive sulla stessa azienda sono un guaio che si scopre a marzo dell'anno dopo. La parte tecnica è piccola: **l'accordo con lo studio è la parte che richiede tempo.**
- **Rovescio da vedere ora che si pensa agli ordini fornitore**: dallo SdI le fatture **arrivano** anche. Confrontare le fatture fornitore con gli ordini vuol dire costruire un lato ricezione, non un dettaglio dello stesso lavoro.
- ⚠ Non sono un commercialista, e formati e termini si aggiornano: alla resa dei conti verificare le specifiche AdE del momento e farsi confermare dallo studio.

### Aperti
1. **Niente è stato provato sull'app vera loggata.** Le misure sono su banco di prova, non sulla pagina reale con i dati veri: al primo giro guardare la colonna OP con OP lunghi e la tabella su schermo pieno.
2. **La casella OP non ha un test.** Il salvataggio al blur passa da `eseguiConRetry` come le altre scritture inline (prep, stato), ma nessuna prova automatica copre "solo prefisso = null" dal lato tabella. La regola in domain (`opSoloPrefisso`, `prefissoOpCorrente`) è invece banale da coprire.
3. **Il messaggio del commit `fa90421` ha una `@` di troppo** in prima riga (errore di sintassi shell). Contenuto corretto. **Deciso di lasciarlo**: ripulirlo vuol dire riscrivere 5 commit già pubblicati, forzare il push su `main` e far ripartire Pages, per un carattere in un log.
4. Restano aperti i punti della sezione precedente (anomalie Alnus, `migrazione-tipo-parte.sql`, egress, il dato `EL0000515`).
