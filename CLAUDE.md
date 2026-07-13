# CLAUDE.md — Gestionale Cablotec

> Derivato da `handoff.md` (che resta la fonte per i fili aperti: aggiornarlo lì e rigenerare qui se cambia).

## Contesto lampo
- **Cos'è**: gestionale ERP Cablotec. Backend **Supabase**, hosting **GitHub Pages** (deploy = git push, nessun build tool, **script classici — niente ES module**, scope globale condiviso).
- **Pubblicazione Pages** (dal 6 lug 2026): via workflow esplicito `.github/workflows/pages.yml` (Source = "GitHub Actions"). La pipeline "legacy" da branch si era incastrata lato GitHub (build fermi ore in 'building', run non cancellabili) — non tornare a "Deploy from a branch". Se un deploy fallisce: Actions → Re-run jobs, o commit vuoto.
- **Architettura nuova** (switch weekend 4-5 lug 2026, il monolite è stato spaccato):
  - `index.html` / `kiosk.html` — gusci gemelli (~150 righe, stesso body statico; kiosk.html imposta `window.CABLOTEC_MODE='kiosk'`)
  - `app.js` (~14.000 r) / `app.css` — logica e stili del gestionale
  - `core/db.js` — connessione Supabase condivisa da TUTTI i frontend: config, `creaClientSupabase(storageKey)`, `SB_NOOP_LOCK`, `conTimeoutAuth`, `ricreaConnessione` + hook `onRiconnessione(fn)`, `eseguiConRetry`, `assicuraSessioneValida`
  - `domain/scheduling.js` (~790 r) — motore pianificazione **PURO** (no DOM, no Supabase): calendario/capacità, `opCalcInizio`/`opInizio`/`opFasiWindows`, ore previste/residue/reali, carico% (`calcolaCarico*Range`, `pesiEntitaCommessa`, `distribuisciOreOperazione`)
  - `mobile.html` / `prelievo.html` — app leggere autonome, agganciate a core/db.js con storage key dedicate (`sb-cablotec-mobile` / `-prelievo`)
  - `index-vecchio.html` — SCORTA rollback (vecchio monolite); da cancellare tra qualche settimana se tutto regge
- **Kiosk**: `kiosk.html` è pagina vera (niente redirect). `?kiosk` vive solo come **fallback di transizione** in app.js (`IS_KIOSK = CABLOTEC_MODE==='kiosk' || ?kiosk`); da togliere quando tutte le postazioni puntano a kiosk.html.
- **Cache**: a ogni deploy di app.js/app.css/core/domain va bumpato il `?v=YYYY-MM-DD` nei 4 gusci (index, kiosk, mobile, prelievo). Attuale: `v=2026-07-05.2` (suffisso `.N` per più deploy nello stesso giorno).

## Utente e stile di lavoro
- **Nico (titolare)** — italiano, conciso, pratico, testa in produzione, odia il superfluo.
- Vuole il **ragionamento PRIMA** di modifiche che toccano numeri visibili o modello dati.
- Su scelte aperte spesso dice "dimmi tu": dare una raccomandazione secca.

## Workflow dopo OGNI modifica
1. `node --check app.js && node --check core/db.js && node --check domain/scheduling.js` (core+domain+app condividono lo scope globale: verificare che i simboli usati esistano).
2. Verificare doppioni/orfani/handler `onclick=""` nell'HTML statico.
3. Passi piccoli e reversibili.

## ▶ Filo aperto principale: SEMPLIFICARE Gantt e modal commessa
- Nico (5 lug): "sto perdendo di vista, gantt e modal commessa sono troppo caotici, stiamo inserendo molte cose". Prima di nuove funzioni: fare ordine su queste due viste. Nessuna decisione presa; prossimo passo = capire con lui cosa deve vedere A COLPO D'OCCHIO e cosa può sparire/collassare.
- **Gantt reso utile (7 lug 2026, A+B+D)**: (A) commesse IN RITARDO (scadenza passata, residuo>0) ancorate a OGGI con barra rossa `⚠ RIT. Ng` — prima sparivano nel passato; (B) barre per-operatore = la SUA quota (helper puri `faseQuotaOreAddetto`/`opQuotaOreUtente`/`*RealiUtente` in domain), consuntivo = i suoi timbri; (D) fornitori dichiarati (tooltip "Con fornitore (in quota)" + badge "Fornitore su tutta la commessa" nel blocco fasi — l'assegnazione fase_id null non mostrava mai il nome). Restano in canna: C (dieta chips stati) ed E (riga REPARTO), da decidere con Nico.

## Livellamento risorse: RIAPERTO come "Data realistica" (7 lug 2026)
- Il motore `livellaOperatore` è **tornato in domain** (recuperato da `b35437b`): oggi alimenta il riquadro **"Data realistica di consegna"** nel modal commessa NUOVA (`stimaFineCommessaNuova` + `aggiornaDataRealistica`): coda attuale degli addetti scelti + ferie/chiusure → fine realistica in avanti, confrontata con la richiesta cliente (verde/rossa). Solo vista, zero scritture.
- Motivazione (Nico, 7 lug): "comunicare al cliente una data di consegna veritiera" — caso Marcella Dardi (coda + ferie). Il Gantt a ritroso NON può far slittare la consegna: la scadenza è input, non output.
- Prossimi passi possibili sulla stessa fondamenta: vista Gantt livellata (il vecchio toggle), autodistribuzione automatica.
- Decisioni confermate: avanti da oggi ✔, priorità manuale ✔, solo vista ✔.

## ⚠ Da tenere d'occhio
- **Carico% = occupazione pianificata**: finestra a quantità piena, ore intere, qualsiasi stato. Beta ok; verificare sul dato reale che gli "0" siano spariti e che %>100 su finestre strette abbiano senso.
- **Barre Gantt** usano ancora la finestra *residua*, il carico% quella *pianificata* — **VOLUTO**. Se Nico vuole allineare le barre: `pezziOverride` già pronto da applicare.
- **Primo lunedì in produzione sulla nuova architettura**: rollback = ripristinare index-vecchio.html o Revert del commit.

## Sospesi / differiti
- **Step 1b mai fatto**: le scritture di mobile.html (timbri!) usano ancora `sb.from()` nudo — avvolgerle in `eseguiConRetry` (il core lo espone già). Meccanico, punti di insert/update.
- **De-dup helper mobile/prelievo**: `elx`, formattatori ecc. duplicati nei due file → candidato `core/util.js`. Anche `domain/formato.js` (z, toLocalISO, parseISODate, fmtIT…) mai estratto da app.js.
- **Togliere il fallback `?kiosk`** quando le postazioni sono confermate su kiosk.html.
- **Pulizia DB lead-time**: colonne `lead_giorni` su `aziende` e `operazioni_fornitori` inerti, mai droppate (DROP irreversibile).
- **Potatura**: CSS non usato, rami morti in funzioni vive.
- **RPC**: spostare le scritture critiche su RPC Postgres, incrementale (si incastra in core/db.js).
- **Cancellare dal repo**: cartella `beta/` (dopo qualche giorno di radice stabile), poi `index-vecchio.html`.

## Decisione consolidata (5 lug 2026): fasi effettive = media storica VIVA
- Le commesse nuove nascono dalle **fasi effettive** dell'articolo: media storica (spedite+completate) dove esiste — viva, si aggiorna da sola a ogni commessa chiusa — e valore del template SOLO per i tipi senza storico. Niente gesto di ricopiare le medie in anagrafica.
- **Finestra (7 lug 2026)**: la media conta solo le **ULTIME 5 commesse chiuse** per (articolo, tipo) — `MEDIA_ULTIME_COMMESSE` in domain. Quando una lavorazione migliora, i tempi vecchi escono da soli; niente cancellazioni per "ripulire la media" (idea di Nico, risolta così).
- Motore: `fasiEffettiveArticolo(articoloId)` in domain/scheduling.js. La usano: pre-compilazione modal commessa, `proponiFasiPerCommessa`/`autoGeneraFasiDaMedia`, suggerimenti sulle fasi a 0.
- Il controllo economico resta il **tempo pagato** (mai auto-aggiornato).
- **Dal 6 lug 2026 — fasi esternalizzate fuori dai confronti interni**: `opCalcOreInterne(op)` in domain = ore previste della sola parte interna. Header ore, totali e riepilogo Consuntivo confrontano interno-vs-interno (pagato via `pagatoOreInterne`); le fasi con fornitore sono marcate "→ nome (esterna)" e il confronto fasi separa interne/esterne. La quota esterna è sempre DICHIARATA, mai nascosta (è un costo).
- **Dal 6 lug 2026 — fasi commessa in SOLA LETTURA**: nel modal commessa il blocco fasi mostra le fasi effettive dell'anagrafica (matita ✎ apre la scheda articolo con ritorno automatico via `opts.dopoChiusura` di `openArticoloModal`). Le `operazioni_fasi` su DB restano (timbri/assegnazioni si agganciano lì) e si **riallineano alle effettive al salvataggio** della commessa: minuti aggiornati, tipi nuovi aggiunti, MAI cancellazioni (le fasi non più in anagrafica restano, marcate "solo su questa commessa"). Ordine = ordine anagrafica. Tolto anche il toggle sequenza/parallelo (era morto: `opSequenziale()` è sempre true).

## Accorpamento commesse (9 lug 2026) — gruppo visto come UNA al kiosk
- L'admin raggruppa commesse dalla **Pianificazione** (bottone `⊞ Raggruppa` → modalità selezione → "Crea gruppo"); badge `⊞N` sulle righe, click sul badge per sciogliere. Persiste su `operazioni.gruppo_id` (UPDATE, serve sessione admin).
- **Kiosk**: le commesse con stesso `gruppo_id` si fondono in **una card** (banner `⊞ Gruppo di N`); ogni gruppo compare una volta sola (set `gruppiVisti`), niente doppio timbro.
- **Split alla chiusura del timbro** (`kioskChiudiOScarta`): il tempo si divide sulle N commesse lavorabili del gruppo (spedite/completate escluse) **IN PROPORZIONE al peso = quantità × minuti/pz effettivi** (una commessa da 7 pz assorbe più di una da 2; codici identici → ∝ pezzi; pesi uguali/mancanti → ÷uguali). La sessione aperta prende la sua quota, le altre nascono come sessioni nuove sfalsate (insert, nessuna cancellazione: coerente col vincolo RLS). Motore puro in domain: `ripartisciTimbroGruppo(inizio,fine,membri[])` + `commesseGruppoLavorabili` (18 test Node, incluso 5+2+7→500/200/700). Tutto il resto (consuntivo/medie/gantt/export) legge sessioni normali, zero modifiche.
- **RICHIEDE MIGRAZIONE** (una volta, da pannello Supabase SQL): `alter table operazioni add column gruppo_id uuid;`. Finché la colonna non c'è, nessun effetto (comportamento invariato).
- **v1, limiti noti**: la "fine fase" marca finita solo la commessa timbrata, non propaga al gruppo; fase_id=null sulle copie (match per tipo). Da valutare con Nico se servono.

## Prezzi / listino vivo (in corso, dal 12 lug 2026)
- **Piano condiviso con Nico**: prezzo di vendita sulla riga ordine (`operazioni.prezzo_unitario`) → **listino vivo** derivato (ultimo prezzo per articolo+cliente, non media: i prezzi si negoziano) → **storico prezzi** gratis (ogni riga tiene il suo prezzo+data+cliente) → alimenta €/ora cliente e andamento. Niente tabelle listino/storico: tutto derivato, come le fasi.
- **Sequenza**: (1) colonna prezzo + pre-compilazione nel modal ✔ FATTO; (2) inserimento ordini multi-riga (1 OC → N posizioni in griglia); (3) €/ora per cliente in Analisi clienti; poi traccia fornitori (tariffa → prezzo fasi).
- **Motore**: `prezzoListino(articoloId, clienteId)` (ultimo per created_at, ripiega su altro cliente) + `storicoPrezziArticolo` in domain (7 test). Asse tempo = `created_at` (non scadenza).
- **RICHIEDE MIGRAZIONE**: `alter table operazioni add column prezzo_unitario numeric;`. Il campo prezzo nel modal è gated su `prezzoAttivo` (rilevato dai dati caricati): finché la colonna non c'è, il blocco non si mostra e non si salva → nessun errore.
- **Da fare step 2/3**: griglia multi-riga; sezione listino (per cliente: ultimo prezzo + drill-down andamento) nell'anagrafica articolo; €/ora in Analisi clienti; prezzo base manuale opzionale sull'articolo (fallback cliente nuovo) solo se serve.

## Diciture unità (Nico ci tiene: UNA dicitura, SEMPRE quella)
- Tempo per pezzo: **`min/pz`** (mai l'apostrofo `'`).
- Totali di fase / minuti assoluti: **`min`**.
- Totali di commessa: **`h`** (una cifra decimale, virgola).
- Numero commesse: **"N commessa/commesse"** per esteso (mai "comm.").

## Principi consolidati (mantenere)
- Derivati calcolati **live**, mai materializzati (intento ≠ metrica ≠ storico).
- Interno = tempo misurato (timbri); esterno/materiali = costo + lead.
- `domain/` resta PURO (no DOM, no Supabase); `core/` non sa niente delle viste (usa gli hook).
- Prima di cancellare una funzione: cercare i chiamanti nel file intero, INCLUSI `onclick=""` nell'HTML statico.
- `node --check` a ogni passo; si elimina ciò che non è usato (non ciò che non è usato di recente).
