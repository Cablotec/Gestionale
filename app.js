/* ═══════════════════════════════════════════════════════════════════
   APP.JS — Gestionale Cablotec (logica applicativa + UI)
   Estratto dallo script inline di index.html. Richiede, caricati prima:
   supabase-js (CDN), core/db.js, domain/scheduling.js, xlsx (CDN).
   La modalità kiosk si attiva dal guscio con window.CABLOTEC_MODE='kiosk'
   (il vecchio `?kiosk` resta accettato come fallback di transizione).
   ═══════════════════════════════════════════════════════════════════ */
// `sb` è dichiarato e gestito in core/db.js
let realtimeChannel = null;
// Recovery realtime: ri-sottoscrizione automatica + ricarico di recupero.
let kioskChannel = null;
let _rtReconnectTimer = null;
let _kioskRtTimer = null;
let _rtNeedCatchup = false;
let _kioskNeedCatchup = false;
let _rtLivenessTimer = null;
// Controllo periodico: se il canale non è "joined", lo ricreo. È la rete di
// sicurezza per i client always-on (es. kiosk su mini PC) che non vanno mai in
// background e quindi non innescano il recovery legato a visibilitychange.
function _rtLivenessCheck() {
  if (!sb) return;
  // Stessa definizione di "vivo" usata al ritorno sulla scheda: una sola,
  // o le due si allontanano e cominciano a dire cose diverse.
  const vivo = realtimeVivo;
  if (IS_KIOSK) {
    if (!vivo(kioskChannel) && typeof kioskStartRealtime === 'function') {
      _kioskNeedCatchup = true;
      try { if (kioskChannel) sb.removeChannel(kioskChannel); } catch (e) {}
      kioskChannel = null;
      kioskStartRealtime();
    }
  } else {
    if (!vivo(realtimeChannel) && typeof startRealtime === 'function') {
      _rtNeedCatchup = true;
      try { if (realtimeChannel) sb.removeChannel(realtimeChannel); } catch (e) {}
      realtimeChannel = null;
      startRealtime();
    }
  }
}
const state = {
  session: null, profile: null, profiliById: {}, mezzi: [],
  appInizializzata: false, // true dopo il primo afterLogin completato
  impostazioni: {}, // mappa chiave→valore caricata da Supabase
  utenti: [], utentiById: {},
  prenotazioni: [],
  consegne: [],            // tutte le consegne in memoria
  consegneCommessa: [],    // consegne parziali di commesse (tabella consegne_commessa)
  prenOp: [],            // pivot prenotazione_id ↔ utente_id
  aziende: [],             // anagrafica unificata clienti/fornitori
  azFilter: 'attivi',      // 'all' | 'attivi' | 'disattivi'
  azRuoloFilter: 'tutti',  // 'tutti' | 'cliente' | 'fornitore' | 'entrambi'
  azSearch: '',
  articoli: [],            // anagrafica articoli/codici prodotto
  artFilter: 'attivi',     // 'all' | 'attivi' | 'disattivi'
  artSearch: '',
  tipiLav: [],             // anagrafica tipi di lavorazione
  chiusure: [],            // chiusure aziendali (festivi non nazionali)
  operazioni: [],          // operazioni di pianificazione
  opFilter: 'all',      // 'all' | 'aperte' | 'sospese' | 'spedite'
  // Set degli ID cliente da NASCONDERE nella Pianificazione (filtro stile Excel)
  // Si carica/salva da localStorage all'avvio della pagina.
  opClientiEsclusi: new Set(),
  opSearch: '',
  // Filtri Magazzino (clienti esclusi non persistiti: solo sessione)
  // Storico: clienti esclusi (multi, solo sessione)
  stoClientiEsclusi: new Set(),
  opSortKey: 'scadenza',
  opSortDir: 'asc',
  // Storico
  stoMese: null,           // YYYY-MM filtro mese (null = tutti)
  stoAddetto: '',          // filtro addetto_id
  stoFornitore: '',        // filtro fornitore (azienda_id)
  stoPunt: 'all',          // 'all' | 'puntuali' | 'ritardo'
  stoSearch: '',
  // Sessioni di lavoro (timbrature kiosk commesse)
  sessioni: [],
  // Assenze v2 (modello righe giornaliere)
  tipiAssenza: [],         // anagrafica tipi assenza con codice e ore_default
  attivitaExtra: [],       // anagrafica attività extra (lavoro non legato a commesse)
  spedizioni: [],          // eventi spedizione: pezzi usciti dal magazzino verso cliente
  assenze: [],             // righe assenza: {id, utente_id, tipo_assenza_id, data, ore, stato, ...}
  assAnno: new Date().getFullYear(),
  assMese: new Date().getMonth(), // 0-11
  assVistaCal: 'mese',     // 'mese' | 'riepilogo'
  // Operazioni: multi-addetto (tabella ponte)
  opAddetti: [],           // [{operazione_id, utente_id, fase_id, completata_il}]
  // Operazioni: fornitori esterni (aziende con is_fornitore=true)
  opFornitori: [],         // [{id, operazione_id, azienda_id, allocazione, creato_il}]
  oreEsterne: [],          // ore DICHIARATE da rapportino (tabella ore_esterne)
  mancanti: [],            // materiale mancante dal fabbisogno importato
  // Operazioni: fasi (scomposizione per tipo di lavorazione)
  opFasi: [],              // [{id, operazione_id, tipo_lavorazione_id, minuti_unitari, ordine, creato_il}]
  // Gantt
  ganttView: 'live',       // 'live' | 'storico'
  ganttZoom: 'mese',       // 'giorno' | 'settimana' | 'mese'
  ganttCursor: new Date(), // data centrale visualizzazione
  ganttStatiVisibili: null, // Set di stati commessa visibili nel Gantt (null = tutti, inizializzato al primo render)
  // Striscia timbrature sospette (scheda Live): APERTA di default (25 ago).
  // L'elenco esiste per essere svuotato, non per essere annunciato: col primo
  // stato chiuso il numero in intestazione si legge come un'insegna e nessuno
  // preme "Vedi quali". Il bottone resta, per metterla via mentre si lavora.
  sospetteAperto: true,
  // Stato kiosk runtime
  kioskOp: null,           // operazione selezionata nel flusso commesse
  kioskMode: null,         // 'menu' | 'mezzi' | 'commesse-list' | 'commesse-tipo' | 'commesse-attiva'
  kioskTimer: null,        // setInterval handle per refresh durata
  calCursor: new Date(), calZoom: 'settimana', currentTab: 'generale', currentArea: 'calendari',
  loaded: false,
};

/* Tema chiaro/scuro */
function applyTheme(theme) {
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  const btn = document.getElementById('btn-theme');
  if (btn) btn.textContent = theme === 'light' ? '☀️' : '🌙';
}
function toggleTheme() {
  const cur = localStorage.getItem('theme') || 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', next);
  applyTheme(next);
}
applyTheme(localStorage.getItem('theme') || 'dark');

const TIPI = [
  { id:'trasferta',    label:'Trasferta',    color:'#4effa3' },
  { id:'consegna',     label:'Consegna',     color:'#ff4e6b' },
  { id:'manutenzione', label:'Manutenzione', color:'#ff6b35' },
  { id:'altro',        label:'Altro',        color:'#b84eff' },
];
const TIPO_COLOR = Object.fromEntries(TIPI.map(t=>[t.id,t.color]));
const TIPO_BADGE = { trasferta:'bok', consegna:'berr', manutenzione:'bor', altro:'bvio' };

// Gruppi utenti — etichette per categorizzare le persone (lista fissa).
// Il valore tecnico (chiave) sta nel DB; l'etichetta è ciò che si vede.
// Per aggiungere/togliere un gruppo: estendere questo array, e poi rifare
// il CHECK constraint su Supabase (utenti_gruppo_check).
const GRUPPI_UTENTI = [
  { key: 'trasfertisti', label: 'Trasfertisti' },
  { key: 'cablotec_1',   label: 'Cablotec 1' },
  { key: 'cablotec_2',   label: 'Cablotec 2' },
  { key: 'laboratorio',  label: 'Laboratorio' },
  { key: 'ufficio',      label: 'Ufficio' },
];
const GRUPPO_LABEL = Object.fromEntries(GRUPPI_UTENTI.map(g => [g.key, g.label]));

// Raggruppa una lista di utenti per gruppo, nell'ordine canonico di GRUPPI_UTENTI.
// Restituisce un array di { key, label, utenti }, includendo solo i gruppi
// che hanno almeno un utente. Gli utenti senza gruppo finiscono in una
// sezione finale con key '__nogroup__' e label 'Senza gruppo'.
function raggruppaUtenti(lista) {
  const sezioni = [];
  GRUPPI_UTENTI.forEach(g => {
    const utenti = lista.filter(u => u.gruppo === g.key);
    if (utenti.length > 0) sezioni.push({ key: g.key, label: g.label, utenti });
  });
  const senzaGruppo = lista.filter(u => !u.gruppo);
  if (senzaGruppo.length > 0) {
    sezioni.push({ key: '__nogroup__', label: 'Senza gruppo', utenti: senzaGruppo });
  }
  return sezioni;
}

const $ = s => document.querySelector(s);
const el = (tag, attrs={}, ...children) => {
  const e = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'style') e.style.cssText = attrs[k];
    else if (k === 'html') e.innerHTML = attrs[k];
    else if (k.startsWith('on') && typeof attrs[k] === 'function')
      e.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
    else if (attrs[k] !== false && attrs[k] !== null && attrs[k] !== undefined)
      e.setAttribute(k, attrs[k]);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
};
// ATTENZIONE — el() scarta i figli null, ma `.append()` del DOM NO: gli passi
// null e lui ci scrive dentro la parola "null". Quindi su un elemento già
// creato NON si fa `x.append(cond ? el(...) : null)`, si fa
// `x.append(...(cond ? [el(...)] : []))`. È costato una caccia al bug: sulla
// card Live di chi era su un'attività extra compariva "null" al posto del
// codice articolo, che per le extra non esiste.
const z = n => String(n).padStart(2,'0');
const toLocalISO = d => `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`;
const parseISODate = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d); };
const monthName = d => d.toLocaleDateString('it-IT', { month:'long', year:'numeric' });
const fmtIT = iso => { const d = parseISODate(iso); return `${z(d.getDate())}/${z(d.getMonth()+1)}/${d.getFullYear()}`; };
const fmtT = d => `${z(d.getHours())}:${z(d.getMinutes())}`;

function toast(msg, kind='ok') {
  const t = el('div', { class:'toast'+(kind==='err'?' err':'') }, msg);
  $('#toast-root').appendChild(t);
  setTimeout(()=>t.remove(), 2800);
}

// ═══════════════════════════════════════════════════════════
// RESILIENZA CONNESSIONE — riconnessione automatica + retry
// ═══════════════════════════════════════════════════════════
// Problema: dopo un periodo di inattività (tab in background, sleep, ecc.)
// il client Supabase v2 può entrare in uno stato bloccato a causa del bug
// di _acquireLock in gotrue-js: il lock per il refresh del token non viene
// rilasciato e tutte le chiamate (auth + scritture) restano appese per sempre.
//
// Soluzione a tre livelli:
//  A. lock no-op nel createClient   → previene il deadlock alla radice
//  B. conTimeoutAuth()              → timeout su ogni chiamata sb.auth.*
//  C. ricreaConnessione()           → ricostruisce il client se necessario
//  D. eseguiConRetry()              → timeout+retry sulle scritture sb.from()
//  E. visibilitychange unificato    → un solo handler che orchestra il recovery

let _tokenKeepAliveTimer = null;
// I pezzi A/B/D (SB_NOOP_LOCK, conTimeoutAuth, ricreaConnessione,
// eseguiConRetry, assicuraSessioneValida) vivono in core/db.js (condivisi
// con mobile/prelievo). Qui resta solo ciò che è specifico di index:
// il Pezzo C (keep-alive + visibilitychange) e l'hook di riconnessione.

// Il canale realtime è ancora agganciato? Finché lo è, `applyChange` tiene
// aggiornata ogni tabella riga per riga e NON serve riscaricare niente.
function realtimeVivo(ch) { return !!ch && (ch.state === 'joined' || ch.state === 'joining'); }

// Rete di sicurezza. Ora la ricarica dopo un buco la fa la ri-sottoscrizione
// del realtime, che pero' non arriva mai se il realtime resta giu' mentre il
// resto della rete funziona: prima quel caso era coperto dalla ricarica
// incondizionata al ritorno sulla scheda. Se dopo qualche secondo il recupero
// e' ancora in sospeso, si ricarica lo stesso — una volta, non a ogni rientro.
let _rtCatchupFallback = null;
function ricaricaSeIlRealtimeNonRisponde(attesaMs) {
  clearTimeout(_rtCatchupFallback);
  _rtCatchupFallback = setTimeout(() => {
    const inSospeso = IS_KIOSK ? _kioskNeedCatchup : _rtNeedCatchup;
    if (!inSospeso || !sb || !state.profile) return;
    if (IS_KIOSK) {
      _kioskNeedCatchup = false;
      if (typeof kioskLoadAll === 'function') kioskLoadAll().then(kioskRefreshActive).catch(() => {});
      return;
    }
    _rtNeedCatchup = false;
    if (!state.loaded || typeof loadAllData !== 'function') return;
    console.warn('[recovery] il realtime non si e\' riagganciato: ricarico i dati lo stesso');
    loadAllData().then(() => {
      if (typeof switchToTab === 'function' && state.currentArea && state.currentTab) {
        switchToTab(state.currentArea, state.currentTab);
      } else if (state.currentTab && typeof renderTab === 'function') {
        renderTab(state.currentTab);
      }
    }).catch(() => {});
  }, attesaMs || 8000);
}

// Dopo ogni ricreazione del client (core), riavvia il realtime giusto.
onRiconnessione(() => {
  // Il client è stato buttato via: gli eventi accaduti nel frattempo sono
  // persi e il realtime non li riproduce. Segnare il recupero QUI rende la
  // ri-sottoscrizione l'unica responsabile della ricarica — una sola, invece
  // delle due che partivano prima (questa e quella di `visibilitychange`).
  _rtNeedCatchup = true;
  _kioskNeedCatchup = true;
  realtimeChannel = null; // così startRealtime ricreerà il canale
  if (IS_KIOSK) {
    kioskChannel = null; // i canali vecchi sono stati rimossi: consenti la ri-sottoscrizione
    if (typeof kioskStartRealtime === 'function') {
      try { kioskStartRealtime(); } catch (e) {}
    }
  } else if (typeof startRealtime === 'function') {
    try { startRealtime(); } catch (e) {}
  }
});

// ─── PEZZO C: recovery preventivo + keep-alive ───
function installaProtezioneSalvataggi() {
  if (window.__protezioneInstallata) return;
  window.__protezioneInstallata = true;

  // Keep-alive token ogni 4 minuti
  clearInterval(_tokenKeepAliveTimer);
  _tokenKeepAliveTimer = setInterval(() => { assicuraSessioneValida(); }, 4 * 60 * 1000);

  // Quando la pagina torna attiva dopo essere stata in background:
  // - se è stata in background a lungo, ricrea preventivamente la connessione
  //   (potrebbe essersi addormentata e creare il deadlock dei salvataggi)
  // - poi ricarica i dati per riallineare la UI con eventuali modifiche remote.
  let ultimaAttivita = Date.now();
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      const inattivaDa = Date.now() - ultimaAttivita;
      try {
        // Se è stata in background più di 30 secondi, ricrea per sicurezza.
        // Sopra i 30s il rischio del deadlock di gotrue-js diventa concreto.
        if (inattivaDa > 30000) {
          // Ricrea il client (cura del deadlock). La ricarica dei dati NON si
          // fa qui: `onRiconnessione` segna il recupero e la ri-sottoscrizione
          // del realtime la esegue una volta sola.
          await ricreaConnessione();
          ricaricaSeIlRealtimeNonRisponde();
        } else {
          await assicuraSessioneValida();
          // Rientro veloce: se il canale è ancora agganciato i dati sono già
          // aggiornati da `applyChange` e non c'è NIENTE da riscaricare.
          // Era questa la spesa più grossa dell'app: 604 KB per ogni ritorno
          // sulla scheda, ~187 ricariche al giorno fra tutti gli admin.
          if (sb && state.profile && !realtimeVivo(IS_KIOSK ? kioskChannel : realtimeChannel)) {
            _rtNeedCatchup = true;
            _kioskNeedCatchup = true;
            if (IS_KIOSK) {
              if (typeof kioskStartRealtime === 'function') kioskStartRealtime();
            } else if (typeof startRealtime === 'function') {
              startRealtime();
            }
            ricaricaSeIlRealtimeNonRisponde();
          }
        }
      } catch (e) {
        console.warn('[recovery] errore al ritorno in foreground:', e?.message || e);
      }
    } else {
      ultimaAttivita = Date.now();
    }
  });
  window.addEventListener('focus', () => { assicuraSessioneValida(); });

  // Quando la rete torna disponibile dopo una caduta
  window.addEventListener('online', async () => {
    console.log('[recovery] rete tornata online — ricreo la connessione');
    // Anche qui la ricarica la fa la ri-sottoscrizione del realtime, una sola
    // volta: `onRiconnessione` ha gia' segnato il recupero. Prima questa
    // seconda `loadAllData()` raddoppiava il traffico di ogni rientro.
    await ricreaConnessione();
    ricaricaSeIlRealtimeNonRisponde();
  });
}

// Watchdog visivo: se dopo N secondi un bottone è ancora "in corso", lo sblocca.
// Usato come ultima rete di sicurezza nelle modal.
function avviaWatchdog(btn, testoOriginale, secondi) {
  const ms = (secondi || 20) * 1000;
  const timer = setTimeout(() => {
    if (btn && btn.disabled) {
      btn.disabled = false;
      if (testoOriginale) btn.textContent = testoOriginale;
      toast('Salvataggio non riuscito: connessione non disponibile. Riprova.', 'err');
    }
  }, ms);
  return () => clearTimeout(timer);
}

// Rileva modalità kiosk dall'URL: deve essere esattamente `?kiosk` (senza valore).
// URL con valore (es. ?kiosk=sede1, ?kiosk=on, ...) NON sono accettati.
const _kioskParam = new URLSearchParams(location.search).get('kiosk');
// Modalità kiosk: la decide il GUSCIO (kiosk.html imposta window.CABLOTEC_MODE).
// Il vecchio `?kiosk` resta accettato finché tutte le postazioni non puntano
// a kiosk.html; poi il fallback si potrà togliere.
const IS_KIOSK = (window.CABLOTEC_MODE === 'kiosk') || _kioskParam === '';
const KIOSK_PARAM_INVALIDO = _kioskParam !== null && _kioskParam !== '';

// Credenziali account kiosk condiviso (creato a mano su Supabase, vedi istruzioni)
const KIOSK_EMAIL = 'kiosk@cablotec.local';
const KIOSK_PASSWORD = 'kiosk-cablotec-2026';

// True se questo operatore o profilo è l'account tecnico kiosk
function isKioskRecord(rec) {
  if (!rec) return false;
  return (rec.email || '').toLowerCase() === KIOSK_EMAIL.toLowerCase();
}

// Legge un'impostazione globale con fallback. Le impostazioni sono salvate
// come testo nel DB; il secondo argomento è il default usato se la chiave
// non c'è. Se serve un numero, parsalo dal chiamante.
function getImpostazione(chiave, defaultVal) {
  const v = state.impostazioni && state.impostazioni[chiave];
  return (v === undefined || v === null) ? defaultVal : v;
}

// ── Persistenza filtro clienti (Pianificazione) ──────────────
// Salva/carica l'insieme di clienti ESCLUSI in localStorage.
// Chiave: 'cablotec.opClientiEsclusi.v1' (la v1 ci serve se un giorno cambiamo formato)
const LS_CLIENTI_ESCLUSI = 'cablotec.opClientiEsclusi.v1';
function caricaFiltroClienti() {
  try {
    const raw = localStorage.getItem(LS_CLIENTI_ESCLUSI);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch (e) {
    return new Set();
  }
}
function salvaFiltroClienti(set) {
  try {
    localStorage.setItem(LS_CLIENTI_ESCLUSI, JSON.stringify([...set]));
  } catch (e) {
    console.warn('Impossibile salvare filtro clienti:', e);
  }
}

// ── Finestre di apertura assenze ─────────────────────────────
// Ogni finestra ha 4 date in formato 'gg-mm' (giorno-mese, ricorrenti
// ogni anno): apertura_da/a = quando l'utente può inserire,
// periodo_da/a = su quale arco di tempo può inserire.
// Per i periodi a cavallo dell'anno (es. inverno 01-10 → 31-03), se la
// fine "gg-mm" risulta minore dell'inizio, il periodo attraversa l'anno.

// Parsing di una stringa 'gg-mm' → {giorno, mese}. Restituisce null se invalida.
function parseGGMM(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const g = +m[1], me = +m[2];
  if (g < 1 || g > 31 || me < 1 || me > 12) return null;
  return { giorno: g, mese: me };
}

// True se la data ISO 'iso' cade dentro un intervallo definito da due 'gg-mm'.
// Gestisce intervalli a cavallo d'anno.
function isoDentroIntervallo(iso, ggmmDa, ggmmA) {
  const da = parseGGMM(ggmmDa), a = parseGGMM(ggmmA);
  if (!da || !a) return false;
  const d = parseISODate(iso);
  const g = d.getDate(), m = d.getMonth() + 1;
  // Trasformo gg-mm in numero "mmgg" comparabile (es. 15 marzo → 0315)
  const k = (mm, gg) => mm * 100 + gg;
  const kd = k(m, g), kDa = k(da.mese, da.giorno), kA = k(a.mese, a.giorno);
  if (kDa <= kA) return kd >= kDa && kd <= kA;          // intervallo normale
  return kd >= kDa || kd <= kA;                          // a cavallo d'anno
}

// Restituisce le due finestre (estiva e invernale) lette dalle impostazioni.
function getFinestreAssenze() {
  return [
    {
      nome: 'estiva',
      aperturaDa: getImpostazione('finestra_estiva_apertura_da', '01-03'),
      aperturaA:  getImpostazione('finestra_estiva_apertura_a',  '31-03'),
      periodoDa:  getImpostazione('finestra_estiva_periodo_da',  '01-04'),
      periodoA:   getImpostazione('finestra_estiva_periodo_a',   '30-09'),
    },
    {
      nome: 'invernale',
      aperturaDa: getImpostazione('finestra_invernale_apertura_da', '01-09'),
      aperturaA:  getImpostazione('finestra_invernale_apertura_a',  '30-09'),
      periodoDa:  getImpostazione('finestra_invernale_periodo_da',  '01-10'),
      periodoA:   getImpostazione('finestra_invernale_periodo_a',   '31-03'),
    },
  ];
}

// Restituisce l'elenco dei gruppi esenti dai vincoli di inserimento assenze
// (le finestre di apertura e il blocco sulle date passate non si applicano
// agli utenti di questi gruppi). Letto da impostazioni come JSON; fallback
// ['laboratorio'] = stato storico, così se la chiave non è mai stata salvata
// il comportamento resta quello dell'esenzione introdotta sessione precedente.
function getGruppiEsentiAssenze() {
  const raw = getImpostazione('assenze_gruppi_esenti', null);
  if (raw === null || raw === undefined) return ['laboratorio'];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn('Impostazione assenze_gruppi_esenti non valida:', raw);
    return [];
  }
}

// Decide se un utente non-admin può oggi inserire/modificare un'assenza sulla
// data 'iso'. Regola: oggi deve cadere nella finestra di apertura associata
// al periodo a cui appartiene 'iso'. Restituisce { ok, motivo, finestra }.
function verificaAccessoAssenza(iso, utente) {
  // Eccezione: i gruppi configurati come esenti hanno inserimento libero
  // (nessun vincolo di finestra né di data passata). Configurabile da
  // Impostazioni → Calendari.
  const esenti = getGruppiEsentiAssenze();
  if (utente?.gruppo && esenti.includes(utente.gruppo)) {
    return { ok: true, esenzione: utente.gruppo };
  }
  const oggiIso = toLocalISO(new Date());
  // Le date passate non sono mai accessibili agli utenti
  if (iso < oggiIso) {
    return { ok: false, motivo: 'date passate non modificabili dagli utenti' };
  }
  const finestre = getFinestreAssenze();
  // A quale finestra appartiene 'iso'?
  const finestra = finestre.find(f => isoDentroIntervallo(iso, f.periodoDa, f.periodoA));
  if (!finestra) {
    return { ok: false, motivo: 'questa data non rientra in nessuna finestra di apertura assenze' };
  }
  // Oggi è dentro la finestra di apertura?
  const aperta = isoDentroIntervallo(oggiIso, finestra.aperturaDa, finestra.aperturaA);
  if (!aperta) {
    return {
      ok: false,
      motivo: `le assenze per il periodo ${finestra.nome} si possono inserire dal ${finestra.aperturaDa} al ${finestra.aperturaA}`,
      finestra,
    };
  }
  return { ok: true, finestra };
}

async function init() {
  if (SUPABASE_URL.includes('XXXX') || SUPABASE_ANON_KEY.includes('INSERISCI')) {
    document.body.innerHTML = `
      <div class="setup">
        <h1>⚠ Configurazione mancante</h1>
        <p>Apri questo file con un editor e in cima imposta:</p>
        <ul style="margin:10px 0 10px 20px;">
          <li><code>SUPABASE_URL</code></li>
          <li><code>SUPABASE_ANON_KEY</code></li>
        </ul>
        <p>Le trovi nella dashboard Supabase → <em>Project Settings → API</em>.</p>
      </div>`;
    return;
  }
  creaClientSupabase('sb-cablotec-auth');

  // ─── Protezione anti-blocco salvataggi ───
  // Avvolgiamo sb.from() così che ogni scrittura (insert/update/delete/upsert)
  // rinnovi il token PRIMA, evitando il refresh "in mezzo" che blocca l'operazione.
  // Le letture (select) non vengono toccate.
  installaProtezioneSalvataggi();

  // ─── PARAMETRO KIOSK CON VALORE NON ACCETTATO ───
  // L'unico URL kiosk valido è `?kiosk` senza valore. URL come ?kiosk=sede1
  // mostrano questo errore (i mini-PC vanno aggiornati al nuovo URL).
  if (KIOSK_PARAM_INVALIDO) {
    document.body.innerHTML = `
      <div class="setup">
        <h1>⚠ URL kiosk non valido</h1>
        <p>L'indirizzo giusto per le postazioni è <code>kiosk.html</code>.</p>
        <p style="margin-top:14px;"><a href="./kiosk.html" style="color:var(--acc);">→ Apri il kiosk</a></p>
        <p><a href="./" style="color:var(--mut);">← Torna al gestionale</a></p>
      </div>`;
    return;
  }

  // ─── MODALITÀ KIOSK ───
  if (IS_KIOSK) {
    await kioskInit();
    return;
  }

  // ─── MODALITÀ NORMALE ───
  let session = null;
  try {
    const { data } = await conTimeoutAuth(sb.auth.getSession(), 6000);
    session = data?.session || null;
  } catch (e) {
    console.warn('[init] getSession timeout, proseguo senza sessione:', e?.message || e);
  }
  state.session = session;
  if (session) await afterLogin();
  else renderAuth();
  sb.auth.onAuthStateChange(async (evt, sess) => {
    state.session = sess;
    if (sess) {
      // afterLogin ricostruisce TUTTA l'interfaccia (bindTabs incluso, che
      // riporta a Calendari→Generale). Va eseguita solo al primo login.
      // Eventi come TOKEN_REFRESHED scattano al ritorno in foreground dopo
      // che la scheda è stata in background: NON devono re-inizializzare
      // l'app, altrimenti l'utente perde la scheda su cui stava lavorando.
      if (!state.appInizializzata) {
        await afterLogin();
      }
    } else {
      state.profile = null;
      state.appInizializzata = false;
      renderAuth();
    }
  });
}

function renderAuth() {
  $('#app-screen').style.display = 'none';
  const root = $('#auth-screen');
  root.style.display = 'flex';
  root.innerHTML = '';

  const box = el('div', { class:'auth-box' });
  box.append(
    el('h2', { html:'Cabl<span>otec</span>' }),
    el('div', { class:'auth-sub' }, 'Sistema gestionale — accedi'),
  );

  const form = el('form');
  form.append(
    el('div', { class:'field' }, el('label', {}, 'Email'),
      el('input', { type:'email', name:'email', required:'true', autocomplete:'email' })),
    el('div', { class:'field' }, el('label', {}, 'Password'),
      el('input', { type:'password', name:'password', required:'true', minlength:'6',
                    autocomplete:'current-password' })),
    el('button', { type:'submit', class:'btnp', style:'width:100%;padding:11px;margin-top:6px;' },
      'Accedi'),
  );
  const msg = el('div', { class:'auth-msg' });
  form.append(msg);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.className = 'auth-msg';
    msg.textContent = 'Attendere…';
    const fd = new FormData(form);
    try {
      const { error } = await sb.auth.signInWithPassword({
        email: fd.get('email'), password: fd.get('password'),
      });
      if (error) throw error;
    } catch (err) {
      msg.className = 'auth-msg err';
      msg.textContent = err.message || 'Errore di accesso';
    }
  });
  box.append(form);

  box.append(el('div', { class:'auth-foot', style:'margin-top:16px;font-size:11px;color:var(--mut);text-align:center;line-height:1.6;' },
    'Gli account vengono creati dall\'amministratore.',
    el('br'),
    'Per problemi di accesso contatta l\'ufficio.'));

  root.append(box);
}

async function afterLogin() {
  const uid = state.session.user.id;
  const { data: prof } = await sb.from('profili').select('*').eq('id', uid).maybeSingle();
  state.profile = prof || { id:uid, email:state.session.user.email, nome:state.session.user.email, ruolo:'user' };

  $('#auth-screen').style.display = 'none';
  $('#app-screen').style.display = 'block';
  $('#user-name').innerHTML = '<b>'+(state.profile.nome || state.profile.email)+'</b>';
  $('#role-pill').innerHTML = state.profile.ruolo === 'admin'
    ? '<span class="badge bvio">admin</span>' : '<span class="badge bgry">user</span>';
  $('#area-gestione').style.display = state.profile.ruolo === 'admin' ? '' : 'none';
  $('#area-impostazioni').style.display = state.profile.ruolo === 'admin' ? '' : 'none';
  // Bottone Kiosk: admin (per testare/aprire da PC personale) + account kiosk
  // dedicato (perché LUI deve sempre poter tornare al kiosk dei mini-PC)
  const mostraBottoneKiosk = state.profile.ruolo === 'admin' || isKioskRecord(state.profile);
  $('#btn-kiosk').style.display = mostraBottoneKiosk ? '' : 'none';
  applyTheme(localStorage.getItem('theme') || 'dark');

  // Carica filtri persistenti
  state.opClientiEsclusi = caricaFiltroClienti();

  bindTabs();

  // Carico tutto una volta sola, in parallelo
  const root = $('#tab-content');
  root.innerHTML = '<div class="empty">Caricamento…</div>';
  try {
    await loadAllData();
    state.loaded = true;
    state.appInizializzata = true;
    startRealtime();
    renderTab(state.currentTab);
  } catch (e) {
    console.error('Errore caricamento dati:', e);
    root.innerHTML = '';
    root.append(el('div', { class:'empty', style:'color:var(--red);' },
      el('div', { style:'margin-bottom:10px;' }, '⚠ Errore caricamento: '+(e.message||'sconosciuto')),
      el('button', { class:'btnp', onclick:()=>afterLogin() }, 'Riprova'),
    ));
  }
}

document.addEventListener('click', async (e) => {
  if (e.target.id === 'btn-logout') await sb.auth.signOut();
  if (e.target.id === 'btn-theme') toggleTheme();
  if (e.target.id === 'btn-kiosk') location.href = './kiosk.html';
});

// Versione in uso sotto il logo: letta dal ?v= del proprio tag script,
// così il bump di cache a ogni deploy aggiorna anche la scritta (una
// fonte sola, niente numeri da tenere allineati a mano).
const APP_VERSIONE = (() => {
  try {
    const sc = document.querySelector('script[src*="app.js?v="]');
    return sc ? (sc.getAttribute('src').split('v=')[1] || '') : '';
  } catch (e) { return ''; }
})();
(function mostraVersione() {
  if (!APP_VERSIONE) return;
  const sub = document.querySelector('.topbar .sub');
  if (sub) sub.textContent = 'Sistema Gestionale — v. ' + APP_VERSIONE;
  // Anche sul kiosk (sotto il titolo): le postazioni restano accese per
  // giorni, senza questa scritta non si sa mai cosa stanno eseguendo.
  const kt = document.querySelector('.kiosk-title');
  if (kt) kt.append(el('div', {
    style:'font-size:11px;color:var(--mut);font-family:JetBrains Mono,monospace;letter-spacing:.05em;margin-top:2px;',
  }, 'v. ' + APP_VERSIONE));
})();

// ── Auto-aggiornamento kiosk ──
// Ogni 5 minuti controlla se il server pubblica una versione nuova (il ?v=
// nel guscio HTML). Se sì e la postazione è ferma sulla schermata di
// identificazione (nessuno sta lavorando), ricarica da sola: mai più
// postazioni rimaste indietro di giorni.
if (IS_KIOSK && APP_VERSIONE) {
  setInterval(async () => {
    try {
      const res = await fetch(location.pathname + '?nc=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      const html = await res.text();
      const m = html.match(/app\.js\?v=([0-9A-Za-z.\-]+)/);
      if (!m || m[1] === APP_VERSIONE) return;
      const stepId = document.getElementById('kiosk-step-id');
      if (stepId && stepId.style.display !== 'none') location.reload();
    } catch (e) { /* offline o rete lenta: si riprova al giro dopo */ }
  }, 5 * 60 * 1000);
}

// NOTA: gli handler 'visibilitychange' e 'online' sono ora gestiti centralmente
// dentro installaProtezioneSalvataggi() — vedi sezione RESILIENZA CONNESSIONE.
// Avere un solo handler evita race condition tra ricreazione client e refresh.

async function loadAllData() {
  const [profili, mezzi, utenti, prenotazioni, consegne, prenOp, aziende, articoli, tipiLav, chiusure, operazioni, sessioni, tipiAssenza, attivitaExtra, assenze, opAddetti, impostazioni, consegneCommessa, opFornitori, opFasi, spedizioni] = await Promise.all([
    sb.from('profili').select('*').order('nome'),
    sb.from('mezzi').select('*').order('nome'),
    sb.from('utenti').select('*').order('nome'),
    sb.from('prenotazioni').select('*').order('data_inizio'),
    sb.from('consegne').select('*').order('ordine'),
    sb.from('prenotazioni_utenti').select('*'),
    // Tabelle che CRESCONO senza limite: caricate paginate (fetchTutte),
    // altrimenti oltre le 1000 righe le più vecchie spariscono in silenzio
    // (successo con sessioni_lavoro il 7 lug 2026: 1003 righe, 3 perse).
    // L'ordine primario resta quello di visualizzazione; 'id' fa da spareggio
    // per rendere la paginazione stabile (niente righe perse/duplicate ai
    // confini di pagina quando i valori si ripetono).
    fetchTutte(() => sb.from('aziende').select('*').order('nome').order('id')),
    fetchTutte(() => sb.from('articoli').select('*').order('codice').order('id')),
    sb.from('tipi_lavorazione').select('*').order('ordine'),
    sb.from('chiusure_aziendali').select('*').order('data'),
    fetchTutte(() => sb.from('operazioni').select('*').order('scadenza').order('id')),
    fetchTutte(() => sb.from('sessioni_lavoro').select('*').order('inizio', { ascending:false }).order('id')),
    sb.from('tipi_assenza').select('*').order('ordine'),
    sb.from('attivita_extra').select('*').order('ordine'),
    fetchTutte(() => sb.from('assenze').select('*').order('data', { ascending:false }).order('id')),
    fetchTutte(() => sb.from('operazioni_addetti').select('*').order('operazione_id').order('utente_id').order('fase_id')),
    sb.from('impostazioni').select('*'),
    fetchTutte(() => sb.from('consegne_commessa').select('*').order('data', { ascending:false }).order('id')),
    fetchTutte(() => sb.from('operazioni_fornitori').select('*').order('operazione_id').order('azienda_id').order('fase_id')),
    fetchTutte(() => sb.from('operazioni_fasi').select('*').order('id')),
    fetchTutte(() => sb.from('spedizioni').select('*').order('data', { ascending:false }).order('id')),
  ]);
  if (profili.error) throw profili.error;
  if (mezzi.error) throw mezzi.error;
  if (utenti.error) throw utenti.error;
  if (prenotazioni.error) throw prenotazioni.error;
  if (consegne.error) throw consegne.error;
  if (prenOp.error) throw prenOp.error;
  if (aziende.error) throw aziende.error;
  if (articoli.error) throw articoli.error;
  if (tipiLav.error) throw tipiLav.error;
  if (chiusure.error) throw chiusure.error;
  if (operazioni.error) throw operazioni.error;
  if (sessioni.error) throw sessioni.error;
  if (tipiAssenza.error) throw tipiAssenza.error;
  if (attivitaExtra.error) throw attivitaExtra.error;
  if (assenze.error) throw assenze.error;
  if (opAddetti.error) throw opAddetti.error;
  if (impostazioni.error) throw impostazioni.error;
  if (consegneCommessa.error) throw consegneCommessa.error;
  if (opFornitori.error) throw opFornitori.error;
  if (opFasi.error) throw opFasi.error;
  if (spedizioni.error) throw spedizioni.error;

  state.profiliById = Object.fromEntries((profili.data||[]).map(p=>[p.id,p]));
  state.mezzi = mezzi.data || [];
  state.utenti = utenti.data || [];
  state.utentiById = Object.fromEntries(state.utenti.map(u=>[u.id,u]));
  state.prenotazioni = prenotazioni.data || [];
  state.consegne = consegne.data || [];
  state.prenOp = prenOp.data || [];
  state.aziende = aziende.data || [];
  state.articoli = articoli.data || [];
  state.tipiLav = tipiLav.data || [];
  state.chiusure = chiusure.data || [];
  state.operazioni = operazioni.data || [];
  state.sessioni = sessioni.data || [];
  state.tipiAssenza = tipiAssenza.data || [];
  state.attivitaExtra = attivitaExtra.data || [];
  state.assenze = assenze.data || [];
  state.opAddetti = opAddetti.data || [];
  state.opFornitori = opFornitori.data || [];
  state.opFasi = opFasi.data || [];
  // Impostazioni: oggetto chiave→valore, comodo da consultare
  state.impostazioni = Object.fromEntries((impostazioni.data||[]).map(r=>[r.chiave, r.valore]));
  state.consegneCommessa = consegneCommessa.data || [];
  state.spedizioni = spedizioni.data || [];
  // Fuori dal Promise.all: le tabelle possono non esistere ancora (migrazione)
  // e un loro errore non deve far cadere tutto il caricamento.
  await caricaOreEsterne();
  await caricaMancanti();
}

// Realtime: ascolto le modifiche su tutte le tabelle e tengo gli array sincronizzati
function startRealtime() {
  if (realtimeChannel) return; // già attivo
  if (!_rtLivenessTimer) _rtLivenessTimer = setInterval(_rtLivenessCheck, 45000);
  realtimeChannel = sb.channel('app-changes')
    .on('postgres_changes', { event:'*', schema:'public', table:'prenotazioni' },
        (p) => applyChange('prenotazioni', p))
    .on('postgres_changes', { event:'*', schema:'public', table:'mezzi' },
        (p) => applyChange('mezzi', p))
    .on('postgres_changes', { event:'*', schema:'public', table:'utenti' },
        (p) => applyChange('utenti', p))
    .on('postgres_changes', { event:'*', schema:'public', table:'profili' },
        (p) => applyChange('profili', p))
    .on('postgres_changes', { event:'*', schema:'public', table:'consegne' },
        (p) => applyChange('consegne', p))
    .on('postgres_changes', { event:'*', schema:'public', table:'prenotazioni_utenti' },
        (p) => applyChange('prenotazioni_utenti', p))
    .on('postgres_changes', { event:'*', schema:'public', table:'aziende' },
        (p) => applyChange('aziende', p))
    .on('postgres_changes', { event:'*', schema:'public', table:'articoli' },
        (p) => applyChange('articoli', p))
    .on('postgres_changes', { event:'*', schema:'public', table:'tipi_lavorazione' },
        (p) => applyChange('tipi_lavorazione', p))
    .on('postgres_changes', { event:'*', schema:'public', table:'chiusure_aziendali' },
        (p) => applyChange('chiusure_aziendali', p))
    .on('postgres_changes', { event:'*', schema:'public', table:'operazioni' },
        (p) => applyChange('operazioni', p))
    .on('postgres_changes', { event:'*', schema:'public', table:'sessioni_lavoro' },
        (p) => applyChange('sessioni_lavoro', p))
    .on('postgres_changes', { event:'*', schema:'public', table:'tipi_assenza' },
        (p) => applyChange('tipi_assenza', p))
    .on('postgres_changes', { event:'*', schema:'public', table:'attivita_extra' },
        (p) => applyChange('attivita_extra', p))
    .on('postgres_changes', { event:'*', schema:'public', table:'assenze' },
        (p) => applyChange('assenze', p))
    .on('postgres_changes', { event:'*', schema:'public', table:'operazioni_addetti' },
        (p) => applyChange('operazioni_addetti', p))
    .on('postgres_changes', { event:'*', schema:'public', table:'operazioni_fornitori' },
        (p) => applyChange('operazioni_fornitori', p))
    .on('postgres_changes', { event:'*', schema:'public', table:'operazioni_fasi' },
        (p) => applyChange('operazioni_fasi', p))
    .on('postgres_changes', { event:'*', schema:'public', table:'consegne_commessa' },
        (p) => applyChange('consegne_commessa', p))
    .on('postgres_changes', { event:'*', schema:'public', table:'spedizioni' },
        (p) => applyChange('spedizioni', p))
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (_rtNeedCatchup) {
          _rtNeedCatchup = false;
          // Il realtime non riproduce gli eventi persi durante un buco:
          // ricarico una volta per riallineare la vista alla realtà.
          if (state.loaded && !IS_KIOSK && typeof loadAllData === 'function') {
            loadAllData()
              .then(() => {
                // Ripristina la scheda ESATTA: macro-area + sotto-tab. Con il
                // solo renderTab il contenuto si ridisegna ma la barra di
                // navigazione resta disallineata. Prima questo lo faceva
                // `visibilitychange`; ora la ricarica avviene solo qui.
                if (typeof switchToTab === 'function' && state.currentArea && state.currentTab) {
                  switchToTab(state.currentArea, state.currentTab);
                } else if (state.currentTab && typeof renderTab === 'function') {
                  renderTab(state.currentTab);
                }
              })
              .catch(() => {});
          }
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        _rtNeedCatchup = true;
        try { if (realtimeChannel) sb.removeChannel(realtimeChannel); } catch (e) {}
        realtimeChannel = null;
        clearTimeout(_rtReconnectTimer);
        _rtReconnectTimer = setTimeout(() => { if (!realtimeChannel && sb) startRealtime(); }, 3000);
      }
    });
}

function applyChange(tabella, payload) {
  const ev = payload.eventType;
  const row = payload.new;
  const oldRow = payload.old;

  if (tabella === 'prenotazioni') {
    if (ev === 'INSERT') {
      if (!state.prenotazioni.find(x => x.id === row.id)) state.prenotazioni.push(row);
    } else if (ev === 'UPDATE') state.prenotazioni = state.prenotazioni.map(x => x.id === row.id ? row : x);
    else if (ev === 'DELETE') state.prenotazioni = state.prenotazioni.filter(x => x.id !== oldRow.id);
  } else if (tabella === 'mezzi') {
    if (ev === 'INSERT') {
      if (!state.mezzi.find(x => x.id === row.id)) state.mezzi.push(row);
    } else if (ev === 'UPDATE') state.mezzi = state.mezzi.map(x => x.id === row.id ? row : x);
    else if (ev === 'DELETE') state.mezzi = state.mezzi.filter(x => x.id !== oldRow.id);
  } else if (tabella === 'utenti') {
    if (ev === 'INSERT') {
      if (!state.utenti.find(x => x.id === row.id)) state.utenti.push(row);
      state.utentiById[row.id] = row;
    } else if (ev === 'UPDATE') {
      state.utenti = state.utenti.map(x => x.id === row.id ? row : x);
      state.utentiById[row.id] = row;
    } else if (ev === 'DELETE') {
      state.utenti = state.utenti.filter(x => x.id !== oldRow.id);
      delete state.utentiById[oldRow.id];
    }
  } else if (tabella === 'profili') {
    if (ev === 'INSERT' || ev === 'UPDATE') state.profiliById[row.id] = row;
    else if (ev === 'DELETE') delete state.profiliById[oldRow.id];
  } else if (tabella === 'consegne') {
    if (ev === 'INSERT') {
      if (!state.consegne.find(x => x.id === row.id)) state.consegne.push(row);
    } else if (ev === 'UPDATE') state.consegne = state.consegne.map(x => x.id === row.id ? row : x);
    else if (ev === 'DELETE') state.consegne = state.consegne.filter(x => x.id !== oldRow.id);
  } else if (tabella === 'prenotazioni_utenti') {
    if (ev === 'INSERT') {
      const dup = state.prenOp.find(x =>
        x.prenotazione_id === row.prenotazione_id && x.utente_id === row.utente_id);
      if (!dup) state.prenOp.push(row);
    } else if (ev === 'DELETE') state.prenOp = state.prenOp.filter(x =>
      !(x.prenotazione_id === oldRow.prenotazione_id && x.utente_id === oldRow.utente_id));
  } else if (tabella === 'aziende') {
    if (ev === 'INSERT') {
      if (!state.aziende.find(x => x.id === row.id)) state.aziende.push(row);
    } else if (ev === 'UPDATE') {
      state.aziende = state.aziende.map(x => x.id === row.id ? row : x);
    } else if (ev === 'DELETE') {
      state.aziende = state.aziende.filter(x => x.id !== oldRow.id);
    }
  } else if (tabella === 'articoli') {
    if (ev === 'INSERT') {
      if (!state.articoli.find(x => x.id === row.id)) state.articoli.push(row);
    } else if (ev === 'UPDATE') {
      state.articoli = state.articoli.map(x => x.id === row.id ? row : x);
    } else if (ev === 'DELETE') {
      state.articoli = state.articoli.filter(x => x.id !== oldRow.id);
    }
  } else if (tabella === 'tipi_lavorazione') {
    if (ev === 'INSERT') {
      if (!state.tipiLav.find(x => x.id === row.id)) state.tipiLav.push(row);
    } else if (ev === 'UPDATE') {
      state.tipiLav = state.tipiLav.map(x => x.id === row.id ? row : x);
    } else if (ev === 'DELETE') {
      state.tipiLav = state.tipiLav.filter(x => x.id !== oldRow.id);
    }
  } else if (tabella === 'chiusure_aziendali') {
    if (ev === 'INSERT') {
      if (!state.chiusure.find(x => x.id === row.id)) state.chiusure.push(row);
    } else if (ev === 'UPDATE') {
      state.chiusure = state.chiusure.map(x => x.id === row.id ? row : x);
    } else if (ev === 'DELETE') {
      state.chiusure = state.chiusure.filter(x => x.id !== oldRow.id);
    }
  } else if (tabella === 'operazioni') {
    if (ev === 'INSERT') {
      if (!state.operazioni.find(x => x.id === row.id)) state.operazioni.push(row);
    } else if (ev === 'UPDATE') {
      state.operazioni = state.operazioni.map(x => x.id === row.id ? row : x);
    } else if (ev === 'DELETE') {
      state.operazioni = state.operazioni.filter(x => x.id !== oldRow.id);
    }
  } else if (tabella === 'sessioni_lavoro') {
    if (ev === 'INSERT') {
      if (!state.sessioni.find(x => x.id === row.id)) state.sessioni.unshift(row);
    } else if (ev === 'UPDATE') {
      state.sessioni = state.sessioni.map(x => x.id === row.id ? row : x);
    } else if (ev === 'DELETE') {
      state.sessioni = state.sessioni.filter(x => x.id !== oldRow.id);
    }
  } else if (tabella === 'tipi_assenza') {
    if (ev === 'INSERT') {
      if (!state.tipiAssenza.find(x => x.id === row.id)) state.tipiAssenza.push(row);
    } else if (ev === 'UPDATE') {
      state.tipiAssenza = state.tipiAssenza.map(x => x.id === row.id ? row : x);
    } else if (ev === 'DELETE') {
      state.tipiAssenza = state.tipiAssenza.filter(x => x.id !== oldRow.id);
    }
  } else if (tabella === 'attivita_extra') {
    if (ev === 'INSERT') {
      if (!state.attivitaExtra.find(x => x.id === row.id)) state.attivitaExtra.push(row);
    } else if (ev === 'UPDATE') {
      state.attivitaExtra = state.attivitaExtra.map(x => x.id === row.id ? row : x);
    } else if (ev === 'DELETE') {
      state.attivitaExtra = state.attivitaExtra.filter(x => x.id !== oldRow.id);
    }
  } else if (tabella === 'assenze') {
    if (ev === 'INSERT') {
      if (!state.assenze.find(x => x.id === row.id)) state.assenze.unshift(row);
    } else if (ev === 'UPDATE') {
      state.assenze = state.assenze.map(x => x.id === row.id ? row : x);
    } else if (ev === 'DELETE') {
      state.assenze = state.assenze.filter(x => x.id !== oldRow.id);
    }
  } else if (tabella === 'operazioni_addetti') {
    // PK surrogata `id` (più righe per utente+commessa: una per fase).
    // Ripiego sulla tripla per righe pre-migrazione senza id in cache.
    const matchKey = (a, b) =>
      (a.id && b.id) ? a.id === b.id
      : a.operazione_id === b.operazione_id && a.utente_id === b.utente_id
        && (a.fase_id || null) === (b.fase_id || null);
    if (ev === 'INSERT') {
      if (!state.opAddetti.find(x => matchKey(x, row))) state.opAddetti.push(row);
    } else if (ev === 'UPDATE') {
      // Avvengono UPDATE legittimi: cambio fase_id (sync commessa) e
      // completata_il (dichiarazione "fase finita" al kiosk).
      state.opAddetti = state.opAddetti.map(x => matchKey(x, row) ? row : x);
    } else if (ev === 'DELETE') {
      state.opAddetti = state.opAddetti.filter(x => !matchKey(x, oldRow));
    }
  } else if (tabella === 'consegne_commessa') {
    if (ev === 'INSERT') {
      if (!state.consegneCommessa.find(x => x.id === row.id)) state.consegneCommessa.push(row);
    } else if (ev === 'UPDATE') {
      state.consegneCommessa = state.consegneCommessa.map(x => x.id === row.id ? row : x);
    } else if (ev === 'DELETE') {
      state.consegneCommessa = state.consegneCommessa.filter(x => x.id !== oldRow.id);
    }
  } else if (tabella === 'operazioni_fornitori') {
    // PK propria 'id' + UNIQUE (operazione_id, azienda_id)
    if (ev === 'INSERT') {
      if (!state.opFornitori.find(x => x.id === row.id)) state.opFornitori.push(row);
    } else if (ev === 'UPDATE') {
      state.opFornitori = state.opFornitori.map(x => x.id === row.id ? row : x);
    } else if (ev === 'DELETE') {
      state.opFornitori = state.opFornitori.filter(x => x.id !== oldRow.id);
    }
  } else if (tabella === 'operazioni_fasi') {
    // PK propria 'id'
    if (ev === 'INSERT') {
      if (!state.opFasi.find(x => x.id === row.id)) state.opFasi.push(row);
    } else if (ev === 'UPDATE') {
      state.opFasi = state.opFasi.map(x => x.id === row.id ? row : x);
    } else if (ev === 'DELETE') {
      state.opFasi = state.opFasi.filter(x => x.id !== oldRow.id);
    }
  } else if (tabella === 'spedizioni') {
    if (ev === 'INSERT') {
      if (!state.spedizioni.find(x => x.id === row.id)) state.spedizioni.push(row);
    } else if (ev === 'UPDATE') {
      state.spedizioni = state.spedizioni.map(x => x.id === row.id ? row : x);
    } else if (ev === 'DELETE') {
      state.spedizioni = state.spedizioni.filter(x => x.id !== oldRow.id);
    }
  }

  // Re-render solo la tab attiva
  if (state.loaded) renderTab(state.currentTab);
}

function loadPrenotazioneOperatori(prenId) {
  // Legge dalla cache in memoria (sync)
  return state.prenOp.filter(r => r.prenotazione_id === prenId).map(r => r.utente_id);
}

// Restituisce gli id degli addetti previsti di un'operazione (dalla cache, sync)
function getOperazioneAddetti(opId) {
  // Un utente può avere PIÙ righe (una per fase): qui serve l'elenco delle
  // PERSONE, una volta sola. Le fasi vengono raccolte separatamente in
  // addettoFase. (Deduplica anche eventuali doppioni dati legacy.)
  return [...new Set(state.opAddetti.filter(r => r.operazione_id === opId).map(r => r.utente_id))];
}

// ============================================================
// FORNITORI ESTERNI — helper di lettura (cache sync)
// ============================================================
// Le righe di operazioni_fornitori legano un'operazione a un'azienda con
// is_fornitore=true (vincolato dal trigger SQL). Una commessa può avere
// 0..N fornitori, indipendenti dagli addetti interni.

// Restituisce gli id delle aziende fornitrici allocate a una commessa
function getOperazioneFornitori(opId) {
  return (state.opFornitori || [])
    .filter(r => r.operazione_id === opId)
    .map(r => r.azienda_id);
}

// Restituisce le righe complete (per accedere a allocazione, id, ecc.)
function getOperazioneFornitoriDettaglio(opId) {
  return (state.opFornitori || []).filter(r => r.operazione_id === opId);
}

// ============================================================
// CONSEGNE PARZIALI — helper di lettura (cache sync)
// ============================================================
// Le righe in `consegne_commessa` rappresentano LOTTI PRODOTTI messi in
// magazzino (non "consegne al cliente" — il nome della tabella è storico).
// Una commessa può essere prodotta in più tranche; la somma delle quantità
// prodotte va confrontata con `operazioni.quantita` per sapere quanto resta
// da produrre. Tutte le funzioni qui sono pure e leggono solo dalla cache.
// La consegna finale al cliente è invece tracciata via `consegnato_il`
// e dallo stato `spedita` direttamente su `operazioni`.

function consegneDiOperazione(opId) {
  return (state.consegneCommessa || [])
    .filter(c => c.operazione_id === opId)
    .sort((a, b) => (a.data || '').localeCompare(b.data || ''));
}

function quantitaConsegnata(opId) {
  return consegneDiOperazione(opId)
    .reduce((sum, c) => sum + Number(c.quantita || 0), 0);
}


// Campi che una commessa DEVE avere compilati per essere pianificabile.
// Ritorna l'elenco (leggibile) dei campi mancanti; vuoto = tutto a posto.
// - Minuti: tempo di lavorazione assente (somma fasi se presenti, altrimenti
//   il minuti_unitari pagato); senza non si calcola la durata
// - Scadenza: vuota
// - Senza fasi → serve almeno un addetto o un fornitore sulla commessa
// - Con fasi → per OGNI fase serve almeno un assegnatario
//   (per-fase o, in ripiego, "a tutta la commessa")
// NOTA (7 lug 2026): tolta la voce "fase con minuti a zero" — con le fasi
// effettive il valore arriva da solo (media/template) e, dove ancora manca,
// la pianificazione ricade sul budget pagato: non è più un gesto in sospeso.
function opCampiMancanti(op) {
  if (!op) return [];
  const mancanti = [];
  const fasi = opFasiOf(op);

  if (!(opMinutiEffettivi(op) > 0)) mancanti.push('Minuti unitari');
  if (!op.scadenza) mancanti.push('Scadenza');

  if (fasi.length > 0) {
    fasi.forEach(f => {
      const tipo = (state.tipiLav || []).find(t => t.id === f.tipo_lavorazione_id);
      const nome = tipo?.nome || 'fase';
      const ass = faseAssegnatari(op, f.id);
      if (ass.addetti.length === 0 && ass.fornitori.length === 0) {
        mancanti.push('Fase «' + nome + '»: nessun addetto/fornitore');
      }
    });
  } else {
    const nAddetti = (typeof getOperazioneAddetti === 'function') ? getOperazioneAddetti(op.id).length : 0;
    const nFornitori = (typeof getOperazioneFornitori === 'function') ? getOperazioneFornitori(op.id).length : 0;
    if (nAddetti === 0 && nFornitori === 0) mancanti.push('Addetto o fornitore');
  }
  return mancanti;
}

// ============================================================
// SPEDIZIONI — uscite dal magazzino verso il cliente
// Riga in `spedizioni`: evento di spedizione di N pezzi di una commessa,
// con DDT, destinatario, data, note. Una commessa può avere N spedizioni.
// Stato 'spedita' su operazioni viene sincronizzato automaticamente quando
// la somma di quantitaSpedita raggiunge o supera operazioni.quantita.
// ============================================================

function spedizioniDiOperazione(opId) {
  return (state.spedizioni || [])
    .filter(s => s.operazione_id === opId)
    .sort((a, b) => (a.data || '').localeCompare(b.data || ''));
}

function quantitaSpedita(opId) {
  return spedizioniDiOperazione(opId)
    .reduce((sum, s) => sum + Number(s.quantita || 0), 0);
}

// Pezzi attualmente in magazzino per una commessa: prodotti - spediti.
// Mai negativa.
function pezziInMagazzino(opId) {
  return Math.max(0, quantitaConsegnata(opId) - quantitaSpedita(opId));
}

// Propaga gli addetti a TUTTE le commesse del gruppo. Un gruppo al kiosk è
// UNA card sola: chi ci lavora è per forza lo stesso su tutte, e assegnarlo
// una per una era lavoro a mano che il gestionale può fare da sé.
// Due accortezze, imparate dai dati veri:
//  - le commesse di uno stesso gruppo possono avere FASI DIVERSE (un gruppo da
//    11 ne aveva alcune senza fasi): un'assegnazione per fase si trasferisce
//    cercando la fase dello STESSO TIPO nell'altra commessa, e se non c'è si
//    salta invece di inventarla;
//  - si propaga l'insieme COMPLETO, quindi anche i tolti spariscono: la
//    squadra del gruppo resta una sola, altrimenti dopo due modifiche le
//    commesse divergono e nessuno sa più chi ci lavora.
// Ritorna { toccate, saltate } per poterlo dichiarare a chi salva.
async function propagaAddettiGruppo(op, nuovi) {
  const esito = { toccate: 0, saltate: 0 };
  if (!op || !op.gruppo_id) return esito;
  const fratelli = (state.operazioni || [])
    .filter(x => x.gruppo_id === op.gruppo_id && x.id !== op.id
      && x.stato !== 'spedita' && x.stato !== 'completata');
  if (!fratelli.length) return esito;
  const tipoDiFase = (faseId) => {
    const f = (state.opFasi || []).find(x => x.id === faseId);
    return f ? f.tipo_lavorazione_id : null;
  };
  for (const fr of fratelli) {
    const suoi = [];
    let saltate = 0;
    nuovi.forEach(n => {
      if (!n.fase_id) { suoi.push({ utente_id: n.utente_id, fase_id: null }); return; }
      const tipo = tipoDiFase(n.fase_id);
      const faseGemella = (state.opFasi || [])
        .find(x => x.operazione_id === fr.id && x.tipo_lavorazione_id === tipo);
      if (faseGemella) suoi.push({ utente_id: n.utente_id, fase_id: faseGemella.id });
      else saltate++;
    });
    // Doppioni via: la stessa persona sulla stessa fase una volta sola.
    const visti = new Set();
    const puliti = suoi.filter(s => {
      const k = s.utente_id + '|' + (s.fase_id || '');
      if (visti.has(k)) return false;
      visti.add(k); return true;
    });
    const res = await syncOperazioneAddetti(fr.id, puliti);
    if (res.error) return { ...esito, error: res.error };
    esito.toccate++;
    esito.saltate += saltate;
  }
  return esito;
}

// Sincronizza gli addetti previsti di un'operazione: diff tra vecchi e nuovi
// Ritorna { error } o {} se ok.
async function syncOperazioneAddetti(opId, nuovi) {
  // `nuovi` = [{ utente_id, fase_id }]. fase_id null = assegnato alla commessa.
  // Un utente può comparire più volte con fasi DIVERSE (es. cablaggio +
  // collaudo). Il diff è quindi per coppia (utente_id, fase_id): le coppie
  // invariate restano intatte (preservando completata_il), le nuove vengono
  // inserite, quelle sparite eliminate.
  const chiave = (r) => r.utente_id + '|' + (r.fase_id || '');
  const vecchieRighe = (state.opAddetti || []).filter(r => r.operazione_id === opId);
  const vecchieByKey = Object.fromEntries(vecchieRighe.map(r => [chiave(r), r]));
  const nuoveKeys = new Set(nuovi.map(chiave));

  // INSERT: coppie nuove
  const daAggiungere = nuovi.filter(n => !vecchieByKey[chiave(n)]);
  if (daAggiungere.length) {
    const rows = daAggiungere.map(n => ({ operazione_id: opId, utente_id: n.utente_id, fase_id: n.fase_id || null }));
    const { data, error } = await sb.from('operazioni_addetti').insert(rows).select();
    if (error) return { error };
    const inseriti = (data && data.length) ? data : rows;
    inseriti.forEach(r => {
      if (!state.opAddetti.find(x => x.operazione_id === r.operazione_id
          && x.utente_id === r.utente_id && (x.fase_id || null) === (r.fase_id || null))) {
        state.opAddetti.push(r);
      }
    });
  }
  // DELETE: coppie rimosse
  const daRimuovere = vecchieRighe.filter(r => !nuoveKeys.has(chiave(r)));
  for (const r of daRimuovere) {
    let q = sb.from('operazioni_addetti').delete()
      .eq('operazione_id', opId).eq('utente_id', r.utente_id);
    q = r.fase_id ? q.eq('fase_id', r.fase_id) : q.is('fase_id', null);
    const { error } = await q;
    if (error) return { error };
    state.opAddetti = state.opAddetti.filter(x => !(x.operazione_id === opId
      && x.utente_id === r.utente_id && (x.fase_id || null) === (r.fase_id || null)));
  }
  return {};
}

// Sincronizza i fornitori esterni di un'operazione (stesso pattern degli addetti).
// `nuovi` è array di oggetti { azienda_id, numero_ordine }.
// Gestisce insert, update (quando numero_ordine cambia), e delete.
async function syncOperazioneFornitori(opId, nuovi) {
  // Un fornitore può comparire su PIÙ fasi (es. meccanica + cablaggio): il diff
  // è per coppia (azienda_id, fase_id) — stesso pattern degli addetti. Le coppie
  // invariate restano, le nuove inserite, le sparite eliminate; numero_ordine si
  // aggiorna se cambia.
  const chiave = (r) => r.azienda_id + '|' + (r.fase_id || '');
  const vecchieRighe = (state.opFornitori || []).filter(r => r.operazione_id === opId);
  const vecchieByKey = Object.fromEntries(vecchieRighe.map(r => [chiave(r), r]));
  const nuoveKeys = new Set(nuovi.map(chiave));

  // INSERT: coppie nuove
  const daAggiungere = nuovi.filter(n => !vecchieByKey[chiave(n)]);
  if (daAggiungere.length) {
    const rows = daAggiungere.map(n => ({
      operazione_id: opId,
      azienda_id: n.azienda_id,
      allocazione: 1.0,
      numero_ordine: n.numero_ordine || null,
      fase_id: n.fase_id || null,
    }));
    const { data, error } = await sb.from('operazioni_fornitori').insert(rows).select();
    if (error) return { error };
    (data || []).forEach(r => {
      if (!state.opFornitori.find(x => x.id === r.id)) state.opFornitori.push(r);
    });
  }

  // UPDATE: coppia invariata ma numero_ordine cambiato
  for (const n of nuovi) {
    const vecchia = vecchieByKey[chiave(n)];
    if (!vecchia) continue; // già gestito da insert
    const nuovoNum = n.numero_ordine || null;
    if ((vecchia.numero_ordine || null) === nuovoNum) continue;
    const { data, error } = await sb.from('operazioni_fornitori')
      .update({ numero_ordine: nuovoNum })
      .eq('id', vecchia.id).select().single();
    if (error) return { error };
    state.opFornitori = state.opFornitori.map(x => x.id === vecchia.id ? data : x);
  }

  // DELETE: coppie rimosse
  const daRimuovere = vecchieRighe.filter(r => !nuoveKeys.has(chiave(r)));
  for (const r of daRimuovere) {
    const { error } = await sb.from('operazioni_fornitori').delete().eq('id', r.id);
    if (error) return { error };
    state.opFornitori = state.opFornitori.filter(x => x.id !== r.id);
  }

  return {};
}

// Sincronizza le fasi di un'operazione (operazioni_fasi). Diff per id locale:
// gli item esistenti hanno `id` → update se cambiati; i nuovi (senza id) → insert;
// gli id non più presenti → delete. Preservare gli id è importante perché in
// futuro gli addetti/fornitori vi si agganciano via fase_id.
// `nuove` = [{_k, id?, tipo_lavorazione_id, minuti_unitari, ordine}]
// Ritorna { keyToId } con la mappa chiave-locale → id DB di tutte le fasi.
async function syncOperazioneFasi(opId, nuove) {
  const vecchieRighe = (state.opFasi || []).filter(r => r.operazione_id === opId);
  const nuoviIds = new Set(nuove.filter(n => n.id).map(n => n.id));
  const keyToId = {};
  nuove.forEach(n => { if (n.id) keyToId[n._k] = n.id; });

  // DELETE: fasi rimosse (cascata pulisce eventuali fase_id collegati)
  const daRimuovere = vecchieRighe.filter(r => !nuoviIds.has(r.id));
  for (const r of daRimuovere) {
    const { error } = await sb.from('operazioni_fasi').delete().eq('id', r.id);
    if (error) return { error };
    state.opFasi = state.opFasi.filter(x => x.id !== r.id);
  }

  // UPDATE: fasi esistenti con valori cambiati
  for (const n of nuove) {
    if (!n.id) continue;
    const vecchia = vecchieRighe.find(r => r.id === n.id);
    if (!vecchia) continue;
    const cambiata = (vecchia.tipo_lavorazione_id || null) !== (n.tipo_lavorazione_id || null)
      || Number(vecchia.minuti_unitari || 0) !== Number(n.minuti_unitari || 0)
      || Number(vecchia.ordine || 0) !== Number(n.ordine || 0);
    if (!cambiata) continue;
    const { data, error } = await sb.from('operazioni_fasi')
      .update({ tipo_lavorazione_id: n.tipo_lavorazione_id, minuti_unitari: n.minuti_unitari, ordine: n.ordine })
      .eq('id', n.id).select().single();
    if (error) return { error };
    state.opFasi = state.opFasi.map(x => x.id === n.id ? data : x);
  }

  // INSERT: fasi nuove (senza id). Correlo i record creati al loro _k locale.
  const daAggiungere = nuove.filter(n => !n.id);
  if (daAggiungere.length) {
    const rows = daAggiungere.map(n => ({
      operazione_id: opId,
      tipo_lavorazione_id: n.tipo_lavorazione_id,
      minuti_unitari: n.minuti_unitari,
      ordine: n.ordine,
    }));
    const { data, error } = await sb.from('operazioni_fasi').insert(rows).select();
    if (error) return { error };
    (data || []).forEach((r, i) => {
      if (!state.opFasi.find(x => x.id === r.id)) state.opFasi.push(r);
      const src = daAggiungere[i];
      if (src) keyToId[src._k] = r.id;
    });
  }

  return { keyToId };
}
// Una prenotazione può avere 0..N consegne (tappe). Ogni consegna ha un cliente_id (opz).
// → { breve: 'TEMA SINERGIE' | 'TEMA SINERGIE +2' | 'Multi-stop' | '—', tooltip: 'lista cli' }
function getPrenotazioneDestinazione(prenId) {
  const cons = state.consegne
    .filter(c => c.prenotazione_id === prenId)
    .sort((a,b) => (a.ordine||0) - (b.ordine||0));
  if (cons.length === 0) return { breve: '—', tooltip: 'Nessuna destinazione' };
  const nomi = cons.map(c => {
    if (c.cliente_id) {
      const cli = state.aziende.find(x => x.id === c.cliente_id);
      return cli ? cli.nome : '(cliente eliminato)';
    }
    return c.descrizione || '(senza destinazione)';
  });
  // Etichetta breve: primo nome + "+N" se ce ne sono altri
  let breve;
  if (cons.length === 1) breve = nomi[0];
  else breve = nomi[0] + ' +' + (cons.length - 1);
  // Tooltip: lista completa
  const tooltip = nomi.map((n, i) => (i+1) + '. ' + n).join('\n');
  return { breve, tooltip };
}

// Verifica sovrapposizioni dalla cache in memoria (no fetch).
// Considera gli ORARI: due prenotazioni dello stesso mezzo lo stesso giorno in
// fasce diverse (es. 08:00–12:00 e 14:00–18:00) NON sono in conflitto. Stessa
// regola del vincolo DB tsrange e di kioskConflittoOrarioMezzo: istanti
// effettivi, fallback 00:00–23:59 per prenotazioni senza orario, bound [) così
// che 08–12 e 12–18 (estremi che si toccano) non confliggano.
function checkSovrapposizioni(mezzoId, dataInizio, dataFine, escludiId, oraInizio, oraFine) {
  // Istanti della prenotazione in esame.
  const aInizio = new Date(dataInizio + 'T' + (oraInizio || '00:00'));
  const aFine = new Date(dataFine + 'T' + (oraFine || '23:59'));
  const usaOrari = !isNaN(aInizio.getTime()) && !isNaN(aFine.getTime());

  const res = state.prenotazioni.filter(p => {
    if (p.mezzo_id !== mezzoId) return false;
    if (escludiId && p.id === escludiId) return false;
    // Filtro grossolano per giorno: se i giorni non si toccano, niente conflitto.
    if (!(p.data_inizio <= dataFine && p.data_fine >= dataInizio)) return false;
    // Affinamento orario (se disponibili gli istanti di entrambe).
    if (usaOrari) {
      const bInizio = new Date(p.data_inizio + 'T' + (p.ora_inizio || '00:00'));
      const bFine = new Date(p.data_fine + 'T' + (p.ora_fine || '23:59'));
      if (!isNaN(bInizio.getTime()) && !isNaN(bFine.getTime())) {
        // Sovrapposizione su intervalli semiaperti [inizio, fine).
        return aInizio < bFine && bInizio < aFine;
      }
    }
    return true;
  });
  return res;
}

// Conflitto OPERATORE: lo stesso operatore non può stare su due mezzi (due
// prenotazioni diverse) che si sovrappongono nel tempo. Stessa semantica a
// intervalli semiaperti [inizio, fine) di checkSovrapposizioni: 08–12 e 12–18
// NON confliggono. Ritorna [{ pren, operatori:[id...] }] per ogni conflitto.
function checkSovrapposizioniOperatori(utentiIds, dataInizio, dataFine, escludiId, oraInizio, oraFine) {
  const ids = new Set(utentiIds || []);
  if (ids.size === 0) return [];
  const aInizio = new Date(dataInizio + 'T' + (oraInizio || '00:00'));
  const aFine = new Date(dataFine + 'T' + (oraFine || '23:59'));
  const usaOrari = !isNaN(aInizio.getTime()) && !isNaN(aFine.getTime());

  const res = [];
  state.prenotazioni.forEach(p => {
    if (escludiId && p.id === escludiId) return;
    // Operatori di QUESTA prenotazione che coincidono con quelli in esame.
    const comuni = (state.prenOp || [])
      .filter(r => r.prenotazione_id === p.id && ids.has(r.utente_id))
      .map(r => r.utente_id);
    if (comuni.length === 0) return;
    // Filtro grossolano per giorno.
    if (!(p.data_inizio <= dataFine && p.data_fine >= dataInizio)) return;
    // Affinamento orario (se disponibili gli istanti di entrambe).
    if (usaOrari) {
      const bInizio = new Date(p.data_inizio + 'T' + (p.ora_inizio || '00:00'));
      const bFine = new Date(p.data_fine + 'T' + (p.ora_fine || '23:59'));
      if (!isNaN(bInizio.getTime()) && !isNaN(bFine.getTime())) {
        if (!(aInizio < bFine && bInizio < aFine)) return;
      }
    }
    res.push({ pren: p, operatori: comuni });
  });
  return res;
}

// Conflitto ORARIO (usato dal kiosk al check-out mezzo).
// Calcola gli istanti effettivi di ogni prenotazione usando anche
// ora_inizio/ora_fine. Per le prenotazioni storiche SENZA orario, fallback
// "tutto il giorno" (00:00 → 23:59) come deciso.
// Ritorna { occupatoOra: bool, conflitto: Date | null }:
//   - occupatoOra=true → una prenotazione altrui è GIÀ in corso al momento
//                        della presa: il mezzo non è disponibile adesso.
//   - conflitto=Date   → l'istante in cui inizia la PRIMA prenotazione che cade
//                        nel periodo [presaTS, rientroTS]. È il "tetto massimo"
//                        fino a cui si può tenere il mezzo. null = periodo libero.
function kioskConflittoOrarioMezzo(mezzoId, presaTS, rientroTS, escludiId) {
  const presa = presaTS instanceof Date ? presaTS : new Date(presaTS);
  const rientro = rientroTS instanceof Date ? rientroTS : new Date(rientroTS);

  let primoInizioConflitto = null;
  let occupatoOra = false;

  (state.prenotazioni || []).forEach(p => {
    if (p.mezzo_id !== mezzoId) return;
    if (escludiId && p.id === escludiId) return;
    if (!p.data_inizio || !p.data_fine) return;

    // Calcola istanti effettivi della prenotazione esistente.
    // Senza orario → tutto il giorno (00:00 inizio, 23:59 fine).
    const oraIn = p.ora_inizio || '00:00';
    const oraFi = p.ora_fine || '23:59';
    const pInizio = new Date(p.data_inizio + 'T' + oraIn);
    const pFine = new Date(p.data_fine + 'T' + oraFi);
    if (isNaN(pInizio.getTime()) || isNaN(pFine.getTime())) return;

    // La prenotazione è già in corso al momento della presa?
    if (pInizio <= presa && pFine > presa) {
      occupatoOra = true;
      return;
    }
    // La prenotazione inizia dopo la presa ma prima del rientro richiesto?
    // → è un conflitto: limita fino al suo inizio.
    if (pInizio > presa && pInizio < rientro) {
      if (!primoInizioConflitto || pInizio < primoInizioConflitto) {
        primoInizioConflitto = pInizio;
      }
    }
  });

  if (occupatoOra) return { occupatoOra: true, conflitto: null };
  return { occupatoOra: false, conflitto: primoInizioConflitto };
}

// Definizione macro-aree e sotto-tab
const TAB_STRUCTURE = {
  calendari: {
    label: 'Calendari',
    adminOnly: false,
    tabs: [
      { id: 'generale',    label: 'Generale',    adminOnly: false },
      { id: 'cal_mezzi',   label: 'Mezzi',       adminOnly: false },
      { id: 'cal_assenze', label: 'Assenze',     adminOnly: false },
    ],
  },
  lavoro: {
    label: 'Lavoro',
    adminOnly: false,
    tabs: [
      { id: 'pianificazione', label: 'Ordini cliente', adminOnly: false },
      // Spostata qui da Gestione (5 ago, richiesta Nico): i mancanti si
      // guardano mentre si lavora, non mentre si configura il gestionale.
      { id: 'fabbisogno',     label: 'Mancanti',       adminOnly: false },
      { id: 'prelievi',       label: 'Prelievi',       adminOnly: false },
      { id: 'storico',        label: 'Storico',        adminOnly: false },
      // Ricerca sui timbri NON legati a commessa (6 ago). L'anagrafica delle
      // attività resta in Gestione: qui si guarda cosa è stato fatto.
      { id: 'timbri_extra',   label: 'Attività extra', adminOnly: false },
      { id: 'gantt_live',     label: 'Live',           adminOnly: false },
      { id: 'gantt_commesse', label: 'Gantt',          adminOnly: false },
    ],
  },
  gestione: {
    label: 'Gestione',
    adminOnly: true,
    tabs: [
      { id: 'articoli',       label: 'Articoli',          adminOnly: true },
      { id: 'codifica',       label: 'Codifica',          adminOnly: true },
      { id: 'aziende',        label: 'Aziende',           adminOnly: true },
      { id: 'analisi_clienti', label: 'Analisi clienti',  adminOnly: true },
      { id: 'tipi_lav',       label: 'Tipi lavorazione',  adminOnly: true },
      { id: 'mezzi',          label: 'Anagrafica mezzi',  adminOnly: true },
      { id: 'operatori',      label: 'Utenti',            adminOnly: true },
      { id: 'chiusure',       label: 'Chiusure aziendali', adminOnly: true },
      { id: 'tipi_assenza',   label: 'Tipi assenza',      adminOnly: true },
      { id: 'attivita_extra', label: 'Attività extra',    adminOnly: true },
    ],
  },
  impostazioni: {
    label: 'Impostazioni',
    adminOnly: true,
    tabs: [
      { id: 'imp_calendari',  label: 'Calendari',         adminOnly: true },
    ],
  },
};

function bindTabs() {
  // Click sulla macro-area: mostra le sotto-tab e attiva la prima accessibile
  $('#tabs-macro').querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      selectArea(b.dataset.area);
    };
  });
  // All'avvio, seleziono la macro-area "Calendari"
  selectArea('calendari');
}

function selectArea(areaId) {
  state.currentArea = areaId;
  // Aggiorna stato visivo macro-area
  $('#tabs-macro').querySelectorAll('button').forEach(b => {
    b.classList.toggle('active', b.dataset.area === areaId);
  });
  // Genera le sotto-tab
  const area = TAB_STRUCTURE[areaId];
  if (!area) return;
  const isAdmin = state.profile?.ruolo === 'admin';
  const sub = $('#tabs');
  sub.innerHTML = '';
  area.tabs.forEach(t => {
    if (t.adminOnly && !isAdmin) return;
    const btn = el('button', {
      class: 'navtab',
      'data-tab': t.id,
      onclick: () => selectTab(t.id),
    }, t.label);
    sub.appendChild(btn);
  });
  // Attiva la prima sotto-tab disponibile
  const firstBtn = sub.querySelector('button');
  if (firstBtn) selectTab(firstBtn.dataset.tab);
}

function selectTab(tabId) {
  // Cleanup eventuali timer di tab precedenti
  if (typeof ganttLiveTimer !== 'undefined' && ganttLiveTimer) {
    clearInterval(ganttLiveTimer); ganttLiveTimer = null;
  }
  $('#tabs').querySelectorAll('button').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabId);
  });
  renderTab(tabId);
}

// Salta a una tab di una specifica macro-area (es. dal calendario → Gestione/Assenze)
function switchToTab(areaId, tabId) {
  selectArea(areaId);
  // selectArea attiva la prima tab; ora forziamo quella richiesta
  const btn = $('#tabs').querySelector(`button[data-tab="${tabId}"]`);
  if (btn) selectTab(tabId);
}

// renderTab ora è SINCRONO: legge solo dalla cache in memoria
function renderTab(name) {
  // Compatibilità: la vecchia scheda unica 'gantt' è ora divisa in due
  if (name === 'gantt') name = 'gantt_commesse';
  // Compatibilità: la vecchia tab 'impostazioni' dentro Gestione è ora la
  // sub-tab 'imp_calendari' dentro la nuova macro-area Impostazioni.
  if (name === 'impostazioni') name = 'imp_calendari';
  state.currentTab = name;
  const root = $('#tab-content');
  if (!state.loaded) { root.innerHTML = '<div class="empty">Caricamento…</div>'; return; }
  try {
    if (name === 'generale')          renderGenerale(root);
    else if (name === 'cal_mezzi')    renderCalMezzi(root);
    else if (name === 'cal_assenze')  renderAssenze(root);
    else if (name === 'mezzi')        renderMezzi(root);
    else if (name === 'aziende')      renderAziende(root);
    else if (name === 'articoli')     renderArticoli(root);
    else if (name === 'tipi_lav')     renderTipiLavorazione(root);
    else if (name === 'operatori')    renderOperatori(root);
    else if (name === 'pianificazione') renderPianificazione(root);
    else if (name === 'prelievi') renderPrelievi(root);
    else if (name === 'storico') renderStorico(root);
    else if (name === 'gantt_live') renderGanttLiveTab(root);
    else if (name === 'gantt_commesse') renderGanttCommesseTab(root);
    else if (name === 'analisi_clienti') renderAnalisiClienti(root);
    else if (name === 'codifica') renderCodifica(root);
    else if (name === 'fabbisogno') renderFabbisogno(root);
    else if (name === 'chiusure') renderChiusure(root);
    else if (name === 'tipi_assenza') renderTipiAssenza(root);
    else if (name === 'attivita_extra') renderAttivitaExtra(root);
    else if (name === 'timbri_extra') renderTimbriExtra(root);
    else if (name === 'imp_calendari') renderImpostazioni(root);
  } catch (e) {
    console.error('Errore rendering tab '+name+':', e);
    root.innerHTML = '';
    root.append(el('div', { class:'empty', style:'color:var(--red);' },
      el('div', { style:'margin-bottom:10px;' }, '⚠ Errore: '+(e.message||'sconosciuto')),
      el('button', { class:'btnp', onclick:()=>renderTab(name) }, 'Riprova'),
    ));
  }
  // Ripristina il focus su un campo di ricerca se richiesto
  // (i campi che ri-renderizzano la tab a ogni carattere perderebbero il focus)
  if (state._focusSearch) {
    const campo = document.getElementById(state._focusSearch);
    state._focusSearch = null;
    if (campo) {
      campo.focus();
      // Riporta il cursore alla fine del testo
      const v = campo.value;
      try { campo.setSelectionRange(v.length, v.length); } catch (e) {}
    }
  }
}

// ═══════════════════════════════════════════════════════════
// CALENDARI → GENERALE — riusa renderCalendar in modalità panoramica
// ═══════════════════════════════════════════════════════════

function renderGenerale(root) {
  // Attiva la modalità "solo assenze" sul calendario condiviso
  state.calMode = 'generale';
  renderCalendar(root);
}

// ═══════════════════════════════════════════════════════════
// CALENDARI → MEZZI (calendario + tabella)
// ═══════════════════════════════════════════════════════════

// Vista unificata Mezzi: barre tipo Gantt in cima + tabella prenotazioni sotto
function renderCalMezzi(root) {
  root.innerHTML = '';
  state.calMode = 'mezzi';

  // Sezione 1: calendario a barre (mezzi × giorni)
  const calSection = el('div', {});
  renderCalMezziBarre(calSection);
  root.append(calSection);

  // Separatore visivo
  root.append(el('div', {
    style: 'height:1px;background:var(--brd);margin:24px 0 18px;'
  }));

  // Sezione 2: tabella prenotazioni
  const tblSection = el('div', {});
  renderElenco(tblSection);
  root.append(tblSection);
}

// ─── VISTA MEZZI A BARRE (Gantt) ───────────────────────────────
// Righe = mezzi, colonne = giorni del periodo (settimana/mese, stessa
// navigazione del vecchio calendario via state.calCursor/calZoom).
// Le prenotazioni sono barre posizionate per ISTANTE (giorno + frazione
// oraria), quindi in settimanale gli orari si vedono, in mensile degrada a
// livello-giorno. Le prenotazioni che si sovrappongono nel tempo sullo stesso
// mezzo finiscono su corsie separate dentro la riga e vengono bordate di rosso
// (sovrapposizioni che NON devono esistere). Click su una barra → apre la
// prenotazione. Riusa helper e CSS del Gantt commesse.
function renderCalMezziBarre(root) {
  if (!(state.calCursor instanceof Date)) state.calCursor = new Date();
  const zoom = state.calZoom === 'mese' ? 'mese' : 'settimana';
  const cursor = state.calCursor;
  const range = ganttCalcRange(cursor, zoom);
  const slots = range.slots;
  if (!slots || slots.length === 0) { root.append(el('div', { class:'empty' }, 'Intervallo non valido')); return; }
  const rangeStartIso = slots[0].dateISO;
  const rangeEndIso = slots[slots.length - 1].dateISO;
  const oggiISO = toLocalISO(new Date());

  // ── Toolbar (settimana/mese + navigazione + nuova prenotazione) ──
  root.append(el('div', { class:'gantt-toolbar' },
    el('div', { class:'switch-bar' },
      el('button', { class: zoom==='settimana'?'act':'', onclick:()=>{ state.calZoom='settimana'; renderTab('cal_mezzi'); } }, 'Settimana'),
      el('button', { class: zoom==='mese'?'act':'', onclick:()=>{ state.calZoom='mese'; renderTab('cal_mezzi'); } }, 'Mese'),
    ),
    el('div', { class:'gantt-nav' },
      el('button', { onclick:()=>{ state.calCursor = ganttShift(cursor, zoom, -1); renderTab('cal_mezzi'); }, title:'Indietro' }, '◀'),
      el('button', { onclick:()=>{ state.calCursor = new Date(); renderTab('cal_mezzi'); } }, 'Oggi'),
      el('button', { onclick:()=>{ state.calCursor = ganttShift(cursor, zoom, +1); renderTab('cal_mezzi'); }, title:'Avanti' }, '▶'),
      el('div', { class:'label' }, ganttRangeLabel(range, zoom)),
    ),
    el('button', { class:'btnp', style:'margin-left:auto;', onclick:()=>openPrenotazioneModal() }, '+ Nuova Prenotazione'),
  ));

  // Legenda tipi + indicatore conflitto
  const legend = el('div', { class:'legend' });
  TIPI.forEach(t => legend.append(el('span', { class:'lg' },
    el('span', { class:'swatch', style:`background:${t.color}` }), t.label)));
  legend.append(el('span', { class:'lg' },
    el('span', { class:'swatch', style:'background:transparent;border-color:var(--red);box-shadow:0 0 0 2px var(--red) inset;' }), '⚠ Sovrapposizione'));
  root.append(legend);

  // Mezzi attivi come righe
  const mezzi = state.mezzi.filter(m => m.attivo).sort((a,b)=>(a.nome||'').localeCompare(b.nome||''));
  if (mezzi.length === 0) { root.append(el('div', { class:'empty' }, 'Nessun mezzo attivo')); return; }

  // Mappa giorni non lavorativi (festivi + chiusure) per lo sfondo colonne
  const annoMin = parseISODate(rangeStartIso).getFullYear();
  const annoMax = parseISODate(rangeEndIso).getFullYear();
  const nonLavMap = {};
  if (typeof festiviNazionali === 'function') {
    for (let y=annoMin; y<=annoMax; y++) festiviNazionali(y).forEach(f => {
      const iso = f.data instanceof Date ? toLocalISO(f.data) : f.data;
      if (iso) nonLavMap[iso] = f.nome;
    });
  }
  (state.chiusure || []).forEach(c => {
    if (!c.data) return;
    if (c.ricorrente) { const md = c.data.substring(5); for (let y=annoMin;y<=annoMax;y++) nonLavMap[`${y}-${md}`] = c.descrizione || 'Chiusura aziendale'; }
    else nonLavMap[c.data] = c.descrizione || 'Chiusura aziendale';
  });

  // Geometria griglia
  const wrap = el('div', { class:'gantt-wrap' });
  const minSlot = zoom === 'settimana' ? 110 : 26;
  // Larghezza disponibile: misuro un contenitore GIÀ nel DOM (#tab-content),
  // perché 'root' qui è una sezione non ancora attaccata → clientWidth=0 e
  // scatterebbe un fallback più stretto della pagina. -170 = colonna nomi.
  const hostW = ($('#tab-content')?.clientWidth) || root.clientWidth || (window.innerWidth - 48) || 1100;
  const dispW = hostW - 170 - 4;
  const slotWidth = Math.max(minSlot, Math.floor(dispW / slots.length));
  const grid = el('div', { class:'gantt-grid',
    style:`grid-template-columns:170px repeat(${slots.length}, ${slotWidth}px);` });

  // Header
  grid.append(el('div', { class:'gantt-hd-corner' }, 'Mezzo'));
  slots.forEach(slot => {
    const cls = ['gantt-hd-time'];
    if (slot.weekend) cls.push('weekend');
    if (slot.dateISO === oggiISO || slot.isOggi) cls.push('oggi');
    const nomeNonLav = !slot.weekend && nonLavMap[slot.dateISO];
    if (nomeNonLav) cls.push('nonlav');
    const attrs = { class:cls.join(' ') };
    if (nomeNonLav) attrs.title = nomeNonLav;
    grid.append(el('div', attrs, slot.label));
  });

  // Posizionamento a istante: x in px dalla mezzanotte del primo slot
  const originMs = range.start.getTime();
  const dayMs = 86400000;
  const nDays = slots.length;
  const instantX = (dt) => {
    let days = (dt.getTime() - originMs) / dayMs;
    if (days < 0) days = 0; else if (days > nDays) days = nDays;
    return days * slotWidth;
  };
  const mkInstant = (iso, hhmm, fallback) => {
    const d = parseISODate(iso);
    const parts = String(hhmm || fallback || '00:00').split(':');
    d.setHours(parseInt(parts[0],10)||0, parseInt(parts[1],10)||0, 0, 0);
    return d;
  };

  const BAR_H = 18, GAP = 3, MIN_W = 8;

  mezzi.forEach(m => {
    // Cella nome mezzo (nome + targa/tipo)
    const sub = [m.targa, m.tipo].filter(Boolean).join(' · ');
    grid.append(el('div', {
      class:'gantt-row-nome',
      style:'flex-direction:column;align-items:flex-start;justify-content:center;gap:2px;',
      title: m.nome + (sub ? ' — ' + sub : ''),
    },
      el('div', { style:'font-weight:600;line-height:1.1;' }, m.nome || '—'),
      sub ? el('div', { style:'font-family:JetBrains Mono,monospace;font-size:11px;color:var(--mut);' }, sub) : null,
    ));

    const track = el('div', { class:'gantt-cmrow',
      style:`grid-column:2 / span ${slots.length}; position:relative;` });

    // Sfondo colonne (weekend/oggi/festivi/chiusure)
    slots.forEach((slot, i) => {
      const nonLav = !slot.weekend && nonLavMap[slot.dateISO];
      track.append(el('div', {
        class:'gantt-cmcol' + (slot.weekend?' weekend':'') + (nonLav?' nonlav':'')
          + ((slot.dateISO===oggiISO||slot.isOggi)?' oggi':''),
        style:`left:${i*slotWidth}px;width:${slotWidth}px;`,
        title: nonLav || undefined,
      }));
    });

    // Prenotazioni del mezzo che intersecano il range
    const prens = (state.prenotazioni || [])
      .filter(p => p.mezzo_id === m.id && p.data_inizio <= rangeEndIso && p.data_fine >= rangeStartIso)
      .map(p => ({ p,
        s: mkInstant(p.data_inizio, p.ora_inizio, '00:00'),
        e: mkInstant(p.data_fine, p.ora_fine, '23:59'),
        conflitto: false, lane: 0,
      }))
      .sort((a,b) => a.s - b.s);

    // Conflitti: sovrapposizione [s,e) sullo stesso mezzo (08–12 e 12–18 non confliggono)
    for (let i=0;i<prens.length;i++) for (let j=i+1;j<prens.length;j++) {
      if (prens[i].s < prens[j].e && prens[j].s < prens[i].e) { prens[i].conflitto = true; prens[j].conflitto = true; }
    }

    // Corsie: le sovrapposte vanno su corsie diverse così sono tutte visibili
    const laneEnds = [];
    prens.forEach(x => {
      let lane = laneEnds.findIndex(end => end <= x.s);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(x.e); }
      else laneEnds[lane] = x.e;
      x.lane = lane;
    });
    const nLanes = Math.max(1, laneEnds.length);

    // Barre
    prens.forEach(x => {
      const p = x.p;
      const left = instantX(x.s);
      const width = Math.max(MIN_W, instantX(x.e) - left);
      const color = TIPO_COLOR[p.tipo] || '#6b6b64';
      const dest = (typeof getPrenotazioneDestinazione === 'function')
        ? getPrenotazioneDestinazione(p.id) : { breve:'—', tooltip:'—' };
      const utilNomi = (state.prenOp || [])
        .filter(r => r.prenotazione_id === p.id)
        .map(r => state.utentiById[r.utente_id]?.nome).filter(Boolean);
      const utilLbl = utilNomi.length ? utilNomi.join(', ') : '—';
      const lbl = (dest.breve && dest.breve !== '—') ? ('→ ' + dest.breve) : utilLbl;
      const periodo = p.data_inizio === p.data_fine
        ? fmtIT(p.data_inizio)
        : fmtIT(p.data_inizio) + ' → ' + fmtIT(p.data_fine);
      const orari = (p.ora_inizio || '—') + '–' + (p.ora_fine || '—');

      const bar = el('div', {
        class:'gantt-cmbar' + (x.conflitto ? ' mzconflict' : ''),
        style:`left:${left}px;width:${width}px;top:${x.lane*(BAR_H+GAP)}px;height:${BAR_H}px;background:${color};`,
        title: 'Mezzo: ' + (m.nome || '—')
          + '\nPeriodo: ' + periodo
          + '\nOrario: ' + orari
          + '\nDestinazione:\n' + (dest.tooltip || dest.breve || '—')
          + '\nOperatori: ' + utilLbl
          + (x.conflitto ? '\n⚠ SOVRAPPOSIZIONE con un\'altra prenotazione dello stesso mezzo' : '')
          + '\n(clic per aprire)',
        onclick: () => openPrenotazioneModal(p),
      });
      bar.append(el('div', { class:'gantt-cmbar-txt' }, lbl));
      track.append(bar);
    });

    track.style.minHeight = Math.max(38, nLanes*(BAR_H+GAP)+8) + 'px';
    grid.append(track);
  });

  wrap.append(grid);
  root.append(wrap);
}

function renderCalendar(root) {
  // calMode controlla cosa mostrare: 'mezzi' (default) o 'generale' (solo assenze/festività/chiusure)
  const calMode = state.calMode || 'mezzi';
  const isGenerale = calMode === 'generale';
  const targetTab = isGenerale ? 'generale' : 'cal_mezzi';

  const cur = state.calCursor;
  const zoom = state.calZoom || 'settimana';

  // Calcolo range: in settimana → 7 giorni Lun-Dom della settimana del cursore.
  // In mese → griglia da Lun (prima settimana) a Dom (ultima settimana) del mese.
  let startGrid, endGrid;
  if (zoom === 'settimana') {
    startGrid = new Date(cur);
    startGrid.setDate(cur.getDate() - ((cur.getDay()+6)%7));
    endGrid = new Date(startGrid);
    endGrid.setDate(startGrid.getDate() + 6);
  } else {
    const first = new Date(cur.getFullYear(), cur.getMonth(), 1);
    const last  = new Date(cur.getFullYear(), cur.getMonth()+1, 0);
    startGrid = new Date(first);
    startGrid.setDate(first.getDate() - ((first.getDay()+6)%7));
    endGrid = new Date(last);
    endGrid.setDate(last.getDate() + (6 - ((last.getDay()+6)%7)));
  }

  const startISO = toLocalISO(startGrid);
  const endISO = toLocalISO(endGrid);
  const todayISO = toLocalISO(new Date());

  // Filtro le prenotazioni della cache che intersecano la griglia
  const prenInRange = isGenerale ? [] : state.prenotazioni.filter(p =>
    p.data_inizio <= endISO && p.data_fine >= startISO
  );
  // Il calendario mostra SOLO le prenotazioni. Gli usi_mezzo (timbrature
  // fisiche dal kiosk) NON vengono più disegnati: erano ridondanti perché
  // ogni uscita dal kiosk crea/aggiorna già una prenotazione corrispondente.
  // Mostrarli entrambi produceva una doppia voce per la stessa uscita.
  const mezziById = Object.fromEntries(state.mezzi.map(m=>[m.id,m]));

  // Costruisco indice giorno → array di entries
  // entry = { kind:'pren', data:p }
  const byDay = {};
  for (const p of prenInRange) {
    const a = parseISODate(p.data_inizio), b = parseISODate(p.data_fine);
    for (let d = new Date(a); d <= b; d.setDate(d.getDate()+1)) {
      const k = toLocalISO(d);
      (byDay[k] = byDay[k] || []).push({ kind:'pren', data:p });
    }
  }
  // Assenze valide nel range (modello giornaliero: una riga per giorno).
  // Mostrate solo nel calendario "Generale", non nel calendario "Mezzi".
  const assenzeInRange = isGenerale
    ? state.assenze.filter(a => a.stato === 'valida' && a.data >= startISO && a.data <= endISO)
    : [];
  for (const ass of assenzeInRange) {
    const k = ass.data;
    (byDay[k] = byDay[k] || []).push({ kind:'assenza', data:ass });
  }

  root.innerHTML = '';

  // Funzione per spostarsi avanti/indietro nel calendario
  function spostaCursore(dir) {
    const nc = new Date(cur);
    if (zoom === 'settimana') {
      nc.setDate(nc.getDate() + dir * 7);
    } else {
      nc.setMonth(nc.getMonth() + dir);
      // se vista mese, posiziono il cursore al 1° del nuovo mese
      nc.setDate(1);
    }
    state.calCursor = nc;
    renderTab(targetTab);
  }

  // Label intestazione coerente con lo zoom
  let calLabel;
  if (zoom === 'settimana') {
    // "10 — 16 marzo 2026" (o "29 mar — 4 apr 2026" se attraversa due mesi)
    const a = startGrid, b = endGrid;
    if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
      calLabel = `${a.getDate()} — ${b.getDate()} ${monthName(a)}`;
    } else if (a.getFullYear() === b.getFullYear()) {
      calLabel = `${a.getDate()} ${MESI_BREVI[a.getMonth()]} — ${b.getDate()} ${MESI_BREVI[b.getMonth()]} ${a.getFullYear()}`;
    } else {
      calLabel = `${a.getDate()} ${MESI_BREVI[a.getMonth()]} ${a.getFullYear()} — ${b.getDate()} ${MESI_BREVI[b.getMonth()]} ${b.getFullYear()}`;
    }
  } else {
    calLabel = monthName(cur);
  }

  const headChildren = [
    el('div', { class:'switch-bar', style:'margin-right:8px;' },
      el('button', { class: zoom === 'settimana' ? 'act' : '',
        onclick:()=>{ state.calZoom = 'settimana'; renderTab(targetTab); } }, 'Settimana'),
      el('button', { class: zoom === 'mese' ? 'act' : '',
        onclick:()=>{ state.calZoom = 'mese'; renderTab(targetTab); } }, 'Mese'),
    ),
    el('button', { class:'btng', onclick:()=>spostaCursore(-1) }, '← Prec'),
    el('button', { class:'btng', onclick:()=>{ state.calCursor = new Date(); renderTab(targetTab); }}, 'Oggi'),
    el('button', { class:'btng', onclick:()=>spostaCursore(+1) }, 'Succ →'),
    el('h2', { style:'flex:1' }, calLabel),
  ];
  if (!isGenerale) {
    headChildren.push(el('button', { class:'btnp', onclick:()=>openPrenotazioneModal() }, '+ Nuova Prenotazione'));
  }
  root.append(el('div', { class:'cal-head' }, ...headChildren));

  const legend = el('div', { class:'legend' });
  if (!isGenerale) {
    TIPI.forEach(t => legend.append(el('span', { class:'lg' },
      el('span', { class:'swatch', style:`background:${t.color}` }), t.label
    )));
  }
  // Assenza: solo nel "Generale". Chiusure e festività: solo nel "Generale".
  if (isGenerale) {
    legend.append(el('span', { class:'lg' },
      el('span', { class:'swatch', style:'background:rgba(78,255,163,.4);border-color:var(--grn);' }), 'Assenza'));
    legend.append(el('span', { class:'lg' },
      el('span', { class:'swatch', style:'background:rgba(255,107,53,.4);border-color:var(--or);' }), '🔒 Chiusura azienda'));
    legend.append(el('span', { class:'lg' },
      el('span', { class:'swatch', style:'background:rgba(78,184,255,.4);border-color:var(--blu);' }), '🎉 Festività'));
  }
  root.append(legend);

  const grid = el('div', { class: 'cal-grid zoom-' + zoom });
  ['Lun','Mar','Mer','Gio','Ven','Sab','Dom'].forEach(d => grid.append(el('div', { class:'cal-dow' }, d)));

  // Calcola festività dell'anno e dell'anno seguente (per griglie a cavallo di anni)
  const festSet = new Set();
  if (typeof festiviAnno === 'function') {
    festiviAnno(cur.getFullYear()).forEach(x => festSet.add(x));
    festiviAnno(cur.getFullYear()+1).forEach(x => festSet.add(x));
  }
  const festivitaNomi = {};
  if (typeof festiviNazionali === 'function') {
    [cur.getFullYear(), cur.getFullYear()+1, cur.getFullYear()-1].forEach(y => {
      festiviNazionali(y).forEach(f => {
        const iso = f.data instanceof Date ? toLocalISO(f.data) : f.data;
        if (iso) festivitaNomi[iso] = f.nome;
      });
    });
  }

  for (let d = new Date(startGrid); d <= endGrid; d.setDate(d.getDate()+1)) {
    const iso = toLocalISO(d);
    // In vista settimana tutte le celle sono "questa settimana" — non dimmiamo
    // in base al mese; in vista mese sì.
    const inMonth = zoom === 'mese' ? d.getMonth() === cur.getMonth() : true;
    const dow = (d.getDay()+6)%7;
    const isWeekend = dow >= 5;
    const isFestivo = festSet.has(iso);
    const chiusura = (typeof getChiusuraAziendale === 'function') ? getChiusuraAziendale(iso) : null;
    const cls = ['cal-cell'];
    if (!inMonth) cls.push('other');
    if (iso === todayISO) cls.push('today');
    if (isWeekend) cls.push('weekend');
    const cell = el('div', {
      class: cls.join(' '),
      onclick: (e) => {
        if (e.target.closest('.cal-evt')) return;
        if (isGenerale) return; // niente click in modalità generale
        openPrenotazioneModal({ data_inizio: iso, data_fine: iso });
      }
    });
    // Background tinto per festività/chiusure
    if (chiusura) cell.style.background = 'rgba(255,107,53,.10)';
    else if (isFestivo) cell.style.background = 'rgba(78,184,255,.10)';

    cell.append(el('div', { class:'cal-day-num' }, String(d.getDate())));

    // Eventi "speciali" (festività + chiusure) prima degli altri
    if (isFestivo) {
      cell.append(el('div', {
        class: 'cal-evt',
        style: 'border-left-color:var(--blu);background:rgba(78,184,255,.15);color:var(--blu);font-weight:600;',
        title: festivitaNomi[iso] || 'Festività',
      }, '🎉 ' + (festivitaNomi[iso] || 'Festivo')));
    }
    if (chiusura) {
      cell.append(el('div', {
        class: 'cal-evt',
        style: 'border-left-color:var(--or);background:rgba(255,107,53,.15);color:var(--or);font-weight:600;',
        title: chiusura.descrizione || 'Chiusura aziendale',
      }, '🔒 ' + (chiusura.descrizione || 'Chiusura')));
    }
    const evs = byDay[iso] || [];
    // In vista settimanale c'è molto più spazio verticale: mostro più voci.
    const max = zoom === 'settimana'
      ? (window.innerWidth < 640 ? 6 : 12)
      : (window.innerWidth < 640 ? 2 : 3);
    const box = el('div', { class:'cal-events' });
    evs.slice(0, max).forEach(entry => {
      if (entry.kind === 'pren') {
        const p = entry.data;
        const m = mezziById[p.mezzo_id];
        const u = state.profiliById[p.utente_id];
        const autore = u?.nome || u?.email || '?';
        const color = TIPO_COLOR[p.tipo] || '#6b6b64';
        const utilNomi = state.prenOp
          .filter(r => r.prenotazione_id === p.id)
          .map(r => state.utentiById[r.utente_id]?.nome)
          .filter(Boolean);
        const utilLbl = utilNomi.length ? utilNomi.join(', ') : '—';
        const dest = getPrenotazioneDestinazione(p.id);
        // Etichetta nel calendario: mezzo · destinazione (o operatore se manca dest)
        const lblPezzi = [m?.nome || '?'];
        if (dest.breve !== '—') lblPezzi.push('→ '+dest.breve);
        else lblPezzi.push(utilLbl);
        box.append(el('div', {
          class: 'cal-evt',
          style: `border-left-color:${color}`,
          title: `Mezzo: ${m?.nome || '—'}\nDestinazione:\n${dest.tooltip}\nOperatori: ${utilLbl}\nTipo: ${p.tipo}\nCreata da: ${autore}`,
          onclick: (e) => { e.stopPropagation(); openPrenotazioneModal(p); }
        }, lblPezzi.join(' ')));
      } else {
        // entry.kind === 'assenza'
        const ass = entry.data;
        const utz = state.utentiById[ass.utente_id];
        const tipo = state.tipiAssenza.find(t => t.id === ass.tipo_assenza_id);
        const colore = tipo ? tipo.colore : '#6b6b64';
        const ore = parseFloat(ass.ore) || 0;
        const labelOre = ore >= 8 ? '' : ` (${ore}h)`;
        box.append(el('div', {
          class: 'cal-evt cal-assenza',
          style: `border-left-color:${colore};background:${colore}1a;`,
          title: `Assenza: ${utz?.nome || '—'}\nTipo: ${tipo?.nome || 'senza tipo'}\nOre: ${ore}\n${fmtIT(ass.data)}${ass.note ? '\nNote: '+ass.note : ''}`,
          onclick: (e) => { e.stopPropagation(); switchToTab('calendari','cal_assenze'); }
        }, `${utz?.nome || '?'} · ${tipo?.codice || tipo?.nome || 'assente'}${labelOre}`));
      }
    });
    if (evs.length > max) {
      box.append(el('div', {
        class:'cal-more',
        onclick: (e) => { e.stopPropagation(); openDayDetailModal(iso, evs); },
      }, `+${evs.length - max} altri`));
    }
    cell.append(box);
    grid.append(cell);
  }
  root.append(grid);
}

// Popup col dettaglio completo degli eventi/usi/assenze di un giorno.
// Gestisce tutti i tipi di entry possibili in byDay: pren, uso, assenza,
// festa, chiusura. Prima la funzione assumeva ciecamente "pren o uso" e
// nel calendario Generale finiva per renderizzare assenze come fossero usi
// mezzo, producendo dati e orari sballati (NaN:NaN, badge "chiuso", ecc.).
function openDayDetailModal(iso, evs) {
  const mezziById = Object.fromEntries(state.mezzi.map(m=>[m.id,m]));
  const modal = el('div', { class:'modal' });
  modal.append(el('div', { class:'mhd' },
    el('h2', {}, fmtIT(iso)),
    el('button', { class:'mclose', onclick:closeModal }, '✕'),
  ));
  const body = el('div', { class:'mbody' });
  body.append(el('div', { class:'sub', style:'margin-bottom:10px;' },
    `${evs.length} ${evs.length === 1 ? 'elemento' : 'elementi'} in questa giornata`));

  evs.forEach(entry => {
    // ── Prenotazione mezzo ─────────────────────────────────
    if (entry.kind === 'pren') {
      const p = entry.data;
      const m = mezziById[p.mezzo_id];
      const utilNomi = state.prenOp
        .filter(r => r.prenotazione_id === p.id)
        .map(r => state.utentiById[r.utente_id]?.nome)
        .filter(Boolean);
      const color = TIPO_COLOR[p.tipo] || '#6b6b64';
      const dest = getPrenotazioneDestinazione(p.id);
      body.append(el('div', {
        class:'day-row',
        style:`border-left-color:${color};`,
        onclick: () => { closeModal(); openPrenotazioneModal(p); },
      },
        el('div', { class:'day-row-title' },
          (m?.nome || '?') + (m?.targa ? ' · '+m.targa : '') +
          (dest.breve !== '—' ? ' → '+dest.breve : '')),
        el('div', { class:'day-row-sub' },
          el('span', { class:'badge '+TIPO_BADGE[p.tipo] }, p.tipo),
          ' ',
          utilNomi.length ? utilNomi.join(', ') : '—'),
      ));
      return;
    }

    // ── Uso mezzo ──────────────────────────────────────────
    // (rimosso: gli usi_mezzo non sono più disegnati nel calendario,
    //  le uscite sono rappresentate dalle prenotazioni)

    // ── Assenza ────────────────────────────────────────────
    if (entry.kind === 'assenza') {
      const a = entry.data;
      const utz = state.utentiById[a.utente_id];
      const tipo = state.tipiAssenza.find(t => t.id === a.tipo_assenza_id);
      const color = (tipo && tipo.colore) || '#4effa3';
      body.append(el('div', {
        class:'day-row',
        style:`border-left-color:${color};`,
      },
        el('div', { class:'day-row-title' },
          (utz?.nome || '—') + ' · ' + (tipo?.nome || 'Assenza')),
        el('div', { class:'day-row-sub' },
          (a.ore ? a.ore + 'h' : '8h'),
          a.note ? ' · ' + a.note : ''),
      ));
      return;
    }

    // ── Festività ──────────────────────────────────────────
    if (entry.kind === 'festa') {
      const f = entry.data;
      body.append(el('div', {
        class:'day-row',
        style:'border-left-color:var(--blu);',
      },
        el('div', { class:'day-row-title' }, '🎉 ' + (f.nome || 'Festività')),
        el('div', { class:'day-row-sub' }, 'Festività nazionale'),
      ));
      return;
    }

    // ── Chiusura aziendale ─────────────────────────────────
    if (entry.kind === 'chiusura') {
      const c = entry.data;
      body.append(el('div', {
        class:'day-row',
        style:'border-left-color:var(--or);',
      },
        el('div', { class:'day-row-title' }, '🔒 ' + (c.nome || 'Chiusura azienda')),
        c.note ? el('div', { class:'day-row-sub' }, c.note) : null,
      ));
      return;
    }
  });

  modal.append(body);
  modal.append(el('div', { class:'mfoot' },
    el('button', { class:'btng', onclick:closeModal }, 'Chiudi')));
  openModal(modal);
}

function renderElenco(root) {
  const oggi = new Date();
  const da = toLocalISO(oggi);
  const a  = toLocalISO(new Date(oggi.getFullYear(), oggi.getMonth()+2, oggi.getDate()));
  // Filtro prenotazioni dei prossimi 60 giorni dalla cache
  const prenotazioni = state.prenotazioni
    .filter(p => p.data_inizio <= a && p.data_fine >= da)
    .sort((x,y) => x.data_inizio.localeCompare(y.data_inizio));
  const mezziById = Object.fromEntries(state.mezzi.map(m=>[m.id,m]));

  const kpis = el('div', { class:'kpis' });
  const totFut = prenotazioni.length;
  const totMese = prenotazioni.filter(p => p.data_inizio.startsWith(toLocalISO(oggi).slice(0,7))).length;
  kpis.append(
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Totale prossime'), el('div', { class:'kv ka' }, String(totFut))),
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Questo mese'), el('div', { class:'kv kb' }, String(totMese))),
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Mezzi attivi'), el('div', { class:'kv kg' }, String(state.mezzi.filter(m=>m.attivo).length))),
  );

  root.innerHTML = '';
  root.append(kpis);
  root.append(el('div', { class:'toolbar' },
    el('h2', {}, 'Prenotazioni dei prossimi 60 giorni'),
    el('button', { class:'btnp', onclick:()=>openPrenotazioneModal() }, '+ Nuova'),
  ));

  if (prenotazioni.length === 0) {
    root.append(el('div', { class:'empty' }, 'Nessuna prenotazione nei prossimi 60 giorni'));
    return;
  }

  const tw = el('div', { class:'tw' });
  const tbl = el('table', { class:'rt' });
  tbl.append(el('thead', {}, el('tr', {},
    el('th', {}, 'Periodo'), el('th', {}, 'Mezzo'), el('th', {}, 'Destinazione'), el('th', {}, 'Tipo'),
    el('th', {}, 'Operatori'), el('th', {}, 'Prenotato da'), el('th', { class:'tc' }, 'Azioni'),
  )));
  const tb = el('tbody');
  prenotazioni.forEach(p => {
    const m = mezziById[p.mezzo_id];
    const u = state.profiliById[p.utente_id];
    const periodo = p.data_inizio === p.data_fine ? fmtIT(p.data_inizio) : `${fmtIT(p.data_inizio)} → ${fmtIT(p.data_fine)}`;
    const utilNomi = state.prenOp
      .filter(r => r.prenotazione_id === p.id)
      .map(r => state.utentiById[r.utente_id]?.nome)
      .filter(Boolean);
    const dest = getPrenotazioneDestinazione(p.id);
    tb.append(el('tr', {},
      el('td', { class:'mono' }, periodo),
      el('td', {}, el('span', { class:'cod-cell' }, m ? m.nome : '—')),
      el('td', { title: dest.tooltip },
        dest.breve === '—'
          ? el('span', { class:'sub' }, '—')
          : el('span', {}, dest.breve)),
      el('td', {}, el('span', { class:'badge '+TIPO_BADGE[p.tipo] }, p.tipo)),
      el('td', {}, utilNomi.length ? utilNomi.join(', ') : '—'),
      el('td', { class:'mono' }, u?.nome || u?.email || '—'),
      el('td', { class:'tc' }, el('button', { class:'btnsm', onclick:()=>openPrenotazioneModal(p) }, 'Apri')),
    ));
  });
  tbl.append(tb);
  tw.append(tbl);
  root.append(tw);
}

function renderMezzi(root) {
  const isAdmin = state.profile.ruolo === 'admin';

  // Statistiche operatori ultimi 6 mesi dalla cache
  const oggi = new Date();
  const seiMesiFa = toLocalISO(new Date(oggi.getFullYear(), oggi.getMonth()-6, oggi.getDate()));
  const prenList = state.prenotazioni.filter(p => p.data_fine >= seiMesiFa);

  // Indice pivot per pren_id → array di utente_id (dalla cache)
  const pivotByPren = {};
  state.prenOp.forEach(r => {
    (pivotByPren[r.prenotazione_id] = pivotByPren[r.prenotazione_id] || []).push(r.utente_id);
  });

  // Per ogni mezzo: operatori distinti + conteggio
  const statsByMezzo = {};
  prenList.forEach(p => {
    if (!statsByMezzo[p.mezzo_id]) statsByMezzo[p.mezzo_id] = { operatori: {}, totale: 0 };
    const s = statsByMezzo[p.mezzo_id];
    s.totale++;
    const utils = pivotByPren[p.id] || [];
    utils.forEach(uid => {
      s.operatori[uid] = (s.operatori[uid] || 0) + 1;
    });
  });

  root.innerHTML = '';
  root.append(el('div', { class:'toolbar' },
    el('h2', {}, 'Mezzi aziendali'),
    isAdmin ? el('button', { class:'btnp', onclick:()=>openMezzoModal() }, '+ Nuovo Mezzo') : null,
  ));
  if (state.mezzi.length === 0) {
    root.append(el('div', { class:'empty' }, isAdmin ? 'Nessun mezzo. Aggiungi il primo!' : 'Nessun mezzo configurato.'));
    return;
  }
  const tw = el('div', { class:'tw' });
  const tbl = el('table', { class:'rt' });
  tbl.append(el('thead', {}, el('tr', {},
    el('th', {}, ''), el('th', {}, 'Nome'), el('th', {}, 'Targa'), el('th', {}, 'Tipo'),
    el('th', {}, 'Stato'),
    el('th', {}, 'Operatori (ultimi 6 mesi)'),
    el('th', { class:'tc' }, 'Pren.'),
    isAdmin ? el('th', { class:'tc' }, 'Azioni') : null,
  )));
  const tb = el('tbody');
  state.mezzi.forEach(m => {
    const stats = statsByMezzo[m.id] || { operatori:{}, totale:0 };
    const utentiOrdinati = Object.entries(stats.operatori)
      .sort((a,b) => b[1] - a[1])
      .map(([uid, count]) => {
        const u = state.utentiById[uid];
        const nome = u?.nome || '?';
        return `${nome} (${count})`;
      });
    const utentiCell = utentiOrdinati.length === 0
      ? el('span', { class:'sub' }, '—')
      : el('div', { style:'display:flex;flex-wrap:wrap;gap:4px;' },
          ...utentiOrdinati.map(u => el('span', { class:'badge bgry', style:'font-size:11px;' }, u))
        );

    tb.append(el('tr', {},
      el('td', {}, el('span', { class:'swatch', style:`background:${m.colore||'#4eb8ff'}` })),
      el('td', {}, el('span', { class:'cod-cell' }, m.nome)),
      el('td', { class:'mono' }, m.targa || '—'),
      el('td', { class:'mono' }, m.tipo || '—'),
      el('td', {}, m.attivo ? el('span', { class:'badge bok' }, 'attivo') : el('span', { class:'badge bgry' }, 'disattivo')),
      el('td', {}, utentiCell),
      el('td', { class:'tc mono' }, String(stats.totale)),
      isAdmin ? el('td', { class:'tc' },
        el('button', { class:'btnsm', onclick:()=>openMezzoModal(m) }, 'Modifica'),
        ' ',
        el('button', { class:'btnd', onclick:()=>deleteMezzo(m) }, 'Elimina'),
      ) : null,
    ));
  });
  tbl.append(tb);
  tw.append(tbl);
  root.append(tw);
}

async function deleteMezzo(m) {
  if (!confirm(`Eliminare il mezzo "${m.nome}"?\nTutte le sue prenotazioni saranno cancellate.`)) return;
  const { error } = await sb.from('mezzi').delete().eq('id', m.id);
  if (error) return toast(error.message, 'err');
  // Aggiorna subito la cache locale
  state.mezzi = state.mezzi.filter(x => x.id !== m.id);
  // Le prenotazioni del mezzo vengono cancellate a cascata dal DB
  const prenIdsRimosse = state.prenotazioni.filter(p => p.mezzo_id === m.id).map(p => p.id);
  state.prenotazioni = state.prenotazioni.filter(p => p.mezzo_id !== m.id);
  state.consegne = state.consegne.filter(c => !prenIdsRimosse.includes(c.prenotazione_id));
  state.prenOp = state.prenOp.filter(r => !prenIdsRimosse.includes(r.prenotazione_id));
  toast('Mezzo eliminato'); renderTab('mezzi');
}

// ─── Chiama la Edge Function gestione-account ───
// azione: 'crea' | 'reset_password'. Ritorna {ok, ...} o {error}
async function chiamaGestioneAccount(payload) {
  try {
    let sessData = null;
    try {
      const r = await conTimeoutAuth(sb.auth.getSession(), 4000);
      sessData = r?.data || null;
    } catch (e) {
      // Se il client è bloccato, ricreiamo e riproviamo una volta
      await ricreaConnessione();
      const r2 = await conTimeoutAuth(sb.auth.getSession(), 4000).catch(() => null);
      sessData = r2?.data || null;
    }
    const token = sessData?.session?.access_token;
    if (!token) return { error: 'Sessione scaduta — rifai il login' };

    const resp = await fetch(SUPABASE_URL + '/functions/v1/gestione-account', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) return { error: data.error || ('Errore ' + resp.status) };
    return data;
  } catch (e) {
    return { error: 'Errore di rete: ' + (e?.message || e) };
  }
}

function renderOperatori(root) {
  root.innerHTML = '';
  root.append(el('div', { class:'toolbar' },
    el('h2', {}, 'Utenti & Accessi'),
    el('button', { class:'btnp', onclick:()=>openOperatoreModal() }, '+ Nuovo Utente'),
  ));

  root.append(el('div', { class:'sub', style:'margin-bottom:12px;' },
    'Anagrafica delle persone (operatori, uffici, esterni). Un utente può avere un account login collegato, oppure selezionare il proprio nome al kiosk.'));

  const tw = el('div', { class:'tw' });
  const tbl = el('table', { class:'rt' });
  tbl.append(el('thead', {}, el('tr', {},
    el('th', {}, 'Nome'),
    el('th', {}, 'Tipo'),
    el('th', {}, 'Gruppo'),
    el('th', {}, 'Account login'),
    el('th', {}, 'Stato'),
    el('th', { class:'tc' }, 'Azioni'),
  )));
  const tb = el('tbody');
  state.utenti.filter(u => !isKioskRecord(u)).forEach(u => {
    const account = u.account_id ? state.profiliById[u.account_id] : null;
    const accountCell = account
      ? el('span', { class:'badge bok', title:account.email },
          (account.ruolo === 'admin' ? '★ admin' : '✓ user'))
      : el('span', { class:'badge bgry' }, 'nessuno');

    const azioniCell = el('td', { class:'tc' },
      el('button', { class:'btnsm', onclick:()=>openOperatoreModal(u) }, 'Modifica'),
    );
    // Account collegato → bottoni ruolo + reset password
    if (account) {
      azioniCell.append(' ', el('button', {
        class:'btnsm', onclick:()=>toggleRuolo(account),
        title:'Cambia ruolo dell\'account collegato',
      }, account.ruolo==='admin' ? 'Rendi user' : 'Rendi admin'));
      azioniCell.append(' ', el('button', {
        class:'btnsm', style:'background:rgba(78,184,255,.15);color:var(--blu);border-color:var(--blu);',
        onclick:()=>openResetPasswordModal(u, account),
        title:'Imposta una nuova password per questo account',
      }, '🔑 Password'));
    } else {
      // Nessun account → bottone crea account
      azioniCell.append(' ', el('button', {
        class:'btnsm', style:'background:rgba(78,255,163,.15);color:var(--grn);border-color:var(--grn);',
        onclick:()=>openCreaAccountModal(u),
        title:'Crea un account login per questo utente',
      }, '+ Crea account'));
    }
    azioniCell.append(' ', el('button', { class:'btnd', onclick:()=>deleteOperatore(u) }, 'Elimina'));

    // Menu a tendina inline per cambio rapido del gruppo
    const selGruppo = el('select', {
      style:'background:var(--sur);border:1px solid var(--brd);color:var(--txt);padding:3px 6px;border-radius:3px;font-size:11px;font-family:inherit;cursor:pointer;',
      onchange: async (e) => {
        const nuovo = e.target.value || null;
        const precedente = u.gruppo || null;
        if (nuovo === precedente) return;
        e.target.disabled = true;
        try {
          const { data, error } = await eseguiConRetry(
            () => sb.from('utenti').update({ gruppo: nuovo }).eq('id', u.id).select().single(),
            { label: 'cambia gruppo utente' }
          );
          if (error) throw error;
          Object.assign(u, data);
          toast('Gruppo aggiornato', 'ok');
        } catch (err) {
          toast('Errore: ' + (err.message || err), 'err');
          e.target.value = precedente || '';
        } finally {
          e.target.disabled = false;
        }
      },
    },
      el('option', { value:'' }, '— nessuno —'),
      ...GRUPPI_UTENTI.map(g => el('option', { value: g.key }, g.label)),
    );
    selGruppo.value = u.gruppo || '';

    tb.append(el('tr', {},
      el('td', {}, u.nome),
      el('td', {}, u.esterno
        ? el('span', { class:'badge byel',
            title:'Esterno in sede: timbra al kiosk, ore tenute riconoscibili' },
            'esterno' + (u.azienda_id
              ? ' · ' + ((state.aziende.find(a => a.id === u.azienda_id) || {}).nome || '?')
              : ''))
        : el('span', { class:'badge bblu' }, 'interno')),
      el('td', {}, selGruppo),
      el('td', {}, accountCell),
      el('td', {}, u.attivo ? el('span', { class:'badge bok' }, 'attivo') : el('span', { class:'badge bgry' }, 'disatt.')),
      azioniCell,
    ));
  });
  tbl.append(tb);
  tw.append(tbl);
  root.append(tw);

  // ─── Sezione: come si crea un accesso ───
  const utentiSenzaAccount = state.utenti
    .filter(u => !isKioskRecord(u) && u.attivo && !u.account_id);

  const box = el('div', { style:'margin-top:24px;padding:14px 16px;background:var(--sur);border:1px solid var(--brd);border-radius:6px;' });
  box.append(el('div', { class:'kl', style:'margin-bottom:8px;' }, 'Come creare un accesso login'));
  box.append(el('div', { class:'sub', style:'line-height:1.7;' },
    el('div', {}, '1. Vai sulla dashboard Supabase → Authentication → Add User'),
    el('div', {}, '2. Email con lo schema aziendale: ',
      el('span', { class:'mono', style:'color:var(--acc);' }, 'nome.cognome@cablotec.net')),
    el('div', {}, '3. Imposta una password iniziale e comunicala alla persona'),
    el('div', {}, '4. Torna qui, clicca "Modifica" sull\'utente e collega l\'account appena creato'),
  ));

  if (utentiSenzaAccount.length > 0) {
    box.append(el('div', { style:'margin-top:12px;padding-top:12px;border-top:1px solid var(--brd);' },
      el('div', { class:'kl', style:'color:var(--yel);margin-bottom:6px;' },
        `⚠ ${utentiSenzaAccount.length} utenti attivi senza account login`),
      el('div', { class:'sub', style:'margin-bottom:6px;' },
        'Questi non possono entrare nell\'app (es. per segnare ferie). Se devono, crea loro un account:'),
      ...utentiSenzaAccount.map(u => {
        // Suggerisce l'email secondo lo schema
        const slug = (u.nome || '').toLowerCase().trim()
          .replace(/\s+/g, '.').replace(/[^a-z.]/g, '');
        return el('div', { class:'mono', style:'font-size:11px;margin-top:3px;' },
          `• ${u.nome}  →  `,
          el('span', { style:'color:var(--acc);' }, slug ? slug+'@cablotec.net' : '(nome non valido)'));
      }),
    ));
  }

  // Account login senza utente collegato (orfani)
  const profili = Object.values(state.profiliById).filter(p => !isKioskRecord(p));
  const orfani = profili.filter(p => !state.utenti.find(u => u.account_id === p.id));
  if (orfani.length > 0) {
    box.append(el('div', { style:'margin-top:12px;padding-top:12px;border-top:1px solid var(--brd);' },
      el('div', { class:'kl', style:'color:var(--or);margin-bottom:6px;' },
        `⚠ ${orfani.length} account login non collegati a un utente`),
      el('div', { class:'sub', style:'margin-bottom:6px;' },
        'Questi account possono fare login ma non sono collegati a una scheda anagrafica. Modifica l\'utente corrispondente e collega l\'account:'),
      ...orfani.map(p => el('div', { class:'mono', style:'font-size:11px;margin-top:3px;' },
        `• ${p.email}  (${p.ruolo || 'user'})`)),
    ));
  }

  root.append(box);
}

// ─── Modal: crea account login per un utente ───
function openCreaAccountModal(u) {
  // Suggerisci email da nome.cognome@cablotec.net
  let emailSuggerita = '';
  const parti = (u.nome || '').trim().toLowerCase().split(/\s+/);
  if (parti.length >= 2) {
    // primo nome . ultimo cognome, senza accenti
    const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g,'');
    emailSuggerita = norm(parti[0]) + '.' + norm(parti[parti.length-1]) + '@cablotec.net';
  }

  const modal = el('div', { class:'modal' });
  modal.append(el('div', { class:'mhd' },
    el('h2', {}, 'Crea account login'),
    el('button', { class:'mclose', onclick:closeModal }, '✕'),
  ));

  const body = el('div', { class:'mbody' });
  body.append(el('div', { class:'sub', style:'margin-bottom:14px;line-height:1.6;' },
    `Crea un account di accesso per `, el('strong', {}, u.nome),
    `. L'account verrà creato e collegato automaticamente a questa scheda utente.`));

  const inEmail = el('input', { type:'email', value: emailSuggerita,
    placeholder:'nome.cognome@cablotec.net' });
  const inPwd = el('input', { type:'text', value:'',
    placeholder:'almeno 6 caratteri' });

  // Genera una password casuale leggibile
  const btnGen = el('button', { type:'button', class:'btng', style:'font-size:11px;' },
    '🎲 Genera');
  btnGen.onclick = () => {
    const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
    let p = '';
    for (let i=0;i<8;i++) p += chars[Math.floor(Math.random()*chars.length)];
    inPwd.value = p;
  };

  body.append(
    el('div', { class:'field' }, el('label', {}, 'Email *'), inEmail),
    el('div', { class:'field' }, el('label', {}, 'Password *'),
      el('div', { style:'display:flex;gap:6px;' }, inPwd, btnGen)),
    el('div', { class:'sub', style:'margin-top:4px;' },
      'Per le email aziendali "anagrafiche" (non caselle reali) va bene una password semplice da comunicare a voce. Annotala: non sarà più visibile dopo.'),
  );
  modal.append(body);

  const foot = el('div', { class:'mfoot' });
  foot.append(el('button', { class:'btng', onclick:closeModal }, 'Annulla'));
  const btnSave = el('button', { class:'btnp' }, 'Crea account');
  btnSave.onclick = async () => {
    const email = (inEmail.value||'').trim().toLowerCase();
    const pwd = (inPwd.value||'').trim();
    if (!email) return toast('Inserisci l\'email', 'err');
    if (pwd.length < 6) return toast('La password deve avere almeno 6 caratteri', 'err');

    btnSave.disabled = true;
    btnSave.textContent = 'Creazione…';

    const res = await chiamaGestioneAccount({
      azione: 'crea', email, password: pwd, nome: u.nome,
    });
    if (res.error) {
      btnSave.disabled = false;
      btnSave.textContent = 'Crea account';
      return toast(res.error, 'err');
    }

    // Account creato → collega alla scheda utente
    const nuovoAccountId = res.user.id;
    const { error: linkErr } = await sb.from('utenti')
      .update({ account_id: nuovoAccountId })
      .eq('id', u.id);
    if (linkErr) {
      toast('Account creato ma errore nel collegamento: '+linkErr.message, 'err');
    } else {
      // Aggiorna cache locale
      u.account_id = nuovoAccountId;
      state.utenti = state.utenti.map(x => x.id === u.id ? {...x, account_id:nuovoAccountId} : x);
      // Il profilo verrà creato dal trigger handle_new_user; lo aggiungiamo in cache se manca
      if (!state.profiliById[nuovoAccountId]) {
        state.profiliById[nuovoAccountId] = {
          id: nuovoAccountId, email: email, nome: u.nome, ruolo: 'user',
        };
      }
    }
    closeModal();
    toast('Account creato per '+u.nome);
    // Mostra un riepilogo con le credenziali
    showConfirmCredenziali(u.nome, email, pwd);
    renderTab('operatori');
  };
  foot.append(btnSave);
  modal.append(foot);
  openModal(modal);
}

// Piccola finestra che ricorda le credenziali appena create
function showConfirmCredenziali(nome, email, pwd) {
  const modal = el('div', { class:'modal' });
  modal.append(el('div', { class:'mhd' },
    el('h2', {}, '✓ Account creato'),
    el('button', { class:'mclose', onclick:closeModal }, '✕'),
  ));
  const body = el('div', { class:'mbody' });
  body.append(el('div', { class:'sub', style:'margin-bottom:12px;' },
    `Comunica queste credenziali a `, el('strong', {}, nome),
    `. Annotale ora: la password non sarà più visibile.`));
  body.append(el('div', {
    style:'background:var(--sur2);border:1px solid var(--brd);border-radius:4px;padding:12px 14px;font-family:JetBrains Mono,monospace;font-size:13px;line-height:1.9;'
  },
    el('div', {}, el('span', { style:'color:var(--mut);' }, 'Email:  '),
      el('strong', { style:'color:var(--acc);' }, email)),
    el('div', {}, el('span', { style:'color:var(--mut);' }, 'Password: '),
      el('strong', { style:'color:var(--acc);' }, pwd)),
  ));
  modal.append(body);
  const foot = el('div', { class:'mfoot' });
  foot.append(el('button', { class:'btnp', onclick:closeModal }, 'Ho annotato'));
  modal.append(foot);
  openModal(modal);
}

// ─── Modal: reset password di un account esistente ───
function openResetPasswordModal(u, account) {
  const modal = el('div', { class:'modal' });
  modal.append(el('div', { class:'mhd' },
    el('h2', {}, 'Reset password'),
    el('button', { class:'mclose', onclick:closeModal }, '✕'),
  ));

  const body = el('div', { class:'mbody' });
  body.append(el('div', { class:'sub', style:'margin-bottom:14px;line-height:1.6;' },
    `Imposta una nuova password per l'account di `, el('strong', {}, u.nome),
    ` (`, el('span', { class:'mono' }, account.email), `).`));

  const inPwd = el('input', { type:'text', value:'', placeholder:'almeno 6 caratteri' });
  const btnGen = el('button', { type:'button', class:'btng', style:'font-size:11px;' }, '🎲 Genera');
  btnGen.onclick = () => {
    const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
    let p = '';
    for (let i=0;i<8;i++) p += chars[Math.floor(Math.random()*chars.length)];
    inPwd.value = p;
  };

  body.append(
    el('div', { class:'field' }, el('label', {}, 'Nuova password *'),
      el('div', { style:'display:flex;gap:6px;' }, inPwd, btnGen)),
    el('div', { class:'sub', style:'margin-top:4px;' },
      'La vecchia password verrà sostituita. Comunica la nuova all\'utente.'),
  );
  modal.append(body);

  const foot = el('div', { class:'mfoot' });
  foot.append(el('button', { class:'btng', onclick:closeModal }, 'Annulla'));
  const btnSave = el('button', { class:'btnp' }, 'Imposta password');
  btnSave.onclick = async () => {
    const pwd = (inPwd.value||'').trim();
    if (pwd.length < 6) return toast('La password deve avere almeno 6 caratteri', 'err');

    btnSave.disabled = true;
    btnSave.textContent = 'Aggiornamento…';

    const res = await chiamaGestioneAccount({
      azione: 'reset_password', user_id: account.id, password: pwd,
    });
    if (res.error) {
      btnSave.disabled = false;
      btnSave.textContent = 'Imposta password';
      return toast(res.error, 'err');
    }
    closeModal();
    toast('Password aggiornata');
    showConfirmCredenziali(u.nome, account.email, pwd);
  };
  foot.append(btnSave);
  modal.append(foot);
  openModal(modal);
}

function openOperatoreModal(u) {
  const isNew = !u;
  u = u || { nome:'', email:'', account_id:null, attivo:true, esterno:false, note:'' };
  const accountsLiberi = Object.values(state.profiliById)
    .filter(p => !isKioskRecord(p))
    .filter(p => !state.utenti.find(x => x.account_id === p.id && x.id !== u.id));

  const modal = el('div', { class:'modal' });
  modal.append(el('div', { class:'mhd' },
    el('h2', {}, isNew ? 'Nuovo Utente' : 'Modifica Utente'),
    el('button', { class:'mclose', onclick:closeModal }, '✕'),
  ));
  const body = el('div', { class:'mbody' });
  const form = el('form');

  const selAccount = el('select', { name:'account_id' },
    el('option', { value:'' }, '— nessuno —'),
    ...accountsLiberi.map(p => el('option', { value:p.id }, `${p.nome} (${p.email})`)),
  );
  if (u.account_id) selAccount.value = u.account_id;

  // Tipo: "esterno" NON vuol dire più terzista-che-lavora-fuori (quel ruolo è
  // del fornitore sulla commessa, dal 14 lug), ma persona di un'altra ditta
  // che lavora IN SEDE e timbra al kiosk. Da qui in poi il flag serve a tenere
  // le sue ore riconoscibili, non a nasconderla.
  const selTipo = el('select', { name:'esterno' },
    el('option', { value:'false' }, 'Interno (Cablotec)'),
    el('option', { value:'true' }, 'Esterno in sede (timbra qui)'));
  selTipo.value = String(!!u.esterno);

  // Ditta di provenienza: si accende solo a colonna presente (migrazione
  // utenti.azienda_id) e ha senso solo per gli esterni. Elenco dai fornitori
  // già in anagrafica: la stessa ditta è insieme fornitore (lavoro mandato
  // fuori) e datore di questa persona (lavoro fatto qui) — due rapporti veri.
  const aziendaAttiva = (state.utenti || []).some(x => x && ('azienda_id' in x));
  const selAzienda = el('select', { name:'azienda_id' },
    el('option', { value:'' }, '— non indicata —'),
    ...(state.aziende || [])
      .filter(a => a.attivo !== false && a.is_fornitore)
      .sort((a, b) => (a.nome || '').localeCompare(b.nome || ''))
      .map(a => el('option', { value:a.id }, a.nome)),
  );
  if (u.azienda_id) selAzienda.value = u.azienda_id;
  const campoAzienda = aziendaAttiva
    ? el('div', { class:'field', id:'campo-azienda',
        style: u.esterno ? '' : 'display:none;' },
        el('label', {}, 'Ditta di provenienza'),
        selAzienda,
        el('div', { class:'sub', style:'margin-top:4px;font-size:11px;' },
          'Serve a tenere le sue ore attribuibili alla ditta giusta nelle analisi. '
          + 'L\'elenco sono i fornitori in anagrafica.'))
    : null;
  // Il campo ditta ha senso solo per gli esterni: compare e sparisce col Tipo.
  selTipo.addEventListener('change', () => {
    if (campoAzienda) campoAzienda.style.display = selTipo.value === 'true' ? '' : 'none';
  });

  form.append(
    el('div', { class:'field' }, el('label', {}, 'Nome *'),
      el('input', { type:'text', name:'nome', required:'true', value:u.nome })),
    el('div', { class:'field' }, el('label', {}, 'Account login collegato (opz.)'),
      selAccount,
      el('div', { class:'sub', style:'margin-top:4px;' },
        'Collega questo utente a un account login Supabase, se ne ha uno. L\'account va prima creato dalla dashboard Supabase.')),
    el('div', { class:'field' }, el('label', {}, 'Note (opz.)'),
      el('textarea', { name:'note', rows:'2' }, u.note||'')),
    el('div', { class:'frow' },
      el('div', { class:'field' }, el('label', {}, 'Tipo'), selTipo,
        el('div', { class:'sub', style:'margin-top:4px;font-size:11px;' },
          'Esterno in sede = persona di un\'altra ditta che lavora QUI e timbra al kiosk. '
          + 'Il lavoro mandato fuori non si gestisce da qui: quello è un fornitore sulla commessa.')),
      el('div', { class:'field' }, el('label', {}, 'Stato'), (() => {
        const s = el('select', { name:'attivo' },
          el('option', { value:'true' }, 'Attivo'),
          el('option', { value:'false' }, 'Disattivato'));
        s.value = String(!!u.attivo); return s;
      })()),
    ),
    campoAzienda,
  );
  body.append(form);
  modal.append(body);
  modal.append(el('div', { class:'mfoot' },
    el('button', { class:'btng', onclick:closeModal }, 'Annulla'),
    el('button', { class:'btnp', onclick: async () => {
      const fd = new FormData(form);
      const payload = {
        nome: (fd.get('nome')||'').trim(),
        account_id: fd.get('account_id') || null,
        note: (fd.get('note')||'').trim() || null,
        attivo: fd.get('attivo') === 'true',
        esterno: fd.get('esterno') === 'true',
      };
      // Ditta solo per gli esterni: se torna interno il legame si azzera, così
      // non restano riferimenti orfani a una ditta che non c'entra più.
      if (aziendaAttiva) {
        payload.azienda_id = payload.esterno ? (fd.get('azienda_id') || null) : null;
      }
      if (!payload.nome) return toast('Nome obbligatorio', 'err');
      const { data, error } = await eseguiConRetry(
        () => isNew ? sb.from('utenti').insert(payload).select().single() : sb.from('utenti').update(payload).eq('id', u.id).select().single(),
        { label: 'salvataggio utenti' }
      );
      if (error) {
        if (error.message.includes('account_uniq')) return toast('Account già collegato a un altro utente', 'err');
        return toast(error.message, 'err');
      }
      // Aggiorna cache locale
      if (isNew) state.utenti.push(data);
      else state.utenti = state.utenti.map(x => x.id === u.id ? data : x);
      state.utentiById[data.id] = data;
      toast(isNew ? 'Utente creato' : 'Utente aggiornato');
      closeModal(); renderTab('operatori');
    }}, 'Salva'),
  ));
  openModal(modal);
}

// ═══════════════════════════════════════════════════════════
// CLIENTI — anagrafica, CRUD, import Excel
// ═══════════════════════════════════════════════════════════

function renderAziende(root) {
  const isAdmin = state.profile?.ruolo === 'admin';
  const search = (state.azSearch || '').toLowerCase();
  const filter = state.azFilter || 'attivi';
  const ruoloFilter = state.azRuoloFilter || 'tutti';

  let list = state.aziende;
  if (filter === 'attivi')    list = list.filter(c => c.attivo);
  else if (filter === 'disattivi') list = list.filter(c => !c.attivo);
  // Filtro ruolo
  if (ruoloFilter === 'cliente')   list = list.filter(c => c.is_cliente && !c.is_fornitore);
  else if (ruoloFilter === 'fornitore') list = list.filter(c => c.is_fornitore && !c.is_cliente);
  else if (ruoloFilter === 'entrambi')  list = list.filter(c => c.is_cliente && c.is_fornitore);
  if (search) {
    list = list.filter(c =>
      (c.nome||'').toLowerCase().includes(search) ||
      (c.citta||'').toLowerCase().includes(search) ||
      (c.via||'').toLowerCase().includes(search) ||
      (c.p_iva||'').toLowerCase().includes(search)
    );
  }
  list = list.slice().sort((a,b) => (a.nome||'').localeCompare(b.nome||''));

  // KPI
  const tot = state.aziende.length;
  const attivi = state.aziende.filter(c => c.attivo).length;
  const clienti = state.aziende.filter(c => c.is_cliente).length;
  const fornitori = state.aziende.filter(c => c.is_fornitore).length;

  root.innerHTML = '';
  root.append(el('div', { class:'kpis' },
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Totale'), el('div', { class:'kv ka' }, String(tot))),
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Attivi'), el('div', { class:'kv kg' }, String(attivi))),
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Clienti'), el('div', { class:'kv' }, String(clienti))),
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Fornitori'), el('div', { class:'kv' }, String(fornitori))),
  ));

  // Chips filtro stato (attivi / tutti / disattivi)
  const chipsStato = el('div', { class:'chips' });
  [
    { id:'all',       label:'Tutti' },
    { id:'attivi',    label:'Attivi' },
    { id:'disattivi', label:'Disattivati' },
  ].forEach(opt => {
    chipsStato.append(el('div', {
      class: 'chip' + (filter === opt.id ? ' act' : ''),
      onclick: () => { state.azFilter = opt.id; renderTab('aziende'); }
    }, opt.label));
  });
  root.append(chipsStato);

  // Chips filtro ruolo (tutti / cliente / fornitore / entrambi)
  const chipsRuolo = el('div', { class:'chips', style:'margin-top:6px;' });
  [
    { id:'tutti',     label:'Tutti i ruoli' },
    { id:'cliente',   label:'Solo clienti' },
    { id:'fornitore', label:'Solo fornitori' },
    { id:'entrambi',  label:'Solo entrambi (C+F)' },
  ].forEach(opt => {
    chipsRuolo.append(el('div', {
      class: 'chip' + (ruoloFilter === opt.id ? ' act' : ''),
      onclick: () => { state.azRuoloFilter = opt.id; renderTab('aziende'); }
    }, opt.label));
  });
  root.append(chipsRuolo);

  // Toolbar
  const toolbar = el('div', { class:'toolbar' },
    el('h2', {}, 'Aziende'),
    el('input', {
      type:'text', class:'search', id:'cli-search',
      placeholder:'Cerca per nome, indirizzo, città, P.IVA…',
      value: state.azSearch || '',
      oninput: (e) => { state.azSearch = e.target.value; state._focusSearch = 'cli-search'; renderTab('aziende'); }
    }),
  );
  if (isAdmin) {
    toolbar.append(
      el('label', { class:'btng', style:'position:relative;cursor:pointer;' },
        '⬆ Importa Excel',
        el('input', {
          type:'file', accept:'.xlsx,.xls',
          style:'position:absolute;inset:0;opacity:0;cursor:pointer;',
          onchange: (e) => clientiImportExcel(e.target.files[0]),
        }),
      ),
      el('button', { class:'btng', onclick:aziendeExportExcel }, '⬇ Esporta Excel'),
      el('button', { class:'btnp', onclick:()=>openClienteModal() }, '+ Nuova Azienda'),
    );
  }
  root.append(toolbar);

  if (list.length === 0) {
    root.append(el('div', { class:'empty' },
      state.aziende.length === 0
        ? 'Nessuna azienda. Importa un Excel o creane una nuova.'
        : 'Nessuna azienda corrisponde ai filtri.'
    ));
    return;
  }

  // Tabella
  const tw = el('div', { class:'tw' });
  const tbl = el('table', { class:'rt' });
  tbl.append(el('thead', {}, el('tr', {},
    el('th', {}, 'Nome'),
    el('th', { class:'tc' }, 'Ruolo'),
    el('th', { class:'tr' }, 'Coeff.'),
    el('th', {}, 'Città'),
    el('th', {}, 'P. IVA'),
    el('th', {}, 'Email'),
    el('th', { class:'tc' }, 'Stato'),
    el('th', { class:'tc' }, 'Azioni'),
  )));
  const tb = el('tbody');
  list.forEach(c => {
    // Badge ruolo
    let ruoloBadge;
    if (c.is_cliente && c.is_fornitore) {
      ruoloBadge = el('span', { class:'badge', style:'background:rgba(132,73,200,.18);color:var(--vio);border:1px solid rgba(132,73,200,.4);' }, 'C + F');
    } else if (c.is_cliente) {
      ruoloBadge = el('span', { class:'badge bblu' }, 'Cliente');
    } else if (c.is_fornitore) {
      ruoloBadge = el('span', { class:'badge', style:'background:rgba(212,140,40,.18);color:var(--yel);border:1px solid rgba(212,140,40,.4);' }, 'Fornitore');
    } else {
      ruoloBadge = el('span', { class:'badge bgry' }, '—');
    }
    tb.append(el('tr', {},
      el('td', {}, c.nome || '—'),
      el('td', { class:'tc' }, ruoloBadge),
      el('td', { class:'tr mono', style:'font-size:11px;' },
        c.is_fornitore ? Number(c.coefficiente || 1.0).toFixed(2) : '—'),
      el('td', { style:'font-size:11px;' }, c.citta ? c.citta + (c.provincia ? ' ('+c.provincia+')' : '') : ''),
      el('td', { class:'mono', style:'font-size:11px;' }, c.p_iva || ''),
      el('td', { class:'mono', style:'font-size:11px;' }, c.email || ''),
      el('td', { class:'tc' }, c.attivo
        ? el('span', { class:'badge bok' }, 'attivo')
        : el('span', { class:'badge bgry' }, 'disatt.')),
      el('td', { class:'tc' },
        isAdmin
          ? el('span', {},
              el('button', { class:'btnsm', onclick:()=>openClienteModal(c) }, 'Modifica'),
              ' ',
              el('button', { class:'btnd', onclick:()=>deleteCliente(c) }, 'Elimina'),
            )
          : el('button', { class:'btnsm', onclick:()=>openClienteModal(c) }, 'Vedi')
      ),
    ));
  });
  tbl.append(tb);
  tw.append(tbl);
  root.append(tw);
}

function openClienteModal(c) {
  const isNew = !c;
  const isAdmin = state.profile?.ruolo === 'admin';
  c = c || {
    nome:'', via:'', citta:'', cap:'', provincia:'',
    p_iva:'', email:'', note:'', attivo:true,
    is_cliente:true, is_fornitore:false, coefficiente:1.0,
  };
  const readonly = !isAdmin;

  const modal = el('div', { class:'modal' });
  modal.append(el('div', { class:'mhd' },
    el('h2', {}, isNew ? 'Nuova Azienda' : (readonly ? 'Azienda' : 'Modifica Azienda')),
    el('button', { class:'mclose', onclick:closeModal }, '✕'),
  ));

  const body = el('div', { class:'mbody' });
  const form = el('form');

  const inNome = el('input', { type:'text', name:'nome', value:c.nome||'', required:'true' });
  const inVia = el('input', { type:'text', name:'via', value:c.via||'', placeholder:'es. Via Roma 15' });
  const inCitta = el('input', { type:'text', name:'citta', value:c.citta||'', placeholder:'es. Milano' });
  const inCap = el('input', { type:'text', name:'cap', value:c.cap||'', placeholder:'20100', maxlength:'5' });
  const inProvincia = el('input', { type:'text', name:'provincia', value:c.provincia||'', placeholder:'MI', maxlength:'2', style:'text-transform:uppercase;' });
  const inPIva = el('input', { type:'text', name:'p_iva', value:c.p_iva||'' });
  const inEmail = el('input', { type:'email', name:'email', value:c.email||'' });
  const inNote = el('textarea', { name:'note', rows:'2' }, c.note || '');
  const selAttivo = el('select', { name:'attivo' },
    el('option', { value:'true' }, 'Attivo'),
    el('option', { value:'false' }, 'Disattivato'));
  selAttivo.value = String(!!c.attivo);

  // Ruoli (checkbox)
  const chkCliente = el('input', { type:'checkbox', name:'is_cliente' });
  chkCliente.checked = !!c.is_cliente;
  const chkFornitore = el('input', { type:'checkbox', name:'is_fornitore' });
  chkFornitore.checked = !!c.is_fornitore;

  // Coefficiente (visibile solo se fornitore)
  const inCoeff = el('input', {
    type:'number', name:'coefficiente', step:'0.05', min:'0', max:'10',
    value: String(c.coefficiente != null ? c.coefficiente : 1.0),
    style:'width:100px;',
  });
  const coeffRow = el('div', { class:'field' },
    el('label', {}, 'Coefficiente fornitore'),
    el('div', { style:'display:flex;align-items:center;gap:10px;' },
      inCoeff,
      el('span', { style:'font-size:11px;color:var(--mut);' },
        'capacità relativa rispetto a 1 operatore interno (1.0 = uguale)'),
    ),
  );
  // Tariffa oraria fornitore (€/h): base del prezzo fase suggerito nel modal
  // commessa (ore fase × tariffa). Colonna nuova su aziende: finché la
  // migrazione non è eseguita il campo resta spento e il salvataggio non la
  // tocca (stesso pattern di gruppo_id). Rilevo la colonna dalle righe caricate.
  const tariffaDisponibile = (state.aziende || []).some(a => a && ('tariffa_oraria' in a));
  const inTariffa = el('input', {
    type:'number', name:'tariffa_oraria', step:'0.5', min:'0',
    value: c.tariffa_oraria != null ? String(c.tariffa_oraria) : '',
    placeholder:'es. 25', style:'width:100px;',
  });
  if (!tariffaDisponibile) inTariffa.disabled = true;
  const tariffaRow = el('div', { class:'field' },
    el('label', {}, 'Tariffa oraria (€/h)'),
    el('div', { style:'display:flex;align-items:center;gap:10px;' },
      inTariffa,
      el('span', { style:'font-size:11px;color:var(--mut);' },
        tariffaDisponibile
          ? 'per il prezzo fase suggerito nelle commesse: ore fase × tariffa (vuoto = niente suggerimento)'
          : 'richiede la colonna aziende.tariffa_oraria (migrazione dal pannello Supabase)'),
    ),
  );
  // Tariffa cliente (€/h): REGOLA per i clienti a manodopera pura (es.
  // Elcotec, 27,3 €/h). Se valorizzata, nei NUOVI ordini il tempo pagato
  // esce dal prezzo riga: min/pz = prezzo ÷ tariffa × 60. La regola vive
  // QUI come dato d'anagrafica, mai hardcode nel codice. Stesso pattern
  // inerte: campo spento finché la colonna non esiste.
  const tariffaCliDisponibile = (state.aziende || []).some(a => a && ('tariffa_cliente' in a));
  const inTariffaCli = el('input', {
    type:'number', name:'tariffa_cliente', step:'0.1', min:'0',
    value: c.tariffa_cliente != null ? String(c.tariffa_cliente) : '',
    placeholder:'es. 27,3', style:'width:100px;',
  });
  if (!tariffaCliDisponibile) inTariffaCli.disabled = true;
  const tariffaCliRow = el('div', { class:'field' },
    el('label', {}, 'Tariffa cliente (€/h) — prezzo solo manodopera'),
    el('div', { style:'display:flex;align-items:center;gap:10px;' },
      inTariffaCli,
      el('span', { style:'font-size:11px;color:var(--mut);' },
        tariffaCliDisponibile
          ? 'REGOLA: nei nuovi ordini il tempo pagato si calcola dal prezzo riga (prezzo ÷ tariffa). Vuoto = nessuna regola.'
          : 'richiede la colonna aziende.tariffa_cliente (migrazione dal pannello Supabase)'),
    ),
  );
  // Visibilità dei campi legata ai checkbox ruolo
  const aggiornaCoeff = () => {
    coeffRow.style.display = chkFornitore.checked ? '' : 'none';
    tariffaRow.style.display = chkFornitore.checked ? '' : 'none';
    tariffaCliRow.style.display = chkCliente.checked ? '' : 'none';
  };
  aggiornaCoeff();
  chkFornitore.addEventListener('change', aggiornaCoeff);
  chkCliente.addEventListener('change', aggiornaCoeff);

  if (readonly) {
    [inNome, inVia, inCitta, inCap, inProvincia, inPIva, inEmail, inNote, selAttivo,
     chkCliente, chkFornitore, inCoeff, inTariffa, inTariffaCli]
      .forEach(i => i.disabled = true);
  }

  form.append(
    el('div', { class:'field' }, el('label', {}, 'Nome *'), inNome,
      el('div', { class:'sub', style:'margin-top:4px;' },
        'Es. "TEMA SINERGIE" — usato come identificativo veloce nelle operazioni e prenotazioni.')),
    el('div', { class:'sub', style:'margin:14px 0 6px;color:var(--mut);text-transform:uppercase;letter-spacing:.1em;font-size:11px;' },
      '── Ruolo (almeno uno) ──'),
    el('div', { class:'frow' },
      el('label', { style:'display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;padding:8px 12px;border:1px solid var(--brd);border-radius:4px;flex:1;' },
        chkCliente, 'Cliente'),
      el('label', { style:'display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;padding:8px 12px;border:1px solid var(--brd);border-radius:4px;flex:1;' },
        chkFornitore, 'Fornitore'),
    ),
    coeffRow,
    tariffaRow,
    tariffaCliRow,
    el('div', { class:'sub', style:'margin:14px 0 6px;color:var(--mut);text-transform:uppercase;letter-spacing:.1em;font-size:11px;' },
      '── Indirizzo ──'),
    el('div', { class:'field' }, el('label', {}, 'Via e civico'), inVia),
    el('div', { class:'frow' },
      el('div', { class:'field' }, el('label', {}, 'Città'), inCitta),
      el('div', { class:'field' }, el('label', {}, 'CAP'), inCap),
      el('div', { class:'field' }, el('label', {}, 'Prov.'), inProvincia),
    ),
    el('div', { class:'sub', style:'margin:14px 0 6px;color:var(--mut);text-transform:uppercase;letter-spacing:.1em;font-size:11px;' },
      '── Altri dati ──'),
    el('div', { class:'frow' },
      el('div', { class:'field' }, el('label', {}, 'P. IVA / C.F.'), inPIva),
      el('div', { class:'field' }, el('label', {}, 'Stato'), selAttivo),
    ),
    el('div', { class:'field' }, el('label', {}, 'Email'), inEmail),
    el('div', { class:'field' }, el('label', {}, 'Note'), inNote),
  );

  body.append(form);
  modal.append(body);

  const foot = el('div', { class:'mfoot' });
  foot.append(el('button', { class:'btng', onclick:closeModal }, 'Chiudi'));
  if (isAdmin) {
    const btnSave = el('button', { class:'btnp' }, 'Salva');
    btnSave.onclick = async () => {
      const fd = new FormData(form);
      const isCliente = chkCliente.checked;
      const isFornitore = chkFornitore.checked;
      // Validazione: almeno un ruolo
      if (!isCliente && !isFornitore) {
        return toast('Seleziona almeno un ruolo (Cliente o Fornitore)', 'err');
      }
      const coeff = Number(fd.get('coefficiente') || 1.0);
      if (isFornitore && (!Number.isFinite(coeff) || coeff < 0 || coeff > 10)) {
        return toast('Coefficiente deve essere tra 0 e 10', 'err');
      }
      const payload = {
        nome: (fd.get('nome')||'').trim(),
        via: (fd.get('via')||'').trim() || null,
        citta: (fd.get('citta')||'').trim() || null,
        cap: (fd.get('cap')||'').trim() || null,
        provincia: (fd.get('provincia')||'').trim().toUpperCase() || null,
        p_iva: (fd.get('p_iva')||'').trim() || null,
        email: (fd.get('email')||'').trim() || null,
        note: (fd.get('note')||'').trim() || null,
        attivo: fd.get('attivo') === 'true',
        is_cliente: isCliente,
        is_fornitore: isFornitore,
        coefficiente: isFornitore ? coeff : 1.0,
      };
      // tariffa_oraria solo se la colonna esiste (migrazione eseguita)
      if (tariffaDisponibile) {
        const trRaw = (fd.get('tariffa_oraria') || '').toString().trim();
        const trVal = trRaw === '' ? null : Number(trRaw.replace(',', '.'));
        if (trRaw !== '' && (!Number.isFinite(trVal) || trVal < 0)) {
          return toast('Tariffa oraria: valore non valido', 'err');
        }
        payload.tariffa_oraria = isFornitore ? trVal : null;
      }
      // tariffa_cliente idem (regola prezzo→tempo pagato sui nuovi ordini)
      if (tariffaCliDisponibile) {
        const tcRaw = (fd.get('tariffa_cliente') || '').toString().trim();
        const tcVal = tcRaw === '' ? null : Number(tcRaw.replace(',', '.'));
        if (tcRaw !== '' && (!Number.isFinite(tcVal) || tcVal <= 0)) {
          return toast('Tariffa cliente: valore non valido', 'err');
        }
        payload.tariffa_cliente = isCliente ? tcVal : null;
      }
      if (!payload.nome) return toast('Nome obbligatorio', 'err');
      btnSave.disabled = true;
      btnSave.textContent = 'Salvataggio…';
      try {
        const { data, error } = await eseguiConRetry(
        () => isNew ? sb.from('aziende').insert(payload).select().single() : sb.from('aziende').update(payload).eq('id', c.id).select().single(),
        { label: 'salvataggio aziende' }
      );
        if (error) {
          btnSave.disabled = false;
          btnSave.textContent = 'Salva';
          if (error.code === '23505') return toast('Nome azienda già esistente', 'err');
          return toast(error.message, 'err');
        }
        if (isNew) {
          if (!state.aziende.find(x => x.id === data.id)) state.aziende.push(data);
        } else {
          state.aziende = state.aziende.map(x => x.id === c.id ? data : x);
        }
        toast(isNew ? 'Azienda creata' : 'Azienda aggiornata');
        closeModal(); renderTab('aziende');
      } catch (e) {
        btnSave.disabled = false;
        btnSave.textContent = 'Salva';
        toast('Errore di rete: '+(e.message||e), 'err');
      }
    };
    foot.append(btnSave);
  }
  modal.append(foot);
  openModal(modal);
}

async function deleteCliente(c) {
  if (!confirm(`Eliminare l'azienda "${c.nome}"?\nNon sarà possibile se ha operazioni associate.`)) return;
  const { data, error } = await sb.from('aziende').delete().eq('id', c.id).select();
  if (error) {
    if (error.code === '23503') return toast('Impossibile: ci sono operazioni legate a questa azienda', 'err');
    return toast(error.message, 'err');
  }
  if (!data || data.length === 0) {
    return toast('Eliminazione bloccata: verifica le policy DELETE su aziende', 'err');
  }
  state.aziende = state.aziende.filter(x => x.id !== c.id);
  toast('Azienda eliminata'); renderTab('aziende');
}

// ─── Import Excel ───
async function clientiImportExcel(file) {
  if (!file) return;
  if (typeof XLSX === 'undefined') {
    toast('Libreria Excel non caricata, ricarica la pagina', 'err');
    return;
  }
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type:'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval:'', raw:false });
    if (!rows.length) { toast('File vuoto', 'err'); return; }
    openClientiImportPreviewModal(rows);
  } catch (e) {
    toast('Errore lettura file: '+(e.message||e), 'err');
  }
}

function openClientiImportPreviewModal(rows) {
  const headers = Object.keys(rows[0]);
  const findCol = (...candidati) => {
    for (const c of candidati) {
      const found = headers.find(h => h.toLowerCase().trim() === c.toLowerCase());
      if (found) return found;
    }
    return null;
  };
  const colNome = findCol('nome','cliente','name','customer');
  const colVia = findCol('via','indirizzo','address','street');
  const colCitta = findCol('citta','città','city','localita','località');
  const colCap = findCol('cap','zip','postal');
  const colProvincia = findCol('provincia','prov','pr','province');
  const colPIva = findCol('p.iva','p_iva','partita iva','partita_iva','piva','vat','codice fiscale','cf');
  const colEmail = findCol('email','e-mail','mail');
  const colNote = findCol('note','notes','annotazioni');

  const parsed = rows.map((r, idx) => ({
    _row: idx + 2,
    nome: (colNome ? r[colNome] : '').toString().trim(),
    via: colVia ? (r[colVia]||'').toString().trim() || null : null,
    citta: colCitta ? (r[colCitta]||'').toString().trim() || null : null,
    cap: colCap ? (r[colCap]||'').toString().trim() || null : null,
    provincia: colProvincia ? (r[colProvincia]||'').toString().trim().toUpperCase() || null : null,
    p_iva: colPIva ? (r[colPIva]||'').toString().trim() || null : null,
    email: colEmail ? (r[colEmail]||'').toString().trim() || null : null,
    note: colNote ? (r[colNote]||'').toString().trim() || null : null,
  }));

  const errors = [];
  const nomiVisti = new Set();
  parsed.forEach(p => {
    if (!p.nome) errors.push(`Riga ${p._row}: nome mancante`);
    else if (nomiVisti.has(p.nome.toLowerCase()))
      errors.push(`Riga ${p._row}: nome "${p.nome}" duplicato nel file`);
    else nomiVisti.add(p.nome.toLowerCase());
  });
  const validi = parsed.filter(p => p.nome);

  const nomiInDB = new Set(state.aziende.map(c => (c.nome||'').toLowerCase()));
  const nuovi = validi.filter(p => !nomiInDB.has(p.nome.toLowerCase()));
  const aggiornamenti = validi.filter(p => nomiInDB.has(p.nome.toLowerCase()));

  const modal = el('div', { class:'modal', style:'max-width:680px' });
  modal.append(el('div', { class:'mhd' },
    el('h2', {}, 'Anteprima import aziende'),
    el('button', { class:'mclose', onclick:closeModal }, '✕'),
  ));
  const body = el('div', { class:'mbody' });

  body.append(el('div', { class:'kpis' },
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Righe lette'), el('div', { class:'kv' }, String(rows.length))),
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Nuovi'), el('div', { class:'kv kg' }, String(nuovi.length))),
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Da aggiornare'), el('div', { class:'kv ky' }, String(aggiornamenti.length))),
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Errori'), el('div', { class:'kv kr' }, String(errors.length))),
  ));

  body.append(el('div', { class:'sub', style:'margin:16px 0 8px;' }, 'Mappatura colonne riconosciute:'));
  const mapBox = el('div', { style:'background:var(--sur2);border:1px solid var(--brd);border-radius:4px;padding:10px 12px;font-family:monospace;font-size:11px;line-height:1.8;' });
  [
    ['nome', colNome],
    ['via', colVia],
    ['citta', colCitta],
    ['cap', colCap],
    ['provincia', colProvincia],
    ['p_iva', colPIva],
    ['email', colEmail],
    ['note', colNote],
  ].forEach(([campo, col]) => {
    mapBox.append(el('div', {},
      el('span', { style:'color:var(--mut)' }, campo+': '),
      el('span', { style: col ? 'color:var(--grn)' : 'color:var(--mut)' },
        col ? `"${col}"` : '— non trovato —'),
    ));
  });
  body.append(mapBox);

  if (errors.length) {
    body.append(el('div', { class:'sub', style:'margin:14px 0 6px;color:var(--red);' }, 'Errori:'));
    const errBox = el('div', { style:'max-height:120px;overflow:auto;background:rgba(255,78,107,.08);border:1px solid var(--red);border-radius:4px;padding:10px;font-family:monospace;font-size:11px;' });
    errors.slice(0,20).forEach(e => errBox.append(el('div', {}, e)));
    if (errors.length > 20) errBox.append(el('div', { style:'color:var(--mut);margin-top:4px;' }, `... e altri ${errors.length-20}`));
    body.append(errBox);
  }

  if (validi.length) {
    body.append(el('div', { class:'sub', style:'margin:14px 0 6px;' }, `Anteprima (prime ${Math.min(5, validi.length)} righe valide):`));
    const tbl = el('table', { class:'rt', style:'font-size:11px;' });
    tbl.append(el('thead', {}, el('tr', {},
      el('th', {}, 'Nome'), el('th', {}, 'Via'), el('th', {}, 'Città'), el('th', {}, 'P.IVA'),
    )));
    const tb = el('tbody');
    validi.slice(0,5).forEach(p => tb.append(el('tr', {},
      el('td', {}, p.nome),
      el('td', {}, p.via || ''),
      el('td', {}, p.citta || (p.provincia ? '('+p.provincia+')' : '')),
      el('td', { class:'mono' }, p.p_iva || ''),
    )));
    tbl.append(tb);
    body.append(tbl);
  }

  modal.append(body);

  const foot = el('div', { class:'mfoot' });
  foot.append(el('button', { class:'btng', onclick:closeModal }, 'Annulla'));
  if (validi.length) {
    foot.append(el('button', {
      class:'btnp',
      onclick: () => aziendeImportEsegui(nuovi, aggiornamenti),
    }, `Importa ${validi.length} aziende`));
  }
  modal.append(foot);
  openModal(modal);
}

async function aziendeImportEsegui(nuovi, aggiornamenti) {
  closeModal();
  let okIns = 0, errIns = 0, okUpd = 0, errUpd = 0;

  if (nuovi.length) {
    const batch = nuovi.map(p => ({
      nome: p.nome, via: p.via, citta: p.citta, cap: p.cap, provincia: p.provincia,
      p_iva: p.p_iva, email: p.email, note: p.note,
    }));
    const { data, error } = await sb.from('aziende').insert(batch).select();
    if (error) {
      errIns = nuovi.length;
      toast('Errore insert: '+error.message, 'err');
    } else {
      okIns = data.length;
      data.forEach(d => {
        if (!state.aziende.find(x => x.id === d.id)) state.aziende.push(d);
      });
    }
  }

  for (const p of aggiornamenti) {
    const existing = state.aziende.find(c => (c.nome||'').toLowerCase() === p.nome.toLowerCase());
    if (!existing) { errUpd++; continue; }
    const { data, error } = await sb.from('aziende').update({
      via: p.via, citta: p.citta, cap: p.cap, provincia: p.provincia,
      p_iva: p.p_iva, email: p.email, note: p.note,
    }).eq('id', existing.id).select().single();
    if (error) errUpd++;
    else {
      okUpd++;
      state.aziende = state.aziende.map(x => x.id === existing.id ? data : x);
    }
  }

  toast(`Import completato: ${okIns} nuovi, ${okUpd} aggiornati${errIns||errUpd ? `, ${errIns+errUpd} errori` : ''}`,
        (errIns||errUpd) ? 'err' : 'ok');
  renderTab('aziende');
}

function aziendeExportExcel() {
  if (typeof XLSX === 'undefined') {
    toast('Libreria Excel non caricata', 'err');
    return;
  }
  const rows = state.aziende.map(c => ({
    nome: c.nome,
    via: c.via || '',
    citta: c.citta || '',
    cap: c.cap || '',
    provincia: c.provincia || '',
    p_iva: c.p_iva || '',
    email: c.email || '',
    note: c.note || '',
    attivo: c.attivo ? 'sì' : 'no',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{wch:24},{wch:30},{wch:20},{wch:8},{wch:8},{wch:14},{wch:24},{wch:30},{wch:8}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Clienti');
  XLSX.writeFile(wb, 'clienti_'+new Date().toISOString().substring(0,10)+'.xlsx');
}


// ═══════════════════════════════════════════════════════════
// ARTICOLI — anagrafica codici prodotto, CRUD, import Excel
// ═══════════════════════════════════════════════════════════
function renderArticoli(root) {
  const isAdmin = state.profile?.ruolo === 'admin';
  const search = (state.artSearch || '').toLowerCase();
  const filter = state.artFilter || 'attivi';

  let list = state.articoli;
  if (filter === 'attivi')    list = list.filter(a => a.attivo);
  else if (filter === 'disattivi') list = list.filter(a => !a.attivo);
  if (search) {
    list = list.filter(a =>
      (a.codice||'').toLowerCase().includes(search) ||
      (a.descrizione||'').toLowerCase().includes(search) ||
      (a.categoria||'').toLowerCase().includes(search)
    );
  }
  list = list.slice().sort((a,b) => (a.codice||'').localeCompare(b.codice||''));

  const tot = state.articoli.length;
  const attivi = state.articoli.filter(a => a.attivo).length;

  root.innerHTML = '';
  root.append(el('div', { class:'kpis' },
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Totale'), el('div', { class:'kv ka' }, String(tot))),
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Attivi'), el('div', { class:'kv kg' }, String(attivi))),
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Disattivati'), el('div', { class:'kv' }, String(tot - attivi))),
  ));

  const chips = el('div', { class:'chips' });
  [
    { id:'all',       label:'Tutti' },
    { id:'attivi',    label:'Attivi' },
    { id:'disattivi', label:'Disattivati' },
  ].forEach(opt => {
    chips.append(el('div', {
      class: 'chip' + (filter === opt.id ? ' act' : ''),
      onclick: () => { state.artFilter = opt.id; renderTab('articoli'); }
    }, opt.label));
  });
  root.append(chips);

  const toolbar = el('div', { class:'toolbar' },
    el('h2', {}, 'Articoli'),
    el('input', {
      type:'text', class:'search', id:'art-search',
      placeholder:'Cerca per codice, descrizione, categoria…',
      value: state.artSearch || '',
      oninput: (e) => { state.artSearch = e.target.value; state._focusSearch = 'art-search'; renderTab('articoli'); }
    }),
  );
  if (isAdmin) {
    toolbar.append(
      el('label', { class:'btng', style:'position:relative;cursor:pointer;' },
        '⬆ Importa Excel',
        el('input', {
          type:'file', accept:'.xlsx,.xls',
          style:'position:absolute;inset:0;opacity:0;cursor:pointer;',
          onchange: (e) => articoliImportExcel(e.target.files[0]),
        }),
      ),
      el('button', { class:'btng', onclick:articoliExportExcel }, '⬇ Esporta Excel'),
      el('button', { class:'btnp', onclick:()=>openArticoloModal() }, '+ Nuovo Articolo'),
    );
  }
  root.append(toolbar);

  if (list.length === 0) {
    root.append(el('div', { class:'empty' },
      state.articoli.length === 0
        ? 'Nessun articolo. Importa un Excel o creane uno nuovo.'
        : 'Nessun articolo corrisponde ai filtri.'
    ));
    return;
  }

  const tw = el('div', { class:'tw' });
  const tbl = el('table', { class:'rt' });
  tbl.append(el('thead', {}, el('tr', {},
    el('th', {}, 'Codice'),
    el('th', {}, 'Descrizione'),
    el('th', {}, 'Categoria'),
    el('th', { class:'tr' }, 'Min/pz'),
    el('th', {}, 'Note'),
    el('th', { class:'tc' }, 'Stato'),
  )));
  const tb = el('tbody');
  // Niente colonna Azioni: click sulla riga apre la scheda (modifica per
  // l'admin, sola lettura per gli altri). L'eliminazione vive nella scheda.
  list.forEach(a => {
    const minutiVal = (a.minuti_unitari != null && a.minuti_unitari !== '')
      ? Number(a.minuti_unitari) : null;
    tb.append(el('tr', { style:'cursor:pointer;', onclick:()=>openArticoloModal(a) },
      el('td', { class:'cod-cell' }, a.codice || '—'),
      el('td', {}, a.descrizione || ''),
      el('td', { style:'color:var(--mut);font-size:11px;' }, a.categoria || ''),
      // Minuti unitari: vuoto in rosso pallido (da compilare), altrimenti verde
      minutiVal != null
        ? el('td', { class:'tr mono', style:'font-size:11px;color:var(--grn);font-weight:600;' },
            minutiVal + " min")
        : el('td', { class:'tr mono', style:'font-size:11px;color:var(--mut);font-style:italic;' },
            '— da definire'),
      el('td', { style:'max-width:280px;font-size:11px;color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' }, a.note || ''),
      el('td', { class:'tc' }, a.attivo
        ? el('span', { class:'badge bok' }, 'attivo')
        : el('span', { class:'badge bgry' }, 'disatt.')),
    ));
  });
  tbl.append(tb);
  tw.append(tbl);
  root.append(tw);
}

// ═══ GESTIONE → CODIFICA ARTICOLI (20 caratteri) ═══
// Compositore guidato: 5 (classificazione, da domain/codifica.js) + 4 (sigla
// produttore, tabella `produttori` — inerte se la migrazione manca: input
// libero) + 11 (codice del produttore, zeri PRIMA). I codici generati per ora
// sono a sé stanti (materiali interni/acquisto), NON legati all'anagrafica
// articoli, che contiene solo prodotti finiti Cablotec.
// Ore esterne DICHIARATE (rapportini dei fornitori). Tabella `ore_esterne`:
// inerte se la migrazione manca — la sezione mostra solo le ore timbrate e
// dichiara che l'inserimento a mano non è attivo. Caricata una volta e tenuta
// in state.oreEsterne, che è la fonte letta dal domain.
// Materiale mancante dal fabbisogno importato. Tabella `mancanti`: inerte se
// la migrazione manca (nessuna sezione, nessun badge, nessun errore).
let mancantiTabellaOk = null;
async function caricaMancanti() {
  if (mancantiTabellaOk === false) return;
  try {
    const { data, error } = await fetchTutte(() =>
      sb.from('mancanti').select('*').order('numero_op').order('codice'));
    if (error) { mancantiTabellaOk = false; state.mancanti = []; return; }
    mancantiTabellaOk = true;
    state.mancanti = data || [];
  } catch (e) { mancantiTabellaOk = false; state.mancanti = []; }
}

let oreEsterneTabellaOk = null;  // null = da scoprire; false = migrazione mancante
async function caricaOreEsterne() {
  if (oreEsterneTabellaOk === false) return;
  try {
    const { data, error } = await fetchTutte(() =>
      sb.from('ore_esterne').select('*').order('data', { ascending:false }).order('id'));
    if (error) { oreEsterneTabellaOk = false; state.oreEsterne = []; return; }
    oreEsterneTabellaOk = true;
    state.oreEsterne = data || [];
  } catch (e) { oreEsterneTabellaOk = false; state.oreEsterne = []; }
}

let produttoriCache = null;      // null = mai caricati; [] = tabella vuota
let produttoriTabellaOk = null;  // null = da scoprire; false = migrazione mancante
async function caricaProduttori() {
  if (produttoriTabellaOk === false) return;
  try {
    const { data, error } = await sb.from('produttori').select('*').order('sigla');
    if (error) { produttoriTabellaOk = false; return; }
    produttoriTabellaOk = true;
    produttoriCache = data || [];
  } catch (e) { produttoriTabellaOk = false; }
}

// ═══ GESTIONE → FABBISOGNO (import materiale mancante) ═══
// L'estrazione "Fabbisogno Massivo" è una FOTOGRAFIA: ogni import sostituisce
// il precedente, altrimenti dopo tre estrazioni si vedrebbero come mancanti
// codici già arrivati. La data dell'estrazione resta scritta e visibile.
// La libreria che legge l'xlsx si carica SOLO qui, alla prima apertura della
// scheda: è ~1 MB e non deve pesare sull'avvio di tutto il gestionale.
const XLSX_CDN = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
let xlsxPromise = null;
function caricaXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxPromise) return xlsxPromise;
  xlsxPromise = new Promise((risolvi, rifiuta) => {
    const s = document.createElement('script');
    s.src = XLSX_CDN;
    s.onload = () => window.XLSX ? risolvi(window.XLSX) : rifiuta(new Error('libreria caricata ma non disponibile'));
    s.onerror = () => { xlsxPromise = null; rifiuta(new Error('impossibile scaricare la libreria (serve connessione)')); };
    document.head.appendChild(s);
  });
  return xlsxPromise;
}

// Colonne attese nell'estrazione. Cerco per NOME, non per posizione: se domani
// il gestionale di magazzino sposta una colonna, l'import continua a funzionare.
const FABB_COLONNE = {
  codice:      ['Codice'],
  descrizione: ['Descrizione Articolo', 'Descrizione'],
  qtaDaOrd:    ['Qta da ord', 'Qta da ordinare'],
  qtaRich:     ['Qta richiesta'],
  giacenza:    ['Giacenza'],
  impegno:     ['Impegno'],
  odl:         ['OdL Prossimo Impegno'],
  um:          ['Um Interna', 'UM'],
  // Dal 27 ago: ACQ lo compriamo noi, C/L arriva dal cliente, MAC e
  // materiale di consumo. Senza questa colonna tutto finiva nello stesso
  // rosso "da ordinare" — 222 righe su 287 a sproposito.
  tipoParte:   ['Tipo Parte', 'Tipo parte'],
};
// Le 5 previsioni di entrata: la prima ha nomi suoi, le altre sono numerate.
// Sono la METÀ UTILE del file — le uniche righe con una data (31 lug: 47 righe
// su 364, e sono tutte quelle già ordinate). Prima venivano scartate.
const FABB_CONSEGNE = [
  { qta:'Qta Prossima Previsione Entrata', data:'Data Prossima Previsione Entrata',
    ordine:'Orf Prossima Previsione Entrata', fornitore:'Ragione Sociale' },
  { qta:'Qta Previsione Entrata 2', data:'Data Previsione Entrata 2',
    ordine:'Orf Previsione Entrata 2', fornitore:'Ragione Sociale 2' },
  { qta:'Qta Previsione Entrata 3', data:'Data Previsione Entrata 3',
    ordine:'Orf Previsione Entrata 3', fornitore:'Ragione Sociale 3' },
  { qta:'Qta Previsione Entrata 4', data:'Data Previsione Entrata 4',
    ordine:'Orf Previsione Entrata 4', fornitore:'Ragione Sociale 4' },
  { qta:'Qta Previsione Entrata 5', data:'Data Previsione Entrata 5',
    ordine:'Orf Previsione Entrata 5', fornitore:'Ragione Sociale 5' },
];
// Una data dal foglio: Date vero, seriale Excel, gg/mm/aaaa (CSV italiano) o
// testo ISO. Il CSV esporta le date all'italiana, l'xlsx come seriale: qui si
// accettano entrambi, così il formato del file non detta il codice.
function fabbData(v) {
  if (v instanceof Date) return toLocalISO(v);
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  const it = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (it) return it[3] + '-' + it[2].padStart(2, '0') + '-' + it[1].padStart(2, '0');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const n = Number(s.replace(',', '.'));
  // Seriale Excel (giorni dal 30/12/1899). Sotto 1000 è spazzatura, non una data.
  if (Number.isFinite(n) && n > 1000) {
    return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
  }
  return null;
}
// Un numero all'italiana: "20,00" → 20 ; "1.234,56" → 1234.56. Il punto si
// toglie solo quando fa da separatore di migliaia, mai quando è il decimale
// (l'xlsx dà "20.5", il CSV dà "20,5": vanno letti tutti e due).
function fabbNumero(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v == null ? '' : v).trim();
  if (!s) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '');
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
// Testo di un file, indovinando la codifica: prima UTF-8; se compaiono
// caratteri di sostituzione (le "à" rotte) si rilegge in Windows-1252, che è
// quello che sputa fuori l'export in CSV. Così vanno bene entrambi.
function fabbDecodifica(buf) {
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (!utf8.includes('�')) return utf8;
  try { return new TextDecoder('windows-1252').decode(buf); } catch (e) { return utf8; }
}
// CSV → righe come oggetti {intestazione: valore}, la stessa forma che
// produce il lettore xlsx: da lì in poi il codice è uno solo.
// Separatore indovinato sull'intestazione (il nostro export usa ';').
// Gestisce le virgolette e i campi che contengono il separatore.
function fabbLeggiCsv(testo) {
  const t = testo.replace(/^﻿/, '');
  const primaRiga = (t.split(/\r?\n/)[0] || '');
  const sep = [';', '\t', ','].reduce((best, s) =>
    (primaRiga.split(s).length > primaRiga.split(best).length ? s : best), ';');
  const righe = [];
  let campo = '', riga = [], inVirg = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inVirg) {
      if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else inVirg = false; }
      else campo += c;
    } else if (c === '"') inVirg = true;
    else if (c === sep) { riga.push(campo); campo = ''; }
    else if (c === '\n') { riga.push(campo); righe.push(riga); riga = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo !== '' || riga.length) { riga.push(campo); righe.push(riga); }
  if (!righe.length) return [];
  const intest = righe[0].map(x => String(x).trim());
  return righe.slice(1)
    .filter(r => r.some(x => String(x).trim() !== ''))
    .map(r => { const o = {}; intest.forEach((k, i) => { o[k] = r[i] == null ? '' : r[i]; }); return o; });
}
// Da riga-foglio a riga-mancante. Si tiene TUTTO ciò che è sotto scorta
// (giacenza < impegno) o ancora da ordinare — non solo il da ordinare: le
// righe già ordinate sono le uniche che hanno una data di consegna, e senza
// di loro "quando arriva" non esisterebbe. Ritorna null se non manca niente.
function fabbRigaNormalizza(r, mappa) {
  const val = (k) => { const c = mappa[k]; return c == null ? '' : r[c]; };
  const numDi = fabbNumero;
  const num = (k) => numDi(val(k));
  const codice = String(val('codice') || '').trim();
  if (!codice) return null;
  const daOrd = num('qtaDaOrd') || 0;
  const giac = num('giacenza');
  const imp = num('impegno');
  const scoperto = (giac != null && imp != null) ? (giac - imp) : null;
  // Sotto scorta OPPURE da ordinare. Se non manca niente, la riga non serve.
  if (!(daOrd > 0) && !(scoperto != null && scoperto < 0)) return null;
  // Consegne previste: fino a 5, si tengono solo quelle con una data.
  const consegne = [];
  FABB_CONSEGNE.forEach(c => {
    const col = (nome) => {
      const k = Object.keys(r).find(i => String(i).trim().toLowerCase() === nome.toLowerCase());
      return k ? r[k] : '';
    };
    const data = fabbData(col(c.data));
    if (!data) return;
    consegne.push({
      data, qta: numDi(col(c.qta)),
      ordine: String(col(c.ordine) || '').trim() || null,
      fornitore: String(col(c.fornitore) || '').trim() || null,
    });
  });
  consegne.sort((a, b) => a.data.localeCompare(b.data));
  return {
    numero_op: odlANumeroOp(val('odl')),
    odlGrezzo: String(val('odl') || '').trim(),
    codice,
    descrizione: String(val('descrizione') || '').trim() || null,
    qta_da_ordinare: daOrd,
    qta_richiesta: num('qtaRich'),
    giacenza: giac,
    impegno: imp,
    um: String(val('um') || '').trim() || null,
    tipo_parte: String(val('tipoParte') || '').trim().toUpperCase() || null,
    consegne,
    prima_consegna: consegne.length ? consegne[0].data : null,
    // Retro-compatibili con le colonne già esistenti
    data_arrivo: consegne.length ? consegne[0].data : null,
    fornitore: consegne.length ? consegne[0].fornitore : null,
  };
}

// Filtro attivo sulla scheda Mancanti, impostato dal triangolo nella lista
// Ordini cliente: si arriva già sulla commessa che interessa.
let mancantiFiltroOp = null;
function apriMancantiFiltrati(numeroOp) {
  mancantiFiltroOp = numeroOp || null;
  renderTab('fabbisogno');
}

function renderFabbisogno(root) {
  root.innerHTML = '';
  root.append(el('div', { class:'toolbar' }, el('h2', {}, 'Materiale mancante')));
  root.append(el('div', { class:'sub', style:'margin:-4px 0 14px;max-width:900px;' },
    'Tutto ciò che è sotto scorta secondo l\'ultima estrazione del magazzino. '
    + 'DA ORDINARE = nessuno l\'ha ancora comprato: ferma la commessa e non ha una data. '
    + 'IN ARRIVO = già ordinato, con la consegna prevista. '
    + 'Ogni import sostituisce il precedente: è una fotografia, non uno storico.'));

  if (mancantiTabellaOk === false) {
    root.append(el('div', { class:'empty' },
      'Manca la tabella `mancanti` (migrazione dal pannello Supabase). Import non attivo.'));
    return;
  }

  const righeOra = state.mancanti || [];
  // La scheda la LEGGONO tutti (decisione Nico, 5 ago): serve in reparto per
  // sapere se il materiale c'è. L'import invece SOSTITUISCE l'intero archivio
  // — è l'unica azione distruttiva della scheda e resta agli admin.
  const isAdmin = state.profile?.ruolo === 'admin';
  const nf = (n) => n == null ? '—' : Number(n).toLocaleString('it-IT', { maximumFractionDigits: 2 });
  const dataOra = righeOra.reduce((d, m) => (!d || String(m.import_data || '') > d) ? (m.import_data || d) : d, null);

  // ── Stato attuale ──
  const opOra = new Set(righeOra.map(m => m.numero_op).filter(Boolean));
  const nBlocc = righeOra.filter(mancanteBloccante).length;
  const nCli = righeOra.filter(mancanteAttesaCliente).length;
  const nCons = righeOra.filter(m => mancanteCategoria(m) === 'consumo').length;
  const box = el('div', { style:'background:var(--sur2);border:1px solid var(--brd);border-radius:6px;padding:12px 14px;margin-bottom:14px;' });
  box.append(el('div', { style:'font-weight:700;margin-bottom:4px;' }, 'In archivio adesso'),
    el('div', { class:'sub' }, righeOra.length
      ? righeOra.length + ' codici sotto scorta su ' + opOra.size + (opOra.size === 1 ? ' commessa' : ' commesse')
        // Quattro numeri, non due: mescolarli faceva sembrare "da ordinare"
        // anche il conto lavoro, che è la voce più numerosa dell'estrazione.
        + ' · ' + nBlocc + ' da ordinare'
        + (nCli ? ', ' + nCli + ' in attesa dal cliente' : '')
        + ', ' + (righeOra.length - nBlocc - nCli - nCons) + ' in arrivo'
        + (nCons ? ', ' + nCons + ' di consumo' : '')
        + (dataOra ? ' · estrazione del ' + fmtIT(String(dataOra).slice(0, 10)) : '')
      : 'Nessuna estrazione importata.'));
  root.append(box);

  // ── Prossime consegne e ritardi ──
  if (righeOra.length && typeof consegnePreviste === 'function') {
    const { prossime, scadute } = consegnePreviste(toLocalISO(new Date()));
    const rigaCons = (c, inRitardo) => el('div', {
      style:'display:flex;align-items:center;gap:10px;font-family:JetBrains Mono,monospace;font-size:11px;padding:3px 0;border-bottom:1px solid var(--brd);' },
      el('span', { style:'width:78px;flex-shrink:0;font-weight:700;color:' + (inRitardo ? 'var(--red)' : 'var(--txt)') + ';' },
        fmtIT(c.data)),
      el('span', { style:'width:66px;text-align:right;flex-shrink:0;' }, nf(c.qta)),
      el('span', { style:'width:170px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' }, c.codice),
      el('span', { style:'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--mut);' },
        c.descrizione || '—'),
      // Numero dell'ordine fornitore: serve per andarlo a cercare o sollecitare.
      el('span', { style:'width:104px;flex-shrink:0;', title: c.ordine ? 'Ordine fornitore ' + c.ordine : '' },
        c.ordine || '—'),
      el('span', { style:'width:120px;flex-shrink:0;color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' },
        c.fornitore || '—'),
      el('span', { style:'width:120px;flex-shrink:0;' }, c.numero_op || '—'),
    );
    if (scadute.length) {
      const b = el('div', { style:'background:var(--sur2);border:1px solid var(--red);border-radius:6px;padding:12px 14px;margin-bottom:12px;' });
      b.append(el('div', { style:'font-weight:700;color:var(--red);margin-bottom:6px;' },
        '⚠ ' + scadute.length + (scadute.length === 1 ? ' consegna in ritardo' : ' consegne in ritardo')),
        el('div', { class:'sub', style:'margin-bottom:6px;font-size:11px;' },
          'Erano attese prima di oggi e non risultano arrivate. Dalla più vecchia.'));
      // TUTTE e per intero, senza riquadro che scorre (richiesta Nico): un
      // ritardo va visto tutto d'un colpo, non cercato dentro una finestrella.
      // Scorre la pagina, che è il posto giusto dove scorrere.
      scadute.forEach(c => b.append(rigaCons(c, true)));
      root.append(b);
    }
    if (prossime.length) {
      const b = el('div', { style:'background:var(--sur2);border:1px solid var(--brd);border-radius:6px;padding:12px 14px;margin-bottom:14px;' });
      let apertaTutte = false;
      // Niente scorrimento interno neanche qui: quando apri "vedi tutte" le
      // vuoi leggere di seguito, non dentro una finestrella.
      const listaP = el('div');
      const disegnaP = () => {
        listaP.innerHTML = '';
        (apertaTutte ? prossime : prossime.slice(0, 5)).forEach(c => listaP.append(rigaCons(c, false)));
      };
      disegnaP();
      b.append(el('div', { style:'font-weight:700;margin-bottom:6px;' }, 'Prossime consegne'),
        el('div', { class:'sub', style:'margin-bottom:6px;font-size:11px;' },
          prossime.length + ' previste in totale, dalla più vicina.'),
        listaP);
      if (prossime.length > 5) {
        const btn = el('button', { class:'btnsm', style:'margin-top:8px;', onclick: () => {
          apertaTutte = !apertaTutte; disegnaP();
          btn.textContent = apertaTutte ? 'Mostra solo le prossime 5' : 'Vedi tutte le ' + prossime.length;
        } }, 'Vedi tutte le ' + prossime.length);
        b.append(btn);
      }
      root.append(b);
    }
  }

  const inFile = el('input', { type:'file', accept:'.csv,.xlsx,.xls,.txt', style:'max-width:340px;' });
  // Il nome del file scelto va scritto DENTRO il quadrato: il selettore di
  // sistema è nascosto, quindi non lo dice più nessun altro.
  const nomeScelto = el('div', { class:'sub',
    style:'font-size:11px;margin-top:6px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' });
  const stato = el('div', { class:'sub', style:'margin-top:10px;' });
  const anteprima = el('div', { style:'margin-top:12px;' });
  let daImportare = null;

  // UNA sola strada per l'analisi: la chiamano sia il selettore sia il
  // trascinamento. Se restassero due copie, i bug si correggerebbero una volta
  // sola su due.
  const analizzaFile = async (f) => {
    anteprima.innerHTML = ''; daImportare = null;
    if (!f) return;
    nomeScelto.textContent = '📄 ' + f.name;
    nomeScelto.title = f.name;
    // Il trascinamento NON rispetta l'attributo accept del selettore: qui il
    // formato va controllato a mano, o un .pdf finirebbe dentro il lettore xlsx
    // e uscirebbe un errore che non dice niente.
    if (!/\.(csv|txt|xlsx|xls)$/i.test(f.name)) {
      stato.textContent = '';
      anteprima.append(el('div', { class:'sub', style:'color:var(--red);' },
        'Formato non gestito: ' + f.name + ' — serve un .csv o un .xlsx.'));
      return;
    }
    stato.textContent = 'Leggo il file…';
    try {
      const buf = await f.arrayBuffer();
      const isCsv = /\.(csv|txt)$/i.test(f.name);
      // Il CSV si legge da sé: niente libreria da scaricare, niente attesa.
      // L'xlsx la richiede, e solo in quel caso.
      let fogli;
      if (isCsv) {
        fogli = [fabbLeggiCsv(fabbDecodifica(buf))];
      } else {
        const XLSX = await caricaXLSX();
        const wb = XLSX.read(buf, { cellDates: true });
        fogli = wb.SheetNames.map(n => XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' }));
      }
      // Il foglio giusto è quello che contiene la colonna Codice: non mi fido
      // del nome, che potrebbe cambiare.
      let righe = null, mappa = null;
      for (const js of fogli) {
        if (!js.length) continue;
        const intest = Object.keys(js[0]);
        const m = {};
        for (const k in FABB_COLONNE) {
          const trovata = FABB_COLONNE[k].find(nomeCol =>
            intest.some(i => String(i).trim().toLowerCase() === nomeCol.toLowerCase()));
          if (trovata) m[k] = intest.find(i => String(i).trim().toLowerCase() === trovata.toLowerCase());
        }
        if (m.codice && m.qtaDaOrd) { righe = js; mappa = m; break; }
      }
      if (!righe) throw new Error('nessun foglio con le colonne "Codice" e "Qta da ord"');
      const mancanti = righe.map(r => fabbRigaNormalizza(r, mappa)).filter(Boolean);
      if (!mancanti.length) throw new Error('nessuna riga con "Qta da ord" maggiore di zero');
      // Aggancio: quali OP esistono davvero fra le commesse
      const opNote = new Set((state.operazioni || []).map(o => o.numero_op).filter(Boolean));
      const agganciate = new Set(), orfane = new Set(), senzaOdl = [];
      mancanti.forEach(m => {
        if (!m.numero_op) { senzaOdl.push(m); return; }
        (opNote.has(m.numero_op) ? agganciate : orfane).add(m.numero_op);
      });
      // La colonna `tipo_parte` esiste a database? Si riconosce dalle righe
      // già caricate, come si fa per `aziende.tariffa_oraria`. Se manca, si
      // importa lo stesso SENZA quel campo: un import che si rompe del tutto
      // per una colonna nuova sarebbe molto peggio del non avere la
      // distinzione ACQ / conto lavoro / consumo.
      const tipoSalvabile = (state.mancanti || []).some(m => m && ('tipo_parte' in m));
      const perTipo = {};
      mancanti.forEach(m => {
        const k = m.tipo_parte || '(nessuno)';
        perTipo[k] = (perTipo[k] || 0) + 1;
      });
      const tipiNelFile = Object.keys(perTipo).filter(k => k !== '(nessuno)');
      const NOTI = { 'ACQ':'da comprare', 'C/L':'dal cliente', 'MAC':'consumo' };
      const sconosciuti = tipiNelFile.filter(k => !NOTI[k]);
      daImportare = { mancanti, nomeFile: f.name, tipoSalvabile };
      stato.textContent = '';
      anteprima.append(
        el('div', { style:'font-weight:700;margin-bottom:6px;' }, 'Anteprima di ' + f.name),
        el('div', { class:'sub' },
          mancanti.length + ' codici mancanti (righe con "Qta da ord" > 0) · '
          + agganciate.size + (agganciate.size === 1 ? ' commessa agganciata' : ' commesse agganciate')
          + (orfane.size ? ' · ' + orfane.size + ' OP senza commessa nel gestionale' : '')
          + (senzaOdl.length ? ' · ' + senzaOdl.length + ' righe senza OdL (verranno scartate)' : '')),
        ...(orfane.size
          ? [el('div', { class:'sub', style:'margin-top:6px;color:var(--yel);font-size:11px;' },
              '⚠ OP presenti nell\'estrazione ma non nel gestionale: ' + [...orfane].join(', ')
              + ' — le righe si salvano lo stesso e si agganceranno da sole se quelle commesse verranno inserite.')]
          : []),
        // Cosa dice la colonna "Tipo Parte", e se si riesce a salvarla.
        ...(tipiNelFile.length
          ? [el('div', { class:'sub', style:'margin-top:6px;font-size:11px;' },
              'Tipo parte: ' + tipiNelFile.sort()
                .map(k => perTipo[k] + ' ' + k + (NOTI[k] ? ' (' + NOTI[k] + ')' : ''))
                .join(' · ')
              + (perTipo['(nessuno)'] ? ' · ' + perTipo['(nessuno)'] + ' senza tipo' : ''))]
          : []),
        ...(sconosciuti.length
          ? [el('div', { class:'sub', style:'margin-top:4px;color:var(--yel);font-size:11px;' },
              '⚠ Tipo parte mai visto prima: ' + sconosciuti.join(', ')
              + ' — queste righe verranno trattate come "da ordinare". Se non è giusto, dimmelo.')]
          : []),
        ...(tipiNelFile.length && !tipoSalvabile
          ? [el('div', { class:'sub', style:'margin-top:4px;color:var(--yel);font-size:11px;' },
              '⚠ La colonna `mancanti.tipo_parte` non esiste ancora a database: l\'import '
              + 'funziona lo stesso, ma la distinzione fra da comprare, conto lavoro e consumo '
              + 'non viene salvata e tutto resta "da ordinare" come prima. '
              + 'Serve la migrazione dal pannello Supabase.')]
          : []),
        el('div', { class:'sub', style:'margin-top:6px;color:var(--yel);font-size:11px;' },
          '⚠ Confermando, i ' + righeOra.length + ' codici attualmente in archivio vengono sostituiti da questi.'),
        el('button', { class:'btnp', style:'margin-top:10px;', onclick: async (e) => {
          e.target.disabled = true; e.target.textContent = 'Importo…';
          try {
            const conTipo = daImportare.tipoSalvabile;
            const payload = daImportare.mancanti.filter(m => m.numero_op).map(m => ({
              numero_op: m.numero_op, codice: m.codice, descrizione: m.descrizione,
              qta_da_ordinare: m.qta_da_ordinare, qta_richiesta: m.qta_richiesta,
              giacenza: m.giacenza, impegno: m.impegno, um: m.um,
              consegne: m.consegne, prima_consegna: m.prima_consegna,
              data_arrivo: m.data_arrivo, fornitore: m.fornitore,
              import_data: toLocalISO(new Date()),
              // Solo se la colonna c'e': altrimenti PostgREST rifiuta
              // l'intero blocco per un campo che non conosce.
              ...(conTipo ? { tipo_parte: m.tipo_parte } : {}),
            }));
            // SOSTITUZIONE: prima si svuota, poi si inserisce. Se l'insert
            // fallisse a metà lo si vede subito dal conteggio in archivio.
            const { error: errDel } = await eseguiConRetry(
              () => sb.from('mancanti').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
              { label: 'pulizia fabbisogno' });
            if (errDel) throw new Error(errDel.message);
            for (let i = 0; i < payload.length; i += 500) {
              const { error } = await eseguiConRetry(
                () => sb.from('mancanti').insert(payload.slice(i, i + 500)),
                { label: 'import fabbisogno' });
              if (error) throw new Error(error.message);
            }
            await caricaMancanti();
            toast('Fabbisogno importato: ' + payload.length + ' codici', 'ok');
            renderFabbisogno(root);
          } catch (err) {
            toast('Errore import: ' + (err.message || err), 'err');
            e.target.disabled = false; e.target.textContent = 'Conferma e sostituisci';
          }
        } }, 'Conferma e sostituisci'),
      );
    } catch (err) {
      stato.textContent = '';
      anteprima.append(el('div', { class:'sub', style:'color:var(--red);' },
        'Non riesco a leggere il file: ' + (err.message || err)));
    }
  };
  inFile.onchange = () => analizzaFile(inFile.files && inFile.files[0]);

  // ── Riquadro di rilascio: un QUADRATO, non una riga ───────────────────
  // Un bordo tratteggiato attorno a un campo file non si legge come "qui puoi
  // trascinare": ci vuole un'area grande, vuota e riconoscibile.
  // Senza preventDefault su dragover il browser APRE il file e la pagina se ne
  // va: è il default, non un dettaglio.
  const DZ_BASE = 'width:220px;height:220px;flex-shrink:0;box-sizing:border-box;'
    + 'display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;'
    + 'gap:6px;padding:16px;border-radius:10px;cursor:pointer;user-select:none;'
    + 'transition:border-color .15s,background .15s;';
  const DZ_OFF = DZ_BASE + 'border:2px dashed var(--brd);background:transparent;';
  const DZ_ON  = DZ_BASE + 'border:2px dashed var(--acc);background:var(--sur2);';
  const dz = el('div', { style: DZ_OFF, tabindex:'0', role:'button',
    title:'Trascina qui il file dell\'estrazione, oppure fai clic per sceglierlo' });
  // dragleave scatta anche solo passando da un figlio all'altro: senza contare
  // la profondità l'evidenziazione lampeggerebbe.
  let dzProf = 0;
  const dzEvidenzia = (attiva) => { dz.style.cssText = attiva ? DZ_ON : DZ_OFF; };
  dz.addEventListener('dragenter', (e) => { e.preventDefault(); dzProf++; dzEvidenzia(true); });
  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  dz.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (--dzProf <= 0) { dzProf = 0; dzEvidenzia(false); }
  });
  dz.addEventListener('drop', (e) => {
    e.preventDefault(); dzProf = 0; dzEvidenzia(false);
    const dt = e.dataTransfer;
    const f = dt && dt.files && dt.files[0];
    if (!f) return;
    // Il file trascinato finisce anche dentro il selettore: è da lì che si
    // rilegge se serve, ed è la stessa strada delle due.
    try { inFile.files = dt.files; } catch (_) {}
    analizzaFile(f);
  });
  // Il quadrato è anche il bottone per scegliere il file: il selettore di
  // sistema resta nascosto dentro, così l'area è una sola cosa e non due.
  inFile.style.display = 'none';
  // Il click programmatico sull'input BOLLE fino al quadrato: senza questa
  // guardia il gestore richiamerebbe se stesso all'infinito.
  dz.addEventListener('click', (e) => { if (e.target !== inFile) inFile.click(); });
  dz.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inFile.click(); }
  });
  dz.append(
    el('div', { style:'font-size:34px;line-height:1;' }, '⬇'),
    el('div', { style:'font-weight:700;' }, 'Trascina qui il file'),
    el('div', { class:'sub', style:'font-size:11px;' }, '.csv o .xlsx'),
    el('div', { class:'sub', style:'font-size:11px;margin-top:4px;text-decoration:underline dotted;' },
      'oppure fai clic per sceglierlo'),
    inFile, nomeScelto);
  const dzRiga = el('div', { class:'field', style:'display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;' },
    dz,
    el('div', { style:'flex:1;min-width:240px;' },
      el('label', {}, 'Estrazione Fabbisogno Massivo'),
      el('div', { class:'sub', style:'font-size:11px;' },
        'Il CSV si legge subito; l\'xlsx richiede il download di una libreria alla prima apertura. '
        + 'Separatore, virgole decimali, date gg/mm/aaaa e accenti Windows sono gestiti da soli.'),
      stato));
  if (isAdmin) {
    root.append(dzRiga);
    root.append(anteprima);
    // Rete di sicurezza: se il file cade FUORI dal riquadro, il browser lo
    // aprirebbe buttando via la pagina. Registrata una volta sola sul documento
    // (renderFabbisogno viene richiamata a ogni import).
    if (!window.__dropGuard) {
      window.__dropGuard = true;
      document.addEventListener('dragover', (e) => { e.preventDefault(); });
      document.addEventListener('drop', (e) => { e.preventDefault(); });
    }
  } else {
    // Chi non importa deve comunque sapere chi tiene aggiornato l'elenco:
    // la data dell'estrazione è già dichiarata nel riquadro qui sopra.
    root.append(el('div', { class:'sub', style:'margin-bottom:14px;font-size:11px;' },
      'L\'elenco lo aggiorna un amministratore importando l\'estrazione del magazzino.'));
  }

  // ── Elenco completo, filtrabile ──────────────────────────────────────
  if (!righeOra.length) return;
  const opDelGest = new Map();
  (state.operazioni || []).forEach(o => { if (o.numero_op) opDelGest.set(o.numero_op, o); });
  const opConMancanti = [...new Set(righeOra.map(m => m.numero_op))].filter(Boolean).sort();

  const selOp = el('select', { style:'max-width:280px;' },
    el('option', { value:'' }, 'Tutte le commesse (' + righeOra.length + ' codici)'),
    ...opConMancanti.map(op => {
      const o = opDelGest.get(op);
      const n = righeOra.filter(m => m.numero_op === op).length;
      return el('option', { value: op },
        op + (o ? ' — ' + (o.numero_ordine || '') + '/' + (o.pos || '') : ' — (nessuna commessa)')
        + ' · ' + n + (n === 1 ? ' codice' : ' codici'));
    }));
  if (mancantiFiltroOp) selOp.value = mancantiFiltroOp;
  const selTipo = el('select', { style:'max-width:220px;' },
    el('option', { value:'' }, 'Tutti'),
    el('option', { value:'blocc' }, 'Solo da ordinare (tocca a noi)'),
    el('option', { value:'cliente' }, 'Solo in attesa dal cliente'),
    el('option', { value:'arrivo' }, 'Solo in arrivo'),
    el('option', { value:'consumo' }, 'Solo materiale di consumo'));
  const tabWrap = el('div');

  const renderTab2 = () => {
    tabWrap.innerHTML = '';
    let righe = righeOra.slice();
    if (selOp.value) righe = righe.filter(m => m.numero_op === selOp.value);
    // Le categorie arrivano dal domain: qui non si ridecide cos'è cosa.
    if (selTipo.value === 'blocc')   righe = righe.filter(mancanteBloccante);
    if (selTipo.value === 'cliente') righe = righe.filter(mancanteAttesaCliente);
    if (selTipo.value === 'arrivo')  righe = righe.filter(m => mancanteCategoria(m) === 'in_arrivo');
    if (selTipo.value === 'consumo') righe = righe.filter(m => mancanteCategoria(m) === 'consumo');
    // Bloccanti in cima, poi per data di consegna, poi per codice.
    righe.sort((a, b) => (mancanteBloccante(b) ? 1 : 0) - (mancanteBloccante(a) ? 1 : 0)
      || String(a.prima_consegna || '9999').localeCompare(String(b.prima_consegna || '9999'))
      || String(a.codice || '').localeCompare(String(b.codice || '')));
    if (!righe.length) { tabWrap.append(el('div', { class:'empty' }, 'Nessun codice con questi filtri.')); return; }
    const tb = el('tbody');
    const oggi = toLocalISO(new Date());
    righe.forEach(m => {
      const blocc = mancanteBloccante(m);
      const categoria = mancanteCategoria(m);
      // Quattro categorie, quattro etichette. Prima erano due: una riga di
      // conto lavoro finiva sotto "in arrivo", che è proprio il contrario —
      // nessuno l'ha ordinata perché non si ordina, si aspetta il cliente.
      const ETI = {
        da_ordinare:    { txt:'da ordinare',   cls:'byel',
          tip:'Nessuno l\'ha ancora ordinato: tocca a noi comprarlo' },
        attesa_cliente: { txt:'attesa cliente', cls:'bor',
          tip:'Conto lavoro: non si ordina, lo manda il cliente' },
        in_arrivo:      { txt:'in arrivo',     cls:'bblu',
          tip:'Già ordinato: manca ma è in arrivo' },
        consumo:        { txt:'consumo',       cls:'bgry',
          tip:'Materiale di consumo: non ferma la commessa' },
      };
      const eti = ETI[categoria] || ETI.da_ordinare;
      const cons = mancanteConsegne(m);
      const prima = cons[0];
      const inRitardo = prima && prima.data < oggi;
      const o = opDelGest.get(m.numero_op);
      tb.append(el('tr', {},
        el('td', {}, el('span', { class: 'badge ' + eti.cls, title: eti.tip }, eti.txt)),
        el('td', { style:'font-family:JetBrains Mono,monospace;font-size:11px;' }, m.codice),
        el('td', {}, m.descrizione || '—'),
        el('td', { class:'tr', style:'font-family:JetBrains Mono,monospace;' },
          // Anche per il conto lavoro la quantità che interessa è quella che
          // manca (`qta_da_ordinare`): cambia chi la deve procurare, non il
          // numero. Il ripiego giacenza−impegno resta per le righe già coperte.
          nf((blocc || categoria === 'attesa_cliente')
            ? m.qta_da_ordinare
            : Math.abs((Number(m.giacenza) || 0) - (Number(m.impegno) || 0)))
          + (m.um ? ' ' + m.um : '')),
        el('td', { class:'tr', style:'font-family:JetBrains Mono,monospace;color:var(--mut);' }, nf(m.giacenza)),
        // Una riga per consegna, numerate: con più previsioni di entrata
        // "06/08 +1" nascondeva proprio il dato che serve.
        el('td', { style:'font-family:JetBrains Mono,monospace;font-size:11px;' },
          ...(cons.length
            ? cons.map((c, i) => el('div', {
                style:'white-space:nowrap;color:' + (c.data < oggi ? 'var(--red)' : 'var(--txt)') + ';' },
                (cons.length > 1 ? (i + 1) + 'ª ' : '') + fmtIT(c.data)
                + (c.qta != null ? ' · ' + nf(c.qta) : '')
                + (c.data < oggi ? ' ⚠' : '')))
            : [el('span', { style:'color:var(--mut);' }, '—')])),
        // Ordine fornitore in chiaro, una riga per consegna: allineato alla
        // colonna Consegne, così si legge "questa data ← quest'ordine".
        el('td', { style:'font-family:JetBrains Mono,monospace;font-size:11px;' },
          ...(cons.length
            ? cons.map(c => el('div', { style:'white-space:nowrap;' }, c.ordine || '—'))
            : [el('span', { style:'color:var(--mut);' }, '—')])),
        el('td', { style:'font-size:11px;color:var(--mut);' },
          ...(cons.length
            ? cons.map(c => el('div', { style:'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px;',
                title: c.fornitore || '' }, c.fornitore || '—'))
            : [el('span', {}, '—')])),
        el('td', { style:'font-family:JetBrains Mono,monospace;font-size:11px;' },
          o ? el('a', { href:'#', style:'color:var(--blu);',
                onclick:(e)=>{ e.preventDefault(); openOperazioneModal(o); } },
              (o.numero_ordine || '—') + '/' + (o.pos || '—'))
            : el('span', { style:'color:var(--mut);', title:'Questo OP non ha una commessa nel gestionale' },
                m.numero_op + ' (assente)')),
        // Elimina: correzione manuale (es. "questo è arrivato stamattina").
        // Dura fino al prossimo import: l'estrazione resta la fonte di verità.
        el('td', { class:'tc' }, el('button', { class:'btnd', style:'padding:1px 7px;',
          title:'Togli questa riga dall\'elenco. Torna al prossimo import se il magazzino la segnala ancora.',
          onclick: async (e) => {
            e.stopPropagation();
            if (!confirm('Togliere ' + m.codice + ' dall\'elenco mancanti?\n\n'
              + 'È una correzione manuale: se la prossima estrazione lo segnala ancora, ricompare.')) return;
            const { error } = await eseguiConRetry(
              () => sb.from('mancanti').delete().eq('id', m.id), { label: 'elimina mancante' });
            if (error) return toast(error.message, 'err');
            state.mancanti = state.mancanti.filter(x => x.id !== m.id);
            toast('Riga tolta dall\'elenco');
            renderFabbisogno(root);
          } }, '✕')),
      ));
    });
    tabWrap.append(el('div', { class:'sub', style:'margin-bottom:6px;' },
      righe.length + (righe.length === 1 ? ' codice' : ' codici')),
      el('table', { class:'tbl' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'Stato'), el('th', {}, 'Codice'), el('th', {}, 'Descrizione'),
          el('th', { class:'tr' }, 'Manca'), el('th', { class:'tr' }, 'Giacenza'),
          el('th', {}, 'Consegne'), el('th', {}, 'Ordine forn.'), el('th', {}, 'Fornitore'),
          el('th', {}, 'Commessa'), el('th', { class:'tc' }, ''))),
        tb));
  };
  selOp.onchange = () => { mancantiFiltroOp = selOp.value || null; renderTab2(); };
  selTipo.onchange = renderTab2;
  root.append(el('div', { style:'display:flex;gap:8px;align-items:center;margin:18px 0 8px;flex-wrap:wrap;' },
    el('span', { class:'sub' }, 'Filtra:'), selOp, selTipo,
    mancantiFiltroOp ? el('button', { class:'btnsm',
      onclick:()=>{ mancantiFiltroOp = null; selOp.value = ''; renderTab2(); } }, 'Mostra tutte') : null));
  root.append(tabWrap);
  renderTab2();
}

function renderCodifica(root) {
  root.innerHTML = '';
  root.append(el('div', { class:'toolbar' }, el('h2', {}, 'Codifica articoli')));
  root.append(el('div', { class:'sub', style:'margin:-4px 0 14px;max-width:900px;' },
    'Codice a 20 caratteri: 5 di classificazione (piano dei conti + tabelle) '
    + '+ 4 di produttore + 11 di codice produttore (zeri di riempimento davanti). '
    + 'Le voci con ✎ vengono dagli appunti a mano sui fogli.'));

  // Stato locale della composizione
  let gruppoIdx = -1, voceIdx = -1;
  let tabVals = [];        // un carattere scelto per ogni tabella della voce
  let liberoVal = '';      // 4 caratteri liberi (gruppi senza schema 2+2)
  let produttoreVal = '', codiceVal = '';

  const box = el('div', { style:'max-width:820px;display:flex;flex-direction:column;gap:2px;' });
  const wrapVoce = el('div');
  const wrapTabs = el('div');
  const wrapNote = el('div');
  const wrapProd = el('div');
  const wrapEsito = el('div', { style:'margin-top:14px;' });

  const gruppo = () => PIANO_CODIFICA[gruppoIdx] || null;
  const voce = () => (gruppo() && !gruppo().libero) ? (gruppo().voci[voceIdx] || null) : null;

  function blocco5() {
    const g = gruppo();
    if (!g) return '';
    if (g.libero) return g.fam + liberoVal.toUpperCase();
    const v = voce();
    if (!v) return g.fam;
    return g.fam + v.cat + (v.c || '') + tabVals.join('') + (v.fisso || '');
  }

  // ── Select gruppo ──
  const selGruppo = el('select', {},
    el('option', { value:'' }, '— scegli il gruppo —'),
    ...PIANO_CODIFICA.map((g, i) => el('option', { value:String(i) }, g.fam + ' · ' + g.nome)));
  selGruppo.onchange = () => {
    gruppoIdx = selGruppo.value === '' ? -1 : Number(selGruppo.value);
    voceIdx = -1; tabVals = []; liberoVal = '';
    renderVoce(); renderTabs(); renderNote(); aggiornaEsito();
  };

  function renderVoce() {
    wrapVoce.innerHTML = '';
    const g = gruppo();
    if (!g) return;
    if (g.libero) {
      const inp = el('input', { type:'text', maxlength:'4', placeholder:'4 caratteri',
        style:'max-width:140px;text-transform:uppercase;font-family:JetBrains Mono,monospace;' });
      inp.oninput = () => { liberoVal = (inp.value || '').toUpperCase(); aggiornaEsito(); };
      wrapVoce.append(el('div', { class:'field' },
        el('label', {}, 'Caratteri dopo la famiglia (schema libero)'), inp));
      return;
    }
    const sel = el('select', {},
      el('option', { value:'' }, '— scegli la voce —'),
      ...g.voci.map((v, i) => el('option', { value:String(i) },
        v.cat + (v.c || '') + (v.tabs.length ? '·' : '') + ' — ' + v.label)));
    sel.onchange = () => {
      voceIdx = sel.value === '' ? -1 : Number(sel.value);
      tabVals = voce() ? voce().tabs.map(() => '') : [];
      renderTabs(); aggiornaEsito();
    };
    wrapVoce.append(el('div', { class:'field' }, el('label', {}, 'Voce'), sel));
  }

  function renderTabs() {
    wrapTabs.innerHTML = '';
    const v = voce();
    if (!v) return;
    v.tabs.forEach((tNum, i) => {
      const tab = TABELLE_CODIFICA[tNum];
      const sel = el('select', {},
        el('option', { value:'' }, '— scegli —'),
        ...Object.entries(tab.voci).map(([ch, label]) =>
          el('option', { value:ch }, ch + ' — ' + label)));
      sel.onchange = () => { tabVals[i] = sel.value; aggiornaEsito(); };
      wrapTabs.append(el('div', { class:'field' },
        el('label', {}, 'TAB.' + tNum + ' — ' + tab.nome), sel));
    });
  }

  function renderNote() {
    wrapNote.innerHTML = '';
    const g = gruppo();
    if (g && g.note) {
      // Erano avvisi gialli col ⚠ perché c'erano ambiguità aperte sui fogli di
      // Matteo. Chiuse il 7 ago ("considera ok"): restano note di trascrizione
      // — dicono cosa c'era scritto a mano e cosa è stato lasciato fuori, e
      // servono a capire una voce, non a segnalare un problema.
      wrapNote.append(el('div', { class:'sub', style:'margin:4px 0 8px;' }, '✎ ' + g.note));
    }
  }

  // ── Produttore: anagrafica se la tabella esiste, input libero altrimenti ──
  function renderProduttore() {
    wrapProd.innerHTML = '';
    const field = el('div', { class:'field' }, el('label', {}, 'Produttore (4 caratteri)'));
    if (produttoriTabellaOk === true) {
      const sel = el('select', { style:'max-width:320px;' },
        el('option', { value:'' }, '— scegli il produttore —'),
        ...(produttoriCache || []).map(p =>
          el('option', { value:p.sigla }, p.sigla + (p.nome ? ' — ' + p.nome : ''))));
      sel.value = produttoreVal;
      sel.onchange = () => { produttoreVal = sel.value; aggiornaEsito(); };
      // Mini-anagrafica inline: aggiungi (sigla+nome) / elimina il selezionato
      const inSigla = el('input', { type:'text', maxlength:'4', placeholder:'SIGL',
        style:'width:70px;text-transform:uppercase;font-family:JetBrains Mono,monospace;' });
      const inNome = el('input', { type:'text', placeholder:'nome produttore', style:'width:180px;' });
      // Sigle corte: riempite con ZERI IN FONDO (decisione Nico, 28 lug).
      // TDK → TDK0. La quarta casella esiste sempre perché il codice ha
      // posizioni fisse; lo zero non si confonde con una lettera del marchio
      // e non richiede una scelta marchio per marchio. I marchi PIÙ LUNGHI di
      // 4 si abbreviano a mano: nessun taglio automatico (PHOE o PHCO per
      // Phoenix Contact è buon senso, non una regola).
      const siglaNormalizzata = () =>
        (inSigla.value || '').toUpperCase().replace(/\s+/g, '').padEnd(4, '0');
      const notaSigla = el('div', { class:'sub', style:'margin-top:4px;font-size:11px;min-height:13px;' });
      const aggiornaNotaSigla = () => {
        const grezza = (inSigla.value || '').toUpperCase().replace(/\s+/g, '');
        notaSigla.textContent = (grezza.length > 0 && grezza.length < 4)
          ? 'Verrà salvata come ' + siglaNormalizzata() + ' (riempita con zeri: la sigla occupa sempre 4 caselle).'
          : '';
      };
      inSigla.oninput = aggiornaNotaSigla;
      const btnAdd = el('button', { type:'button', class:'btnsm', onclick: async () => {
        const grezza = (inSigla.value || '').toUpperCase().replace(/\s+/g, '');
        const nome = (inNome.value || '').trim();
        if (!grezza) return toast('Sigla: scrivi almeno un carattere', 'err');
        if (grezza.length > 4) return toast('Sigla: massimo 4 caratteri — abbrevia il marchio a mano', 'err');
        if (!/^[A-Z0-9]+$/.test(grezza)) return toast('Sigla: solo lettere e numeri', 'err');
        const sigla = siglaNormalizzata();
        const { data, error } = await sb.from('produttori')
          .insert({ sigla, nome: nome || null }).select().single();
        if (error) return toast(error.code === '23505' ? 'Sigla già esistente' : error.message, 'err');
        produttoriCache.push(data);
        produttoriCache.sort((a, b) => (a.sigla || '').localeCompare(b.sigla || ''));
        produttoreVal = sigla; inSigla.value = ''; inNome.value = '';
        toast('Produttore aggiunto: ' + sigla);
        renderProduttore(); aggiornaEsito();
      } }, '+ Aggiungi');
      const btnDel = el('button', { type:'button', class:'btnd', onclick: async () => {
        if (!produttoreVal) return toast('Seleziona prima un produttore', 'err');
        if (!confirm('Eliminare il produttore ' + produttoreVal + ' dall\'anagrafica?')) return;
        const p = (produttoriCache || []).find(x => x.sigla === produttoreVal);
        if (!p) return;
        const { error } = await sb.from('produttori').delete().eq('id', p.id);
        if (error) return toast(error.message, 'err');
        produttoriCache = produttoriCache.filter(x => x.id !== p.id);
        produttoreVal = '';
        toast('Produttore eliminato');
        renderProduttore(); aggiornaEsito();
      } }, '✕');
      field.append(sel,
        el('div', { style:'display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap;' },
          inSigla, inNome, btnAdd, btnDel),
        notaSigla,
        el('div', { class:'sub', style:'margin-top:4px;' },
          'Sigla fissa a 4 caselle. Marchio più corto (TDK, ABB) → riempito con zeri in fondo: TDK0. '
          + 'Marchio più lungo → abbrevialo tu a 4. Per il multi-marca usa una sigla neutra (es. 0000).'));
    } else {
      const inp = el('input', { type:'text', maxlength:'4', placeholder:'es. TELE',
        style:'max-width:140px;text-transform:uppercase;font-family:JetBrains Mono,monospace;' });
      inp.value = produttoreVal;
      // Stessa regola dell'anagrafica: sigla corta riempita con zeri in fondo,
      // ma solo quando l'utente ha finito di scrivere (su ogni tasto darebbe
      // fastidio: digitando "T" diventerebbe subito "T000").
      const notaLibera = el('div', { class:'sub', style:'margin-top:2px;font-size:11px;min-height:13px;' });
      inp.oninput = () => {
        produttoreVal = (inp.value || '').toUpperCase();
        const g = produttoreVal.replace(/\s+/g, '');
        notaLibera.textContent = (g.length > 0 && g.length < 4)
          ? 'Diventerà ' + g.padEnd(4, '0') + ' quando esci dal campo.'
          : '';
        aggiornaEsito();
      };
      inp.onblur = () => {
        const g = (inp.value || '').toUpperCase().replace(/\s+/g, '');
        if (g.length > 0 && g.length < 4) {
          inp.value = g.padEnd(4, '0');
          produttoreVal = inp.value;
          notaLibera.textContent = '';
          aggiornaEsito();
        }
      };
      field.append(inp, notaLibera, el('div', { class:'sub', style:'margin-top:4px;' },
        produttoriTabellaOk === false
          ? 'Anagrafica produttori non attiva: manca la tabella `produttori` (migrazione dal pannello Supabase). '
            + 'Per ora sigla a mano: se scrivi meno di 4 caratteri viene riempita con zeri in fondo (TDK → TDK0).'
          : 'Carico l\'anagrafica produttori…'));
    }
    wrapProd.append(field);
  }

  // ── Codice produttore ──
  const inCodice = el('input', { type:'text', maxlength:'11', placeholder:'es. LC1D18BD',
    style:'max-width:240px;text-transform:uppercase;font-family:JetBrains Mono,monospace;' });
  inCodice.oninput = () => { codiceVal = (inCodice.value || '').toUpperCase(); aggiornaEsito(); };

  // ── Esito: i tre blocchi + copia ──
  function aggiornaEsito() {
    wrapEsito.innerHTML = '';
    const b5 = blocco5();
    const ris = codificaComponi(b5, produttoreVal, codiceVal);
    const blocchi = el('div', { style:'display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;'
      + 'font-family:JetBrains Mono,monospace;font-size:22px;font-weight:700;letter-spacing:.06em;' });
    const seg = (txt, colore, atteso) => el('span', {
      style:'color:' + (txt.length === atteso ? colore : 'var(--mut)') + ';'
        + 'border-bottom:2px solid ' + colore + ';padding:0 2px;min-width:30px;display:inline-block;text-align:center;',
    }, txt.padEnd(atteso, '·'));
    blocchi.append(
      seg(b5, 'var(--acc)', 5),
      seg((produttoreVal || '').toUpperCase(), 'var(--blu)', 4),
      seg(ris.ok ? ris.codice.slice(9) : (codiceVal || '').toUpperCase(), 'var(--grn)', 11),
    );
    wrapEsito.append(blocchi);
    if (ris.ok) {
      const codice = ris.codice;
      wrapEsito.append(el('div', { style:'display:flex;align-items:center;gap:12px;margin-top:10px;flex-wrap:wrap;' },
        el('span', { style:'font-family:JetBrains Mono,monospace;font-size:14px;' }, codice + ' · 20/20'),
        el('button', { class:'btnp', onclick: async () => {
          try { await navigator.clipboard.writeText(codice); toast('Codice copiato: ' + codice); }
          catch (e) { prompt('Copia il codice:', codice); }
        } }, '⧉ Copia codice'),
      ));
    } else {
      wrapEsito.append(el('div', { class:'sub', style:'margin-top:8px;' },
        'Manca: ' + ris.errori.join(' · ')));
    }
  }

  box.append(
    el('div', { class:'field' }, el('label', {}, 'Gruppo (piano dei conti)'), selGruppo),
    wrapNote, wrapVoce, wrapTabs, wrapProd,
    el('div', { class:'field' },
      el('label', {}, 'Codice produttore (max 11 caratteri)'), inCodice,
      el('div', { class:'sub', style:'margin-top:4px;' },
        'Se più corto di 11, viene riempito con zeri DAVANTI (es. LC1D18BD → 000LC1D18BD).')),
    wrapEsito,
  );
  root.append(box);
  renderProduttore();
  aggiornaEsito();

  // Anagrafica produttori: caricamento pigro alla prima apertura della scheda
  if (produttoriTabellaOk === null) {
    caricaProduttori().then(() => { renderProduttore(); });
  }
}

function openArticoloModal(a, opts) {
  const isNew = !a;
  const isAdmin = state.profile?.ruolo === 'admin';
  a = a || { codice:'', descrizione:'', categoria:'', note:'', attivo:true, minuti_unitari:null };
  const readonly = !isAdmin;
  // Chiusura: se chi ha aperto la scheda vuole riprendere il controllo dopo
  // (es. modal commessa → matita fasi → anagrafica → ritorno alla commessa),
  // passa opts.dopoChiusura. In quel caso NIENTE salto alla tab articoli.
  const chiudi = () => {
    closeModal();
    if (opts && typeof opts.dopoChiusura === 'function') opts.dopoChiusura();
  };
  // Valore originale dei minuti, per chiedere conferma se cambia
  const minutiOrig = (a.minuti_unitari != null && a.minuti_unitari !== '')
    ? Number(a.minuti_unitari) : null;

  const modal = el('div', { class:'modal' });
  modal.append(el('div', { class:'mhd' },
    el('h2', {}, isNew ? 'Nuovo Articolo' : (readonly ? 'Articolo' : 'Modifica Articolo')),
    el('button', { class:'mclose', onclick:chiudi }, '✕'),
  ));

  const body = el('div', { class:'mbody' });
  const form = el('form');

  const inCodice = el('input', { type:'text', name:'codice', value:a.codice||'', required:'true' });
  const inDesc = el('input', { type:'text', name:'descrizione', value:a.descrizione||'' });
  const inCategoria = el('input', { type:'text', name:'categoria', value:a.categoria||'' });
  const inMinuti = el('input', {
    type:'number', name:'minuti_unitari', step:'0.5', min:'0',
    value: minutiOrig != null ? String(minutiOrig) : '',
    placeholder: 'es. 8',
    style:'max-width:140px;',
  });
  const inNote = el('textarea', { name:'note', rows:'2' }, a.note || '');
  const selAttivo = el('select', { name:'attivo' },
    el('option', { value:'true' }, 'Attivo'),
    el('option', { value:'false' }, 'Disattivato'));
  selAttivo.value = String(!!a.attivo);

  if (readonly) {
    [inCodice, inDesc, inCategoria, inMinuti, inNote, selAttivo].forEach(i => i.disabled = true);
  }

  // --- Editor fasi: scomposizione INTERNA. Non tocca il tempo pagato
  // (minuti_unitari): mostra solo il confronto somma fasi vs pagato. ---
  const tipiAttivi = (state.tipiLav || []).filter(t => t.attivo !== false)
    .sort((x, y) => (x.ordine || 0) - (y.ordine || 0));
  // Righe fase: per gli articoli esistenti si parte dalle fasi EFFETTIVE
  // (media storica viva nei campi, tipi solo-storico aggiunti in automatico);
  // il salvataggio le persiste nel template, che resta il fallback per i
  // tipi senza storico. Articolo nuovo: si parte vuoti come sempre.
  const fasi = (a.id && typeof fasiEffettiveArticolo === 'function'
    ? fasiEffettiveArticolo(a.id).map(f => ({
        tipo_lavorazione_id: f.tipo_lavorazione_id || null,
        minuti_unitari: Number(f.minuti_unitari) || 0,
        _fonte: f.fonte, _nComm: f.nCommesse }))
    : (Array.isArray(a.fasi) ? a.fasi.slice() : [])
        .sort((x, y) => (x.ordine || 0) - (y.ordine || 0))
        .map(f => ({ tipo_lavorazione_id: f.tipo_lavorazione_id || null, minuti_unitari: Number(f.minuti_unitari) || 0 })));
  const notaMinuti = el('div', { class:'sub', style:'margin-top:4px;' },
    'Lo standard commerciale: pre-compila le nuove commesse.');
  const fasiWrap = el('div', { class:'fasi-list' });
  const notaConfronto = el('div', { class:'sub', style:'margin-top:8px;font-family:JetBrains Mono,monospace;' });
  function pagatoCorrente() {
    const v = parseFloat((inMinuti.value || '').toString().replace(',', '.'));
    return Number.isFinite(v) ? v : null;
  }
  function aggiornaConfronto() {
    if (fasi.length === 0) { notaConfronto.textContent = ''; notaConfronto.style.color = ''; return; }
    const somma = fasi.reduce((s, f) => s + (Number(f.minuti_unitari) || 0), 0);
    const pagato = pagatoCorrente();
    if (pagato === null) {
      notaConfronto.style.color = 'var(--mut)';
      notaConfronto.textContent = `Somma fasi: ${somma} min/pz · tempo pagato non impostato`;
    } else if (somma > pagato) {
      notaConfronto.style.color = 'var(--red)';
      notaConfronto.textContent = `⚠ Somma fasi ${somma} · pagato ${pagato} · sfori di ${+(somma - pagato).toFixed(2)} min/pz`;
    } else {
      notaConfronto.style.color = 'var(--grn)';
      notaConfronto.textContent = `Somma fasi ${somma} · pagato ${pagato} · margine ${+(pagato - somma).toFixed(2)} min/pz`;
    }
  }
  if (!readonly) inMinuti.oninput = aggiornaConfronto;
  function renderFasi() {
    fasiWrap.innerHTML = '';
    if (fasi.length === 0) {
      fasiWrap.append(el('div', { class:'sub' }, "Nessuna fase: l'articolo usa il solo tempo pagato qui sopra."));
    }
    fasi.forEach((f, i) => {
      const sel = el('select', { style:'flex:1;min-width:0;' },
        el('option', { value:'' }, '— tipo lavorazione —'),
        ...tipiAttivi.map(t => el('option', { value:t.id }, t.nome)));
      sel.value = f.tipo_lavorazione_id || '';
      sel.disabled = readonly;
      const inMin = el('input', { type:'number', step:'0.5', min:'0', value:String(f.minuti_unitari || 0),
        placeholder:'min/pz', style:'max-width:90px;' });
      inMin.disabled = readonly;
      inMin.oninput = () => { f.minuti_unitari = Number(inMin.value) || 0; aggiornaConfronto(); };
      // Metrica (sola lettura) + drill-down sulle spedite che la compongono.
      // Il template fasi qui sopra resta l'INTENZIONE: la media la affianca,
      // mai la sovrascrive. Vedi la divergenza piano-vs-realtà.
      const sugg = el('div', { class:'sub', style:'font-family:JetBrains Mono,monospace;font-size:11px;flex-basis:100%;margin:2px 0 2px 28px;' });
      const fmtD = (iso) => { if (!iso) return ''; const p = String(iso).slice(0,10).split('-'); return p.length===3 ? p[2]+'/'+p[1]+'/'+p[0].slice(2) : String(iso); };
      function refreshSugg() {
        sugg.innerHTML = '';
        const d = datiStoricoFase(a.id, f.tipo_lavorazione_id);
        if (!d) return;
        const val = Math.round(d.minPz * 10) / 10;
        const top = el('div', { style:'display:flex;align-items:center;gap:8px;flex-wrap:wrap;' },
          el('span', { style:'color:var(--mut);' },
            'media storica ~' + String(val).replace('.', ',') + ' min/pz · '
            + d.nCommesse + (d.nCommesse === 1 ? ' commessa' : ' commesse')));
        if (!readonly) {
          top.append(el('button', {
            type:'button', class:'btnsm', style:'padding:1px 8px;',
            onclick: () => { f.minuti_unitari = val; inMin.value = String(val); aggiornaConfronto(); },
          }, 'usa'));
        }
        sugg.append(top);
        sugg.append(entityTimeline({
          sommario: 'da quali commesse esce questo numero (ultime '
            + MEDIA_ULTIME_COMMESSE + ' chiuse)',
          debole: d.debole,
          righe: d.righe.map(r => ({
            titolo: r.label,
            meta: (r.data ? fmtD(r.data) + ' · ' : '') + r.pezzi + ' pz · ' + r.nSess + ' sess',
            valore: String(Math.round(r.minPz * 10) / 10).replace('.', ',') + ' min/pz',
          })),
        }));
      }
      sel.onchange = () => { f.tipo_lavorazione_id = sel.value || null; refreshSugg(); aggiornaConfronto(); };
      const row = el('div', { style:'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0;' },
        el('span', { class:'sub', style:'width:20px;flex-shrink:0;' }, '#' + (i + 1)),
        sel, inMin);
      if (!readonly) {
        row.append(el('button', { type:'button', class:'btnsm', style:'flex-shrink:0;',
          onclick: () => { fasi.splice(i, 1); renderFasi(); aggiornaConfronto(); } }, '✕'));
      }
      row.append(sugg);
      fasiWrap.append(row);
      refreshSugg();
    });
  }
  const btnAddFase = readonly ? null : el('button', {
    type:'button', class:'btnsm', style:'margin-top:8px;',
    onclick: () => { fasi.push({ tipo_lavorazione_id:null, minuti_unitari:0 }); renderFasi(); aggiornaConfronto(); }
  }, '+ Aggiungi fase');
  renderFasi();
  aggiornaConfronto();

  // --- Listino: ultimo prezzo per cliente, DERIVATO dagli ordini (mai una
  // tabella). Sola lettura: si aggiorna da solo a ogni ordine con €/pz.
  // Un blocco per cliente, drill-down = andamento (stile fasi). ---
  const listinoWrap = el('div', { class:'fasi-list' });
  const listinoRighe = (a.id && typeof storicoPrezziArticolo === 'function')
    ? storicoPrezziArticolo(a.id) : [];
  {
    const fmtEuro = (n) => '€ ' + Number(n).toLocaleString('it-IT',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtD = (iso) => iso ? fmtIT(String(iso).slice(0, 10)) : '';
    const perCliente = new Map();
    listinoRighe.forEach(r => {
      const k = r.clienteId || '';
      if (!perCliente.has(k)) perCliente.set(k, []);
      perCliente.get(k).push(r);
    });
    if (perCliente.size === 0) {
      listinoWrap.append(el('div', { class:'sub' },
        isNew ? 'Si compila da solo dagli ordini con prezzo €/pz.'
              : 'Nessun prezzo registrato: si compila da solo dagli ordini con prezzo €/pz.'));
    } else {
      // Clienti ordinati per data dell'ultimo prezzo (più recente in alto).
      [...perCliente.entries()]
        .sort((x, y) => String(y[1][0].data || '').localeCompare(String(x[1][0].data || '')))
        .forEach(([cliId, righe]) => {
          const nome = state.aziende.find(c => c.id === cliId)?.nome || 'Cliente sconosciuto';
          const ult = righe[0];
          listinoWrap.append(entityTimeline({
            sommario: nome + ' — ' + fmtEuro(ult.prezzo)
              + (ult.data ? ' (' + fmtD(ult.data) + ')' : ''),
            righe: righe.map(r => ({
              titolo: r.numero_ordine || '—',
              meta: (r.data ? fmtD(r.data) + ' · ' : '') + r.quantita + ' pz',
              valore: fmtEuro(r.prezzo),
            })),
          }));
        });
    }
  }

  // Corpo a SEZIONI (stile scheda azienda): anagrafica → tempi → listino
  // → note. Hint corti, uno per campo dove serve davvero.
  const sez = (t) => el('div', { class:'sub',
    style:'margin:16px 0 6px;color:var(--mut);text-transform:uppercase;letter-spacing:.1em;font-size:11px;' },
    '── ' + t + ' ──');
  inCategoria.placeholder = 'es. Cablaggi';
  form.append(
    el('div', { style:'display:grid;grid-template-columns:minmax(160px,2fr) minmax(110px,1fr) 120px;gap:10px;' },
      el('div', { class:'field' }, el('label', {}, 'Codice *'), inCodice),
      el('div', { class:'field' }, el('label', {}, 'Categoria'), inCategoria),
      el('div', { class:'field' }, el('label', {}, 'Stato'), selAttivo),
    ),
    el('div', { class:'field' }, el('label', {}, 'Descrizione'), inDesc),
    sez('Tempo pagato e fasi'),
    el('div', { class:'field' }, el('label', {}, 'Tempo pagato (min/pz)'), inMinuti, notaMinuti),
    el('div', { class:'field' },
      el('label', {}, 'Fasi — scomposizione interna (opzionale)'),
      fasiWrap,
      btnAddFase,
      notaConfronto,
      el('div', { class:'sub', style:'margin-top:4px;' },
        'Auto-compilate dalla media storica (viva a ogni apertura); i valori manuali '
        + 'contano solo per i tipi senza storico. La somma dovrebbe stare entro il tempo pagato.')),
    sez('Listino'),
    el('div', { class:'field' },
      listinoWrap,
      el('div', { class:'sub', style:'margin-top:4px;' },
        'Ultimo prezzo per cliente, derivato dagli ordini (non la media). Click per l\'andamento. '
        + 'Pre-compila il prezzo nei nuovi ordini.')),
    sez('Note'),
    el('div', { class:'field' }, inNote),
  );

  body.append(form);
  modal.append(body);

  const foot = el('div', { class:'mfoot' });
  // Elimina: vive QUI dentro (la tabella non ha più pulsanti), a sinistra
  // e lontano da Salva. deleteArticolo chiede già conferma e ridisegna.
  if (isAdmin && !isNew) {
    foot.append(el('button', { class:'btnd', style:'margin-right:auto;',
      onclick: async () => { if (await deleteArticolo(a)) closeModal(); } }, 'Elimina articolo'));
  }
  foot.append(el('button', { class:'btng', onclick:chiudi }, 'Chiudi'));
  if (isAdmin) {
    const btnSave = el('button', { class:'btnp' }, 'Salva');
    btnSave.onclick = async () => {
      const fd = new FormData(form);
      // Fasi valide (con tipo). ordine = posizione in lista.
      const fasiPayload = fasi
        .filter(f => f.tipo_lavorazione_id)
        .map((f, i) => ({ tipo_lavorazione_id: f.tipo_lavorazione_id, minuti_unitari: Number(f.minuti_unitari) || 0, ordine: i + 1 }));
      // minuti_unitari = tempo PAGATO, sempre manuale (mai sovrascritto dalle fasi).
      const minutiRaw = (fd.get('minuti_unitari') || '').toString().trim();
      const minutiVal = minutiRaw === '' ? null : Number(minutiRaw);
      if (minutiRaw !== '' && (!Number.isFinite(minutiVal) || minutiVal < 0)) {
        return toast('Minuti unitari: valore non valido', 'err');
      }
      // Conferma se il valore minuti cambia su un articolo esistente.
      // Motivo: influenzerà le commesse future create con questo codice.
      if (!isNew && minutiOrig !== minutiVal) {
        const prima = minutiOrig != null ? `${minutiOrig} min` : '(vuoto)';
        const dopo = minutiVal != null ? `${minutiVal} min` : '(vuoto)';
        const ok = confirm(
          `Stai cambiando i minuti unitari di questo articolo:\n` +
          `   ${prima} → ${dopo}\n\n` +
          `Questo influenzerà le NUOVE commesse create con questo codice.\n` +
          `Le commesse esistenti non verranno modificate.\n\n` +
          `Procedere?`
        );
        if (!ok) return;
      }
      const payload = {
        codice: (fd.get('codice')||'').trim(),
        descrizione: (fd.get('descrizione')||'').trim() || null,
        categoria: (fd.get('categoria')||'').trim() || null,
        note: (fd.get('note')||'').trim() || null,
        attivo: fd.get('attivo') === 'true',
        minuti_unitari: minutiVal,
        fasi: fasiPayload,
      };
      if (!payload.codice) return toast('Codice obbligatorio', 'err');
      btnSave.disabled = true;
      btnSave.textContent = 'Salvataggio…';
      try {
        const { data, error } = await eseguiConRetry(
        () => isNew ? sb.from('articoli').insert(payload).select().single() : sb.from('articoli').update(payload).eq('id', a.id).select().single(),
        { label: 'salvataggio articoli' }
      );
        if (error) {
          btnSave.disabled = false;
          btnSave.textContent = 'Salva';
          if (error.code === '23505') return toast('Codice già esistente', 'err');
          return toast(error.message, 'err');
        }
        if (isNew) {
          if (!state.articoli.find(x => x.id === data.id)) state.articoli.push(data);
        } else {
          state.articoli = state.articoli.map(x => x.id === a.id ? data : x);
        }
        toast(isNew ? 'Articolo creato' : 'Articolo aggiornato');
        if (opts && typeof opts.dopoChiusura === 'function') { chiudi(); }
        else { closeModal(); renderTab('articoli'); }
      } catch (e) {
        btnSave.disabled = false;
        btnSave.textContent = 'Salva';
        toast('Errore di rete: '+(e.message||e), 'err');
      }
    };
    foot.append(btnSave);
  }
  modal.append(foot);
  openModal(modal);
}

// Ritorna true solo a eliminazione avvenuta (il chiamante decide se chiudere).
async function deleteArticolo(a) {
  if (!confirm(`Eliminare l'articolo "${a.codice}"?\nNon sarà possibile se ha operazioni associate.`)) return false;
  const { data, error } = await sb.from('articoli').delete().eq('id', a.id).select();
  if (error) {
    if (error.code === '23503') { toast('Impossibile: ci sono operazioni legate a questo articolo', 'err'); return false; }
    toast(error.message, 'err'); return false;
  }
  if (!data || data.length === 0) {
    toast('Eliminazione bloccata: verifica le policy DELETE su articoli', 'err'); return false;
  }
  state.articoli = state.articoli.filter(x => x.id !== a.id);
  toast('Articolo eliminato'); renderTab('articoli');
  return true;
}

// ─── Import Excel ───
async function articoliImportExcel(file) {
  if (!file) return;
  if (typeof XLSX === 'undefined') {
    toast('Libreria Excel non caricata, ricarica la pagina', 'err');
    return;
  }
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type:'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval:'', raw:false });
    if (!rows.length) { toast('File vuoto', 'err'); return; }
    openArticoliImportPreviewModal(rows);
  } catch (e) {
    toast('Errore lettura file: '+(e.message||e), 'err');
  }
}

function openArticoliImportPreviewModal(rows) {
  const headers = Object.keys(rows[0]);
  const findCol = (...candidati) => {
    for (const c of candidati) {
      const found = headers.find(h => h.toLowerCase().trim() === c.toLowerCase());
      if (found) return found;
    }
    return null;
  };
  const colCodice = findCol('codice','code','articolo','art','sku','part number','pn');
  const colDesc = findCol('descrizione','descr','description','desc');
  const colCategoria = findCol('categoria','category','tipo','famiglia');
  const colNote = findCol('note','notes','annotazioni');
  const colMinuti = findCol('minuti','minuti_unitari','min/pz','minuti per pezzo','tempo unitario','tempo','minutes');

  const parsed = rows.map((r, idx) => {
    // Parsing minuti: accetta numero, vuoto, virgola decimale
    let minutiVal = null;
    if (colMinuti) {
      const raw = (r[colMinuti]||'').toString().trim().replace(',', '.');
      if (raw !== '') {
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) minutiVal = n;
      }
    }
    return {
      _row: idx + 2,
      codice: (colCodice ? r[colCodice] : '').toString().trim(),
      descrizione: colDesc ? (r[colDesc]||'').toString().trim() || null : null,
      categoria: colCategoria ? (r[colCategoria]||'').toString().trim() || null : null,
      note: colNote ? (r[colNote]||'').toString().trim() || null : null,
      minuti_unitari: minutiVal,
    };
  });

  const errors = [];
  const codiciVisti = new Set();
  parsed.forEach(p => {
    if (!p.codice) errors.push(`Riga ${p._row}: codice mancante`);
    else if (codiciVisti.has(p.codice.toLowerCase()))
      errors.push(`Riga ${p._row}: codice "${p.codice}" duplicato nel file`);
    else codiciVisti.add(p.codice.toLowerCase());
  });
  const validi = parsed.filter(p => p.codice);

  const codiciInDB = new Set(state.articoli.map(a => (a.codice||'').toLowerCase()));
  const nuovi = validi.filter(p => !codiciInDB.has(p.codice.toLowerCase()));
  const aggiornamenti = validi.filter(p => codiciInDB.has(p.codice.toLowerCase()));

  const modal = el('div', { class:'modal', style:'max-width:680px' });
  modal.append(el('div', { class:'mhd' },
    el('h2', {}, 'Anteprima import articoli'),
    el('button', { class:'mclose', onclick:closeModal }, '✕'),
  ));
  const body = el('div', { class:'mbody' });

  body.append(el('div', { class:'kpis' },
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Righe lette'), el('div', { class:'kv' }, String(rows.length))),
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Nuovi'), el('div', { class:'kv kg' }, String(nuovi.length))),
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Da aggiornare'), el('div', { class:'kv ky' }, String(aggiornamenti.length))),
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Errori'), el('div', { class:'kv kr' }, String(errors.length))),
  ));

  body.append(el('div', { class:'sub', style:'margin:16px 0 8px;' }, 'Mappatura colonne riconosciute:'));
  const mapBox = el('div', { style:'background:var(--sur2);border:1px solid var(--brd);border-radius:4px;padding:10px 12px;font-family:monospace;font-size:11px;line-height:1.8;' });
  [
    ['codice', colCodice],
    ['descrizione', colDesc],
    ['categoria', colCategoria],
    ['note', colNote],
  ].forEach(([campo, col]) => {
    mapBox.append(el('div', {},
      el('span', { style:'color:var(--mut)' }, campo+': '),
      el('span', { style: col ? 'color:var(--grn)' : 'color:var(--mut)' },
        col ? `"${col}"` : '— non trovato —'),
    ));
  });
  body.append(mapBox);

  if (errors.length) {
    body.append(el('div', { class:'sub', style:'margin:14px 0 6px;color:var(--red);' }, 'Errori:'));
    const errBox = el('div', { style:'max-height:120px;overflow:auto;background:rgba(255,78,107,.08);border:1px solid var(--red);border-radius:4px;padding:10px;font-family:monospace;font-size:11px;' });
    errors.slice(0,20).forEach(e => errBox.append(el('div', {}, e)));
    if (errors.length > 20) errBox.append(el('div', { style:'color:var(--mut);margin-top:4px;' }, `... e altri ${errors.length-20}`));
    body.append(errBox);
  }

  if (validi.length) {
    body.append(el('div', { class:'sub', style:'margin:14px 0 6px;' }, `Anteprima (prime ${Math.min(5, validi.length)} righe valide):`));
    const tbl = el('table', { class:'rt', style:'font-size:11px;' });
    tbl.append(el('thead', {}, el('tr', {},
      el('th', {}, 'Codice'), el('th', {}, 'Descrizione'), el('th', {}, 'Categoria'),
    )));
    const tb = el('tbody');
    validi.slice(0,5).forEach(p => tb.append(el('tr', {},
      el('td', { class:'cod-cell' }, p.codice),
      el('td', {}, p.descrizione || ''),
      el('td', {}, p.categoria || ''),
    )));
    tbl.append(tb);
    body.append(tbl);
  }

  modal.append(body);

  const foot = el('div', { class:'mfoot' });
  foot.append(el('button', { class:'btng', onclick:closeModal }, 'Annulla'));
  if (validi.length) {
    foot.append(el('button', {
      class:'btnp',
      onclick: () => articoliImportEsegui(nuovi, aggiornamenti),
    }, `Importa ${validi.length} articoli`));
  }
  modal.append(foot);
  openModal(modal);
}

async function articoliImportEsegui(nuovi, aggiornamenti) {
  closeModal();
  let okIns = 0, errIns = 0, okUpd = 0, errUpd = 0;

  // Insert in batch da 500 per evitare payload eccessivi (gli articoli possono essere molti)
  const batchSize = 500;
  for (let i = 0; i < nuovi.length; i += batchSize) {
    const batch = nuovi.slice(i, i + batchSize).map(p => ({
      codice: p.codice, descrizione: p.descrizione,
      categoria: p.categoria, note: p.note,
      minuti_unitari: p.minuti_unitari, // null se vuoto nell'Excel
    }));
    const { data, error } = await sb.from('articoli').insert(batch).select();
    if (error) {
      errIns += batch.length;
      toast('Errore insert: '+error.message, 'err');
    } else {
      okIns += data.length;
      data.forEach(d => {
        if (!state.articoli.find(x => x.id === d.id)) state.articoli.push(d);
      });
    }
  }

  for (const p of aggiornamenti) {
    const existing = state.articoli.find(a => (a.codice||'').toLowerCase() === p.codice.toLowerCase());
    if (!existing) { errUpd++; continue; }
    // Per l'update: i minuti vengono aggiornati SOLO se valorizzati nell'Excel.
    // Se l'utente lascia vuota la cella, non sovrascrivo il valore esistente.
    const patch = {
      descrizione: p.descrizione, categoria: p.categoria, note: p.note,
    };
    if (p.minuti_unitari != null) patch.minuti_unitari = p.minuti_unitari;
    const { data, error } = await sb.from('articoli').update(patch)
      .eq('id', existing.id).select().single();
    if (error) errUpd++;
    else {
      okUpd++;
      state.articoli = state.articoli.map(x => x.id === existing.id ? data : x);
    }
  }

  toast(`Import completato: ${okIns} nuovi, ${okUpd} aggiornati${errIns||errUpd ? `, ${errIns+errUpd} errori` : ''}`,
        (errIns||errUpd) ? 'err' : 'ok');
  renderTab('articoli');
}

// ─── Import Excel commesse (Pianificazione) ───
async function operazioniImportExcel(file) {
  if (!file) return;
  if (typeof XLSX === 'undefined') {
    toast('Libreria Excel non caricata, ricarica la pagina', 'err');
    return;
  }
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type:'array', cellDates:true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval:'', raw:true });
    if (!rows.length) { toast('File vuoto', 'err'); return; }
    openOperazioniImportPreviewModal(rows);
  } catch (e) {
    toast('Errore lettura file: '+(e.message||e), 'err');
  }
}

// ═══════════════════════════════════════════════════════════
// EXPORT OPERAZIONI — A2: stesso formato dell'import + colonne
// extra di stato/avanzamento. Le colonne extra sono ignorate
// dall'import attuale (roundtrip per la parte base, ma il file
// resta utile come reporting leggibile).
// ═══════════════════════════════════════════════════════════

// STATI_OPERAZIONE cancellata (7 ago): serviva alle caselle di stato del
// modal export, sparite quando l'export ha iniziato a seguire i filtri della
// scheda invece di averne di propri.

function openOperazioniExportModal() {
  // Si esporta QUELLO CHE SI VEDE (7 ago, richiesta Nico): la scelta degli
  // stati è sparita perché era un secondo filtro accanto a quello della
  // scheda, e i due potevano dire cose diverse. Ora la base è la lista
  // filtrata della tabella; l'unica aggiunta è includere le spedite, che la
  // scheda nasconde sempre perché vivono nello Storico.
  let conSpedite = false;
  const modal = el('div', { class:'modal', style:'max-width:480px;' });
  modal.append(el('div', { class:'mhd' },
    el('h2', {}, 'Esporta commesse'),
    el('button', { class:'mclose', onclick: closeModal }, '✕'),
  ));

  const body = el('div', { class:'mbody' });
  const riepilogo = el('div', { style:'background:var(--sur2);border:1px solid var(--brd);border-radius:4px;padding:10px 12px;margin-bottom:12px;' });
  const aggiorna = () => {
    const { list, filtriAttivi } = pianificazioneFiltrate(conSpedite);
    riepilogo.innerHTML = '';
    riepilogo.append(
      el('div', { style:'font-weight:700;font-size:14px;' },
        list.length + (list.length === 1 ? ' commessa' : ' commesse')),
      el('div', { class:'sub', style:'font-size:11px;margin-top:4px;' },
        filtriAttivi.length
          ? 'Quello che stai vedendo · ' + filtriAttivi.join(' · ')
          : 'Tutte quelle in lavorazione: nessun filtro attivo nella scheda.'),
    );
  };

  const cb = el('input', { type:'checkbox', style:'cursor:pointer;accent-color:var(--acc);' });
  cb.onchange = () => { conSpedite = cb.checked; aggiorna(); };
  // Quante commesse la spunta AGGIUNGE davvero: quelle dello Storico, non
  // tutte le spedite. Dal 27 ago le spedite dell'ultimo mese sono già in
  // questa scheda, e contarle qui direbbe un numero che non si aggiunge.
  const oggiExp = toLocalISO(new Date());
  const nSped = state.operazioni.filter(o => commessaInStorico(o, state.spedizioni, oggiExp)).length;

  body.append(
    el('div', { class:'sub', style:'margin-bottom:12px;' },
      'Esci con le commesse che hai davanti, filtri compresi. Le colonne seguono il formato di import, '
      + 'più alcune extra (stato, ore, addetti) che l\'import ignora.'),
    riepilogo,
    el('label', {
      style:'display:flex;align-items:center;gap:10px;padding:6px 4px;cursor:pointer;font-size:12px;',
    }, cb,
      el('span', { style:'flex:1;' }, 'Includi anche lo Storico'),
      el('span', { class:'sub', style:'font-size:11px;' }, nSped + ' commesse')),
    el('div', { class:'sub', style:'font-size:11px;margin-top:6px;' },
      'Questa scheda contiene già le spedite degli ultimi 30 giorni. '
      + 'Le più vecchie stanno nello Storico.'),
  );
  aggiorna();

  modal.append(body);
  modal.append(el('div', { class:'mfoot' },
    el('button', { class:'btng', onclick: closeModal }, 'Annulla'),
    el('button', { class:'btnp', onclick: () => {
      const { list, filtriAttivi } = pianificazioneFiltrate(conSpedite);
      if (!list.length) return toast('Nessuna commessa da esportare con questi filtri', 'err');
      operazioniExportExcel(list, filtriAttivi);
      closeModal();
    } }, '↓ Scarica'),
  ));
  openModal(modal);
}

// Splitta un numero_ordine "Eser/SzCl/Ord" in tre parti (best effort).
// Se il valore non rispetta il formato a 3 parti, mette tutto in "ord".
function splitNumeroOrdine(numOrdine) {
  if (!numOrdine) return { eser:'', sz:'', ord:'' };
  const parts = String(numOrdine).split('/').map(s => s.trim());
  if (parts.length === 3) return { eser: parts[0], sz: parts[1], ord: parts[2] };
  if (parts.length === 2) return { eser:'', sz: parts[0], ord: parts[1] };
  return { eser:'', sz:'', ord: parts.join('/') };
}

// `list`: le commesse già filtrate e ordinate come le vede la scheda (7 ago).
// Prima riceveva un elenco di stati e rifiltrava per conto suo, ignorando
// tutto il resto: chi aveva cercato o escluso clienti si ritrovava altro.
function operazioniExportExcel(list, filtriAttivi) {
  if (typeof XLSX === 'undefined') {
    toast('Libreria Excel non caricata, ricarica la pagina', 'err');
    return;
  }
  if (!list || list.length === 0) {
    toast('Nessuna commessa da esportare', 'err');
    return;
  }

  // Mappa indici per risoluzione veloce
  const artById = {};
  state.articoli.forEach(a => artById[a.id] = a);
  const cliById = {};
  state.aziende.forEach(c => cliById[c.id] = c);
  const uById = {};
  state.utenti.forEach(u => uById[u.id] = u);

  // Costruzione righe. Header delle prime colonne coerenti con l'import ERP
  // (Eser, Sz Cl, Ord/Off cliente, Riga, Codice articolo, Scadenza, Quantità,
  // Cliente, Rifer. Cliente, Riferimento Cliente — quest'ultime due in input
  // vengono concatenate nel campo `riferimento_cliente`; in export le
  // restituiamo come unica colonna "Riferimento Cliente").
  const righe = list.map(o => {
    const { eser, sz, ord } = splitNumeroOrdine(o.numero_ordine);
    const art = artById[o.articolo_id];
    const cli = cliById[o.cliente_id];
    const addetti = getOperazioneAddetti(o.id)
      .map(id => uById[id]?.nome)
      .filter(Boolean)
      .join(', ');
    // Fornitori esterni (90% uno solo, ma fino a 3): concateno "Nome: numero_OF"
    // separati da virgola. Se il numero ordine non è ancora compilato, mostro
    // solo il nome del fornitore.
    const fornitoriStr = (state.opFornitori || [])
      .filter(r => r.operazione_id === o.id)
      .map(r => {
        const az = cliById[r.azienda_id];
        const nome = az?.nome || '?';
        return r.numero_ordine ? (nome + ': ' + r.numero_ordine) : nome;
      })
      .join(', ');
    const orePrev = opCalcOre(o);
    const oreCons = opCalcOreReali(o);
    const inizio = opInizio(o);
    return {
      'Eser':                  eser,
      'Sz Cl':                 sz,
      'Ord/Off cliente':       ord,
      'Riga':                  o.pos || '',
      'Codice articolo':       art?.codice || '',
      'Descrizione articolo':  art?.descrizione || '',
      'Scadenza':              o.scadenza ? fmtIT(o.scadenza) : '',
      'Quantità':              o.quantita ?? '',
      'Cliente':               cli?.nome || '',
      'Riferimento Cliente':   o.riferimento_cliente || '',
      'Numero OP':             o.numero_op || '',
      // ── Colonne extra (ignorate dall'import) ──
      'Stato':                 o.stato || 'aperta',
      'Stato preparazione':    o.stato_preparazione || '',
      'Inizio':                inizio ? fmtIT(inizio) : '',
      'Ore preventivo':        orePrev ? +orePrev.toFixed(2) : 0,
      'Ore consuntivo':        oreCons ? +oreCons.toFixed(2) : 0,
      'Avanzamento %':         orePrev > 0 ? Math.round((oreCons / orePrev) * 100) : '',
      'Addetti assegnati':     addetti,
      'Fornitori':             fornitoriStr,
      'Note':                  o.note || '',
    };
  });

  // Genera workbook
  const ws = XLSX.utils.json_to_sheet(righe);
  // Larghezze colonne ragionevoli (in caratteri)
  ws['!cols'] = [
    { wch: 6 }, { wch: 6 }, { wch: 14 }, { wch: 6 },
    { wch: 18 }, { wch: 36 }, { wch: 11 }, { wch: 8 },
    { wch: 24 }, { wch: 24 }, { wch: 16 },
    { wch: 11 }, { wch: 14 }, { wch: 11 }, { wch: 12 },
    { wch: 12 }, { wch: 11 }, { wch: 30 }, { wch: 36 }, { wch: 30 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Operazioni');

  // Nome file: data e ora
  const d = new Date();
  const stamp = d.getFullYear() + z(d.getMonth()+1) + z(d.getDate())
    + '_' + z(d.getHours()) + z(d.getMinutes());
  const fname = `commesse_${stamp}.xlsx`;
  XLSX.writeFile(wb, fname);

  // Quante e con quali filtri: senza dirlo, un file corto sembra un errore.
  toast('Esportate ' + list.length + ' commess' + (list.length === 1 ? 'a' : 'e')
    + ((filtriAttivi && filtriAttivi.length) ? ' · filtri: ' + filtriAttivi.join(', ') : ' · nessun filtro'), 'ok');
}

// `valoreAData` viveva qui: convertiva le date delle celle Excel per il vecchio
// import ordini. L'ha sostituita `importOrdiniData` in domain/scheduling.js, che
// costruisce il seriale in UTC (l'altra passava per l'ora locale e d'estate
// poteva arretrare di un giorno) e conosce la sentinella 9999 dell'ERP.

// ═══════════════════════════════════════════════════════════
// ANTEPRIMA IMPORT ORDINI (25 ago) — il piano lo costruisce
// `analizzaImportOrdini` in domain, pura e sotto test. Qui si disegna
// soltanto: nessuna regola vive in questa funzione.
//
// L'anteprima dichiara SEMPRE anche quello che NON farà (righe scartate,
// commesse chiuse lasciate stare, anagrafiche che nascono): un import che
// mostra solo i numeri belli è il modo migliore per far entrare 400 righe
// sbagliate senza che nessuno se ne accorga.
// ═══════════════════════════════════════════════════════════
function openOperazioniImportPreviewModal(rows) {
  const piano = analizzaImportOrdini(rows, {
    articoli:   state.articoli,
    aziende:    state.aziende,
    operazioni: state.operazioni,
    spedizioni: state.spedizioni,
  });

  const modal = el('div', { class:'modal', style:'max-width:1100px' });
  modal.append(el('div', { class:'mhd' },
    el('h2', {}, 'Anteprima import ordini'),
    el('button', { class:'mclose', onclick:closeModal }, '✕'),
  ));
  const body = el('div', { class:'mbody' });

  // File che non è un'estrazione ordini: si dice quale colonna manca e si
  // esce. Meglio di un'anteprima con tutti zeri, che sembra un file vuoto.
  if (piano.colonneMancanti.length) {
    const NOMI = { ord:'numero ordine', riga:'riga/pos', codArt:'codice articolo',
                   scadenza:'data di scadenza', qta:'quantità', cliente:'cliente' };
    body.append(
      el('div', { class:'sub', style:'color:var(--red);font-weight:700;margin-bottom:8px;' },
        'Questo file non sembra un\'estrazione ordini.'),
      el('div', { class:'sub' }, 'Non ho trovato la colonna per: '
        + piano.colonneMancanti.map(k => NOMI[k] || k).join(', ')
        + '. Sono state lette ' + piano.righeLette + ' righe.'),
    );
    modal.append(body);
    modal.append(el('div', { class:'mfoot' },
      el('button', { class:'btng', onclick:closeModal }, 'Chiudi')));
    openModal(modal);
    return;
  }

  const nDaScrivere = piano.nuove.length + piano.aggiornamenti.length;

  const nota = (testo, colore) => el('div', { class:'sub',
    style:'margin:10px 0 0;font-size:11px;' + (colore ? 'color:' + colore + ';' : '') }, testo);
  const sezione = (titolo) => el('div', { class:'sub',
    style:'margin:16px 0 6px;font-weight:700;' }, titolo);
  const riquadro = (bordo) => el('div', { style:'max-height:170px;overflow:auto;background:var(--sur2);'
    + 'border:1px solid ' + (bordo || 'var(--brd)') + ';border-radius:4px;padding:9px 11px;'
    + 'font-family:monospace;font-size:11px;line-height:1.7;' });

  // ── I tre blocchi dell'anteprima (27 ago, richiesta Nico: "si può ordinare
  // in maniera che un non addetto ci capisca?"). Le sezioni erano tredici in
  // fila, cresciute per accumulo, e messe insieme non raccontavano niente.
  // Adesso rispondono a tre domande in quest'ordine:
  //   1. cosa scrive nel gestionale se confermo
  //   2. cosa resta fuori, e perché
  //   3. cosa NON tocca ma dovrei guardare (Alnus e gestionale in disaccordo)
  // Ogni sezione appende in `dest`, e l'ordine a schermo lo decide
  // l'assemblaggio in fondo: così riordinare non vuol dire spostare codice.
  const bScrive = el('div'), bFuori = el('div'), bGuarda = el('div');
  let dest = bScrive;

  dest = bScrive;
  // ── Le righe Senzani fuse in una commessa sola ──
  if (piano.box.length) {
    const nFuse = piano.box.reduce((s, b) => s + b.nRigheFuse, 0);
    dest.append(sezione('Senzani: ' + nFuse + ' righe unite in '
      + piano.box.length + (piano.box.length === 1 ? ' commessa' : ' commesse')));
    const box = riquadro();
    piano.box.forEach(b => {
      const chiusa = piano.bloccate.indexOf(b) >= 0;
      box.append(el('div', { style: chiusa ? 'color:var(--mut);' : '' },
        b.numeroOrdine + '/' + b.pos + '  ' + b.codArt + '  ' + b.descrArt
        + '  ·  ' + b.nRigheFuse + ' righe  ·  € ' + b.prezzo.toFixed(2)
        + '  ·  ' + fmtIT(b.scadenza)
        + (b.minutiUnitari ? '  ·  ' + b.minutiUnitari + ' min/pz' : '  ·  senza tempo pagato')
        + (chiusa ? '   → già ' + b.esistente.stato + ', non si tocca' : '')));
      if (b.scadenzeDiverse) box.append(el('div', { style:'color:var(--ylw);' },
        '   ⚠ le righe unite avevano scadenze diverse: tenuta la più vicina'));
    });
    dest.append(box);
  }

  dest = bFuori;
  // ── Commesse chiuse: si dichiarano e si lasciano stare ──
  if (piano.bloccate.length) {
    dest.append(nota('⛔ ' + piano.bloccate.length + ' commess'
      + (piano.bloccate.length === 1 ? 'a è già completata o spedita e non viene toccata'
                                     : 'e sono già completate o spedite e non vengono toccate')
      + ': una fotografia dell\'ERP non deve poter riaprire un lavoro finito.', 'var(--mut)'));
  }

  dest = bScrive;
  // ── Clienti che cambiano nome ──
  // Alnus è la fonte del nome (decisione Nico 25 ago), quindi la scheda che
  // c'è già viene ALLINEATA al file. È l'unica cosa in tutto l'import che
  // riscrive un dato d'anagrafica: va vista prima, non scoperta dopo.
  if (piano.clientiDaRinominare.length) {
    dest.append(sezione(piano.clientiDaRinominare.length + ' client'
      + (piano.clientiDaRinominare.length === 1 ? 'e viene rinominato' : 'i vengono rinominati')
      + ' per allinearsi al file'));
    const rn = riquadro('var(--ylw)');
    piano.clientiDaRinominare.forEach(c => rn.append(el('div', {},
      c.da + '   →   ' + c.a)));
    dest.append(rn);
    dest.append(nota('La scheda resta la stessa — commesse, storico e tariffe non si '
      + 'muovono — cambia solo come si legge il nome, ovunque compaia: '
      + 'Gantt, export e analisi comprese.', 'var(--ylw)'));
  }
  dest = bFuori;
  if (piano.rinomineImpossibili.length) {
    dest.append(sezione('Nomi lasciati come sono'));
    const ri = riquadro();
    piano.rinomineImpossibili.forEach(c => ri.append(el('div', {},
      c.da + '   ·   ' + c.motivo)));
    dest.append(ri);
    dest.append(nota('Un nome sbagliato è peggio di un nome vecchio: nel dubbio '
      + 'l\'import non tocca niente e te lo dice.'));
  }

  dest = bScrive;
  // ── Anagrafiche che nascono ──
  if (piano.clientiDaCreare.length || piano.articoliDaCreare.length) {
    dest.append(sezione('Anagrafiche create al volo'));
    const an = riquadro('var(--ylw)');
    piano.clientiDaCreare.forEach(n => an.append(el('div', {}, 'cliente   ' + n)));
    piano.articoliDaCreare.forEach(a => an.append(el('div', {},
      'articolo  ' + a.codice + (a.descrizione ? '  ' + a.descrizione : ''))));
    dest.append(an);
    dest.append(nota('Nascono solo premendo Importa. Un refuso dell\'ERP diventa '
      + 'un\'anagrafica nuova: se qui sopra c\'è un nome che non riconosci, annulla.', 'var(--ylw)'));
  }

  dest = bScrive;
  // ── Cosa cambia sulle commesse che ci sono già ──
  if (piano.aggiornamenti.length) {
    dest.append(sezione('Cosa cambia sulle ' + piano.aggiornamenti.length + ' già presenti'));
    const ag = riquadro();
    const mostra = (v) => (v === null || v === undefined || v === '') ? '(vuoto)'
      : (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? fmtIT(v) : String(v));
    piano.aggiornamenti.slice(0, 40).forEach(a => ag.append(el('div', {},
      a.voce.numeroOrdine + '/' + a.voce.pos + '  '
      + a.campi.map(c => c.campo + ' ' + mostra(c.da) + ' → ' + mostra(c.a)).join('  ·  '))));
    if (piano.aggiornamenti.length > 40) ag.append(el('div', { style:'color:var(--mut);' },
      '... e altre ' + (piano.aggiornamenti.length - 40)));
    dest.append(ag);
    dest.append(nota('Si toccano solo quantità, scadenza e prezzo — i campi che vengono '
      + 'dall\'ERP. Stato, fasi, addetti, note, gruppi e ore restano come sono.'));
  }

  dest = bScrive;
  // ── Tempo pagato: dove lo prende e dove non ce l'ha ──
  const daScrivere = piano.nuove.concat(piano.aggiornamenti.map(a => a.voce));
  const daTariffa = daScrivere.filter(v => v.minutiDaTariffa);
  const senzaMinuti = piano.nuove.filter(v => !v.minutiUnitari);
  if (daTariffa.length) dest.append(nota('⏱ Su ' + daTariffa.length + ' commess'
    + (daTariffa.length === 1 ? 'a il tempo pagato è ricavato' : 'e il tempo pagato è ricavato')
    + ' dal prezzo con la tariffa del cliente, come fa "+ Nuovo ordine".'));
  if (senzaMinuti.length) dest.append(nota('⚠ ' + senzaMinuti.length + ' commess'
    + (senzaMinuti.length === 1 ? 'a nasce' : 'e nascono') + ' senza tempo pagato '
    + '(l\'articolo non ha un min/pz e il cliente non ha tariffa): avanzamento e '
    + '€/ora resteranno vuoti finché non lo imposti.', 'var(--ylw)'));

  dest = bGuarda;
  // ── Spedizioni: i due sistemi non concordano ──
  // Non è una riga da importare, è una discordanza da guardare: la quantità
  // residua qui si ricalcola da ordinato − spedito, e dove non torna con
  // quella di Alnus vuol dire che una spedizione manca da una delle due parti.
  // L'import non tocca niente di tutto questo: lo dichiara e basta.
  if (piano.residuiDiscordanti.length) {
    const nAlnus = piano.residuiDiscordanti.filter(r => r.chiIndietro === 'alnus').length;
    dest.append(sezione('Spedizioni: ' + piano.residuiDiscordanti.length
      + (piano.residuiDiscordanti.length === 1 ? ' riga su cui i due sistemi non concordano'
                                               : ' righe su cui i due sistemi non concordano')));
    const rd = riquadro('var(--ylw)');
    piano.residuiDiscordanti.slice(0, 40).forEach(r => rd.append(el('div', {},
      r.numeroOrdine + '/' + r.pos
      + '  ordinate ' + r.ordinato
      + ' · qui spedite ' + r.spedito + ' → ne restano ' + r.residuoQui
      + ' · Alnus dice ' + r.residuaFile
      + (r.basiDiverse
          // Senza questo si confrontano due residue calcolate su ordinati
          // diversi, e la riga dice una cosa che non sta in piedi.
          ? '   ⚠ ma per Alnus le ordinate sono ' + r.ordinatoFile
            + ': i due numeri non partono dalla stessa base'
          : '   → ' + (r.chiIndietro === 'alnus'
              ? 'Alnus non sa di una spedizione fatta'
              : 'qui manca una spedizione che Alnus ha registrato')))));
    if (piano.residuiDiscordanti.length > 40) rd.append(el('div', { style:'color:var(--mut);' },
      '... e altre ' + (piano.residuiDiscordanti.length - 40)));
    dest.append(rd);
    dest.append(nota('Niente di tutto questo viene importato: la quantità residua il '
      + 'gestionale la calcola da sé (ordinato − spedito) e si vede già in tabella. '
      + 'Qui si segnala soltanto dove i due archivi divergono — ' + nAlnus + ' da sistemare '
      + 'in Alnus, ' + (piano.residuiDiscordanti.length - nAlnus) + ' qui.', 'var(--ylw)'));
  }

  dest = bFuori;
  // ── Righe descrittive: non si caricano, ed è giusto così ──
  // Regola di Nico (27 ago, che ha sostituito quella del 25): senza codice
  // articolo la riga non è un pezzo da produrre ma una voce descrittiva —
  // manodopera, minuteria. Si elencano perché sapere cosa NON è entrato serve
  // sempre, ma non c'è niente da andare a correggere: niente rosso.
  if (piano.senzaCodice.length) {
    dest.append(sezione(piano.senzaCodice.length
      + (piano.senzaCodice.length === 1 ? ' riga descrittiva non caricata' : ' righe descrittive non caricate')));
    const sc = riquadro();
    piano.senzaCodice.forEach(r => sc.append(el('div', {},
      r.numeroOrdine + '/' + r.pos + '  ' + r.cliente + '  ·  ' + r.descrizione
      + '  ·  ' + r.quantita + ' pz')));
    dest.append(sc);
    dest.append(nota('Righe senza codice articolo: sono voci descrittive, non pezzi da '
      + 'produrre, e non diventano commesse.'));
  }

  dest = bGuarda;
  // ── I due sistemi viaggiano in parallelo? ──
  const sd = piano.statiDiscordanti;
  if (sd.chiuseQui.length || sd.viveQui.length) {
    dest.append(sezione('Stato: ' + (sd.chiuseQui.length + sd.viveQui.length)
      + ' righe su cui i due sistemi non concordano'));
    const box = riquadro();
    if (sd.chiuseQui.length) {
      box.append(el('div', { style:'color:var(--mut);' },
        '── spedite qui, per Alnus ancora da fare (' + sd.chiuseQui.length + ') ──'));
      sd.chiuseQui.slice(0, 25).forEach(r => box.append(el('div', {},
        '   ' + r.numeroOrdine + '/' + r.pos + '  ' + r.codice + '  ' + r.stato
        + '  ·  ' + r.cliente)));
      if (sd.chiuseQui.length > 25) box.append(el('div', { style:'color:var(--mut);' },
        '   ... e altre ' + (sd.chiuseQui.length - 25)));
    }
    if (sd.viveQui.length) {
      box.append(el('div', { style:'color:var(--mut);margin-top:6px;' },
        '── per Alnus finite, qui non spedite (' + sd.viveQui.length + ') ──'));
      sd.viveQui.slice(0, 25).forEach(r => box.append(el('div', {},
        '   ' + r.numeroOrdine + '/' + r.pos + '  ' + r.codice + '  ' + r.stato
        + '  scad ' + (r.scadenza ? fmtIT(r.scadenza) : '—') + '  ·  ' + r.cliente
        + (r.kit ? '   (kit ' + r.kit + ': in Alnus non resta nessuna sua riga)'
          : (r.ordineNelFile ? '   (l\'ordine c\'è ancora: è sparita la riga)' : '')))));
      if (sd.viveQui.length > 25) box.append(el('div', { style:'color:var(--mut);' },
        '   ... e altre ' + (sd.viveQui.length - 25)));
    }
    dest.append(box);
    dest.append(nota('L\'estrazione contiene solo gli ordini ancora in corso su Alnus, '
      + 'quindi anche l\'assenza di una riga dice qualcosa. Nessuno dei due sistemi ha '
      + 'ragione per definizione: l\'import non tocca nessuno stato, si limita a dirlo. '
      + 'Assente da Alnus vuol dire spedito, quindi qui finiscono anche le COMPLETATE '
      + 'senza spedizioni registrate: là la merce risulta partita, qui no. '
      + 'I kit BOX si giudicano sul RIFERIMENTO e non sulla posizione — di là sono '
      + 'le 15-18 righe da cui il kit è stato fuso, quindi il kit è finito per Alnus '
      + 'solo quando di quel riferimento non resta più nessuna riga nel file.'
      + (sd.prodotteNonSpedite.length
          ? ' Fuori restano anche ' + sd.prodotteNonSpedite.length + ' commesse COMPLETATE '
            + 'qui e ancora aperte in Alnus: non è una divergenza, è lo stato normale di '
            + 'una commessa finita che non è ancora partita — Alnus chiude solo a merce spedita.'
          : '')));
  }

  dest = bFuori;
  // ── Righe che restano fuori ──
  if (piano.scartate.length) {
    dest.append(sezione(piano.scartate.length + ' righe non importate'));
    const sc = riquadro();
    Object.keys(piano.scartatePerMotivo).sort((a, b) =>
      piano.scartatePerMotivo[b] - piano.scartatePerMotivo[a]).forEach(m =>
      sc.append(el('div', {}, String(piano.scartatePerMotivo[m]).padStart(4) + '  ' + m)));
    dest.append(sc);
  }

  // ── Assemblaggio: i tre blocchi in ordine di importanza per chi legge ──
  // Le KPI in CIMA al blocco: `prepend` perche a questo punto le sezioni
  // hanno gia scritto dentro `bScrive`, e un append le metterebbe in fondo.
  bScrive.prepend(el('div', { class:'kpis' },
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Righe lette'),
      el('div', { class:'kv' }, String(piano.righeLette))),
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Commesse nuove'),
      el('div', { class:'kv kg' }, String(piano.nuove.length))),
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Da aggiornare'),
      el('div', { class:'kv' }, String(piano.aggiornamenti.length))),
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Già uguali'),
      el('div', { class:'kv' }, String(piano.invariate))),
  ));

  const intestazione = (n, titolo, spiega) => el('div', {
    style:'margin:22px 0 4px;padding-top:14px;border-top:2px solid var(--brd);' },
    el('div', { style:'font-family:Syne,sans-serif;font-weight:700;font-size:14px;' },
      n + '. ' + titolo),
    el('div', { class:'sub', style:'font-size:11px;margin-top:2px;' }, spiega));

  if (bScrive.childNodes.length) {
    body.append(intestazione(1, 'Cosa entra nel gestionale',
      'Solo questo viene scritto premendo Importa. Tutto il resto qui sotto non tocca niente.'));
    body.append(bScrive);
  }
  if (bFuori.childNodes.length) {
    body.append(intestazione(2, 'Cosa resta fuori',
      'Righe del file che non diventano commesse, e commesse che l\'import non tocca.'));
    body.append(bFuori);
  }
  if (bGuarda.childNodes.length) {
    body.append(intestazione(3, 'Da guardare: Alnus e gestionale non concordano',
      'Nessuna di queste righe viene modificata. Sono differenze fra i due archivi da sistemare a mano, in uno dei due.'));
    body.append(bGuarda);
  }

  modal.append(body);
  const foot = el('div', { class:'mfoot' });
  foot.append(el('button', { class:'btng', onclick:closeModal }, 'Annulla'));
  if (nDaScrivere) {
    foot.append(el('button', { class:'btnp', onclick: () => operazioniImportEsegui(piano) },
      'Importa · ' + piano.nuove.length + ' nuove, ' + piano.aggiornamenti.length + ' aggiornate'));
  } else {
    foot.append(el('span', { class:'sub', style:'font-size:11px;' },
      'Niente da scrivere: il gestionale è già allineato al file.'));
  }
  modal.append(foot);
  openModal(modal);
}

// Esegue il piano. L'ordine conta: prima le anagrafiche (senza le quali le
// commesse non hanno a cosa agganciarsi), poi gli inserimenti, poi gli
// aggiornamenti. Ogni passo che fallisce si ferma lì e lo dice: meglio un
// import a metà dichiarato che uno "riuscito" con dentro righe orfane.
async function operazioniImportEsegui(piano) {
  closeModal();
  let creatiCli = 0, creatiArt = 0, inseriti = 0, aggiornati = 0, errori = 0, rinominati = 0;

  try {
    // 0) Rinomine: Alnus detta il nome (decisione Nico 25 ago). Cambia SOLO
    // `nome` — l'id resta, quindi commesse, storico, tariffe e ruoli non si
    // muovono di un millimetro. Vengono prima degli inserimenti perché dopo
    // l'anagrafica dev'essere già nella forma definitiva.
    for (const r of piano.clientiDaRinominare) {
      const { data, error } = await eseguiConRetry(
        () => sb.from('aziende').update({ nome: r.a }).eq('id', r.id).select().single(),
        { label:'rinomina ' + r.da });
      if (error) { errori++; toast('Rinomina "' + r.da + '": ' + error.message, 'err'); continue; }
      const i = state.aziende.findIndex(a => a.id === data.id);
      if (i >= 0) state.aziende[i] = data;
      rinominati++;
    }

    // 1) Clienti nuovi
    for (const nome of piano.clientiDaCreare) {
      // Ultima rete prima di creare: la stessa ditta scritta in un altro modo
      // NON e' una ditta nuova. Il piano lo sa gia', ma qui si scrive davvero
      // e un doppione d'anagrafica poi va ripulito a mano.
      const k = importOrdiniChiaveNome(nome);
      const gia = state.aziende.find(a => importOrdiniChiaveNome(a.nome) === k);
      if (gia) continue;
      const { data, error } = await eseguiConRetry(
        () => sb.from('aziende').insert({ nome, attivo:true, is_cliente:true, is_fornitore:false })
          .select().single(), { label:'cliente ' + nome });
      if (error) throw new Error('cliente "' + nome + '": ' + error.message);
      state.aziende.push(data); creatiCli++;
    }
    // 2) Articoli nuovi
    for (const a of piano.articoliDaCreare) {
      const gia = state.articoli.find(x => (x.codice || '').toLowerCase().trim() === a.codice.toLowerCase().trim());
      if (gia) continue;
      const payload = { codice: a.codice, attivo: true };
      if (a.descrizione) payload.descrizione = a.descrizione;
      const { data, error } = await eseguiConRetry(
        () => sb.from('articoli').insert(payload).select().single(), { label:'articolo ' + a.codice });
      if (error) throw new Error('articolo "' + a.codice + '": ' + error.message);
      state.articoli.push(data); creatiArt++;
    }

    // 3) Le voci ripescano gli id appena nati
    // Stessa chiave del piano: qui il cliente si ripesca per forma giuridica
    // normalizzata, non per nome esatto, o si ricasca nel doppione.
    const cliByChiave = {}; state.aziende.forEach(a => {
      const k = importOrdiniChiaveNome(a.nome);
      if (k && cliByChiave[k] === undefined) cliByChiave[k] = a;
    });
    const artByCod  = {}; state.articoli.forEach(a => { if (a.codice) artByCod[a.codice.toLowerCase().trim()] = a; });

    // 4) Inserimenti, a blocchi
    const payloads = piano.nuove.map(v => {
      const cli = v.cliente || cliByChiave[importOrdiniChiaveNome(v.clienteNome)];
      const art = v.articolo || artByCod[v.codArt.toLowerCase().trim()];
      return {
        cliente_id: cli ? cli.id : null,
        articolo_id: art ? art.id : null,
        numero_ordine: v.numeroOrdine,
        pos: v.pos,
        quantita: v.qta,
        minuti_unitari: v.minutiUnitari || 0,
        scadenza: v.scadenza,
        prezzo_unitario: v.prezzo > 0 ? v.prezzo : null,
        riferimento_cliente: v.riferimento || null,
        stato: 'aperta',
        stato_preparazione: 'vuoto',
      };
    }).filter(p => p.cliente_id && p.articolo_id);

    const nate = [];
    for (let i = 0; i < payloads.length; i += 200) {
      const batch = payloads.slice(i, i + 200);
      const { data, error } = await eseguiConRetry(
        () => sb.from('operazioni').insert(batch).select(), { label:'import commesse' });
      if (error) { errori += batch.length; toast('Errore inserimento: ' + error.message, 'err'); continue; }
      (data || []).forEach(d => {
        if (!state.operazioni.find(x => x.id === d.id)) state.operazioni.push(d);
        nate.push(d);
      });
      inseriti += (data || []).length;
    }

    // 5) Aggiornamenti: SOLO i tre campi che vengono dall'ERP.
    for (const a of piano.aggiornamenti) {
      const patch = {};
      a.campi.forEach(c => {
        if (c.campo === 'quantita') patch.quantita = c.a;
        if (c.campo === 'scadenza') patch.scadenza = c.a;
        if (c.campo === 'prezzo')   patch.prezzo_unitario = c.a;
      });
      if (!Object.keys(patch).length) continue;
      const { data, error } = await eseguiConRetry(
        () => sb.from('operazioni').update(patch).eq('id', a.op.id).select().single(),
        { label:'aggiorna ' + a.voce.numeroOrdine });
      if (error) { errori++; continue; }
      const idx = state.operazioni.findIndex(x => x.id === data.id);
      if (idx >= 0) state.operazioni[idx] = data;
      aggiornati++;
    }

    // 6) Fasi automatiche sulle nuove, come fa "+ Nuovo ordine".
    // Best-effort: una fase mancante si aggiunge a mano, un import bloccato no.
    for (const r of nate) { try { await autoGeneraFasiDaMedia(r); } catch (e) {} }

  } catch (e) {
    toast('Import interrotto: ' + (e.message || e), 'err');
  }

  const pezzi = [];
  if (inseriti)   pezzi.push(inseriti + ' commesse create');
  if (aggiornati) pezzi.push(aggiornati + ' aggiornate');
  if (rinominati) pezzi.push(rinominati + ' clienti rinominati');
  if (creatiCli)  pezzi.push(creatiCli + ' clienti nuovi');
  if (creatiArt)  pezzi.push(creatiArt + ' articoli nuovi');
  if (piano.bloccate.length) pezzi.push(piano.bloccate.length + ' chiuse lasciate stare');
  if (errori)     pezzi.push(errori + ' errori');
  toast(pezzi.length ? 'Import: ' + pezzi.join(' · ') : 'Import: niente da fare',
        errori ? 'err' : 'ok');
  renderTab('pianificazione');
}

function articoliExportExcel() {
  if (typeof XLSX === 'undefined') {
    toast('Libreria Excel non caricata', 'err');
    return;
  }
  const rows = state.articoli.map(a => ({
    codice: a.codice,
    descrizione: a.descrizione || '',
    categoria: a.categoria || '',
    minuti: (a.minuti_unitari != null && a.minuti_unitari !== '') ? Number(a.minuti_unitari) : '',
    note: a.note || '',
    attivo: a.attivo ? 'sì' : 'no',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{wch:24},{wch:40},{wch:18},{wch:10},{wch:30},{wch:8}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Articoli');
  XLSX.writeFile(wb, 'articoli_'+new Date().toISOString().substring(0,10)+'.xlsx');
}



// ═══════════════════════════════════════════════════════════
// TIPI LAVORAZIONE — anagrafica piccola, lista chiusa
// ═══════════════════════════════════════════════════════════
const TIPI_LAV_COLORI = [
  '#4eb8ff', '#ffcc4e', '#4effa3', '#ff6b35',
  '#d4ff4e', '#ff4e6b', '#b88fff', '#6b6b64',
];

function renderTipiLavorazione(root) {
  const isAdmin = state.profile?.ruolo === 'admin';
  const list = state.tipiLav.slice().sort((a,b) => (a.ordine||0) - (b.ordine||0));

  root.innerHTML = '';
  const toolbar = el('div', { class:'toolbar' },
    el('h2', {}, 'Tipi di lavorazione'),
  );
  if (isAdmin) {
    toolbar.append(el('button', { class:'btnp', onclick:()=>openTipoLavModal() }, '+ Nuovo Tipo'));
  }
  root.append(toolbar);
  root.append(el('div', { class:'sub', style:'margin-bottom:14px;' },
    'Categorie di lavoro selezionabili dagli operatori al kiosk. L\'ordine determina come appaiono in lista.'));

  if (list.length === 0) {
    root.append(el('div', { class:'empty' }, 'Nessun tipo definito. Aggiungi il primo.'));
    return;
  }

  const tw = el('div', { class:'tw' });
  const tbl = el('table', { class:'rt' });
  tbl.append(el('thead', {}, el('tr', {},
    el('th', { class:'tc', style:'width:60px;' }, 'Ord.'),
    el('th', {}, 'Nome'),
    el('th', { class:'tc' }, 'Colore'),
    el('th', { class:'tc' }, 'Stato'),
    el('th', { class:'tc' }, 'Azioni'),
  )));
  const tb = el('tbody');
  list.forEach(t => {
    tb.append(el('tr', {},
      el('td', { class:'tc mono' }, String(t.ordine || 0)),
      el('td', {}, t.nome),
      el('td', { class:'tc' }, el('span', {
        style: `display:inline-block;width:24px;height:14px;border-radius:2px;background:${t.colore||'#6b6b64'};vertical-align:middle;border:1px solid var(--brd);`,
      })),
      el('td', { class:'tc' }, t.attivo
        ? el('span', { class:'badge bok' }, 'attivo')
        : el('span', { class:'badge bgry' }, 'disatt.')),
      el('td', { class:'tc' },
        isAdmin
          ? el('span', {},
              el('button', { class:'btnsm', onclick:()=>openTipoLavModal(t) }, 'Modifica'),
              ' ',
              el('button', { class:'btnd', onclick:()=>deleteTipoLav(t) }, 'Elimina'),
            )
          : '—'
      ),
    ));
  });
  tbl.append(tb);
  tw.append(tbl);
  root.append(tw);
}

function openTipoLavModal(t) {
  const isNew = !t;
  // Calcola prossimo ordine se è nuovo
  const nextOrdine = isNew
    ? (Math.max(0, ...state.tipiLav.map(x => x.ordine||0)) + 1)
    : t.ordine;
  t = t || { nome:'', ordine: nextOrdine, colore: TIPI_LAV_COLORI[state.tipiLav.length % TIPI_LAV_COLORI.length], attivo:true };

  const modal = el('div', { class:'modal' });
  modal.append(el('div', { class:'mhd' },
    el('h2', {}, isNew ? 'Nuovo Tipo di Lavorazione' : 'Modifica Tipo di Lavorazione'),
    el('button', { class:'mclose', onclick:closeModal }, '✕'),
  ));

  const body = el('div', { class:'mbody' });
  const form = el('form');

  const inNome = el('input', { type:'text', name:'nome', value:t.nome||'', required:'true' });
  const inOrdine = el('input', { type:'number', name:'ordine', value:String(t.ordine||0), min:'0' });
  const selAttivo = el('select', { name:'attivo' },
    el('option', { value:'true' }, 'Attivo'),
    el('option', { value:'false' }, 'Disattivato'));
  selAttivo.value = String(!!t.attivo);

  // Selettore colori a palette
  let coloreScelto = t.colore || TIPI_LAV_COLORI[0];
  const palette = el('div', { style:'display:flex;flex-wrap:wrap;gap:6px;padding:6px;background:var(--sur2);border:1px solid var(--brd);border-radius:4px;' });
  const refreshPalette = () => {
    palette.innerHTML = '';
    TIPI_LAV_COLORI.forEach(col => {
      const sel = col === coloreScelto;
      palette.append(el('button', {
        type:'button',
        style: `width:34px;height:28px;border-radius:3px;background:${col};border:2px solid ${sel?'var(--acc)':'transparent'};cursor:pointer;outline:none;`,
        onclick: () => { coloreScelto = col; refreshPalette(); },
      }));
    });
  };
  refreshPalette();

  form.append(
    el('div', { class:'field' }, el('label', {}, 'Nome *'), inNome,
      el('div', { class:'sub', style:'margin-top:4px;' },
        'Es. "Cablaggio", "Lavorazione meccanica", "Collaudo".')),
    el('div', { class:'frow' },
      el('div', { class:'field' }, el('label', {}, 'Ordine'), inOrdine,
        el('div', { class:'sub', style:'margin-top:4px;' }, 'Posizione nella lista.')),
      el('div', { class:'field' }, el('label', {}, 'Stato'), selAttivo),
    ),
    el('div', { class:'field' }, el('label', {}, 'Colore'), palette),
  );

  body.append(form);
  modal.append(body);

  const foot = el('div', { class:'mfoot' });
  foot.append(el('button', { class:'btng', onclick:closeModal }, 'Chiudi'));
  const btnSave = el('button', { class:'btnp' }, 'Salva');
  btnSave.onclick = async () => {
    const fd = new FormData(form);
    const payload = {
      nome: (fd.get('nome')||'').trim(),
      ordine: parseInt(fd.get('ordine')) || 0,
      colore: coloreScelto,
      attivo: fd.get('attivo') === 'true',
    };
    if (!payload.nome) return toast('Nome obbligatorio', 'err');
    btnSave.disabled = true;
    btnSave.textContent = 'Salvataggio…';
    try {
      const { data, error } = await eseguiConRetry(
        () => isNew ? sb.from('tipi_lavorazione').insert(payload).select().single() : sb.from('tipi_lavorazione').update(payload).eq('id', t.id).select().single(),
        { label: 'salvataggio tipi_lavorazione' }
      );
      if (error) {
        btnSave.disabled = false;
        btnSave.textContent = 'Salva';
        if (error.code === '23505') return toast('Nome già esistente', 'err');
        return toast(error.message, 'err');
      }
      if (isNew) {
        if (!state.tipiLav.find(x => x.id === data.id)) state.tipiLav.push(data);
      } else {
        state.tipiLav = state.tipiLav.map(x => x.id === t.id ? data : x);
      }
      toast(isNew ? 'Tipo creato' : 'Tipo aggiornato');
      closeModal(); renderTab('tipi_lav');
    } catch (e) {
      btnSave.disabled = false;
      btnSave.textContent = 'Salva';
      toast('Errore di rete: '+(e.message||e), 'err');
    }
  };
  foot.append(btnSave);
  modal.append(foot);
  openModal(modal);
}

async function deleteTipoLav(t) {
  if (!confirm(`Eliminare il tipo "${t.nome}"?\nNon sarà possibile se ci sono sessioni di lavoro associate.`)) return;
  const { data, error } = await sb.from('tipi_lavorazione').delete().eq('id', t.id).select();
  if (error) {
    if (error.code === '23503') return toast('Impossibile: ci sono sessioni di lavoro su questo tipo', 'err');
    return toast(error.message, 'err');
  }
  if (!data || data.length === 0) {
    return toast('Eliminazione bloccata: verifica le policy DELETE su tipi_lavorazione', 'err');
  }
  state.tipiLav = state.tipiLav.filter(x => x.id !== t.id);
  toast('Tipo eliminato'); renderTab('tipi_lav');
}

// ═══════════════════════════════════════════════════════════
// CHIUSURE AZIENDALI + FESTIVI NAZIONALI ITALIANI
// ═══════════════════════════════════════════════════════════

// Calcolo Pasqua con la formula di Gauss (per Pasqua e Pasquetta)
function calcolaPasqua(anno) {
  const a = anno % 19;
  const b = Math.floor(anno / 100);
  const c = anno % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mese = Math.floor((h + l - 7 * m + 114) / 31);
  const giorno = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(anno, mese - 1, giorno);
}

// Festivi nazionali italiani fissi (mese, giorno)
const FESTIVI_NAZ_FISSI = [
  { m:1, d:1,  nome:'Capodanno' },
  { m:1, d:6,  nome:'Epifania' },
  { m:4, d:25, nome:'Festa della Liberazione' },
  { m:5, d:1,  nome:'Festa del Lavoro' },
  { m:6, d:2,  nome:'Festa della Repubblica' },
  { m:8, d:15, nome:'Ferragosto' },
  { m:11,d:1,  nome:'Ognissanti' },
  { m:12,d:8,  nome:'Immacolata' },
  { m:12,d:25, nome:'Natale' },
  { m:12,d:26, nome:'Santo Stefano' },
];

// Ritorna l'elenco dei festivi nazionali per un dato anno
function festiviNazionali(anno) {
  const list = FESTIVI_NAZ_FISSI.map(f => ({
    data: new Date(anno, f.m-1, f.d),
    nome: f.nome,
  }));
  const pasqua = calcolaPasqua(anno);
  list.push({ data: pasqua, nome: 'Pasqua' });
  const pasquetta = new Date(pasqua);
  pasquetta.setDate(pasqua.getDate() + 1);
  list.push({ data: pasquetta, nome: 'Pasquetta' });
  return list.sort((a,b) => a.data - b.data);
}

// Set di ISO date "YYYY-MM-DD" per i festivi nazionali in un range di anni
function festiviNazIsoSet(annoMin, annoMax) {
  const s = new Set();
  for (let y = annoMin; y <= annoMax; y++) {
    festiviNazionali(y).forEach(f => s.add(toLocalISO(f.data)));
  }
  return s;
}

// Set di ISO date per le chiusure aziendali (con ricorrenza)
function chiusureIsoSet(annoMin, annoMax) {
  const s = new Set();
  state.chiusure.forEach(c => {
    if (!c.data) return;
    if (c.ricorrente) {
      // applica la stessa data ad ogni anno nel range
      const md = c.data.substring(5);  // "MM-DD"
      for (let y = annoMin; y <= annoMax; y++) {
        s.add(`${y}-${md}`);
      }
    } else {
      s.add(c.data);
    }
  });
  return s;
}

// Verifica se un dato giorno è non lavorativo (weekend, festivo nazionale o chiusura aziendale)
function isGiornoNonLavorativo(dateObj) {
  const dow = dateObj.getDay();
  if (dow === 0 || dow === 6) return true; // domenica o sabato
  const iso = toLocalISO(dateObj);
  const anno = dateObj.getFullYear();
  const festivi = festiviNazIsoSet(anno, anno);
  if (festivi.has(iso)) return true;
  const chiusure = chiusureIsoSet(anno, anno);
  if (chiusure.has(iso)) return true;
  return false;
}

// [→ domain/scheduling.js] calendario/capacità: indietroGiorniLavorativi…avantiOreCapacita


function renderChiusure(root) {
  const isAdmin = state.profile?.ruolo === 'admin';
  const annoAttuale = new Date().getFullYear();
  const annoFiltro = state.chiusureAnno || annoAttuale;

  // Costruisco lista unificata: festivi nazionali + chiusure aziendali per l'anno selezionato
  const items = [];
  // Festivi nazionali (calcolati, non modificabili)
  festiviNazionali(annoFiltro).forEach(f => {
    items.push({
      iso: toLocalISO(f.data),
      descrizione: f.nome,
      tipo: 'nazionale',
      dateObj: f.data,
    });
  });
  // Chiusure aziendali (database)
  state.chiusure.forEach(c => {
    const dateRel = c.ricorrente
      ? new Date(annoFiltro, parseInt(c.data.substring(5,7))-1, parseInt(c.data.substring(8,10)))
      : parseISODate(c.data);
    // Se non ricorrente, mostra solo nell'anno della data
    if (!c.ricorrente && dateRel.getFullYear() !== annoFiltro) return;
    items.push({
      id: c.id,
      iso: toLocalISO(dateRel),
      descrizione: c.descrizione + (c.ricorrente ? ' (ricorrente)' : ''),
      tipo: 'aziendale',
      ricorrente: c.ricorrente,
      dataOriginale: c.data,
      dateObj: dateRel,
    });
  });
  items.sort((a,b) => a.dateObj - b.dateObj);

  // KPI
  const totNaz = items.filter(x => x.tipo === 'nazionale').length;
  const totAz = items.filter(x => x.tipo === 'aziendale').length;
  // Conta giorni lavorativi nell'anno
  const iniAnno = toLocalISO(new Date(annoFiltro, 0, 1));
  const finAnno = toLocalISO(new Date(annoFiltro, 11, 31));
  const lav = contaGiorniLavorativi(iniAnno, finAnno);

  root.innerHTML = '';

  root.append(el('div', { class:'kpis' },
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Festivi nazionali'), el('div', { class:'kv kb' }, String(totNaz))),
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Chiusure aziendali'), el('div', { class:'kv ky' }, String(totAz))),
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Giorni lavorativi '+annoFiltro), el('div', { class:'kv kg' }, String(lav))),
  ));

  // Selettore anno
  const annoBar = el('div', { class:'chips' });
  for (let y = annoAttuale - 1; y <= annoAttuale + 2; y++) {
    annoBar.append(el('div', {
      class: 'chip' + (annoFiltro === y ? ' act' : ''),
      onclick: () => { state.chiusureAnno = y; renderTab('chiusure'); },
    }, String(y)));
  }
  root.append(annoBar);

  const toolbar = el('div', { class:'toolbar' },
    el('h2', {}, 'Festivi e chiusure aziendali'),
  );
  if (isAdmin) {
    toolbar.append(el('button', { class:'btnp', onclick:()=>openChiusuraModal() }, '+ Nuova Chiusura'));
  }
  root.append(toolbar);
  root.append(el('div', { class:'sub', style:'margin-bottom:14px;' },
    'I festivi nazionali italiani sono calcolati automaticamente (Pasqua compresa). Le chiusure aziendali si aggiungono qui sotto.'));

  if (items.length === 0) {
    root.append(el('div', { class:'empty' }, 'Nessuna chiusura per l\'anno selezionato.'));
    return;
  }

  const tw = el('div', { class:'tw' });
  const tbl = el('table', { class:'rt' });
  tbl.append(el('thead', {}, el('tr', {},
    el('th', {}, 'Data'),
    el('th', {}, 'Giorno'),
    el('th', {}, 'Descrizione'),
    el('th', { class:'tc' }, 'Tipo'),
    el('th', { class:'tc' }, 'Azioni'),
  )));
  const tb = el('tbody');
  const giorniSett = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];
  items.forEach(it => {
    tb.append(el('tr', {},
      el('td', { class:'mono' }, fmtIT(it.iso)),
      el('td', { class:'mono', style:'color:var(--mut);' }, giorniSett[it.dateObj.getDay()]),
      el('td', {}, it.descrizione),
      el('td', { class:'tc' }, it.tipo === 'nazionale'
        ? el('span', { class:'badge bblu' }, 'naz.')
        : el('span', { class:'badge byel' }, 'aziendale')),
      el('td', { class:'tc' },
        it.tipo === 'aziendale' && isAdmin
          ? el('span', {},
              el('button', { class:'btnsm', onclick:()=>openChiusuraModal(state.chiusure.find(c => c.id === it.id)) }, 'Modifica'),
              ' ',
              el('button', { class:'btnd', onclick:()=>deleteChiusura(state.chiusure.find(c => c.id === it.id)) }, 'Elimina'),
            )
          : '—'
      ),
    ));
  });
  tbl.append(tb);
  tw.append(tbl);
  root.append(tw);
}

function openChiusuraModal(c) {
  const isNew = !c;
  c = c || { data: toLocalISO(new Date()), descrizione:'', ricorrente:false };

  const modal = el('div', { class:'modal' });
  modal.append(el('div', { class:'mhd' },
    el('h2', {}, isNew ? 'Nuova Chiusura Aziendale' : 'Modifica Chiusura'),
    el('button', { class:'mclose', onclick:closeModal }, '✕'),
  ));

  const body = el('div', { class:'mbody' });
  const form = el('form');

  const inData = el('input', { type:'date', name:'data', value:c.data||'', required:'true' });
  const inDesc = el('input', { type:'text', name:'descrizione', value:c.descrizione||'', required:'true',
    placeholder:'es. Ponte 2 giugno, Ferie agosto, Festa patronale…' });
  const selRicorrente = el('select', { name:'ricorrente' },
    el('option', { value:'false' }, 'No — vale solo per quella data'),
    el('option', { value:'true' }, 'Sì — si ripete ogni anno alla stessa data'));
  selRicorrente.value = String(!!c.ricorrente);

  form.append(
    el('div', { class:'frow' },
      el('div', { class:'field' }, el('label', {}, 'Data *'), inData),
      el('div', { class:'field' }, el('label', {}, 'Ricorrente'), selRicorrente),
    ),
    el('div', { class:'field' }, el('label', {}, 'Descrizione *'), inDesc),
  );

  body.append(form);
  modal.append(body);

  const foot = el('div', { class:'mfoot' });
  foot.append(el('button', { class:'btng', onclick:closeModal }, 'Chiudi'));
  const btnSave = el('button', { class:'btnp' }, 'Salva');
  btnSave.onclick = async () => {
    const fd = new FormData(form);
    const payload = {
      data: fd.get('data'),
      descrizione: (fd.get('descrizione')||'').trim(),
      ricorrente: fd.get('ricorrente') === 'true',
    };
    if (!payload.data) return toast('Data obbligatoria', 'err');
    if (!payload.descrizione) return toast('Descrizione obbligatoria', 'err');
    btnSave.disabled = true;
    btnSave.textContent = 'Salvataggio…';
    try {
      const { data, error } = await eseguiConRetry(
        () => isNew ? sb.from('chiusure_aziendali').insert(payload).select().single() : sb.from('chiusure_aziendali').update(payload).eq('id', c.id).select().single(),
        { label: 'salvataggio chiusure_aziendali' }
      );
      if (error) {
        btnSave.disabled = false;
        btnSave.textContent = 'Salva';
        if (error.code === '23505') return toast('Esiste già una chiusura per questa data', 'err');
        return toast(error.message, 'err');
      }
      if (isNew) {
        if (!state.chiusure.find(x => x.id === data.id)) state.chiusure.push(data);
      } else {
        state.chiusure = state.chiusure.map(x => x.id === c.id ? data : x);
      }
      toast(isNew ? 'Chiusura creata' : 'Chiusura aggiornata');
      closeModal(); renderTab('chiusure');
    } catch (e) {
      btnSave.disabled = false;
      btnSave.textContent = 'Salva';
      toast('Errore di rete: '+(e.message||e), 'err');
    }
  };
  foot.append(btnSave);
  modal.append(foot);
  openModal(modal);
}

async function deleteChiusura(c) {
  if (!c) return;
  if (!confirm(`Eliminare la chiusura "${c.descrizione}" del ${fmtIT(c.data)}?`)) return;
  const { data, error } = await sb.from('chiusure_aziendali').delete().eq('id', c.id).select();
  if (error) return toast(error.message, 'err');
  if (!data || data.length === 0) return toast('Eliminazione bloccata: verifica le policy DELETE', 'err');
  state.chiusure = state.chiusure.filter(x => x.id !== c.id);
  toast('Chiusura eliminata'); renderTab('chiusure');
}

// ═══════════════════════════════════════════════════════════
// PIANIFICAZIONE — operazioni di lavoro
// ═══════════════════════════════════════════════════════════

const OP_STATI = {
  aperta:     { label:'Aperta',     badge:'bok',  color:'var(--grn)' },
  sospesa:    { label:'Sospesa',    badge:'byel', color:'var(--yel)' },
  completata: { label:'Completata', badge:'bblu', color:'var(--blu)' },
  spedita: { label:'Spedita', badge:'bgry', color:'var(--mut)' },
};
const OP_PREP = {
  vuoto:    { label:'Vuoto',    classe:'vuoto' },
  parziale: { label:'Parziale', classe:'parziale' },
  completo: { label:'Completo', classe:'completo' },
};

// [→ domain/scheduling.js] motore commesse/fasi: opFasiOf…opIsRitardo

// ─── MAGAZZINO ─────────────────────────────────────────────────────
// La scheda MAGAZZINO viveva qui (tolta il 27 ago, richiesta Nico).
// Elencava le commesse con pezzi in giacenza — prodotti meno spediti — ed è
// diventata ridondante quando Ordini cliente ha guadagnato le tre colonne
// ORDINATI / PRODOTTI / SPEDITI: la giacenza è la differenza fra le ultime
// due e adesso si legge dove si guarda già. `pezziInMagazzino()` resta e
// serve ancora: la usa il controllo "non puoi spedire quel che non hai
// prodotto" nel modal commessa.
function openFiltroClientiPopup(anchorBtn, opts) {
  // opts opzionale { set, tab, onChange }: permette di riusare il popup in altri
  // tab. Senza opts = comportamento Pianificazione invariato.
  opts = opts || {};
  const escl = opts.set || state.opClientiEsclusi;
  const tab = opts.tab || 'pianificazione';
  const onChange = opts.onChange || (() => salvaFiltroClienti(state.opClientiEsclusi));
  const riapri = () => {
    const btnNuovo = document.querySelector('.toolbar button[title^="Filtro"], .toolbar button[title^="Filtra"]');
    if (btnNuovo) openFiltroClientiPopup(btnNuovo, opts);
  };
  // Solo i clienti che hanno commesse — non ha senso filtrare clienti senza ordini
  const clientiConCommesse = new Set(state.operazioni.map(o => o.cliente_id).filter(Boolean));
  const clientiLista = state.aziende
    .filter(c => clientiConCommesse.has(c.id))
    .slice()
    .sort((a, b) => a.nome.localeCompare(b.nome));

  // Chiudi popup esistenti
  document.querySelectorAll('.filtro-cli-popup').forEach(p => p.remove());

  const popup = el('div', { class: 'filtro-cli-popup' });

  // Posiziono il popup sotto al pulsante che l'ha aperto
  const rect = anchorBtn.getBoundingClientRect();
  popup.style.cssText = `
    position:fixed;top:${rect.bottom + 4}px;left:${rect.left}px;
    background:var(--sur);border:1px solid var(--brd);border-radius:6px;
    box-shadow:0 8px 20px rgba(0,0,0,.4);padding:12px;
    width:320px;max-height:480px;display:flex;flex-direction:column;gap:10px;
    z-index:500;font-family:inherit;
  `;

  // Intestazione + ricerca
  popup.append(el('div', { style:'font-size:11px;color:var(--mut);font-family:"JetBrains Mono",monospace;' },
    'Spunta i clienti da mostrare. Deseleziona quelli da nascondere.'));

  const inputRicerca = el('input', {
    type:'text', placeholder:'Cerca cliente…',
    style:'width:100%;background:var(--sur2);border:1px solid var(--brd);color:var(--txt);padding:6px 10px;border-radius:3px;font-family:inherit;font-size:12px;outline:none;',
  });

  // Pulsanti rapidi tutti/nessuno
  const btnTutti = el('button', { class:'btnsm', style:'flex:1;' }, 'Tutti');
  const btnNessuno = el('button', { class:'btnsm', style:'flex:1;' }, 'Nessuno');
  const rowAzioni = el('div', { style:'display:flex;gap:6px;' }, btnTutti, btnNessuno);

  // Lista checkbox scrollabile
  const listaCnt = el('div', {
    style:'flex:1;overflow-y:auto;border:1px solid var(--brd);border-radius:3px;padding:4px;background:var(--sur2);',
  });

  // Funzione che ridisegna la lista (richiamata al digitare nella ricerca)
  const ridisegnaLista = () => {
    const q = (inputRicerca.value || '').toLowerCase();
    listaCnt.innerHTML = '';
    const filtrati = q
      ? clientiLista.filter(c => c.nome.toLowerCase().includes(q))
      : clientiLista;
    if (filtrati.length === 0) {
      listaCnt.append(el('div', { style:'padding:12px;text-align:center;color:var(--mut);font-size:11px;' },
        'Nessun cliente trovato.'));
      return;
    }
    filtrati.forEach(c => {
      const inclusoOra = !escl.has(c.id);
      const lbl = el('label', {
        style:'display:flex;align-items:center;gap:8px;padding:5px 8px;cursor:pointer;border-radius:3px;font-size:12px;user-select:none;',
        onmouseover: e => e.currentTarget.style.background = 'var(--sur)',
        onmouseout: e => e.currentTarget.style.background = 'transparent',
      });
      const cb = el('input', {
        type:'checkbox',
        checked: inclusoOra ? 'true' : null,
        onchange: e => {
          if (e.target.checked) escl.delete(c.id);
          else escl.add(c.id);
          onChange();
          // Ridisegno la tabella (senza chiudere il popup)
          renderTab(tab);
          // Riapro il popup riposizionato — renderTab ha sostituito il pulsante
          riapri();
        },
      });
      // Imposto checked nativamente dopo (più affidabile)
      cb.checked = inclusoOra;
      lbl.append(cb, el('span', {}, c.nome));
      listaCnt.append(lbl);
    });
  };

  inputRicerca.oninput = ridisegnaLista;

  btnTutti.onclick = () => {
    escl.clear();
    onChange();
    renderTab(tab);
    riapri();
  };
  btnNessuno.onclick = () => {
    clientiLista.forEach(c => escl.add(c.id));
    onChange();
    renderTab(tab);
    riapri();
  };

  popup.append(inputRicerca, rowAzioni, listaCnt);
  document.body.append(popup);
  ridisegnaLista();
  inputRicerca.focus();

  // Chiusura: clic fuori dal popup
  setTimeout(() => {  // setTimeout per non beccare il clic che ha aperto il popup
    const closeOnOutside = (e) => {
      if (!popup.contains(e.target)) {
        popup.remove();
        document.removeEventListener('mousedown', closeOnOutside);
      }
    };
    document.addEventListener('mousedown', closeOnOutside);
  }, 0);
}

// Popup filtro a SELEZIONE SINGOLA (stile "Filtra clienti"): sostituisce i
// <select> nativi, che in dark mode il browser disegna col suo tema
// (testo illeggibile). Riusabile: addetti, fornitori, ecc.
// opts: { titolo, vuotoLabel, opzioni:[{id,nome}], valore, onPick(id) }
function openFiltroSingoloPopup(anchorBtn, opts) {
  opts = opts || {};
  const opzioni = opts.opzioni || [];
  document.querySelectorAll('.filtro-cli-popup').forEach(p => p.remove());

  const popup = el('div', { class: 'filtro-cli-popup' });
  const rect = anchorBtn.getBoundingClientRect();
  // Ancoro a destra del pulsante se sfora lo schermo a sinistra
  const left = Math.min(rect.left, window.innerWidth - 300);
  popup.style.cssText = `
    position:fixed;top:${rect.bottom + 4}px;left:${left}px;
    background:var(--sur);border:1px solid var(--brd);border-radius:6px;
    box-shadow:0 8px 20px rgba(0,0,0,.4);padding:12px;
    width:280px;max-height:460px;display:flex;flex-direction:column;gap:10px;
    z-index:500;font-family:inherit;`;

  if (opts.titolo) popup.append(el('div',
    { style:'font-size:11px;color:var(--mut);font-family:"JetBrains Mono",monospace;' }, opts.titolo));

  const inputRicerca = el('input', {
    type:'text', placeholder:'Cerca…',
    style:'width:100%;background:var(--sur2);border:1px solid var(--brd);color:var(--txt);padding:6px 10px;border-radius:3px;font-family:inherit;font-size:12px;outline:none;',
  });
  const listaCnt = el('div', {
    style:'flex:1;overflow-y:auto;border:1px solid var(--brd);border-radius:3px;padding:4px;background:var(--sur2);',
  });

  const scegli = (id) => { popup.remove(); if (typeof opts.onPick === 'function') opts.onPick(id); };
  const voce = (id, nome, attivo) => {
    const row = el('div', {
      style:'display:flex;align-items:center;gap:8px;padding:6px 8px;cursor:pointer;border-radius:3px;font-size:12px;user-select:none;'
        + (attivo ? 'background:var(--acc);color:var(--bg);font-weight:700;' : 'color:var(--txt);'),
      onmouseover: e => { if (!attivo) e.currentTarget.style.background = 'var(--sur)'; },
      onmouseout: e => { if (!attivo) e.currentTarget.style.background = 'transparent'; },
      onclick: () => scegli(id),
    }, el('span', { style:'width:12px;flex-shrink:0;' }, attivo ? '✓' : ''), el('span', {}, nome));
    return row;
  };
  const ridisegna = () => {
    const q = (inputRicerca.value || '').toLowerCase();
    listaCnt.innerHTML = '';
    listaCnt.append(voce('', opts.vuotoLabel || 'Tutti', !opts.valore));
    const filtrati = q ? opzioni.filter(o => (o.nome || '').toLowerCase().includes(q)) : opzioni;
    filtrati.forEach(o => listaCnt.append(voce(o.id, o.nome, opts.valore === o.id)));
  };
  inputRicerca.oninput = ridisegna;

  popup.append(inputRicerca, listaCnt);
  document.body.append(popup);
  ridisegna();
  inputRicerca.focus();

  setTimeout(() => {
    const closeOnOutside = (e) => {
      if (!popup.contains(e.target)) {
        popup.remove();
        document.removeEventListener('mousedown', closeOnOutside);
      }
    };
    document.addEventListener('mousedown', closeOnOutside);
  }, 0);
}

// Lista riordinabile per trascinamento (drag nativo, mouse). Usata sia dal
// gestionale sia dal kiosk, così il riordino è identico nei due posti.
// items: array di operazioni. Ritorna { el, order } dove order() ridà gli id
// nell'ordine corrente.
function buildPrioList(items) {
  let arr = items.slice();
  const list = el('div', { class:'prio-list' });
  function rebuild() {
    const ids = [...list.querySelectorAll('.prio-row')].map(r => r.dataset.id);
    arr = ids.map(id => arr.find(o => o.id === id)).filter(Boolean);
  }
  function render() {
    list.innerHTML = '';
    arr.forEach((op, i) => {
      const cli = state.aziende.find(c => c.id === op.cliente_id);
      const art = state.articoli.find(a => a.id === op.articolo_id);
      const row = el('div', { class:'prio-row', draggable:'true' },
        el('span', { class:'prio-grip' }, '⠿'),
        el('span', { class:'prio-num' }, String(i + 1)),
        el('div', { class:'prio-main' },
          el('div', { class:'prio-code' }, art?.codice || op.numero_ordine || '—'),
          el('div', { class:'prio-sub' },
            (cli?.nome || '—') + (op.numero_ordine ? ' · ' + op.numero_ordine : '')),
        ),
        el('div', { class:'prio-scad' }, op.scadenza ? fmtIT(op.scadenza) : '—'),
      );
      row.dataset.id = op.id;
      row.addEventListener('dragstart', () => row.classList.add('dragging'));
      row.addEventListener('dragend', () => { row.classList.remove('dragging'); rebuild(); render(); });
      list.append(row);
    });
  }
  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    const dragging = list.querySelector('.dragging');
    if (!dragging) return;
    const others = [...list.querySelectorAll('.prio-row:not(.dragging)')];
    let after = null, best = -Infinity;
    others.forEach(r => {
      const box = r.getBoundingClientRect();
      const off = e.clientY - box.top - box.height / 2;
      if (off < 0 && off > best) { best = off; after = r; }
    });
    if (after == null) list.appendChild(dragging);
    else list.insertBefore(dragging, after);
  });
  render();
  return { el: list, order: () => { rebuild(); return arr.map(o => o.id); } };
}

// Persiste solo le priorità cambiate e aggiorna la cache locale. Ritorna il
// numero di righe cambiate. NON ridisegna (lascia decidere al chiamante).
async function persistPriorita(coppie) {
  const cambiate = coppie.filter(c => {
    const op = state.operazioni.find(o => o.id === c.id);
    return op && (op.priorita ?? null) !== (c.priorita ?? null);
  });
  if (cambiate.length === 0) return 0;
  await Promise.all(cambiate.map(c =>
    sb.from('operazioni').update({ priorita: c.priorita }).eq('id', c.id)));
  cambiate.forEach(c => {
    const op = state.operazioni.find(o => o.id === c.id);
    if (op) op.priorita = c.priorita;
  });
  return cambiate.length;
}

// ── Proposta fasi per una commessa ───────────────────────────────────────
// Usa le fasi EFFETTIVE dell'articolo (media storica viva dove esiste,
// template per i tipi senza storico). Scarta le voci a 0 minuti: non si
// pianifica il nulla. Marca "debole" se una media si basa su una sola
// commessa chiusa.
function proponiFasiPerCommessa(o) {
  if (!o || !o.articolo_id) return null;
  const eff = fasiEffettiveArticolo(o.articolo_id)
    .filter(f => (Number(f.minuti_unitari) || 0) > 0);
  if (!eff.length) return null;
  const debole = eff.some(f => f.fonte === 'storico' && f.nCommesse <= 1);
  return {
    fasi: eff.map((f, i) => ({ tipo_lavorazione_id: f.tipo_lavorazione_id,
      minuti_unitari: f.minuti_unitari, ordine: i + 1 })),
    fonte: 'effettive', debole,
  };
}

// Genera e PERSISTE le fasi di una commessa dalla media storica — solo
// dati, niente template, niente assegnazione operatori (gli operatori si
// iscrivono al kiosk). Best-effort: ritorna { creato, debole } oppure null se
// non c'è storico spedito o le fasi esistono già.
async function autoGeneraFasiDaMedia(op) {
  if (!op || !op.articolo_id) return null;
  if ((state.opFasi || []).some(f => f.operazione_id === op.id)) return null;
  const p = proponiFasiPerCommessa(op);
  if (!p || !p.fasi.length) return null;
  const rows = p.fasi.map(f => ({
    operazione_id: op.id,
    tipo_lavorazione_id: f.tipo_lavorazione_id,
    minuti_unitari: f.minuti_unitari,
    ordine: f.ordine,
  }));
  const { data, error } = await sb.from('operazioni_fasi').insert(rows).select();
  if (error || !data) return null;
  data.forEach(r => { if (!state.opFasi.find(x => x.id === r.id)) state.opFasi.push(r); });
  return { creato: data.length, debole: !!p.debole };
}

// ── NUOVO ORDINE: unica porta d'inserimento (1 riga = ordine singolo,
// N righe = più posizioni). L'intestazione (cliente + numero OC) si mette una
// volta; ogni riga è una posizione (pos, articolo, rif. cliente, quantità,
// prezzo, scadenza) e diventa una operazione che condivide cliente_id +
// numero_ordine. Cliente e articoli si possono creare al volo (come il vecchio
// modal). Il resto (addetti, fasi, note…) si affina cliccando la commessa.
function openNuovoOrdineModal() {
  if (state.profile?.ruolo !== 'admin') return;
  if (state.aziende.length === 0 || state.articoli.length === 0)
    return toast('Servono prima clienti e articoli.', 'err');
  const prezzoAttivo = (state.operazioni || []).some(x => 'prezzo_unitario' in x);
  const cols = '62px minmax(220px,1fr) 140px 150px 64px' + (prezzoAttivo ? ' 96px' : '') + ' 76px 148px 28px';

  const modal = el('div', { class:'modal', style:'max-width:1240px;width:95vw;' });
  modal.append(el('div', { class:'mhd' },
    el('h2', {}, 'Nuovo ordine'),
    el('button', { class:'mclose', onclick:closeModal }, '✕'),
  ));
  const body = el('div', { class:'mbody' });

  // Intestazione condivisa
  const acCliente = makeAutocompleteCreate({
    items: state.aziende.filter(c => c.attivo && c.is_cliente !== false),
    getLabel: c => c.nome, placeholder:'Cerca o digita nuovo cliente…', entityLabel:'cliente',
    onChange: () => righe.forEach(r => r.prefillPrezzo()),
  });
  const inpOC = el('input', { type:'text', class:'ord-inp', value: new Date().getFullYear() + '/OC/',
    placeholder:'2026/OC/00001', pattern:'\\d{4}/OC/\\d{5}',
    onblur:(e)=>{ const m=e.target.value.trim().match(/^(\d{4})\/OC\/(\d{1,4})$/); if(m) e.target.value=m[1]+'/OC/'+m[2].padStart(5,'0'); } });
  // Intestazione: il campo OC replica ESATTAMENTE la geometria del cliente
  // (margin-top:6px come .util-dropwrap + spaziatore alto quanto l'hint),
  // così i due input sono sovrapponibili al pixel (misurato: 121→153 entrambi).
  inpOC.style.marginTop = '6px';
  body.append(el('div', { style:'display:grid;grid-template-columns:1fr 300px;gap:14px;align-items:start;' },
    el('div', { class:'field' }, el('label', { style:'white-space:nowrap;' }, 'Cliente *'), acCliente.container),
    el('div', { class:'field' }, el('label', { style:'white-space:nowrap;' }, 'Numero ordine (OC) *'), inpOC,
      el('div', { style:'min-height:14px;margin-top:4px;' })),
  ));

  const clienteId = () => { const v = acCliente.getValue(); return (v.mode==='existing' && v.id) ? v.id : null; };
  // UNA SOLA griglia per intestazioni + tutte le righe: le colonne sono
  // garantite identiche (niente drift tra header e input). Ogni riga è un
  // wrapper display:contents, così le sue celle vivono nella griglia padre.
  const griglia = el('div', { style:'display:grid;grid-template-columns:'+cols+';column-gap:8px;row-gap:8px;align-items:start;margin-top:10px;' });
  const hCell = (t) => el('div', { style:'font-size:11px;color:var(--mut);text-transform:uppercase;letter-spacing:.06em;align-self:end;padding-bottom:2px;' }, t);
  griglia.append(hCell('Pos'), hCell('Codice articolo'), hCell('Numero OP'), hCell('Rif. cliente'), hCell('Q.tà'),
    ...(prezzoAttivo ? [hCell('€/pz')] : []), hCell('Min/pz'), hCell('Scadenza'), hCell(''));
  const totBar = el('div', { style:'margin-top:8px;font-family:JetBrains Mono,monospace;font-size:14px;font-weight:700;text-align:right;' });

  let righe = [];
  const aggiornaTotale = () => {
    if (!prezzoAttivo) { totBar.textContent = ''; return; }
    let tot = 0, n = 0;
    righe.forEach(r => { const d = r.getData(); if (d.getVal.mode!=='empty' && d.quantita>0 && d.prezzo>0) { tot += d.quantita*d.prezzo; n++; } });
    totBar.textContent = tot > 0 ? 'Totale ordine: € ' + tot.toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2}) : '';
  };

  function creaRiga() {
    const acArt = makeAutocompleteCreate({
      items: state.articoli.filter(a => a.attivo), getLabel:a=>a.codice,
      placeholder:'Cerca o digita nuovo codice…', entityLabel:'articolo',
      onChange: () => { riga.prefillPrezzo(); aggiornaTotale(); },
    });
    // POS pre-compilata a multipli di 10 (0010, 0020, …), modificabile.
    const posAuto = String((righe.length + 1) * 10).padStart(4, '0');
    // Come per l'OP qui sotto: uscendo dal campo la posizione prende la sua
    // forma canonica a 4 cifre, così si VEDE che è stata capita.
    const inPos = el('input', { type:'text', class:'ord-inp', value: posAuto, placeholder:'0010',
      onblur:(e)=>{ e.target.value = posNormalizzata(e.target.value) || ''; } });
    // L'OP si scrive come capita — 2026OP1727 sui documenti, 2026/OP/1727 a
    // mano — e uscendo dal campo diventa la forma canonica, così si VEDE che è
    // stato capito. Prima accettava solo il formato esatto e buttava via il
    // resto in silenzio: si salvava l'ordine e l'OP semplicemente non c'era.
    const inOP = el('input', { type:'text', class:'ord-inp', placeholder:'OP (opz.)',
      title:'Numero OP. Va bene 2026OP1727 o 2026/OP/1727: viene normalizzato da solo.',
      onblur:(e)=>{ const n=odlANumeroOp(e.target.value); if(n) e.target.value=n;
        e.target.style.borderColor = (!e.target.value.trim() || n) ? '' : 'var(--red)'; } });
    const inRif = el('input', { type:'text', class:'ord-inp', placeholder:'rif.' });
    const inQta = el('input', { type:'number', class:'ord-inp', value:'1', min:'1', oninput:()=>aggiornaTotale() });
    const inPrezzo = prezzoAttivo ? el('input', { type:'number', class:'ord-inp', min:'0', step:'0.01', placeholder:'€',
      oninput:()=>{ aggiornaTotale(); riga.aggiornaMinHint(); } }) : null;
    // Minuti pagati (min/pz): VUOTO = automatico. Priorità al salvataggio:
    // 1) valore digitato qui  2) regola tariffa cliente (da prezzo)
    // 3) default articolo. Il placeholder mostra live il valore automatico.
    const inMin = el('input', { type:'number', class:'ord-inp', min:'0', step:'1',
      title:'Minuti pagati per pezzo. Vuoto = automatico: dal prezzo se il cliente ha una tariffa €/h, altrimenti dal default articolo. Un valore scritto qui vince su tutto.' });
    const inScad = el('input', { type:'date', class:'ord-inp' });
    const btnX = el('button', { type:'button', class:'btnd', style:'align-self:start;padding:6px 8px;',
      onclick:()=>{ righe = righe.filter(r=>r!==riga); riga.el.remove(); if(!righe.length) creaRiga(); aggiornaTotale(); } }, '✕');
    // Wrapper display:contents: le celle entrano nella griglia padre.
    const row = el('div', { style:'display:contents;' },
      inPos, acArt.container, inOP, inRif, inQta, ...(prezzoAttivo?[inPrezzo]:[]), inMin, inScad, btnX);
    const riga = {
      el: row,
      getData: () => {
        const v = acArt.getValue();
        const opRaw = (inOP.value||'').trim();
        const minRaw = (inMin.value||'').toString().trim();
        const minVal = minRaw === '' ? null : parseFloat(minRaw.replace(',','.'));
        return {
          getVal: v,
          articoloId: (v.mode==='existing' && v.id) ? v.id : null,
          nuovoCodice: (v.mode==='new') ? (v.text||'').trim() : null,
          pos: posNormalizzata(inPos.value),
          numero_op: odlANumeroOp(opRaw),
          opIlleggibile: !!opRaw && !odlANumeroOp(opRaw),
          riferimento_cliente: (inRif.value||'').trim() || null,
          quantita: parseInt(inQta.value)||0,
          prezzo: inPrezzo ? (parseFloat((inPrezzo.value||'').replace(',','.'))||0) : 0,
          minuti: (Number.isFinite(minVal) && minVal >= 0) ? minVal : null,
          scadenza: inScad.value || null,
        };
      },
      prefillPrezzo: () => {
        if (!inPrezzo) { riga.aggiornaMinHint(); return; }
        const v = acArt.getValue();
        const aId = (v.mode==='existing' && v.id) ? v.id : null;
        if (!aId) { aggiornaTotale(); riga.aggiornaMinHint(); return; }
        const list = prezzoListino(aId, clienteId());
        if ((inPrezzo.value||'').trim()==='' && list) inPrezzo.value = String(list.prezzo);
        aggiornaTotale();
        riga.aggiornaMinHint();
      },
      // Placeholder = il valore AUTOMATICO che verrà usato se la casella
      // resta vuota (da prezzo con tariffa cliente, altrimenti articolo).
      aggiornaMinHint: () => {
        const cli = state.aziende.find(a => a.id === clienteId());
        const tariffa = Number(cli && cli.tariffa_cliente) || 0;
        const prezzo = inPrezzo ? (parseFloat((inPrezzo.value||'').replace(',','.'))||0) : 0;
        if (tariffa > 0 && prezzo > 0) {
          inMin.placeholder = String(Math.round(prezzo / tariffa * 60));
          inMin.title = 'Automatico DA PREZZO: ' + Math.round(prezzo / tariffa * 60)
            + ' min/pz (' + String(prezzo).replace('.', ',') + ' € ÷ '
            + String(tariffa).replace('.', ',') + ' €/h). Scrivi un valore per forzarlo.';
          return;
        }
        const v = acArt.getValue();
        const art = (v.mode==='existing' && v.id) ? state.articoli.find(a => a.id === v.id) : null;
        if (art && art.minuti_unitari != null && art.minuti_unitari !== '') {
          inMin.placeholder = String(art.minuti_unitari);
          inMin.title = 'Automatico dal default articolo: ' + art.minuti_unitari
            + ' min/pz. Scrivi un valore per forzarlo.';
        } else {
          inMin.placeholder = 'min';
          inMin.title = 'Minuti pagati per pezzo. Vuoto = automatico (da prezzo con tariffa cliente, altrimenti default articolo).';
        }
      },
    };
    righe.push(riga);
    griglia.append(row);
    riga.aggiornaMinHint();
    return riga;
  }
  for (let i = 0; i < 5; i++) creaRiga();  // 5 posizioni pronte; le vuote non si inseriscono

  // Aggiungi N posizioni in un colpo (default 1): scrivi il numero e premi.
  const inpAddN = el('input', { type:'number', class:'ord-inp', value:'1', min:'1', max:'50', style:'width:60px;' });
  const btnAddN = el('button', { class:'btnsm',
    onclick:()=>{ const n=Math.max(1,Math.min(50, parseInt(inpAddN.value)||1)); for(let i=0;i<n;i++) creaRiga(); } },
    '+ Aggiungi posizioni');
  body.append(griglia,
    el('div', { style:'display:flex;align-items:center;gap:8px;margin-top:12px;' },
      btnAddN, inpAddN, el('span', { class:'sub' }, 'righe alla volta')),
    totBar);
  modal.append(body);

  const foot = el('div', { class:'mfoot' });
  foot.append(el('button', { class:'btng', onclick:closeModal }, 'Annulla'));
  const btnSave = el('button', { class:'btnp' }, 'Crea ordine');
  btnSave.onclick = async () => {
    const cliVal = acCliente.getValue();
    const oc = (inpOC.value||'').trim();
    if (cliVal.mode === 'empty') return toast('Cliente obbligatorio', 'err');
    if (!/^\d{4}\/OC\/\d{5}$/.test(oc)) return toast('Numero ordine nel formato AAAA/OC/NNNNN', 'err');
    const dati = righe.map(r => r.getData()).filter(d => (d.articoloId || d.nuovoCodice) && d.quantita > 0);
    if (!dati.length) return toast('Aggiungi almeno una posizione con articolo e quantità', 'err');
    // Un OP scritto e non capito si FERMA qui: prima veniva scartato in
    // silenzio e l'ordine nasceva senza, senza che nessuno se ne accorgesse.
    const opKo = dati.filter(d => d.opIlleggibile);
    if (opKo.length) {
      return toast('Numero OP non riconosciuto su ' + opKo.length
        + (opKo.length === 1 ? ' posizione' : ' posizioni')
        + '. Usa 2026OP1727 oppure 2026/OP/01727, o lascia vuoto.', 'err');
    }
    btnSave.disabled = true; btnSave.textContent = 'Creazione…';
    try {
      // 1) Cliente nuovo (se serve)
      let cId = (cliVal.mode==='existing' && cliVal.id) ? cliVal.id : null;
      if (!cId && cliVal.mode==='new') {
        const { data: nc, error: ec } = await sb.from('aziende')
          .insert({ nome: cliVal.text, attivo:true, is_cliente:true, is_fornitore:false }).select().single();
        if (ec) throw new Error('cliente: '+ec.message);
        if (!state.aziende.find(x=>x.id===nc.id)) state.aziende.push(nc);
        cId = nc.id;
      }
      // 2) Articoli nuovi (uno per codice, riusati tra righe)
      const nuoviCodici = [...new Set(dati.filter(d=>!d.articoloId && d.nuovoCodice).map(d=>d.nuovoCodice))];
      const codiceToId = {};
      for (const cod of nuoviCodici) {
        const gia = state.articoli.find(a => (a.codice||'').toLowerCase() === cod.toLowerCase());
        if (gia) { codiceToId[cod] = gia.id; continue; }
        const { data: na, error: ea } = await sb.from('articoli').insert({ codice: cod, attivo:true }).select().single();
        if (ea) throw new Error('articolo "'+cod+'": '+ea.message);
        if (!state.articoli.find(x=>x.id===na.id)) state.articoli.push(na);
        codiceToId[cod] = na.id;
      }
      // 3) Payload delle posizioni
      // REGOLA tariffa cliente (dato d'anagrafica, es. Elcotec 27,3 €/h):
      // il prezzo riga è SOLO manodopera → il tempo pagato esce dal prezzo
      // (min/pz = prezzo ÷ tariffa × 60) e vince sul default dell'articolo.
      // Senza prezzo sulla riga, resta il default dell'articolo.
      const tariffaCli = Number((state.aziende.find(a => a.id === cId) || {}).tariffa_cliente) || 0;
      let posDaTariffa = 0;
      const payloads = dati.map(d => {
        const artId = d.articoloId || codiceToId[d.nuovoCodice];
        const art = state.articoli.find(a => a.id === artId);
        const p = {
          cliente_id: cId, articolo_id: artId, numero_ordine: oc,
          pos: d.pos, numero_op: d.numero_op, riferimento_cliente: d.riferimento_cliente, quantita: d.quantita,
          minuti_unitari: (art && art.minuti_unitari != null) ? Number(art.minuti_unitari) : 0,
          scadenza: d.scadenza, stato:'aperta', stato_preparazione:'vuoto',
        };
        if (prezzoAttivo) p.prezzo_unitario = d.prezzo > 0 ? d.prezzo : null;
        // Priorità minuti pagati: 1) digitati a mano nella colonna Min/pz
        // 2) regola tariffa cliente (da prezzo) 3) default articolo (già in p).
        // Sempre al minuto intero: operazioni.minuti_unitari è INTEGER nel DB.
        if (d.minuti != null) {
          p.minuti_unitari = Math.round(d.minuti);
        } else if (tariffaCli > 0 && d.prezzo > 0) {
          p.minuti_unitari = Math.round(d.prezzo / tariffaCli * 60);
          posDaTariffa++;
        }
        return p;
      });
      const { data, error } = await sb.from('operazioni').insert(payloads).select();
      if (error) throw new Error(error.message);
      (data||[]).forEach(r => { if (!state.operazioni.find(x=>x.id===r.id)) state.operazioni.push(r); });
      for (const r of (data||[])) { try { await autoGeneraFasiDaMedia(r); } catch(e){} }
      // Semina i minuti pagati sull'anagrafica articolo SOLO dove mancano
      // (stesso pattern del modal commessa: si popola il vuoto, mai si
      // sovrascrive uno standard già impostato). Copre i codici creati al
      // volo. Best-effort: non blocca la creazione dell'ordine.
      let seminati = 0;
      for (const r of (data||[])) {
        try {
          const art = state.articoli.find(x => x.id === r.articolo_id);
          if (!art || !(Number(r.minuti_unitari) > 0)) continue;
          if (art.minuti_unitari != null && art.minuti_unitari !== '') continue;
          const { data: artUpd, error: errArt } = await sb.from('articoli')
            .update({ minuti_unitari: r.minuti_unitari }).eq('id', art.id).select().single();
          if (!errArt && artUpd) {
            state.articoli = state.articoli.map(x => x.id === artUpd.id ? artUpd : x);
            seminati++;
          }
        } catch (e) {}
      }
      toast('Ordine creato: ' + (data||[]).length + (data.length===1?' posizione':' posizioni'), 'ok');
      if (seminati > 0) {
        toast('Minuti pagati salvati anche nell\'anagrafica di '
          + seminati + (seminati === 1 ? ' articolo' : ' articoli'));
      }
      if (posDaTariffa > 0) {
        toast('Tempo pagato calcolato dal prezzo per ' + posDaTariffa
          + (posDaTariffa === 1 ? ' posizione' : ' posizioni')
          + ' (tariffa cliente ' + String(tariffaCli).replace('.', ',') + ' €/h)');
      }
      closeModal(); renderTab('pianificazione');
    } catch (e) {
      btnSave.disabled=false; btnSave.textContent='Crea ordine';
      toast('Errore: '+(e.message||e), 'err');
    }
  };
  foot.append(btnSave);
  modal.append(foot);
  openModal(modal);
}

// ── ORDINE PER INTERO: tutte le posizioni di un OC con totale ─────────────
// Vista di sola lettura derivata: le righe sono le operazioni che condividono
// cliente + numero_ordine. Click su una riga = apre quella commessa.
function openOrdineClienteModal(clienteId, numeroOrdine) {
  const righe = (state.operazioni || [])
    .filter(o => o.cliente_id === clienteId && o.numero_ordine === numeroOrdine)
    .sort((a, b) => String(a.pos || '').localeCompare(String(b.pos || '')));
  if (!righe.length) return;
  const cli = state.aziende.find(c => c.id === clienteId);
  const fmtEuro = (n) => '€ ' + Number(n).toLocaleString('it-IT',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const modal = el('div', { class:'modal', style:'max-width:900px;' });
  modal.append(el('div', { class:'mhd' },
    el('h2', {}, 'Ordine ' + (numeroOrdine || '—') + ' — ' + (cli?.nome || '—')),
    el('button', { class:'mclose', onclick:closeModal }, '✕'),
  ));
  const body = el('div', { class:'mbody' });

  const tw = el('div', { class:'tw' });
  const tbl = el('table', { class:'rt' });
  tbl.append(el('thead', {}, el('tr', {},
    el('th', {}, 'Pos'),
    el('th', {}, 'Codice'),
    el('th', {}, 'Descrizione'),
    el('th', { class:'tr' }, 'Qtà'),
    el('th', { class:'tr' }, '€/pz'),
    el('th', { class:'tr' }, 'Totale'),
    el('th', {}, 'Scadenza'),
    el('th', { class:'tc' }, 'Stato'),
  )));
  const tb = el('tbody');
  let totale = 0, senzaPrezzo = 0;
  righe.forEach(o => {
    const art = state.articoli.find(a => a.id === o.articolo_id);
    const prezzo = Number(o.prezzo_unitario) || 0;
    const qta = Number(o.quantita) || 0;
    const rTot = prezzo > 0 ? prezzo * qta : null;
    if (rTot != null) totale += rTot; else senzaPrezzo++;
    const st = OP_STATI[o.stato] || { label: o.stato, badge:'bgry' };
    tb.append(el('tr', {
      style:'cursor:pointer;',
      title:'Apri questa commessa',
      onclick: () => { closeModal(); openOperazioneModal(o); },
    },
      el('td', { class:'mono', style:'color:var(--mut);' }, o.pos || '—'),
      el('td', { class:'mono', style:'color:var(--or);' }, art?.codice || '—'),
      el('td', { style:'max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;' },
        art?.descrizione || '—'),
      el('td', { class:'tr mono' }, String(qta)),
      el('td', { class:'tr mono' }, prezzo > 0 ? fmtEuro(prezzo) : '—'),
      el('td', { class:'tr mono', style:'font-weight:700;' }, rTot != null ? fmtEuro(rTot) : '—'),
      el('td', { class:'mono', style:'font-size:11px;' }, o.scadenza ? fmtIT(o.scadenza) : '—'),
      el('td', { class:'tc' }, el('span', { class:'badge ' + st.badge }, st.label.toLowerCase())),
    ));
  });
  tbl.append(tb);
  tw.append(tbl);
  body.append(tw);

  body.append(el('div', { style:'margin-top:12px;text-align:right;font-family:JetBrains Mono,monospace;' },
    el('div', { style:'font-size:15px;font-weight:700;' },
      'Totale ordine: ' + (totale > 0 ? fmtEuro(totale) : '—')),
    senzaPrezzo > 0 ? el('div', { class:'sub', style:'margin-top:2px;' },
      senzaPrezzo + (senzaPrezzo === 1 ? ' posizione senza prezzo' : ' posizioni senza prezzo')
      + ' (esclusa dal totale)') : null,
  ));
  body.append(el('div', { class:'sub', style:'margin-top:8px;' },
    righe.length + (righe.length === 1 ? ' posizione' : ' posizioni')
    + ' · click su una riga per aprire la commessa.'));

  modal.append(body);
  const foot = el('div', { class:'mfoot' });
  foot.append(el('button', { class:'btng', onclick:closeModal }, 'Chiudi'));
  modal.append(foot);
  openModal(modal);
}

// Modale "Ordina priorità" (gestionale): riordino di tutte le commesse aperte.
function openPrioritaModal() {
  const items = state.operazioni
    .filter(o => o.stato !== 'spedita' && o.stato !== 'completata')
    .slice()
    .sort(cmpCommessaKiosk);

  const modal = el('div', { class:'modal' });
  modal.append(el('div', { class:'mhd' },
    el('h2', {}, 'Ordina priorità commesse'),
    el('button', { class:'mclose', onclick: closeModal }, '✕'),
  ));
  const body = el('div', { class:'mbody' });
  body.append(el('div', { class:'prio-hint' },
    'Trascina le righe per dare priorità: quelle in alto compaiono per prime al kiosk '
    + '(lista commesse e "Prossime assegnate a te"). Le commesse aggiunte in seguito '
    + 'finiscono in coda finché non riordini.'));

  const rl = buildPrioList(items);
  body.append(rl.el);

  const footer = el('div', { style:'display:flex;gap:10px;justify-content:space-between;margin-top:18px;flex-wrap:wrap;' });
  footer.append(el('button', { class:'btng', onclick: () => {
    if (!confirm('Azzerare la priorità di tutte le commesse?\nTornano all\'ordine per scadenza.')) return;
    salvaPriorita(items.map(o => ({ id:o.id, priorita:null })));
  } }, 'Azzera priorità'));
  const dx = el('div', { style:'display:flex;gap:10px;' });
  dx.append(el('button', { class:'btng', onclick: closeModal }, 'Annulla'));
  dx.append(el('button', { class:'btnp', onclick: () => {
    salvaPriorita(rl.order().map((id, i) => ({ id, priorita:i + 1 })));
  } }, 'Salva ordine'));
  footer.append(dx);
  body.append(footer);

  modal.append(body);
  openModal(modal);
}

// Salvataggio dal modale gestionale: persiste, chiude e ridisegna la tab.
async function salvaPriorita(coppie) {
  try {
    const n = await persistPriorita(coppie);
    if (n > 0) toast('Priorità aggiornata', 'ok');
    closeModal();
    if (state.currentTab && typeof renderTab === 'function') renderTab(state.currentTab);
  } catch (e) {
    toast('Errore salvataggio priorità: ' + (e.message || e), 'err');
  }
}

// Assegna un gruppo_id a più commesse (le accorpa). gruppoId null = scioglie.
async function salvaGruppoCommesse(ids, gruppoId) {
  if (!ids.length) return;
  const { data, error } = await sb.from('operazioni')
    .update({ gruppo_id: gruppoId }).in('id', ids).select();
  if (error) {
    if ((error.message || '').includes('gruppo_id')) {
      return toast('Manca la colonna gruppo_id sul DB: esegui prima la migrazione SQL.', 'err');
    }
    return toast('Errore: ' + error.message, 'err');
  }
  const upd = new Map((data || []).map(r => [r.id, r]));
  state.operazioni = state.operazioni.map(o => upd.get(o.id) || o);
  state.opGruppoMode = false;
  state.opGruppoSel = new Set();
  toast(gruppoId ? 'Gruppo creato: ' + ids.length + ' commesse' : 'Gruppo sciolto');
  renderTab('pianificazione');
}
async function scioglieGruppoCommessa(o) {
  const membri = (state.operazioni || []).filter(x => x.gruppo_id && x.gruppo_id === o.gruppo_id);
  if (!confirm('Sciogliere il gruppo di ' + membri.length + ' commesse?\nTorneranno separate al kiosk.')) return;
  await salvaGruppoCommesse(membri.map(x => x.id), null);
}

// Le commesse che la scheda Ordini cliente sta MOSTRANDO, coi filtri attivi.
// Come per lo Storico: una strada sola per tabella ed export (7 ago).
// `includiSpedite` serve solo all'export: la scheda le nasconde sempre perché
// vivono nello Storico, ma chi esporta può volerle dentro.
// Ritorna { list, filtriAttivi }.
// `includiStorico` serve solo all'export: la scheda passa sempre false.
function pianificazioneFiltrate(includiStorico) {
  const search = (state.opSearch || '').toLowerCase();
  const filter = state.opFilter || 'all';
  const oggi = toLocalISO(new Date());

  let list = state.operazioni.slice();
  // Confine unico con lo Storico (27 ago): qui vive tutto ciò che NON è
  // finito nello Storico — il lavoro vivo più le spedite dell'ultimo mese.
  // La regola sta in domain, così le due schede non possono contraddirsi e
  // nessuna commessa resta senza casa.
  if (!includiStorico) {
    list = list.filter(o => !commessaInStorico(o, state.spedizioni, oggi));
  }
  // Le spedite recenti ci sono ma non si mostrano di default: la vista
  // normale è il lavoro da fare, non quello appena finito. Il chip SPEDITE
  // le tira fuori quando servono.
  if (filter === 'spedite')         list = list.filter(o => o.stato === 'spedita');
  else if (filter === 'aperte')     list = list.filter(o => o.stato === 'aperta');
  else if (filter === 'sospese')    list = list.filter(o => o.stato === 'sospesa');
  else if (filter === 'completate') list = list.filter(o => o.stato === 'completata');
  // 'all' NON toglie niente: un filtro che si chiama "Tutte" e nasconde le
  // spedite dell'ultimo mese direbbe una cosa falsa, e il conteggio in alto
  // non corrisponderebbe alla lista sotto. Quello che questa scheda non
  // mostra è già stato deciso una riga più su, dal confine con lo Storico.

  // Filtro clienti esclusi (stile Excel multi-select)
  if (state.opClientiEsclusi && state.opClientiEsclusi.size > 0) {
    list = list.filter(o => !state.opClientiEsclusi.has(o.cliente_id));
  }

  if (search) {
    list = list.filter(o => {
      const cli = state.aziende.find(c => c.id === o.cliente_id);
      const art = state.articoli.find(a => a.id === o.articolo_id);
      return (o.numero_ordine||'').toLowerCase().includes(search)
          || (o.numero_op||'').toLowerCase().includes(search)
          || (o.riferimento_cliente||'').toLowerCase().includes(search)
          || (o.pos||'').toLowerCase().includes(search)
          || (cli?.nome||'').toLowerCase().includes(search)
          || (art?.codice||'').toLowerCase().includes(search)
          || (art?.descrizione||'').toLowerCase().includes(search)
          || (o.note||'').toLowerCase().includes(search);
    });
  }

  // Sort
  const sortKey = state.opSortKey || 'scadenza';
  const sortDir = state.opSortDir === 'desc' ? -1 : 1;
  list.sort((a,b) => {
    let av, bv;
    if (sortKey === 'cliente') {
      av = (state.aziende.find(c => c.id === a.cliente_id)?.nome || '');
      bv = (state.aziende.find(c => c.id === b.cliente_id)?.nome || '');
    } else if (sortKey === 'articolo') {
      av = (state.articoli.find(c => c.id === a.articolo_id)?.codice || '');
      bv = (state.articoli.find(c => c.id === b.articolo_id)?.codice || '');
    } else if (sortKey === 'inizio') {
      // Ordina per data inizio effettiva (manuale se presente, altrimenti calcolata)
      av = opInizio(a) || '';
      bv = opInizio(b) || '';
    } else if (sortKey === 'prep') {
      // Ordino su un valore numerico così "completo" > "parziale" > "vuoto"
      const rank = { completo: 3, parziale: 2, vuoto: 1 };
      av = rank[a.stato_preparazione] || 0;
      bv = rank[b.stato_preparazione] || 0;
    } else {
      av = a[sortKey] || '';
      bv = b[sortKey] || '';
    }
    if (av < bv) return -1 * sortDir;
    if (av > bv) return  1 * sortDir;
    return 0;
  });

  const filtriAttivi = [];
  if (filter !== 'all') filtriAttivi.push('stato: ' + filter);
  if (state.opClientiEsclusi && state.opClientiEsclusi.size)
    filtriAttivi.push(state.opClientiEsclusi.size + ' clienti esclusi');
  if (search) filtriAttivi.push('ricerca "' + search + '"');

  return { list, filtriAttivi };
}

function renderPianificazione(root) {
  const isAdmin = state.profile?.ruolo === 'admin';
  const search = (state.opSearch || '').toLowerCase();
  const filter = state.opFilter || 'all';
  const { list } = pianificazioneFiltrate(false);
  // L'ordinamento lo applica pianificazioneFiltrate; qui servono solo per
  // disegnare la freccia sulla colonna attiva.
  const sortKey = state.opSortKey || 'scadenza';
  const sortDir = state.opSortDir === 'desc' ? -1 : 1;

  // KPI — contate sulle commesse DI QUESTA SCHEDA, non su tutto l'archivio:
  // altrimenti "Totale" comprenderebbe anche le 200 dello Storico e non
  // corrisponderebbe a niente di quello che si vede sotto.
  const oggiKpi = toLocalISO(new Date());
  const diQui = state.operazioni.filter(o => !commessaInStorico(o, state.spedizioni, oggiKpi));
  const tot = diQui.length;
  const aperte = diQui.filter(o => o.stato === 'aperta').length;
  const inRitardo = diQui.filter(opIsRitardo).length;
  const sospese = diQui.filter(o => o.stato === 'sospesa').length;
  const completate = diQui.filter(o => o.stato === 'completata').length;

  root.innerHTML = '';
  root.append(el('div', { class:'kpis' },
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Totale'),       el('div', { class:'kv ka' }, String(tot))),
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Aperte'),        el('div', { class:'kv kg' }, String(aperte))),
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'In ritardo'),    el('div', { class:'kv kr' }, String(inRitardo))),
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Sospese'),       el('div', { class:'kv ky' }, String(sospese))),
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Completate'),    el('div', { class:'kv kb' }, String(completate))),
  ));

  // Chips filtro
  const chips = el('div', { class:'chips' });
  [
    { id:'all',        label:'Tutte' },
    { id:'aperte',     label:'Aperte' },
    { id:'sospese',    label:'Sospese' },
    { id:'completate', label:'Completate' },
    // L'etichetta dice la REGOLA, non il numero: "48" non spiega perché sono
    // quelle e non altre, "ultimi 30gg" sì — e chi apre la scheda capisce da
    // solo dove sono finite le più vecchie.
    { id:'spedite',    label:'Spedite (ultimi 30gg)' },
  ].forEach(opt => {
    chips.append(el('div', {
      class: 'chip' + (filter === opt.id ? ' act' : ''),
      onclick: () => { state.opFilter = opt.id; renderTab('pianificazione'); }
    }, opt.label));
  });
  root.append(chips);

  // Toolbar
  const inputSearch = el('input', {
    type:'text', class:'search', id:'pian-search',
    placeholder:'Cerca OP, ordine, rif. cliente, cliente, codice, descrizione, note…',
    value: state.opSearch || '',
    oninput: (e) => {
      state.opSearch = e.target.value;
      state._focusSearch = 'pian-search';
      renderTab('pianificazione');
    }
  });
  // Pulsante filtro clienti (popup multi-checkbox in stile Excel)
  const nEsclusi = state.opClientiEsclusi?.size || 0;
  const btnFiltroCli = el('button', {
    class: nEsclusi > 0 ? 'btnp' : 'btng',
    title: nEsclusi > 0
      ? `Filtro attivo: ${nEsclusi} cliente${nEsclusi>1?'i':''} nascost${nEsclusi>1?'i':'o'}`
      : 'Filtra clienti da mostrare',
    onclick: (e) => openFiltroClientiPopup(e.currentTarget),
  }, nEsclusi > 0 ? `▼ Filtro clienti (${nEsclusi})` : '▼ Filtra clienti');

  const toolbar = el('div', { class:'toolbar' },
    el('h2', {}, 'Ordini cliente'),
    inputSearch,
    btnFiltroCli,
  );
  if (isAdmin) {
    toolbar.append(el('button', { class:'btnp', onclick:()=>openNuovoOrdineModal() }, '+ Nuovo ordine'));
    toolbar.append(el('button', { class:'btng', onclick:()=>openPrioritaModal() }, '⠿ Ordina priorità'));
    // Raggruppa: entra in modalità selezione — le commesse scelte diventano
    // un gruppo, viste come UNA al kiosk (il tempo timbrato si divide in parti
    // uguali su tutte). Ri-clic esce dalla modalità.
    toolbar.append(el('button', {
      class: state.opGruppoMode ? 'btnp' : 'btng',
      onclick: () => {
        state.opGruppoMode = !state.opGruppoMode;
        state.opGruppoSel = new Set();
        renderTab('pianificazione');
      },
    }, state.opGruppoMode ? '✕ Esci da raggruppa' : '⊞ Raggruppa'));
    const fileImp = el('input', {
      type:'file', accept:'.xlsx,.xls', style:'display:none;',
      onchange: (e) => { if (e.target.files[0]) operazioniImportExcel(e.target.files[0]); e.target.value=''; },
    });
    toolbar.append(fileImp);
    toolbar.append(el('button', { class:'btng', onclick:()=>fileImp.click() }, '↑ Importa da Excel'));
    toolbar.append(el('button', { class:'btng', onclick:()=>openOperazioniExportModal() }, '↓ Esporta Excel'));
  }
  root.append(toolbar);

  // Barra azioni della modalità raggruppa (solo admin, quando attiva)
  if (isAdmin && state.opGruppoMode) {
    if (!(state.opGruppoSel instanceof Set)) state.opGruppoSel = new Set();
    const nSel = state.opGruppoSel.size;
    const bar = el('div', {
      style:'display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:6px 0 10px;padding:10px 14px;'
        + 'background:var(--sur2);border:1px solid var(--acc);border-radius:6px;',
    });
    bar.append(el('span', { style:'font-weight:700;' }, '⊞ Modalità raggruppa'));
    bar.append(el('span', { class:'sub' },
      'Clicca le commesse da unire (' + nSel + ' selezionate). Al kiosk saranno una card sola; '
      + 'il tempo timbrato si divide in parti uguali su tutte.'));
    const btnCrea = el('button', { class: nSel >= 2 ? 'btnp' : 'btng', style: nSel < 2 ? 'opacity:.5;' : '' },
      'Crea gruppo (' + nSel + ')');
    btnCrea.onclick = async () => {
      if (state.opGruppoSel.size < 2) return toast('Seleziona almeno 2 commesse', 'err');
      await salvaGruppoCommesse([...state.opGruppoSel], crypto.randomUUID());
    };
    bar.append(btnCrea);
    root.append(bar);
  }

  if (state.aziende.length === 0 || state.articoli.length === 0) {
    root.append(el('div', { class:'empty' },
      el('div', { style:'margin-bottom:8px;' }, '⚠ Per creare operazioni servono prima clienti e articoli.'),
      el('div', { class:'sub' }, 'Vai in Anagrafiche → Clienti e Articoli per aggiungerne.')));
    return;
  }
  if (list.length === 0) {
    // Dal 27 ago ogni commessa sta in Ordini cliente o nello Storico, quindi
    // qui non c'è più niente da "avvisare": basta dire in quale delle due, e
    // portarcisi. I casi sono due, e li si distingue con la stessa regola di
    // domain che decide dove vive una commessa — non con un'euristica locale.
    const { list: ovunque } = pianificazioneFiltrate(true);
    const oggiVuoto = toLocalISO(new Date());
    const quiMaNascoste = ovunque.filter(o => o.stato === 'spedita'
      && !commessaInStorico(o, state.spedizioni, oggiVuoto));
    const nelloStorico = ovunque.filter(o => commessaInStorico(o, state.spedizioni, oggiVuoto));

    root.append(el('div', { class:'empty' },
      state.operazioni.length === 0
        ? 'Nessuna operazione ancora. Crea la prima con "+ Nuova Operazione".'
        : 'Nessuna operazione corrisponde ai filtri.'
    ));

    if (quiMaNascoste.length || nelloStorico.length) {
      const elenco = arr => arr.slice(0, 6)
        .map(o => (o.numero_ordine || '—') + '/' + (o.pos || '—')).join(' · ')
        + (arr.length > 6 ? ' · … e altre ' + (arr.length - 6) : '');
      const box = el('div', { class:'empty', style:'margin-top:-6px;' });
      if (quiMaNascoste.length) {
        box.append(
          el('div', { class:'sub' }, quiMaNascoste.length === 1
            ? 'Una commessa corrisponde ed è spedita di recente: è in questa scheda, sotto il filtro SPEDITE.'
            : quiMaNascoste.length + ' commesse corrispondono e sono spedite di recente: sono in questa scheda, sotto il filtro SPEDITE.'),
          el('div', { class:'sub', style:'font-family:JetBrains Mono,monospace;font-size:11px;' },
            elenco(quiMaNascoste)),
          el('button', { class:'btng', style:'margin-top:8px;',
            onclick: () => { state.opFilter = 'spedite'; renderTab('pianificazione'); },
          }, 'Mostra le spedite'));
      }
      if (nelloStorico.length) {
        box.append(
          el('div', { class:'sub', style: quiMaNascoste.length ? 'margin-top:10px;' : '' },
            nelloStorico.length === 1
              ? 'Una commessa corrisponde ed è spedita da più di un mese: è nello Storico.'
              : nelloStorico.length + ' commesse corrispondono e sono spedite da più di un mese: sono nello Storico.'),
          el('div', { class:'sub', style:'font-family:JetBrains Mono,monospace;font-size:11px;' },
            elenco(nelloStorico)),
          el('button', { class:'btng', style:'margin-top:8px;',
            onclick: () => { if (typeof switchToTab === 'function') switchToTab('lavoro', 'storico'); },
          }, 'Vai allo Storico'));
      }
      root.append(box);
    }
    return;
  }

  // Tabella
  const tw = el('div', { class:'tw' });
  const tbl = el('table', { class:'rt op-table' });

  const sortHead = (key, label, opts={}) => {
    const isActive = sortKey === key;
    const indicator = isActive ? (sortDir === 1 ? ' ↑' : ' ↓') : '';
    return el('th', {
      class: opts.tc ? 'tc' : (opts.tr ? 'tr' : ''),
      style: 'cursor:pointer;',
      onclick: () => {
        if (state.opSortKey === key) state.opSortDir = state.opSortDir === 'asc' ? 'desc' : 'asc';
        else { state.opSortKey = key; state.opSortDir = 'asc'; }
        renderTab('pianificazione');
      },
    }, label + indicator);
  };

  tbl.append(el('thead', {}, el('tr', {},
    sortHead('numero_ordine',   'Ordine'),
    sortHead('pos',             'Pos'),
    sortHead('numero_op',       'OP'),
    sortHead('riferimento_cliente', 'Rif. cliente'),
    sortHead('cliente',         'Cliente'),
    sortHead('articolo',        'Codice'),
    el('th', {}, 'Descrizione'),
    // Tre colonne: solo la prima è ordinabile, perché è l'unica che sta su
    // `operazioni`. Prodotti e spediti sono somme derivate da altre tabelle.
    sortHead('quantita',        'Ordinati', {tr:true}),
    el('th', { class:'tr', title:'Pezzi prodotti (consegne di produzione registrate)' }, 'Prodotti'),
    el('th', { class:'tr', title:'Pezzi spediti al cliente' }, 'Spediti'),
    sortHead('scadenza',        'Scadenza'),
    sortHead('inizio',          'Inizio'),
    el('th', {}, 'Note'),
    sortHead('prep',            'Prep. materiale', {tc:true}),
    sortHead('stato',           'Stato', {tc:true}),
    el('th', { class:'tc' }, 'Azioni'),
  )));

  const tb = el('tbody');
  list.forEach(o => {
    const cli = state.aziende.find(c => c.id === o.cliente_id);
    const art = state.articoli.find(a => a.id === o.articolo_id);
    const inizio = opInizio(o);
    const ritardo = opIsRitardo(o);

    let rowClass = '';
    if (ritardo) rowClass = 'in-ritardo';
    else if (o.stato === 'spedita') rowClass = 'spedita';

    // Scadenza con colore secondo prossimità
    let scadCls = '';
    if (o.scadenza && o.stato !== 'spedita' && o.stato !== 'completata') {
      const oggi = new Date(); oggi.setHours(0,0,0,0);
      const scad = parseISODate(o.scadenza);
      const diff = (scad - oggi) / 86400000;
      if (diff < 0) scadCls = 'scadenza-passata';
      else if (diff <= 3) scadCls = 'scadenza-vicina';
    }

    // In modalità raggruppa il clic seleziona invece di aprire la scheda.
    const inGruppoMode = isAdmin && state.opGruppoMode;
    const selezionata = inGruppoMode && state.opGruppoSel instanceof Set && state.opGruppoSel.has(o.id);
    const tr = el('tr', {
      class: rowClass + ' op-row' + (selezionata ? ' gruppo-sel' : ''),
      style: 'cursor:pointer;' + (selezionata ? 'outline:2px solid var(--acc);outline-offset:-2px;' : ''),
      onclick: () => {
        if (inGruppoMode) {
          if (!(state.opGruppoSel instanceof Set)) state.opGruppoSel = new Set();
          if (state.opGruppoSel.has(o.id)) state.opGruppoSel.delete(o.id);
          else state.opGruppoSel.add(o.id);
          renderTab('pianificazione');
          return;
        }
        openOperazioneModal(o);
      },
      title: inGruppoMode ? 'Click per selezionare/deselezionare' : 'Click per aprire la scheda',
    });

    // Ordine — con eventuale ⚠ se mancano campi obbligatori per la pianificazione
    const mancanti = opCampiMancanti(o);
    const ordineCell = el('td', { class:'mono' });
    if (inGruppoMode) {
      ordineCell.append(el('span', { style:'margin-right:6px;' }, selezionata ? '☑' : '☐'));
    }
    // Badge gruppo: commessa accorpata → click per sciogliere (fuori da modalità)
    if (o.gruppo_id) {
      const nG = (state.operazioni || []).filter(x => x.gruppo_id === o.gruppo_id).length;
      ordineCell.append(el('span', {
        style:'display:inline-block;margin-right:6px;padding:0 6px;border-radius:8px;background:var(--acc);'
          + 'color:var(--bg);font-size:11px;font-weight:700;cursor:pointer;',
        title:'Gruppo di ' + nG + ' commesse (kiosk: una card, tempo diviso). Click per sciogliere.',
        onclick:(e)=>{ e.stopPropagation(); if (!inGruppoMode) scioglieGruppoCommessa(o); },
      }, '⊞' + nG));
    }
    if (mancanti.length > 0) {
      ordineCell.append(el('span', {
        style:'color:var(--yel);font-weight:700;margin-right:5px;cursor:help;',
        title:'Campi da compilare:\n• ' + mancanti.join('\n• '),
        onclick:(e)=>{ e.stopPropagation(); openOperazioneModal(o); },
      }, '⚠'));
    }
    // Numero OC cliccabile: apre la vista ORDINE INTERO (tutte le posizioni
    // + totale). Il resto della riga continua ad aprire la singola commessa.
    if (o.numero_ordine) {
      ordineCell.append(el('span', {
        style:'text-decoration:underline dotted;text-underline-offset:2px;cursor:pointer;',
        title:'Vedi l\'ordine per intero (tutte le posizioni + totale)',
        onclick:(e)=>{ e.stopPropagation(); if (!inGruppoMode) openOrdineClienteModal(o.cliente_id, o.numero_ordine); },
      }, o.numero_ordine));
    } else {
      ordineCell.append(document.createTextNode('—'));
    }
    tr.append(ordineCell);

    // Pos
    tr.append(el('td', { class:'mono', style:'color:var(--mut);' }, o.pos || '—'));

    // OP (numero ordine di produzione, opzionale)
    tr.append(el('td', { class:'mono', style:'color:var(--mut);' }, o.numero_op || '—'));

    // Riferimento cliente (testo libero, può essere lungo: tronco con ellissi
    // e mostro il valore completo nel tooltip)
    tr.append(el('td', {
      style: 'max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--mut);',
      title: o.riferimento_cliente || '',
    }, o.riferimento_cliente || '—'));

    // Cliente — restringo con troncamento per fare spazio alle nuove colonne
    tr.append(el('td', {
      style: 'max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
      title: cli?.nome || '',
    }, cli?.nome || '—'));

    // Codice articolo
    tr.append(el('td', { class:'mono', style:'color:var(--or);' }, art?.codice || '—'));

    // Descrizione articolo (troncata su 1 riga, tooltip pieno al passaggio del mouse)
    const desc = art?.descrizione || '';
    tr.append(el('td', {
      style: 'max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;',
      title: desc,
    }, desc || '—'));

    // Quantità — formato dinamico "prodotta/totale" con colore secondo stato:
    //   0/Tot   → monocromatico (nessun lotto ancora prodotto)
    //   N/Tot   → giallo (produzione parziale)
    //   Tot/Tot → verde (tutto prodotto, pronto in magazzino)
    // Tooltip sempre presente per leggere il dettaglio senza aprire il modal.
    // Tre colonne invece di una (27 ago, richiesta Nico): ORDINATI, PRODOTTI,
    // SPEDITI. La cella unica `prodotti/ordinati` non diceva quanto era
    // uscito, e per saperlo bisognava andare nella scheda Magazzino — che
    // proprio per questo è stata tolta: la giacenza è la differenza fra le
    // ultime due colonne e adesso si legge qui.
    const qtaTot = Number(o.quantita || 0);
    const qtaCons = quantitaConsegnata(o.id);
    const qtaSpd = quantitaSpedita(o.id);
    const qtaRes = Math.max(0, qtaTot - qtaCons);
    const inMagazzino = Math.max(0, qtaCons - qtaSpd);
    const tip = `${qtaTot} ordinati · ${qtaCons} prodotti · ${qtaSpd} spediti`
      + `\nda produrre ${qtaRes} · pronti in magazzino ${inMagazzino}`;
    tr.append(el('td', { class:'tr mono', title: tip }, String(qtaTot)));
    tr.append(el('td', {
      class: 'tr mono',
      // Stessa scala di colori di prima, ma sulla colonna che la merita:
      // verde quando la produzione ha finito, giallo mentre è per strada.
      style: (qtaTot > 0 && qtaCons >= qtaTot) ? 'color:var(--grn);font-weight:700;'
        : (qtaCons > 0 ? 'color:var(--yel);font-weight:600;' : ''),
      title: tip,
    }, String(qtaCons)));
    tr.append(el('td', {
      class: 'tr mono',
      style: (qtaTot > 0 && qtaSpd >= qtaTot) ? 'color:var(--grn);font-weight:700;'
        : (qtaSpd > 0 ? 'color:var(--blu);font-weight:600;' : 'color:var(--mut);'),
      title: tip,
    }, String(qtaSpd)));

    // Scadenza
    tr.append(el('td', { class:'mono '+scadCls }, o.scadenza ? fmtIT(o.scadenza) : '—'));

    // Inizio (in grassetto, come richiesto)
    tr.append(el('td', {
      class:'mono',
      style: 'font-weight:700;' + (o.inizio_manuale ? 'color:var(--acc);' : ''),
      title: o.inizio_manuale ? 'Data inizio impostata manualmente' : 'Data inizio calcolata automaticamente',
    }, inizio ? fmtIT(inizio) : '—'));

    // Note (troncate su 1 riga, tooltip pieno)
    tr.append(el('td', {
      style: 'max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;',
      title: o.note || '',
    }, o.note || '—'));

    // Prep. materiale — menu a tendina inline per gli admin, badge in sola lettura per gli utenti
    const prepCell = el('td', { class:'tc' });
    if (isAdmin) {
      const prepSel = el('select', {
        class: 'prep-select',
        style: 'font-size:11px;padding:3px 6px;border-radius:3px;cursor:pointer;font-family:inherit;background:var(--sur);border:1px solid var(--brd);color:var(--txt);',
        onclick: (e) => e.stopPropagation(),
        onchange: async (e) => {
          e.stopPropagation();
          const nuovo = e.target.value;
          if (nuovo === (o.stato_preparazione||'vuoto')) return;
          try {
            const { data, error } = await eseguiConRetry(
              () => sb.from('operazioni').update({ stato_preparazione: nuovo }).eq('id', o.id).select().single(),
              { label: 'cambia prep materiale' }
            );
            if (error) throw error;
            Object.assign(o, data);
            toast('Preparazione materiale aggiornata', 'ok');
          } catch (err) {
            toast('Errore: ' + (err.message || err), 'err');
            e.target.value = o.stato_preparazione || 'vuoto';
          }
        },
      },
        el('option', { value:'vuoto' }, 'Vuoto'),
        el('option', { value:'parziale' }, 'Parziale'),
        el('option', { value:'completo' }, 'Completo'),
      );
      prepSel.value = o.stato_preparazione || 'vuoto';
      prepCell.append(prepSel);
    } else {
      const prepClass = OP_PREP[o.stato_preparazione]?.classe || 'vuoto';
      prepCell.append(el('span', { style:'font-size:11px;' },
        el('span', { class:'prep-dot ' + prepClass }),
        ' ' + (OP_PREP[o.stato_preparazione]?.label || '—')
      ));
    }
    // Mancanti dal fabbisogno: si vedono senza aprire la commessa. Rosso se la
    // preparazione è dichiarata completa (contraddizione), altrimenti giallo.
    if (typeof mancantiCommessa === 'function') {
      const mc = mancantiCommessa(o);
      if (mc.nCodici) {
        // Tre mestieri diversi, tre numeri (27 ago). Prima erano due, e il
        // conto lavoro finiva nel rosso "da ordinare": su 31 commesse, 16
        // mostravano un rosso da 48 o 36 codici quando non c'era NIENTE da
        // ordinare — si aspettava il cliente. Un rosso che si accende sempre
        // smette di voler dire qualcosa.
        //   rosso   = c'è un ordine da emettere, tocca a noi
        //   arancio = manca ma lo manda il cliente, la mossa non è nostra
        //   giallo  = ordinato, ha una data
        const etichetta = mc.nBloccanti
          ? mc.nBloccanti + '/' + mc.nCodici
          : (mc.nAttesaCliente
              ? mc.nAttesaCliente + '/' + mc.nCodici
              : String(mc.nCodici));
        const colore = mc.nBloccanti ? 'var(--red)'
          : (mc.nAttesaCliente ? 'var(--or)' : 'var(--yel)');
        // Anteprima nel tooltip: i primi codici bloccanti, poi il resto contato.
        // Con 67 righe un tooltip intero sarebbe illeggibile.
        // Si elencano i codici della categoria che il badge sta mostrando: su
        // una commessa di solo conto lavoro, filtrare per "da ordinare"
        // darebbe una lista vuota sotto un numero che dice 48.
        const inEvidenza = mc.nBloccanti
          ? mc.righe.filter(mancanteBloccante)
          : mc.righe.filter(mancanteAttesaCliente);
        const primi = inEvidenza.slice(0, 8)
          .map(x => '· ' + x.codice + (x.descrizione ? '  ' + String(x.descrizione).slice(0, 34) : ''));
        const restanti = inEvidenza.length - primi.length;
        prepCell.append(el('span', {
          style: 'margin-left:6px;font-size:11px;font-family:JetBrains Mono,monospace;font-weight:700;cursor:pointer;color:'
            + colore + ';',
          title: (mc.nBloccanti
              ? mc.nBloccanti + (mc.nBloccanti === 1 ? ' codice DA ORDINARE (tocca a noi)' : ' codici DA ORDINARE (tocca a noi)')
              : 'Nessun codice da ordinare')
            + (mc.nAttesaCliente ? '\n' + mc.nAttesaCliente
                + ' in attesa dal CLIENTE (conto lavoro: non si ordina)' : '')
            + (mc.nInArrivoVero ? '\n' + mc.nInArrivoVero + ' in arrivo'
                + (mc.prossima ? ', prossima consegna ' + fmtIT(mc.prossima) : '') : '')
            + (mc.nConsumo ? '\n' + mc.nConsumo + ' di consumo (non fermano niente)' : '')
            + (mc.nRitardo ? '\n⚠ ' + mc.nRitardo + (mc.nRitardo === 1 ? ' consegna in ritardo' : ' consegne in ritardo') : '')
            + (primi.length ? '\n\n' + primi.join('\n') + (restanti > 0 ? '\n… e altri ' + restanti : '') : '')
            + (mc.incoerente ? '\n\n⚠ Ma la preparazione è dichiarata COMPLETA.' : '')
            + '\n\nClicca per vedere l\'elenco completo.',
          onclick: (e) => { e.stopPropagation(); apriMancantiFiltrati(o.numero_op); },
        }, '⚠' + etichetta));
      }
    }
    tr.append(prepCell);

    // Stato — menu a tendina (cambio immediato) per gli admin, badge in sola lettura per gli utenti
    const statoCell = el('td', { class:'tc' });
    if (isAdmin) {
      const sel = el('select', {
        class: 'badge ' + (OP_STATI[o.stato]?.badge||'bgry'),
        style: 'font-size:11px;padding:3px 6px;border-radius:3px;cursor:pointer;font-family:inherit;font-weight:600;',
        onclick: (e) => e.stopPropagation(),
        onchange: (e) => {
          e.stopPropagation();
          const nuovo = e.target.value;
          if (nuovo === o.stato) return;
          // Per "spedita" passo dal modal completo (data + giustificazione)
          if (nuovo === 'spedita') {
            e.target.value = o.stato; // ripristino temporaneamente
            quickSpedizione(o);
            return;
          }
          // Altri cambi: immediati
          quickStato(o, nuovo);
        },
      },
        el('option', { value:'aperta' }, 'Aperta'),
        el('option', { value:'sospesa' }, 'Sospesa'),
        el('option', { value:'completata' }, 'Completata'),
        // "Spedita" mancava perché prima le spedite in questa scheda non
        // arrivavano mai. Dal 27 ago ci sono (chip SPEDITE), e senza questa
        // opzione `sel.value = 'spedita'` non trovava niente da selezionare:
        // il menu restava VUOTO su ogni commessa spedita. Sceglierla non
        // cambia lo stato di colpo — apre `quickSpedizione`, che chiede data,
        // quantità e DDT, ed è la strada giusta per un passaggio del genere.
        el('option', { value:'spedita' }, 'Spedita'),
      );
      sel.value = o.stato; // imposto il valore corrente in modo affidabile
      statoCell.append(sel);
      // Segnale di incoerenza: tutto prodotto ma ancora aperta/sospesa.
      // Una commessa interamente prodotta non dovrebbe restare aperta.
      if (qtaTot > 0 && qtaCons >= qtaTot && (o.stato === 'aperta' || o.stato === 'sospesa')) {
        statoCell.append(el('span', {
          style:'margin-left:6px;cursor:pointer;color:var(--yel);font-weight:700;',
          title:'Tutto prodotto ma commessa ancora '+(o.stato==='aperta'?'aperta':'sospesa')+'. Clic per completarla.',
          onclick:(e)=>{ e.stopPropagation(); quickStato(o, 'completata'); },
        }, '⚠'));
      }
    } else {
      statoCell.append(el('span', {
        class:'badge '+(OP_STATI[o.stato]?.badge||'bgry'),
        style:'font-size:11px;',
      }, OP_STATI[o.stato]?.label||o.stato));
    }
    tr.append(statoCell);

    // Azioni: ✓ spedizione rapida + ✕ elimina (solo admin, stopPropagation per non aprire il modal)
    const azioniCell = el('td', { class:'tc' });
    if (isAdmin) {
      if (o.stato !== 'spedita') {
        azioniCell.append(el('button', {
          class:'btnsm',
          style:'background:rgba(78,255,163,.15);color:var(--grn);border-color:var(--grn);',
          title:'Segna come spedita (modale di conferma)',
          onclick:(e)=>{ e.stopPropagation(); quickSpedizione(o); },
        }, '✓'));
      }
      azioniCell.append(' ', el('button', {
        class:'btnd',
        title:'Elimina commessa',
        onclick:(e)=>{ e.stopPropagation(); deleteOperazione(o); },
      }, '✕'));
    }
    tr.append(azioniCell);

    tb.append(tr);
  });
  tbl.append(tb);
  tw.append(tbl);
  root.append(tw);

  // Legenda
  root.append(el('div', { class:'sub', style:'margin-top:14px;font-size:11px;' },
    'Click su una riga per aprire la scheda completa dell\'operazione.'));
}



// Modale completa per creazione e modifica
// ─── Campo autocomplete con creazione al volo ───
// items: array di record; getLabel: funzione record→stringa; getId: record→id
// onState: callback({mode:'existing'|'new'|'empty', id, text}) chiamato a ogni cambiamento
// Ritorna { wrap, getValue } dove getValue() → {mode, id, text}
function makeAutocompleteCreate(opts) {
  const { items, getLabel, placeholder, initialId, entityLabel, onChange } = opts;
  let selMode = 'empty';   // 'empty' | 'existing' | 'new'
  let selId = null;
  let selText = '';
  // Guard anti-ricorsione: durante getValue() chiamiamo recompute() per essere
  // sicuri che selId rifletta l'input attuale, ma NON vogliamo che questo
  // ri-emetta onChange (sennò un onChange che chiama getValue → loop infinito).
  let suppressNotify = false;
  // Helper interno: notifica il chiamante quando selezione cambia
  const notify = () => {
    if (suppressNotify) return;
    if (typeof onChange === 'function') {
      onChange({ mode: selMode, id: selId, text: selText });
    }
  };

  // Inizializza con valore esistente
  if (initialId) {
    const rec = items.find(x => x.id === initialId);
    if (rec) { selMode = 'existing'; selId = rec.id; selText = getLabel(rec); }
  }

  const input = el('input', {
    type:'text', autocomplete:'off',
    placeholder: placeholder || 'Cerca o digita…',
    value: selText,
    style:'width:100%;',
  });
  const dropList = el('div', { class:'util-droplist' });
  const hint = el('div', {
    style:'font-family:JetBrains Mono,monospace;font-size:11px;margin-top:4px;min-height:14px;'
  });
  const wrap = el('div', { class:'util-dropwrap', style:'position:relative;' }, input, dropList);
  const container = el('div', {}, wrap, hint);

  function updateHint() {
    hint.innerHTML = '';
    if (selMode === 'new' && selText) {
      hint.style.color = 'var(--yel)';
      hint.textContent = `⚠ "${selText}" non in anagrafica — verrà creato come nuovo ${entityLabel}`;
    } else if (selMode === 'existing') {
      hint.style.color = 'var(--grn)';
      hint.textContent = `✓ ${entityLabel} esistente`;
    } else {
      hint.textContent = '';
    }
  }

  function recompute() {
    const txt = input.value.trim();
    selText = txt;
    if (!txt) { selMode = 'empty'; selId = null; updateHint(); notify(); return; }
    // Match esatto (case-insensitive) con un record esistente?
    const exact = items.find(x => getLabel(x).toLowerCase() === txt.toLowerCase());
    if (exact) { selMode = 'existing'; selId = exact.id; }
    else { selMode = 'new'; selId = null; }
    updateHint();
    notify();
  }

  function renderDrop() {
    const txt = input.value.trim().toLowerCase();
    dropList.innerHTML = '';
    const filtered = txt
      ? items.filter(x => getLabel(x).toLowerCase().includes(txt))
      : items.slice(0, 30);
    filtered.slice(0, 50).forEach(rec => {
      dropList.append(el('div', {
        class:'util-row',
        onclick: () => {
          input.value = getLabel(rec);
          selMode = 'existing'; selId = rec.id; selText = getLabel(rec);
          dropList.classList.remove('open');
          updateHint();
          notify();
        },
      },
        el('span', { class:'util-row-name' }, getLabel(rec)),
      ));
    });
    if (!filtered.length && txt) {
      dropList.append(el('div', {
        class:'util-row',
        style:'color:var(--yel);cursor:default;',
      }, `Nessun risultato — "${input.value.trim()}" sarà creato come nuovo`));
    }
    dropList.classList.add('open');
  }

  input.oninput = () => { recompute(); renderDrop(); };
  input.onfocus = () => renderDrop();
  input.onblur = () => { setTimeout(() => dropList.classList.remove('open'), 180); recompute(); };

  updateHint();

  return {
    container,
    getValue: () => {
      // Sopprimiamo le notifiche: getValue è "lettura" — chi la chiama
      // sa già che vuole il valore, non vogliamo rimbalzi onChange
      suppressNotify = true;
      try { recompute(); }
      finally { suppressNotify = false; }
      return { mode: selMode, id: selId, text: selText };
    },
  };
}

function openOperazioneModal(o) {
  const isNew = !o;
  const isAdmin = state.profile?.ruolo === 'admin';
  o = o || {
    cliente_id:'', articolo_id:'', numero_ordine:'', numero_op:'', riferimento_cliente:'', pos:'',
    quantita:1, minuti_unitari:0,
    scadenza:'', cl_consegna_materiali:'',
    stato:'aperta', stato_preparazione:'vuoto', note:'',
    consegnato_il:'', giustificazione_ritardo:'', nc_post_consegna:'', responsabilita:'',
  };

  // Stato locale degli addetti previsti (modificabile, sincronizzato al salvataggio)
  let addettiSel = isNew ? [] : getOperazioneAddetti(o.id).slice();
  const canEdit = isAdmin;
  // La colonna prezzo esiste sul DB? (rilevata dai dati caricati). Finché non
  // c'è la migrazione, non mostro il campo né provo a salvarlo — così il
  // salvataggio non va in errore su una colonna inesistente.
  const prezzoAttivo = (state.operazioni || []).some(x => 'prezzo_unitario' in x);

  const modal = el('div', { class:'modal', style:'max-width:720px;' });
  modal.append(el('div', { class:'mhd' },
    el('h2', {}, isNew ? 'Nuova Operazione' : (isAdmin ? 'Modifica Operazione' : 'Operazione')),
    el('button', { class:'mclose', onclick:closeModal }, '✕'),
  ));

  const body = el('div', { class:'mbody' });
  const form = el('form');

  // Autocomplete cliente — con creazione al volo
  // Solo aziende attive con is_cliente=true (esclude i fornitori puri)
  const acCliente = makeAutocompleteCreate({
    items: state.aziende.filter(c => c.attivo && c.is_cliente !== false),
    getLabel: c => c.nome,
    placeholder: 'Cerca o digita nuovo cliente…',
    initialId: o.cliente_id || null,
    entityLabel: 'cliente',
    onChange: () => {
      if (typeof aggiornaPrezzoListino === 'function') aggiornaPrezzoListino();
      if (typeof aggiornaSuggDaConsuntivo === 'function') aggiornaSuggDaConsuntivo();
    },
  });

  // Autocomplete articolo — con creazione al volo.
  // onChange si attiva quando l'utente seleziona un articolo: pre-compila i
  // minuti unitari dal valore dell'articolo SOLO se il campo è vuoto o = 0
  // (cioè non già impostato manualmente dall'utente, in tal caso rispetto la
  // sua scelta). Aggiorna anche l'indicatore di divergenza '*'.
  const acArticolo = makeAutocompleteCreate({
    items: state.articoli.filter(a => a.attivo),
    getLabel: a => a.codice,
    placeholder: 'Cerca o digita nuovo codice…',
    initialId: o.articolo_id || null,
    entityLabel: 'articolo',
    onChange: (val) => {
      // Safe-guard: questo callback può essere chiamato durante l'init
      // dell'autocomplete (recompute iniziale), prima che `form` o le funzioni
      // helper esistano. In quel caso non facciamo nulla — verrà chiamato
      // di nuovo dagli eventi reali (input, click) quando tutto è in piedi.
      if (typeof form === 'undefined' || !form || !form.querySelector) return;
      const minInput = form.querySelector('#minuti-input');
      if (!minInput) return;
      if (val.mode === 'existing' && val.id) {
        const art = state.articoli.find(a => a.id === val.id);
        if (art && art.minuti_unitari != null && art.minuti_unitari !== '') {
          const curVal = (minInput.value || '').toString().trim();
          // Pre-compila se campo vuoto o = 0 (default precedente)
          if (curVal === '' || curVal === '0' || Number(curVal) === 0) {
            minInput.value = String(art.minuti_unitari);
          }
        }
      }
      // Fasi = quelle EFFETTIVE dell'articolo scelto (media storica viva +
      // manuali per i tipi senza storico). Il blocco è in sola lettura:
      // a ogni cambio articolo si ricostruisce da capo.
      if (isNew && val.mode === 'existing' && val.id) {
        const eff = fasiEffettiveArticolo(val.id);
        fasiComm = eff.map(f => ({ _k: nextFaseKey(), tipo_lavorazione_id: f.tipo_lavorazione_id || null,
          minuti_unitari: Number(f.minuti_unitari) || 0, _fonte: f.fonte, _nComm: f.nCommesse }));
        if (typeof onFasiChanged === 'function') onFasiChanged();
      }
      // Prezzo: pre-compila dall'ultimo usato (articolo+cliente) se il campo è
      // ancora vuoto — non sovrascrive un prezzo già digitato a mano.
      if (typeof aggiornaPrezzoListino === 'function') aggiornaPrezzoListino();
      // Prezzo consigliato dalle ore realmente timbrate su questo articolo
      if (typeof aggiornaSuggDaConsuntivo === 'function') aggiornaSuggDaConsuntivo();
      // Aggiorna indicatore divergenza (se la funzione è già definita)
      if (typeof aggiornaIndicatoreMinuti === 'function') aggiornaIndicatoreMinuti();
      // Trigga il refresh del preview (se la funzione è già definita)
      if (typeof refreshPreview === 'function') refreshPreview();
    },
  });

  // ── Fasi: dati condivisi (la UI delle fasi è più sotto) ─────────────
  // Servono qui perché addetti e fornitori mostrano una tendina "fase".
  const tipiAttiviComm = (state.tipiLav || []).filter(t => t.attivo !== false)
    .sort((x, y) => (x.ordine || 0) - (y.ordine || 0));
  let faseKeyCounter = 0;
  const nextFaseKey = () => 'n' + (faseKeyCounter++);
  // Fasi in sola lettura dall'anagrafica. Per le commesse esistenti si parte
  // dalla fotografia su DB (i timbri e le assegnazioni si agganciano lì) e la
  // si riallinea alle fasi EFFETTIVE correnti dell'articolo: minuti aggiornati,
  // tipi nuovi aggiunti. Le fasi fotografate non più in anagrafica restano SE
  // hanno ore o addetti; quelle VUOTE (né ore né addetti né più previste) si
  // tolgono, altrimenti restano lì per sempre — nascono al kiosk quando si
  // timbra un tipo fuori piano e il timbro poi viene corretto.
  let fasiComm = [];
  if (!isNew) {
    const orfane = (typeof fasiOrfaneCommessa === 'function') ? fasiOrfaneCommessa(o) : [];
    const idOrfane = new Set(orfane.map(f => f.id));
    fasiComm = (state.opFasi || []).filter(f => f.operazione_id === o.id && !idOrfane.has(f.id))
      .sort((x, y) => (x.ordine || 0) - (y.ordine || 0))
      .map(f => ({ _k: f.id, id: f.id, tipo_lavorazione_id: f.tipo_lavorazione_id || null,
        minuti_unitari: Number(f.minuti_unitari) || 0, _foto: true }));
    const effIni = (o.articolo_id && typeof fasiEffettiveArticolo === 'function')
      ? fasiEffettiveArticolo(o.articolo_id) : [];
    effIni.forEach(e => {
      const r = fasiComm.find(x => x.tipo_lavorazione_id === e.tipo_lavorazione_id);
      if (r) {
        r.minuti_unitari = Number(e.minuti_unitari) || 0;
        r._fonte = e.fonte; r._nComm = e.nCommesse; r._foto = false;
      } else {
        fasiComm.push({ _k: nextFaseKey(), tipo_lavorazione_id: e.tipo_lavorazione_id,
          minuti_unitari: Number(e.minuti_unitari) || 0, _fonte: e.fonte, _nComm: e.nCommesse });
      }
    });
    // L'ordine segue l'anagrafica (la catena di pianificazione è sequenziale);
    // le fasi solo-di-questa-commessa restano in coda nel loro ordine.
    const ordineEff = new Map(effIni.map((e, i) => [e.tipo_lavorazione_id, i]));
    fasiComm.sort((x, y) =>
      (ordineEff.has(x.tipo_lavorazione_id) ? ordineEff.get(x.tipo_lavorazione_id) : 999)
      - (ordineEff.has(y.tipo_lavorazione_id) ? ordineEff.get(y.tipo_lavorazione_id) : 999));
  }
  let fasiSeq = !!o.fasi_sequenziali;
  // Assegnazione addetto → fase: utente_id → _k della fase ('' = tutta la commessa)
  const addettoFase = {};   // uid → ARRAY di chiavi fase
  if (!isNew) {
    const tutteKeys = () => fasiComm.filter(f => f.tipo_lavorazione_id).map(f => f._k);
    const haNull = {};
    (state.opAddetti || []).filter(r => r.operazione_id === o.id)
      .forEach(r => {
        if (!addettoFase[r.utente_id]) addettoFase[r.utente_id] = [];
        if (r.fase_id) addettoFase[r.utente_id].push(r.fase_id);
        else haNull[r.utente_id] = true;
      });
    // "Tutta la commessa" (fase_id null) viene reso ESPLICITO: tutte le fasi
    // accese. Più chiaro a video e, al salvataggio, una riga per fase.
    Object.keys(haNull).forEach(uid => { addettoFase[uid] = tutteKeys(); });
  }
  const tipoNomeFase = (id) => (tipiAttiviComm.find(t => t.id === id) || {}).nome || 'fase';
  const fasiAssegnabili = () => fasiComm.filter(f => f.tipo_lavorazione_id);
  // Chip multi-fase per un ADDETTO: ogni fase è un interruttore on/off.
  // Nessuna fase accesa = assegnato a tutta la commessa. Un operatore può
  // quindi coprire più fasi (es. cablaggio + collaudo) sulla stessa commessa.
  function buildFaseChips(uid) {
    const wrap = el('span', { style:'display:inline-flex;gap:3px;flex-wrap:wrap;align-items:center;' });
    const keys = () => addettoFase[uid] || (addettoFase[uid] = []);
    const ridisegna = () => {
      wrap.innerHTML = '';
      fasiComm.forEach((f, i) => {
        if (!f.tipo_lavorazione_id) return;
        const on = keys().includes(f._k);
        wrap.append(el('button', {
          type:'button',
          style:'font-size:11px;padding:2px 7px;border-radius:10px;cursor:pointer;font-family:JetBrains Mono,monospace;'
            + (on ? 'background:var(--acc);color:var(--bg);border:1px solid var(--acc);font-weight:700;'
                  : 'background:transparent;color:var(--mut);border:1px solid var(--brd);'),
          title: (on ? 'Togli da' : 'Assegna a') + ' #' + (i+1) + ' ' + tipoNomeFase(f.tipo_lavorazione_id),
          onclick: () => {
            if (!canEdit) return;
            if (on && keys().length === 1) {
              toast('Almeno una fase: per toglierlo dalla commessa usa la \u2715', 'err');
              return;
            }
            addettoFase[uid] = on ? keys().filter(k => k !== f._k) : [...keys(), f._k];
            ridisegna();
          },
        }, '#' + (i + 1) + ' ' + tipoNomeFase(f.tipo_lavorazione_id)));
      });
      if (keys().length === 0) {
        wrap.append(el('span', { style:'font-size:11px;color:var(--mut);font-family:JetBrains Mono,monospace;font-style:italic;opacity:.7;' }, 'tutta la commessa'));
      }
    };
    ridisegna();
    return wrap;
  }

  // Multi-select addetti (lo stesso pattern di "Chi userà il mezzo")
  const utentiAttiviAdd = state.utenti.filter(u => u.attivo && !isKioskRecord(u));
  const addSelectedWrap = el('div', { class:'util-selected' });
  const addSearchInput = el('input', {
    type:'text', class:'util-search',
    placeholder:'Aggiungi addetto (clicca o cerca)…',
    autocomplete:'off',
  });
  const addDropList = el('div', { class:'util-droplist' });
  const addDropWrap = el('div', { class:'util-dropwrap' }, addSearchInput, addDropList);
  addSearchInput.onfocus = () => { addDropList.classList.add('open'); renderAddDropList(); };
  addSearchInput.onblur = () => { setTimeout(() => addDropList.classList.remove('open'), 180); };

  // Riferimento in avanti: assegnato più sotto quando refreshPreview esiste.
  // Permette di ricalcolare la data inizio quando cambiano gli addetti.
  let aggiornaPreviewInizio = null;

  const renderAddSelected = () => {
    addSelectedWrap.innerHTML = '';
    addSelectedWrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
    if (typeof aggiornaDataRealistica === 'function') aggiornaDataRealistica();
    if (addettiSel.length === 0) {
      addSelectedWrap.append(el('span', { class:'util-empty' }, 'Nessun addetto previsto'));
      return;
    }
    addettiSel.forEach(uid => {
      const u = utentiAttiviAdd.find(x => x.id === uid);
      if (!u) return;
      // Una riga intera per addetto: nome a sinistra, chip fasi al centro,
      // ✕ in fondo ben staccata (per non toccarla per sbaglio coi chip).
      const row = el('div', { style:'display:flex;align-items:center;gap:10px;background:var(--sur2);border:1px solid var(--brd);border-radius:6px;padding:7px 10px;width:100%;' },
        el('span', { style:'font-weight:600;flex-shrink:0;min-width:110px;' },
          u.nome + (u.esterno ? ' ✦' : '')));
      if (fasiAssegnabili().length >= 1) {
        const chips = buildFaseChips(uid);
        chips.style.flex = '1';
        row.append(chips);
      } else {
        row.append(el('span', { style:'flex:1;' }));
      }
      if (canEdit) {
        row.append(el('button', {
          type:'button', class:'util-pill-x',
          style:'margin-left:auto;flex-shrink:0;padding:4px 8px;',
          title:'Rimuovi ' + u.nome + ' dalla commessa',
          onclick: () => {
            addettiSel = addettiSel.filter(x => x !== uid);
            renderAddSelected(); renderAddDropList();
            if (aggiornaPreviewInizio) aggiornaPreviewInizio();
          },
        }, '✕'));
      }
      addSelectedWrap.append(row);
    });
  };
  const renderAddDropList = () => {
    const q = addSearchInput.value.trim().toLowerCase();
    const filtered = utentiAttiviAdd.filter(u =>
      !q || (u.nome || '').toLowerCase().includes(q)
    );
    addDropList.innerHTML = '';
    if (!filtered.length) {
      addDropList.append(el('div', { class:'util-noresult' }, 'Nessun utente trovato'));
      return;
    }
    filtered.forEach(u => {
      const isSel = addettiSel.includes(u.id);
      addDropList.append(el('div', {
        class: 'util-row' + (isSel ? ' selected' : ''),
        onclick: () => {
          if (!canEdit) return;
          if (isSel) addettiSel = addettiSel.filter(x => x !== u.id);
          else {
            addettiSel.push(u.id);
            // Un addetto appena aggiunto parte assegnato a TUTTE le fasi
            // (esplicito): poi si tolgono quelle che non lo riguardano.
            addettoFase[u.id] = fasiAssegnabili().map(f => f._k);
          }
          renderAddSelected(); renderAddDropList();
          if (aggiornaPreviewInizio) aggiornaPreviewInizio();
        },
      },
        el('span', { class:'util-row-chk' }, isSel ? '✓' : ''),
        el('span', { class:'util-row-name' }, u.nome + (u.esterno ? ' ✦' : '')),
      ));
    });
  };
  addSearchInput.oninput = renderAddDropList;
  renderAddSelected();

  // Chip multi-fase per un FORNITORE: stesso meccanismo degli addetti, ma
  // opera su sel.fase_keys (array). Nessuna chip accesa = tutta la commessa
  // (per i terzisti è uno stato legittimo: fanno tutto il lavoro esterno).
  function buildFornitoreFaseChips(sel) {
    if (!Array.isArray(sel.fase_keys)) sel.fase_keys = [];
    const wrap = el('span', { style:'display:inline-flex;gap:3px;flex-wrap:wrap;align-items:center;' });
    const ridisegna = () => {
      wrap.innerHTML = '';
      const assegnabili = fasiComm.filter(f => f.tipo_lavorazione_id);
      assegnabili.forEach((f, i) => {
        const on = sel.fase_keys.includes(f._k);
        wrap.append(el('button', {
          type:'button',
          style:'font-size:11px;padding:2px 7px;border-radius:10px;cursor:pointer;font-family:JetBrains Mono,monospace;'
            + (on ? 'background:var(--acc);color:var(--bg);border:1px solid var(--acc);font-weight:700;'
                  : 'background:transparent;color:var(--mut);border:1px solid var(--brd);'),
          title: (on ? 'Togli da' : 'Assegna a') + ' #' + (i+1) + ' ' + tipoNomeFase(f.tipo_lavorazione_id),
          onclick: () => {
            if (!canEdit) return;
            sel.fase_keys = on ? sel.fase_keys.filter(k => k !== f._k) : [...sel.fase_keys, f._k];
            ridisegna();
            // Il blocco fasi marca le esterne e il confronto separa
            // interne/esterne: vanno rinfrescati a ogni spunta.
            if (typeof renderFasiComm === 'function') renderFasiComm();
            if (typeof aggiornaConfrontoComm === 'function') aggiornaConfrontoComm();
          },
        }, '#' + (i + 1) + ' ' + tipoNomeFase(f.tipo_lavorazione_id)));
      });
      if (sel.fase_keys.length === 0) {
        wrap.append(el('span', { style:'font-size:11px;color:var(--mut);font-family:JetBrains Mono,monospace;' }, '· tutta la commessa'));
      }
    };
    ridisegna();
    return wrap;
  }
  // ── Fornitori esterni (aziende con is_fornitore=true) ─────────────
  // Stato locale: array di azienda_id allocati a questa commessa.
  // Stato locale fornitori esterni: lista di oggetti {azienda_id, numero_ordine, allocazione}.
  // Cambio rispetto al vecchio modello: prima era un semplice array di id.
  // Ora trasporto anche numero_ordine (formato AAAA/OF/NNNNN o AAAA/OL/NNNNN, opzionale)
  // perché ogni fornitore può avere il proprio ordine di fornitura.
  // Un fornitore può stare su PIÙ fasi: raggruppo le righe per azienda e
  // raccolgo le sue fasi in fase_keys (array). Nessuna fase = tutta la commessa.
  let fornitoriSel = [];
  if (!isNew) {
    const byAz = {};
    (state.opFornitori || []).filter(r => r.operazione_id === o.id).forEach(r => {
      if (!byAz[r.azienda_id]) {
        byAz[r.azienda_id] = {
          azienda_id: r.azienda_id,
          numero_ordine: r.numero_ordine || '',
          allocazione: r.allocazione || 1.0,
          fase_keys: [],
        };
      }
      if (r.fase_id) byAz[r.azienda_id].fase_keys.push(r.fase_id);
      if (!byAz[r.azienda_id].numero_ordine && r.numero_ordine) byAz[r.azienda_id].numero_ordine = r.numero_ordine;
    });
    fornitoriSel = Object.values(byAz);
  }
  const aziendeFornitrici = state.aziende.filter(a => a.is_fornitore && a.attivo);
  // ── Prezzo fase suggerito (per fornitore): ore assegnate × tariffa €/h ──
  // Le ore sono la quota di lavoro di QUEL fornitore: somma min/pz delle sue
  // fasi (nessuna chip = tutta la commessa; commessa senza fasi = budget
  // pagato) × quantità corrente. Solo un suggerimento a video: niente salvato.
  // Inerte finché aziende.tariffa_oraria non esiste (tariffa sempre vuota).
  const suggFornitoriUpd = [];
  const aggiornaSuggFornitori = () => {
    suggFornitoriUpd.forEach(fn => { try { fn(); } catch (e) {} });
    // Stesse leve = stesso refresh: il margine sotto il totale riga usa
    // le medesime stime (hoisted, esce zitta finché il form non è pronto).
    try { aggiornaMargineRiga(); } catch (e) {}
  };
  const qtaCorrenteComm = () => {
    const inp = form.querySelector('[name="quantita"]');
    const v = inp ? parseInt(inp.value, 10) : NaN;
    return (Number.isFinite(v) && v > 0) ? v : (Number(o.quantita) || 0);
  };
  const minPzFornitore = (sel) => {
    const fasi = fasiAssegnabili();
    if (fasi.length) {
      const sue = (sel.fase_keys || []).length
        ? fasi.filter(f => (sel.fase_keys || []).includes(f._k)) : fasi;
      return sue.reduce((s, f) => s + (Number(f.minuti_unitari) || 0), 0);
    }
    const pag = pagatoComm();
    return pag != null ? pag : (Number(o.minuti_unitari) || 0);
  };
  form.addEventListener('input', (e) => {
    if (e.target && (e.target.name === 'quantita' || e.target.id === 'minuti-input')) aggiornaSuggFornitori();
  });
  const forSelectedWrap = el('div', { class:'util-selected', style:'display:flex;flex-direction:column;gap:8px;' });
  const forSearchInput = el('input', {
    type:'text', class:'util-search',
    placeholder: aziendeFornitrici.length === 0
      ? 'Nessun fornitore in anagrafica (aggiungili dalla scheda Aziende)'
      : 'Aggiungi fornitore esterno (clicca o cerca)…',
    autocomplete:'off',
  });
  if (aziendeFornitrici.length === 0) forSearchInput.disabled = true;
  const forDropList = el('div', { class:'util-droplist' });
  const forDropWrap = el('div', { class:'util-dropwrap' }, forSearchInput, forDropList);
  forSearchInput.onfocus = () => { forDropList.classList.add('open'); renderForDropList(); };
  forSearchInput.onblur = () => { setTimeout(() => forDropList.classList.remove('open'), 180); };

  const renderForSelected = () => {
    forSelectedWrap.innerHTML = '';
    suggFornitoriUpd.length = 0;
    if (typeof aggiornaDataRealistica === 'function') aggiornaDataRealistica();
    if (fornitoriSel.length === 0) {
      forSelectedWrap.append(el('span', { class:'util-empty' }, 'Nessun fornitore'));
      return;
    }
    fornitoriSel.forEach((sel, idx) => {
      const a = state.aziende.find(x => x.id === sel.azienda_id);
      if (!a) return;
      // flex-wrap: con tante fasi le chips vanno a capo invece di SCHIACCIARE
      // il nome a larghezza zero (successo con Tecnocab su commesse a 3+ fasi).
      const row = el('div', {
        style:'display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:6px 10px;background:rgba(212,140,40,.08);border:1px solid rgba(212,140,40,.3);border-radius:4px;',
      });
      // Nome fornitore + coefficiente: mai sotto i 140px, come le righe addetti
      row.append(el('div', { style:'flex:1 1 auto;min-width:140px;color:var(--yel);font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' },
        a.nome + (a.coefficiente && a.coefficiente !== 1
          ? ` · coef ${Number(a.coefficiente).toFixed(2)}` : '')));
      // Input numero ordine fornitore.
      // Accetta sia OF (Ordine Fornitore) sia OL (Ordine Lavorazione).
      // Precompilo con OF perché caso più frequente; l'utente sostituisce
      // OF→OL a mano quando serve.
      const inputNO = el('input', {
        type:'text',
        value: sel.numero_ordine || (new Date().getFullYear() + '/OF/'),
        placeholder:'2026/OF/00001 o 2026/OL/00001',
        pattern:'\\d{4}/(OF|OL)/\\d{5}',
        title:'Formato richiesto: AAAA/OF/NNNNN o AAAA/OL/NNNNN (opzionale)',
        style:'width:140px;padding:4px 8px;font-family:JetBrains Mono,monospace;font-size:11px;background:var(--sur);border:1px solid var(--brd);border-radius:3px;color:var(--txt);',
        // Padding automatico al blur. Preserva OF/OL come scelto dall'utente.
        onblur: (e) => {
          const v = e.target.value.trim();
          const m = v.match(/^(\d{4})\/(OF|OL)\/(\d{1,4})$/);
          if (m) e.target.value = m[1] + '/' + m[2] + '/' + m[3].padStart(5, '0');
          // Salvo nello stato locale (lo prenderà il submit)
          sel.numero_ordine = e.target.value.trim();
        },
        oninput: (e) => {
          // Aggiorno in tempo reale così il submit ha sempre il valore corretto
          sel.numero_ordine = e.target.value;
        },
      });
      if (!canEdit) inputNO.disabled = true;
      row.append(inputNO);
      // Chip multi-fase (compaiono solo se la commessa ha fasi assegnabili)
      if (fasiAssegnabili().length >= 1) {
        row.append(buildFornitoreFaseChips(sel));
      }
      // Bottone elimina
      if (canEdit) {
        row.append(el('button', {
          type:'button',
          style:'background:none;border:none;color:var(--yel);font-size:14px;cursor:pointer;padding:0 4px;',
          title:'Rimuovi questo fornitore',
          onclick: () => {
            fornitoriSel = fornitoriSel.filter((_, i) => i !== idx);
            renderForSelected(); renderForDropList();
            if (typeof renderFasiComm === 'function') renderFasiComm();
            if (typeof aggiornaConfrontoComm === 'function') aggiornaConfrontoComm();
            if (aggiornaPreviewInizio) aggiornaPreviewInizio();
          },
        }, '✕'));
      }
      // Prezzo suggerito live: solo se il fornitore ha una tariffa €/h
      const tariffa = Number(a.tariffa_oraria) || 0;
      if (tariffa > 0) {
        const sugg = el('div', { style:'flex-basis:100%;font-family:JetBrains Mono,monospace;font-size:11px;color:var(--mut);' });
        const upd = () => {
          const ore = minPzFornitore(sel) * qtaCorrenteComm() / 60;
          sugg.textContent = ore > 0
            ? 'prezzo suggerito ≈ € '
              + (ore * tariffa).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              + ' (' + ore.toFixed(1).replace('.', ',') + 'h × '
              + String(tariffa).replace('.', ',') + ' €/h)'
            : '';
        };
        suggFornitoriUpd.push(upd);
        upd();
        row.append(sugg);
      }
      forSelectedWrap.append(row);
    });
  };
  const renderForDropList = () => {
    const q = forSearchInput.value.trim().toLowerCase();
    const selectedIds = new Set(fornitoriSel.map(s => s.azienda_id));
    const filtered = aziendeFornitrici.filter(a =>
      !q || (a.nome || '').toLowerCase().includes(q)
    );
    forDropList.innerHTML = '';
    if (!filtered.length) {
      forDropList.append(el('div', { class:'util-noresult' },
        aziendeFornitrici.length === 0 ? 'Nessun fornitore in anagrafica' : 'Nessun fornitore trovato'));
      return;
    }
    filtered.forEach(a => {
      const isSel = selectedIds.has(a.id);
      forDropList.append(el('div', {
        class: 'util-row' + (isSel ? ' selected' : ''),
        onclick: () => {
          if (!canEdit) return;
          if (isSel) {
            fornitoriSel = fornitoriSel.filter(x => x.azienda_id !== a.id);
          } else {
            fornitoriSel.push({
              azienda_id: a.id,
              numero_ordine: '',
              allocazione: 1.0,
              fase_keys: [],
            });
          }
          renderForSelected(); renderForDropList();
          if (typeof renderFasiComm === 'function') renderFasiComm();
          if (typeof aggiornaConfrontoComm === 'function') aggiornaConfrontoComm();
          if (aggiornaPreviewInizio) aggiornaPreviewInizio();
        },
      },
        el('span', { class:'util-row-chk' }, isSel ? '✓' : ''),
        el('span', { class:'util-row-name' }, a.nome
          + (a.coefficiente && a.coefficiente !== 1
              ? ` (coef ${Number(a.coefficiente).toFixed(2)})` : '')),
      ));
    });
  };
  forSearchInput.oninput = renderForDropList;
  renderForSelected();

  // ── ORE ESTERNE (consuntivo) ──────────────────────────────────────────
  // Un posto SOLO per il lavoro esterno già fatto, con la fonte sempre in
  // chiaro: ⏱ timbrate qui dagli esterni in sede (derivate dai timbri, mai
  // copiate) e 📄 dichiarate da rapportino (inserite a mano, tariffa congelata
  // sulla riga). Il "prezzo suggerito" sulla riga fornitore resta un
  // PREVENTIVO e sta di proposito da un'altra parte: qui c'è il consuntivo.
  const wrapOreEsterne = el('div', { class:'field' });
  // Assegnate più sotto, quando i blocchi che dipendono dalle ore vengono
  // costruiti: permettono alla sezione di ridisegnarli quando si aggiunge o
  // toglie una riga di ore esterne, senza salvare e riaprire il modal.
  let aggiornaTotaliCons = null;
  let aggiornaBarraOre = null;
  const renderOreEsterne = () => {
    wrapOreEsterne.innerHTML = '';
    if (typeof oreEsterneCommessa !== 'function') return;
    const r = oreEsterneCommessa(o.id);
    const fmtE = (n) => '€ ' + Number(n).toLocaleString('it-IT',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtH = (n) => Number(n).toLocaleString('it-IT',
      { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + ' h';
    wrapOreEsterne.append(el('div', { class:'sub',
      style:'margin:18px 0 6px;color:var(--mut);text-transform:uppercase;letter-spacing:.1em;font-size:11px;' },
      '── Ore esterne ──'));
    const lista = el('div', { style:'display:flex;flex-direction:column;gap:4px;' });
    if (!r.righe.length) {
      lista.append(el('div', { class:'sub' },
        'Nessuna ora esterna registrata su questa commessa.'));
    }
    r.righe.forEach(x => {
      const riga = el('div', {
        style:'display:flex;align-items:center;gap:10px;font-family:JetBrains Mono,monospace;'
          + 'font-size:11px;padding:3px 0;border-bottom:1px solid var(--brd);' },
        el('span', { style:'width:16px;flex-shrink:0;',
          title: x.fonte === 'timbro' ? 'Ore timbrate qui dai suoi uomini' : 'Ore dichiarate dal fornitore (rapportino)' },
          x.fonte === 'timbro' ? '⏱' : '📄'),
        el('span', { style:'flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' },
          x.azienda),
        el('span', { style:'width:70px;text-align:right;flex-shrink:0;' }, fmtH(x.ore)),
        el('span', { style:'width:78px;text-align:right;flex-shrink:0;color:var(--mut);' },
          x.tariffa > 0 ? String(x.tariffa).replace('.', ',') + ' €/h' : '— €/h'),
        el('span', { style:'width:88px;text-align:right;flex-shrink:0;font-weight:700;' },
          x.costo != null ? fmtE(x.costo) : '—'),
      );
      // Dettaglio: da dove arriva questa riga, senza farlo indovinare.
      const det = [];
      if (x.fonte === 'timbro') det.push(x.nSessioni + (x.nSessioni === 1 ? ' timbro' : ' timbri')
        + (x.nAperte > 0 ? ' · ' + x.nAperte + ' ancora aperto, il totale sta salendo' : ''));
      if (x.data) det.push(fmtIT(String(x.data).slice(0, 10)));
      if (x.riferimento) det.push(x.riferimento);
      if (x.tariffaDaAnagrafica) det.push('tariffa dall\'anagrafica (non congelata)');
      if (x.costo == null) det.push('ditta senza tariffa: ore contate, costo no');
      if (det.length) riga.append(el('span', {
        class:'sub', style:'flex-basis:100%;font-size:11px;padding-left:26px;' }, det.join(' · ')));
      // Solo le righe DICHIARATE si cancellano: le timbrate sono derivate dai
      // timbri e si correggono là, non qui.
      if (canEdit && x.fonte === 'dichiarata' && x.id) {
        riga.append(el('button', { type:'button', class:'btnd',
          style:'padding:0 6px;flex-shrink:0;', title:'Elimina questa riga di rapportino',
          onclick: async () => {
            if (!confirm('Eliminare ' + fmtH(x.ore) + ' dichiarate da ' + x.azienda + '?')) return;
            const { error } = await eseguiConRetry(
              () => sb.from('ore_esterne').delete().eq('id', x.id),
              { label: 'eliminazione ore esterne' });
            if (error) return toast(error.message, 'err');
            state.oreEsterne = state.oreEsterne.filter(y => y.id !== x.id);
            toast('Riga eliminata');
            renderOreEsterne(); aggiornaMargineRiga();
            if (aggiornaTotaliCons) aggiornaTotaliCons();
            if (aggiornaBarraOre) aggiornaBarraOre();
          } }, '✕'));
      }
      lista.append(riga);
    });
    if (r.righe.length) {
      lista.append(el('div', {
        style:'display:flex;align-items:center;gap:10px;font-family:JetBrains Mono,monospace;'
          + 'font-size:11px;padding-top:5px;font-weight:700;' },
        el('span', { style:'width:16px;flex-shrink:0;' }, ''),
        el('span', { style:'flex:1;min-width:120px;' }, 'totale'),
        el('span', { style:'width:70px;text-align:right;flex-shrink:0;' }, fmtH(r.oreTot)),
        el('span', { style:'width:78px;flex-shrink:0;' }, ''),
        el('span', { style:'width:88px;text-align:right;flex-shrink:0;' }, fmtE(r.costoTot)),
      ));
    }
    wrapOreEsterne.append(lista);
    // I totali devono QUADRARE con il riepilogo per fase qui sopra, che conta
    // tutti i timbri (esterni compresi). Quindi: le ⏱ sono già lì dentro, le
    // 📄 no — nessuno le ha timbrate. Senza questa riga uno legge 12,59 sopra
    // e 12,59 qui e pensa che siano 25.
    const oreTimbrate = r.righe.filter(x => x.fonte === 'timbro')
      .reduce((s, x) => s + x.ore, 0);
    const oreDich = r.righe.filter(x => x.fonte === 'dichiarata')
      .reduce((s, x) => s + x.ore, 0);
    if (oreTimbrate > 0 || oreDich > 0) {
      const parti = [];
      if (oreTimbrate > 0) parti.push('⏱ ' + fmtH(oreTimbrate) + ' sono già dentro il riepilogo per fase qui sopra');
      if (oreDich > 0) parti.push('📄 ' + fmtH(oreDich) + ' non sono timbrate da nessuno: si sommano a quelle ore');
      wrapOreEsterne.append(el('div', { class:'sub', style:'margin-top:6px;font-size:11px;' },
        parti.join(' · ')));
    }
    // Il doppio conteggio è l'errore che si nasconderebbe meglio: dichiarato.
    if (r.conflitti.length) {
      wrapOreEsterne.append(el('div', { class:'sub',
        style:'margin-top:6px;color:var(--yel);font-size:11px;' },
        '⚠ ' + r.conflitti.join(', ') + (r.conflitti.length === 1 ? ' ha' : ' hanno')
        + ' sia ore timbrate qui sia ore da rapportino su questa commessa. '
        + 'Verifica che non siano le stesse ore contate due volte.'));
    }
    if (r.senzaTariffa.length) {
      wrapOreEsterne.append(el('div', { class:'sub', style:'margin-top:4px;font-size:11px;' },
        'Senza tariffa oraria in anagrafica: ' + r.senzaTariffa.join(', ')
        + ' — le ore sono contate, il costo no.'));
    }
    // Inserimento a mano (solo con la tabella attiva)
    if (oreEsterneTabellaOk === true && canEdit) {
      const selAz = el('select', { style:'max-width:200px;' },
        el('option', { value:'' }, '— ditta —'),
        ...(state.aziende || []).filter(a => a.is_fornitore && a.attivo !== false)
          .sort((a, b) => (a.nome || '').localeCompare(b.nome || ''))
          .map(a => el('option', { value:a.id }, a.nome)));
      const inOre = el('input', { type:'number', step:'0.25', min:'0', placeholder:'ore',
        style:'width:72px;' });
      const inData = el('input', { type:'date', style:'width:140px;' });
      const inRif = el('input', { type:'text', placeholder:'rif. rapportino', style:'width:140px;' });
      const notaTar = el('div', { class:'sub', style:'font-size:11px;flex-basis:100%;min-height:13px;' });
      const aggiornaNotaTar = () => {
        const az = (state.aziende || []).find(a => a.id === selAz.value);
        const t = Number(az && az.tariffa_oraria) || 0;
        const ore = parseFloat((inOre.value || '').replace(',', '.')) || 0;
        notaTar.textContent = !az ? ''
          : (t > 0
              ? 'Tariffa ' + String(t).replace('.', ',') + ' €/h'
                + (ore > 0 ? ' → ' + fmtE(ore * t) : '')
                + ' · viene CONGELATA sulla riga: cambiarla in anagrafica non toccherà questo consuntivo.'
              : '⚠ ' + az.nome + ' non ha una tariffa oraria in anagrafica: le ore si salvano, il costo resterà vuoto.');
      };
      selAz.onchange = aggiornaNotaTar;
      inOre.oninput = aggiornaNotaTar;
      const btnAdd = el('button', { type:'button', class:'btnsm', onclick: async () => {
        const ore = parseFloat((inOre.value || '').replace(',', '.')) || 0;
        if (!selAz.value) return toast('Scegli la ditta', 'err');
        if (!(ore > 0)) return toast('Ore: serve un numero maggiore di zero', 'err');
        const az = (state.aziende || []).find(a => a.id === selAz.value);
        const tariffa = Number(az && az.tariffa_oraria) || null;
        const { data, error } = await eseguiConRetry(
          () => sb.from('ore_esterne').insert({
            operazione_id: o.id, azienda_id: selAz.value, ore,
            tariffa, data: inData.value || null,
            riferimento: (inRif.value || '').trim() || null,
          }).select().single(),
          { label: 'inserimento ore esterne' });
        if (error) return toast(error.message, 'err');
        state.oreEsterne.push(data);
        inOre.value = ''; inRif.value = ''; notaTar.textContent = '';
        toast('Ore esterne registrate');
        renderOreEsterne(); aggiornaMargineRiga();
        if (aggiornaTotaliCons) aggiornaTotaliCons();
        if (aggiornaBarraOre) aggiornaBarraOre();
      } }, '+ Aggiungi ore');
      wrapOreEsterne.append(
        el('div', { style:'display:flex;gap:6px;align-items:center;margin-top:8px;flex-wrap:wrap;' },
          selAz, inOre, inData, inRif, btnAdd, notaTar));
      wrapOreEsterne.append(el('div', { class:'sub', style:'margin-top:4px;font-size:11px;' },
        'Inserisci qui le ore che il fornitore ti dichiara per il lavoro fatto nella SUA sede. '
        + 'Le ore dei suoi uomini che timbrano qui compaiono da sole (⏱) e non vanno riscritte.'));
    } else if (oreEsterneTabellaOk === false) {
      wrapOreEsterne.append(el('div', { class:'sub', style:'margin-top:6px;font-size:11px;' },
        'Inserimento a mano non attivo: manca la tabella `ore_esterne` (migrazione dal pannello '
        + 'Supabase). Le ore timbrate dagli esterni in sede si vedono comunque.'));
    }
  };

  // Stato + preparazione
  const selStato = el('select', { name:'stato' },
    el('option', { value:'aperta' }, 'Aperta'),
    el('option', { value:'sospesa' }, 'Sospesa'),
    el('option', { value:'completata' }, 'Completata'),
    el('option', { value:'spedita' }, 'Spedita'),
  );
  selStato.value = o.stato || 'aperta';

  const selPrep = el('select', { name:'stato_preparazione' },
    el('option', { value:'vuoto' }, 'Vuoto'),
    el('option', { value:'parziale' }, 'Parziale'),
    el('option', { value:'completo' }, 'Completo'),
  );
  selPrep.value = o.stato_preparazione || 'vuoto';

  // ── MATERIALE MANCANTE (dal fabbisogno importato) ──────────────────────
  // Elenco di sola lettura: la fonte è l'estrazione del magazzino, qui non si
  // modifica. Compare ogni volta che ci sono mancanti su questo numero OP —
  // anche se la tendina dice "completo": in quel caso la contraddizione viene
  // DICHIARATA invece di restare nascosta (decisione Nico).
  const notaMancanti = el('div', { style:'margin-top:6px;' });
  const renderMancanti = () => {
    notaMancanti.innerHTML = '';
    if (typeof mancantiCommessa !== 'function') return;
    const m = mancantiCommessa({ ...o, stato_preparazione: selPrep.value });
    if (!m.nCodici) {
      if (o.numero_op && (state.mancanti || []).length) {
        notaMancanti.append(el('div', { class:'sub', style:'font-size:11px;' },
          'Nessun codice mancante per ' + o.numero_op + ' nell\'ultimo fabbisogno importato.'));
      }
      return;
    }
    const nf = (n) => n == null ? '—' : Number(n).toLocaleString('it-IT', { maximumFractionDigits: 2 });
    const oggi = toLocalISO(new Date());
    const righe = m.righe.map(x => {
      const blocc = mancanteBloccante(x);
      const cat = mancanteCategoria(x);
      const cons = mancanteConsegne(x);
      const prima = cons[0];
      // Stessa distinzione del resto dell'app: il conto lavoro manca eccome,
      // ma non è "da ordinare" — e non è nemmeno "già ordinato".
      const ICONA = { da_ordinare:'⛔ ', attesa_cliente:'⏳ ', in_arrivo:'📦 ', consumo:'· ' };
      const DETTA = {
        da_ordinare:    ' · da ordinare',
        attesa_cliente: ' · in attesa dal cliente',
        consumo:        ' · materiale di consumo',
      };
      return {
        titolo: (ICONA[cat] || '📦 ') + x.codice,
        meta: (x.descrizione ? String(x.descrizione).slice(0, 40) : '—')
          + (DETTA[cat] !== undefined ? DETTA[cat]
                   : (prima ? ' · in arrivo ' + fmtIT(prima.data)
                       + (prima.data < oggi ? ' ⚠ in ritardo' : '') : ' · già ordinato')),
        valore: 'mancano ' + nf((blocc || cat === 'attesa_cliente') ? x.qta_da_ordinare
            : Math.abs((Number(x.giacenza) || 0) - (Number(x.impegno) || 0)))
          + (x.um ? ' ' + x.um : ''),
      };
    });
    // Il sommario dice subito la cosa che conta: chi deve muoversi. Le quattro
    // categorie restano distinte anche qui — sommare conto lavoro e "in
    // arrivo" farebbe sembrare ordinato qualcosa che nessuno ha ordinato.
    const pezzi = [];
    if (m.nBloccanti) pezzi.push('⛔ ' + m.nBloccanti
      + (m.nBloccanti === 1 ? ' codice da ordinare' : ' codici da ordinare'));
    if (m.nAttesaCliente) pezzi.push('⏳ ' + m.nAttesaCliente + ' in attesa dal cliente');
    if (m.nInArrivoVero) pezzi.push('📦 ' + m.nInArrivoVero + ' in arrivo'
      + (m.prossima ? ', prossima consegna ' + fmtIT(m.prossima) : ''));
    if (m.nConsumo) pezzi.push('· ' + m.nConsumo + ' di consumo');
    const sommario = pezzi.join('  ·  ')
      || ('📦 ' + m.nCodici + (m.nCodici === 1 ? ' codice' : ' codici'));
    notaMancanti.append(entityTimeline({
      sommario: sommario
        + (m.nRitardo ? ' · ⚠ ' + m.nRitardo + ' in ritardo' : '')
        + (m.dataImport ? ' · estrazione del ' + fmtIT(String(m.dataImport).slice(0, 10)) : ''),
      debole: m.nBloccanti > 0,
      // APERTO di default: qui lo scopo è vedere i codici, non doverli cercare.
      // Sopra una certa lunghezza resta chiuso, altrimenti 67 righe sommergono
      // il resto della scheda: il riepilogo basta, il dettaglio si apre.
      apertaDiDefault: righe.length <= 15,
      righe,
    }));
    if (m.incoerente) {
      notaMancanti.append(el('div', { class:'sub',
        style:'margin-top:4px;color:var(--red);font-size:11px;' },
        '⚠ La preparazione è dichiarata COMPLETA ma il fabbisogno riporta '
        + m.nCodici + (m.nCodici === 1 ? ' codice mancante' : ' codici mancanti') + '.'));
    }
  };
  selPrep.addEventListener('change', renderMancanti);

  // ── Fasi della commessa: SOLA LETTURA dall'anagrafica articolo ──
  // (media storica viva + valori manuali per i tipi senza storico).
  // Si modificano con la matita, che apre la scheda anagrafica. Il toggle
  // sequenza/parallelo è stato tolto: il motore pianifica sempre in sequenza.
  // L'assegnazione per fase vive nelle chip di addetti e fornitori.
  const fasiWrapComm = el('div', { class:'fasi-list' });
  const notaConfrontoComm = el('div', { class:'sub', style:'margin-top:8px;font-family:monospace;' });
  function pagatoComm() {
    const mi = form.querySelector('#minuti-input');
    const v = mi ? parseFloat((mi.value || '').toString().replace(',', '.')) : NaN;
    return Number.isFinite(v) ? v : null;
  }
  // Fornitori assegnati a una fase (per chiave _k): nomi per il badge "esterna".
  // Legge la selezione LIVE delle chip, così spuntare/togliere aggiorna subito.
  function faseEsterna(k) {
    return (fornitoriSel || [])
      .filter(s => (s.fase_keys || []).includes(k))
      .map(s => (state.aziende.find(a => a.id === s.azienda_id) || {}).nome || '?');
  }
  function aggiornaConfrontoComm() {
    if (fasiComm.length === 0) { notaConfrontoComm.textContent = ''; notaConfrontoComm.style.color = ''; return; }
    const somma = +fasiComm.reduce((s, f) => s + (Number(f.minuti_unitari) || 0), 0).toFixed(2);
    let esterne = 0;
    fasiComm.forEach(f => { if (faseEsterna(f._k).length) esterne += Number(f.minuti_unitari) || 0; });
    esterne = +esterne.toFixed(2);
    const interne = +(somma - esterne).toFixed(2);
    const dett = esterne > 0 ? ` (interne ${interne} · esterne ${esterne})` : '';
    const pagato = pagatoComm();
    if (pagato === null) {
      notaConfrontoComm.style.color = 'var(--mut)';
      notaConfrontoComm.textContent = `Somma fasi: ${somma} min/pz${dett} · tempo pagato non impostato`;
    } else if (somma > pagato) {
      notaConfrontoComm.style.color = 'var(--red)';
      notaConfrontoComm.textContent = `⚠ Somma fasi ${somma}${dett} · pagato ${pagato} · sfori di ${+(somma - pagato).toFixed(2)} min/pz`;
    } else {
      notaConfrontoComm.style.color = 'var(--grn)';
      notaConfrontoComm.textContent = `Somma fasi ${somma}${dett} · pagato ${pagato} · margine ${+(pagato - somma).toFixed(2)} min/pz`;
    }
    // Le stesse azioni che cambiano il confronto (chip fasi, fornitori,
    // riallineamento fasi) spostano anche il prezzo suggerito dei fornitori.
    aggiornaSuggFornitori();
  }
  // Ripulisce le assegnazioni che puntano a fasi non più valide.
  function pruneFaseAssegnazioni() {
    const validi = new Set(fasiAssegnabili().map(f => f._k));
    Object.keys(addettoFase).forEach(uid => {
      const v = addettoFase[uid];
      const arr = Array.isArray(v) ? v : (v ? [v] : []);
      const puliti = arr.filter(k => validi.has(k));
      // Se la pulizia lascia l'addetto senza fasi ma le fasi esistono,
      // torna a "tutte" (esplicito) per non creare lo stato ambiguo.
      addettoFase[uid] = (puliti.length === 0 && validi.size > 0)
        ? [...validi] : puliti;
    });
    (fornitoriSel || []).forEach(s => {
      s.fase_keys = (s.fase_keys || []).filter(k => validi.has(k));
    });
  }
  // Quando cambiano le fasi: ridisegno editor, confronto e le tendine "fase" di
  // addetti/fornitori (le opzioni dipendono dalle fasi correnti).
  function onFasiChanged() {
    pruneFaseAssegnazioni();
    renderFasiComm();
    aggiornaConfrontoComm();
    if (typeof renderAddSelected === 'function') renderAddSelected();
    if (typeof renderForSelected === 'function') renderForSelected();
    if (typeof aggiornaDataRealistica === 'function') aggiornaDataRealistica();
  }
  // Fornitori assegnati "a tutta la commessa" (nessuna fase spuntata):
  // lavorano in QUOTA con gli interni su tutte le fasi — il nome non deve
  // sparire dal blocco solo perché non c'è una fase specifica.
  function badgeFornitoriTuttaCommessa() {
    try {
      const tutti = (fornitoriSel || [])
        .filter(s => !(s.fase_keys || []).length)
        .map(s => (state.aziende.find(a => a.id === s.azienda_id) || {}).nome || '?');
      if (!tutti.length) return null;
      return el('div', { class:'sub',
        style:'margin-top:6px;font-family:JetBrains Mono,monospace;font-size:11px;color:var(--yel);' },
        '⚙ Fornitore su tutta la commessa: ' + tutti.join(', ') + ' (in quota con gli interni)');
    } catch (e) { return null; }
  }
  function renderFasiComm() {
    fasiWrapComm.innerHTML = '';
    if (fasiComm.length === 0) {
      let msg = 'Nessuna fase in anagrafica: la commessa usa il solo tempo pagato.';
      if (isNew) {
        let selId = null;
        try {
          const v = acArticolo.getValue();
          selId = (v.mode === 'existing' && v.id) ? v.id : null;
        } catch (e) {}
        if (!selId) msg = 'Le fasi compaiono scegliendo l\'articolo (dalla sua anagrafica).';
      }
      fasiWrapComm.append(el('div', { class:'sub' }, msg));
      const b0 = badgeFornitoriTuttaCommessa();
      if (b0) fasiWrapComm.append(b0);
      return;
    }
    fasiComm.forEach((f, i) => {
      const tipo = state.tipiLav.find(t => t.id === f.tipo_lavorazione_id);
      const fonte = f._fonte === 'storico'
        ? 'media storica' + (f._nComm ? ' · ' + f._nComm + (f._nComm === 1 ? ' commessa' : ' commesse') : '')
        : (f._fonte === 'template'
          ? 'manuale da anagrafica'
          : '⚠ solo su questa commessa (non più in anagrafica)');
      const est = faseEsterna(f._k);
      fasiWrapComm.append(el('div', { style:'display:flex;gap:10px;align-items:center;margin:6px 0;' },
        el('span', { class:'sub', style:'width:20px;flex-shrink:0;' }, '#' + (i + 1)),
        el('span', { style:'width:10px;height:10px;border-radius:2px;flex-shrink:0;background:' + (tipo?.colore || '#6b6b64') + ';' }),
        el('span', { style:'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' },
          tipo?.nome || '—'),
        el('span', { style:'font-family:JetBrains Mono,monospace;font-size:12px;flex-shrink:0;' },
          String(f.minuti_unitari).replace('.', ',') + ' min/pz'),
        est.length
          ? el('span', { style:'flex-shrink:0;font-size:11px;font-family:JetBrains Mono,monospace;color:var(--yel);font-weight:700;' },
              '→ ' + est.join(', ') + ' (esterna)')
          : null,
        el('span', { class:'sub', style:'flex-shrink:0;font-size:11px;color:var(--mut);' }, fonte),
      ));
    });
    const bTot = badgeFornitoriTuttaCommessa();
    if (bTot) fasiWrapComm.append(bTot);
  }
  renderFasiComm();

  // ── Struttura a schede: i pannelli vivono DENTRO il form, così FormData
  // legge anche i campi delle schede non visibili al momento del salvataggio.
  // Vengono agganciati SUBITO al form (prima di riempirli), così tutti i
  // form.querySelector(...) dei blocchi di setup trovano i campi.
  const pDati = el('div', { class:'optab-panel on' });
  const pLav  = el('div', { class:'optab-panel' });
  const pProd = el('div', { class:'optab-panel' });
  const pCons = el('div', { class:'optab-panel' });
  form.append(pDati, pLav, pProd, pCons);

  pDati.append(
    el('div', { class:'frow' },
      el('div', { class:'field' }, el('label', {}, 'Cliente *'), acCliente.container),
      el('div', { class:'field' }, el('label', {}, 'Codice articolo *'), acArticolo.container),
    ),
    el('div', { class:'frow' },
      el('div', { class:'field' }, el('label', {}, 'Numero ordine *'),
        el('input', { type:'text', name:'numero_ordine',
          value: o.numero_ordine || (new Date().getFullYear() + '/OC/'),
          placeholder:'es. 2026/OC/00388',
          pattern:'\\d{4}/OC/\\d{5}',
          required:'true',
          title:'Formato richiesto: AAAA/OC/NNNNN (numero a 5 cifre, es. 2026/OC/00388)',
          // Al blur: se l'input matcha "AAAA/OC/N" con 1-4 cifre, padda a 5.
          // Niente altra magia: l'utente vede solo lo zero-padding,
          // qualsiasi altra deviazione resta com'è (gestita dalla validazione).
          onblur: (e) => {
            const v = e.target.value.trim();
            const m = v.match(/^(\d{4})\/OC\/(\d{1,4})$/);
            if (m) e.target.value = m[1] + '/OC/' + m[2].padStart(5, '0');
          },
        })),
      el('div', { class:'field' }, el('label', {}, 'POS'),
        el('input', { type:'text', name:'pos', value:o.pos||'',
          placeholder:'es. 0010',
          // Gli zeri si mettono subito, non solo al salvataggio: chi scrive
          // "20" deve vedere "0020" mentre e' ancora nel campo.
          onblur:(e)=>{ e.target.value = posNormalizzata(e.target.value) || ''; } })),
    ),
    el('div', { class:'frow' },
      el('div', { class:'field' }, el('label', {}, 'Numero OP'),
        el('input', { type:'text', name:'numero_op',
          value: o.numero_op || (new Date().getFullYear() + '/OP/'),
          placeholder:'es. 2026/OP/00001 (opzionale)',
          pattern:'\\d{4}/OP/\\d{5}',
          title:'Formato richiesto: AAAA/OP/NNNNN (opzionale)',
          // Al blur: stesso pattern del numero ordine ma per OP.
          // Se l'utente lascia solo "AAAA/OP/" il submit lo convertirà in null.
          onblur: (e) => {
            const v = e.target.value.trim();
            const m = v.match(/^(\d{4})\/OP\/(\d{1,4})$/);
            if (m) e.target.value = m[1] + '/OP/' + m[2].padStart(5, '0');
          },
        })),
      el('div', { class:'field' }, el('label', {}, 'Riferimento cliente'),
        el('input', { type:'text', name:'riferimento_cliente',
          value: o.riferimento_cliente || '',
          placeholder:'es. ABC-001, PO12345, DDT 4456' })),
    ),
    el('div', { class:'frow' },
      el('div', { class:'field' }, el('label', {}, 'Quantità *'),
        el('input', { type:'number', name:'quantita', value:String(o.quantita||1), min:'1', required:'true' })),
      el('div', { class:'field' },
        el('label', { id:'minuti-label' }, 'Minuti unitari (tempo pagato)',
          el('span', { id:'minuti-diff', style:'color:var(--yel);margin-left:4px;display:none;', title:'Valore diverso dal default dell\'articolo (clicca per ripristinare)' }, '*')),
        el('input', {
          type:'number', name:'minuti_unitari', id:'minuti-input',
          value: String(o.minuti_unitari != null ? o.minuti_unitari : ''),
          min:'0', step:'0.5',
        }),
        el('div', { class:'sub', id:'minuti-hint', style:'margin-top:4px;font-size:11px;color:var(--mut);' },
          'Suggerito automaticamente dall\'articolo selezionato.'),
        el('div', { class:'sub', id:'minuti-da-prezzo', style:'margin-top:2px;font-size:11px;display:none;' })),
    ),
    // Prezzo di vendita (€/pezzo) + totale riga. Pre-compilato dall'ultimo
    // prezzo usato per stesso articolo+cliente (listino vivo). Il blocco viene
    // rimosso se la colonna prezzo_unitario non esiste ancora (pre-migrazione).
    el('div', { class:'frow', id:'prezzo-frow' },
      el('div', { class:'field' }, el('label', {}, 'Prezzo unitario (€/pz)'),
        el('input', { type:'number', name:'prezzo_unitario', id:'prezzo-input',
          value: String(o.prezzo_unitario != null ? o.prezzo_unitario : ''),
          min:'0', step:'0.01', placeholder:'€ per pezzo' }),
        el('div', { class:'sub', id:'prezzo-hint', style:'margin-top:4px;font-size:11px;color:var(--mut);' },
          'Ultimo prezzo per articolo+cliente (modificabile).'),
        el('div', { class:'sub', id:'prezzo-da-consuntivo', style:'margin-top:2px;font-size:11px;display:none;' })),
      el('div', { class:'field' }, el('label', {}, 'Totale riga'),
        el('div', { id:'prezzo-totale', style:'padding:8px 0 2px;font-family:JetBrains Mono,monospace;font-size:15px;font-weight:700;' }, '—'),
        el('div', { class:'sub', id:'margine-riga', style:'font-size:11px;font-family:JetBrains Mono,monospace;' })),
    ),
    el('div', { class:'frow' },
      el('div', { class:'field' }, el('label', {}, 'Scadenza'),
        el('input', { type:'date', name:'scadenza', value:o.scadenza||'' })),
      el('div', { class:'field' },
        el('label', { style:'display:flex;align-items:center;gap:6px;' },
          'Inizio',
          el('button', {
            type:'button',
            id:'inizio-lock-btn',
            title:'Lucchetto: aperto = data calcolata automaticamente. Chiuso = data fissa, non si ricalcola.',
            style:'background:transparent;border:none;cursor:pointer;font-size:13px;padding:0;color:var(--mut);',
          }, o.inizio_manuale ? '🔒' : '🔓'),
        ),
        el('input', { type:'date', name:'inizio', id:'inizio-input', value:(o.inizio_manuale || opCalcInizio(o) || '') }),
        el('div', { class:'sub', id:'inizio-hint', style:'margin-top:4px;' },
          o.inizio_manuale
            ? 'Data fissa: non si ricalcola se cambi quantità o addetti.'
            : 'Data calcolata automaticamente. Clicca il lucchetto per forzarla.')),
    ),
    el('div', { class:'frow' },
      el('div', { class:'field' }, el('label', {}, 'Consegna materiali entro'),
        el('input', { type:'date', name:'cl_consegna_materiali', value:o.cl_consegna_materiali||'' })),
      el('div', { class:'field' }, el('label', {}, 'Stato'), selStato),
    ),
    el('div', { class:'field' }, el('label', {}, 'Note'),
      el('textarea', { name:'note', rows:'2' }, o.note||'')),
  );

  // ── Data REALISTICA (solo commessa nuova): promessa onesta al cliente ──
  // In avanti: coda attuale degli addetti scelti (livellaOperatore) + fasi
  // nuove sulla capacità della squadra, ferie e chiusure comprese.
  const boxRealistica = isNew ? el('div', { class:'sub',
    style:'padding:8px 10px;background:var(--sur2);border:1px solid var(--brd);border-radius:4px;'
      + 'font-family:JetBrains Mono,monospace;font-size:11px;' }) : null;
  // Wrapper con etichetta: nascosto TUTTO finché non c'è una stima
  // (senza dati l'etichetta orfana sembrerebbe un riquadro rotto).
  const fieldRealistica = boxRealistica
    ? el('div', { class:'field', style:'display:none;' },
        el('label', {}, 'Data realistica di consegna'), boxRealistica)
    : null;
  function aggiornaDataRealistica() {
    // try esteso: alla prima render del modal boxRealistica/fornitoriSel
    // possono essere ancora in TDZ (dichiarati più sotto) — si esce zitti
    // e la chiamata buona arriva a fine setup.
    try {
      if (!boxRealistica) return;
      const oggi = toLocalISO(new Date());
      const qta = parseFloat(((form.querySelector('[name=quantita]') || {}).value || '').toString().replace(',', '.')) || 0;
      const fasiOk = fasiComm.filter(f => f.tipo_lavorazione_id && Number(f.minuti_unitari) > 0);
      const stima = (qta > 0 && fasiOk.length && (addettiSel.length || fornitoriSel.length))
        ? stimaFineCommessaNuova(addettiSel, fornitoriSel, fasiOk, qta) : null;
      if (!stima) { fieldRealistica.style.display = 'none'; return; }
      const scadV = (form.querySelector('[name=scadenza]') || {}).value || '';
      const oltre = scadV && stima.fine > scadV;
      fieldRealistica.style.display = '';
      boxRealistica.style.borderColor = oltre ? 'var(--red)' : 'var(--brd)';
      boxRealistica.innerHTML = '';
      boxRealistica.append(
        el('div', { style:'font-size:13px;font-weight:700;color:' + (oltre ? 'var(--red)' : 'var(--grn)') + ';' },
          'Fine realistica: ' + fmtIT(stima.fine)
          + (scadV ? (oltre ? '  ⚠ oltre la richiesta (' + fmtIT(scadV) + ')' : '  ✓ entro la richiesta (' + fmtIT(scadV) + ')') : '')),
        el('div', { style:'color:var(--mut);margin-top:3px;' },
          stima.oreTot.toFixed(1).replace('.', ',') + 'h di lavoro · partenza ' + (stima.inizio === oggi ? 'oggi' : fmtIT(stima.inizio))
          + ' · ' + stima.liberi.map(l => {
              const un = state.utenti.find(x => x.id === l.uid);
              return (un ? un.nome.split(' ')[0] : '?')
                + (l.libero <= oggi ? ': libero' : ': occupato fino al ' + fmtIT(l.libero));
            }).join(' · ')),
        el('div', { style:'color:var(--mut);font-size:11px;margin-top:3px;' },
          'Coda attuale degli addetti scelti + ferie/chiusure. Solo indicativa: nessuna data viene salvata.'),
      );
    } catch (e) { /* setup non ancora completo o dati parziali: niente box */ }
  }

  // Matita fasi: apre l'anagrafica dell'articolo; alla chiusura riapre questa
  // commessa (il blocco si ricostruisce e vede i valori aggiornati).
  const btnFasiAnagrafica = (() => {
    if (isNew || !canEdit || !o.articolo_id) return null;
    const art = state.articoli.find(x => x.id === o.articolo_id);
    if (!art) return null;
    return el('div', { style:'margin-top:6px;' },
      el('button', { type:'button', class:'btnsm',
        title:'Apre la scheda articolo: le fasi si modificano lì. Valgono per questa commessa (al salvataggio) e per le future.',
        onclick: () => openArticoloModal(art, {
          dopoChiusura: () => openOperazioneModal(state.operazioni.find(x => x.id === o.id) || o),
        }),
      }, '✎ Modifica in anagrafica'));
  })();
  pLav.append(
    el('div', { class:'field' }, el('label', {}, 'Fasi (da anagrafica articolo)'),
      fasiWrapComm, notaConfrontoComm, btnFasiAnagrafica,
      el('div', { class:'sub', style:'margin-top:4px;' },
        'Gestite in automatico dall\'anagrafica: media storica dei consuntivi, valori manuali solo per i tipi senza storico. '
        + 'Si riallineano a questa commessa quando la salvi. La somma dovrebbe stare entro il tempo pagato.')),
    el('div', { class:'field' }, el('label', {}, 'Addetti previsti'),
      addSelectedWrap, addDropWrap,
      el('div', { class:'sub', style:'margin-top:4px;' },
        'Puoi assegnare più persone. Il lavoro verrà ripartito tra loro.')),
    el('div', { class:'field' }, el('label', {}, 'Fornitori esterni'),
      forSelectedWrap, forDropWrap,
      el('div', { class:'sub', style:'margin-top:4px;' },
        'Ditte terze che contribuiscono alla lavorazione (con coefficiente di capacità). '
        + 'Il prezzo suggerito qui è una STIMA a preventivo: le ore realmente fatte stanno '
        + 'nella scheda Consuntivo, sezione "Ore esterne".')),
    ...(fieldRealistica ? [fieldRealistica] : []),
    el('div', { class:'frow' },
      el('div', { class:'field' }, el('label', {}, 'Preparazione materiale'), selPrep, notaMancanti),
      el('div', { class:'field' }),
    ),
  );

  // Confronto fasi ↔ pagato: aggiorna quando cambi i minuti pagati, e una volta all'avvio.
  (function () {
    const mi = form.querySelector('#minuti-input');
    if (mi) mi.addEventListener('input', aggiornaConfrontoComm);
    aggiornaConfrontoComm();
  })();

  // Sezione storico (solo se spedita)
  if (!isNew && o.stato === 'spedita') {
    pDati.append(
      el('div', { class:'sub', style:'margin:14px 0 6px;color:var(--mut);text-transform:uppercase;letter-spacing:.1em;font-size:11px;' },
        '── Dati consegna ──'),
      el('div', { class:'frow' },
        el('div', { class:'field' }, el('label', {}, 'Consegnato il'),
          el('input', { type:'date', name:'consegnato_il', value:o.consegnato_il||'' })),
        el('div', { class:'field' }, el('label', {}, 'Responsabilità'),
          el('input', { type:'text', name:'responsabilita', value:o.responsabilita||'' })),
      ),
      el('div', { class:'field' }, el('label', {}, 'Giustificazione ritardo'),
        el('textarea', { name:'giustificazione_ritardo', rows:'2' }, o.giustificazione_ritardo||'')),
      el('div', { class:'field' }, el('label', {}, 'NC post-consegna'),
        el('textarea', { name:'nc_post_consegna', rows:'2' }, o.nc_post_consegna||'')),
    );
  }

  // ─── Sezione: sessioni di lavoro ───
  if (!isNew) {
    const sessOp = state.sessioni
      .filter(s => s.operazione_id === o.id)
      .sort((a,b) => (b.inizio||'').localeCompare(a.inizio||''));

    const orePrev = opCalcOre(o);
    const orePrevInt = opCalcOreInterne(o);
    // NB: questo è il PREVISTO delle fasi esternalizzate (budget), non le ore
    // realmente fatte da terzi — quelle stanno in `cons.oreEsterne`.
    // Il preventivo non cambia mentre il modal è aperto, quindi si calcola una
    // volta; consuntivo, percentuale e sforo li ricalcola `renderTotali`, che
    // rigira a ogni riga di ore esterne aggiunta o rimossa.
    const prevEsterno = Math.max(0, orePrev - orePrevInt);

    pCons.append(
      el('div', { class:'sub', style:'margin:18px 0 6px;color:var(--mut);text-transform:uppercase;letter-spacing:.1em;font-size:11px;' },
        '── Sessioni di lavoro ──'),
    );

    // ── Riepilogo per FASE: quale ha sforato e quale no ──
    const fasiOp = (state.opFasi || [])
      .filter(f => f.operazione_id === o.id)
      .sort((a, b) => (a.ordine || 0) - (b.ordine || 0));
    if (fasiOp.length > 0) {
      const box = el('div', { style:'background:var(--sur2);border:1px solid var(--brd);border-radius:4px;padding:10px 12px;font-family:monospace;font-size:12px;margin-bottom:10px;' });
      box.append(el('div', { style:'color:var(--mut);font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px;' }, 'Riepilogo per fase'));
      // Totali di fase in MINUTI (i minuti/pezzo delle fasi sono in minuti:
      // stessa unità, confronto immediato senza conversioni a mente).
      let sommaConsFasi = 0;
      fasiOp.forEach((f, i) => {
        const tipo = state.tipiLav.find(t => t.id === f.tipo_lavorazione_id);
        const fPrev = faseCalcOre(o, f);
        const fCons = faseCalcOreReali(o, f);
        sommaConsFasi += fCons;
        // Fase affidata a fornitori esterni: niente ✓/⚠ (non timbra nessuno
        // dei nostri), si mostra solo chi la fa e quanto vale.
        const estRighe = (state.opFornitori || []).filter(r => r.operazione_id === o.id && r.fase_id === f.id);
        const estNomi = estRighe.map(r => (state.aziende.find(a => a.id === r.azienda_id) || {}).nome || '?');
        const fPerc = fPrev > 0 ? Math.round(fCons / fPrev * 100) : 0;
        const sfora = !estNomi.length && fPrev > 0 && fCons > fPrev + tolleranzaOre(fPrev);
        box.append(el('div', { style:'display:flex;align-items:center;gap:10px;padding:3px 0;' },
          el('span', { style:'width:10px;height:10px;border-radius:2px;flex-shrink:0;background:' + (tipo?.colore || '#6b6b64') + ';' }),
          el('span', { style:'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' },
            '#' + (i + 1) + ' ' + (tipo?.nome || 'Fase')),
          estNomi.length
            ? el('span', { style:'color:var(--yel);flex-shrink:0;' },
                Math.round(fPrev * 60) + ' min → ' + estNomi.join(', ') + ' (esterna)'
                + (fCons > 0.05 ? ' · ⚠ ' + Math.round(fCons * 60) + ' min timbrati interni' : ''))
            : el('span', { style:'color:' + (sfora ? 'var(--red)' : 'var(--mut)') + ';flex-shrink:0;' },
                Math.round(fCons * 60) + ' / ' + Math.round(fPrev * 60) + ' min'
                + (fPrev > 0 ? ' (' + fPerc + '%)' : '')
                + (sfora ? ' ⚠ +' + Math.round((fCons - fPrev) * 60) + ' min' : ' ✓')),
        ));
      });
      // Ore non attribuibili a nessuna fase (tipi diversi, sessioni anomale)
      const fuori = Math.max(0, opCalcOreReali(o) - sommaConsFasi);
      if (fuori > 0.05) {
        box.append(el('div', { style:'display:flex;align-items:center;gap:10px;padding:3px 0;color:var(--yel);' },
          el('span', { style:'width:10px;height:10px;flex-shrink:0;text-align:center;' }, '?'),
          el('span', { style:'flex:1;' }, 'Fuori fase (tipo non riconducibile)'),
          el('span', { style:'flex-shrink:0;' }, Math.round(fuori * 60) + ' min'),
        ));
      }
      pCons.append(box);
    }

    // Ore esterne: sta QUI e non in Lavorazione (dove ci sono i fornitori)
    // perché è consuntivo, e perché è la SCOMPOSIZIONE PER DITTA dello stesso
    // monte ore che il riepilogo qui sopra spacca per fase.
    pCons.append(wrapOreEsterne);

    if (sessOp.length === 0) {
      pCons.append(el('div', { style:'color:var(--mut);font-size:11px;padding:8px 0;' },
        'Nessuna sessione registrata. Le sessioni si creano dal kiosk quando un operatore inizia un lavoro.'));
    } else {
      // Riepilogo totali — RIDISEGNABILE: aggiungere o togliere una riga di ore
      // esterne cambia questi numeri, e devono muoversi subito. Prima erano
      // costruiti una volta sola all'apertura del modal: la sezione si
      // aggiornava e i totali no, così sembrava che non fosse cambiato niente
      // finché non si salvava e riapriva (segnalato da Nico).
      const boxTotali = el('div');
      const renderTotali = () => {
      boxTotali.innerHTML = '';
      const cons = (typeof consuntivoCommessa === 'function') ? consuntivoCommessa(o) : null;
      const oreReali = opCalcOreReali(o);
      const perc = cons ? cons.perc : (orePrevInt > 0 ? Math.round((oreReali / orePrevInt) * 100) : 0);
      const overBudget = cons ? cons.sforo
        : (orePrevInt > 0 && oreReali > orePrevInt + tolleranzaOre(orePrevInt));
      boxTotali.append(el('div', {
        style: 'background:var(--sur2);border:1px solid '+(overBudget?'var(--red)':'var(--brd)')+';border-radius:4px;padding:10px 12px;font-family:monospace;font-size:12px;margin-bottom:10px;',
      },
        el('div', { style:'display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;' },
          el('div', {},
            el('span', { style:'color:var(--mut)' },
              'Ore previste' + (cons && cons.baseTotale ? ' (totali): ' : ' (interne): ')),
            el('span', { style:'color:var(--txt);font-weight:600;' },
              (cons ? cons.base : orePrevInt).toFixed(2) + 'h'),
            (!cons || !cons.baseTotale) && prevEsterno > 0.05
              ? el('span', { style:'color:var(--mut);font-size:11px;' }, ' + ' + prevEsterno.toFixed(1) + 'h esterne')
              : null),
          el('div', {},
            el('span', { style:'color:var(--mut)' }, 'Ore consuntivate: '),
            el('span', { style:'color:'+(overBudget?'var(--red)':'var(--grn)')+';font-weight:600;' },
              (cons ? cons.oreTot : oreReali).toFixed(2) + 'h')),
          el('div', {},
            el('span', { style:'color:var(--mut)' }, 'Avanzamento: '),
            el('span', { style:'color:'+(overBudget?'var(--red)':'var(--txt)')+';font-weight:700;' },
              (cons ? cons.base : orePrevInt) > 0 ? perc + '%' : '—'))
        ),
        // "di cui esterne": il totale resta il complessivo, ma non deve
        // sembrare tutto lavoro tuo. Timbrate e dichiarate distinte.
        (cons && cons.oreEsterne > 0.05)
          ? el('div', { style:'margin-top:6px;color:var(--mut);font-size:11px;' },
              'di cui ' + cons.oreEsterne.toFixed(2) + 'h esterne ('
              + [cons.oreEsterneTimbrate > 0.005 ? '⏱ ' + cons.oreEsterneTimbrate.toFixed(2) + 'h timbrate qui' : null,
                 cons.oreEsterneDichiarate > 0.005 ? '📄 ' + cons.oreEsterneDichiarate.toFixed(2) + 'h da rapportino' : null]
                .filter(Boolean).join(' · ')
              + ') · interne ' + cons.oreInterne.toFixed(2) + 'h'
              + (cons.baseTotale
                  ? ' — il previsto qui sopra è quello TOTALE (comprende le fasi esternalizzate), '
                    + 'perché il consuntivo comprende ore esterne'
                  : ''))
          : null,
        overBudget
          ? el('div', { style:'margin-top:6px;color:var(--red);font-size:11px;' },
              '⚠ Ore consuntivate oltre il previsto')
          : null,
      ));
      };
      renderTotali();
      // La sezione ore esterne ora sa ridisegnare anche i totali: aggiungere o
      // togliere un rapportino li muove all'istante, senza salvare e riaprire.
      aggiornaTotaliCons = renderTotali;
      pCons.append(boxTotali);

      // Lista sessioni
      const sessList = el('div', { style:'max-height:240px;overflow-y:auto;font-family:monospace;font-size:11px;' });
      sessOp.forEach(s => {
        const oper = state.utenti.find(u => u.id === s.utente_id);
        const tipo = state.tipiLav.find(t => t.id === s.tipo_lavorazione_id);
        const ini = new Date(s.inizio);
        const fin = s.fine ? new Date(s.fine) : null;
        const durSec = s.fine
          ? (s.durata_secondi || 0)
          : Math.floor((Date.now() - ini.getTime()) / 1000);

        const row = el('div', {
          class: 'sess-row-clic',
          style: 'display:grid;grid-template-columns:14px 1fr 1fr auto auto;gap:10px;align-items:center;padding:6px 8px;border-bottom:1px solid var(--brd);'
            + (isAdmin ? 'cursor:pointer;' : '')
            + (s.fine?'':'background:rgba(78,255,163,.04);'),
          title: isAdmin ? 'Clic per modificare questa timbratura' : '',
          onclick: isAdmin
            ? () => { if (typeof openSessioneModal === 'function') openSessioneModal(s); }
            : null,
        },
          el('div', { style:'width:6px;height:6px;border-radius:50%;background:'+(tipo?.colore||'#6b6b64')+';' }),
          el('div', {}, oper?.nome || '—'),
          el('div', { style:'color:var(--mut);font-size:11px;' }, tipo?.nome || '—'),
          el('div', { style:'color:var(--mut);font-size:11px;' },
            fmtIT(toLocalISO(ini)) + ' ' + z(ini.getHours()) + ':' + z(ini.getMinutes())
              + (fin ? ' → '+z(fin.getHours())+':'+z(fin.getMinutes()) : ' → in corso')),
          el('div', { style:'font-weight:700;color:'+(s.fine?'var(--txt)':'var(--grn)')+';min-width:60px;text-align:right;' },
            formatSecondsHuman(durSec)),
        );
        sessList.append(row);
      });
      pCons.append(sessList);
    }
  }

  // ─── Sezione: consegne parziali ───
  // Visibile solo per operazioni esistenti (non in creazione).
  // Mostra storico consegne, residuo, e (per admin) form di registrazione.
  // Validazioni: data obbligatoria, quantità > 0, quantità <= residuo.
  // Al raggiungimento del 100% propone di marcare la commessa come 'completata'.
  if (!isNew) {
    pProd.append(
      el('div', { class:'sub', style:'margin:18px 0 6px;color:var(--mut);text-transform:uppercase;letter-spacing:.1em;font-size:11px;' },
        '── Produzione ──'),
    );

    // Container che ri-renderizza solo la sezione consegne dopo ogni operazione
    // (insert/delete), senza ricostruire l'intero modal.
    const consegneBox = el('div');
    pProd.append(consegneBox);

    const renderConsegne = () => {
      consegneBox.innerHTML = '';
      const cons = consegneDiOperazione(o.id);
      const tot = quantitaConsegnata(o.id);
      const qtaOrd = Number(o.quantita || 0);
      const residuo = qtaOrd - tot;
      const completo = qtaOrd > 0 && tot >= qtaOrd;
      const perc = qtaOrd > 0 ? Math.round((tot / qtaOrd) * 100) : 0;

      // Riepilogo (stesso stile delle sessioni di lavoro)
      const oreOrd = opCalcOre(o);
      const oreRes = opCalcOreResidue(o);
      consegneBox.append(el('div', {
        style: 'background:var(--sur2);border:1px solid '+(completo?'var(--grn)':'var(--brd)')+';border-radius:4px;padding:10px 12px;font-family:monospace;font-size:12px;margin-bottom:10px;',
      },
        // Riga 1: quantità (pezzi)
        el('div', { style:'display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;' },
          el('div', {},
            el('span', { style:'color:var(--mut)' }, 'Ordinata: '),
            el('span', { style:'color:var(--txt);font-weight:600;' }, qtaOrd + ' pz')),
          el('div', {},
            el('span', { style:'color:var(--mut)' }, 'Prodotta: '),
            el('span', { style:'color:'+(completo?'var(--grn)':'var(--txt)')+';font-weight:600;' }, tot + ' pz')),
          el('div', {},
            el('span', { style:'color:var(--mut)' }, 'Da produrre: '),
            el('span', { style:'color:'+(residuo<=0?'var(--grn)':'var(--txt)')+';font-weight:600;' }, Math.max(0, residuo) + ' pz')),
          el('div', {},
            el('span', { style:'color:var(--mut)' }, 'Avanzamento: '),
            el('span', { style:'color:'+(completo?'var(--grn)':'var(--txt)')+';font-weight:700;' }, perc + '%')),
        ),
        // Riga 2: ore preventivate / residue (l'effetto sul capacity planning)
        // Mostrate sempre, anche se uguali (es. 0 consegne) — è informazione di
        // contesto, aiuta a interpretare le date di inizio calcolate.
        el('div', {
          style:'display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-top:6px;padding-top:6px;border-top:1px dashed var(--brd);font-size:11px;',
        },
          el('div', {},
            el('span', { style:'color:var(--mut)' }, 'Ore preventivate: '),
            el('span', { style:'color:var(--txt);font-weight:600;' }, oreOrd.toFixed(2) + 'h')),
          el('div', {},
            el('span', { style:'color:var(--mut)' }, 'Ore residue: '),
            el('span', { style:'color:'+(completo?'var(--grn)':(tot>0?'var(--yel)':'var(--txt)'))+';font-weight:600;' }, oreRes.toFixed(2) + 'h')),
        ),
      ));

      // Lista consegne registrate
      if (cons.length === 0) {
        consegneBox.append(el('div', { style:'color:var(--mut);font-size:11px;padding:6px 0 10px;' },
          'Nessun lotto prodotto.'));
      } else {
        const consList = el('div', { style:'max-height:180px;overflow-y:auto;font-family:monospace;font-size:11px;margin-bottom:10px;' });
        cons.forEach(c => {
          const row = el('div', {
            style: 'display:grid;grid-template-columns:90px 70px 1fr 1fr auto;gap:10px;align-items:center;padding:6px 8px;border-bottom:1px solid var(--brd);',
          },
            el('div', { style:'color:var(--txt);' }, fmtIT(c.data)),
            el('div', { style:'color:var(--txt);font-weight:600;text-align:right;' }, c.quantita + ' pz'),
            el('div', { style:'color:var(--mut);' }, c.ddt ? ('Lotto ' + c.ddt) : '—'),
            el('div', { style:'color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', title: c.nota || '' }, c.nota || '—'),
            isAdmin ? el('button', {
              type:'button',
              style:'background:transparent;border:1px solid var(--brd);color:var(--mut);padding:2px 8px;font-size:11px;cursor:pointer;border-radius:3px;',
              title:'Elimina questo lotto',
              onclick: async () => {
                if (!confirm(`Eliminare il lotto del ${fmtIT(c.data)} (${c.quantita} pz)?`)) return;
                const { error } = await sb.from('consegne_commessa').delete().eq('id', c.id);
                if (error) return toast('Errore eliminazione: '+error.message, 'err');
                state.consegneCommessa = state.consegneCommessa.filter(x => x.id !== c.id);
                toast('Lotto eliminato');
                renderConsegne();
              },
            }, '✕') : el('span'),
          );
          consList.append(row);
        });
        consegneBox.append(consList);
      }

      // Form di registrazione nuova consegna (solo admin, solo se c'è ancora residuo)
      if (isAdmin && residuo > 0) {
        const dataInput = el('input', {
          type:'date',
          value: toLocalISO(new Date()),
          style:'width:100%;',
        });
        const qtaInput = el('input', {
          type:'number',
          min:'1',
          max: String(residuo),
          step:'1',
          value: String(residuo),
          style:'width:100%;',
        });
        const ddtInput = el('input', {
          type:'text',
          placeholder:'opzionale',
          style:'width:100%;',
        });
        const notaInput = el('input', {
          type:'text',
          placeholder:'opzionale',
          style:'width:100%;',
        });
        const btnAdd = el('button', {
          type:'button',
          class:'btnp',
          style:'white-space:nowrap;',
        }, '+ Registra produzione');

        btnAdd.onclick = async () => {
          const data = dataInput.value;
          const qta = parseInt(qtaInput.value, 10);
          const ddt = (ddtInput.value || '').trim();
          const nota = (notaInput.value || '').trim();

          if (!data) return toast('Data obbligatoria', 'err');
          if (!Number.isFinite(qta) || qta <= 0) return toast('Quantità deve essere > 0', 'err');
          // Ricalcolo il residuo qui per evitare race condition (qualcuno potrebbe
          // aver registrato un lotto in parallelo via realtime).
          const residuoOra = qtaOrd - quantitaConsegnata(o.id);
          if (qta > residuoOra) {
            return toast(`Da produrre: ${residuoOra} pz. Non puoi produrre ${qta} pz.`, 'err');
          }

          btnAdd.disabled = true; btnAdd.textContent = 'Salvataggio…';
          const payload = {
            operazione_id: o.id,
            data,
            quantita: qta,
            ddt: ddt || null,
            nota: nota || null,
            creato_da: state.profile?.id || null,
          };
          const { data: nuova, error } = await sb.from('consegne_commessa')
            .insert(payload).select().single();
          btnAdd.disabled = false; btnAdd.textContent = '+ Registra produzione';
          if (error) return toast('Errore registrazione: '+error.message, 'err');

          // Aggiorno la cache locale subito (il realtime arriverà comunque)
          if (!state.consegneCommessa.find(x => x.id === nuova.id)) {
            state.consegneCommessa.push(nuova);
          }
          toast('Lotto registrato');

          // Auto-suggerimento: se ora siamo al 100%, proponi 'completata'
          const nuovoTot = quantitaConsegnata(o.id);
          const raggiuntoOra = nuovoTot >= qtaOrd && (tot < qtaOrd);
          // Solo se la commessa non è già completata/spedita
          const statoCorrente = (form.querySelector('[name="stato"]')?.value) || o.stato;
          const giaFinita = (statoCorrente === 'completata' || statoCorrente === 'spedita');
          if (raggiuntoOra && !giaFinita) {
            const ok = confirm(
              `Tutto il materiale è stato prodotto (${nuovoTot} / ${qtaOrd} pz).\n\n` +
              `Vuoi marcare la commessa come COMPLETATA?\n\n` +
              `(Ricordati poi di salvare il modal per confermare il cambio di stato.)`
            );
            if (ok) {
              const sel = form.querySelector('[name="stato"]');
              if (sel) {
                sel.value = 'completata';
                // Notifico eventuali listener che lo stato è cambiato
                sel.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
          }

          renderConsegne();
        };

        const formCons = el('div', {
          style:'background:var(--sur);border:1px solid var(--brd);border-radius:4px;padding:10px 12px;display:grid;grid-template-columns:130px 100px 1fr 1fr auto;gap:8px;align-items:end;',
        },
          el('div', { class:'field' }, el('label', { style:'font-size:11px;' }, 'Data'), dataInput),
          el('div', { class:'field' }, el('label', { style:'font-size:11px;' }, 'Quantità'), qtaInput),
          el('div', { class:'field' }, el('label', { style:'font-size:11px;' }, 'Lotto/Rif.'), ddtInput),
          el('div', { class:'field' }, el('label', { style:'font-size:11px;' }, 'Nota'), notaInput),
          btnAdd,
        );
        consegneBox.append(formCons);
      } else if (isAdmin && residuo <= 0) {
        consegneBox.append(el('div', {
          style:'color:var(--grn);font-size:11px;padding:6px 0;font-weight:600;',
        }, '✓ Tutto il materiale è stato prodotto.'));
      }
    };

    renderConsegne();
  }

  // ─── Sezione: spedizioni al cliente ───
  // Visibile solo per operazioni esistenti. Mostra storico spedizioni,
  // pezzi pronti per spedire (= prodotti - già spediti), e form di
  // registrazione. Validazioni:
  // - data obbligatoria
  // - quantità > 0
  // - quantità <= pezziInMagazzino (non puoi spedire quel che non hai prodotto)
  // - somma totale <= operazione.quantita (non puoi spedire più dell'ordinato)
  // Al raggiungimento del 100% spedito, marca automaticamente la commessa
  // come 'spedita' (sincronizzazione automatica dello stato).
  if (!isNew) {
    pProd.append(
      el('div', { style:'margin-top:14px;padding-top:14px;border-top:1px solid var(--brd);font-family:monospace;font-size:11px;font-weight:600;color:var(--mut);letter-spacing:.1em;text-transform:uppercase;' },
        '── Spedizioni ──'),
    );

    const spedBox = el('div', { style:'margin-top:8px;' });
    pProd.append(spedBox);

    const renderSpedizioni = () => {
      spedBox.innerHTML = '';

      const qtaOrd = Number(o.quantita || 0);
      const prodotti = quantitaConsegnata(o.id);
      const totSped = quantitaSpedita(o.id);
      const pronti = Math.max(0, prodotti - totSped);
      const daSpedire = Math.max(0, qtaOrd - totSped);
      const completo = qtaOrd > 0 && totSped >= qtaOrd;

      // KPI riga
      spedBox.append(el('div', {
        style:'display:flex;gap:14px;flex-wrap:wrap;padding:8px 12px;background:var(--sur2);border:1px solid var(--brd);border-radius:4px;font-family:monospace;font-size:11px;margin-bottom:10px;',
      },
        el('div', {},
          el('span', { style:'color:var(--mut)' }, 'Ordinata: '),
          el('span', { style:'color:var(--txt);font-weight:600;' }, qtaOrd + ' pz')),
        el('div', {},
          el('span', { style:'color:var(--mut)' }, 'Spedita: '),
          el('span', { style:'color:'+(completo?'var(--grn)':'var(--txt)')+';font-weight:600;' }, totSped + ' pz')),
        el('div', {},
          el('span', { style:'color:var(--mut)' }, 'Pronti per spedire: '),
          el('span', { style:'color:'+(pronti>0?'var(--blu)':'var(--mut)')+';font-weight:600;' }, pronti + ' pz')),
        el('div', {},
          el('span', { style:'color:var(--mut)' }, 'Da spedire: '),
          el('span', { style:'color:'+(daSpedire<=0?'var(--grn)':'var(--txt)')+';font-weight:600;' }, daSpedire + ' pz')),
      ));

      // Lista spedizioni esistenti
      const lista = spedizioniDiOperazione(o.id);
      if (lista.length === 0) {
        spedBox.append(el('div', { style:'color:var(--mut);font-size:11px;font-style:italic;padding:6px 0;' },
          'Nessuna spedizione registrata.'));
      } else {
        const listWrap = el('div', { style:'display:flex;flex-direction:column;gap:4px;margin-bottom:10px;' });
        lista.forEach(s => {
          const row = el('div', {
            style:'display:grid;grid-template-columns:90px 70px 1fr 1fr auto;gap:10px;align-items:center;padding:6px 8px;background:var(--sur);border:1px solid var(--brd);border-radius:3px;font-family:monospace;font-size:11px;',
          },
            el('div', {}, fmtIT(s.data)),
            el('div', { style:'text-align:right;font-weight:600;' }, s.quantita + ' pz'),
            el('div', { style:'color:var(--mut);' }, s.ddt ? ('DDT ' + s.ddt) : '—'),
            el('div', { style:'color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', title: (s.destinatario||'') + (s.note?(' · '+s.note):'') },
              (s.destinatario || '') + (s.note?(' · '+s.note):'') || '—'),
            isAdmin ? el('button', {
              class:'btnsm', type:'button',
              style:'padding:2px 6px;font-size:11px;background:transparent;border:1px solid var(--red);color:var(--red);',
              title:'Elimina questa spedizione',
              onclick: async () => {
                if (!confirm(`Eliminare la spedizione del ${fmtIT(s.data)} (${s.quantita} pz)?`)) return;
                const { error } = await sb.from('spedizioni').delete().eq('id', s.id);
                if (error) return toast('Errore eliminazione: '+error.message, 'err');
                state.spedizioni = state.spedizioni.filter(x => x.id !== s.id);
                // Se la commessa era 'spedita' e ora non è più 100%, resync
                const nuovoTot = quantitaSpedita(o.id);
                if (o.stato === 'spedita' && nuovoTot < qtaOrd) {
                  const sel = form.querySelector('[name="stato"]');
                  if (sel) {
                    sel.value = 'completata';
                    sel.dispatchEvent(new Event('change', { bubbles:true }));
                    toast('Spedizione eliminata · stato riportato a "completata" (ricordati di salvare)');
                  } else {
                    toast('Spedizione eliminata');
                  }
                } else {
                  toast('Spedizione eliminata');
                }
                renderSpedizioni();
              },
            }, '✕') : null,
          );
          listWrap.append(row);
        });
        spedBox.append(listWrap);
      }

      // Form per aggiungere nuova spedizione (solo admin, se c'è qualcosa da spedire)
      if (isAdmin && daSpedire > 0) {
        const dataInputS = el('input', { type:'date', value: toLocalISO(new Date()) });
        const qtaInputS = el('input', { type:'number', min:'1', max:String(Math.max(pronti, 1)), value:String(Math.max(1, pronti)) });
        const ddtInputS = el('input', { type:'text', placeholder:'numero DDT al cliente (opzionale)' });
        const destInputS = el('input', { type:'text', placeholder:'destinatario / luogo (opzionale)' });
        const noteInputS = el('input', { type:'text', placeholder:'note (opzionale)' });

        const btnAddS = el('button', {
          type:'button', class:'btnp',
          style:'padding:6px 12px;font-size:11px;height:fit-content;',
        }, '+ Registra spedizione');

        btnAddS.onclick = async () => {
          const data = dataInputS.value;
          const qta = parseInt(qtaInputS.value, 10);
          const ddt = (ddtInputS.value || '').trim();
          const dest = (destInputS.value || '').trim();
          const note = (noteInputS.value || '').trim();

          if (!data) return toast('Data obbligatoria', 'err');
          if (!Number.isFinite(qta) || qta <= 0) return toast('Quantità deve essere > 0', 'err');

          // Validazione doppia: 1) non superare totale ordinato 2) non superare pronto in magazzino
          const totSpedOra = quantitaSpedita(o.id);
          const daSpedireOra = qtaOrd - totSpedOra;
          if (qta > daSpedireOra) {
            return toast(`Da spedire: ${daSpedireOra} pz. Non puoi spedire ${qta} pz.`, 'err');
          }
          const prontiOra = Math.max(0, quantitaConsegnata(o.id) - totSpedOra);
          if (qta > prontiOra) {
            return toast(`In magazzino: ${prontiOra} pz pronti. Prima registra la produzione mancante.`, 'err');
          }

          btnAddS.disabled = true; btnAddS.textContent = 'Salvataggio…';
          const payload = {
            operazione_id: o.id,
            data,
            quantita: qta,
            ddt: ddt || null,
            destinatario: dest || null,
            note: note || null,
            creato_da: state.profile?.id || null,
          };
          const { data: nuova, error } = await sb.from('spedizioni')
            .insert(payload).select().single();
          btnAddS.disabled = false; btnAddS.textContent = '+ Registra spedizione';
          if (error) return toast('Errore registrazione: '+error.message, 'err');

          // Aggiorno cache locale
          if (!state.spedizioni.find(x => x.id === nuova.id)) state.spedizioni.push(nuova);
          toast('Spedizione registrata');

          // Sincronizzazione automatica stato: se ora siamo al 100%, marca
          // 'spedita' — e lo SCRIVE, non lo propone soltanto (27 ago).
          // Prima cambiava solo il campo nel form dicendo "salva per
          // confermare": chi chiudeva il modal senza salvare si ritrovava la
          // spedizione registrata e lo stato indietro. Le due metà dello
          // stesso gesto devono avere la stessa sorte, o restano scoperte a
          // metà — è successo su 2026/OC/00107/0020, 4 su 4 spediti e ancora
          // "completata".
          const nuovoTotSped = quantitaSpedita(o.id);
          if (nuovoTotSped >= qtaOrd && o.stato !== 'spedita') {
            const patch = { stato: 'spedita' };
            if (!o.consegnato_il) patch.consegnato_il = data;
            const { data: agg, error: errSt } = await eseguiConRetry(
              () => sb.from('operazioni').update(patch).eq('id', o.id).select().single(),
              { label: 'stato spedita' });
            if (errSt) {
              // La spedizione c'è comunque: lo stato si può correggere a mano.
              toast('Spedizione salvata, ma lo stato non si è aggiornato: ' + errSt.message, 'err');
            } else {
              Object.assign(o, agg);
              const idx = state.operazioni.findIndex(x => x.id === agg.id);
              if (idx >= 0) state.operazioni[idx] = agg;
              // Il form si allinea a quello che è già scritto, così salvando
              // dopo non si rimanda indietro lo stato appena messo.
              const sel = form.querySelector('[name="stato"]');
              if (sel) sel.value = 'spedita';
              const inCons = form.querySelector('[name="consegnato_il"]');
              if (inCons && !inCons.value && patch.consegnato_il) inCons.value = patch.consegnato_il;
              toast('Tutto spedito · stato impostato a "spedita"');
            }
          }

          renderSpedizioni();
        };

        const formSped = el('div', {
          style:'background:var(--sur);border:1px solid var(--brd);border-radius:4px;padding:10px 12px;display:grid;grid-template-columns:130px 90px 1fr 1fr 1fr auto;gap:8px;align-items:end;',
        },
          el('div', { class:'field' }, el('label', { style:'font-size:11px;' }, 'Data'), dataInputS),
          el('div', { class:'field' }, el('label', { style:'font-size:11px;' }, 'Quantità'), qtaInputS),
          el('div', { class:'field' }, el('label', { style:'font-size:11px;' }, 'DDT'), ddtInputS),
          el('div', { class:'field' }, el('label', { style:'font-size:11px;' }, 'Destinatario'), destInputS),
          el('div', { class:'field' }, el('label', { style:'font-size:11px;' }, 'Note'), noteInputS),
          btnAddS,
        );
        spedBox.append(formSped);

        // Avviso se in magazzino ci sono meno pezzi del massimo selezionabile
        if (pronti < daSpedire) {
          spedBox.append(el('div', { style:'color:var(--yel);font-size:11px;padding:6px 0 0;' },
            `Solo ${pronti} pz pronti in magazzino (${daSpedire - pronti} ancora da produrre).`));
        }
      } else if (isAdmin && daSpedire <= 0) {
        spedBox.append(el('div', {
          style:'color:var(--grn);font-size:11px;padding:6px 0;font-weight:600;',
        }, '✓ Tutto il materiale è stato spedito.'));
      } else if (isAdmin && pronti === 0 && daSpedire > 0) {
        spedBox.append(el('div', {
          style:'color:var(--mut);font-size:11px;padding:6px 0;font-style:italic;',
        }, 'Nulla in magazzino da spedire. Registra prima la produzione.'));
      }
    };

    renderSpedizioni();
  }

  // Preview calcoli
  const previewBox = el('div', { style:'background:var(--sur2);border:1px solid var(--brd);border-radius:4px;padding:10px 12px;margin-top:12px;font-family:monospace;font-size:11px;color:var(--mut);' });

  // Stato lucchetto: true = data fissa (forzata), false = data calcolata.
  // Inizializzato in base ai dati: se la commessa ha già un inizio_manuale,
  // il lucchetto parte chiuso (forzato).
  let inizioBloccato = !!o.inizio_manuale;

  // Aggiorna l'indicatore '*' accanto a "Minuti unitari" e l'hint sottostante
  // a seconda che il valore della commessa coincida o no col valore dell'articolo.
  // Try/catch difensivo: se per qualunque motivo qualcosa va storto qui, NON
  // deve rompere l'apertura/uso del modal commessa (che è funzione critica).
  // Totale riga = prezzo × quantità (aggiornato live).
  const aggiornaTotalePrezzo = () => {
    try {
      const tot = form.querySelector('#prezzo-totale');
      if (!tot) return;
      const pz = parseFloat((form.querySelector('[name=quantita]')?.value || '').toString().replace(',', '.')) || 0;
      const pr = parseFloat((form.querySelector('#prezzo-input')?.value || '').toString().replace(',', '.')) || 0;
      tot.textContent = (pz > 0 && pr > 0)
        ? '€ ' + (pz * pr).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : '—';
      aggiornaMargineRiga();
    } catch (e) {}
  };
  // Margine live sotto il totale: totale riga − costo fornitori stimato
  // (ore quota × tariffa €/h, la stessa stima della riga fornitore). Solo le
  // voci di costo NOTE: i fornitori senza tariffa vengono dichiarati, non
  // ignorati in silenzio. Function declaration (hoisted): chiamabile anche
  // dal primo renderForSelected, prima che il form sia completo (esce zitta).
  function aggiornaMargineRiga() {
    try {
      const box = form.querySelector('#margine-riga');
      if (!box) return;
      const pz = parseFloat((form.querySelector('[name=quantita]')?.value || '').toString().replace(',', '.')) || 0;
      const pr = parseFloat((form.querySelector('#prezzo-input')?.value || '').toString().replace(',', '.')) || 0;
      const tot = pz * pr;
      // Le ore ESTERNE VERE (timbrate o da rapportino) battono la stima, ditta
      // per ditta: dove il consuntivo c'è si usa quello, dove manca resta il
      // preventivo. Così il margine diventa vero man mano che i dati arrivano,
      // senza mai sommare stima e consuntivo della stessa ditta.
      const oreEst = (typeof oreEsterneCommessa === 'function' && !isNew)
        ? oreEsterneCommessa(o.id) : { righe: [], costoTot: 0 };
      const conReale = new Set(oreEst.righe.filter(x => x.costo != null).map(x => x.aziendaId));
      let costo = oreEst.righe.reduce((s, x) => s + (x.costo || 0), 0);
      let costoReale = costo, costoStima = 0, senzaTariffa = 0;
      (fornitoriSel || []).forEach(sel => {
        if (conReale.has(sel.azienda_id)) return;   // per lei il vero c'è già
        const az = state.aziende.find(x => x.id === sel.azienda_id);
        const tariffa = Number(az && az.tariffa_oraria) || 0;
        if (tariffa > 0) {
          const q = minPzFornitore(sel) * qtaCorrenteComm() / 60 * tariffa;
          costo += q; costoStima += q;
        } else senzaTariffa++;
      });
      if (tot <= 0 || (costo <= 0 && senzaTariffa === 0)) { box.textContent = ''; return; }
      const fmtE = (n) => '€ ' + n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const margine = tot - costo;
      const perc = Math.round(margine / tot * 100);
      box.style.color = margine >= 0 ? 'var(--grn)' : 'var(--red)';
      // La composizione va dichiarata: un margine mezzo stimato non deve
      // sembrare un dato consolidato.
      const comp = [];
      if (costoReale > 0) comp.push('ore vere ' + fmtE(costoReale));
      if (costoStima > 0) comp.push('stima ' + fmtE(costoStima));
      box.textContent = '− esterni ' + (costoStima > 0 ? '≈ ' : '') + fmtE(costo)
        + ' → margine ' + (costoStima > 0 ? '≈ ' : '') + fmtE(margine) + ' (' + perc + '%)'
        + (comp.length > 1 ? ' · ' + comp.join(' + ') : '')
        + (senzaTariffa > 0
            ? ' · ' + senzaTariffa + (senzaTariffa === 1 ? ' fornitore' : ' fornitori') + ' senza tariffa'
            : '');
    } catch (e) {}
  }
  // Pre-compila il prezzo dall'ultimo usato (listino vivo, articolo+cliente)
  // solo se il campo è vuoto; aggiorna sempre il suggerimento e il totale.
  const aggiornaPrezzoListino = () => {
    try {
      const inp = form.querySelector('#prezzo-input');
      const hint = form.querySelector('#prezzo-hint');
      if (!inp) return;
      const artVal = acArticolo.getValue();
      const cliVal = acCliente.getValue();
      const artId = (artVal.mode === 'existing' && artVal.id) ? artVal.id : null;
      const cliId = (cliVal.mode === 'existing' && cliVal.id) ? cliVal.id : null;
      const list = artId ? prezzoListino(artId, cliId) : null;
      const vuoto = (inp.value || '').toString().trim() === '';
      if (vuoto && isNew && list) inp.value = String(list.prezzo);
      if (hint) {
        hint.textContent = list
          ? 'Ultimo prezzo: € ' + list.prezzo.toLocaleString('it-IT', { minimumFractionDigits: 2 })
            + (list.proprioCliente ? ' (questo cliente' : ' (altro cliente')
            + (list.data ? ', ' + fmtIT(String(list.data).slice(0, 10)) : '') + ')'
          : 'Primo prezzo per questo articolo: verrà usato come listino la prossima volta.';
      }
      aggiornaTotalePrezzo();
    } catch (e) {}
  };
  const aggiornaIndicatoreMinuti = () => {
    try {
      const star = form.querySelector('#minuti-diff');
      const hint = form.querySelector('#minuti-hint');
      const minInput = form.querySelector('#minuti-input');
      if (!star || !minInput) return;
      const artVal = acArticolo.getValue();
      const art = (artVal.mode === 'existing' && artVal.id)
        ? state.articoli.find(a => a.id === artVal.id) : null;
      const artMin = (art && art.minuti_unitari != null && art.minuti_unitari !== '')
        ? Number(art.minuti_unitari) : null;
      const curRaw = (minInput.value || '').toString().trim();
      const curMin = curRaw === '' ? null : Number(curRaw);

      if (artMin == null) {
        // Articolo senza valore di riferimento: niente confronto
        star.style.display = 'none';
        if (hint) hint.textContent = art
          ? 'L\'articolo selezionato non ha minuti unitari in anagrafica. Impostali una volta nell\'articolo per riutilizzarli.'
          : 'Suggerito automaticamente dall\'articolo selezionato.';
      } else if (curMin === artMin) {
        // Combaciano
        star.style.display = 'none';
        if (hint) hint.textContent = `Valore standard dell'articolo (${artMin} min).`;
      } else {
        // Divergenza
        star.style.display = 'inline';
        if (hint) hint.textContent = `Diverso dallo standard dell'articolo (${artMin} min) — clicca '*' per ripristinarlo.`;
      }
    } catch (e) {
      console.warn('aggiornaIndicatoreMinuti: errore non bloccante:', e);
    }
  };

  // Regola tariffa cliente anche in MODIFICA, ma MAI automatica: qui i
  // minuti esistono già e cambiarli in silenzio è vietato (il tempo pagato
  // non si auto-aggiorna). Suggerimento + "usa", come per le medie storiche.
  // Serve soprattutto per gli ordini nati prima della regola (minuti a 0).
  const aggiornaSuggDaPrezzo = () => {
    try {
      const box = form.querySelector('#minuti-da-prezzo');
      const minInput = form.querySelector('#minuti-input');
      if (!box || !minInput) return;
      const cliVal = acCliente.getValue();
      const cli = (cliVal.mode === 'existing' && cliVal.id)
        ? state.aziende.find(a => a.id === cliVal.id) : null;
      const tariffa = Number(cli && cli.tariffa_cliente) || 0;
      const prezzo = parseFloat((form.querySelector('#prezzo-input')?.value || '').toString().replace(',', '.')) || 0;
      const propone = (tariffa > 0 && prezzo > 0) ? Math.round(prezzo / tariffa * 60) : null;
      const cur = parseFloat((minInput.value || '').toString().replace(',', '.'));
      if (propone == null || propone === cur) { box.style.display = 'none'; box.innerHTML = ''; return; }
      box.style.display = '';
      box.innerHTML = '';
      box.append(
        el('span', { style:'color:var(--mut);font-family:JetBrains Mono,monospace;' },
          'da prezzo: ' + propone + ' min/pz ('
          + prezzo.toLocaleString('it-IT', { minimumFractionDigits: 2 }) + ' € ÷ '
          + String(tariffa).replace('.', ',') + ' €/h)'),
        ...(canEdit ? [el('button', { type:'button', class:'btnsm', style:'padding:1px 8px;margin-left:8px;',
          onclick: () => {
            minInput.value = String(propone);
            minInput.dispatchEvent(new Event('input', { bubbles: true }));
          } }, 'usa')] : []),
      );
    } catch (e) {}
  };

  // Verso opposto: il tempo DAVVERO timbrato propone il prezzo da chiedere
  // (ore effettive × tariffa cliente). Come sopra, MAI automatico: propone e
  // dichiara su quante commesse poggia. Una sola commessa = giallo, perché a
  // campione 1 un timbro storto sposta il prezzo più di una trattativa.
  const aggiornaSuggDaConsuntivo = () => {
    try {
      const box = form.querySelector('#prezzo-da-consuntivo');
      const prezzoInput = form.querySelector('#prezzo-input');
      if (!box || !prezzoInput) return;
      const artVal = acArticolo.getValue();
      const cliVal = acCliente.getValue();
      const artId = (artVal.mode === 'existing' && artVal.id) ? artVal.id : null;
      const cliId = (cliVal.mode === 'existing' && cliVal.id) ? cliVal.id : null;
      const s = (artId && cliId && typeof prezzoDaTempoEffettivo === 'function')
        ? prezzoDaTempoEffettivo(artId, cliId) : null;
      if (!s) { box.style.display = 'none'; box.innerHTML = ''; return; }
      const fmtE = (n) => '€ ' + Number(n).toLocaleString('it-IT',
        { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const cur = parseFloat((prezzoInput.value || '').toString().replace(',', '.')) || 0;
      const scarto = cur > 0 ? Math.round((s.prezzo / cur - 1) * 100) : null;
      box.style.display = '';
      box.innerHTML = '';
      box.append(
        el('span', { class: s.debole ? 'etl-debole' : '', style:'font-family:JetBrains Mono,monospace;'
            + (s.debole ? '' : 'color:var(--mut);') },
          'da consuntivo: ' + fmtE(s.prezzo)
          + ' (' + s.ore.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
          + ' h × ' + String(s.tariffa).replace('.', ',') + ' €/h · '
          + s.nCommesse + (s.nCommesse === 1 ? ' commessa' : ' commesse') + ')'
          + (scarto != null && scarto !== 0 ? ' · ' + (scarto > 0 ? '+' : '') + scarto + '%' : '')
          + (s.fasiSenzaStorico > 0
              ? ' · ' + s.fasiSenzaStorico
                + (s.fasiSenzaStorico === 1 ? ' fase senza consuntivo, esclusa' : ' fasi senza consuntivo, escluse')
              : '')),
        ...(canEdit ? [el('button', { type:'button', class:'btnsm', style:'padding:1px 8px;margin-left:8px;',
          onclick: () => {
            prezzoInput.value = String(s.prezzo);
            prezzoInput.dispatchEvent(new Event('input', { bubbles: true }));
          } }, 'usa')] : []),
      );
      if (s.debole) box.title = 'Media su UNA sola commessa chiusa: indicativa, non una base di trattativa.';
      else box.title = 'Ore realmente timbrate (ultime ' + MEDIA_ULTIME_COMMESSE
        + ' commesse chiuse) × tariffa del cliente.';
    } catch (e) {}
  };

  const refreshPreview = () => {
    const fd = new FormData(form);
    const tmp = {
      quantita: parseInt(fd.get('quantita'))||0,
      minuti_unitari: parseInt(fd.get('minuti_unitari'))||0,
      scadenza: fd.get('scadenza'),
    };
    // Fasi LIVE (dal form, non ancora salvate). Se presenti, l'anteprima usa la
    // SOMMA fasi come volume e calcola l'inizio PER FASE, coerente col motore.
    const fasiVere = fasiComm.filter(f => f.tipo_lavorazione_id);
    // Coerente col motore: l'anteprima usa le fasi solo se COMPLETE (tutte > 0),
    // altrimenti ricade sull'aggregato (minuti_unitari).
    const conFasi = fasiVere.length > 0 && fasiVere.every(f => (Number(f.minuti_unitari) || 0) > 0);
    let ore, inizioCalc;
    if (conFasi) {
      const minutiEff = fasiVere.reduce((s, f) => s + (Number(f.minuti_unitari) || 0), 0);
      ore = (tmp.quantita * minutiEff) / 60;
      // Assegnatari per fase dai dati live (addettoFase: uid→_k; fornitoriSel.fase_keys),
      // con ripiego sugli assegnati "a tutta la commessa" (senza fase).
      const assegnLive = (faseK) => {
        let add = addettiSel.filter(uid => (addettoFase[uid] || '') === faseK);
        let forn = fornitoriSel.filter(s => (s.fase_keys || []).includes(faseK)).map(s => ({ azienda_id: s.azienda_id, allocazione: s.allocazione }));
        if (!add.length && !forn.length) {
          add = addettiSel.filter(uid => !addettoFase[uid]);
          forn = fornitoriSel.filter(s => !(s.fase_keys || []).length).map(s => ({ azienda_id: s.azienda_id, allocazione: s.allocazione }));
        }
        return { add, forn };
      };
      if (!tmp.scadenza) {
        inizioCalc = null;
      } else {
        // Sempre sequenziale (parallelo disattivato): catena a ritroso.
        let cursore = tmp.scadenza;
        for (let i = fasiVere.length - 1; i >= 0; i--) {
          const f = fasiVere[i];
          const oreF = (tmp.quantita * (Number(f.minuti_unitari) || 0)) / 60;
          const { add, forn } = assegnLive(f._k);
          cursore = inizioPerFase(cursore, oreF, add, forn);
        }
        inizioCalc = cursore;
      }
    } else {
      ore = opCalcOre(tmp);
      // Override locali (addettiSel + fornitoriSel): preview senza dipendere dal DB.
      inizioCalc = opCalcInizio(tmp, addettiSel, fornitoriSel);
    }
    const giorni = Math.ceil(ore / 8);
    const conAddetti = (addettiSel && addettiSel.length > 0) || conFasi;

    // Se il lucchetto è APERTO, aggiorno il campo Inizio col calcolo "live".
    // Se è CHIUSO, lascio quello che c'è (decisione dell'utente).
    const inizioInput = form.querySelector('[name=inizio]');
    if (inizioInput && !inizioBloccato) {
      inizioInput.value = inizioCalc || '';
    }

    // Lo stato del lucchetto controlla anche l'aspetto del campo
    if (inizioInput) {
      inizioInput.readOnly = !inizioBloccato;
      inizioInput.style.opacity = inizioBloccato ? '1' : '0.85';
      inizioInput.style.color = inizioBloccato ? 'var(--acc)' : 'var(--mut)';
      inizioInput.style.fontWeight = inizioBloccato ? '700' : '400';
    }
    const lockBtn = form.querySelector('#inizio-lock-btn');
    if (lockBtn) lockBtn.textContent = inizioBloccato ? '🔒' : '🔓';
    const hint = form.querySelector('#inizio-hint');
    if (hint) {
      hint.textContent = inizioBloccato
        ? 'Data fissa: non si ricalcola se cambi quantità o addetti.'
        : 'Data calcolata automaticamente. Clicca il lucchetto per forzarla.';
    }

    previewBox.innerHTML = '';
    previewBox.append(
      el('div', {},
        el('span', { style:'color:var(--acc)' }, 'Ore stimate: '), ore.toFixed(2),
        el('span', { style:'margin:0 10px;color:var(--brd)' }, '·'),
        el('span', { style:'color:var(--acc)' }, 'Giorni lavorativi: '), String(giorni),
      ),
      el('div', { style:'margin-top:4px;font-size:11px;color:var(--mut);' },
        conFasi
          ? ('Inizio calcolato per fase — ognuna sulla capacità dei suoi assegnatari — '
             + 'in sequenza'
             + ', a ritroso dalla scadenza. Le ore sono la somma delle fasi (il tempo pagato resta solo budget).')
          : (conAddetti
            ? 'Inizio calcolato a ritroso dalla scadenza in base alla capacità reale degli addetti assegnati (8h a testa, meno le loro ferie), escludendo weekend, festivi e chiusure aziendali.'
            : 'Calcolato come quantità × minuti / 60 ore, divisi in giornate da 8h, escludendo weekend, festivi nazionali e chiusure aziendali. Assegna degli addetti per tener conto delle loro ferie.'))
    );

    // Se l'utente ha forzato l'inizio (lucchetto chiuso): avvisi su tempistiche
    if (inizioBloccato) {
      const inizioForzato = inizioInput?.value || '';
      if (inizioForzato && inizioCalc && tmp.scadenza && inizioForzato > inizioCalc) {
        previewBox.append(el('div', {
          style:'margin-top:6px;font-size:11px;color:var(--yel);' },
          '⚠ La data forzata è più tardi del calcolo automatico: il tempo ' +
          'tra inizio e scadenza potrebbe non bastare per le ore previste. ' +
          'Valuta se aggiungere addetti.'));
      }
      if (inizioForzato && tmp.scadenza && inizioForzato > tmp.scadenza) {
        previewBox.append(el('div', {
          style:'margin-top:4px;font-size:11px;color:var(--red);' },
          '⚠ La data di inizio è successiva alla scadenza.'));
      }
    }
  };
  aggiornaPreviewInizio = refreshPreview;

  // Click sul lucchetto: alterna fra calcolato e forzato
  const lockBtn = form.querySelector('#inizio-lock-btn');
  if (lockBtn) {
    lockBtn.onclick = (e) => {
      e.preventDefault();
      inizioBloccato = !inizioBloccato;
      refreshPreview();
      // Se appena bloccato, focus sul campo per facilitare l'edit
      if (inizioBloccato) form.querySelector('[name=inizio]')?.focus();
    };
  }

  refreshPreview();
  aggiornaIndicatoreMinuti();
  ['quantita','minuti_unitari','scadenza','inizio'].forEach(name => {
    const f = form.querySelector(`[name=${name}]`);
    if (f) f.addEventListener('input', refreshPreview);
    if (f) f.addEventListener('input', aggiornaDataRealistica);
  });
  aggiornaDataRealistica();
  // Prezzo: se la colonna non esiste ancora (pre-migrazione) tolgo il blocco;
  // altrimenti aggancio il totale live e pre-compilo dal listino.
  if (!prezzoAttivo) {
    form.querySelector('#prezzo-frow')?.remove();
  } else {
    form.querySelector('[name=quantita]')?.addEventListener('input', aggiornaTotalePrezzo);
    form.querySelector('#prezzo-input')?.addEventListener('input', aggiornaTotalePrezzo);
    form.querySelector('#prezzo-input')?.addEventListener('input', aggiornaSuggDaPrezzo);
    form.querySelector('#prezzo-input')?.addEventListener('input', aggiornaSuggDaConsuntivo);
    aggiornaPrezzoListino();
    aggiornaSuggDaPrezzo();
    aggiornaSuggDaConsuntivo();
  }
  // Ore esterne: solo su commesse esistenti (una nuova non ha consuntivo).
  if (!isNew) renderOreEsterne();
  renderMancanti();
  // Bind aggiuntivo: input minuti aggiorna anche l'indicatore di divergenza
  // e il suggerimento "da prezzo" (che sparisce quando i valori coincidono)
  const minInputEl = form.querySelector('#minuti-input');
  if (minInputEl) minInputEl.addEventListener('input', aggiornaIndicatoreMinuti);
  if (minInputEl) minInputEl.addEventListener('input', aggiornaSuggDaPrezzo);
  // Click sull'asterisco: ripristina il valore dell'articolo se diverso
  const starEl = form.querySelector('#minuti-diff');
  if (starEl) {
    starEl.style.cursor = 'pointer';
    starEl.addEventListener('click', () => {
      const artVal = acArticolo.getValue();
      const art = (artVal.mode === 'existing' && artVal.id)
        ? state.articoli.find(a => a.id === artVal.id) : null;
      if (art && art.minuti_unitari != null && minInputEl) {
        minInputEl.value = String(art.minuti_unitari);
        aggiornaIndicatoreMinuti();
        refreshPreview();
      }
    });
  }

  // Espongo lo stato del lucchetto al salvataggio
  form._inizioBloccato = () => inizioBloccato;

  // previewBox non più mostrato: le ore stimate sono già nell'header
  // riassuntivo. refreshPreview continua a scrivere su un nodo staccato
  // (innocuo) — utile se in futuro lo si vuole riattivare.

  // ── Header riassuntivo (solo commesse esistenti): colpo d'occhio ──
  if (!isNew) {
    const art = state.articoli.find(a => a.id === o.articolo_id);
    const cli = state.aziende.find(c => c.id === o.cliente_id);
    const stDef = OP_STATI[o.stato] || { label: o.stato, color: 'var(--mut)', badge: 'bgry' };
    const oggiISO = toLocalISO(new Date());
    const scadLate = o.scadenza && o.scadenza < oggiISO && o.stato !== 'spedita';
    // Confronto INTERNO-contro-interno: i timbri sono solo interni, quindi
    // preventivo e pagato escludono la quota delle fasi esternalizzate
    // (pagatoOreInterne ripartisce il pagato sulla quota di lavoro in casa).
    // Ridisegnabile: aggiungere ore esterne nel Consuntivo deve muovere anche
    // questa barra, che altrimenti resterebbe ferma finché non riapri.
    const boxSum = el('div', { class:'opsum' });
    const renderSum = () => {
    boxSum.innerHTML = '';
    const prev = opCalcOreInterne(o);
    const oreEsterneHd = Math.max(0, opCalcOre(o) - prev);
    // Consuntivo COMPLETO (timbri + rapportini) e pagato di confronto coerente:
    // stessa regola del Consuntivo — se conto ore esterne, il pagato è l'intero.
    const cc = (typeof consuntivoCommessa === 'function') ? consuntivoCommessa(o) : null;
    const cons = cc ? cc.oreTot : opCalcOreReali(o);
    const pagatoOre = cc ? cc.pagato : pagatoOreInterne(o);
    const base = pagatoOre > 0 ? pagatoOre : prev;   // riferimento = tempo pagato
    const overOre = cc && pagatoOre > 0 ? cc.sforoPagato
      : (base > 0 && cons > base + tolleranzaOre(base));
    const percOre = cc && pagatoOre > 0 ? cc.percPagato
      : (base > 0 ? Math.round(cons / base * 100) : 0);
    // La barra si scala sul MASSIMO tra consuntivo e pagato: così il segmento
    // OLTRE il pagato sporge visibile invece di essere tagliato al 100%.
    const scaleMax = Math.max(cons, base, 1e-6);
    const pagatoPct = base > 0 ? Math.min(100, base / scaleMax * 100) : 100;
    const normalPct = Math.min(cons, base) / scaleMax * 100;         // dentro il pagato
    const overPct = Math.max(0, (cons - base)) / scaleMax * 100;     // lo sforamento
    const barInner = [
      el('div', { class:'opsum-orefill', style:'width:' + normalPct + '%;' }),
    ];
    if (overPct > 0) {
      barInner.push(el('div', { class:'opsum-oreover',
        style:'left:' + pagatoPct + '%;width:' + overPct + '%;',
        title:'Oltre il pagato: +' + (cons - base).toFixed(1) + 'h' }));
    }
    if (base > 0) {
      barInner.push(el('div', { class:'opsum-orepag',
        style:'left:' + pagatoPct + '%;', title:'Tempo pagato: ' + base.toFixed(1) + 'h' }));
    }
    boxSum.append(
      el('div', { class:'opsum-main' },
        el('div', { class:'opsum-cod' },
          (art?.codice || '—'),
          el('span', { class:'badge ' + stDef.badge, style:'margin-left:8px;' }, stDef.label)),
        el('div', { class:'opsum-sub' },
          (cli?.nome || '—')
          + ' · Ord. ' + (o.numero_ordine || '—')
          + (o.numero_op ? ' · OP ' + o.numero_op : '')
          + ' · Qtà ' + (o.quantita ?? '—')),
      ),
      el('div', { class:'opsum-right' },
        el('div', { class:'opsum-scad' + (scadLate ? ' late' : '') },
          'Scad. ' + fmtIT(o.scadenza || '') + (scadLate ? ' ⚠' : '')),
        el('div', { class:'opsum-ore', title: (pagatoOre > 0
            ? 'Solo parte INTERNA. Consuntivo ' + cons.toFixed(1) + 'h · riferimento (100%) = tempo pagato ' + pagatoOre.toFixed(1) + 'h'
              + (overOre ? ' · ⚠ OLTRE di ' + (cons - pagatoOre).toFixed(1) + 'h' : '')
            : 'Ore consuntivate / preventivate (solo parte interna)')
            + (oreEsterneHd > 0.05 ? '\nFasi esterne (fornitori): ' + oreEsterneHd.toFixed(1) + 'h, fuori da questo confronto' : '') },
          el('span', { style:'font-size:11px;letter-spacing:.08em;text-transform:uppercase;' }, 'ore'),
          el('div', { class:'opsum-orebar' }, ...barInner),
          el('span', { style: overOre ? 'color:var(--red);font-weight:700;' : '' }, (pagatoOre > 0
            ? cons.toFixed(1) + ' / ' + pagatoOre.toFixed(1) + 'h · ' + percOre + '%'
              + (overOre ? ' · +' + (cons - pagatoOre).toFixed(1) + 'h oltre' : '')
            : cons.toFixed(1) + '/' + prev.toFixed(1) + 'h')
            + (cc && cc.oreEsterne > 0.05 ? ' · di cui est. ' + cc.oreEsterne.toFixed(1) : '')
            + (oreEsterneHd > 0.05 ? ' · fasi est. ' + oreEsterneHd.toFixed(1) : ''))),
      ),
    );
    };
    renderSum();
    // La sezione ore esterne ridisegna anche questa barra.
    aggiornaBarraOre = renderSum;
    body.append(boxSum);
  }

  // ── Barra schede ──
  const tabs = [
    { id:'dati', label:'Dati', panel:pDati },
    { id:'lav', label:'Lavorazione', panel:pLav },
  ];
  if (!isNew) {
    tabs.push({ id:'prod', label:'Produzione & Spedizioni', panel:pProd });
    tabs.push({ id:'cons', label:'Consuntivo', panel:pCons });
  }
  const tabBar = el('div', { class:'optabs' });
  const tabBtns = {};
  const switchTab = (id) => {
    tabs.forEach(t => {
      t.panel.classList.toggle('on', t.id === id);
      tabBtns[t.id].classList.toggle('act', t.id === id);
    });
  };
  tabs.forEach(t => {
    tabBtns[t.id] = el('button', { type:'button', class:'optab-btn' + (t.id === 'dati' ? ' act' : ''),
      onclick: () => switchTab(t.id) }, t.label);
    tabBar.append(tabBtns[t.id]);
  });
  body.append(tabBar);

  body.append(form);
  modal.append(body);

  // Disabilita campi se non admin
  if (!isAdmin) {
    form.querySelectorAll('input,select,textarea').forEach(i => i.disabled = true);
  }

  const foot = el('div', { class:'mfoot' });
  if (isAdmin && !isNew) {
    foot.append(el('button', {
      class:'btng', style:'color:var(--red);border-color:var(--red);margin-right:auto;',
      onclick: async () => {
        await deleteOperazione(o);   // chiede conferma; se annullata non succede nulla
        if (!state.operazioni.find(x => x.id === o.id)) closeModal();
      },
    }, '🗑 Elimina'));
  }
  foot.append(el('button', { class:'btng', onclick:closeModal }, 'Chiudi'));
  if (isAdmin) {
    const btnSave = el('button', { class:'btnp' }, 'Salva');
    btnSave.onclick = async () => {
      const fd = new FormData(form);

      // ── Guardia: completare/spedire una commessa con sessioni APERTE
      // bloccava gli operatori al kiosk. Avvisa chi sta salvando e, se
      // conferma, chiude le sessioni adesso (le ore restano registrate).
      const nuovoStato = selStato.value;
      if (!isNew && (nuovoStato === 'completata' || nuovoStato === 'spedita')) {
        const sessAperte = (state.sessioni || []).filter(s => !s.fine && s.operazione_id === o.id);
        if (sessAperte.length > 0) {
          const nomi = sessAperte.map(s =>
            state.utenti.find(u => u.id === s.utente_id)?.nome || '?').join(', ');
          const ok = confirm(
            `⚠ Su questa commessa ${sessAperte.length === 1 ? 'c\'è 1 sessione di lavoro APERTA' : 'ci sono ' + sessAperte.length + ' sessioni di lavoro APERTE'}:\n`
            + nomi + '\n\n'
            + `Confermando, le sessioni verranno chiuse adesso (le ore restano registrate) e la commessa passerà a "${OP_STATI[nuovoStato]?.label || nuovoStato}".\n\n`
            + 'Annulla se preferisci che gli operatori terminino prima dal kiosk.');
          if (!ok) return;
          const oraISO = new Date().toISOString();
          for (const s of sessAperte) {
            const { data: chiusa, error: eCh } = await sb.from('sessioni_lavoro')
              .update({ fine: oraISO }).eq('id', s.id).select().single();
            if (eCh) return toast('Errore chiusura sessione: ' + eCh.message, 'err');
            state.sessioni = state.sessioni.map(x => x.id === s.id ? chiusa : x);
          }
          toast(`${sessAperte.length === 1 ? 'Sessione chiusa' : sessAperte.length + ' sessioni chiuse'} (${nomi})`, 'ok');
        }
      }

      // Risolvi cliente e articolo: se nuovi, creali al volo in anagrafica
      const cliVal = acCliente.getValue();
      const artVal = acArticolo.getValue();

      if (cliVal.mode === 'empty') return toast('Cliente obbligatorio', 'err');
      if (artVal.mode === 'empty') return toast('Articolo obbligatorio', 'err');

      // Validazione numero ordine: obbligatorio + formato AAAA/OC/NNNNN.
      // Applichiamo qui lo stesso zero-padding dell'onblur, in caso il submit
      // arrivi senza blur preventivo (es. Invio da tastiera).
      let numOrd = (fd.get('numero_ordine')||'').trim();
      const padMatch = numOrd.match(/^(\d{4})\/OC\/(\d{1,4})$/);
      if (padMatch) numOrd = padMatch[1] + '/OC/' + padMatch[2].padStart(5, '0');
      if (!numOrd) {
        return toast('Numero ordine obbligatorio', 'err');
      }
      if (!/^\d{4}\/OC\/\d{5}$/.test(numOrd)) {
        return toast('Numero ordine non valido. Usa il formato AAAA/OC/NNNNN (es. 2026/OC/00388).', 'err');
      }

      // Validazione numero OP: opzionale, ma se valorizzato deve essere AAAA/OP/NNNNN.
      // Se l'utente non ha toccato la precompilazione (solo "AAAA/OP/" senza
      // cifre dopo), trattiamo come "vuoto" e salviamo null.
      // Stessa regola della griglia: si accetta l'OP come è scritto sui
      // documenti (2026OP1727) e non solo la forma canonica.
      let numOp = (fd.get('numero_op')||'').trim();
      const opSoloPrefisso = /^\d{4}\/OP\/$/.test(numOp);
      const numOpFinale = (numOp && !opSoloPrefisso) ? odlANumeroOp(numOp) : null;
      if (numOp && !opSoloPrefisso && !numOpFinale) {
        return toast('Numero OP non riconosciuto. Usa 2026OP1727 oppure 2026/OP/01727, o lascia vuoto.', 'err');
      }

      btnSave.disabled = true;
      btnSave.textContent = 'Salvataggio…';
      const stopWatchdog = avviaWatchdog(btnSave, 'Salva');

      let clienteId = cliVal.id;
      let articoloId = artVal.id;

      try {
        // Crea cliente nuovo se serve
        if (cliVal.mode === 'new') {
          const { data: nuovoCli, error: errCli } = await sb.from('aziende')
            .insert({ nome: cliVal.text, attivo: true, is_cliente: true, is_fornitore: false })
            .select().single();
          if (errCli) {
            stopWatchdog();
            btnSave.disabled = false; btnSave.textContent = 'Salva';
            return toast('Errore creazione cliente: '+errCli.message, 'err');
          }
          if (!state.aziende.find(x => x.id === nuovoCli.id)) state.aziende.push(nuovoCli);
          clienteId = nuovoCli.id;
        }
        // Crea articolo nuovo se serve
        if (artVal.mode === 'new') {
          const { data: nuovoArt, error: errArt } = await sb.from('articoli')
            .insert({ codice: artVal.text, attivo: true })
            .select().single();
          if (errArt) {
            stopWatchdog();
            btnSave.disabled = false; btnSave.textContent = 'Salva';
            return toast('Errore creazione articolo: '+errArt.message, 'err');
          }
          if (!state.articoli.find(x => x.id === nuovoArt.id)) state.articoli.push(nuovoArt);
          articoloId = nuovoArt.id;
        }
      } catch (e) {
        stopWatchdog();
        btnSave.disabled = false; btnSave.textContent = 'Salva';
        return toast('Errore: '+(e.message||e), 'err');
      }

      const payload = {
        cliente_id: clienteId,
        articolo_id: articoloId,
        numero_ordine: numOrd,
        numero_op: numOpFinale,
        riferimento_cliente: (fd.get('riferimento_cliente')||'').trim() || null,
        pos: posNormalizzata(fd.get('pos')),
        quantita: parseInt(fd.get('quantita')) || 1,
        minuti_unitari: parseInt(fd.get('minuti_unitari')) || 0,
        scadenza: fd.get('scadenza') || null,
        inizio_manuale: (form._inizioBloccato && form._inizioBloccato())
          ? (fd.get('inizio') || null)
          : null,
        cl_consegna_materiali: fd.get('cl_consegna_materiali') || null,
        stato: fd.get('stato') || 'aperta',
        stato_preparazione: fd.get('stato_preparazione') || 'vuoto',
        note: (fd.get('note')||'').trim() || null,
        fasi_sequenziali: (fasiComm.filter(f => f.tipo_lavorazione_id).length >= 2) ? fasiSeq : false,
      };
      // Prezzo: solo se la colonna esiste (post-migrazione), così il salvataggio
      // non fallisce su una colonna inesistente.
      if (prezzoAttivo) {
        const v = parseFloat((fd.get('prezzo_unitario') || '').toString().replace(',', '.'));
        payload.prezzo_unitario = (Number.isFinite(v) && v >= 0) ? v : null;
      }
      if (!isNew && o.stato === 'spedita') {
        payload.consegnato_il = fd.get('consegnato_il') || null;
        payload.giustificazione_ritardo = (fd.get('giustificazione_ritardo')||'').trim() || null;
        payload.nc_post_consegna = (fd.get('nc_post_consegna')||'').trim() || null;
        payload.responsabilita = (fd.get('responsabilita')||'').trim() || null;
      }
      if (payload.quantita <= 0) {
        stopWatchdog();
        btnSave.disabled = false; btnSave.textContent = 'Salva';
        return toast('Quantità deve essere > 0', 'err');
      }

      // ── Seconda porta per lo stato (27 ago). La tendina nella lista passa
      // da `quickStato` e chiede conferma; da qui si salvava e basta, quindi
      // si poteva dichiarare SPEDITA una commessa senza che risultasse
      // spedito niente. Stesso controllo, stesso pezzo di codice: se le due
      // porte si comportano diverso, una delle due sbaglia.
      // Solo su commesse esistenti e solo quando lo stato AVANZA davvero.
      let fattiStato = { ok: true, lotto: null, spedizione: null };
      if (!isNew && payload.stato !== o.stato
          && (payload.stato === 'completata' || payload.stato === 'spedita')) {
        fattiStato = fattiPerStato(o, payload.stato);
        if (!fattiStato.ok) {
          stopWatchdog();
          btnSave.disabled = false; btnSave.textContent = 'Salva';
          // Il campo torna a dire il vero: lo stato non è cambiato.
          const sel = form.querySelector('[name="stato"]');
          if (sel) sel.value = o.stato || 'aperta';
          return;
        }
      }

      try {
        // I fatti PRIMA dello stato, come nella tendina: se falliscono, la
        // commessa non deve restare dichiarata chiusa senza le sue righe.
        if (fattiStato.lotto || fattiStato.spedizione) {
          await scriviFattiPerStato(o, fattiStato);
        }
        const { data, error } = await eseguiConRetry(
          () => isNew
            ? sb.from('operazioni').insert(payload).select().single()
            : sb.from('operazioni').update(payload).eq('id', o.id).select().single(),
          { label: 'salvataggio operazione' }
        );
        if (error) {
          stopWatchdog();
          btnSave.disabled = false;
          btnSave.textContent = 'Salva';
          return toast(error.message, 'err');
        }
        if (isNew) {
          if (!state.operazioni.find(x => x.id === data.id)) state.operazioni.push(data);
        } else {
          state.operazioni = state.operazioni.map(x => x.id === o.id ? data : x);
        }
        // Semina i minuti pagati sull'articolo SOLO se mancano in anagrafica
        // (come cliente/codice: si popola il vuoto, mai si sovrascrive uno standard
        // già impostato). Best-effort: non blocca il salvataggio della commessa.
        try {
          const art = state.articoli.find(x => x.id === articoloId);
          const minutiCommessa = payload.minuti_unitari;
          if (art && minutiCommessa > 0 && (art.minuti_unitari == null || art.minuti_unitari === '')) {
            const { data: artUpd, error: errArtUpd } = await sb.from('articoli')
              .update({ minuti_unitari: minutiCommessa }).eq('id', art.id).select().single();
            if (!errArtUpd && artUpd) {
              state.articoli = state.articoli.map(x => x.id === artUpd.id ? artUpd : x);
              toast('Minuti pagati salvati anche nell\'anagrafica articolo');
            }
          }
          // Semina anche le FASI sull'articolo SOLO se lì mancano (fasi vuoto),
          // mai sovrascrivere un template già definito. Stessa logica dei minuti.
          const templateFasi = fasiComm
            .filter(f => f.tipo_lavorazione_id)
            .map((f, i) => ({ tipo_lavorazione_id: f.tipo_lavorazione_id, minuti_unitari: Number(f.minuti_unitari) || 0, ordine: i + 1 }));
          const artFasiVuote = art && (art.fasi == null || (Array.isArray(art.fasi) && art.fasi.length === 0));
          if (art && templateFasi.length > 0 && artFasiVuote) {
            const { data: artF, error: errArtF } = await sb.from('articoli')
              .update({ fasi: templateFasi }).eq('id', art.id).select().single();
            if (!errArtF && artF) {
              state.articoli = state.articoli.map(x => x.id === artF.id ? artF : x);
              toast('Fasi salvate anche nell\'anagrafica articolo');
            }
          }
        } catch (e) { /* best-effort */ }
        // 1) FASI prima di tutto: restituiscono la mappa _k → id reale, che
        //    serve per assegnare il fase_id giusto ad addetti e fornitori.
        const fasiPayloadComm = fasiComm
          .filter(f => f.tipo_lavorazione_id)
          .map((f, i) => ({ _k: f._k, id: f.id, tipo_lavorazione_id: f.tipo_lavorazione_id, minuti_unitari: Number(f.minuti_unitari) || 0, ordine: i + 1 }));
        const syncFasi = await syncOperazioneFasi(data.id, fasiPayloadComm);
        if (syncFasi.error) {
          stopWatchdog();
          btnSave.disabled = false; btnSave.textContent = 'Salva';
          return toast('Operazione salvata, ma errore fasi: '+syncFasi.error.message, 'err');
        }
        const faseIdByK = syncFasi.keyToId || {};
        const resolveFase = (k) => (k && faseIdByK[k]) ? faseIdByK[k] : null;

        // Generazione automatica fasi dalla media storica: SOLO commessa
        // nuova e SOLO se non ne hai inserite a mano. Niente template, niente
        // operatori assegnati di nascosto. Best-effort: non blocca il salvataggio.
        if (isNew && fasiPayloadComm.length === 0) {
          try {
            const gen = await autoGeneraFasiDaMedia(data);
            if (gen && gen.creato > 0) {
              toast(gen.debole
                ? '⚠ Fasi generate da storico/anagrafica (media debole: 1 sola commessa)'
                : 'Fasi generate automaticamente da storico/anagrafica');
            }
          } catch (e) { /* best-effort: l'automatismo non deve mai bloccare il salvataggio */ }
        }

        // 2) Addetti: una riga per coppia (utente, fase). Nessuna fase
        //    selezionata = una riga con fase_id null (tutta la commessa).
        const addettiPayload = addettiSel.flatMap(uid => {
          const keys = (addettoFase[uid] || []).filter(k => resolveFase(k));
          if (keys.length === 0) return [{ utente_id: uid, fase_id: null }];
          return keys.map(k => ({ utente_id: uid, fase_id: resolveFase(k) }));
        });
        const syncRes = await syncOperazioneAddetti(data.id, addettiPayload);
        if (syncRes.error) {
          stopWatchdog();
          btnSave.disabled = false;
          btnSave.textContent = 'Salva';
          return toast('Operazione salvata, ma errore addetti: '+syncRes.error.message, 'err');
        }
        // Commessa raggruppata: gli addetti valgono per tutto il gruppo.
        // Best-effort dichiarato: se fallisce non blocca il salvataggio, ma
        // lo dice, così nessuno crede che sia andata quando non è andata.
        try {
          const prop = await propagaAddettiGruppo(data, addettiPayload);
          if (prop.error) {
            toast('Addetti salvati, ma non propagati al gruppo: ' + prop.error.message, 'err');
          } else if (prop.toccate > 0) {
            toast('Addetti applicati anche alle altre ' + prop.toccate
              + (prop.toccate === 1 ? ' commessa' : ' commesse') + ' del gruppo'
              + (prop.saltate ? ' · ' + prop.saltate + ' assegnazioni per fase saltate (fase assente lì)' : ''));
          }
        } catch (e) { toast('Addetti salvati, ma propagazione al gruppo non riuscita', 'err'); }
        // Normalizza i numeri ordine fornitore: padding zero a 5 cifre,
        // svuotamento del "solo prefisso" precompilato, validazione formato.
        // Accetto sia AAAA/OF/NNNNN (Ordine Fornitore) sia AAAA/OL/NNNNN
        // (Ordine Lavorazione): preservo quale prefisso ha usato l'utente.
        for (const sel of fornitoriSel) {
          let n = (sel.numero_ordine || '').trim();
          const padM = n.match(/^(\d{4})\/(OF|OL)\/(\d{1,4})$/);
          if (padM) n = padM[1] + '/' + padM[2] + '/' + padM[3].padStart(5, '0');
          const soloPrefisso = /^\d{4}\/(OF|OL)\/$/.test(n);
          if (n && !soloPrefisso && !/^\d{4}\/(OF|OL)\/\d{5}$/.test(n)) {
            const fornNome = (state.aziende.find(a => a.id === sel.azienda_id) || {}).nome || sel.azienda_id;
            stopWatchdog();
            btnSave.disabled = false;
            btnSave.textContent = 'Salva';
            return toast(`Numero ordine fornitore "${fornNome}" non valido. Usa il formato AAAA/OF/NNNNN o AAAA/OL/NNNNN, oppure lascia vuoto.`, 'err');
          }
          sel.numero_ordine = (n && !soloPrefisso) ? n : '';
        }

        // 3) Fornitori: un fornitore su più fasi → una riga per (azienda, fase).
        //    Nessuna fase selezionata = una riga con fase_id null (tutta la commessa).
        const fornitoriPayload = [];
        fornitoriSel.forEach(s => {
          const base = { azienda_id: s.azienda_id, numero_ordine: s.numero_ordine, allocazione: s.allocazione };
          const keys = (s.fase_keys || []).map(k => resolveFase(k)).filter(Boolean);
          if (keys.length === 0) fornitoriPayload.push({ ...base, fase_id: null });
          else keys.forEach(fid => fornitoriPayload.push({ ...base, fase_id: fid }));
        });
        const syncFor = await syncOperazioneFornitori(data.id, fornitoriPayload);
        if (syncFor.error) {
          stopWatchdog();
          btnSave.disabled = false;
          btnSave.textContent = 'Salva';
          return toast('Operazione salvata, ma errore fornitori: '+syncFor.error.message, 'err');
        }
        stopWatchdog();
        toast(isNew ? 'Operazione creata' : 'Operazione aggiornata');
        // Refresha la tab da cui è stato aperto il modal (Pianificazione, Gantt,
        // Magazzino, Storico…), non forzare un cambio di vista.
        closeModal(); renderTab(state.currentTab || 'pianificazione');
      } catch (e) {
        stopWatchdog();
        btnSave.disabled = false;
        btnSave.textContent = 'Salva';
        toast('Errore di rete: '+(e.message||e), 'err');
      }
    };
    foot.append(btnSave);
  }
  modal.append(foot);
  openModal(modal);
}

async function deleteOperazione(o) {
  // Sessioni aperte: chiuderle PRIMA di eliminare, sia per non bloccare i
  // kiosk sia per preservare le ore (la cancellazione potrebbe propagarsi).
  const sessAperte = (state.sessioni || []).filter(s => !s.fine && s.operazione_id === o.id);
  if (sessAperte.length > 0) {
    const nomi = sessAperte.map(s =>
      state.utenti.find(u => u.id === s.utente_id)?.nome || '?').join(', ');
    if (!confirm(`⚠ Su questa commessa ${sessAperte.length === 1 ? 'c\'è 1 sessione APERTA' : 'ci sono ' + sessAperte.length + ' sessioni APERTE'} (${nomi}).\n\nConfermando verranno chiuse adesso e poi potrai eliminare la commessa.`)) return;
    const oraISO = new Date().toISOString();
    for (const s of sessAperte) {
      const { data: chiusa, error: eCh } = await sb.from('sessioni_lavoro')
        .update({ fine: oraISO }).eq('id', s.id).select().single();
      if (eCh) return toast('Errore chiusura sessione: ' + eCh.message, 'err');
      state.sessioni = state.sessioni.map(x => x.id === s.id ? chiusa : x);
    }
  }
  if (!confirm(`Eliminare questa operazione?\n${o.numero_ordine || ''}`)) return;
  const { data, error } = await sb.from('operazioni').delete().eq('id', o.id).select();
  if (error) return toast(error.message, 'err');
  if (!data || data.length === 0) return toast('Eliminazione bloccata', 'err');
  state.operazioni = state.operazioni.filter(x => x.id !== o.id);
  // Refresha la tab corrente, non forzare un cambio di vista
  toast('Operazione eliminata'); renderTab(state.currentTab || 'pianificazione');
}

// ═══════════════════════════════════════════════════════════
// STORICO — operazioni spedite, KPI puntualità
// ═══════════════════════════════════════════════════════════


// Vista admin/consultazione dei prelievi registrati dall'app magazzino.
let _prelSeq = 0; // guardia anti-doppione: solo l'ultima invocazione disegna
async function renderPrelievi(root) {
  const mySeq = ++_prelSeq;
  root.innerHTML = '';
  root.append(el('div', { class:'toolbar' }, el('h2', {}, 'Prelievi magazzino')));
  const info = el('div', { class:'sub', style:'margin:4px 0 14px;color:var(--mut);' }, 'Caricamento…');
  root.append(info);

  let dati = [];
  try {
    const { data, error } = await sb.from('prelievi_magazzino')
      .select('*').order('creato_il', { ascending: false }).limit(500);
    if (error) throw error;
    dati = data || [];
  } catch (e) {
    if (mySeq !== _prelSeq) return;
    info.textContent = 'Errore nel caricamento dei prelievi: ' + (e.message || e)
      + ' (verifica che la tabella prelievi_magazzino esista).';
    return;
  }
  // Se nel frattempo la scheda è stata ridisegnata (cambio tab e ritorno),
  // questa invocazione è vecchia: non deve appendere nulla.
  if (mySeq !== _prelSeq || !root.isConnected) return;

  if (dati.length === 0) { info.textContent = 'Nessun prelievo registrato.'; return; }
  info.textContent = dati.length + ' prelievi più recenti.';

  const isAdmin = state.profile?.ruolo === 'admin';
  const tbl = el('table', { class:'rt' });
  const headCells = [
    el('th', {}, 'Data/ora'), el('th', {}, 'Operatore'), el('th', {}, 'OP'),
    el('th', {}, 'Cliente'), el('th', {}, 'Articolo'), el('th', { class:'tr' }, 'Qtà')];
  if (isAdmin) headCells.push(el('th', { class:'tc' }, 'Azioni'));
  tbl.append(el('thead', {}, el('tr', {}, ...headCells)));
  const tb = el('tbody');
  dati.forEach(p => {
    const u = (state.utentiById && state.utentiById[p.utente_id]) || state.utenti.find(x => x.id === p.utente_id);
    const op = state.operazioni.find(o => o.id === p.operazione_id);
    const cli = op ? state.aziende.find(c => c.id === op.cliente_id) : null;
    const art = state.articoli.find(a => a.id === p.articolo_id);
    let dt = '—';
    if (p.creato_il) {
      const d = new Date(p.creato_il);
      if (!isNaN(d)) dt = fmtIT(toLocalISO(d)) + ' ' + z(d.getHours()) + ':' + z(d.getMinutes());
    }
    const cells = [
      el('td', { class:'mono' }, dt),
      el('td', {}, u?.nome || '—'),
      el('td', { class:'mono' }, op?.numero_op || '—'),
      el('td', {}, cli?.nome || '—'),
      el('td', {}, (art?.codice || p.codice_scansionato || '—') + (art?.descrizione ? ' · ' + art.descrizione : '')),
      el('td', { class:'tr mono' }, String(p.quantita ?? '')),
    ];
    if (isAdmin) {
      cells.push(el('td', { class:'tc' },
        el('button', { class:'btng', style:'padding:4px 9px;margin-right:6px;',
          onclick: () => openPrelievoModal(p, () => renderTab(state.currentTab)) }, '✎'),
        el('button', { class:'btng', style:'padding:4px 9px;color:var(--red);',
          onclick: async () => {
            if (!confirm('Eliminare questo prelievo?')) return;
            const { error } = await sb.from('prelievi_magazzino').delete().eq('id', p.id);
            if (error) toast('Errore: ' + error.message, 'err');
            else { toast('Prelievo eliminato', 'ok'); renderTab(state.currentTab); }
          } }, '🗑'),
      ));
    }
    tb.append(el('tr', {}, ...cells));
  });
  tbl.append(tb);
  const tw = el('div', { class:'tw' });
  tw.append(tbl);
  root.append(tw);
}

// Modale admin per modificare un prelievo (tutti i campi).
function openPrelievoModal(p, refresh) {
  const modal = el('div', { class:'modal' });
  modal.append(el('div', { class:'mhd' },
    el('h2', {}, 'Modifica prelievo'),
    el('button', { class:'mclose', onclick: closeModal }, '✕'),
  ));
  const body = el('div', { class:'mbody' });

  // Data/ora in locale per l'input datetime-local
  let dtVal = '';
  if (p.creato_il) {
    const d = new Date(p.creato_il);
    if (!isNaN(d)) dtVal = toLocalISO(d) + 'T' + z(d.getHours()) + ':' + z(d.getMinutes());
  }
  const inpData = el('input', { type:'datetime-local', value: dtVal });

  // Operatore
  const selUte = el('select', {});
  state.utenti.filter(u => !isKioskRecord(u))
    .forEach(u => selUte.append(el('option', { value: u.id }, u.nome)));
  selUte.value = p.utente_id || '';

  // Commessa (ordinate: più recenti prima, mostra OP + ordine + cliente)
  const selOp = el('select', {});
  selOp.append(el('option', { value:'' }, '— nessuna —'));
  state.operazioni.slice()
    .sort((a, b) => (b.numero_ordine || '').localeCompare(a.numero_ordine || ''))
    .forEach(o => {
      const cli = state.aziende.find(c => c.id === o.cliente_id);
      const label = (o.numero_op ? 'OP ' + o.numero_op + ' · ' : '')
        + (o.numero_ordine || '—') + (cli ? ' · ' + cli.nome : '');
      selOp.append(el('option', { value: o.id }, label));
    });
  selOp.value = p.operazione_id || '';

  // Articolo (anagrafica) + codice libero per i fuori-anagrafica
  const selArt = el('select', {});
  selArt.append(el('option', { value:'' }, '— non in anagrafica (usa codice) —'));
  state.articoli.slice()
    .sort((a, b) => (a.codice || '').localeCompare(b.codice || ''))
    .forEach(a => selArt.append(el('option', { value: a.id },
      a.codice + (a.descrizione ? ' · ' + a.descrizione : ''))));
  selArt.value = p.articolo_id || '';
  const inpCod = el('input', { type:'text', value: p.codice_scansionato || '',
    placeholder:'codice scansionato/libero' });

  // Quantità
  const inpQta = el('input', { type:'number', step:'any', min:'0', value: String(p.quantita ?? 1) });

  body.append(
    el('div', { class:'field' }, el('label', {}, 'Data e ora'), inpData),
    el('div', { class:'field' }, el('label', {}, 'Operatore'), selUte),
    el('div', { class:'field' }, el('label', {}, 'Commessa'), selOp),
    el('div', { class:'field' }, el('label', {}, 'Articolo (anagrafica)'), selArt),
    el('div', { class:'field' }, el('label', {}, 'Codice scansionato'), inpCod),
    el('div', { class:'field' }, el('label', {}, 'Quantità'), inpQta),
  );
  modal.append(body);

  modal.append(el('div', { class:'mfoot' },
    el('button', { class:'btng', onclick: closeModal }, 'Annulla'),
    el('button', { class:'btnp', onclick: async () => {
      const qta = parseFloat(inpQta.value);
      if (!(qta > 0)) return toast('Quantità non valida', 'err');
      const payload = {
        utente_id: selUte.value || null,
        operazione_id: selOp.value || null,
        articolo_id: selArt.value || null,
        codice_scansionato: inpCod.value.trim() || null,
        quantita: qta,
      };
      if (inpData.value) {
        const d = new Date(inpData.value);
        if (!isNaN(d)) payload.creato_il = d.toISOString();
      }
      const { error } = await sb.from('prelievi_magazzino')
        .update(payload).eq('id', p.id);
      if (error) return toast('Errore: ' + error.message, 'err');
      toast('Prelievo aggiornato', 'ok');
      closeModal();
      if (refresh) refresh();
    } }, 'Salva'),
  ));
  openModal(modal);
}

// Le spedizioni che la scheda Storico sta MOSTRANDO, coi filtri attivi.
// UNA sola strada: la usano la tabella e l'export (7 ago, richiesta Nico).
// Se fossero due, l'Excel direbbe una cosa diversa da quella che si vede — ed
// è esattamente quello che faceva prima: esportava sempre tutto.
// Ritorna { list, opById, ritardoSped, filtriAttivi }.
function storicoFiltrate() {
  const search = (state.stoSearch || '').toLowerCase();
  const filtroMese = state.stoMese || null;
  const filtroAddetto = state.stoAddetto || '';
  const filtroPunt = state.stoPunt || 'all';
  const filtroSfora = state.stoSfora || false;   // solo spedizioni di commesse che hanno sforato il pagato

  // Vista COMMESSA-centrica (27 ago). Prima ogni riga era UNA spedizione, e
  // una commessa marcata spedita senza righe in `spedizioni` non compariva:
  // erano 21 commesse invisibili in tutta l'app, perché Ordini cliente
  // nascondeva le spedite e il Gantt disegna solo il lavoro assegnato.
  // Adesso la base sono le COMMESSE che appartengono allo Storico secondo
  // l'unica regola in domain, e ognuna compare una volta sola.
  // Le spedizioni parziali (9 commesse su 219) non si perdono: si vedono
  // aprendo la commessa, nella sezione Spedizioni con date e DDT.
  const opById = Object.fromEntries(state.operazioni.map(o => [o.id, o]));
  const oggiSto = toLocalISO(new Date());
  let list = state.operazioni
    .filter(o => commessaInStorico(o, state.spedizioni, oggiSto))
    .map(op => {
      const sue = (state.spedizioni || [])
        .filter(s => s.operazione_id === op.id)
        .sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')));
      const ultima = sue[sue.length - 1];
      const totale = sue.reduce((n, x) => n + Number(x.quantita || 0), 0);
      // La riga porta i dati dell'ULTIMA spedizione (data, DDT, destinatario)
      // ma la quantità è il TOTALE spedito: in una vista per commessa "Qtà"
      // vuol dire quanto è uscito, non quanto è uscito l'ultima volta.
      if (ultima) return Object.assign({}, ultima, { quantita: totale, _nSped: sue.length });
      // Nessuna spedizione registrata: la commessa c'è lo stesso, con la sua
      // quantità e senza data. È il caricamento iniziale del 19 mag 2026.
      return {
        id: 'nosped-' + op.id, operazione_id: op.id, data: null,
        quantita: op.quantita, ddt: null, destinatario: null, note: null,
        _nSped: 0, _senzaSpedizione: true,
      };
    });

  // Filtri: mese (su data spedizione)
  if (filtroMese) {
    list = list.filter(s => (s.data || '').startsWith(filtroMese));
  }
  // Clienti (dell'operazione collegata) — multi-esclusione stile Excel
  if (state.stoClientiEsclusi && state.stoClientiEsclusi.size > 0) {
    list = list.filter(s => {
      const op = opById[s.operazione_id];
      return op && !state.stoClientiEsclusi.has(op.cliente_id);
    });
  }
  // Addetto (dell'operazione collegata)
  if (filtroAddetto) {
    list = list.filter(s => {
      const op = opById[s.operazione_id];
      return op && getOperazioneAddetti(op.id).includes(filtroAddetto);
    });
  }
  // Fornitore (dell'operazione collegata)
  const filtroFornitore = state.stoFornitore || '';
  if (filtroFornitore) {
    list = list.filter(s => {
      const op = opById[s.operazione_id];
      return op && (getOperazioneFornitori(op.id) || []).includes(filtroFornitore);
    });
  }
  // Puntualità: ritardo = data spedizione - scadenza (negativo = anticipo)
  const ritardoSped = (s) => {
    const op = opById[s.operazione_id];
    if (!op || !op.scadenza || !s.data) return null;
    return Math.round((parseISODate(s.data) - parseISODate(op.scadenza)) / 86400000);
  };
  if (filtroPunt === 'puntuali') list = list.filter(s => (ritardoSped(s)||0) <= 0);
  else if (filtroPunt === 'ritardo') list = list.filter(s => (ritardoSped(s)||0) > 0);

  // Sforamento tempo pagato: consuntivo reale (ore) della commessa > tempo
  // pagato (minuti_unitari × quantità). Solo commesse con pagato impostato.
  const haSforato = (op) => {
    if (!op) return false;
    const pagatoOre = (Number(op.minuti_unitari) > 0 && Number(op.quantita) > 0)
      ? (Number(op.minuti_unitari) * Number(op.quantita)) / 60 : 0;
    if (pagatoOre <= 0) return false;
    return opCalcOreReali(op) > pagatoOre + tolleranzaOre(pagatoOre);
  };
  if (filtroSfora) list = list.filter(s => haSforato(opById[s.operazione_id]));

  // Ricerca: DDT, destinatario, note, ordine, OP, rif. cliente, pos, cliente, codice, descrizione
  if (search) {
    list = list.filter(s => {
      const op = opById[s.operazione_id];
      const cli = op ? state.aziende.find(c => c.id === op.cliente_id) : null;
      const art = op ? state.articoli.find(a => a.id === op.articolo_id) : null;
      return (s.ddt || '').toLowerCase().includes(search)
          || (s.destinatario || '').toLowerCase().includes(search)
          || (s.note || '').toLowerCase().includes(search)
          || (op?.numero_ordine || '').toLowerCase().includes(search)
          || (op?.numero_op || '').toLowerCase().includes(search)
          || (op?.riferimento_cliente || '').toLowerCase().includes(search)
          || (op?.pos || '').toLowerCase().includes(search)
          || (cli?.nome || '').toLowerCase().includes(search)
          || (art?.codice || '').toLowerCase().includes(search)
          || (art?.descrizione || '').toLowerCase().includes(search);
    });
  }

  // Sort: più recente prima
  list.sort((a, b) => (b.data || '').localeCompare(a.data || ''));

  // Descrizione a parole dei filtri attivi: serve all'export per dichiarare
  // cosa sta portando via, invece di lasciarlo indovinare.
  const filtriAttivi = [];
  if (filtroMese) filtriAttivi.push('mese ' + filtroMese);
  if (state.stoClientiEsclusi && state.stoClientiEsclusi.size)
    filtriAttivi.push(state.stoClientiEsclusi.size + ' clienti esclusi');
  if (filtroAddetto) filtriAttivi.push('addetto ' + ((state.utenti.find(u => u.id === filtroAddetto) || {}).nome || ''));
  if (state.stoFornitore) filtriAttivi.push('fornitore');
  if (filtroPunt !== 'all') filtriAttivi.push(filtroPunt === 'puntuali' ? 'solo puntuali' : 'solo in ritardo');
  if (filtroSfora) filtriAttivi.push('solo chi ha sforato');
  if (search) filtriAttivi.push('ricerca "' + search + '"');

  return { list, opById, ritardoSped, filtriAttivi };
}

function renderStorico(root) {
  const isAdmin = state.profile?.ruolo === 'admin';
  const { list, opById, ritardoSped } = storicoFiltrate();
  const search = (state.stoSearch || '').toLowerCase();
  const filtroMese = state.stoMese || null;
  const filtroAddetto = state.stoAddetto || '';
  const filtroPunt = state.stoPunt || 'all';
  const filtroSfora = state.stoSfora || false;

  // KPI
  const tot = list.length;
  const ritardi = list.map(ritardoSped).filter(r => r !== null);
  const puntuali = ritardi.filter(r => r <= 0).length;
  const inRitardo = ritardi.filter(r => r > 0).length;
  const percPunt = ritardi.length > 0 ? Math.round((puntuali / ritardi.length) * 100) : 0;
  const ritardiPos = ritardi.filter(r => r > 0);
  const ritardoMedio = ritardiPos.length > 0
    ? (ritardiPos.reduce((a,b) => a + b, 0) / ritardiPos.length).toFixed(1)
    : '0';
  const totPezzi = list.reduce((sum, s) => sum + (s.quantita || 0), 0);

  root.innerHTML = '';

  // KPI
  const kpiClass = percPunt >= 90 ? 'kg' : (percPunt >= 70 ? 'ky' : 'kr');
  root.append(el('div', { class:'kpis' },
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Spedizioni'),       el('div', { class:'kv' }, String(tot))),
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Puntualità'),       el('div', { class:'kv '+kpiClass }, percPunt+'%')),
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'In ritardo'),       el('div', { class:'kv kr' }, String(inRitardo))),
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Ritardo medio (gg)'), el('div', { class:'kv' }, ritardoMedio)),
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Pezzi spediti'),     el('div', { class:'kv ka' }, String(totPezzi))),
  ));

  // Filtri mese (chips dei mesi in cui ci sono state spedizioni)
  const mesiDist = new Set();
  (state.spedizioni || []).forEach(s => {
    if (s.data) mesiDist.add(s.data.substring(0, 7));
  });
  const mesiArr = Array.from(mesiDist).sort().reverse();

  if (mesiArr.length > 0) {
    const meseChips = el('div', { class:'chips' });
    meseChips.append(el('div', {
      class: 'chip' + (!filtroMese ? ' act' : ''),
      onclick: () => { state.stoMese = null; renderTab('storico'); }
    }, 'Tutti i mesi'));
    mesiArr.forEach(m => {
      const [y, mese] = m.split('-');
      const meseNomi = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
      meseChips.append(el('div', {
        class: 'chip' + (filtroMese === m ? ' act' : ''),
        onclick: () => { state.stoMese = m; renderTab('storico'); }
      }, meseNomi[parseInt(mese)-1]+' '+y));
    });
    root.append(meseChips);
  }

  // Filtri secondari (chip puntualità)
  const puntChips = el('div', { class:'chips' });
  [
    { id:'all',       label:'Tutte' },
    { id:'puntuali',  label:'Puntuali' },
    { id:'ritardo',   label:'In ritardo' },
  ].forEach(opt => {
    puntChips.append(el('div', {
      class: 'chip' + (filtroPunt === opt.id ? ' act' : ''),
      onclick: () => { state.stoPunt = opt.id; renderTab('storico'); }
    }, opt.label));
  });
  // Toggle: solo commesse che hanno sforato il tempo pagato
  puntChips.append(el('div', {
    class: 'chip' + (filtroSfora ? ' act' : ''),
    style: filtroSfora ? 'border-color:var(--red);color:var(--red);' : '',
    title: 'Mostra solo le commesse il cui consuntivo ha superato il tempo pagato',
    onclick: () => { state.stoSfora = !state.stoSfora; renderTab('storico'); }
  }, '⚠ Sforate pagato'));
  root.append(puntChips);

  // Toolbar con filtro clienti (multi) / addetto + ricerca
  const nEsclusiSto = state.stoClientiEsclusi?.size || 0;
  const btnFiltroCliSto = el('button', {
    class: nEsclusiSto > 0 ? 'btnp' : 'btng',
    title: nEsclusiSto > 0
      ? `Filtro attivo: ${nEsclusiSto} cliente${nEsclusiSto>1?'i':''} nascost${nEsclusiSto>1?'i':'o'}`
      : 'Filtra clienti da mostrare',
    onclick: (e) => openFiltroClientiPopup(e.currentTarget, {
      set: state.stoClientiEsclusi, tab: 'storico', onChange: () => {},
    }),
  }, nEsclusiSto > 0 ? `▼ Filtro clienti (${nEsclusiSto})` : '▼ Filtra clienti');

  // Filtro addetto — pulsante + popup (stile "Filtra clienti"): niente più
  // <select> nativo (illeggibile in dark mode).
  const addettiLista = state.utenti.filter(u => !isKioskRecord(u))
    .sort((a,b)=>a.nome.localeCompare(b.nome)).map(u => ({ id:u.id, nome:u.nome }));
  const nomeAdd = filtroAddetto ? (state.utenti.find(u=>u.id===filtroAddetto)?.nome || 'Addetto') : '';
  const btnAdd = el('button', {
    class: filtroAddetto ? 'btnp' : 'btng',
    onclick: (e) => openFiltroSingoloPopup(e.currentTarget, {
      titolo:'Filtra per addetto', vuotoLabel:'Tutti gli addetti',
      opzioni: addettiLista, valore: filtroAddetto,
      onPick: (id) => { state.stoAddetto = id; renderTab('storico'); },
    }),
  }, filtroAddetto ? '▼ ' + nomeAdd : '▼ Tutti gli addetti');

  // Filtro fornitore — gemello dell'addetto
  const fornitoriLista = state.aziende.filter(a => a.is_fornitore)
    .sort((a,b)=>a.nome.localeCompare(b.nome)).map(a => ({ id:a.id, nome:a.nome }));
  const nomeForn = state.stoFornitore ? (state.aziende.find(a=>a.id===state.stoFornitore)?.nome || 'Fornitore') : '';
  const btnForn = el('button', {
    class: state.stoFornitore ? 'btnp' : 'btng',
    onclick: (e) => openFiltroSingoloPopup(e.currentTarget, {
      titolo:'Filtra per fornitore', vuotoLabel:'Tutti i fornitori',
      opzioni: fornitoriLista, valore: state.stoFornitore,
      onPick: (id) => { state.stoFornitore = id; renderTab('storico'); },
    }),
  }, state.stoFornitore ? '▼ ' + nomeForn : '▼ Tutti i fornitori');

  const toolbar = el('div', { class:'toolbar' },
    el('h2', {}, 'Storico spedizioni'),
    btnFiltroCliSto, btnAdd, btnForn,
    el('input', {
      type:'text', class:'search', id:'sto-search',
      placeholder:'Cerca DDT, ordine, OP, rif. cliente, pos, cliente, codice, descrizione…',
      value: state.stoSearch || '',
      oninput: (e) => { state.stoSearch = e.target.value; state._focusSearch = 'sto-search'; renderTab('storico'); }
    }),
    el('button', { class:'btng', onclick:storicoExportExcel }, '⬇ Esporta'),
  );
  root.append(toolbar);

  if (list.length === 0) {
    root.append(el('div', { class:'empty' },
      (state.spedizioni || []).length === 0
        ? 'Nessuna spedizione registrata. Le spedizioni appaiono qui appena le registri dal Magazzino o dalla modal Operazione.'
        : 'Nessuna spedizione corrisponde ai filtri.'
    ));
    return;
  }

  // Tabella
  const tw = el('div', { class:'tw' });
  const tbl = el('table', { class:'rt op-table' });
  tbl.append(el('thead', {}, el('tr', {},
    el('th', {}, 'Data sped.'),
    el('th', {}, 'Ordine'),
    el('th', {}, 'Pos'),
    el('th', {}, 'OP'),
    el('th', {}, 'Rif. cliente'),
    el('th', {}, 'Cliente'),
    el('th', {}, 'Codice'),
    el('th', { class:'tr' }, 'Qtà'),
    el('th', {}, 'DDT'),
    el('th', {}, 'Destinatario'),
    el('th', {}, 'Note'),
    el('th', {}, 'Scadenza'),
    el('th', { class:'tr' }, 'Ore (cons/pag.)'),
    el('th', { class:'tc' }, 'Esito'),
    el('th', { class:'tc' }, 'Azioni'),
  )));
  const tb = el('tbody');

  list.forEach(s => {
    const op = opById[s.operazione_id];
    const cli = op ? state.aziende.find(c => c.id === op.cliente_id) : null;
    const art = op ? state.articoli.find(a => a.id === op.articolo_id) : null;
    const ritardo = ritardoSped(s);

    let esitoBadge;
    if (ritardo === null) {
      esitoBadge = el('span', { class:'badge bgry' }, '—');
    } else if (ritardo < 0) {
      esitoBadge = el('span', { class:'badge bok' }, 'anticipo '+Math.abs(ritardo)+'gg');
    } else if (ritardo === 0) {
      esitoBadge = el('span', { class:'badge bok' }, 'in tempo');
    } else {
      esitoBadge = el('span', { class:'badge berr' }, '+'+ritardo+' gg');
    }

    tb.append(el('tr', { class:'spedita' },
      // Senza data non si inventa niente: si dichiara che non è registrata.
      // Sono le commesse caricate all'avvio del gestionale, già chiuse allora.
      el('td', { class:'mono', style: s._senzaSpedizione ? 'color:var(--mut);' : '',
        title: s._senzaSpedizione ? 'Spedizione mai registrata: la commessa è stata caricata già chiusa' : '' },
        s.data ? fmtIT(s.data) : 'non registrata'),
      el('td', { class:'mono' }, op?.numero_ordine || '—'),
      el('td', { class:'mono', style:'color:var(--mut);' }, op?.pos || '—'),
      el('td', { class:'mono', style:'color:var(--mut);' }, op?.numero_op || '—'),
      el('td', {
        style:'max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--mut);',
        title: op?.riferimento_cliente || '',
      }, op?.riferimento_cliente || '—'),
      el('td', {}, cli?.nome || '—'),
      el('td', { class:'mono', style:'color:var(--or);' }, art?.codice || '—'),
      // Qtà = totale spedito della commessa. Se le spedizioni sono state più
      // d'una lo si dice, così il numero non sembra quello di un evento solo.
      el('td', { class:'tr mono', style:'font-weight:600;',
        title: s._nSped > 1 ? s._nSped + ' spedizioni parziali: apri la commessa per il dettaglio' : '' },
        String(s.quantita || 0) + (s._nSped > 1 ? ' *' : '')),
      el('td', { class:'mono' }, s.ddt || '—'),
      el('td', {
        style:'max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;',
        title: s.destinatario || '',
      }, s.destinatario || '—'),
      el('td', {
        style:'max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--mut);',
        title: s.note || '',
      }, s.note || '—'),
      el('td', { class:'mono' }, op?.scadenza ? fmtIT(op.scadenza) : '—'),
      (() => {
        const pagatoOre = op ? pagatoOreInterne(op) : 0;
        if (!op || pagatoOre <= 0) return el('td', { class:'tr mono', style:'color:var(--mut);' }, '—');
        const cons = opCalcOreReali(op);
        const sfora = cons > pagatoOre + tolleranzaOre(pagatoOre);
        // Segnalo quando il pagato è ridotto perché una o più fasi sono esterne.
        const haEsterne = (state.opFornitori || []).some(r => r.operazione_id === op.id);
        return el('td', {
          class:'tr mono',
          style: sfora ? 'color:var(--red);font-weight:700;' : 'color:var(--mut);',
          title: haEsterne ? 'Pagato sulla sola parte interna (fasi a terzisti escluse)' : '',
        }, cons.toFixed(1) + '/' + pagatoOre.toFixed(1) + (sfora ? ' ⚠' : '') + (haEsterne ? ' ·int' : ''));
      })(),
      el('td', { class:'tc' }, esitoBadge),
      el('td', { class:'tc' },
        el('button', { class:'btnsm',
          onclick: () => { if (op) openOperazioneModal(op); else toast('Operazione non trovata', 'err'); },
        }, 'Apri'),
      ),
    ));
  });
  tbl.append(tb);
  tw.append(tbl);
  root.append(tw);
}

// Apri il quick-dialog di consegna da Pianificazione
// Cambio stato rapido per le azioni reversibili (aperta ↔ sospesa, riapri da spedita).
// Click secco senza conferma: la commessa non viene "distrutta", il cambio è
// sempre annullabile cliccando di nuovo. Per la consegna definitiva resta
// quickSpedizione() che chiede conferma e data, perché è un passaggio chiave.
// I fatti che mancano perché uno stato sia vero (27 ago). Sta QUI e non
// dentro `quickStato` perché lo stato si cambia da DUE porte — la tendina
// nella lista e il modal — e finché il controllo stava su una sola, dall'altra
// si poteva dichiarare "spedita" una commessa senza che risultasse spedito
// niente. È la stessa trappola dei timbri chiusi da due strade diverse.
//
// Ritorna { ok, lotto, spedizione }. `ok:false` = l'utente ha rinunciato.
// Non scrive niente: costruisce le righe e le lascia scrivere a chi chiama,
// che deve farlo PRIMA di cambiare stato — se fallisce, meglio nessuno dei due.
function fattiPerStato(op, nuovoStato) {
  const qtaOrd = Number(op.quantita || 0);
  const prodotto = (typeof quantitaConsegnata === 'function') ? quantitaConsegnata(op.id) : 0;
  const spedito = (typeof quantitaSpedita === 'function') ? quantitaSpedita(op.id) : 0;
  const residuo = Math.max(0, qtaOrd - prodotto);
  const daSpedire = Math.max(0, qtaOrd - spedito);
  const oggi = toLocalISO(new Date());
  const chiOra = state.profile?.id || null;
  const vuoto = { ok: true, lotto: null, spedizione: null };
  if (!qtaOrd) return vuoto;

  // ⚠ I fatti si creano solo quando lo stato AVANZA. Tornando indietro —
  // riaprire una spedita, riportarla a completata — non si deve inventare
  // niente: sulle 34 caricate a maggio, che risultano spedite con zero
  // produzione registrata, passarle a "completata" avrebbe proposto di
  // registrare un lotto pari all'intero ordine. Sarebbe stato inventare
  // produzione mai avvenuta per far quadrare una marcia indietro.
  const RANGO = { aperta: 0, sospesa: 0, completata: 1, spedita: 2 };
  if ((RANGO[nuovoStato] || 0) <= (RANGO[op.stato] || 0)) return vuoto;

  if (nuovoStato === 'completata' && residuo > 0) {
    const ok = confirm(
      `Questa commessa ha ancora ${residuo} pz da produrre (${prodotto}/${qtaOrd} pz).\n\n`
      + `Completandola verrà registrato in automatico un lotto di produzione di ${residuo} pz `
      + `(data odierna) per chiudere la commessa.\n\n`
      + `Vuoi procedere?`);
    if (!ok) return { ok: false };
    return { ok: true, spedizione: null, lotto: {
      operazione_id: op.id, data: oggi, quantita: residuo, ddt: null,
      nota: 'Chiusura automatica commessa', creato_da: chiOra } };
  }

  if (nuovoStato === 'spedita' && daSpedire > 0) {
    // Per spedire bisogna aver prodotto: se manca anche quello si registrano
    // tutti e due, e si dicono tutti e due nello stesso avviso — o uno dei
    // due succederebbe senza che nessuno l'abbia letto.
    const ok = confirm(
      `Di questa commessa risultano spediti ${spedito}/${qtaOrd} pz: ne mancano ${daSpedire}.\n\n`
      + (residuo > 0
          ? `Marcandola spedita verranno registrati in automatico, con data odierna:\n`
            + `· un lotto di produzione di ${residuo} pz\n`
            + `· una spedizione di ${daSpedire} pz (senza DDT)\n\n`
          : `Marcandola spedita verrà registrata in automatico una spedizione di `
            + `${daSpedire} pz in data odierna, senza DDT.\n\n`)
      + `Vuoi procedere?`);
    if (!ok) return { ok: false };
    return { ok: true,
      lotto: residuo > 0 ? {
        operazione_id: op.id, data: oggi, quantita: residuo, ddt: null,
        nota: 'Chiusura automatica commessa', creato_da: chiOra } : null,
      spedizione: {
        operazione_id: op.id, data: oggi, quantita: daSpedire, ddt: null,
        destinatario: null, note: 'Spedizione registrata alla chiusura della commessa',
        creato_da: chiOra } };
  }
  return vuoto;
}

// Scrive i fatti costruiti da `fattiPerStato`. Sempre PRIMA del cambio stato.
async function scriviFattiPerStato(op, fatti) {
  if (fatti.lotto) {
    const residuoOra = Math.max(0, Number(op.quantita || 0) - quantitaConsegnata(op.id));
    if (residuoOra > 0) {
      fatti.lotto.quantita = residuoOra;   // qualcun altro può aver prodotto nel frattempo
      const { data, error } = await eseguiConRetry(
        () => sb.from('consegne_commessa').insert(fatti.lotto).select().single(),
        { label: 'lotto chiusura commessa' });
      if (error) throw error;
      if (!state.consegneCommessa.find(x => x.id === data.id)) state.consegneCommessa.push(data);
    } else fatti.lotto = null;
  }
  if (fatti.spedizione) {
    const daSpedireOra = Math.max(0, Number(op.quantita || 0) - quantitaSpedita(op.id));
    if (daSpedireOra > 0) {
      fatti.spedizione.quantita = daSpedireOra;
      const { data, error } = await eseguiConRetry(
        () => sb.from('spedizioni').insert(fatti.spedizione).select().single(),
        { label: 'spedizione chiusura commessa' });
      if (error) throw error;
      if (!state.spedizioni.find(x => x.id === data.id)) state.spedizioni.push(data);
    } else fatti.spedizione = null;
  }
  return fatti;
}

async function quickStato(op, nuovoStato) {
  if (!['aperta','sospesa','completata','spedita'].includes(nuovoStato)) return;

  const qtaOrd = Number(op.quantita || 0);
  const prodotto = (typeof quantitaConsegnata === 'function') ? quantitaConsegnata(op.id) : 0;
  const residuo = Math.max(0, qtaOrd - prodotto);

  // ── Regola: tornare/lasciare "aperta" o "sospesa" con tutto già prodotto è
  // uno stato incoerente. Se tutto è prodotto, la commessa non può restare
  // aperta → propongo di completarla. ──
  if ((nuovoStato === 'aperta' || nuovoStato === 'sospesa') && qtaOrd > 0 && residuo === 0) {
    const ok = confirm(
      `Tutto il materiale di questa commessa è già stato prodotto (${prodotto}/${qtaOrd} pz).\n\n`
      + `Una commessa interamente prodotta non può restare ${nuovoStato === 'aperta' ? 'aperta' : 'sospesa'}.\n\n`
      + `Vuoi marcarla come COMPLETATA?`
    );
    if (ok) { return quickStato(op, 'completata'); }
    // L'utente rifiuta: annullo il cambio, ripristino la UI sullo stato attuale.
    renderTab(state.currentTab || 'pianificazione');
    return;
  }

  // ── I fatti che uno stato richiede per essere vero: chiesti e costruiti
  // dal pezzo comune, così la tendina e il modal si comportano uguale. ──
  const fatti = fattiPerStato(op, nuovoStato);
  if (!fatti.ok) { renderTab(state.currentTab || 'pianificazione'); return; }

  try {
    // 1) I fatti si scrivono PRIMA dello stato: se falliscono, non voglio una
    //    commessa dichiarata chiusa senza le righe che lo dimostrano.
    await scriviFattiPerStato(op, fatti);

    // 2) Aggiorno lo stato
    const { data, error } = await eseguiConRetry(
      () => sb.from('operazioni').update({ stato: nuovoStato }).eq('id', op.id).select().single(),
      { label: 'cambia stato op' }
    );
    if (error) throw error;
    Object.assign(op, data); // aggiorno l'oggetto in state in place

    // Il messaggio dice cosa è stato SCRITTO, non solo che è andata: se il
    // gestionale ha registrato una produzione o una spedizione al posto tuo,
    // devi vederlo — altrimenti quei pezzi compaiono nei conti dal nulla.
    const scritti = [];
    if (fatti.lotto) scritti.push('prodotti ' + fatti.lotto.quantita + ' pz');
    if (fatti.spedizione) scritti.push('spediti ' + fatti.spedizione.quantita + ' pz');
    if (scritti.length) {
      toast(scritti.join(' e ') + ' · commessa '
        + (OP_STATI[nuovoStato]?.label || nuovoStato).toLowerCase(), 'ok');
    } else {
      toast('Stato aggiornato: ' + (OP_STATI[nuovoStato]?.label || nuovoStato), 'ok');
    }
    renderTab(state.currentTab || 'pianificazione');
  } catch (e) {
    toast('Errore: ' + (e.message||e), 'err');
    renderTab(state.currentTab || 'pianificazione');
  }
}

// Modal rapida di registrazione spedizione, chiamata da Magazzino, Pianificazione
// (bottone ✓ e dropdown stato → 'spedita'). Crea una riga nella tabella
// `spedizioni`. Se la somma spedita raggiunge il totale ordinato, aggiorna
// anche operazioni.stato = 'spedita' (sincronizzazione automatica) e copia
// `consegnato_il = data` per compatibilità con lo Storico.
// Il nome "quickSpedizione" è mantenuto come alias per non rompere i call site.
// Ripara lo stato di una commessa spedita per intero nei fatti ma rimasta
// in uno stato diverso da 'spedita' (così va in Storico). consegnato_il:
// data dell'ultima spedizione registrata, oppure quella già presente, oppure oggi.
async function quickFixStatoSpedita(o) {
  const spedizioniOp = (state.spedizioni || [])
    .filter(s => s.operazione_id === o.id && s.data)
    .sort((a, b) => (a.data < b.data ? 1 : -1));
  const dataCons = o.consegnato_il || spedizioniOp[0]?.data || toLocalISO(new Date());
  const { data: opAgg, error } = await sb.from('operazioni').update({
    stato: 'spedita',
    consegnato_il: dataCons,
  }).eq('id', o.id).select().single();
  if (error) return toast('Errore aggiornamento stato: ' + error.message, 'err');
  state.operazioni = state.operazioni.map(x => x.id === o.id ? opAgg : x);
  toast('Commessa marcata SPEDITA · ora è nello Storico', 'ok');
  renderTab(state.currentTab);
}

function quickRegistraSpedizione(o) {
  const oggi = toLocalISO(new Date());
  const ritardo = o.scadenza && o.scadenza < oggi;
  const cli = state.aziende.find(c => c.id === o.cliente_id);
  const art = state.articoli.find(a => a.id === o.articolo_id);

  const qtaOrd = Number(o.quantita || 0);
  const totSped = quantitaSpedita(o.id);
  const prodotti = quantitaConsegnata(o.id);
  const pronti = Math.max(0, prodotti - totSped);
  const daSpedire = Math.max(0, qtaOrd - totSped);

  // Caso limite: niente in magazzino → niente da spedire
  if (pronti <= 0) {
    if (daSpedire <= 0) {
      // Spedita per intero NEI FATTI ma con stato non allineato (es. rimasta
      // 'completata' per spedizioni storiche pre-sincronizzazione): qui non
      // c'è nulla da spedire, ma lo stato va riparato, altrimenti la commessa
      // resta in Pianificazione invece di andare in Storico.
      if (o.stato !== 'spedita') {
        const ok = confirm(
          'Questa commessa risulta già spedita per intero (' + totSped + '/' + qtaOrd + ' pz), '
          + 'ma il suo stato è ancora "' + (OP_STATI[o.stato]?.label || o.stato) + '".\n\n'
          + 'Vuoi marcarla come SPEDITA così va in Storico?');
        if (ok) quickFixStatoSpedita(o);
      } else {
        toast('Questa commessa è già stata spedita per intero.', 'err');
      }
    } else {
      toast('Nulla in magazzino da spedire. Registra prima la produzione.', 'err');
    }
    return;
  }

  const modal = el('div', { class:'modal' });
  modal.append(el('div', { class:'mhd' },
    el('h2', {}, 'Registra spedizione'),
    el('button', { class:'mclose', onclick:closeModal }, '✕'),
  ));
  const body = el('div', { class:'mbody' });

  // Box info commessa
  body.append(el('div', { class:'sub', style:'margin-bottom:14px;padding:10px;background:var(--sur2);border-radius:4px;font-family:monospace;font-size:11px;line-height:1.6;' },
    el('div', {}, 'Ordine: ', el('span', { style:'color:var(--or)' }, o.numero_ordine || '—'),
      o.numero_op ? ' · OP: ' + o.numero_op : ''),
    el('div', {}, (cli?.nome || '—') + ' · ' + (art?.codice || '—')),
    el('div', {},
      'Ordinati: ' + qtaOrd + ' pz · ',
      el('span', { style:'color:'+(pronti>0?'var(--blu)':'var(--mut)') }, 'pronti in magazzino: ' + pronti + ' pz'),
      ' · ',
      'già spediti: ' + totSped + ' pz',
    ),
    el('div', {}, 'Scadenza: ', el('span', { style:'color:'+(ritardo?'var(--red)':'var(--txt)') }, o.scadenza ? fmtIT(o.scadenza) : '—')),
  ));

  // Form
  const form = el('form');
  const inData = el('input', { type:'date', name:'data', value:oggi, required:'true' });
  // Quantità precompilata al massimo possibile (pronti in magazzino)
  const inQta = el('input', {
    type:'number', name:'quantita',
    min:'1', max:String(pronti), value:String(pronti), required:'true',
  });
  const inDDT = el('input', { type:'text', name:'ddt', placeholder:'numero DDT al cliente (opzionale)' });
  const inDest = el('input', { type:'text', name:'destinatario', placeholder:'destinatario / luogo (opzionale)' });
  const inNote = el('textarea', { name:'note', rows:'2', placeholder:'note (opzionale)' });

  form.append(
    el('div', { class:'frow' },
      el('div', { class:'field' }, el('label', {}, 'Data *'), inData),
      el('div', { class:'field' }, el('label', {}, 'Quantità * (max ' + pronti + ')'), inQta),
    ),
    el('div', { class:'field' }, el('label', {}, 'DDT'), inDDT),
    el('div', { class:'field' }, el('label', {}, 'Destinatario'), inDest),
    el('div', { class:'field' }, el('label', {}, 'Note'), inNote),
  );

  // Avviso se questa spedizione NON completerà la commessa
  const previewSpedTot = totSped + pronti;
  if (previewSpedTot < qtaOrd) {
    body.append(el('div', { style:'color:var(--yel);font-size:11px;padding:6px 0 10px;font-style:italic;' },
      'Dopo questa spedizione resteranno ' + (qtaOrd - previewSpedTot) + ' pz ancora da produrre/spedire.'));
  }

  body.append(form);
  modal.append(body);

  const foot = el('div', { class:'mfoot' });
  foot.append(el('button', { class:'btng', onclick:closeModal }, 'Annulla'));
  const btnOk = el('button', { class:'btnp' }, '✓ Registra spedizione');
  btnOk.onclick = async () => {
    const fd = new FormData(form);
    const data = fd.get('data');
    const qta = parseInt(fd.get('quantita'), 10);
    if (!data) return toast('Data obbligatoria', 'err');
    if (!Number.isFinite(qta) || qta <= 0) return toast('Quantità deve essere > 0', 'err');

    // Validazione doppia ricalcolata al submit (sicurezza vs race condition)
    const totSpedNow = quantitaSpedita(o.id);
    const daSpedireNow = qtaOrd - totSpedNow;
    if (qta > daSpedireNow) {
      return toast(`Da spedire: ${daSpedireNow} pz. Non puoi spedire ${qta} pz.`, 'err');
    }
    const prontiNow = Math.max(0, quantitaConsegnata(o.id) - totSpedNow);
    if (qta > prontiNow) {
      return toast(`In magazzino: ${prontiNow} pz pronti. Prima registra la produzione mancante.`, 'err');
    }

    btnOk.disabled = true; btnOk.textContent = 'Salvataggio…';
    try {
      // 1) Inserisco la spedizione
      const { data: nuovaSped, error: errSped } = await sb.from('spedizioni').insert({
        operazione_id: o.id,
        data,
        quantita: qta,
        ddt: (fd.get('ddt')||'').trim() || null,
        destinatario: (fd.get('destinatario')||'').trim() || null,
        note: (fd.get('note')||'').trim() || null,
        creato_da: state.profile?.id || null,
      }).select().single();
      if (errSped) {
        btnOk.disabled = false; btnOk.textContent = '✓ Registra spedizione';
        return toast(errSped.message, 'err');
      }
      // Aggiorno cache locale (oltre al realtime)
      if (!state.spedizioni.find(x => x.id === nuovaSped.id)) state.spedizioni.push(nuovaSped);

      // 2) Sincronizzazione automatica stato commessa.
      // Se la nuova somma spedita raggiunge o supera il totale ordinato,
      // marca la commessa come 'spedita' e popola consegnato_il = data
      // (per compatibilità con lo Storico esistente).
      const sommaTotSped = quantitaSpedita(o.id);
      if (sommaTotSped >= qtaOrd && o.stato !== 'spedita') {
        const { data: opAgg, error: errOp } = await sb.from('operazioni').update({
          stato: 'spedita',
          consegnato_il: data,
        }).eq('id', o.id).select().single();
        if (errOp) {
          // La spedizione è stata salvata, ma lo stato no — segnalo ma non blocco
          toast('Spedizione salvata, ma errore aggiornamento stato: '+errOp.message, 'err');
        } else {
          state.operazioni = state.operazioni.map(x => x.id === o.id ? opAgg : x);
        }
        toast('Spedizione registrata · commessa marcata SPEDITA');
      } else {
        toast('Spedizione registrata');
      }
      closeModal(); renderTab(state.currentTab);
    } catch (e) {
      btnOk.disabled = false; btnOk.textContent = '✓ Registra spedizione';
      toast('Errore: '+(e.message||e), 'err');
    }
  };
  foot.append(btnOk);
  modal.append(foot);
  openModal(modal);
}

// Alias compatibilità: tutti i call site esistenti continuano a funzionare.
const quickSpedizione = quickRegistraSpedizione;

// Export storico in Excel
function storicoExportExcel() {
  if (typeof XLSX === 'undefined') {
    toast('Libreria Excel non caricata', 'err');
    return;
  }
  // Si esporta QUELLO CHE SI VEDE (7 ago, richiesta Nico): stessa funzione che
  // riempie la tabella. Prima portava via sempre tutto l'archivio, e chi aveva
  // filtrato per mese o cliente se ne accorgeva solo aprendo il file.
  const { list: spedizioni, opById, filtriAttivi } = storicoFiltrate();
  if (spedizioni.length === 0) return toast('Nessuna spedizione da esportare con questi filtri', 'err');

  const rows = spedizioni.map(s => {
    const op = opById[s.operazione_id];
    const cli = op ? state.aziende.find(c => c.id === op.cliente_id) : null;
    const art = op ? state.articoli.find(a => a.id === op.articolo_id) : null;
    const addettiNomi = op
      ? getOperazioneAddetti(op.id)
          .map(id => state.utenti.find(u => u.id === id)?.nome)
          .filter(Boolean)
      : [];
    const ritardo = (op && op.scadenza && s.data)
      ? Math.round((parseISODate(s.data) - parseISODate(op.scadenza)) / 86400000)
      : null;
    // Ore: le stesse della colonna "Ore (cons/pag.)" a schermo, ma in colonne
    // SEPARATE e come numeri veri (7 ago, chieste da Cocco). A schermo stanno
    // insieme perché è una cella sola; in Excel servono divise, o non ci si può
    // sommare né filtrare sopra.
    const pagatoOre = op ? pagatoOreInterne(op) : 0;
    const cons = op ? opCalcOreReali(op) : 0;
    const haOre = !!op && pagatoOre > 0;
    // Il pagato scende alla sola parte interna quando ci sono fasi a terzisti:
    // senza dirlo, uno legge un pagato più basso e non sa perché.
    const soloInterno = !!op && (state.opFornitori || []).some(r => r.operazione_id === op.id);
    return {
      'Data spedizione': s.data || '',
      'Ordine':          op?.numero_ordine || '',
      'OP':              op?.numero_op || '',
      'POS':             op?.pos || '',
      'Cliente':         cli?.nome || '',
      'Codice articolo': art?.codice || '',
      'Descrizione':     art?.descrizione || '',
      'Quantità':        s.quantita || 0,
      'DDT':             s.ddt || '',
      'Scadenza':        op?.scadenza || '',
      'Ritardo (gg)':    ritardo,
      'Esito':           ritardo === null ? '—' : (ritardo <= 0 ? 'In tempo' : 'In ritardo'),
      'Ore consuntivate': haOre ? +cons.toFixed(2) : '',
      'Ore pagate':       haOre ? +pagatoOre.toFixed(2) : '',
      'Sforo (h)':        haOre ? +(cons - pagatoOre).toFixed(2) : '',
      'Pagato solo interno': (haOre && soloInterno) ? 'sì' : '',
      'Addetti':         addettiNomi.join(', '),
      'Riferimento cliente': op?.riferimento_cliente || '',
    };
  });
  rows.sort((a, b) => (b['Data spedizione']||'').localeCompare(a['Data spedizione']||''));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    {wch:14},{wch:16},{wch:16},{wch:8},{wch:24},{wch:18},{wch:30},{wch:8},
    {wch:14},{wch:12},{wch:10},{wch:12},
    {wch:16},{wch:12},{wch:10},{wch:18},
    {wch:24},{wch:20},
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Spedizioni');
  XLSX.writeFile(wb, 'storico_spedizioni_'+new Date().toISOString().substring(0,10)+'.xlsx');
  // Dire quante righe e con quali filtri: senza, un file corto sembra un errore.
  toast('Esportate ' + rows.length + (rows.length === 1 ? ' spedizione' : ' spedizioni')
    + (filtriAttivi.length ? ' · filtri: ' + filtriAttivi.join(', ') : ' · nessun filtro'), 'ok');
}


async function deleteOperatore(u) {
  // Verifico se è usato in qualche prenotazione (dalla cache, no fetch)
  const count = state.prenOp.filter(r => r.utente_id === u.id).length;
  if (count > 0) return toast(`Impossibile: ${u.nome} è associato a ${count} prenotazioni`, 'err');
  if (!confirm(`Eliminare l'operatore "${u.nome}"?`)) return;
  const { error } = await sb.from('utenti').delete().eq('id', u.id);
  if (error) return toast(error.message, 'err');
  // Aggiorna subito la cache locale
  state.utenti = state.utenti.filter(x => x.id !== u.id);
  delete state.utentiById[u.id];
  toast('Utente eliminato'); renderTab('operatori');
}

async function toggleRuolo(u) {
  const nuovo = u.ruolo === 'admin' ? 'user' : 'admin';
  const { error } = await sb.from('profili').update({ ruolo: nuovo }).eq('id', u.id);
  if (error) return toast(error.message, 'err');
  // Aggiorna cache locale
  if (state.profiliById[u.id]) state.profiliById[u.id].ruolo = nuovo;
  toast(`${u.nome || u.email} → ${nuovo}`);
  renderTab('operatori');
}

function openModal(content, opts) {
  closeModal();
  // I modal si chiudono solo dal tasto Chiudi/✕ (e da Esc, vedi sotto).
  // Niente "click fuori = chiudi": un click sbagliato durante la compilazione
  // di un modal lungo (es. Nuova Operazione) costava troppo.
  // opts.side = true → variante pannello laterale (overlay scuro + contenuto a destra).
  const bgClass = opts && opts.side ? 'modal-bg side' : 'modal-bg';
  const bg = el('div', { class: bgClass });
  bg.append(content);
  $('#modal-root').append(bg);
}
function closeModal() { $('#modal-root').innerHTML = ''; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

function openMezzoModal(m) {
  const isNew = !m;
  m = m || { nome:'', targa:'', tipo:'', colore:'#4eb8ff', attivo:true };
  const modal = el('div', { class:'modal' });
  modal.append(el('div', { class:'mhd' },
    el('h2', {}, isNew ? 'Nuovo Mezzo' : 'Modifica Mezzo'),
    el('button', { class:'mclose', onclick:closeModal }, '✕'),
  ));
  const body = el('div', { class:'mbody' });
  const form = el('form');
  form.append(
    el('div', { class:'field' }, el('label', {}, 'Nome'),
      el('input', { type:'text', name:'nome', required:'true', value:m.nome })),
    el('div', { class:'frow' },
      el('div', { class:'field' }, el('label', {}, 'Targa'),
        el('input', { type:'text', name:'targa', value:m.targa||'' })),
      el('div', { class:'field' }, el('label', {}, 'Tipo'),
        el('input', { type:'text', name:'tipo', value:m.tipo||'', placeholder:'Furgone, Auto, Camion…' })),
    ),
    el('div', { class:'frow' },
      el('div', { class:'field' }, el('label', {}, 'Colore'),
        el('input', { type:'color', name:'colore', value:m.colore||'#4eb8ff' })),
      el('div', { class:'field' }, el('label', {}, 'Stato'), (() => {
        const s = el('select', { name:'attivo' },
          el('option', { value:'true' }, 'Attivo'),
          el('option', { value:'false' }, 'Disattivato'));
        s.value = String(!!m.attivo); return s;
      })()),
    ),
  );
  body.append(form);
  modal.append(body);
  modal.append(el('div', { class:'mfoot' },
    el('button', { class:'btng', onclick:closeModal }, 'Annulla'),
    el('button', { class:'btnp', onclick: async () => {
      const fd = new FormData(form);
      const payload = {
        nome: fd.get('nome'), targa: fd.get('targa') || null,
        tipo: fd.get('tipo') || null, colore: fd.get('colore'),
        attivo: fd.get('attivo') === 'true',
      };
      if (!payload.nome) return toast('Nome obbligatorio', 'err');
      const { data, error } = await eseguiConRetry(
        () => isNew ? sb.from('mezzi').insert(payload).select().single() : sb.from('mezzi').update(payload).eq('id', m.id).select().single(),
        { label: 'salvataggio mezzi' }
      );
      if (error) return toast(error.message, 'err');
      // Aggiorna cache locale
      if (isNew) state.mezzi.push(data);
      else state.mezzi = state.mezzi.map(x => x.id === m.id ? data : x);
      toast(isNew ? 'Mezzo creato' : 'Mezzo aggiornato');
      closeModal(); renderTab('mezzi');
    }}, 'Salva'),
  ));
  openModal(modal);
}

async function openPrenotazioneModal(p, opts = {}) {
  const isNew = !p?.id;
  p = p || {};
  const isDup = isNew && !!opts.dup;   // nuova, ma pre-compilata da un'altra
  const today = toLocalISO(new Date());
  const mezziAttivi = state.mezzi.filter(x=>x.attivo);
  if (mezziAttivi.length === 0) return toast('Nessun mezzo attivo. Chiedi a un admin di aggiungerne uno.', 'err');
  if (state.utenti.filter(u=>u.attivo).length === 0)
    return toast('Nessun utente configurato. Chiedi a un admin di aggiungerne almeno uno.', 'err');

  let consegne = [];
  let utentiSel = [];  // ID degli operatori associati
  if (!isNew) {
    // Copio dalle consegne in cache (clone per non mutare la sorgente prima del salvataggio)
    consegne = state.consegne.filter(c => c.prenotazione_id === p.id)
      .sort((a,b) => (a.ordine||0) - (b.ordine||0))
      .map(c => ({ ...c }));
    utentiSel = loadPrenotazioneOperatori(p.id);
  } else if (isDup) {
    // Duplica: consegne e operatori arrivano dall'evento sorgente (clonati,
    // senza id/prenotazione_id: sono righe nuove da inserire).
    consegne = (opts.dup.consegne || []).map(c => ({
      cliente_id: c.cliente_id, descrizione: c.descrizione, ordine: c.ordine, _new: true }));
    utentiSel = (opts.dup.utenti || []).slice();
  } else {
    // Se sto creando: pre-seleziono l'operatore collegato all'account corrente (se c'è)
    const mioUtil = state.utenti.find(u => u.account_id === state.profile.id);
    if (mioUtil) utentiSel = [mioUtil.id];
  }
  const canEdit = isNew || p.utente_id === state.profile.id || state.profile.ruolo === 'admin';

  const modal = el('div', { class:'modal' });
  modal.append(el('div', { class:'mhd' },
    el('h2', {}, isDup ? 'Nuova Prenotazione (duplicata)'
      : (isNew ? 'Nuova Prenotazione' : (canEdit ? 'Modifica Prenotazione' : 'Prenotazione'))),
    el('button', { class:'mclose', onclick:closeModal }, '✕'),
  ));

  const body = el('div', { class:'mbody' });
  const form = el('form');

  const selMezzo = el('select', { name:'mezzo_id', required:'true' },
    ...mezziAttivi.map(m => el('option', { value:m.id }, `${m.nome}${m.targa ? ' · '+m.targa : ''}`)));
  if (p.mezzo_id) selMezzo.value = p.mezzo_id;
  const selTipo = el('select', { name:'tipo', required:'true' },
    ...TIPI.map(t => el('option', { value:t.id }, t.label)));
  selTipo.value = p.tipo || 'trasferta';

  form.append(
    el('div', { class:'frow' },
      el('div', { class:'field' }, el('label', {}, 'Mezzo'), selMezzo),
      el('div', { class:'field' }, el('label', {}, 'Tipo'), selTipo),
    ),
  );

  // Multi-select operatori (obbligatorio) — dropdown searchable
  const utentiAttivi = state.utenti.filter(u => u.attivo && !isKioskRecord(u));

  // UN SOLO campo (richiesta Nico, 5 ago): le pillole degli operatori scelti e
  // la casella di ricerca stanno nello STESSO riquadro, non in due box impilati.
  // La lista scende sotto tutto il campo.
  const searchInput = el('input', {
    type:'text', class:'util-search', autocomplete:'off',
  });
  const dropList = el('div', { class:'util-droplist' });
  const campoUtenti = el('div', { class:'util-field' }, searchInput, dropList);
  // Cliccando lo spazio vuoto del riquadro si scrive nella casella: il campo si
  // comporta come un campo solo, che è il punto di averlo unito.
  campoUtenti.addEventListener('mousedown', (e) => {
    if (e.target === campoUtenti) { e.preventDefault(); searchInput.focus(); }
  });

  // Focus apre la lista, blur la chiude (con piccolo delay per gestire click sulla lista)
  searchInput.onfocus = () => { dropList.classList.add('open'); renderDropList(); };
  searchInput.onblur = () => { setTimeout(() => dropList.classList.remove('open'), 180); };

  const renderSelected = () => {
    // Si tolgono solo le pillole: la casella e la lista vivono nello stesso
    // riquadro e devono restare dove sono (svuotarlo le distruggerebbe).
    campoUtenti.querySelectorAll('.util-pill').forEach(x => x.remove());
    // utentiSel è già aggiornato quando si arriva qui: l'avviso assenze segue
    // ogni aggiunta o rimozione di operatore.
    aggiornaAvvisoAssenze();
    // Il posto vuoto lo dichiara il placeholder, non una scritta in più.
    searchInput.placeholder = utentiSel.length === 0
      ? 'Clicca qui e scegli chi userà il mezzo…'
      : 'aggiungi…';
    utentiSel.forEach(uid => {
      const u = state.utentiById[uid];
      if (!u) return;
      campoUtenti.insertBefore(el('span', { class:'util-pill' },
        el('span', {}, u.nome),
        canEdit ? el('button', {
          type:'button', class:'util-pill-x',
          onclick: () => {
            utentiSel = utentiSel.filter(x => x !== uid);
            renderSelected(); renderDropList();
          },
        }, '✕') : null,
      ), searchInput);
    });
  };

  const renderDropList = () => {
    const q = searchInput.value.trim().toLowerCase();
    const filtered = utentiAttivi.filter(u => {
      if (!q) return true;
      return (u.nome || '').toLowerCase().includes(q);
    });
    dropList.innerHTML = '';
    if (filtered.length === 0) {
      dropList.append(el('div', { class:'util-noresult' }, 'Nessun utente trovato'));
      return;
    }
    filtered.forEach(u => {
      const isSel = utentiSel.includes(u.id);
      dropList.append(el('div', {
        class: 'util-row' + (isSel ? ' selected' : ''),
        onclick: () => {
          if (!canEdit) return;
          if (isSel) utentiSel = utentiSel.filter(x => x !== u.id);
          else utentiSel.push(u.id);
          renderSelected(); renderDropList();
        },
      },
        el('span', { class:'util-row-chk' }, isSel ? '✓' : ''),
        el('span', { class:'util-row-name' }, u.nome),
      ));
    });
  };

  searchInput.oninput = renderDropList;
  // ── Avviso assenze ───────────────────────────────────────────────────
  // Chi prenota lo fa spesso PER UN ALTRO e non ha davanti il calendario
  // ferie. Avvisa e basta: non blocca (decisione Nico, 5 ago).
  const avvisoAss = el('div');
  // Un testo solo per il riquadro e per la conferma al salvataggio: se fossero
  // due, alla prima modifica direbbero due cose diverse.
  const testoAssenze = (righe) => righe.map(r => {
    const u = state.utentiById[r.utenteId];
    const tipi = [...new Set(r.giorni.map(x => x.tipo))].join(', ');
    const giorni = r.giorni.map(x => fmtIT(x.data)
      + (x.intera ? '' : ' (' + x.ore.toFixed(1).replace('.', ',') + ' h)')).join(', ');
    return (u?.nome || 'Operatore') + ' · ' + tipi + ' — ' + giorni;
  });
  const aggiornaAvvisoAssenze = () => {
    avvisoAss.innerHTML = '';
    const inizio = form.querySelector('[name=data_inizio]');
    const fine = form.querySelector('[name=data_fine]');
    // Alla prima passata i campi data non esistono ancora: si ridisegna dopo.
    if (!inizio || !inizio.value) return;
    const righe = assenzeInPrenotazione(utentiSel, inizio.value, fine?.value || inizio.value);
    if (!righe.length) return;
    const parziali = righe.some(r => r.nParziali > 0);
    avvisoAss.append(
      el('div', { style:'margin-top:8px;background:var(--sur2);border:1px solid var(--yel);border-radius:6px;padding:8px 10px;' },
        el('div', { style:'font-weight:700;color:var(--yel);margin-bottom:4px;' },
          '⚠ ' + (righe.length === 1 ? 'Un operatore è assente' : righe.length + ' operatori sono assenti')
          + ' in questo periodo'),
        ...testoAssenze(righe).map(t => el('div', { class:'sub', style:'font-size:11px;' }, t)),
        ...(parziali ? [el('div', { class:'sub', style:'font-size:11px;margin-top:4px;' },
          'Dove sono indicate le ore è un permesso parziale: non impedisce per forza la trasferta.')] : []),
        el('div', { class:'sub', style:'font-size:11px;margin-top:4px;' },
          'La prenotazione si salva lo stesso: decidi tu.')));
  };

  renderSelected();
  // Non chiamare renderDropList() qui: la lista appare solo al focus

  form.append(
    el('div', { class:'field' },
      el('label', {}, 'Chi userà il mezzo *'),
      campoUtenti,
      el('div', { class:'sub', style:'margin-top:4px;' }, 'Almeno un operatore.'),
      avvisoAss,
    ),
  );

  const inDataInizio = el('input', { type:'date', name:'data_inizio', required:'true', value:p.data_inizio||today, onchange: () => aggiornaAvvisoAssenze() });
  const inDataFine = el('input', { type:'date', name:'data_fine', required:'true', value:p.data_fine||p.data_inizio||today, onchange: () => aggiornaAvvisoAssenze() });
  form.append(
    el('div', { class:'frow' },
      el('div', { class:'field' }, el('label', {}, 'Data inizio'), inDataInizio),
      el('div', { class:'field' }, el('label', {}, 'Data fine'), inDataFine),
    ),
    el('div', { class:'frow' },
      el('div', { class:'field' }, el('label', {}, 'Ora inizio *'),
        el('input', { type:'time', name:'ora_inizio', required:'true', value:p.ora_inizio||'08:00' })),
      el('div', { class:'field' }, el('label', {}, 'Ora fine *'),
        el('input', { type:'time', name:'ora_fine', required:'true', value:p.ora_fine||'18:00' })),
    ),
    el('div', { class:'field' }, el('label', {}, 'Note (opz.)'),
      el('textarea', { name:'note', rows:'2' }, p.note||'')),
  );
  // Ora i campi data esistono: alla prima passata l'avviso era uscito a vuoto.
  aggiornaAvvisoAssenze();

  const listaWrap = el('div', { class:'consegne-list' });
  const renderConsegne = () => {
    listaWrap.innerHTML = '';
    if (consegne.length === 0) {
      listaWrap.append(el('div', { class:'sub' }, 'Nessuna consegna: aggiungine almeno una con cliente.'));
    }
    consegne.forEach((c, i) => {
      // Indirizzo dedotto dal cliente
      const cli = c.cliente_id ? state.aziende.find(x => x.id === c.cliente_id) : null;
      let indirizzoDedotto = '—';
      let indirIsWarn = false;
      if (cli) {
        const parts = [];
        if (cli.via) parts.push(cli.via);
        const luogo = [cli.cap, cli.citta].filter(Boolean).join(' ');
        if (luogo) parts.push(luogo);
        if (cli.provincia) parts.push('('+cli.provincia+')');
        if (parts.length) indirizzoDedotto = parts.join(' · ');
        else { indirizzoDedotto = '⚠ Cliente senza indirizzo configurato'; indirIsWarn = true; }
      } else if (c.cliente_id) {
        indirizzoDedotto = '⚠ Cliente non trovato'; indirIsWarn = true;
      }

      // Row container
      const row = el('div', { class:'consegna-row' });

      // Riga 1: numero + autocomplete cliente + bottone delete
      const acWrap = el('div', { class:'cli-ac-wrap' });
      const acInput = el('input', {
        type:'text',
        placeholder:'Cerca cliente per nome…',
        value: cli ? cli.nome : '',
        autocomplete:'off',
      });
      const acList = el('div', { class:'cli-ac-list' });
      acWrap.append(acInput, acList);

      let highlightIdx = -1;
      const refreshList = () => {
        const q = acInput.value.toLowerCase().trim();
        const filtered = state.aziende
          .filter(x => x.attivo)
          .filter(x => !q || x.nome.toLowerCase().includes(q) ||
                       (x.citta||'').toLowerCase().includes(q) ||
                       (x.p_iva||'').toLowerCase().includes(q))
          .sort((a,b) => a.nome.localeCompare(b.nome))
          .slice(0, 20);
        acList.innerHTML = '';
        if (filtered.length === 0) { acList.classList.remove('open'); return; }
        filtered.forEach((x, idx) => {
          const item = el('div', { class:'cli-ac-item' + (idx === highlightIdx ? ' sel' : '') },
            el('span', { class:'cli-name' }, x.nome),
            el('span', { class:'cli-meta' }, [x.citta, x.provincia].filter(Boolean).join(' · ')),
          );
          item.onmousedown = (e) => {
            e.preventDefault();
            c.cliente_id = x.id;
            acInput.value = x.nome;
            acList.classList.remove('open');
            renderConsegne(); // re-render per aggiornare l'indirizzo
          };
          acList.append(item);
        });
        acList.classList.add('open');
      };

      acInput.oninput = () => {
        highlightIdx = -1;
        c.cliente_id = null; // resetta selezione finché non sceglie
        refreshList();
      };
      acInput.onfocus = () => refreshList();
      acInput.onblur = () => { setTimeout(() => acList.classList.remove('open'), 200); };
      acInput.onkeydown = (e) => {
        if (!acList.classList.contains('open')) return;
        const items = acList.querySelectorAll('.cli-ac-item');
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          highlightIdx = Math.min(highlightIdx + 1, items.length - 1);
          items.forEach((it, i) => it.classList.toggle('sel', i === highlightIdx));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          highlightIdx = Math.max(highlightIdx - 1, 0);
          items.forEach((it, i) => it.classList.toggle('sel', i === highlightIdx));
        } else if (e.key === 'Enter' && highlightIdx >= 0) {
          e.preventDefault();
          items[highlightIdx].dispatchEvent(new Event('mousedown'));
        } else if (e.key === 'Escape') {
          acList.classList.remove('open');
        }
      };

      const rowTop = el('div', { class:'row-top' },
        el('div', { class:'num' }, String(i+1)),
        acWrap,
        el('input', { type:'text', placeholder:'Cosa consegnare (opz.)', value:c.descrizione||'',
                      oninput: e => c.descrizione = e.target.value, style:'flex:1;' }),
        el('button', { type:'button', class:'btnd', onclick: () => { consegne.splice(i,1); renderConsegne(); } }, '✕'),
      );

      // Riga 2: indirizzo dedotto
      const rowIndir = el('div', { class:'indir-info', style: indirIsWarn ? 'color:var(--yel);' : '' },
        indirizzoDedotto);

      row.append(rowTop, rowIndir);
      listaWrap.append(row);
    });
  };
  renderConsegne();

  const consegneField = el('div', { class:'field', style:'margin-top:8px' },
    el('label', {}, 'Lista consegne / fermate *'),
    listaWrap,
    el('button', { type:'button', class:'btnsm', style:'margin-top:8px;align-self:flex-start;',
      onclick: () => { consegne.push({ cliente_id:null, descrizione:'', ordine:consegne.length, _new:true }); renderConsegne(); }
    }, '+ Aggiungi consegna'),
    el('div', { class:'sub', style:'margin-top:4px;' },
      'Obbligatoria almeno una consegna con cliente.'),
  );
  form.append(consegneField);

  // La lista consegne ha senso solo per le prenotazioni di tipo "consegna":
  // viene mostrata SOLO in quel caso. Cambiando tipo, compare/scompare.
  const aggiornaVisibilitaConsegne = () => {
    const isConsegna = selTipo.value === 'consegna';
    consegneField.style.display = isConsegna ? '' : 'none';
    // Se passo a "consegna" e non c'è ancora nessuna riga, ne pre-creo una vuota
    // (almeno una è obbligatoria, così l'utente ha subito un campo da compilare).
    if (isConsegna && consegne.length === 0) {
      consegne.push({ cliente_id:null, descrizione:'', ordine:0, _new:true });
      renderConsegne();
    }
  };
  selTipo.onchange = aggiornaVisibilitaConsegne;
  aggiornaVisibilitaConsegne();

  if (!canEdit) form.querySelectorAll('input,select,textarea,button').forEach(x=>x.disabled=true);

  body.append(form);
  if (!isNew) {
    const u = state.profiliById[p.utente_id];
    body.append(el('div', { class:'sub', style:'margin-top:10px' },
      `Prenotato da ${u?.nome || u?.email || 'utente sconosciuto'}`));
  }
  modal.append(body);

  const foot = el('div', { class:'mfoot' });
  foot.append(el('button', { class:'btng', onclick:closeModal }, 'Chiudi'));
  // Duplica: solo su eventi esistenti. Riapre come nuova prenotazione già
  // compilata (mezzo, tipo, orari, operatori, consegne, note) — resta da
  // cambiare la data. Se resta la stessa, il check sovrapposizioni la blocca.
  if (!isNew && canEdit) {
    foot.append(el('button', { class:'btng', onclick: () => {
      const fd = new FormData(form);
      const sorgente = {
        mezzo_id: fd.get('mezzo_id'), tipo: fd.get('tipo'),
        data_inizio: fd.get('data_inizio'), data_fine: fd.get('data_fine'),
        ora_inizio: fd.get('ora_inizio') || null, ora_fine: fd.get('ora_fine') || null,
        note: fd.get('note') || null,
      };
      closeModal();
      openPrenotazioneModal(sorgente, { dup: { consegne, utenti: utentiSel } });
    }}, '⧉ Duplica'));
  }
  if (!isNew && canEdit) {
    foot.append(el('button', { class:'btnd', onclick: async () => {
      if (!confirm('Eliminare questa prenotazione?')) return;
      const { error } = await sb.from('prenotazioni').delete().eq('id', p.id);
      if (error) return toast(error.message, 'err');
      // Aggiorna subito la cache locale (non aspettiamo il realtime)
      state.prenotazioni = state.prenotazioni.filter(x => x.id !== p.id);
      state.consegne = state.consegne.filter(c => c.prenotazione_id !== p.id);
      state.prenOp = state.prenOp.filter(r => r.prenotazione_id !== p.id);
      toast('Prenotazione eliminata'); closeModal(); renderTab(state.currentTab);
    }}, 'Elimina'));
  }
  if (canEdit) foot.append(el('button', { class:'btnp', onclick:save }, 'Salva'));
  modal.append(foot);

  async function save() {
    const fd = new FormData(form);
    const payload = {
      mezzo_id: fd.get('mezzo_id'), tipo: fd.get('tipo'),
      data_inizio: fd.get('data_inizio'), data_fine: fd.get('data_fine'),
      ora_inizio: fd.get('ora_inizio') || null, ora_fine: fd.get('ora_fine') || null,
      note: fd.get('note') || null,
    };
    if (!payload.mezzo_id || !payload.data_inizio || !payload.data_fine)
      return toast('Compila i campi obbligatori', 'err');
    if (!payload.ora_inizio || !payload.ora_fine)
      return toast('Ora inizio e ora fine sono obbligatorie', 'err');
    if (payload.data_fine < payload.data_inizio)
      return toast('Data fine non può essere prima dell\'inizio', 'err');
    // Se stesso giorno, l'ora fine deve essere dopo l'ora inizio
    if (payload.data_inizio === payload.data_fine && payload.ora_fine <= payload.ora_inizio)
      return toast('Nello stesso giorno, l\'ora fine deve essere dopo l\'ora inizio', 'err');
    if (utentiSel.length === 0)
      return toast('Seleziona almeno un operatore del mezzo', 'err');
    // Per il tipo "consegna" serve almeno una consegna con destinazione (cliente).
    const isConsegna = payload.tipo === 'consegna';
    if (isConsegna && !consegne.some(c => c.cliente_id))
      return toast('Per il tipo "Consegna" serve almeno una consegna con cliente', 'err');

    // CHECK SOVRAPPOSIZIONI prima di salvare (considera gli orari)
    const conflitti = checkSovrapposizioni(
      payload.mezzo_id, payload.data_inizio, payload.data_fine,
      isNew ? null : p.id, payload.ora_inizio, payload.ora_fine
    );
    if (conflitti.length > 0) {
      const m = state.mezzi.find(x => x.id === payload.mezzo_id);
      const dettagli = conflitti.map(c => {
        const u = state.profiliById[c.utente_id];
        const periodo = c.data_inizio === c.data_fine
          ? fmtIT(c.data_inizio)
          : `${fmtIT(c.data_inizio)} → ${fmtIT(c.data_fine)}`;
        return `• ${periodo} (${u?.nome || u?.email || 'utente'})`;
      }).join('\n');
      alert(`⚠ Mezzo "${m?.nome || ''}" già prenotato in quel periodo:\n\n${dettagli}\n\nScegli un altro periodo o un altro mezzo.`);
      return;
    }

    // CHECK: stesso operatore su un altro mezzo nella stessa fascia oraria
    const conflittiOp = checkSovrapposizioniOperatori(
      utentiSel, payload.data_inizio, payload.data_fine,
      isNew ? null : p.id, payload.ora_inizio, payload.ora_fine
    );
    if (conflittiOp.length > 0) {
      const dettagli = conflittiOp.map(({ pren, operatori }) => {
        const m = state.mezzi.find(x => x.id === pren.mezzo_id);
        const nomi = operatori.map(uid => state.utentiById[uid]?.nome || 'operatore').join(', ');
        const periodo = pren.data_inizio === pren.data_fine
          ? fmtIT(pren.data_inizio)
          : `${fmtIT(pren.data_inizio)} → ${fmtIT(pren.data_fine)}`;
        const orari = (pren.ora_inizio && pren.ora_fine) ? ` ${pren.ora_inizio}–${pren.ora_fine}` : '';
        return `• ${nomi} → ${m?.nome || 'mezzo'} (${periodo}${orari})`;
      }).join('\n');
      alert(`⚠ Operatore già impegnato su un altro mezzo nella stessa fascia oraria:\n\n${dettagli}\n\nScegli un altro periodo, oppure togli dall'elenco l'operatore in conflitto.`);
      return;
    }

    // CHECK NON BLOCCANTE: operatori in ferie/permesso nel periodo. Il riquadro
    // giallo nel modal lo dice già, ma le date si possono cambiare all'ultimo:
    // qui si chiede conferma, non si vieta. Annullando non si salva niente.
    const assRighe = assenzeInPrenotazione(utentiSel, payload.data_inizio, payload.data_fine);
    if (assRighe.length > 0) {
      const dettagli = testoAssenze(assRighe).map(t => '• ' + t).join('\n');
      const parziali = assRighe.some(r => r.nParziali > 0);
      const nota = parziali
        ? '\n\nDove sono indicate le ore è un permesso parziale: non impedisce per forza la trasferta.'
        : '';
      if (!confirm(`⚠ In questo periodo risultano assenze:\n\n${dettagli}${nota}\n\nSalvo lo stesso la prenotazione?`))
        return;
    }

    let prenId = p.id;
    let prenRow = null;
    if (isNew) {
      payload.utente_id = state.profile.id;
      const { data, error } = await eseguiConRetry(
        () => sb.from('prenotazioni').insert(payload).select().single(),
        { label: 'salvataggio prenotazione' }
      );
      if (error) {
        if (error.message && error.message.includes('exclusion')) {
          return toast('Mezzo già prenotato in quel periodo', 'err');
        }
        return toast(error.message, 'err');
      }
      prenId = data.id;
      prenRow = data;
    } else {
      const { data, error } = await eseguiConRetry(
        () => sb.from('prenotazioni').update(payload).eq('id', p.id).select().single(),
        { label: 'aggiornamento prenotazione' }
      );
      if (error) {
        if (error.message && error.message.includes('exclusion')) {
          return toast('Mezzo già prenotato in quel periodo', 'err');
        }
        return toast(error.message, 'err');
      }
      prenRow = data;
    }

    // Aggiorno operatori associati: cancello tutti e reinserisco
    await sb.from('prenotazioni_utenti').delete().eq('prenotazione_id', prenId);
    let nuoviPrenUtil = [];
    if (utentiSel.length > 0) {
      const rows = utentiSel.map(uid => ({ prenotazione_id: prenId, utente_id: uid }));
      const { data, error } = await sb.from('prenotazioni_utenti').insert(rows).select();
      if (error) return toast('Errore associazione utenti: '+error.message, 'err');
      nuoviPrenUtil = data || rows;
    }

    await sb.from('consegne').delete().eq('prenotazione_id', prenId);
    const validi = isConsegna ? consegne.filter(c => c.cliente_id || (c.descrizione||'').trim()) : [];
    let nuoveConsegne = [];
    if (validi.length) {
      const rows = validi.map((c, i) => ({
        prenotazione_id: prenId, ordine: i,
        cliente_id: c.cliente_id || null,
        descrizione: c.descrizione || null,
      }));
      const { data, error } = await sb.from('consegne').insert(rows).select();
      if (error) return toast('Salvato ma errore nelle consegne: '+error.message, 'err');
      nuoveConsegne = data || [];
    }

    // Aggiorno la cache locale subito (non aspettiamo il realtime)
    if (isNew) {
      if (!state.prenotazioni.find(x => x.id === prenRow.id)) state.prenotazioni.push(prenRow);
    } else {
      state.prenotazioni = state.prenotazioni.map(x => x.id === prenId ? prenRow : x);
    }
    // Per pivot e consegne: rimuovo le righe duplicate (potrebbero arrivare dal realtime in parallelo)
    const idsPrenUtil = new Set(nuoviPrenUtil.map(r => r.prenotazione_id+'|'+r.utente_id));
    state.prenOp = state.prenOp.filter(r => r.prenotazione_id !== prenId).concat(nuoviPrenUtil);
    const idsConsegne = new Set(nuoveConsegne.map(r => r.id));
    state.consegne = state.consegne.filter(c => c.prenotazione_id !== prenId).concat(nuoveConsegne);

    toast(isNew ? 'Prenotazione creata' : 'Prenotazione aggiornata');
    closeModal(); renderTab(state.currentTab);
  }

  openModal(modal);
}

// ═══════════════════════════════════════════════════════════
// KIOSK MODE — terminale check-out mezzi per mini-PC sede
// ═══════════════════════════════════════════════════════════
const kioskState = {
  utenteSelezionato: null,    // { id, nome }
  authorId: null,              // id profilo loggato (autore prenotazioni, FK profili)
  isAdmin: false,              // true se chi ha aperto il kiosk è un admin
  mezzoInUscita: null,         // mezzo in fase di check-out (in attesa rientro previsto)
  opIniziate: new Set(),       // id operazioni con almeno una sessione chiusa
  opOreCons: {},               // operazione_id → ore consuntivate (sessioni chiuse)
  spezzoniSaltati: new Set(),  // spezzoni della pausa già annotati o saltati (non richiederli a ogni identificazione)
  inactivityTimer: null,
  doneTimer: null,
};

const KIOSK_INACTIVITY_MS = 30000;     // torna alla schermata 1 dopo 30s di inattività (mouse fermo, niente tasti)
const KIOSK_DONE_MS = 2000;             // schermata conferma resta 2s

// ── Pausa pranzo automatica ────────────────────────────────────────
// Ogni sessione di lavoro iniziata prima delle 12:30 di un giorno viene
// chiusa automaticamente con fine = 12:30 dello stesso giorno.
// Il check viene fatto all'avvio del kiosk e ogni PAUSA_CHECK_MS.
const PAUSA_PRANZO_ORA = 12;
const PAUSA_PRANZO_MIN = 30;
// Ogni 5 minuti, non ogni minuto: la pausa scrive sempre `fine = 12:30`
// qualunque sia il momento in cui gira, quindi controllare più spesso non
// cambia un dato — cambia solo il traffico.
const PAUSA_CHECK_MS = 5 * 60 * 1000;

function setupKioskExitButton() {
  const btn = document.getElementById('kiosk-exit-btn');
  if (!btn) return;
  // Se la tab è stata aperta da window.open(), window.opener è valorizzato
  // e window.history.length è tipicamente 1 (nessuna navigazione precedente)
  const apertaDaTabAdmin = !!window.opener;
  if (apertaDaTabAdmin) {
    btn.textContent = '✕ Chiudi tab';
    btn.title = 'Chiudi la tab kiosk e torna alla tua sessione admin';
    btn.href = '#';
    btn.onclick = (e) => {
      e.preventDefault();
      window.close();
    };
  }
  // Altrimenti: lascia comportamento default (href="./" porta all'app)
}

// Chiude automaticamente le sessioni di lavoro per la pausa pranzo.
// Logica: per ogni sessione aperta (fine = NULL), se è iniziata prima
// delle 12:30 di un certo giorno *passato* (es. oggi alle 9, o ieri alle 11),
// scrive fine = 12:30 di quel giorno.
//
// Funziona anche su sessioni rimaste aperte da giorni precedenti
// (es. operatore che ha dimenticato di chiudere ieri sera).
// È idempotente: se già chiuse, non trova nulla da fare.
async function chiudiSessioniPausaPranzo() {
  try {
    // Il filtro si fa fare al SERVER, non a valle (24 ago). Prima si scaricavano
    // TUTTE le sessioni aperte ogni minuto su ogni postazione per poi scartarle
    // quasi tutte: 4,8 KB a botta, che con quattro kiosk accesi fanno quasi
    // 1 GB al mese di traffico per un lavoro che il 99% delle volte è nessuno.
    //
    // Una sessione va chiusa solo se è iniziata prima delle 12:30 del suo
    // giorno E quelle 12:30 sono passate. Quindi:
    //   dopo le 12:30 → possono servire quelle iniziate prima delle 12:30 di oggi
    //   prima delle 12:30 → solo quelle dei giorni scorsi
    // Nel caso normale la risposta è una lista vuota.
    const adessoPerFiltro = new Date();
    const pausaOggi = new Date(adessoPerFiltro.getFullYear(), adessoPerFiltro.getMonth(),
      adessoPerFiltro.getDate(), PAUSA_PRANZO_ORA, PAUSA_PRANZO_MIN, 0, 0);
    const soglia = adessoPerFiltro >= pausaOggi
      ? pausaOggi
      : new Date(adessoPerFiltro.getFullYear(), adessoPerFiltro.getMonth(), adessoPerFiltro.getDate(), 0, 0, 0, 0);
    // Colonne: solo quelle che servono alla spalmatura sul gruppo, non tutte.
    const { data: sessioniAperte, error: errLoad } = await sb
      .from('sessioni_lavoro')
      .select('id, inizio, utente_id, operazione_id, tipo_lavorazione_id, sede, note, attivita_id')
      .is('fine', null)
      .lt('inizio', soglia.toISOString());
    if (errLoad) throw errLoad;
    if (!sessioniAperte || sessioniAperte.length === 0) return 0;

    const adesso = new Date();
    const updates = [];

    for (const s of sessioniAperte) {
      const inizio = new Date(s.inizio);
      // Costruisco "le 12:30 dello stesso giorno dell'inizio sessione"
      const pausaQuelGiorno = new Date(
        inizio.getFullYear(), inizio.getMonth(), inizio.getDate(),
        PAUSA_PRANZO_ORA, PAUSA_PRANZO_MIN, 0, 0
      );
      // Condizioni per chiudere:
      // 1. La sessione è iniziata PRIMA delle 12:30 di quel giorno
      // 2. Le 12:30 di quel giorno sono già passate (rispetto ad adesso)
      if (inizio < pausaQuelGiorno && pausaQuelGiorno <= adesso) {
        updates.push({ id: s.id, fine: pausaQuelGiorno.toISOString(), sess: s });
      }
    }

    if (updates.length === 0) return 0;

    // Eseguo gli update uno per uno (sono pochi, non vale la pena un batch raffinato)
    let chiuse = 0;
    for (const u of updates) {
      // Passa dalla STESSA strada della chiusura normale, così una commessa
      // raggruppata si spalma anche qui (7 ago). Prima era un update secco e
      // non spalmava: chi lavorava a mezzogiorno su un gruppo si vedeva tutte
      // le ore su una sola posizione — 87 timbri e 305 h attribuite male.
      const sess = (state.sessioni || []).find(s => s.id === u.id) || u.sess;
      try {
        if (sess && sess.inizio) {
          await chiudiConSplitGruppo(sess, u.fine, null);
        } else {
          // Non ce l'abbiamo in memoria (altra postazione, altro giorno):
          // si chiude e basta, com'era prima. Meglio chiusa che aperta.
          const { error } = await sb.from('sessioni_lavoro')
            .update({ fine: u.fine }).eq('id', u.id).is('fine', null);
          if (error) continue;
        }
        chiuse++;
      } catch (e) { /* la prossima passata riproverà: è idempotente */ }
    }

    if (chiuse > 0) {
      console.log(`[pausa pranzo] chiuse ${chiuse} sessioni automaticamente`);
      // Aggiorno subito la UI di QUESTO client senza aspettare l'eco realtime,
      // così il timer si ferma anche se il realtime è momentaneamente giù.
      try {
        if (IS_KIOSK) {
          if (typeof kioskLoadAll === 'function') await kioskLoadAll();
          if (typeof kioskRefreshActive === 'function') kioskRefreshActive();
        } else if (state.loaded && typeof loadAllData === 'function') {
          await loadAllData();
          if (state.currentTab && typeof renderTab === 'function') renderTab(state.currentTab);
        }
      } catch (e) { /* refresh best-effort */ }
    }
    return chiuse;
  } catch (e) {
    // Non bloccante: se fallisce, riproveremo al prossimo check
    console.warn('[pausa pranzo] errore:', e.message || e);
    return 0;
  }
}

async function kioskInit() {
  // Setup bottone "Admin": se la tab è stata aperta da window.open, "chiudi tab"; altrimenti naviga
  setupKioskExitButton();

  // Controlla se c'è già una sessione attiva. Se sì (es. admin che apre il kiosk),
  // usa quella sessione invece di forzare il login kiosk.
  let sessioneEsistente = null;
  try {
    const { data } = await conTimeoutAuth(sb.auth.getSession(), 4000);
    sessioneEsistente = data?.session || null;
  } catch (e) {
    // ignora, andiamo al fallback con autologin
  }

  if (!sessioneEsistente) {
    // Autologin con account dedicato (caso mini-PC sede, nessuna sessione preesistente)
    try {
      const { error } = await sb.auth.signInWithPassword({
        email: KIOSK_EMAIL, password: KIOSK_PASSWORD,
      });
      if (error) throw error;
    } catch (e) {
      document.body.innerHTML = `<div class="setup">
        <h1>⚠ Errore login kiosk</h1>
        <p>${e.message || e}</p>
        <p>Verifica che l'utente <code>${KIOSK_EMAIL}</code> esista su Supabase.</p>
      </div>`;
      return;
    }
  } else {
    console.log('[KIOSK] Sessione esistente trovata ('+sessioneEsistente.user.email+') — uso quella invece di autologin kiosk');
  }

  // Nascondi tutto eccetto schermo kiosk
  $('#auth-screen').style.display = 'none';
  $('#app-screen').style.display = 'none';
  $('#kiosk-screen').style.display = 'flex';
  applyTheme(localStorage.getItem('theme') || 'dark');

  // Recupero l'id dell'utente auth loggato (kiosk@cablotec.local o l'admin
  // che ha aperto il kiosk). Serve come "autore" (utente_id) quando il kiosk
  // crea prenotazioni: quel campo ha una FK verso `profili`, non verso `utenti`.
  try {
    const { data: ud } = await sb.auth.getUser();
    kioskState.authorId = ud?.user?.id || null;
  } catch (e) {
    kioskState.authorId = null;
  }

  // Verifico se chi ha aperto il kiosk è un admin (per i comandi riservati,
  // es. il riordino priorità). Sui terminali con account kiosk dedicato il
  // ruolo non è admin, quindi i comandi restano nascosti.
  kioskState.isAdmin = false;
  try {
    if (kioskState.authorId) {
      const { data: prof } = await sb.from('profili')
        .select('ruolo').eq('id', kioskState.authorId).maybeSingle();
      kioskState.isAdmin = (prof?.ruolo === 'admin');
    }
  } catch (e) { kioskState.isAdmin = false; }

  // Carica dati iniziali
  await kioskLoadAll();
  kioskStartRealtime();

  // Orologio
  setInterval(kioskUpdateClock, 1000);
  kioskUpdateClock();

  // Pausa pranzo automatica: check iniziale + ricorrente ogni minuto
  chiudiSessioniPausaPranzo();
  setInterval(chiudiSessioniPausaPranzo, PAUSA_CHECK_MS);

  // Le card live nella schermata identificazione hanno timer di durata
  // (per chi sta lavorando) che devono aggiornarsi ogni secondo.
  // Aggiorno SOLO il testo, senza ricreare le card — è sicuro anche se
  // l'utente sta cliccando proprio in quel momento.
  setInterval(() => {
    if ($('#kiosk-step-id').style.display === 'none') return;
    document.querySelectorAll('#kiosk-utili-grid .live-card-durata[data-inizio]').forEach(refreshLiveDurationEl);
  }, 1000);

  kioskGoToId();
}

function kioskUpdateClock() {
  const d = new Date();
  $('#kiosk-clock').textContent =
    z(d.getHours())+':'+z(d.getMinutes())+':'+z(d.getSeconds());
}

async function kioskLoadAll() {
  // Carica mezzi, operatori, usi aperti, prenotazioni di oggi
  // + clienti, articoli, tipi_lav, operazioni, sessioni per il flusso commesse
  // + attività extra per il terzo flusso "Attività extra"
  // + assenze del giorno e tipi_assenza per mostrare ferie/permessi nelle card
  const oggi = toLocalISO(new Date());
  const [mezzi, util, clienti, articoli, tipiLav, operazioni, sessioni, opAddetti, opFasi, assenze, tipiAss, attExtra, prenFuture, prenOp] = await Promise.all([
    sb.from('mezzi').select('*').eq('attivo', true).order('nome'),
    sb.from('utenti').select('*').eq('attivo', true).order('nome'),
    sb.from('aziende').select('*').eq('attivo', true).order('nome'),
    sb.from('articoli').select('*').eq('attivo', true).order('codice'),
    sb.from('tipi_lavorazione').select('*').eq('attivo', true).order('ordine'),
    fetchTutte(() => sb.from('operazioni').select('*').neq('stato', 'spedita').neq('stato', 'completata').order('scadenza').order('id')),
    // Sessioni: le APERTE (tutte, anche di giorni passati) + le CHIUSE
    // recenti (ultimi 15 giorni), che servono alla sezione "▶ Riprendi"
    // dell'elenco commesse. Il resto del kiosk filtra sempre !s.fine da sé.
    fetchTutte(() => sb.from('sessioni_lavoro').select('*')
      .or('fine.is.null,inizio.gte.' + toLocalISO(new Date(Date.now() - 15 * 86400000)))
      .order('inizio', { ascending:false }).order('id')),
    fetchTutte(() => sb.from('operazioni_addetti').select('*').order('operazione_id').order('utente_id').order('fase_id')),
    // Fasi delle commesse: SERVONO al kiosk per timbrare la fase giusta e per
    // evitare che l'auto-iscrizione crei una riga "tutta la commessa" (fase_id
    // null) credendo per errore che la commessa non abbia fasi.
    fetchTutte(() => sb.from('operazioni_fasi').select('*').order('id')),
    sb.from('assenze').select('*').eq('data', oggi).eq('stato', 'valida'),
    sb.from('tipi_assenza').select('*'),
    sb.from('attivita_extra').select('*').eq('attivo', true).order('ordine'),
    // Prenotazioni da oggi in avanti: fonte UNICA del kiosk (state.prenotazioni).
    // Coprono il check conflitti e la segnalazione mezzi occupati/prenotati.
    sb.from('prenotazioni').select('*').gte('data_fine', oggi),
    sb.from('prenotazioni_utenti').select('*'),
  ]);
  state.mezzi = mezzi.data || [];
  state.utenti = util.data || [];
  state.utentiById = Object.fromEntries(state.utenti.map(u => [u.id, u]));
  state.aziende = clienti.data || [];
  state.articoli = articoli.data || [];
  state.tipiLav = tipiLav.data || [];
  state.operazioni = operazioni.data || [];
  state.sessioni = sessioni.data || [];
  state.opAddetti = opAddetti.data || [];
  state.opFasi = opFasi.data || [];
  state.assenze = assenze.data || [];
  state.tipiAssenza = tipiAss.data || [];
  state.attivitaExtra = attExtra.data || [];
  // Prenotazioni future + relazione operatori: usate da checkSovrapposizioni
  // e loadPrenotazioneOperatori durante il check-out mezzi.
  state.prenotazioni = prenFuture.data || [];
  state.prenOp = prenOp.data || [];
  // Log diagnostico (visibile in console)
  console.log('[KIOSK] Loaded:', {
    mezzi: state.mezzi.length,
    operatori: state.utenti.length,
    clienti: state.aziende.length,
    articoli: state.articoli.length,
    tipiLav: state.tipiLav.length,
    operazioni: state.operazioni.length,
    opAddetti: state.opAddetti.length,
    sessioni_aperte: state.sessioni.filter(s => !s.fine).length,
    assenze_oggi: state.assenze.length,
  });
  // Log errori se ci sono
  [['mezzi',mezzi],['operatori',util],['prenotazioni',prenFuture],['prenOp',prenOp],
   ['clienti',clienti],['articoli',articoli],['tipiLav',tipiLav],
   ['operazioni',operazioni],['sessioni',sessioni],['opAddetti',opAddetti],
   ['attExtra',attExtra]].forEach(([n,r]) => {
    if (r.error) console.error('[KIOSK] Errore caricamento', n, r.error);
  });

  // Set degli id operazione che hanno almeno una sessione chiusa (cioè
  // hanno avuto almeno una timbratura completata) + mappa delle ore reali
  // consuntivate per ogni operazione. Usati nelle card del kiosk per la
  // barra di progresso preventivo/consuntivo.
  // Query mirata: solo sulle operazioni aperte attualmente in cache,
  // peso minimo anche se lo storico è grande.
  kioskState.opIniziate = new Set();
  kioskState.opOreCons = {};       // operazione_id → ore consuntivate (sessioni chiuse)
  const opIds = state.operazioni.map(o => o.id);
  if (opIds.length > 0) {
    try {
      const { data: sessChiuse, error: errIniz } = await sb
        .from('sessioni_lavoro')
        .select('operazione_id, durata_secondi')
        .in('operazione_id', opIds)
        .not('fine', 'is', null);
      if (errIniz) console.error('[KIOSK] Errore caricamento op iniziate:', errIniz);
      else (sessChiuse || []).forEach(s => {
        kioskState.opIniziate.add(s.operazione_id);
        kioskState.opOreCons[s.operazione_id] =
          (kioskState.opOreCons[s.operazione_id] || 0) + (s.durata_secondi || 0) / 3600;
      });
    } catch (e) {
      console.error('[KIOSK] Errore caricamento op iniziate:', e);
    }
  }
}

// Applica al kiosk una sessione cambiata da un'altra postazione SENZA
// riscaricare tutto. Oltre alla riga tiene aggiornate le due cose che
// kioskLoadAll ricalcolava per la barra preventivo/consuntivo delle card.
function kioskApplySessione(p) {
  const oreDi = s => (s && s.fine && s.durata_secondi) ? s.durata_secondi / 3600 : 0;
  const id = (p.new && p.new.id) || (p.old && p.old.id);
  // La copia PRIMA della modifica va letta da state, non da p.old: senza
  // REPLICA IDENTITY FULL, p.old contiene solo la chiave primaria.
  const prima = state.sessioni.find(x => x.id === id);
  applyChange('sessioni_lavoro', p);
  const dopo = p.eventType === 'DELETE' ? null : state.sessioni.find(x => x.id === id);
  const opId = (dopo && dopo.operazione_id) || (prima && prima.operazione_id);
  if (!opId) return null;
  const delta = oreDi(dopo) - oreDi(prima);
  if (delta) kioskState.opOreCons[opId] = Math.max(0, (kioskState.opOreCons[opId] || 0) + delta);
  if (dopo && dopo.fine) kioskState.opIniziate.add(opId);
  return opId;
}

// operazioni_addetti non ha un canale realtime suo: finora si aggiornava di
// rimbalzo, perché ogni timbro faceva ricaricare tutto. Senza quella ricarica
// una postazione resterebbe con la cache vecchia e la chiusura fase, non
// trovando la riga, ne inserirebbe una doppia. Rileggiamo le righe della sola
// commessa toccata: qualche centinaio di byte invece di 215 KB.
async function kioskSyncAddetti(opId) {
  if (!opId) return;
  const { data, error } = await sb.from('operazioni_addetti').select('*').eq('operazione_id', opId);
  if (error || !data) return;
  state.opAddetti = state.opAddetti.filter(r => r.operazione_id !== opId).concat(data);
}

// Il kiosk tiene in cache solo le commesse ancora da fare: se una viene
// spedita o completata deve sparire, come faceva il ricaricamento.
function kioskApplyOperazione(p) {
  applyChange('operazioni', p);
  state.operazioni = state.operazioni.filter(o => o.stato !== 'spedita' && o.stato !== 'completata');
}

function kioskStartRealtime() {
  if (kioskChannel) return;
  if (!_rtLivenessTimer) _rtLivenessTimer = setInterval(_rtLivenessCheck, 45000);
  kioskChannel = sb.channel('kiosk-changes')
    .on('postgres_changes', { event:'*', schema:'public', table:'mezzi' }, () => {
      kioskLoadAll().then(kioskRefreshActive);
    })
    .on('postgres_changes', { event:'*', schema:'public', table:'utenti' }, () => {
      kioskLoadAll().then(kioskRefreshActive);
    })
    .on('postgres_changes', { event:'*', schema:'public', table:'prenotazioni' }, () => {
      kioskLoadAll().then(kioskRefreshActive);
    })
    // ── Le due tabelle che cambiano di continuo NON fanno riscaricare tutto ──
    // (24 ago) Ogni timbro produce due eventi, insert e chiusura, e le quote di
    // un gruppo ne producono uno per commessa. Con kioskLoadAll() ogni evento
    // costava 215 KB di rete PER POSTAZIONE: 293 eventi al giorno facevano
    // 3,6 GB al mese con due postazioni e 7,2 con quattro — ed è quello che ha
    // sforato la quota Supabase.
    // La riga cambiata arriva DENTRO il messaggio realtime: applicarla costa
    // zero. È già quello che fa il gestionale admin con applyChange().
    .on('postgres_changes', { event:'*', schema:'public', table:'operazioni' }, (p) => {
      kioskApplyOperazione(p);
      kioskRefreshActive();
    })
    .on('postgres_changes', { event:'*', schema:'public', table:'sessioni_lavoro' }, (p) => {
      const opId = kioskApplySessione(p);
      kioskRefreshActive();
      if (opId) kioskSyncAddetti(opId).then(kioskRefreshActive);
    })
    .on('postgres_changes', { event:'*', schema:'public', table:'aziende' }, () => {
      kioskLoadAll().then(kioskRefreshActive);
    })
    .on('postgres_changes', { event:'*', schema:'public', table:'articoli' }, () => {
      kioskLoadAll().then(kioskRefreshActive);
    })
    .on('postgres_changes', { event:'*', schema:'public', table:'tipi_lavorazione' }, () => {
      kioskLoadAll().then(kioskRefreshActive);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (_kioskNeedCatchup) {
          _kioskNeedCatchup = false;
          // Recupero gli eventi persi durante il buco (il realtime non li riproduce).
          kioskLoadAll().then(kioskRefreshActive).catch(() => {});
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        _kioskNeedCatchup = true;
        try { if (kioskChannel) sb.removeChannel(kioskChannel); } catch (e) {}
        kioskChannel = null;
        clearTimeout(_kioskRtTimer);
        _kioskRtTimer = setTimeout(() => { if (!kioskChannel && sb) kioskStartRealtime(); }, 3000);
      }
    });
}

function kioskRefreshActive() {
  // Re-render della schermata corrente
  if ($('#kiosk-step-id').style.display !== 'none') kioskRenderId();
  else if ($('#kiosk-step-action').style.display !== 'none') kioskRenderAction();
  else if ($('#kiosk-step-op-list').style.display !== 'none') kioskRenderOpList();
  else if ($('#kiosk-step-attiva').style.display !== 'none') kioskRenderAttiva();
}

function kioskShowError(msg) {
  // Toast di errore in basso, autodismiss
  const ex = $('#kiosk-toast');
  if (ex) ex.remove();
  const t = el('div', { id:'kiosk-toast', class:'kiosk-toast' }, msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
  kioskBeep('err');
}

function kioskBeep(kind) {
  // Beep sintetizzato senza file audio
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    if (kind === 'err') {
      osc.frequency.value = 220;
      gain.gain.setValueAtTime(.15, ctx.currentTime);
      osc.start(); osc.stop(ctx.currentTime + .25);
    } else {
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(.12, ctx.currentTime);
      osc.start(); osc.stop(ctx.currentTime + .12);
    }
  } catch (e) { /* ignora se WebAudio non disponibile */ }
}

// ─── SCHERMATA 1: identificazione ───
function kioskGoToId() {
  kioskState.utenteSelezionato = null;
  clearTimeout(kioskState.inactivityTimer);
  if (state.kioskTimer) { clearInterval(state.kioskTimer); state.kioskTimer = null; }
  kioskHideAllSteps();
  $('#kiosk-step-id').style.display = 'flex';
  kioskRenderId();
}

function kioskRenderId() {
  // Griglia operatori: escludi inattivi e l'account tecnico kiosk.
  // Usa le card "live" come nella scheda Live degli admin, così l'utente
  // vede a colpo d'occhio chi sta lavorando, chi è fermo, chi è in ferie.
  // Click su una card = identifica come quell'utente (comportamento attuale).
  // Le card sono raggruppate per gruppo utenti (Trasfertisti, Cablotec 1, ecc.).
  const grid = $('#kiosk-utili-grid');
  grid.innerHTML = '';
  // Gli esterni IN SEDE timbrano come tutti (28 lug): prima erano esclusi
  // perché "esterno" voleva dire terzista-che-lavora-fuori, ruolo passato ai
  // fornitori sulla commessa. Restano in fondo, in una sezione per ditta, così
  // si vedono ma non si confondono con le squadre Cablotec.
  const attivi = state.utenti
    .filter(u => u.attivo && !isKioskRecord(u))
    .sort((a,b) => a.nome.localeCompare(b.nome));
  const sezioni = raggruppaUtenti(attivi.filter(u => !u.esterno));
  const esterni = attivi.filter(u => u.esterno);
  if (esterni.length) {
    const perDitta = new Map();
    esterni.forEach(u => {
      const nome = u.azienda_id
        ? ((state.aziende.find(a => a.id === u.azienda_id) || {}).nome || 'Esterni in sede')
        : 'Esterni in sede';
      if (!perDitta.has(nome)) perDitta.set(nome, []);
      perDitta.get(nome).push(u);
    });
    [...perDitta.entries()]
      .sort((x, y) => x[0].localeCompare(y[0]))
      .forEach(([nome, utenti]) => sezioni.push({ key:'__est__' + nome, label: nome, utenti }));
  }
  sezioni.forEach(sez => {
    // Intestazione di gruppo a tutta larghezza (occupa l'intera riga della griglia)
    grid.appendChild(el('div', {
      class: 'gruppo-hd' + (sez.key === '__nogroup__' ? ' nogroup' : ''),
      style: 'grid-column:1/-1;',
    }, sez.label));
    sez.utenti.forEach(u => {
      grid.appendChild(buildLiveCard(u, () => kioskSelectUtente(u)));
    });
  });
}

function kioskSelectUtente(u) {
  kioskState.utenteSelezionato = u;
  kioskBeep('ok');
  // Se ha una sessione lavoro aperta, va direttamente lì
  const sess = state.sessioni.find(s => s.utente_id === u.id && !s.fine);
  if (sess) { kioskGoToAttiva(); return; }
  // Attività extra troncata dalla pausa e rimasta senza nota: prima del menu
  // si chiede cos'era e si offre di riprenderla.
  const spezzone = kioskSpezzoneDaPausa(u.id);
  if (spezzone) { kioskChiediRipresa(spezzone); return; }
  kioskGoToMenu();
}

// ─── SCHERMATA MENU (Mezzi / Commesse) ───
function kioskGoToMenu() {
  kioskHideAllSteps();
  $('#kiosk-step-menu').style.display = 'flex';
  const u = kioskState.utenteSelezionato;
  if (u) $('#kiosk-menu-name').textContent = 'Ciao ' + u.nome;
  kioskResetInactivity();
}

function kioskGoToMezzi() {
  kioskGoToAction();
}

function kioskHideAllSteps() {
  ['kiosk-step-id','kiosk-step-action','kiosk-step-menu',
   'kiosk-step-op-list','kiosk-step-tipo','kiosk-step-attiva',
   'kiosk-step-attivita-list','kiosk-step-mezzo-rientro','kiosk-step-done'].forEach(id => {
    const e = $('#'+id); if (e) e.style.display = 'none';
  });
}

// ─── SCHERMATA 2: scelta azione ───
function kioskGoToAction() {
  kioskHideAllSteps();
  $('#kiosk-step-action').style.display = 'flex';
  kioskRenderAction();
  kioskResetInactivity();
}

// Prenotazione che copre l'istante corrente per un mezzo (verità unica:
// niente più usi_mezzo). Costruisce gli istanti come kioskConflittoOrarioMezzo:
// senza orario → tutto il giorno (00:00–23:59). Restituisce la prenotazione
// attiva ADESSO (la prima trovata) o null.
function kioskPrenotazioneAttivaOra(mezzoId) {
  const now = new Date();
  return (state.prenotazioni || []).find(p => {
    if (p.mezzo_id !== mezzoId) return false;
    if (!p.data_inizio || !p.data_fine) return false;
    const pInizio = new Date(p.data_inizio + 'T' + (p.ora_inizio || '00:00'));
    const pFine = new Date(p.data_fine + 'T' + (p.ora_fine || '23:59'));
    if (isNaN(pInizio.getTime()) || isNaN(pFine.getTime())) return false;
    return pInizio <= now && pFine > now;
  }) || null;
}

// Chi è l'operatore di una prenotazione: autore (utente_id su profili) NON è
// l'operatore. Gli operatori stanno in prenotazioni_utenti via
// loadPrenotazioneOperatori. Restituisce il nome del primo operatore, con
// fallback ragionevoli.
function kioskNomeOperatorePren(p) {
  const opIds = loadPrenotazioneOperatori(p.id) || [];
  for (const oid of opIds) {
    const nome = state.utentiById[oid]?.nome;
    if (nome) return nome;
  }
  return null;
}

function kioskRenderAction() {
  const u = kioskState.utenteSelezionato;
  if (!u) { kioskGoToId(); return; }

  $('#kiosk-greet-name').textContent = 'Ciao ' + u.nome;
  const root = $('#kiosk-action-content');
  root.innerHTML = '';

  // Ha un mezzo fuori? (verità unica: prenotazione mia attiva ADESSO)
  // "Mia" = l'utente corrente è operatore della prenotazione (via
  // prenotazioni_utenti). NON si usa utente_id: è l'account kiosk, uguale per
  // tutti gli operatori → identificherebbe chiunque come "mio".
  const nowTS = new Date();
  const prenFuoriMia = (state.prenotazioni || []).find(p => {
    if (!p.mezzo_id || !p.data_inizio || !p.data_fine) return false;
    const pInizio = new Date(p.data_inizio + 'T' + (p.ora_inizio || '00:00'));
    const pFine = new Date(p.data_fine + 'T' + (p.ora_fine || '23:59'));
    if (isNaN(pInizio.getTime()) || isNaN(pFine.getTime())) return false;
    if (!(pInizio <= nowTS && pFine > nowTS)) return false;
    // L'operatore vero è SOLO chi sta in prenotazioni_utenti. utente_id sulla
    // prenotazione è l'autore (account kiosk), uguale per tutti → non distingue.
    return (loadPrenotazioneOperatori(p.id) || []).includes(u.id);
  });
  if (prenFuoriMia) {
    const m = state.mezzi.find(x => x.id === prenFuoriMia.mezzo_id);
    const inizio = new Date(prenFuoriMia.data_inizio + 'T' + (prenFuoriMia.ora_inizio || '00:00'));
    const durata = kioskFormatDurata(Date.now() - inizio.getTime());
    const fine = new Date(prenFuoriMia.data_fine + 'T' + (prenFuoriMia.ora_fine || '23:59'));
    const fineScaduto = fine < new Date();
    root.appendChild(el('div', { class:'kiosk-rientro-box' },
      el('div', { class:'kiosk-rientro-title' }, 'Hai un mezzo fuori'),
      el('div', { class:'kiosk-rientro-mezzo' },
        (m?.nome || '?') + (m?.targa ? ' · '+m.targa : '')),
      el('div', { class:'kiosk-rientro-info' },
        'Preso alle '+z(inizio.getHours())+':'+z(inizio.getMinutes())+' ('+durata+' fa)'),
      el('div', { class:'kiosk-rientro-info', style: fineScaduto ? 'color:var(--red);font-weight:600;' : '' },
        (fineScaduto ? '⚠ Rientro previsto era: ' : 'Rientro previsto: ')
        + fmtIT(toLocalISO(fine)) + ' ' + z(fine.getHours())+':'+z(fine.getMinutes())),
      el('button', { class:'kiosk-rientro-btn', onclick:()=>kioskConfirmRientro(prenFuoriMia) },
        '✓ Conferma rientro'),
    ));
    root.appendChild(el('div', { class:'kiosk-section-title' }, 'Oppure prendi un altro mezzo'));
  }

  // Lista mezzi.
  // - I mezzi prenotati da altri NON vengono nascosti: con la logica oraria
  //   un mezzo "prenotato solo dalle 18" è prendibile prima (lo gestisce il
  //   check kioskConflittoOrarioMezzo in conferma). Mostro "prenotato dalle …".
  // - I mezzi FISICAMENTE fuori adesso (uso aperto) restano visibili ma
  //   bloccati (grigi, non cliccabili), con operatore e rientro previsto.

  // FONTE UNICA: usa state.prenotazioni (la stessa che usa kioskConflittoOrarioMezzo
  // in conferma) così render e blocco sono SEMPRE allineati. In passato il render
  // leggeva kioskState.prenotazioniOggi, che poteva non contenere prenotazioni
  // create dal calendario app → mezzo "libero a vista" ma bloccato al click.
  // Filtro localmente alle prenotazioni che coprono oggi.
  const oggiIso = toLocalISO(new Date());
  const prenOggi = (state.prenotazioni || []).filter(p =>
    p.data_inizio && p.data_fine && p.data_inizio <= oggiIso && p.data_fine >= oggiIso
  );

  // Mezzo prenotato dall'utente corrente, ancora VALIDO (attivo ora o più
  // tardi oggi) — per evidenziarlo in cima. Le prenotazioni già concluse oggi
  // sono escluse: non ha senso evidenziare un mezzo già restituito.
  // Solo via prenotazioni_utenti: utente_id è l'autore kiosk, non distingue.
  const nowPrenMia = new Date();
  const prenMia = prenOggi.find(p => {
    if (!p.mezzo_id) return false;
    if (!(loadPrenotazioneOperatori(p.id) || []).includes(u.id)) return false;
    // Esclude se la fine è già passata.
    const fine = new Date(p.data_fine + 'T' + (p.ora_fine || '23:59'));
    if (!isNaN(fine.getTime()) && fine <= nowPrenMia) return false;
    return true;
  });

  // Per ogni mezzo, la prossima prenotazione di oggi (di chiunque) con orario,
  // usata come etichetta informativa "prenotato dalle HH:MM".
  const oggiIsoNow = oggiIso;
  const prossimaPrenOggi = (mezzoId) => {
    const cand = prenOggi
      .filter(p => p.mezzo_id === mezzoId && p.ora_inizio)
      .map(p => ({ p, ts: new Date(`${oggiIsoNow}T${p.ora_inizio}`) }))
      .filter(x => !isNaN(x.ts.getTime()) && x.ts > new Date())
      .sort((a,b) => a.ts - b.ts);
    return cand.length ? cand[0].p : null;
  };

  // Mappa mezzo_id → prenotazione attiva ADESSO (verità unica: niente usi_mezzo).
  // Serve a segnalare come bloccati i mezzi occupati da una prenotazione altrui
  // in corso, invece di nasconderli.
  const prenAttivaByMezzo = {};
  state.mezzi.forEach(m => {
    const pa = kioskPrenotazioneAttivaOra(m.id);
    if (pa) prenAttivaByMezzo[m.id] = pa;
  });
  // È "mia" la prenotazione attiva? Solo via prenotazioni_utenti (utente_id è
  // l'autore kiosk, uguale per tutti). Se è mia non va bloccata.
  const prenAttivaMia = (p) => p &&
    (loadPrenotazioneOperatori(p.id) || []).includes(u.id);

  // Tutti i mezzi: quelli occupati da altri restano visibili ma bloccati.
  const disponibili = state.mezzi.slice();
  // Ordina: prima i liberi, poi gli occupati da altri; il mio prenotato in cima.
  disponibili.sort((a,b) => {
    if (prenMia) {
      if (a.id === prenMia.mezzo_id) return -1;
      if (b.id === prenMia.mezzo_id) return 1;
    }
    const aOcc = (prenAttivaByMezzo[a.id] && !prenAttivaMia(prenAttivaByMezzo[a.id])) ? 1 : 0;
    const bOcc = (prenAttivaByMezzo[b.id] && !prenAttivaMia(prenAttivaByMezzo[b.id])) ? 1 : 0;
    if (aOcc !== bOcc) return aOcc - bOcc;
    return a.nome.localeCompare(b.nome);
  });

  const grid = el('div', { class:'kiosk-grid' });
  if (disponibili.length === 0) {
    grid.appendChild(el('div', { class:'kiosk-empty' }, 'Nessun mezzo disponibile al momento.'));
  } else {
    disponibili.forEach(m => {
      const prenAttiva = prenAttivaByMezzo[m.id];
      const occupatoDaAltri = prenAttiva && !prenAttivaMia(prenAttiva);
      // ── Mezzo OCCUPATO da prenotazione altrui in corso: visibile ma bloccato ──
      if (occupatoDaAltri) {
        const chi = kioskNomeOperatorePren(prenAttiva);
        // Fine prenotazione (= "rientro previsto" nel nuovo modello).
        const fine = new Date(prenAttiva.data_fine + 'T' + (prenAttiva.ora_fine || '23:59'));
        const fineStr = !isNaN(fine.getTime())
          ? (fmtIT(toLocalISO(fine)) + ' ' + z(fine.getHours()) + ':' + z(fine.getMinutes()))
          : null;
        grid.appendChild(el('div', {
          class: 'kiosk-tile mezzo mezzo-occupato',
          style: 'border-left-color:var(--mut);opacity:.55;cursor:not-allowed;',
          onclick: () => {
            kioskBeep('err');
            kioskShowError('Mezzo occupato da ' + (chi || 'un altro operatore')
              + (fineStr ? ('. Libero dal: ' + fineStr) : '.'));
          },
        },
          el('div', { class:'kiosk-tile-name' }, m.nome),
          m.targa ? el('div', { class:'kiosk-tile-targa' }, m.targa) : null,
          el('div', { class:'kiosk-tile-targa', style:'color:var(--red);font-weight:600;' },
            '● Occupato da ' + (chi || '?')),
          fineStr ? el('div', { class:'kiosk-tile-targa', style:'color:var(--mut);' },
            'fino al ' + fineStr) : null,
        ));
        return;
      }
      // ── Mezzo LIBERO ──
      const isPren = prenMia && prenMia.mezzo_id === m.id;
      const prossima = (!isPren) ? prossimaPrenOggi(m.id) : null;
      grid.appendChild(el('div', {
        class: 'kiosk-tile mezzo'+(isPren ? ' mezzo-prenotato' : ''),
        style: 'border-left-color:'+(m.colore || '#4eb8ff'),
        onclick: () => kioskConfirmUscita(m),
      },
        el('div', { class:'kiosk-tile-name' }, m.nome),
        m.targa ? el('div', { class:'kiosk-tile-targa' }, m.targa) : null,
        (prossima ? el('div', { class:'kiosk-tile-targa', style:'color:var(--yel);' },
          '⏱ prenotato dalle ' + prossima.ora_inizio) : null),
      ));
    });
  }
  root.appendChild(grid);
}

// Click su un mezzo → apre la schermata per indicare data+ora rientro previsto
// (obbligatorio). La timbratura vera avviene in kioskFinalizzaUscita.
function kioskConfirmUscita(mezzo) {
  kioskState.mezzoInUscita = mezzo;
  kioskHideAllSteps();
  $('#kiosk-step-mezzo-rientro').style.display = 'flex';
  kioskRenderRientroPrevisto();
  kioskResetInactivity();
}

function kioskRenderRientroPrevisto() {
  const mezzo = kioskState.mezzoInUscita;
  const u = kioskState.utenteSelezionato;
  if (!mezzo || !u) { kioskGoToAction(); return; }

  const root = $('#kiosk-mezzo-rientro-content');
  root.innerHTML = '';

  // Default proposto: oggi alle 18:00. Se già passate, domani 18:00.
  const now = new Date();
  const def = new Date(now);
  def.setHours(18, 0, 0, 0);
  if (def <= now) def.setDate(def.getDate() + 1);
  const defData = `${def.getFullYear()}-${z(def.getMonth()+1)}-${z(def.getDate())}`;
  const defOra = '18:00';

  // Riepilogo mezzo scelto
  root.append(el('div', { class:'kiosk-rientro-box', style:'margin-bottom:18px;' },
    el('div', { class:'kiosk-rientro-title' }, 'Mezzo scelto'),
    el('div', { class:'kiosk-rientro-mezzo' },
      mezzo.nome + (mezzo.targa ? ' · '+mezzo.targa : '')),
  ));

  // ── Tipo di utilizzo (obbligatorio) ──
  let tipoScelto = null;
  root.append(el('div', { style:'font-size:13px;color:var(--mut);margin-bottom:8px;text-transform:uppercase;letter-spacing:.08em;' }, 'Tipo di utilizzo *'));
  const tipoWrap = el('div', { style:'display:flex;flex-wrap:wrap;gap:10px;margin-bottom:22px;' });
  const tipoBtns = {};
  TIPI.forEach(t => {
    const btn = el('button', {
      type:'button',
      style:'flex:1;min-width:140px;padding:16px;font-size:16px;font-weight:600;background:var(--sur);border:2px solid var(--brd);border-radius:8px;color:var(--txt);cursor:pointer;border-left:6px solid '+t.color+';',
      onclick: () => {
        tipoScelto = t.id;
        Object.values(tipoBtns).forEach(b => { b.style.borderColor = 'var(--brd)'; b.style.borderLeftWidth = '6px'; });
        btn.style.borderColor = 'var(--acc)';
        btn.style.borderLeftColor = t.color;
      },
    }, t.label);
    tipoBtns[t.id] = btn;
    tipoWrap.append(btn);
  });
  root.append(tipoWrap);

  // ── Data + ora rientro previsto ──
  root.append(el('div', { style:'font-size:13px;color:var(--mut);margin-bottom:8px;text-transform:uppercase;letter-spacing:.08em;' }, 'Fino a quando *'));

  const inData = el('input', { type:'date', value: defData, required:'true',
    style:'font-size:20px;padding:12px;width:100%;box-sizing:border-box;background:var(--sur);border:2px solid var(--brd);border-radius:8px;color:var(--txt);' });

  // Selettore orario completo: tutte le mezz'ore dalle 06:00 alle 22:00.
  // <select> grande, touch-friendly, scrollabile — niente più scelte rapide.
  const selOra = el('select', {
    style:'font-size:20px;padding:12px;width:100%;box-sizing:border-box;background:var(--sur);border:2px solid var(--brd);border-radius:8px;color:var(--txt);',
  });
  for (let h = 6; h <= 22; h++) {
    for (const mm of ['00', '30']) {
      const val = z(h) + ':' + mm;
      selOra.append(el('option', { value: val }, val));
    }
  }
  selOra.value = defOra;

  root.append(el('div', { style:'display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:24px;' },
    el('div', {}, el('div', { style:'font-size:13px;color:var(--mut);margin-bottom:6px;' }, 'Data rientro'), inData),
    el('div', {}, el('div', { style:'font-size:13px;color:var(--mut);margin-bottom:6px;' }, 'Ora rientro'), selOra),
  ));

  const btnConferma = el('button', {
    class:'kiosk-rientro-btn',
    style:'width:100%;font-size:20px;padding:18px;',
    onclick: () => {
      if (!tipoScelto) {
        kioskBeep('err');
        kioskShowError('Seleziona il tipo di utilizzo (Trasferta, Consegna, …).');
        return;
      }
      const dataV = inData.value;
      const oraV = selOra.value;
      if (!dataV || !oraV) {
        kioskBeep('err');
        kioskShowError('Indica data e ora di rientro previsto.');
        return;
      }
      const rientroPrev = new Date(`${dataV}T${oraV}`);
      if (isNaN(rientroPrev.getTime())) {
        kioskBeep('err');
        kioskShowError('Data/ora non valida.');
        return;
      }
      if (rientroPrev <= new Date()) {
        kioskBeep('err');
        kioskShowError('Il rientro previsto deve essere nel futuro.');
        return;
      }
      kioskFinalizzaUscita(mezzo, rientroPrev.toISOString(), tipoScelto);
    },
  }, '✓ Prendi il mezzo');
  root.append(btnConferma);
}

async function kioskFinalizzaUscita(mezzo, rientroPrevistoISO, tipo) {
  const u = kioskState.utenteSelezionato;
  const oraUscita = new Date();
  const rp = new Date(rientroPrevistoISO);

  // Date in formato ISO giorno per le prenotazioni (che ragionano a giorni)
  const dataInizio = toLocalISO(oraUscita);
  const dataFine = toLocalISO(rp);
  const oraInizioStr = z(oraUscita.getHours()) + ':' + z(oraUscita.getMinutes());
  const oraFineStr = z(rp.getHours()) + ':' + z(rp.getMinutes());

  // Prenotazione esistente dell'utente per oggi su QUESTO mezzo, ANCORA VALIDA.
  // "Valida" = non già conclusa: se l'operatore ha usato e chiuso una
  // prenotazione stamattina (ora_fine già passata), quella NON va riaperta —
  // se riprende il mezzo nel pomeriggio se ne crea una nuova.
  // L'operatore si identifica SOLO via prenotazioni_utenti (utente_id su
  // prenotazioni è l'autore/profilo, non l'operatore).
  const adesso = new Date();
  const oggiIso = toLocalISO(adesso);
  const prenMia = (state.prenotazioni || []).find(p => {
    if (p.mezzo_id !== mezzo.id) return false;
    if (!p.data_inizio || !p.data_fine) return false;
    if (!(p.data_inizio <= oggiIso && p.data_fine >= oggiIso)) return false;
    const operatori = loadPrenotazioneOperatori(p.id) || [];
    if (!operatori.includes(u.id)) return false;
    // Scarta se già conclusa: ora_fine (di oggi) nel passato.
    if (p.ora_fine && p.data_fine <= oggiIso) {
      const fineTS = new Date(`${p.data_fine}T${p.ora_fine}`);
      if (!isNaN(fineTS.getTime()) && fineTS <= adesso) return false;
    }
    return true;
  });

  // CHECK CONFLITTI ORARIO: cerco la prima prenotazione (di altri) che cade
  // nel periodo [adesso → rientro previsto], escludendo la mia. Modalità A:
  // blocco e chiedo di correggere il rientro.
  const cf = kioskConflittoOrarioMezzo(mezzo.id, oraUscita, rp, prenMia ? prenMia.id : null);
  if (cf.occupatoOra) {
    kioskBeep('err');
    kioskShowError('Questo mezzo è già in uso/prenotato in questo momento. Non è disponibile.');
    return;
  }
  if (cf.conflitto) {
    const lim = cf.conflitto;
    const limGiorno = toLocalISO(lim);
    const oggiIso = toLocalISO(oraUscita);
    const quando = (limGiorno === oggiIso)
      ? ('oggi alle ' + z(lim.getHours()) + ':' + z(lim.getMinutes()))
      : ('il ' + fmtIT(limGiorno) + ' alle ' + z(lim.getHours()) + ':' + z(lim.getMinutes()));
    kioskBeep('err');
    kioskShowError('Mezzo prenotato da ' + quando + '.\nScegli un rientro entro quell\'orario.');
    return;
  }

  try {
    // 1) Gestione prenotazione: aggiorna l'esistente (2b) o creane una nuova
    if (prenMia) {
      // Aggiorna: ora_inizio = reale, data_fine + ora_fine = rientro previsto, tipo scelto
      const { data: prenAgg, error: errPren } = await sb.from('prenotazioni').update({
        ora_inizio: oraInizioStr,
        data_fine: dataFine,
        ora_fine: oraFineStr,
        tipo: tipo,
      }).eq('id', prenMia.id).select().maybeSingle();
      if (errPren) {
        kioskBeep('err');
        kioskShowError('Errore aggiornando la prenotazione: ' + errPren.message);
        return;
      }
      if (!prenAgg) {
        kioskBeep('err');
        kioskShowError('Non è stato possibile aggiornare la prenotazione '
          + '(permessi o prenotazione non più presente). Avvisa l\'amministratore.');
        return;
      }
      // Aggiorna cache (fonte unica)
      state.prenotazioni = state.prenotazioni.map(x => x.id === prenAgg.id ? prenAgg : x);
    } else {
      // Crea prenotazione al volo.
      // utente_id = autore (profilo loggato), NON l'operatore: la FK punta a profili.
      // L'operatore vero va in prenotazioni_utenti (FK verso utenti).
      const { data: prenNuova, error: errPren } = await sb.from('prenotazioni').insert({
        mezzo_id: mezzo.id,
        data_inizio: dataInizio,
        data_fine: dataFine,
        ora_inizio: oraInizioStr,
        ora_fine: oraFineStr,
        tipo: tipo,
        utente_id: kioskState.authorId,
        note: 'Creata da kiosk',
      }).select().single();
      if (errPren) {
        kioskBeep('err');
        kioskShowError('Errore creando la prenotazione: ' + errPren.message);
        return;
      }
      state.prenotazioni.push(prenNuova);
      // Associo l'operatore alla prenotazione
      const { data: pu } = await sb.from('prenotazioni_utenti')
        .insert({ prenotazione_id: prenNuova.id, utente_id: u.id }).select();
      if (pu && pu[0] && Array.isArray(state.prenOp)) state.prenOp.push(pu[0]);
    }

    // Verità unica: nessun usi_mezzo. La presa del mezzo È la prenotazione.
    kioskState.mezzoInUscita = null;
    kioskBeep('ok');
    kioskShowDone({
      title: 'Uscita registrata',
      detail: u.nome + ' → ' + (mezzo.nome + (mezzo.targa ? ' · '+mezzo.targa : ''))
        + '\nRientro previsto: ' + fmtIT(dataFine) + ' ' + oraFineStr
        + (prenMia ? '\n(prenotazione aggiornata)' : '\n(prenotazione creata)'),
      ok: true,
    });
  } catch (e) {
    kioskShowError('Errore: ' + (e.message||e));
  }
}

async function kioskConfirmRientro(pren) {
  try {
    const rientroReale = new Date();
    const oggiIso = toLocalISO(rientroReale);
    const oraFineReale = z(rientroReale.getHours()) + ':' + z(rientroReale.getMinutes());
    const m = state.mezzi.find(x => x.id === pren.mezzo_id);
    const u = kioskState.utenteSelezionato;

    // Verità unica: il rientro "chiude" la prenotazione portando
    // data_fine + ora_fine al momento effettivo. Niente usi_mezzo.
    // maybeSingle: se 0 righe (es. RLS o prenotazione rimossa) non lancia
    // l'errato "Cannot coerce..." ma restituisce null → messaggio chiaro.
    const { data: pAgg, error } = await sb.from('prenotazioni').update({
      data_fine: oggiIso,
      ora_fine: oraFineReale,
    }).eq('id', pren.id).select().maybeSingle();
    if (error) throw error;
    if (!pAgg) {
      kioskBeep('err');
      kioskShowError('Non è stato possibile chiudere la prenotazione '
        + '(permessi o prenotazione non più presente). Avvisa l\'amministratore.');
      return;
    }
    state.prenotazioni = state.prenotazioni.map(x => x.id === pAgg.id ? pAgg : x);

    // Durata reale dalla presa (ora_inizio) al rientro.
    const inizio = new Date(pren.data_inizio + 'T' + (pren.ora_inizio || '00:00'));
    const durata = !isNaN(inizio.getTime())
      ? kioskFormatDurata(rientroReale.getTime() - inizio.getTime())
      : '—';
    kioskBeep('ok');
    kioskShowDone({
      title: 'Rientro registrato',
      detail: u.nome + ' → ' + (m?.nome||'?') + (m?.targa ? ' · '+m.targa : '') +
              '\nDurata: ' + durata,
      ok: true,
    });
  } catch (e) {
    kioskShowError('Errore: ' + (e.message||e));
  }
}

// ─── SCHERMATA 3: conferma ───
function kioskShowDone({ title, detail, ok, dopo }) {
  clearTimeout(kioskState.inactivityTimer);
  $('#kiosk-step-id').style.display = 'none';
  $('#kiosk-step-action').style.display = 'none';
  $('#kiosk-step-done').style.display = 'flex';
  const root = $('#kiosk-done-msg');
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'kiosk-done-card' + (ok ? '' : ' err') },
    el('div', { class:'kiosk-done-icon' }, ok ? '✓' : '✕'),
    el('div', { class:'kiosk-done-msg' }, title),
    el('div', { class:'kiosk-done-detail', style:'white-space:pre-line' }, detail || ''),
  ));
  clearTimeout(kioskState.doneTimer);
  // Conferma OK: sparisce in fretta. Errore/avviso: resta a lungo, così è leggibile.
  kioskState.doneTimer = setTimeout(dopo || kioskGoToId, ok ? KIOSK_DONE_MS : 15000);
}

// ─── Inattività ───
function kioskResetInactivity() {
  clearTimeout(kioskState.inactivityTimer);
  kioskState.inactivityTimer = setTimeout(kioskGoToId, KIOSK_INACTIVITY_MS);
}
// True se l'utente è in una schermata "attiva" del kiosk dove ha senso
// che il timer di inattività sia in funzione e venga resettato dagli eventi.
// Escludiamo la schermata identificazione (non c'è nulla da resettare) e
// quella di conferma "done" (ha già il suo timer di 2s).
function kioskInSchermataAttiva() {
  const ids = ['kiosk-step-action','kiosk-step-op-list','kiosk-step-menu',
               'kiosk-step-tipo','kiosk-step-attiva'];
  return ids.some(id => {
    const e = document.getElementById(id);
    return e && e.style.display !== 'none';
  });
}
// Eventi che "tengono viva" la sessione: click, tasti, e anche solo il
// movimento del mouse o del dito. Così basta scuotere il mouse per restare
// nella schermata corrente del kiosk mentre si legge.
['click','keydown','mousemove','touchstart','touchmove'].forEach(ev => {
  document.addEventListener(ev, () => {
    if (kioskInSchermataAttiva()) kioskResetInactivity();
  });
});

function kioskFormatDurata(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return min + ' min';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h + 'h ' + (m ? m+'min' : '');
}


// ═══════════════════════════════════════════════════════════
// KIOSK COMMESSE — timbrature operatori su operazioni
// ═══════════════════════════════════════════════════════════

// Stato runtime del flusso commesse
const kCom = {
  vediAltre: false,       // toggle "cerca altre operazioni"
  vediCompletate: false,  // toggle sezione "Completate da te"
  riordino: false,        // modalità riordino priorità (solo admin)
  search: '',             // testo ricerca
  opSelezionata: null,    // operazione su cui si farà start
};

// ─── ENTRY POINT da menu ───
function kioskGoToCommesse() {
  // Reset stato locale del flusso
  kCom.vediAltre = false;
  kCom.vediCompletate = false;
  kCom.riordino = false;
  kCom.search = '';
  kCom.opSelezionata = null;
  kioskGoToOpList();
}

// ─── Fase finita per-persona ─────────────────────────────────────────
// Modello: un addetto ha UNA sola riga per commessa (PK operazione_id+utente_id),
// con la sua fase in fase_id. "Fase finita" = completata_il valorizzato su quella
// riga. La commessa sparisce dai suoi suggerimenti quando la marca finita.

// Tutte le righe dell'utente su questa commessa (può averne più d'una: una per fase).
function addettoRigheUtenteOp(uid, opId) {
  return (state.opAddetti || []).filter(r => r.utente_id === uid && r.operazione_id === opId);
}
// True se l'utente ha dichiarato finite TUTTE le proprie fasi su questa commessa.
function opCompletataDaUtente(uid, opId) {
  const righe = addettoRigheUtenteOp(uid, opId);
  return righe.length > 0 && righe.every(r => r.completata_il);
}
// Riga addetto pertinente alla sessione in corso: match per fase_id della
// sessione, poi per tipo di lavorazione della fase, poi — se l'utente ha una
// sola riga non completata — quella. Altrimenti null (niente "ho finito").
function rigaPerSessione(uid, sess) {
  if (!sess || !sess.operazione_id) return null;
  // Solo righe non ancora completate: sono le fasi che l'operatore può "finire".
  const righe = addettoRigheUtenteOp(uid, sess.operazione_id).filter(x => !x.completata_il);
  if (righe.length === 0) return null;
  // 1) match esatto sulla fase della sessione
  if (sess.fase_id) {
    const r = righe.find(x => x.fase_id === sess.fase_id);
    if (r) return r;
  }
  // 2) match per tipo: riga la cui fase ha lo stesso tipo timbrato
  if (sess.tipo_lavorazione_id) {
    const r = righe.find(x => {
      if (!x.fase_id) return false;
      const f = (state.opFasi || []).find(ff => ff.id === x.fase_id);
      return f && f.tipo_lavorazione_id === sess.tipo_lavorazione_id;
    });
    if (r) return r;
  }
  // 3) un'unica riga con fase specifica → è quella
  const conFase = righe.filter(x => x.fase_id);
  if (conFase.length === 1) return conFase[0];
  // 4) riga "tutta la commessa" (fase_id null), se presente
  const tutta = righe.find(x => !x.fase_id);
  if (tutta) return tutta;
  // 5) ripiego: la prima incompleta, così la scelta compare comunque
  return righe[0];
}
// Etichetta leggibile della fase di una riga addetto (nome del tipo lavorazione).
function etichettaFaseAddetto(riga) {
  if (!riga || !riga.fase_id) return 'la tua fase';
  const fase = (state.opFasi || []).find(f => f.id === riga.fase_id);
  if (!fase) return 'la tua fase';
  const tipo = (state.tipiLav || []).find(t => t.id === fase.tipo_lavorazione_id);
  return tipo?.nome || 'la tua fase';
}

// Stato per-operatore delle fasi su una commessa: cosa ha chiuso, cosa resta.
// Ritorna { righe:[{fase_id, nome, colore, fatta, ordine}], fatte, totali, restano:[nomi] }.
// Considera solo le fasi su cui l'utente è addetto (ha una riga). Vuoto se nessuna.
function kioskFasiUtente(uid, opId) {
  const righe = addettoRigheUtenteOp(uid, opId).map(r => {
    const f = r.fase_id ? (state.opFasi || []).find(ff => ff.id === r.fase_id) : null;
    const t = f ? (state.tipiLav || []).find(tt => tt.id === f.tipo_lavorazione_id) : null;
    return {
      fase_id: r.fase_id || null,
      ordine: f ? (f.ordine || 0) : 0,
      nome: t?.nome || (r.fase_id ? 'Fase' : 'Tutta la commessa'),
      colore: t?.colore || '#6b6b64',
      fatta: !!r.completata_il,
    };
  }).sort((a, b) => (a.ordine || 0) - (b.ordine || 0));
  return {
    righe,
    fatte: righe.filter(x => x.fatta).length,
    totali: righe.length,
    restano: righe.filter(x => !x.fatta).map(x => x.nome),
  };
}

// Ordinamento commesse al kiosk: prima la priorità impostata dall'admin
// (numero più basso = più in alto; senza priorità in coda), poi per scadenza.
function cmpCommessaKiosk(a, b) {
  const pa = a.priorita, pb = b.priorita;
  const aHas = pa != null && pa !== '';
  const bHas = pb != null && pb !== '';
  if (aHas && bHas && Number(pa) !== Number(pb)) return Number(pa) - Number(pb);
  if (aHas && !bHas) return -1;
  if (!aHas && bHas) return 1;
  if (!a.scadenza && !b.scadenza) return 0;
  if (!a.scadenza) return 1;
  if (!b.scadenza) return -1;
  return a.scadenza < b.scadenza ? -1 : (a.scadenza > b.scadenza ? 1 : 0);
}



// Marca finita la fase DELLA SESSIONE per l'operatore + chiude la sessione.
// Robusto: non dipende dall'aggancio rigaPerSessione. Trova la riga addetto per
// la fase della sessione; se manca, la crea già completata.
// NB — le note rapide NON esistono più (7 ago, decisione Nico). Erano sei chip
// da toccare (Pulizia, Manutenzione, Aiuto a un collega, Riunione, Attesa
// materiale, Formazione) e servivano a dire "cos'era quel tempo" quando
// l'attività extra era UNA SOLA e la nota era l'unico posto dove scriverlo.
// Adesso quelle sei voci SONO le attività: si scelgono all'inizio con un
// bottone grande, e dove il lavoro ha un oggetto c'è pure il riferimento.
// Ripeterle alla fine faceva scegliere due volte la stessa cosa.
// Resta la casella libera, FACOLTATIVA, per il dettaglio che l'attività non
// dice ("PERFOREX", "carico del QE di Barilla con Ryan e Mauro"): sono le
// uniche note che in tutto lo storico siano servite a qualcosa.
// Schermata del kiosk con titolo, uno o più bottoni di uscita e — se serve —
// una casella di testo facoltativa. La usano la chiusura di un'attività extra
// e la ripresa dopo la pausa: una schermata sola, o le due direbbero la stessa
// cosa in due modi diversi.
// azioni: [{ label, stile, classe, valore }]
// Ritorna { azione, nota } — `nota` è '' se la casella non c'è o resta vuota.
function kioskNotaSchermata({ titolo, sottotitolo, azioni, conNota = true, placeholder }) {
  return new Promise((risolvi) => {
    kioskHideAllSteps();
    const step = $('#kiosk-step-done') || document.body;
    const prec = step.style.display;
    step.style.display = 'flex';
    const card = $('#done-card') || step;
    const vecchio = card.innerHTML;
    card.innerHTML = '';
    const inp = conNota ? el('textarea', {
      rows: '2',
      placeholder: placeholder || 'Vuoi aggiungere un dettaglio? (facoltativo)',
      style: 'width:100%;font-size:15px;padding:10px;border-radius:6px;border:1px solid var(--brd);'
        + 'background:var(--sur);color:var(--txt);font-family:var(--ui);margin-top:10px;',
    }) : null;
    const chiudi = (azione) => {
      const nota = inp ? (inp.value || '').trim() : '';
      card.innerHTML = vecchio; step.style.display = prec;
      risolvi({ azione, nota });
    };
    // Nessun bottone si disabilita: la nota è facoltativa, e un bottone spento
    // su un kiosk di reparto è un operatore fermo che non sa cosa fare.
    const bottoni = azioni.map(a => {
      const b = el('button', { class: 'kiosk-attiva-btn' + (a.classe ? ' ' + a.classe : ''),
        style: (a.stile || '') + 'margin-top:8px;' }, a.label);
      b.onclick = () => chiudi(a.valore);
      return b;
    });
    card.append(
      el('div', { style:'font-size:20px;font-weight:700;margin-bottom:4px;' }, titolo),
      el('div', { class:'sub', style:'font-size:13px;' }, sottotitolo),
      ...(inp ? [inp] : []),
      ...bottoni,
    );
  });
}

// Chiude un'attività extra. La nota è FACOLTATIVA (7 ago): il "cosa" lo dice
// già l'attività scelta all'inizio, e dove serve il riferimento. Ritorna la
// nota (anche vuota) oppure null se l'operatore torna indietro — e allora non
// si chiude niente.
async function kioskChiediNota(sess) {
  const r = await kioskNotaSchermata({
    titolo: 'Hai finito?',
    sottotitolo: 'Se c\'è un dettaglio che vale la pena ricordare, scrivilo. Altrimenti chiudi e basta.',
    placeholder: 'Dettaglio (facoltativo): quale macchina, quale pezzo, con chi…',
    azioni: [
      { label:'✅ Chiudi', valore:'ok',
        stile:'background:var(--grn);color:var(--bg);margin-top:12px;' },
      { label:'← Torna indietro', valore:null, classe:'pause' },
    ],
  });
  return r.azione === 'ok' ? r.nota : null;
}

// ── Ripresa dopo la pausa pranzo ──────────────────────────────────────
// La chiusura automatica delle 12:30 tronca il timbro a metà lavoro: rientrando
// si dovrebbe rifare tutto il giro dei menu per tornare dov'eri. Il kiosk
// invece ti dice cosa stavi facendo e te lo fa riprendere in un clic.
// Solo per le attività extra: una commessa si ritrova già dal suo elenco.
// NB (7 ago): non si chiede più la nota qui. Serviva quando l'attività extra
// era una sola e quel tempo non aveva altro nome; adesso ce l'ha.
function kioskSpezzoneDaPausa(uid) {
  const oggi = toLocalISO(new Date());
  return (state.sessioni || [])
    .filter(s => s.utente_id === uid && s.attivita_id && s.fine
      && !kioskState.spezzoniSaltati.has(s.id)
      && toLocalISO(new Date(s.fine)) === oggi
      && (() => {
        // Riconoscibile dall'ora esatta di chiusura: la pausa scrive 12:30:00
        // spaccate. Nessun marcatore nelle note — quel campo è solo degli
        // operatori (decisione Nico, 5 ago).
        const f = new Date(s.fine);
        return f.getHours() === PAUSA_PRANZO_ORA
          && f.getMinutes() === PAUSA_PRANZO_MIN && f.getSeconds() === 0;
      })())
    .sort((a, b) => String(b.inizio).localeCompare(String(a.inizio)))[0] || null;
}

async function kioskChiediRipresa(sess) {
  const att = (state.attivitaExtra || []).find(x => x.id === sess.attivita_id);
  const rif = String(sess.riferimento || '').trim();
  // Col riferimento il "cosa" è già scritto: riprendendo si torna sullo STESSO
  // lavoro, senza rifare il giro della schermata "su cosa?".
  const nome = (att && att.nome ? att.nome : 'attività extra') + (rif ? ' · ' + rif : '');
  const azioni = [];
  // Se l'attività è stata disattivata o cancellata non c'è niente da riprendere:
  // resta solo la via d'uscita.
  if (att && att.attivo !== false) {
    azioni.push({ label:'▶ Riprendi — ' + nome, valore:'riprendi',
      stile:'background:var(--acc);color:var(--bg);margin-top:12px;' });
  }
  azioni.push({ label:'✔ No, ho finito', valore:null, classe:'pause' });

  const inizio = new Date(sess.inizio);
  const r = await kioskNotaSchermata({
    titolo: 'Prima della pausa stavi facendo: ' + nome,
    sottotitolo: 'Dalle ' + fmtT(inizio) + ' alle 12:30, poi il timbro si è chiuso da solo. '
      + 'Vuoi riprendere da lì?',
    conNota: false,
    azioni,
  });

  // Chiesto una volta e basta: riproporlo a ogni identificazione sarebbe un
  // assillo. Torna alla prossima ricarica della pagina.
  kioskState.spezzoniSaltati.add(sess.id);

  if (r.azione === 'riprendi' && att) return kioskSelectAttivita(att, rif || null);
  kioskGoToMenu();
}

// NB: chiudere una FASE non chiede nessuna nota (decisione Nico): lì si sa già
// cosa è stato fatto — commessa, articolo e tipo di lavorazione sono scritti.
// La nota si chiede solo sulle ATTIVITÀ EXTRA, dove senza non resta traccia
// di cosa sia stato quel tempo. Vedi kioskStopSessione.
async function kioskFineFase(sess) {
  const nota = null;
  const ora = new Date().toISOString();
  const uid = kioskState.utenteSelezionato?.id || sess.utente_id;
  // Risolvo la fase da completare: prima la fase della sessione, poi (se manca)
  // la fase con lo stesso tipo timbrato, poi l'unica riga incompleta.
  let fid = sess.fase_id || null;
  if (!fid && sess.tipo_lavorazione_id) {
    const cand = (state.opFasi || []).filter(f =>
      f.operazione_id === sess.operazione_id && f.tipo_lavorazione_id === sess.tipo_lavorazione_id);
    if (cand.length === 1) fid = cand[0].id;
  }
  const righe = addettoRigheUtenteOp(uid, sess.operazione_id);
  let riga = righe.find(r => (r.fase_id || null) === (fid || null));
  if (!riga) {
    const inc = righe.filter(r => !r.completata_il);
    if (inc.length === 1) { riga = inc[0]; fid = riga.fase_id || null; }
  }
  try {
    // 1) Completa la fase (aggiorna la riga, o la crea SOLO se è una fase precisa;
    //    mai una riga "tutta la commessa" nulla). Traccio se la marcatura ha
    //    davvero toccato una riga: con la RLS, una UPDATE non permessa torna
    //    successo ma 0 righe → va reso visibile, non silenzioso.
    let markOk = false;
    if (riga) {
      // Query ricostruita a ogni tentativo: un builder Supabase è monouso.
      const buildQ = () => {
        let q = sb.from('operazioni_addetti').update({ completata_il: ora });
        if (riga.id) return q.eq('id', riga.id).select();
        q = q.eq('operazione_id', sess.operazione_id).eq('utente_id', uid);
        return (riga.fase_id ? q.eq('fase_id', riga.fase_id) : q.is('fase_id', null)).select();
      };
      const { data: upd, error } = await eseguiConRetry(buildQ, { label: 'completamento fase' });
      if (error) { kioskBeep('err'); kioskShowError('Errore: ' + error.message); return; }
      markOk = Array.isArray(upd) && upd.length > 0;
      if (markOk) {
        state.opAddetti = state.opAddetti.map(x =>
          (riga.id ? x.id === riga.id
            : (x.operazione_id === sess.operazione_id && x.utente_id === uid
               && (x.fase_id || null) === (riga.fase_id || null)))
            ? { ...x, completata_il: ora } : x);
      }
    } else if (fid) {
      const { data, error } = await eseguiConRetry(
        () => sb.from('operazioni_addetti')
          .insert({ operazione_id: sess.operazione_id, utente_id: uid, fase_id: fid, completata_il: ora })
          .select().single(),
        { label: 'completamento fase' }
      );
      if (error) { kioskBeep('err'); kioskShowError('Errore: ' + error.message); return; }
      markOk = !!data;
      if (data && !state.opAddetti.find(x => x.id === data.id)) state.opAddetti.push(data);
    }

    // 2) Chiudi la sessione (sempre registrata, qualunque durata) portandosi
    //    dietro la nota: una sola scrittura, non due.
    const res = await kioskChiudiOScarta(sess, nota);
    if (state.kioskTimer) { clearInterval(state.kioskTimer); state.kioskTimer = null; }
    kioskBeep(markOk ? 'ok' : 'err');
    // Mostro il tempo TOTALE lavorato (res.elapsed), non la frazione salvata
    // sulla singola commessa quando è un gruppo.
    const durataS = res.elapsed;
    const h = Math.floor(durataS / 3600), m = Math.floor((durataS % 3600) / 60);
    const dur = (h > 0 ? h + 'h ' + m + 'm' : m + ' min')
      + (res.gruppoN > 1 ? ' · diviso su ' + res.gruppoN + ' commesse del gruppo' : '');
    if (markOk) {
      const f = (state.opFasi || []).find(ff => ff.id === fid);
      const t = f && state.tipiLav.find(tt => tt.id === f.tipo_lavorazione_id);
      // Stato aggiornato (state.opAddetti è già stato sincronizzato sopra):
      // ricordo all'operatore cosa gli resta su questa commessa, o che ha finito.
      const st = kioskFasiUtente(uid, sess.operazione_id);
      const conFasiVere = st.righe.filter(r => r.fase_id);
      let extra = '';
      if (conFasiVere.length) {
        const restano = conFasiVere.filter(r => !r.fatta).map(r => r.nome);
        extra = restano.length
          ? '\nTi resta: ' + restano.join(', ')
          : '\n✓ Hai chiuso tutte le tue fasi su questa commessa';
      }
      kioskShowDone({ title: 'Fase completata ✓', detail: (t?.nome || 'Lavorazione') + '\nDurata: ' + dur + extra, ok: true });
    } else {
      kioskShowDone({ title: 'Sessione chiusa', detail: 'Durata: ' + dur + '\n⚠ Fase NON marcata come finita: permessi DB (UPDATE) mancanti su questo account.', ok: false });
    }
  } catch (e) {
    kioskBeep('err'); kioskShowError('Errore di rete: ' + (e.message || e));
  }
}

// Ripristino esplicito dalla sezione "Completate da te": annulla la
// dichiarazione "ho finito la mia fase" senza dover ricominciare a lavorare.
async function kioskRiapriManuale(opId) {
  const u = kioskState.utenteSelezionato;
  if (!u) return;
  await kioskRiapriFaseSeCompletata(u.id, opId);
  kioskBeep('ok');
  kioskRenderOpList();
}

// Auto-iscrizione addetto (kiosk): chi timbra su una fase ne diventa addetto.
// Stessa logica di mobile: salta se è già "tutta la commessa" (riga fase_id null)
// o se la riga per QUESTA fase esiste già; altrimenti inserisce (fase_id null se la
// commessa non ha fasi). Best-effort: un errore non blocca la timbratura.
async function kioskAssicuraAddetto(uid, opId, faseId, tipoId) {
  try {
    const righe = addettoRigheUtenteOp(uid, opId);
    const fasiOp = (state.opFasi || []).filter(f => f.operazione_id === opId);
    // Risolvi la fase: se non è arrivata, deducila dal tipo timbrato (se univoca).
    let fid = faseId || null;
    if (!fid && tipoId && fasiOp.length) {
      const cand = fasiOp.filter(f => f.tipo_lavorazione_id === tipoId);
      if (cand.length === 1) fid = cand[0].id;
    }
    if (righe.some(r => !r.fase_id)) return;
    if (righe.some(r => (r.fase_id || null) === (fid || null))) return;
    // MAI creare una riga "tutta la commessa" (fase_id null) se la commessa HA
    // fasi: accenderebbe TUTTE le fasi e romperebbe il match per fase.
    if (!fid && fasiOp.length) return;
    const row = { operazione_id: opId, utente_id: uid, fase_id: fid };
    const { data, error } = await eseguiConRetry(
      () => sb.from('operazioni_addetti').insert(row).select().single(),
      { label: 'iscrizione addetto' }
    );
    if (error) return;
    if (data && !state.opAddetti.find(x => x.id === data.id)) state.opAddetti.push(data);
  } catch (e) { /* best-effort */ }
}

// Ricominciare a lavorare su una fase che avevo marcato finita la "riapre".
// faseId valorizzato → riapre solo quella riga; null → riapre tutte le righe
// completate dell'utente sulla commessa (es. ↩ Riapri dalla lista).
async function kioskRiapriFaseSeCompletata(uid, opId, faseId) {
  const righe = addettoRigheUtenteOp(uid, opId).filter(r => r.completata_il
    && (faseId === undefined || faseId === null || r.fase_id === faseId));
  if (righe.length === 0) return;
  try {
    for (const r of righe) {
      // Query ricostruita a ogni tentativo: un builder Supabase è monouso.
      const buildQ = () => {
        let q = sb.from('operazioni_addetti').update({ completata_il: null });
        if (r.id) return q.eq('id', r.id);
        q = q.eq('operazione_id', opId).eq('utente_id', uid);
        return r.fase_id ? q.eq('fase_id', r.fase_id) : q.is('fase_id', null);
      };
      const { error } = await eseguiConRetry(buildQ, { label: 'riapertura fase' });
      if (error) continue;
      state.opAddetti = state.opAddetti.map(x =>
        (r.id ? x.id === r.id
          : (x.operazione_id === opId && x.utente_id === uid
             && (x.fase_id || null) === (r.fase_id || null)))
          ? { ...x, completata_il: null } : x);
    }
  } catch (e) { /* best-effort */ }
}

// ─── Schermata lista operazioni ───
function kioskGoToOpList() {
  kioskHideAllSteps();
  $('#kiosk-step-op-list').style.display = 'flex';
  kioskRenderOpList();
  kioskResetInactivity();
}

// Rende le schede di una griglia trascinabili (drag mouse) per riordinarle.
// Un clic breve resta un clic (avvia il lavoro); un trascinamento riordina.
// Al rilascio salva la priorità (ordine = 1..N) e ridisegna.
function kioskAttachReorder(grid) {
  let dragging = null;
  [...grid.children].forEach(row => {
    row.setAttribute('draggable', 'true');
    row.classList.add('kio-draggable');
    row.addEventListener('dragstart', (e) => {
      dragging = row;
      row.classList.add('dragging');
      try { e.dataTransfer.effectAllowed = 'move'; } catch (_) {}
    });
    row.addEventListener('dragend', async () => {
      row.classList.remove('dragging');
      dragging = null;
      const ids = [...grid.children].map(r => r.dataset.opid).filter(Boolean);
      try {
        const n = await persistPriorita(ids.map((id, i) => ({ id, priorita: i + 1 })));
        if (n > 0) { toast('Priorità aggiornata', 'ok'); kioskRenderOpList(); }
      } catch (e) { toast('Errore: ' + (e.message || e), 'err'); }
    });
  });
  grid.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!dragging) return;
    const others = [...grid.querySelectorAll('.kio-draggable:not(.dragging)')];
    let after = null, best = -Infinity;
    others.forEach(r => {
      const b = r.getBoundingClientRect();
      const off = e.clientY - b.top - b.height / 2;
      if (off < 0 && off > best) { best = off; after = r; }
    });
    if (after == null) grid.appendChild(dragging);
    else grid.insertBefore(dragging, after);
  });
}

function kioskRenderOpList() {
  const u = kioskState.utenteSelezionato;
  if (!u) { kioskGoToId(); return; }

  $('#kiosk-op-name').textContent = 'Ciao ' + u.nome + ' — seleziona operazione';
  const root = $('#kiosk-op-list-content');
  root.innerHTML = '';

  // Operazioni aperte = non spedite e non completate
  // (al kiosk si timbra solo su quelle ancora in lavorazione).
  // Ordinamento: priorità admin, poi scadenza crescente (urgenti in cima),
  // commesse senza scadenza in fondo
  const aperte = state.operazioni
    .filter(o => o.stato !== 'spedita' && o.stato !== 'completata')
    .slice()
    .sort(cmpCommessaKiosk);
  // Set degli id operazione dove questo utente è tra gli addetti previsti
  const mieIds = new Set(
    state.opAddetti.filter(r => r.utente_id === u.id).map(r => r.operazione_id)
  );
  // "mie" = assegnate a me e NON ancora marcate finite da me.
  // "completateDaMe" = assegnate a me ma con la mia fase già dichiarata finita.
  // Rete di sicurezza: una commessa su cui HO UNA SESSIONE APERTA resta
  // sempre tra le mie, anche se la fase risultasse marcata finita (es. per
  // un tocco sbagliato sul kiosk condiviso): finché lavoro, la vedo.
  const conMiaSessione = new Set(state.sessioni
    .filter(s => !s.fine && s.utente_id === u.id && s.operazione_id)
    .map(s => s.operazione_id));
  const mie = aperte.filter(o => (mieIds.has(o.id) && !opCompletataDaUtente(u.id, o.id))
    || conMiaSessione.has(o.id));
  const completateDaMe = aperte.filter(o => mieIds.has(o.id)
    && opCompletataDaUtente(u.id, o.id) && !conMiaSessione.has(o.id));
  const altre = aperte.filter(o => !mieIds.has(o.id) && !conMiaSessione.has(o.id));

  // Solo gli admin (sessione loggata come admin) possono riordinare la coda
  // dell'operatore trascinando le schede direttamente nella lista.
  const isAdmin = !!kioskState.isAdmin;

  // Box ricerca
  const searchBox = el('div', { class:'kiosk-op-search-box' });
  const inp = el('input', {
    type:'text', placeholder:'🔍 Cerca (codice, ordine, OP, cliente, note)…',
    value: kCom.search,
    oninput: (e) => {
      kCom.search = e.target.value;
      kioskRenderOpList();
      // Mantieni focus
      setTimeout(() => {
        const newInp = root.querySelector('.kiosk-op-search-box input');
        if (newInp) { newInp.focus(); newInp.setSelectionRange(newInp.value.length, newInp.value.length); }
      }, 0);
    },
  });
  searchBox.append(inp);

  const toggleBtn = el('button', { class:'kiosk-op-toggle-altre',
    onclick: () => { kCom.vediAltre = !kCom.vediAltre; kioskRenderOpList(); }
  }, kCom.vediAltre ? '✕ Nascondi altre' : '+ Vedi tutte');
  searchBox.append(toggleBtn);

  root.append(searchBox);

  const q = kCom.search.toLowerCase();
  // L'OP sul foglio è scritto 2026OP1727, nel gestionale è 2026/OP/01727:
  // se quello che si cerca è un OP lo si normalizza, così si trova digitandolo
  // com'è stampato. Prima l'OP non era cercabile affatto.
  const qOp = (typeof odlANumeroOp === 'function') ? odlANumeroOp(kCom.search) : null;
  const filtra = (lista) => {
    if (!q) return lista;
    return lista.filter(o => {
      const cli = state.aziende.find(c => c.id === o.cliente_id);
      const art = state.articoli.find(a => a.id === o.articolo_id);
      if (qOp && o.numero_op === qOp) return true;
      if ((o.numero_op||'').toLowerCase().includes(q)) return true;
      return (o.numero_ordine||'').toLowerCase().includes(q)
          || (o.pos||'').toLowerCase().includes(q)
          || (cli?.nome||'').toLowerCase().includes(q)
          || (art?.codice||'').toLowerCase().includes(q)
          || (art?.descrizione||'').toLowerCase().includes(q)
          || (o.note||'').toLowerCase().includes(q);
    });
  };

  // ── Collasso GRUPPI: le commesse con lo stesso gruppo_id sono viste come
  // UNA card. Ogni gruppo compare una volta sola (set globale gruppiVisti),
  // così l'operatore non può timbrare due volte lo stesso lavoro. Ordine di
  // priorità: mie → riprendi le eredita → altre → completate. Il leader è la
  // prima occorrenza; timbrando su di lui la spalmatura raggiunge gli altri.
  const gruppiVisti = new Set();
  const collassa = (lista) => {
    const out = [];
    lista.forEach(o => {
      if (!o.gruppo_id) { out.push(o); return; }
      if (gruppiVisti.has(o.gruppo_id)) return;
      gruppiVisti.add(o.gruppo_id);
      const membri = aperte.filter(x => x.gruppo_id === o.gruppo_id);
      out.push(membri.length > 1 ? Object.assign({}, o, { _gruppoMembri: membri }) : o);
    });
    return out;
  };
  const mieFiltered = collassa(filtra(mie));
  const altreFiltered = collassa(filtra(altre));

  // ── Sezione "▶ Riprendi": le ultime commesse su cui l'operatore ha
  // timbrato (sessione chiusa, fase non ancora dichiarata finita). Il lavoro
  // rimasto in sospeso si ritrova in cima, senza cercarlo. Max 4, ordinate
  // dalla timbratura più recente. Con la ricerca attiva la sezione sparisce
  // (si cerca sull'elenco completo). Le schede qui NON sono duplicate sotto.
  let riprendi = [];
  const ultimaSess = {};
  if (!q) {
    state.sessioni.forEach(s => {
      if (!s.fine || s.utente_id !== u.id || !s.operazione_id) return;
      if (!ultimaSess[s.operazione_id] || s.fine > ultimaSess[s.operazione_id]) {
        ultimaSess[s.operazione_id] = s.fine;
      }
    });
    riprendi = mieFiltered
      .filter(o => ultimaSess[o.id])
      .sort((a, b) => (ultimaSess[b.id] || '').localeCompare(ultimaSess[a.id] || ''))
      .slice(0, 4);
  }
  const riprendiIds = new Set(riprendi.map(o => o.id));
  const mieRestanti = mieFiltered.filter(o => !riprendiIds.has(o.id));

  if (riprendi.length > 0) {
    // "Ieri/oggi HH:MM" — l'operatore capisce al volo quando ha lasciato.
    const fmtUltima = (iso) => {
      const dt = new Date(iso);
      const dIso = toLocalISO(dt);
      const oggi = toLocalISO(new Date());
      const ieriD = new Date(); ieriD.setDate(ieriD.getDate() - 1);
      const hm = z(dt.getHours()) + ':' + z(dt.getMinutes());
      if (dIso === oggi) return 'oggi ' + hm;
      if (dIso === toLocalISO(ieriD)) return 'ieri ' + hm;
      return fmtIT(dIso) + ' ' + hm;
    };
    const sec = el('div', { class:'kiosk-op-section' });
    sec.append(el('div', { class:'kiosk-op-section-hd', style:'color:var(--acc);border-color:var(--acc);' },
      '▶ Riprendi — ultime su cui hai lavorato'));
    const grid = el('div', { class:'kiosk-op-grid' });
    riprendi.forEach(o => {
      const card = kioskOpCard(o);
      card.style.borderColor = 'var(--acc)';
      card.style.boxShadow = '0 0 0 1px var(--acc)';
      card.append(el('div', {
        style:'margin-top:8px;font-family:JetBrains Mono,monospace;font-size:12px;color:var(--acc);font-weight:700;',
      }, '⏸ ultima timbratura: ' + fmtUltima(ultimaSess[o.id])));
      grid.append(card);
    });
    sec.append(grid);
    root.append(sec);
  }

  // Sezione "Le tue operazioni"
  if (mieRestanti.length > 0) {
    const sec = el('div', { class:'kiosk-op-section' });
    sec.append(el('div', { class:'kiosk-op-section-hd' }, '⭐ Le tue operazioni assegnate'));
    // Admin: trascina le schede per riordinare (drag col mouse). Solo senza
    // ricerca attiva, così si riordina l'elenco completo e non un sottoinsieme.
    const dndOn = isAdmin && !q;
    if (dndOn) sec.append(el('div', { class:'prio-hint', style:'margin:-2px 0 10px;' },
      '⠿ Trascina le schede per dare priorità (un clic breve avvia il lavoro).'));
    const grid = el('div', { class:'kiosk-op-grid' });
    mieRestanti.forEach(o => {
      const card = kioskOpCard(o);
      card.dataset.opid = o.id;
      grid.append(card);
    });
    if (dndOn) kioskAttachReorder(grid);
    sec.append(grid);
    root.append(sec);
  } else if (!q && !kCom.vediAltre && riprendi.length === 0) {
    root.append(el('div', { class:'kiosk-empty', style:'padding:20px;' },
      'Nessuna operazione assegnata a te. Clicca "Vedi tutte" per scegliere da quelle aperte.'));
  }

  // Sezione "Altre operazioni"
  if (kCom.vediAltre || q) {
    if (altreFiltered.length > 0) {
      const sec = el('div', { class:'kiosk-op-section' });
      sec.append(el('div', { class:'kiosk-op-section-hd', style:'color:var(--mut);border-color:var(--brd);' },
        '🔍 Altre operazioni aperte'));
      const grid = el('div', { class:'kiosk-op-grid' });
      altreFiltered.forEach(o => grid.append(kioskOpCard(o)));
      sec.append(grid);
      root.append(sec);
    } else if (q && mieFiltered.length === 0) {
      root.append(el('div', { class:'kiosk-empty' }, 'Nessuna operazione trovata per "' + kCom.search + '"'));
    }
  }

  // Sezione "Completate da te" (comprimibile): commesse dove l'operatore ha
  // dichiarato finita la propria fase. Da qui può riaprirne una marcata per
  // sbaglio: ricominciando a lavorarci (selezione + tipo) il flag si azzera.
  const completateFiltered = collassa(filtra(completateDaMe));
  if (completateFiltered.length > 0) {
    const aperta = kCom.vediCompletate || !!q;
    const sec = el('div', { class:'kiosk-op-section' });
    sec.append(el('div', {
      class:'kiosk-op-section-hd',
      style:'color:var(--grn);border-color:var(--grn);cursor:pointer;',
      onclick: () => { kCom.vediCompletate = !kCom.vediCompletate; kioskRenderOpList(); },
    }, (aperta ? '▾' : '▸') + ' ✓ Completate da te (' + completateFiltered.length + ')'));
    if (aperta) {
      const grid = el('div', { class:'kiosk-op-grid' });
      completateFiltered.forEach(o => grid.append(kioskOpCard(o, { readonly: true, reopen: true })));
      sec.append(grid);
    }
    root.append(sec);
  }
}

// Blocco-info STANDARD del kiosk, riusato in tutte le viste per coerenza.
//   CODICE (grande)                         📅 scadenza (colorata per urgenza)
//   descrizione (grande)
//   cliente · OC · OP · Rif. cliente · quantità   (valori; campi vuoti nascosti)
// opts.scadenza === false → nasconde la scadenza.
function kioskInfoBlock(op, opts = {}) {
  const showScad = opts.scadenza !== false;
  const cli = state.aziende.find(c => c.id === op.cliente_id);
  const art = state.articoli.find(a => a.id === op.articolo_id);

  let scadEl = null;
  if (showScad && op.scadenza) {
    const oggi = toLocalISO(new Date());
    let scadCls = '';
    if (op.scadenza < oggi) scadCls = 'passata';
    else { const diff = (parseISODate(op.scadenza) - new Date()) / 86400000; if (diff <= 3) scadCls = 'vicina'; }
    scadEl = el('div', { class:'kib-scad ' + scadCls }, '📅 ' + fmtIT(op.scadenza));
  }

  const parts = [];
  if (cli?.nome) parts.push(cli.nome);
  if (op.numero_ordine) parts.push(op.numero_ordine);
  if (op.numero_op) parts.push(op.numero_op);
  if (op.riferimento_cliente) parts.push(op.riferimento_cliente);
  parts.push((op.quantita || 0) + ' pz');

  return el('div', { class:'kib' },
    el('div', { class:'kib-head' },
      el('div', { class:'kib-cod' }, art?.codice || '— senza codice —'),
      scadEl,
    ),
    art?.descrizione ? el('div', { class:'kib-desc' }, art.descrizione) : null,
    el('div', { class:'kib-meta' }, parts.join('  ·  ')),
  );
}

function kioskOpCard(o, opts = {}) {
  // Stato avanzamento (se la commessa è già stata iniziata).
  let stato = 'intonsa';
  let oreCons = 0, orePrev = 0, perc = 0;
  if (kioskState.opIniziate.has(o.id)) {
    oreCons = kioskState.opOreCons[o.id] || 0;
    orePrev = ((o.quantita || 0) * (o.minuti_unitari || 0)) / 60;
    if (orePrev > 0) {
      perc = oreCons / orePrev;
      if (oreCons > orePrev + tolleranzaOre(orePrev)) stato = 'prog-sfora';
      else if (perc >= 0.9) stato = 'prog-vicino';
      else                  stato = 'prog-ok';
    } else {
      stato = 'noprev';
    }
  }

  // Indicatore avanzamento compatto a destra della riga + barra in fondo.
  let progEl = null, progBar = null;
  if (stato === 'prog-ok' || stato === 'prog-vicino' || stato === 'prog-sfora') {
    const percRound = Math.round(perc * 100);
    const chipCls = stato === 'prog-sfora' ? 'sfora' : stato === 'prog-vicino' ? 'vicino' : '';
    const tip = oreCons.toFixed(1) + 'h su ' + orePrev.toFixed(1) + 'h preventivate'
      + (oreCons > orePrev + tolleranzaOre(orePrev) ? ' (sforamento +' + (oreCons - orePrev).toFixed(1) + 'h)' : '');
    progEl = el('span', { class:'kop-prog-chip ' + chipCls, title: tip }, percRound + '%');
    progBar = el('div', { class:'kop-rowbar', title: tip },
      el('div', { class:'kop-progress-fill ' + chipCls, style:'width:' + Math.min(100, perc * 100) + '%;' }));
  } else if (stato === 'noprev') {
    progEl = el('span', {
      class:'kop-prog-chip sfora',
      title: 'Iniziata senza minuti unitari: nessun preventivo ore. Aggiornare in pianificazione.',
    }, '⚠ no prev.');
  }

  // Nota (extra, solo dove presente)
  const noteRow = o.note ? el('div', { class:'kop-note-row', title: o.note }, '✎ ' + o.note) : null;

  // Striscia fasi PER-OPERATORE: a colpo d'occhio cosa ha già chiuso e cosa gli
  // resta su questa commessa. Risponde a "è finita per la mia parte?" sulla card.
  let fasiStrip = null;
  {
    const uidCard = kioskState.utenteSelezionato?.id;
    if (uidCard) {
      const st = kioskFasiUtente(uidCard, o.id);
      // Mostro la striscia solo se l'operatore ha almeno una fase VERA assegnata.
      // Commesse senza fasi (solo riga "tutta la commessa") restano come prima.
      if (st.righe.some(r => r.fase_id)) {
        const chips = st.righe.map(r => el('span', {
          class: 'kop-fase-chip ' + (r.fatta ? 'fatta' : 'resta'),
          title: r.nome + (r.fatta ? ' — completata da te' : ' — ancora da fare'),
        }, (r.fatta ? '✓ ' : '⏳ ') + r.nome));
        fasiStrip = el('div', { class:'kop-fasi-strip' },
          el('span', { class:'kop-fasi-label' }, 'Le tue fasi:'),
          ...chips);
      }
    }
  }

  // Stato preparazione materiale (richiesto dalla produzione): pallino + etichetta.
  const prepKey = o.stato_preparazione || 'vuoto';
  const prepInline = el('div', { class:'kop-prep-inline' },
    el('span', { class:'prep-dot ' + (OP_PREP[prepKey]?.classe || 'vuoto') }),
    'Materiale: ' + (OP_PREP[prepKey]?.label || '—'),
  );

  // Pulsante "Riapri" per le schede completate (annulla "ho finito la mia fase").
  const footRight = opts.reopen
    ? el('div', { style:'display:flex;align-items:center;gap:10px;flex-shrink:0;' },
        progEl,
        el('button', { class:'kop-reopen-btn',
          onclick: (e) => { e.stopPropagation(); kioskRiapriManuale(o.id); } },
          '↩ Riapri'))
    : progEl;
  const footer = el('div', { class:'kop-row-foot' }, prepInline, footRight);
  const rowClass = 'kiosk-op-row' + (stato !== 'intonsa' ? ' stato-' + stato : '');
  // Banner GRUPPO: la card rappresenta più commesse accorpate. Il tempo che
  // timbri qui si divide in parti uguali su tutte quelle elencate.
  let gruppoBanner = null;
  if (o._gruppoMembri && o._gruppoMembri.length > 1) {
    // Mostro ordine + pezzi di ciascuna: il tempo si divide in proporzione
    // ai pezzi (lavoro previsto), non in parti uguali.
    const voci = o._gruppoMembri.map(m => (m.numero_ordine || '—') + ' (' + (m.quantita ?? '?') + 'pz)');
    gruppoBanner = el('div', { class:'kop-gruppo-banner',
      title:'Timbrando qui il tempo si divide sulle ' + voci.length + ' commesse in proporzione ai pezzi' },
      '⊞ Gruppo di ' + voci.length + ' — tempo diviso per pezzi su: ' + voci.join('  ·  '));
  }
  const children = [ gruppoBanner, kioskInfoBlock(o), noteRow, fasiStrip, footer, progBar ];

  // Modalità sola lettura: riga non cliccabile.
  if (opts.readonly) {
    return el('div', { class: rowClass, style:'cursor:default;' }, ...children);
  }
  return el('button', {
    class: rowClass,
    onclick: () => kioskSelectOperazione(o),
  }, ...children);
}

function kioskSelectOperazione(o) {
  kCom.opSelezionata = o;
  kioskBeep('ok');
  kioskGoToTipo();
}

// ─── Schermata selezione tipo lavorazione ───
function kioskGoToTipo() {
  kioskHideAllSteps();
  $('#kiosk-step-tipo').style.display = 'flex';
  kioskRenderTipo();
  kioskResetInactivity();
}

function kioskRenderTipo() {
  const o = kCom.opSelezionata;
  if (!o) { kioskGoToOpList(); return; }
  const root = $('#kiosk-tipo-content');
  root.innerHTML = '';

  // Riepilogo operazione (blocco-info standard)
  root.append(el('div', { style:'background:var(--sur);border:1px solid var(--brd);border-radius:8px;padding:14px 18px;margin-bottom:20px;' },
    el('div', { style:'font-family:JetBrains Mono,monospace;font-size:11px;color:var(--mut);letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px;' }, 'Operazione selezionata'),
    kioskInfoBlock(o),
  ));

  // ── Se la commessa ha fasi → scelta della FASE (taggata sulla mansione) ──
  const fasi = opFasiOf(o);
  if (fasi.length > 0) {
    const u = kioskState.utenteSelezionato;
    // L'operatore può avere PIÙ fasi assegnate (es. cablaggio + collaudo),
    // chiuse in momenti diversi. Le ordino così: prima le MIE ancora DA FARE,
    // poi le altre non mie, infine le MIE già completate (in coda, smorzate).
    const mieRighe = addettoRigheUtenteOp(u?.id, o.id);
    const mieFasiIds = new Set(mieRighe.map(r => r.fase_id).filter(Boolean));
    const fatteFasiIds = new Set(mieRighe.filter(r => r.completata_il)
      .map(r => r.fase_id).filter(Boolean));
    const rank = (f) => {
      const mia = mieFasiIds.has(f.id), fatta = fatteFasiIds.has(f.id);
      if (mia && !fatta) return 0;   // mie da fare → in cima
      if (mia && fatta)  return 2;   // mie già chiuse → in fondo
      return 1;                       // non mie → in mezzo
    };
    const ordinate = fasi.slice().sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      return (a.ordine || 0) - (b.ordine || 0);
    });

    const daFare = mieFasiIds.size - fatteFasiIds.size;
    root.append(el('div', { class:'kiosk-tipo-hint' },
      'Scegli la fase su cui timbri'
      + (daFare > 0 ? ' (★ le tue ancora da fare in cima)'
                    : mieFasiIds.size ? ' (le tue fasi le hai già chiuse tutte)' : '') + ':'));

    const grid = el('div', { class:'kiosk-tipo-grid' });
    ordinate.forEach(f => {
      const tipo = state.tipiLav.find(t => t.id === f.tipo_lavorazione_id);
      const col = tipo?.colore || '#6b6b64';
      const mia = mieFasiIds.has(f.id);
      const fatta = fatteFasiIds.has(f.id);
      grid.append(el('button', {
        class:'kiosk-tipo-btn' + (mia && !fatta ? ' mia-fase' : '') + (fatta ? ' fase-fatta' : ''),
        style:'border-color:'+col+';',
        onclick: () => kioskSelectFase(f),
      },
        el('div', { class:'ktipo-color-bar', style:'background:'+col+';' }),
        el('div', { class:'ktipo-name' }, tipo?.nome || 'Fase'),
        el('div', { class:'ktipo-meta' }, (Number(f.minuti_unitari) > 0 ? f.minuti_unitari + ' min/pz' : '—')),
        fatta ? el('div', { class:'ktipo-fatta-badge' }, '✓ Completata da te')
              : (mia ? el('div', { class:'ktipo-mia-badge' }, '★ La tua fase') : null),
      ));
    });
    root.append(grid);

    // Oltre alle fasi a piano, l'operatore (urgenza) può timbrare un ALTRO tipo
    // non previsto: la fase verrà creata al volo all'avvio e lui iscritto lì.
    const tipiFase = new Set(fasi.map(f => f.tipo_lavorazione_id));
    const altri = state.tipiLav.filter(t => t.attivo && !tipiFase.has(t.id))
      .sort((a, b) => (a.ordine || 0) - (b.ordine || 0));
    if (altri.length) {
      root.append(el('div', { class:'kiosk-tipo-hint', style:'margin-top:22px;' },
        'Altro tipo di lavorazione (fuori piano):'));
      const grid2 = el('div', { class:'kiosk-tipo-grid' });
      altri.forEach(t => {
        grid2.append(el('button', {
          class:'kiosk-tipo-btn',
          style:'border-color:'+(t.colore||'#6b6b64')+';',
          onclick: () => kioskSelectTipo(t),
        },
          el('div', { class:'ktipo-color-bar', style:'background:'+(t.colore||'#6b6b64')+';' }),
          el('div', { class:'ktipo-name' }, t.nome),
        ));
      });
      root.append(grid2);
    }
    return;
  }

  // ── Fallback: commessa senza fasi → scelta tipo lavorazione libero ──
  const tipi = state.tipiLav
    .filter(t => t.attivo)
    .sort((a,b) => (a.ordine||0) - (b.ordine||0));

  if (tipi.length === 0) {
    root.append(el('div', { class:'kiosk-empty' }, 'Nessun tipo di lavorazione definito. L\'admin deve crearne almeno uno in Anagrafiche → Tipi lavorazione.'));
    return;
  }

  const grid = el('div', { class:'kiosk-tipo-grid' });
  tipi.forEach(t => {
    grid.append(el('button', {
      class:'kiosk-tipo-btn',
      style: 'border-color:'+(t.colore||'#6b6b64')+';',
      onclick: () => kioskSelectTipo(t),
    },
      el('div', { class:'ktipo-color-bar', style:'background:'+(t.colore||'#6b6b64')+';' }),
      el('div', { class:'ktipo-name' }, t.nome),
    ));
  });
  root.append(grid);
}

async function kioskSelectTipo(tipo) {
  if (!tipo) return;
  kioskAvviaSessione(tipo.id, null);
}

// Avvio da scelta FASE: tagga la sessione con la fase e il suo tipo lavorazione.
function kioskSelectFase(fase) {
  if (!fase) return;
  kioskAvviaSessione(fase.tipo_lavorazione_id, fase.id);
}

// ── Guardia anti-accavallamento (7 ago) ───────────────────────────────────
// Chiude sul SERVER le sessioni rimaste aperte di questo operatore, prima di
// aprirne una nuova. Non guarda `state.sessioni`: è proprio quello il punto.
//
// I 5 accavallamenti trovati nei dati erano TUTTI nati al kiosk, e il motivo è
// che ogni postazione si fida della propria copia locale. Con due postazioni,
// la seconda non sa che sulla prima c'è un timbro aperto: crede l'operatore
// libero, ne apre un altro, e le ore si contano due volte finché qualcuno
// chiude il primo. Una lettura al server prima di ogni avvio toglie il caso
// alla radice, e costa un giro di rete su un'operazione che ne fa già diversi.
// Ritorna quante ne ha chiuse.
async function kioskChiudiAperteRimaste(uid) {
  if (!uid) return 0;
  const ora = new Date().toISOString();
  const { data, error } = await eseguiConRetry(
    () => sb.from('sessioni_lavoro').select('*').eq('utente_id', uid).is('fine', null),
    { label: 'controllo timbri aperti' });
  if (error || !data || !data.length) return 0;
  let chiuse = 0;
  for (const riga of data) {
    // Stessa strada delle altre chiusure: se la commessa è raggruppata il
    // tempo si spalma. Nella prima versione di stamattina questo update era
    // secco e aveva lo stesso buco della pausa pranzo.
    try { await chiudiConSplitGruppo(riga, ora, null); chiuse++; }
    catch (e) { /* il prossimo avvio riproverà */ }
  }
  return chiuse;
}

// Crea la sessione di lavoro al kiosk. faseId opzionale: la chiave fase_id
// viene inclusa SOLO se valorizzata, così se la colonna non esiste ancora il
// flusso classico (tipo libero) continua a funzionare.
async function kioskAvviaSessione(tipoId, faseId) {
  const u = kioskState.utenteSelezionato;
  const o = kCom.opSelezionata;
  if (!u || !o || !tipoId) return;

  // Risolvo la fase. Tipo fuori piano su commessa con fasi → la creo al volo
  // (urgenza), così sessione e iscrizione finiscono su quella fase precisa.
  let fid = faseId || null;
  if (!fid) fid = await kioskRisolviOCreaFase(o.id, tipoId);

  // Se l'operatore sta per ritimbrare una SUA fase già marcata finita, chiedo
  // conferma: evita riaperture silenziose per un tocco sbagliato sul kiosk
  // condiviso. Se annulla, non avvio nulla e non riapro la fase.
  if (fid) {
    const rigaFatta = addettoRigheUtenteOp(u.id, o.id)
      .find(r => (r.fase_id || null) === fid && r.completata_il);
    if (rigaFatta) {
      const fObj = (state.opFasi || []).find(ff => ff.id === fid);
      const tObj = fObj && state.tipiLav.find(tt => tt.id === fObj.tipo_lavorazione_id);
      const nf = tObj?.nome || 'questa fase';
      const ok = confirm('Hai già marcato finita la fase "' + nf + '" su questa commessa.\n\n'
        + 'Vuoi riaprirla e ricominciare a timbrarci?');
      if (!ok) { kioskGoToTipo(); return; }
    }
  }

  // Prima di aprire: chiudo sul server quello che fosse rimasto aperto altrove.
  await kioskChiudiAperteRimaste(u.id);

  const payload = {
    operazione_id: o.id,
    utente_id: u.id,
    tipo_lavorazione_id: tipoId,
    sede: 'kiosk',
    inizio: new Date().toISOString(),
  };
  if (fid) payload.fase_id = fid;

  try {
    const { data, error } = await eseguiConRetry(
      () => sb.from('sessioni_lavoro').insert(payload).select().single(),
      { label: 'avvio timbratura' }
    );
    if (error) {
      kioskBeep('err');
      kioskShowError('Errore: ' + error.message);
      return;
    }
    // Aggiorna cache locale
    if (!state.sessioni.find(s => s.id === data.id)) state.sessioni.unshift(data);
    // Auto-iscrizione: chi timbra su una fase ne diventa addetto (se non lo era già).
    await kioskAssicuraAddetto(u.id, o.id, fid, tipoId);
    // Se l'operatore aveva marcato finita la fase che sta riavviando,
    // ricominciare a lavorarci la riapre (solo quella).
    await kioskRiapriFaseSeCompletata(u.id, o.id, fid);
    kioskBeep('ok');
    kioskGoToAttiva();
  } catch (e) {
    kioskBeep('err');
    kioskShowError('Errore di rete: ' + (e.message||e));
  }
}

// Risolve la fase per un tipo timbrato:
//  - commessa SENZA fasi → null (timbratura "libera");
//  - tipo già presente come fase → quella fase;
//  - tipo FUORI PIANO su commessa con fasi → CREA la fase al volo e la ritorna.
async function kioskRisolviOCreaFase(opId, tipoId) {
  const fasiOp = (state.opFasi || []).filter(f => f.operazione_id === opId);
  if (!fasiOp.length) return null;
  const esistente = fasiOp.find(f => f.tipo_lavorazione_id === tipoId);
  if (esistente) return esistente.id;
  const ordine = fasiOp.reduce((m, f) => Math.max(m, Number(f.ordine) || 0), 0) + 1;
  try {
    const { data, error } = await eseguiConRetry(
      () => sb.from('operazioni_fasi')
        .insert({ operazione_id: opId, tipo_lavorazione_id: tipoId, minuti_unitari: 0, ordine })
        .select().single(),
      { label: 'creazione fase al volo' }
    );
    if (error || !data) return null;
    if (!state.opFasi.find(x => x.id === data.id)) state.opFasi.push(data);
    return data.id;
  } catch (_) { return null; }
}

// ─── FLUSSO ATTIVITÀ EXTRA ───
// Stesso pattern del flusso commesse, ma più semplice: l'utente seleziona
// un'attività dall'anagrafica (attivita_extra) e parte direttamente la sessione.
// Non c'è scelta del "tipo lavorazione" (non si applica ad attività non commessa).

function kioskGoToAttivita() {
  kioskHideAllSteps();
  $('#kiosk-step-attivita-list').style.display = 'flex';
  kioskRenderAttivitaList();
  kioskResetInactivity();
}

function kioskRenderAttivitaList() {
  const root = $('#kiosk-attivita-list-content');
  root.innerHTML = '';

  const list = (state.attivitaExtra || [])
    .filter(a => a.attivo !== false)
    .slice()
    .sort((a, b) => (a.ordine||0) - (b.ordine||0) || a.nome.localeCompare(b.nome));

  if (list.length === 0) {
    root.append(el('div', { class:'kiosk-empty' },
      'Nessuna attività extra configurata. Chiedi a un admin di crearle in Gestione → Attività extra.'));
    return;
  }

  const grid = el('div', { class:'kiosk-attivita-grid' });
  list.forEach(a => grid.append(kioskAttivitaCard(a)));
  root.append(grid);
}

function kioskAttivitaCard(a) {
  return el('button', {
    class:'kiosk-attivita-card',
    style:'border-left:6px solid '+(a.colore || '#6b6b64')+';',
    onclick: () => kioskSelectAttivita(a),
  },
    el('div', { class:'kac-nome' }, a.nome),
    a.descrizione
      ? el('div', { class:'kac-desc' }, a.descrizione)
      : null,
  );
}

// Schermata "su cosa stai lavorando": esce solo per le attività che lo
// richiedono. I riferimenti già usati sono BOTTONI — è la strada normale, e
// serve a non ribattezzare a mano lo stesso lavoro ogni volta. La tastiera è
// per il primo battesimo.
function kioskChiediRiferimento(a) {
  return new Promise((risolvi) => {
    kioskHideAllSteps();
    const step = $('#kiosk-step-done') || document.body;
    const prec = step.style.display;
    step.style.display = 'flex';
    const card = $('#done-card') || step;
    const vecchio = card.innerHTML;
    card.innerHTML = '';
    const chiudi = (val) => { card.innerHTML = vecchio; step.style.display = prec; risolvi(val); };

    const recenti = rifRecenti(a.id);
    const inp = el('input', {
      type:'text', placeholder:'…oppure scrivilo qui (es. quadro Barilla giugno)',
      style:'width:100%;font-size:17px;padding:12px;border-radius:6px;border:1px solid var(--brd);'
        + 'background:var(--sur);color:var(--txt);font-family:var(--ui);margin-top:12px;',
      oninput: () => aggiorna(),
    });
    const btnOk = el('button', { class:'kiosk-attiva-btn',
      style:'background:var(--grn);color:var(--bg);margin-top:12px;' }, '▶ Inizia');
    const aggiorna = () => {
      const v = (inp.value || '').trim();
      btnOk.disabled = !v;
      btnOk.style.opacity = v ? '1' : '.4';
    };
    // Se quello che scrive è lo stesso lavoro già battezzato (a meno di
    // maiuscole e spazi), si riusa la forma originale: due totali separati per
    // la stessa cosa sarebbero invisibili e sbagliati.
    btnOk.onclick = () => {
      const v = (inp.value || '').trim();
      const gia = recenti.find(r => rifChiave(r.rif) === rifChiave(v));
      chiudi(gia ? gia.rif : v);
    };

    const elenco = el('div', { style:'display:flex;flex-direction:column;gap:8px;margin-top:12px;' });
    recenti.slice(0, 6).forEach(r => {
      const b = el('button', { class:'kiosk-attiva-btn',
        style:'background:var(--sur);color:var(--txt);border:1px solid var(--brd);text-align:left;' },
        el('div', { style:'font-weight:700;' }, '▶ ' + r.rif),
        el('div', { style:'font-size:13px;opacity:.75;margin-top:2px;' },
          r.ore.toFixed(1).replace('.', ',') + ' h già timbrate · ultima volta '
          + fmtIT(toLocalISO(new Date(r.ultimo)))),
      );
      b.onclick = () => chiudi(r.rif);
      elenco.append(b);
    });

    card.append(
      el('div', { style:'font-size:20px;font-weight:700;margin-bottom:4px;' },
        a.nome + ' — su cosa?'),
      el('div', { class:'sub', style:'font-size:13px;' },
        recenti.length
          ? 'Riprendi un lavoro già aperto, oppure scrivine uno nuovo. Le ore si sommano per lavoro.'
          : 'Scrivi a cosa stai lavorando: da qui in avanti lo ritroverai in elenco e le ore si sommeranno lì.'),
      elenco, inp, btnOk,
      el('button', { class:'kiosk-attiva-btn pause', style:'margin-top:8px;',
        onclick: () => chiudi(null) }, '← Torna indietro'),
    );
    aggiorna();
  });
}

async function kioskSelectAttivita(a, rifGiaScelto) {
  const u = kioskState.utenteSelezionato;
  if (!u || !a) return;

  // "Su cosa" si chiede PRIMA di toccare qualsiasi cosa: se l'operatore torna
  // indietro non deve trovarsi la sessione precedente già chiusa.
  let riferimento = rifGiaScelto || null;
  const vuoleRif = !!a.richiede_riferimento && sessioniRifAttivo();
  if (vuoleRif && !riferimento) {
    riferimento = await kioskChiediRiferimento(a);
    if (!riferimento) return kioskGoToAttivita();   // annullato: si resta a scegliere
  }

  // Eventuale sessione aperta dell'utente: la chiudo prima di aprire la nuova.
  // Stesso pattern dello switch.
  const sessAperta = state.sessioni.find(s => s.utente_id === u.id && !s.fine);
  if (sessAperta) {
    // Se quella che si sta chiudendo è un'attività extra, la nota si chiede
    // anche qui: altrimenti passando da un'extra all'altra si sfuggirebbe.
    let notaPrec = null;
    if (!sessAperta.operazione_id) {
      notaPrec = await kioskChiediNota(sessAperta);
      if (notaPrec === null) return;   // annullato: non si apre neanche la nuova
    }
    try {
      await kioskChiudiOScarta(sessAperta, notaPrec);
    } catch (e) {
      kioskBeep('err');
      kioskShowError('Errore chiudendo la sessione precedente: ' + (e.message || e));
      return;
    }
  }

  // Prima di aprire: chiudo sul server quello che fosse rimasto aperto altrove
  // (un'altra postazione non la vede la copia locale — vedi kioskChiudiAperteRimaste).
  await kioskChiudiAperteRimaste(u.id);

  // Apro nuova sessione su attività extra (operazione_id resta null)
  try {
    const inizio = new Date().toISOString();
    const riga = {
      operazione_id: null,
      attivita_id: a.id,
      utente_id: u.id,
      tipo_lavorazione_id: null,
      sede: 'kiosk',
      inizio,
    };
    // La colonna arriva da una migrazione: senza, non la si manda proprio.
    if (riferimento && sessioniRifAttivo()) riga.riferimento = riferimento;
    const { data, error } = await eseguiConRetry(
      () => sb.from('sessioni_lavoro').insert(riga).select().single(),
      { label: 'avvio attività extra' }
    );
    if (error) {
      kioskBeep('err');
      kioskShowError('Errore: ' + error.message);
      return;
    }
    if (!state.sessioni.find(s => s.id === data.id)) state.sessioni.unshift(data);
    kioskBeep('ok');
    kioskGoToAttiva();
  } catch (e) {
    kioskBeep('err');
    kioskShowError('Errore di rete: ' + (e.message||e));
  }
}

// ─── Schermata sessione attiva ───
function kioskGoToAttiva() {
  kioskHideAllSteps();
  $('#kiosk-step-attiva').style.display = 'flex';
  kioskRenderAttiva();
  // Avvia timer per refresh durata ogni secondo
  if (state.kioskTimer) clearInterval(state.kioskTimer);
  state.kioskTimer = setInterval(kioskRefreshDurata, 1000);
  kioskResetInactivity();
}

// Riga "prossima assegnata": contenitore + blocco-info standard (anteprima).
function kioskProssimaRow(op) {
  // Stesse informazioni delle righe di selezione (prep materiale, avanzamento,
  // bordo di stato), ma in sola lettura: schermate simili = stesse info.
  return kioskOpCard(op, { readonly: true });
}

function kioskRenderAttiva() {
  const u = kioskState.utenteSelezionato;
  if (!u) { kioskGoToId(); return; }
  const sess = state.sessioni.find(s => s.utente_id === u.id && !s.fine);
  if (!sess) {
    // Nessuna sessione aperta: torna al menu
    kioskGoToMenu();
    return;
  }

  $('#kiosk-attiva-name').textContent = 'Stai lavorando, ' + u.nome;
  const root = $('#kiosk-attiva-content');
  root.innerHTML = '';

  // La sessione può essere su una commessa (operazione_id) o su un'attività
  // extra (attivita_id). Le due informazioni sono mutuamente esclusive.
  const isAttivitaExtra = !!sess.attivita_id;
  const attivita = isAttivitaExtra
    ? (state.attivitaExtra || []).find(x => x.id === sess.attivita_id)
    : null;
  const o = !isAttivitaExtra
    ? state.operazioni.find(x => x.id === sess.operazione_id)
    : null;
  const cli = o ? state.aziende.find(c => c.id === o.cliente_id) : null;
  const art = o ? state.articoli.find(a => a.id === o.articolo_id) : null;
  const tipo = state.tipiLav.find(t => t.id === sess.tipo_lavorazione_id);

  // Warning sessione molto vecchia (>12h)
  const inizioDate = new Date(sess.inizio);
  const ageH = (Date.now() - inizioDate.getTime()) / 3600000;
  if (ageH > 12) {
    root.append(el('div', { class:'kiosk-warn-stale' },
      el('strong', {}, '⚠ Sessione aperta da più di 12 ore'),
      el('div', { style:'margin-top:6px;' },
        'Iniziata il ' + fmtIT(toLocalISO(inizioDate)) + ' alle ' + fmtT(inizioDate) + '. Forse hai dimenticato di sospenderla?'),
    ));
  }

  // Card sessione attiva: contenuto diverso per attività extra vs commessa
  const card = el('div', { class:'kiosk-attiva-card' });
  if (isAttivitaExtra) {
    card.append(
      el('div', { class:'kiosk-attiva-cliente' }, attivita?.nome || '— attività sconosciuta —'),
      attivita?.descrizione
        ? el('div', { class:'kiosk-attiva-tipo' },
            el('div', { class:'ktipo-color-bar', style:'background:'+(attivita.colore||'#6b6b64')+';' }),
            attivita.descrizione)
        : el('div', { class:'kiosk-attiva-tipo' },
            el('div', { class:'ktipo-color-bar', style:'background:'+(attivita?.colore||'#6b6b64')+';' }),
            'Attività extra'),
      el('div', { class:'kiosk-attiva-stats' },
        el('div', { class:'kas-block' },
          el('div', { class:'kas-label' }, 'Iniziato alle'),
          el('div', { class:'kas-value' }, fmtT(inizioDate)),
        ),
        el('div', { class:'kas-block' },
          el('div', { class:'kas-label' }, 'Durata'),
          el('div', { class:'kas-value', id:'kiosk-durata-live' }, kioskFormatDurataLive(inizioDate)),
        ),
      ),
    );
  } else {
    card.append(
      o ? kioskInfoBlock(o)
        : el('div', { class:'kiosk-attiva-cliente' },
            '⚠ Commessa non più disponibile',
            el('div', { style:'font-size:12px;color:var(--mut);font-weight:400;margin-top:6px;' },
              'Probabilmente è stata completata o spedita dal gestionale mentre lavoravi. '
              + 'Termina pure la sessione: le ore restano registrate.')),
      el('div', { class:'kiosk-attiva-tipo', style:'margin-top:14px;' },
        el('div', { class:'ktipo-color-bar', style:'background:'+(tipo?.colore||'#6b6b64')+';' }),
        tipo?.nome || '— tipo sconosciuto —',
      ),
      el('div', { class:'kiosk-attiva-stats' },
        el('div', { class:'kas-block' },
          el('div', { class:'kas-label' }, 'Iniziato alle'),
          el('div', { class:'kas-value' }, fmtT(inizioDate)),
        ),
        el('div', { class:'kas-block' },
          el('div', { class:'kas-label' }, 'Durata'),
          el('div', { class:'kas-value', id:'kiosk-durata-live' }, kioskFormatDurataLive(inizioDate)),
        ),
      ),
    );
  }
  root.append(card);

  // Azioni DIRETTE: niente più tasto "Termina" intermedio (che a volte non
  // mostrava la scelta, a seconda dei permessi/dati). Se la sessione è su una
  // fase precisa → due tasti: "Ho finito" e "Sospendo". Altrimenti (attività
  // extra o senza fase) → un solo tasto di chiusura.
  const actions = el('div', { class:'kiosk-attiva-actions' });
  if (sess.operazione_id) {
    actions.append(el('button', {
      class:'kiosk-attiva-btn', style:'background:var(--grn);color:var(--bg);',
      onclick: () => kioskFineFase(sess),
    }, '✅ Ho finito la mia fase'));
    actions.append(el('button', {
      class:'kiosk-attiva-btn pause',
      onclick: () => kioskStopSessione(sess, 'pause'),
    }, '⏸ Sospendo, continuo dopo'));
  } else {
    actions.append(el('button', {
      class:'kiosk-attiva-btn pause',
      onclick: () => kioskStopSessione(sess, 'pause'),
    }, '⏹ Termina'));
  }
  root.append(actions);

  // ─── Coda: prossime commesse assegnate a questo operatore ───
  // Operazioni assegnate a lui (opAddetti), ancora aperte, escluse quelle in
  // corso, ordinate per scadenza. Solo informativo (anteprima della coda).
  const attiveIds = new Set(
    state.sessioni.filter(s => s.utente_id === u.id && !s.fine)
      .map(s => s.operazione_id).filter(Boolean)
  );
  const mieIds = new Set(
    state.opAddetti.filter(r => r.utente_id === u.id).map(r => r.operazione_id)
  );
  const prossime = state.operazioni
    .filter(op => op.stato !== 'spedita' && op.stato !== 'completata')
    .filter(op => mieIds.has(op.id) && !attiveIds.has(op.id) && !opCompletataDaUtente(u.id, op.id))
    .sort(cmpCommessaKiosk);

  if (prossime.length > 0) {
    const CAP = 8;
    const sec = el('div', { class:'kiosk-prossime', style:'margin-top:24px;width:100%;' });
    sec.append(el('div', {
      style:'font-size:13px;font-weight:700;color:var(--mut,#888);text-transform:uppercase;letter-spacing:.6px;margin-bottom:12px;text-align:center;'
    }, 'Prossime assegnate a te (' + prossime.length + ')'));
    const lista = el('div', { style:'display:flex;flex-direction:column;gap:8px;align-items:stretch;' });
    prossime.slice(0, CAP).forEach(op => lista.append(kioskProssimaRow(op)));
    sec.append(lista);
    if (prossime.length > CAP) {
      sec.append(el('div', { style:'text-align:center;font-size:13px;color:var(--mut,#888);margin-top:10px;' },
        '+ altre ' + (prossime.length - CAP) + ' assegnate'));
    }
    root.append(sec);
  }
}

function kioskRefreshDurata() {
  const u = kioskState.utenteSelezionato;
  if (!u) return;
  const sess = state.sessioni.find(s => s.utente_id === u.id && !s.fine);
  if (!sess) return;
  const liveEl = $('#kiosk-durata-live');
  if (liveEl) liveEl.textContent = kioskFormatDurataLive(new Date(sess.inizio));
}

function kioskFormatDurataLive(inizioDate) {
  const sec = Math.floor((Date.now() - inizioDate.getTime()) / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return h+'h '+String(m).padStart(2,'0')+'m';
  if (m > 0) return m+'m '+String(s).padStart(2,'0')+'s';
  return s+'s';
}

// Chiude una sessione scrivendo la fine passata, spalmando sul gruppo se la commessa
// ne fa parte. UNA sola strada per tutte le chiusure automatiche (7 ago): la
// pausa pranzo faceva un update secco e NON spalmava, quindi chi lavorava a
// mezzogiorno su una commessa raggruppata si vedeva tutte le ore su una sola
// posizione. Sui dati veri erano 87 timbri per 305 ore. Due strade per chiudere
// la stessa cosa, e una sola sapeva del gruppo.
// Ritorna { data, gruppoN }.
async function chiudiConSplitGruppo(sess, fineIso, nota) {
  const inizio = sess.inizio;
  const op = (state.operazioni || []).find(o => o.id === sess.operazione_id);
  // Le attività extra non si spalmano: non hanno commessa, quindi niente gruppo.
  const gruppo = (op && !sess.attivita_id)
    ? commesseGruppoLavorabili(op)
    : [{ operazione_id: sess.operazione_id, peso: 1 }];

  if (gruppo.length > 1) {
    const parti = ripartisciTimbroGruppo(inizio, fineIso, gruppo);
    // 1) la sessione già aperta = quota della sua commessa (parti[0]).
    // CHIUDE SOLO SE È ANCORA APERTA (`is('fine', null)`): se qualcuno l'ha già
    // chiusa, l'update non tocca niente e le quote NON si creano una seconda
    // volta. Senza questa guardia una chiusura partita due volte raddoppia le
    // ore — successo davvero, 9 volte: un doppio tocco (3 secondi) e sette
    // ritentativi di `eseguiConRetry` dopo il timeout di 10 secondi, cioè il
    // rischio dichiarato nel handoff ("insert riuscita ma risposta persa").
    const { data: righe, error } = await eseguiConRetry(
      () => sb.from('sessioni_lavoro')
        .update(nota ? { fine: parti[0].fine, note: (sess.note ? sess.note + ' · ' : '') + nota } : { fine: parti[0].fine })
        .eq('id', sess.id).is('fine', null).select(),
      { label: 'chiusura timbratura (gruppo)' }
    );
    if (error) throw error;
    if (!righe || !righe.length) {
      // Già chiusa da un'altra strada: niente quote, niente ore doppie.
      const gia = (state.sessioni || []).find(s => s.id === sess.id);
      return { data: gia || sess, gruppoN: 1, giaChiusa: true };
    }
    const data = righe[0];
    state.sessioni = state.sessioni.map(s => s.id === sess.id ? data : s);
    // 2) una sessione per ciascuna delle ALTRE commesse del gruppo
    const nuove = parti.slice(1).map(p => ({
      operazione_id: p.operazione_id,
      utente_id: sess.utente_id,
      tipo_lavorazione_id: sess.tipo_lavorazione_id,
      fase_id: null,
      attivita_id: null,
      sede: sess.sede,
      inizio: p.inizio,
      fine: p.fine,
      // Niente marchio "[gruppo]" (tolto su richiesta di Nico, 5 ago): sporcava
      // il campo note, che ora serve alle note vere degli operatori. Le quote
      // restano riconoscibili dal fatto che la commessa ha un gruppo_id e che
      // le sessioni sono fette contigue dello stesso intervallo.
      note: sess.note || null,
    }));
    try {
      const { data: ins } = await eseguiConRetry(
        () => sb.from('sessioni_lavoro').insert(nuove).select(),
        { label: 'quote timbro del gruppo' }
      );
      if (ins) ins.forEach(r => { if (!state.sessioni.find(x => x.id === r.id)) state.sessioni.push(r); });
    } catch (e) { /* best-effort: il timbro principale è già salvo, mai perso */ }
    return { data, gruppoN: gruppo.length };
  }

  // Chiusura normale (nessun gruppo). Stessa guardia: chiude solo se aperta.
  const { data: righe, error } = await eseguiConRetry(
    () => sb.from('sessioni_lavoro')
      .update(nota ? { fine: fineIso, note: (sess.note ? sess.note + ' · ' : '') + nota } : { fine: fineIso })
      .eq('id', sess.id).is('fine', null).select(),
    { label: 'chiusura timbratura' }
  );
  if (error) throw error;
  if (!righe || !righe.length) {
    const gia = (state.sessioni || []).find(s => s.id === sess.id);
    return { data: gia || sess, gruppoN: 1, giaChiusa: true };
  }
  const data = righe[0];
  state.sessioni = state.sessioni.map(s => s.id === sess.id ? data : s);
  return { data, gruppoN: 1 };
}

// Chiusura "adesso" dal kiosk. Nessuno scarto per durata: ogni timbratura resta
// registrata, qualunque sia la sua durata. Ritorna { scartata:false, elapsed,
// data, gruppoN }. Lancia in caso d errore.
async function kioskChiudiOScarta(sess, nota) {
  const fineNow = new Date().toISOString();
  const elapsed = Math.floor((Date.now() - new Date(sess.inizio).getTime()) / 1000);
  const r = await chiudiConSplitGruppo(sess, fineNow, nota);
  return { scartata: false, elapsed, data: r.data, gruppoN: r.gruppoN };
}

async function kioskStopSessione(sess, modalita) {
  // modalita: 'pause' = chiudi e torna a id, 'switch' = chiudi e vai a lista operazioni
  // ATTIVITÀ EXTRA: qui la nota è obbligatoria (decisione Nico). Senza, di
  // quelle ore non resta traccia di cosa siano state — non c'è né commessa né
  // tipo di lavorazione a raccontarlo. Su una fase invece non si chiede nulla.
  let nota = null;
  if (!sess.operazione_id) {
    nota = await kioskChiediNota(sess);
    if (nota === null) { kioskGoToAttiva(); return; }
  }
  try {
    const res = await kioskChiudiOScarta(sess, nota);
    kioskBeep('ok');
    if (state.kioskTimer) { clearInterval(state.kioskTimer); state.kioskTimer = null; }

    if (modalita === 'pause') {
      const durataS = res.elapsed;
      const h = Math.floor(durataS / 3600);
      const m = Math.floor((durataS % 3600) / 60);
      const durStr = (h > 0 ? h+'h '+m+'m' : m+' min')
        + (res.gruppoN > 1 ? ' · diviso su ' + res.gruppoN + ' commesse del gruppo' : '');
      kioskShowDone({ title: 'Sessione sospesa', detail: 'Durata: ' + durStr, ok: true });
    } else {
      // Switch: vai a lista operazioni per scegliere nuova
      kCom.opSelezionata = null;
      kCom.search = '';
      kCom.vediAltre = false;
      kioskGoToOpList();
    }
  } catch (e) {
    kioskBeep('err');
    kioskShowError('Errore: ' + (e.message||e));
  }
}

// [→ domain/scheduling.js] carico%: distribuisciOreOperazione, pesiEntitaCommessa, calcolaCaricoUtenteRange, calcolaCaricoFornitoreRange



// ═══════════════════════════════════════════════════════════
// GANTT — schede separate: Live e Commesse
// ═══════════════════════════════════════════════════════════

let ganttLiveTimer = null;

// Scheda "Live": dashboard chi sta lavorando ora
// ═══ GESTIONE → ANALISI CLIENTI ═══
// Due domande, cliente per cliente (commesse CHIUSE con almeno 1h timbrata):
//  1. quanto ci costa DAVVERO rispetto a quanto paga? (reale/pagato)
//  2. come si spezzetta il suo lavoro tra i tipi? (e quanto è affidabile
//     la media: ± alto = lavori troppo diversi, la media non predice)
// Il calcolo vive in domain/scheduling.js (analisiClienti), tutto live.
function renderAnalisiClienti(root) {
  root.innerHTML = '';   // renderTab non svuota: ogni render* pulisce da sé
  const righe = analisiClienti();
  root.append(el('div', { class:'toolbar' }, el('h2', {}, 'Analisi clienti')));
  root.append(el('div', { class:'sub', style:'margin:-4px 0 14px;max-width:900px;' },
    'Base dati: commesse spedite/completate con almeno 1h timbrata, calcolo live dai timbri. '
    + 'Reale/pagato: ×1,00 = il tempo pagato regge; sopra = il cliente costa più di quanto paga (rosso da ×1,05). '
    + '€/h: ricavo ÷ ore timbrate, calcolato solo sulle sue commesse con prezzo. '
    + 'Ripartizione: quota media del tipo di lavorazione; il ± dice quanto balla da commessa a commessa. '
    + 'Prezzi vs consuntivo: quanto varrebbe ogni articolo alle ore realmente timbrate × tariffa del cliente; '
    + '⚠ = una sola commessa alle spalle, indicativo.'));
  if (!righe.length) {
    root.append(el('div', { class:'empty' }, 'Nessuna commessa chiusa con timbri.'));
    return;
  }
  righe.forEach(r => {
    const cli = state.aziende.find(a => a.id === r.clienteId);
    const debole = r.nCommesse < 3;
    let ratioEl = null;
    if (r.ratio != null) {
      const col = r.ratio > 1.05 ? 'var(--red)' : (r.ratio < 0.95 ? 'var(--grn)' : 'var(--txt)');
      ratioEl = el('span', {
        style:'font-family:JetBrains Mono,monospace;font-weight:700;font-size:15px;color:' + col + ';',
        title:'Ore timbrate / ore pagate, media sulle sue commesse chiuse',
      }, 'reale/pagato ×' + r.ratio.toFixed(2).replace('.', ','));
    }
    // €/ora incassati: ricavo ÷ ore timbrate, solo commesse con prezzo.
    // Copertura dichiarata quando non tutte le commesse hanno un prezzo.
    let euroOraEl = null;
    if (r.euroOra != null) {
      const copertura = r.nConPrezzo < r.nCommesse
        ? ' (su ' + r.nConPrezzo + (r.nConPrezzo === 1 ? ' commessa' : ' commesse') + ' con prezzo)'
        : '';
      euroOraEl = el('span', {
        style:'font-family:JetBrains Mono,monospace;font-weight:700;font-size:15px;',
        title:'Ricavo ÷ ore timbrate, solo sulle sue commesse chiuse con prezzo',
      },
        r.euroOra.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €/h',
        copertura ? el('span', { class:'sub', style:'font-weight:400;font-size:11px;' }, copertura) : null);
    }
    const card = el('div', { style:'background:var(--sur2);border:1px solid var(--brd);border-radius:6px;padding:12px 14px;margin-bottom:10px;' });
    card.append(el('div', { style:'display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;' },
      el('span', { style:'font-weight:700;font-size:14px;' }, cli?.nome || '—'),
      el('span', { class:'sub' },
        r.nCommesse + (r.nCommesse === 1 ? ' commessa chiusa' : ' commesse chiuse')
        + ' · ' + r.oreReali.toFixed(1).replace('.', ',') + 'h timbrate'
        + (r.orePagate > 0 ? ' su ' + r.orePagate.toFixed(1).replace('.', ',') + 'h pagate' : '')),
      ratioEl,
      euroOraEl,
      debole ? el('span', { style:'color:var(--yel);font-size:11px;' }, '⚠ dati deboli (meno di 3 commesse)') : null,
    ));
    const wrap = el('div', { style:'margin-top:8px;display:flex;flex-direction:column;gap:4px;' });
    r.tipi.forEach(t => {
      const tipo = state.tipiLav.find(x => x.id === t.tipoId);
      const pM = Math.round(t.media * 100), pD = Math.round(t.dev * 100);
      wrap.append(el('div', { style:'display:flex;align-items:center;gap:10px;font-family:JetBrains Mono,monospace;font-size:11px;' },
        el('span', { style:'width:10px;height:10px;border-radius:2px;flex-shrink:0;background:' + (tipo?.colore || '#6b6b64') + ';' }),
        el('span', { style:'width:170px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' }, tipo?.nome || '?'),
        el('div', { style:'flex:1;max-width:320px;height:10px;background:var(--sur);border:1px solid var(--brd);border-radius:3px;position:relative;overflow:hidden;' },
          el('div', { style:'position:absolute;left:0;top:0;bottom:0;width:' + Math.min(100, pM) + '%;background:' + (tipo?.colore || 'var(--blu)') + ';opacity:.8;' })),
        el('span', { style:'flex-shrink:0;color:var(--mut);' }, pM + '% ± ' + pD),
      ));
    });
    card.append(wrap);
    // Prezzi vs consuntivo: cosa costa DAVVERO ogni articolo alla tariffa del
    // cliente, contro quello che gli si chiede. Chiuso di default (è un
    // approfondimento, non il titolo della card). Solo per i clienti con
    // tariffa dichiarata: senza, non c'è un prezzo da consigliare.
    if (typeof scostamentiPrezzoCliente === 'function') {
      const sc = scostamentiPrezzoCliente(r.clienteId);
      if (sc.length) {
        const fmtE = (n) => '€ ' + Number(n).toLocaleString('it-IT',
          { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const pc = (x) => (x > 0 ? '+' : '') + Math.round(x * 100) + '%';
        const fuori = sc.filter(x => Math.abs(x.scarto) >= 0.20).length;
        const deboli = sc.filter(x => x.debole).length;
        card.append(el('div', { style:'margin-top:10px;' }, entityTimeline({
          sommario: 'Prezzi vs consuntivo — ' + sc.length
            + (sc.length === 1 ? ' articolo' : ' articoli')
            + (fuori ? ' · ' + fuori + ' oltre ±20%' : ' · tutti entro ±20%')
            + (deboli ? ' · ' + deboli + ' su una sola commessa' : ''),
          debole: deboli === sc.length,
          righe: sc.map(x => {
            const art = state.articoli.find(a => a.id === x.articoloId);
            return {
              titolo: (art?.codice || '—') + (x.debole ? ' ⚠' : ''),
              meta: fmtE(x.prezzo) + ' oggi · ' + x.minPz.toLocaleString('it-IT',
                  { maximumFractionDigits: 0 }) + ' min/pz timbrati · '
                + x.nCommesse + (x.nCommesse === 1 ? ' commessa' : ' commesse'),
              valore: fmtE(x.suggerito) + '  ' + pc(x.scarto),
            };
          }),
        })));
      }
    }
    root.append(card);
  });
}

function renderGanttLiveTab(root) {
  if (ganttLiveTimer) { clearInterval(ganttLiveTimer); ganttLiveTimer = null; }
  root.innerHTML = '';
  renderGanttLive(root);
}

// Scheda "Gantt" (ex "Commesse"): griglia operatori × tempo con barre commessa
function renderGanttCommesseTab(root) {
  if (ganttLiveTimer) { clearInterval(ganttLiveTimer); ganttLiveTimer = null; }
  root.innerHTML = '';
  renderGanttCommesse(root);
}

// ─── VISTA LIVE: dashboard chi-sta-facendo-cosa ───
// Costruisce una card "live" di un operatore: mostra il suo stato attuale
// (sessione attiva, assenza, oppure ultima sessione chiusa di oggi).
// Usata sia dalla scheda Live (admin) sia dalla schermata di identificazione
// del kiosk. Il parametro onClick è opzionale: se passato, la card diventa
// cliccabile e invoca quel callback al click.
function buildLiveCard(u, onClick, opts = {}) {
  const sess = state.sessioni.find(s => s.utente_id === u.id && !s.fine);
  const oggiISO = toLocalISO(new Date());
  const assOggi = state.assenze.find(a =>
    a.stato === 'valida' && a.data === oggiISO && a.utente_id === u.id);

  let cardClass = 'live-card ';
  if (sess) cardClass += 'attivo';
  else if (assOggi) cardClass += 'fermo';
  else cardClass += 'fermo';

  const card = el('div', {
    class: cardClass,
    style: onClick ? 'cursor:pointer;' : '',
    onclick: onClick || undefined,
  });

  // Colore assenza sulla card SOLO se l'operatore non sta lavorando ora: una
  // sessione aperta significa che è presente, quindi vince lo stile "attivo".
  if (assOggi && !sess) {
    const tipo = state.tipiAssenza.find(t => t.id === assOggi.tipo_assenza_id);
    card.style.background = `${(tipo?.colore || '#6b6b64')}15`;
    card.style.borderColor = (tipo?.colore || '#6b6b64');
  }

  let badgeStato;
  if (sess) badgeStato = '● attivo';
  else if (assOggi) {
    const tipo = state.tipiAssenza.find(t => t.id === assOggi.tipo_assenza_id);
    const ore = parseFloat(assOggi.ore) || 0;
    badgeStato = (tipo?.codice || 'A') + (ore >= 8 ? '' : ' ' + ore + 'h');
  } else badgeStato = 'fermo';

  const hd = el('div', { class:'live-card-hd' },
    el('div', { class:'live-card-nome' }, u.nome),
    el('div', {
      class:'live-card-stato-badge '+(sess?'attivo':'fermo'),
      style: (assOggi && !sess) ? `color:${state.tipiAssenza.find(t=>t.id===assOggi.tipo_assenza_id)?.colore || ''};border-color:${state.tipiAssenza.find(t=>t.id===assOggi.tipo_assenza_id)?.colore || ''};` : '',
    }, badgeStato),
  );
  card.append(hd);

  if (sess) {
    const d = descriviSessione(sess);
    const secNow = Math.floor((Date.now() - new Date(sess.inizio).getTime()) / 1000);
    const over = secNow >= LIVE_WARN_SESSIONE_SEC;
    if (over) card.classList.add('sess-lunga');
    card.append(
      el('div', { class:'live-card-cliente' }, d.titolo),
      // Per attività extra non c'è codice articolo: nascondo quella riga
      ...(d.codice ? [el('div', { class:'live-card-cod' }, d.codice)] : []),
      el('div', { class:'live-card-tipo' },
        el('div', { class:'live-card-tipo-dot', style:'background:'+d.colore+';' }),
        d.tipoLabel,
      ),
      el('div', { class:'live-card-durata' + (over ? ' over' : ''), 'data-sess-id': sess.id, 'data-inizio': sess.inizio },
        formatLiveDuration(sess.inizio)),
      el('div', { class:'live-card-warn', style: over ? '' : 'display:none;' },
        '⚠ Sessione aperta da oltre 7 ore — verificare se è in corso o dimenticata aperta'),
    );
    // Se oggi ha anche un permesso/assenza parziale lo mostro come nota
    // secondaria: sta lavorando ORA, ma è utile sapere che oggi ha un permesso.
    if (assOggi) {
      const tipo = state.tipiAssenza.find(t => t.id === assOggi.tipo_assenza_id);
      const ore = parseFloat(assOggi.ore) || 0;
      card.append(el('div', {
        style: 'font-family:JetBrains Mono,monospace;font-size:11px;color:var(--mut);margin-top:4px;opacity:.85;',
      }, `◷ ${tipo?.nome || 'Assenza'} ${ore}h oggi${assOggi.note ? ' — '+assOggi.note : ''}`));
    }
  } else if (assOggi) {
    const tipo = state.tipiAssenza.find(t => t.id === assOggi.tipo_assenza_id);
    const ore = parseFloat(assOggi.ore) || 0;
    card.append(el('div', {
      style: 'font-family:JetBrains Mono,monospace;font-size:11px;color:var(--mut);margin-top:6px;',
    }, `${tipo?.nome || 'Assenza'} · ${ore}h${assOggi.note ? ' — '+assOggi.note : ''}`));
  } else {
    // Mostra ultima sessione chiusa oggi se c'è
    const ultime = state.sessioni
      .filter(s => s.utente_id === u.id && s.fine && (s.inizio||'').substring(0,10) === oggiISO)
      .sort((a,b) => (b.fine||'').localeCompare(a.fine||''));
    if (ultime.length) {
      const ultima = ultime[0];
      const op = state.operazioni.find(o => o.id === ultima.operazione_id);
      const art = op ? state.articoli.find(a => a.id === op.articolo_id) : null;
      const tipo = state.tipiLav.find(t => t.id === ultima.tipo_lavorazione_id);
      const totSecOggi = ultime.reduce((s,x) => s + (x.durata_secondi||0), 0);
      card.append(
        el('div', { class:'live-card-vuoto' },
          'Ultima sessione: ' + (art?.codice || '—') + ' (' + (tipo?.nome||'') + ')'),
        el('div', { class:'live-card-vuoto', style:'color:var(--txt);' },
          'Totale oggi: ' + formatSecondsHuman(totSecOggi)),
      );
      // Avviso: oggi ha chiuso almeno una sessione di oltre 7 ore continuative.
      // Solo dove richiesto (scheda Live admin), non sul kiosk.
      if (opts.flagLunghe && ultime.some(sessioneTroppoLunga)) {
        card.classList.add('sess-lunga');
        card.append(el('div', { class:'live-card-warn' },
          '⚠ Oggi una sessione di oltre 7 ore continuative — verificare'));
      }
    } else {
      card.append(el('div', { class:'live-card-vuoto' }, 'Nessuna sessione oggi'));
    }
  }

  return card;
}

function renderGanttLive(root) {
  // Operatori attivi, kiosk escluso. Gli esterni IN SEDE ci sono: timbrano e
  // occupano capacità come gli altri (28 lug). Restano marcati ✦/giallo.
  const operatori = state.utenti.filter(u => u.attivo && !isKioskRecord(u))
    .sort((a,b) => a.nome.localeCompare(b.nome));

  const oggiISO = toLocalISO(new Date());

  // Mappa utente_id → assenza valida oggi
  const assOggiByUtente = {};
  state.assenze.forEach(a => {
    if (a.stato === 'valida' && a.data === oggiISO) {
      assOggiByUtente[a.utente_id] = a;
    }
  });

  // KPI riepilogo
  const attivi = state.sessioni.filter(s => !s.fine).length;
  const totOperatori = operatori.length;
  const assOggi = operatori.filter(u => assOggiByUtente[u.id]).length;
  const totOggi = state.sessioni.filter(s => {
    const ini = (s.inizio||'').substring(0,10);
    return ini === oggiISO;
  }).length;

  // Toolbar: export ore/cartellino del periodo (solo admin)
  if (state.profile?.ruolo === 'admin') {
    root.append(el('div', { style:'display:flex;justify-content:flex-end;margin-bottom:10px;' },
      el('button', { class:'btng', onclick: () => openCartellinoExportModal() },
        '⬇ Esporta ore (Excel)')));
  }

  // Riepilogo timbrature sospette — in cima, visibile a colpo d'occhio.
  // Sta SOLO qui (decisione Nico, 7 ago): era stata provata sopra tutte le
  // schede e si è rivelata di troppo. Riempito da renderSospette().
  root.append(el('div', { id:'sospette-bar', style:'display:none;' }));

  root.append(el('div', { class:'kpis' },
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Operatori al lavoro'),
      el('div', { class:'kv kg' }, String(attivi)+' / '+String(totOperatori))),
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Assenti oggi'),
      el('div', { class:'kv ky' }, String(assOggi))),
    el('div', { class:'kpi' }, el('div', { class:'kl' }, 'Sessioni oggi'),
      el('div', { class:'kv' }, String(totOggi))),
  ));

  // Griglia card operatori, raggruppata per gruppo utenti
  const grid = el('div', { class:'live-grid' });
  const sezioniLive = raggruppaUtenti(operatori);

  const buildCardUtente = (u) => {
    // Click apre il pannello laterale con lo storico consuntivi di quell'utente.
    grid.append(buildLiveCard(u, () => apriStoricoConsuntivi(u), { flagLunghe: true }));
  };

  // Per ogni gruppo con utenti: emetto un separatore a tutta larghezza,
  // poi le card del gruppo. "Senza gruppo" è automaticamente l'ultima sezione.
  sezioniLive.forEach(sez => {
    grid.append(el('div', {
      class: 'live-gruppo-hd gruppo-hd' + (sez.key === '__nogroup__' ? ' nogroup' : ''),
      style: 'grid-column:1/-1;',
    }, sez.label));
    sez.utenti.forEach(buildCardUtente);
  });

  if (operatori.length === 0) {
    root.append(el('div', { class:'empty' }, 'Nessun utente attivo'));
  } else {
    root.append(grid);
  }

  // Calcolo iniziale del riepilogo sospette
  renderSospette();

  // Timer durate live. Il riepilogo si ridisegna una volta al minuto e non a
  // ogni secondo: ricostruirlo 60 volte al minuto sarebbe sprecato, e le sue
  // righe cambiano di rado (l'unica che si muove è "aperta da N h").
  let tick = 0;
  ganttLiveTimer = setInterval(() => {
    document.querySelectorAll('.live-card-durata[data-inizio]').forEach(refreshLiveDurationEl);
    if (++tick % 60 === 0) renderSospette();
  }, 1000);
}

// ─── EXPORT ORE / CARTELLINO (periodo, tutti gli operatori) ───
// Pulisce valori spuri salvati come stringa letterale "null"/"undefined".
function _exportClean(v) {
  const t = (v == null ? '' : String(v)).trim();
  return (!t || t === 'null' || t === 'undefined') ? '' : t;
}

// Sessioni con inizio nel periodo [fromISO, toISO] (estremi inclusi), per data
// LOCALE di inizio (coerente con come l'orario è mostrato all'operatore).
function sessioniNelPeriodo(fromISO, toISO) {
  return state.sessioni.filter(s => {
    if (!s.inizio) return false;
    const dISO = toLocalISO(new Date(s.inizio));
    return dISO >= fromISO && dISO <= toISO;
  });
}

// Durata in secondi di una sessione: chiusa = fine−inizio; aperta = fino ad ora.
function _sessDurSec(s) {
  const ini = new Date(s.inizio);
  const fin = s.fine ? new Date(s.fine) : new Date();
  return Math.max(0, Math.floor((fin - ini) / 1000));
}

function openCartellinoExportModal() {
  if (state.profile?.ruolo !== 'admin') { toast('Solo gli admin possono esportare le ore', 'err'); return; }
  if (typeof XLSX === 'undefined') { toast('Libreria Excel non caricata, ricarica la pagina', 'err'); return; }

  const oggi = new Date();
  const primoMese = new Date(oggi.getFullYear(), oggi.getMonth(), 1);

  const modal = el('div', { class:'modal', style:'max-width:460px;' });
  modal.append(el('div', { class:'mhd' },
    el('h2', {}, 'Esporta ore'),
    el('button', { class:'mclose', onclick: closeModal }, '✕'),
  ));
  const body = el('div', { class:'mbody' });
  body.append(el('div', { class:'sub', style:'margin-bottom:12px;' },
    'Periodo da esportare. Include commesse e attività extra di tutti gli operatori. '
    + 'Due fogli: dettaglio attività e riepilogo giornaliero per operatore.'));

  const inDa = el('input', { type:'date', value: toLocalISO(primoMese) });
  const inA  = el('input', { type:'date', value: toLocalISO(oggi) });
  const conteggio = el('div', { style:'font-family:JetBrains Mono,monospace;font-size:11px;color:var(--mut);margin-top:2px;' });

  function aggiornaConteggio() {
    if (!inDa.value || !inA.value || inA.value < inDa.value) { conteggio.textContent = ''; return; }
    const n = sessioniNelPeriodo(inDa.value, inA.value).length;
    conteggio.textContent = n + ' session' + (n === 1 ? 'e' : 'i') + ' nel periodo';
  }
  inDa.onchange = aggiornaConteggio;
  inA.onchange = aggiornaConteggio;

  const setRange = (f, t) => { inDa.value = toLocalISO(f); inA.value = toLocalISO(t); aggiornaConteggio(); };
  const presetBtn = (label, fn) =>
    el('button', { class:'btng', style:'padding:4px 10px;font-size:11px;', onclick: fn }, label);
  const presetRow = el('div', { style:'display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 4px;' },
    presetBtn('Mese corrente', () => { const o = new Date(); setRange(new Date(o.getFullYear(), o.getMonth(), 1), o); }),
    presetBtn('Mese scorso', () => { const o = new Date(); setRange(new Date(o.getFullYear(), o.getMonth()-1, 1), new Date(o.getFullYear(), o.getMonth(), 0)); }),
    presetBtn('Ultimi 30 gg', () => { const o = new Date(); const f = new Date(o); f.setDate(f.getDate()-29); setRange(f, o); }),
  );

  body.append(
    el('div', { class:'frow' },
      el('div', { class:'field' }, el('label', {}, 'Da'), inDa),
      el('div', { class:'field' }, el('label', {}, 'A'), inA),
    ),
    presetRow,
    conteggio,
  );
  aggiornaConteggio();

  modal.append(body);
  modal.append(el('div', { class:'mfoot' },
    el('button', { class:'btng', onclick: closeModal }, 'Annulla'),
    el('button', { class:'btnp', onclick: () => {
      if (!inDa.value || !inA.value) return toast('Imposta entrambe le date', 'err');
      if (inA.value < inDa.value) return toast('La data "A" deve essere ≥ "Da"', 'err');
      cartellinoExportExcel(inDa.value, inA.value);
      closeModal();
    } }, '⬇ Scarica'),
  ));
  openModal(modal);
}

function cartellinoExportExcel(fromISO, toISO) {
  if (typeof XLSX === 'undefined') { toast('Libreria Excel non caricata, ricarica la pagina', 'err'); return; }

  const sess = sessioniNelPeriodo(fromISO, toISO);
  if (sess.length === 0) { toast('Nessuna sessione nel periodo selezionato', 'err'); return; }

  const uById = {};
  state.utenti.forEach(u => uById[u.id] = u);
  const nomeOp = (id) => uById[id]?.nome || '—';

  // ── Foglio Dettaglio: una riga per sessione, ordinato operatore → data → ora ──
  const sessSorted = [...sess].sort((a, b) => {
    const ua = nomeOp(a.utente_id).toLowerCase(), ub = nomeOp(b.utente_id).toLowerCase();
    const da = toLocalISO(new Date(a.inizio)), db = toLocalISO(new Date(b.inizio));
    return ua.localeCompare(ub) || da.localeCompare(db) || (a.inizio||'').localeCompare(b.inizio||'');
  });

  const dettaglio = sessSorted.map(s => {
    const d = descriviSessione(s);
    const ini = new Date(s.inizio);
    const fin = s.fine ? new Date(s.fine) : null;
    const sec = _sessDurSec(s);
    return {
      'Data':                  fmtIT(toLocalISO(ini)),
      'Operatore':             nomeOp(s.utente_id),
      'Tipo':                  d.isAttivitaExtra ? 'Attività extra' : 'Commessa',
      'Cliente':               d.isAttivitaExtra ? '' : (d.cliente?.nome || ''),
      'Numero ordine':         d.isAttivitaExtra ? '' : (d.op?.numero_ordine || ''),
      'Numero OP':             d.isAttivitaExtra ? '' : (d.op?.numero_op || ''),
      'Codice articolo':       d.isAttivitaExtra ? '' : (d.articolo?.codice || ''),
      'Descrizione articolo':  d.isAttivitaExtra ? '' : _exportClean(d.articolo?.descrizione),
      'Lavorazione / Attività': d.isAttivitaExtra
        ? (_exportClean(d.attivita?.nome) || 'Attività extra')
        : (d.tipoLav?.nome || ''),
      'Inizio':                z(ini.getHours()) + ':' + z(ini.getMinutes()),
      'Fine':                  fin ? (z(fin.getHours()) + ':' + z(fin.getMinutes())) : 'in corso',
      'Ore':                   +(sec / 3600).toFixed(2),
      'Note':                  _exportClean(s.note),
      'Note commessa':         d.isAttivitaExtra ? '' : _exportClean(d.op?.note),
    };
  });

  // ── Foglio Riepilogo giornaliero: somma ore per operatore × giorno ──
  const aggMap = {};
  sess.forEach(s => {
    const dataISO = toLocalISO(new Date(s.inizio));
    const key = s.utente_id + '|' + dataISO;
    if (!aggMap[key]) aggMap[key] = { op: nomeOp(s.utente_id), dataISO, sec: 0, n: 0 };
    aggMap[key].sec += _sessDurSec(s);
    aggMap[key].n += 1;
  });
  const DOW = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];
  const riepilogo = Object.values(aggMap)
    .sort((a, b) => a.op.toLowerCase().localeCompare(b.op.toLowerCase()) || a.dataISO.localeCompare(b.dataISO))
    .map(r => ({
      'Operatore':   r.op,
      'Data':        fmtIT(r.dataISO),
      'Giorno':      DOW[parseISODate(r.dataISO).getDay()],
      'Ore':         +(r.sec / 3600).toFixed(2),
      'N. attività': r.n,
    }));

  // ── Workbook ──
  const wsDet = XLSX.utils.json_to_sheet(dettaglio);
  wsDet['!cols'] = [
    { wch: 11 }, { wch: 20 }, { wch: 14 }, { wch: 24 }, { wch: 16 },
    { wch: 16 }, { wch: 18 }, { wch: 34 }, { wch: 22 }, { wch: 8 },
    { wch: 8 }, { wch: 7 }, { wch: 30 }, { wch: 34 },
  ];
  const wsRie = XLSX.utils.json_to_sheet(riepilogo);
  wsRie['!cols'] = [ { wch: 20 }, { wch: 11 }, { wch: 8 }, { wch: 8 }, { wch: 11 } ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsDet, 'Dettaglio');
  XLSX.utils.book_append_sheet(wb, wsRie, 'Riepilogo giornaliero');
  XLSX.writeFile(wb, `ore_${fromISO}_${toISO}.xlsx`);

  toast('Esportate ' + dettaglio.length + ' attività (' + riepilogo.length + ' righe riepilogo)', 'ok');
}

// ─── PANNELLO STORICO CONSUNTIVI (drill-down da Gantt Live) ───
// Apre un pannello laterale con la cronologia delle sessioni di lavoro
// timbrate dall'utente, raggruppate per giorno (più recente in alto).
// Include anche le assenze come righe compatte per spiegare i "buchi".
function apriStoricoConsuntivi(utente) {
  // State locale (closure): range giorni + set giorni espansi
  const RANGE_OPZIONI = [
    { val: 30,   label: 'Ultimi 30 giorni' },
    { val: 90,   label: 'Ultimi 90 giorni' },
    { val: 9999, label: 'Tutto' },
  ];
  let rangeGiorni = 30;
  const giorniEspansi = new Set(); // popolato dopo il primo render

  const modal = el('div', { class:'modal side' });
  modal.append(el('div', { class:'mhd' },
    el('div', {},
      el('div', { style:'font-family:JetBrains Mono,monospace;font-size:11px;color:var(--mut);text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px;' },
        'Storico consuntivi'),
      el('h2', { style:'margin:0;' }, utente.nome),
    ),
    el('button', { class:'mclose', onclick: closeModal }, '✕'),
  ));

  const body = el('div', { class:'mbody' });
  modal.append(body);

  function calcolaDati() {
    const oggi = new Date();
    const oggiIso = toLocalISO(oggi);
    const limite = new Date(oggi);
    limite.setDate(limite.getDate() - rangeGiorni);
    const limiteIso = toLocalISO(limite);

    // Sessioni: filtro su utente, fine valorizzata o aperta, e data inizio >= limite
    const sess = state.sessioni.filter(s => {
      if (s.utente_id !== utente.id) return false;
      const dataIso = (s.inizio || '').substring(0, 10);
      return dataIso >= limiteIso && dataIso <= oggiIso;
    });

    // Assenze nel range
    const ass = state.assenze.filter(a => {
      if (a.utente_id !== utente.id) return false;
      if (a.stato !== 'valida') return false;
      return a.data >= limiteIso && a.data <= oggiIso;
    });

    // Raggruppo per data ISO
    const giorni = {};
    sess.forEach(s => {
      const d = (s.inizio || '').substring(0, 10);
      if (!giorni[d]) giorni[d] = { iso: d, sessioni: [], assenze: [], secLavorati: 0 };
      giorni[d].sessioni.push(s);
      if (s.fine) {
        giorni[d].secLavorati += Math.max(0,
          Math.floor((new Date(s.fine) - new Date(s.inizio)) / 1000));
      } else {
        // sessione aperta: conto fino a "adesso"
        giorni[d].secLavorati += Math.max(0,
          Math.floor((Date.now() - new Date(s.inizio)) / 1000));
      }
    });
    ass.forEach(a => {
      const d = a.data;
      if (!giorni[d]) giorni[d] = { iso: d, sessioni: [], assenze: [], secLavorati: 0 };
      giorni[d].assenze.push(a);
    });

    const lista = Object.values(giorni).sort((a, b) => b.iso.localeCompare(a.iso));

    // KPI totali
    const totSec = lista.reduce((acc, g) => acc + g.secLavorati, 0);
    const giorniLavorati = lista.filter(g => g.sessioni.length > 0).length;
    const totSessioni = sess.length;

    return { lista, totSec, giorniLavorati, totSessioni };
  }

  function renderBody() {
    body.innerHTML = '';

    // Toolbar: select range
    const tb = el('div', { class:'storico-toolbar' });
    const sel = el('select');
    RANGE_OPZIONI.forEach(o => {
      const opt = el('option', { value: String(o.val) }, o.label);
      if (o.val === rangeGiorni) opt.selected = true;
      sel.append(opt);
    });
    sel.onchange = () => {
      rangeGiorni = parseInt(sel.value, 10);
      giorniEspansi.clear();
      // ripopolerà i primi 7 al re-render
      renderBody();
    };
    tb.append(sel);
    body.append(tb);

    // Dati
    const { lista, totSec, giorniLavorati, totSessioni } = calcolaDati();

    // KPI
    const kpis = el('div', { class:'storico-kpis' });
    kpis.append(
      el('div', { class:'storico-kpi' },
        el('div', { class:'l' }, 'Ore lavorate'),
        el('div', { class:'v' }, formatSecondsHuman(totSec) || '0')),
      el('div', { class:'storico-kpi' },
        el('div', { class:'l' }, 'Giorni'),
        el('div', { class:'v' }, String(giorniLavorati))),
      el('div', { class:'storico-kpi' },
        el('div', { class:'l' }, 'Sessioni'),
        el('div', { class:'v' }, String(totSessioni))),
    );
    body.append(kpis);

    // Avviso riepilogativo: quante sessioni oltre 7h continuative nel periodo,
    // così è visibile senza dover espandere ogni giorno.
    const nLunghe = lista.reduce((acc, g) => acc + g.sessioni.filter(sessioneTroppoLunga).length, 0);
    if (nLunghe > 0) {
      body.append(el('div', { class:'storico-warn-banner' },
        '⚠ ' + nLunghe + (nLunghe === 1 ? ' sessione' : ' sessioni')
        + ' di oltre 7 ore continuative nel periodo. Verificare se sono reali o timbrature dimenticate aperte.'));
    }

    if (lista.length === 0) {
      body.append(el('div', { class:'storico-empty' },
        'Nessuna sessione né assenza nel periodo selezionato.'));
      return;
    }

    // Primo render: espando i primi 7 giorni della lista
    if (giorniEspansi.size === 0) {
      lista.slice(0, 7).forEach(g => giorniEspansi.add(g.iso));
    }

    lista.forEach(g => buildGiorno(body, g));
  }

  function buildGiorno(parent, g) {
    const espanso = giorniEspansi.has(g.iso);
    const d = parseISODate(g.iso);
    const dow = (d.getDay() + 6) % 7; // 0 = lunedì (coerente con GIORNI_BREVI)
    const giornoNome = ['Lun','Mar','Mer','Gio','Ven','Sab','Dom'][dow];
    const dataStr = `${z(d.getDate())} ${MESI_BREVI[d.getMonth()]}`;

    const wrap = el('div', { class:'storico-giorno' });

    // Header (cliccabile)
    const infoParts = [];
    if (g.sessioni.length > 0) {
      infoParts.push(
        el('span', { class:'totore' }, formatSecondsHuman(g.secLavorati)),
        ' · ',
        String(g.sessioni.length) + (g.sessioni.length === 1 ? ' sess.' : ' sess.'),
      );
    }
    if (g.assenze.length > 0) {
      if (infoParts.length) infoParts.push(' · ');
      infoParts.push('assenza');
    }
    if (infoParts.length === 0) infoParts.push('—');
    // Avviso: il giorno contiene almeno una sessione oltre 7h continuative
    const giornoHaLunga = g.sessioni.some(sessioneTroppoLunga);
    if (giornoHaLunga) {
      infoParts.push(el('span', { class:'gg-lunga', title:'Contiene una sessione di oltre 7 ore continuative' }, ' · ⚠ >7h'));
    }

    const hd = el('div', { class:'storico-giorno-hd' },
      el('div', { class:'gg-data' },
        el('span', { class:'dow' }, giornoNome),
        dataStr,
      ),
      el('div', { class:'gg-info' }, ...infoParts),
    );
    hd.onclick = () => {
      if (giorniEspansi.has(g.iso)) giorniEspansi.delete(g.iso);
      else giorniEspansi.add(g.iso);
      // Re-render del solo body (più semplice di replace localizzato)
      renderBody();
    };
    wrap.append(hd);

    if (espanso) {
      // Assenze in cima
      g.assenze.forEach(a => {
        const tipo = state.tipiAssenza.find(t => t.id === a.tipo_assenza_id);
        const ore = parseFloat(a.ore) || 0;
        wrap.append(el('div', { class:'storico-ass' },
          el('span', { class:'dot', style: 'background:'+(tipo?.colore || '#6b6b64')+';' }),
          el('span', {}, (tipo?.nome || 'Assenza') + ' · ' + ore + 'h' + (a.note ? ' · ' + a.note : '')),
        ));
      });

      // Sessioni
      if (g.sessioni.length > 0) {
        const bd = el('div', { class:'storico-giorno-body' });
        // Ordino le sessioni del giorno per ora di inizio crescente
        const sess = [...g.sessioni].sort((a, b) =>
          (a.inizio || '').localeCompare(b.inizio || ''));
        sess.forEach(s => bd.append(buildSessione(s)));
        wrap.append(bd);
      }
    }
    parent.append(wrap);
  }

  function buildSessione(s) {
    const d = descriviSessione(s);
    const aperta = !s.fine;
    const dur = aperta
      ? Math.floor((Date.now() - new Date(s.inizio)) / 1000)
      : Math.max(0, Math.floor((new Date(s.fine) - new Date(s.inizio)) / 1000));

    const oraInizio = new Date(s.inizio);
    const oraFine = s.fine ? new Date(s.fine) : null;
    const oraStr = z(oraInizio.getHours()) + ':' + z(oraInizio.getMinutes())
      + (oraFine ? '–' + z(oraFine.getHours()) + ':' + z(oraFine.getMinutes()) : '–…');

    // Meta: per le commesse "codice · tipo lavoro · orario"; per le attività
    // extra mostro "Attività extra · orario" (descrizione facoltativa, già nel
    // titolo se presente sarebbe ridondante).
    const metaStr = d.isAttivitaExtra
      ? d.tipoLabel + ' · ' + oraStr
      : (d.codice + ' · ' + d.tipoLabel + ' · ' + oraStr);

    // Admin: la riga è cliccabile e apre la modal di modifica tempi della
    // sessione. Dopo il salvataggio/eliminazione riapro questo stesso drawer
    // (le modal non si impilano) così l'admin resta nel contesto dell'operatore.
    const isAdmin = state.profile?.ruolo === 'admin';
    const lunga = sessioneTroppoLunga(s);
    const oreContinue = (dur / 3600).toFixed(1).replace('.', ',');
    const row = el('div', {
      class:'storico-sess' + (aperta ? ' aperta' : '') + (lunga ? ' lunga' : ''),
      style: isAdmin ? 'cursor:pointer;' : undefined,
      title: lunga
        ? ('⚠ Sessione continua di ' + oreContinue + ' ore (oltre 7h)'
           + (isAdmin ? ' — clic per modificare i tempi' : ''))
        : (isAdmin ? 'Clic per modificare i tempi di questa sessione' : undefined),
      onclick: isAdmin
        ? () => openSessioneModal(s, () => apriStoricoConsuntivi(utente))
        : null,
    },
      el('span', { class:'dot', style:'background:'+d.colore+';' }),
      el('div', { class:'corpo' },
        el('div', { class:'commessa' }, d.titolo),
        el('div', { class:'meta' }, metaStr),
      ),
      el('div', { class:'dur' },
        lunga ? el('span', { class:'warn-ic' }, '⚠') : null,
        formatSecondsHuman(dur) + (aperta ? ' ●' : '')),
    );
    return row;
  }

  renderBody();
  openModal(modal, { side: true });
}

// Helper: descrive una sessione di lavoro in modo agnostico al tipo
// (commessa via operazione_id vs attività extra via attivita_id).
// Ritorna { isAttivitaExtra, titolo, sottotitolo, codice, tipoLabel, colore,
//          op, cliente, articolo, attivita, tipoLav }.
// I campi non applicabili sono null. Pensato per essere usato sia dalle
// card live, sia dal drawer storico, sia dalla modal modifica admin.
function descriviSessione(s) {
  const isAttivitaExtra = !!s.attivita_id;
  if (isAttivitaExtra) {
    const att = (state.attivitaExtra || []).find(x => x.id === s.attivita_id);
    return {
      isAttivitaExtra: true,
      titolo:     '⚒ ' + (att?.nome || '— attività sconosciuta —'),
      sottotitolo: 'Attività extra',
      codice:     null,
      tipoLabel:  att?.descrizione || 'Attività extra',
      colore:     att?.colore || '#6b6b64',
      op:         null,
      cliente:    null,
      articolo:   null,
      attivita:   att || null,
      tipoLav:    null,
    };
  }
  const op = state.operazioni.find(o => o.id === s.operazione_id);
  const cli = op ? state.aziende.find(c => c.id === op.cliente_id) : null;
  const art = op ? state.articoli.find(a => a.id === op.articolo_id) : null;
  const tipo = state.tipiLav.find(t => t.id === s.tipo_lavorazione_id);
  return {
    isAttivitaExtra: false,
    titolo:     (cli?.nome || '—') + ' · ' + (op?.numero_ordine || '—'),
    sottotitolo: op?.numero_ordine || '—',
    codice:     art?.codice || '—',
    tipoLabel:  tipo?.nome || '—',
    colore:     tipo?.colore || '#6b6b64',
    op:         op || null,
    cliente:    cli || null,
    articolo:   art || null,
    attivita:   null,
    tipoLav:    tipo || null,
  };
}

// Soglia per l'avviso "sessione unica troppo lunga" sulle card della scheda Live.
const LIVE_WARN_SESSIONE_SEC = 7 * 3600;

// Durata continua (orologio) di una sessione: span inizio→fine, o inizio→adesso
// se ancora aperta. Usata per segnalare le sessioni troppo lunghe nello storico.
function durataSessioneSec(s) {
  if (!s || !s.inizio) return 0;
  const fineMs = s.fine ? new Date(s.fine).getTime() : Date.now();
  return Math.max(0, Math.floor((fineMs - new Date(s.inizio).getTime()) / 1000));
}
// True se la sessione è una singola tirata di oltre 7 ore continuative.
function sessioneTroppoLunga(s) {
  return durataSessioneSec(s) >= LIVE_WARN_SESSIONE_SEC;
}

// NB — `aggiornaLiveWarnBanner` non esiste più (7 ago). Elencava le sessioni
// oltre 7 ore aperte, più quelle chiuse ma iniziate OGGI: una vista del solo
// presente, che infatti non mostrava la sessione da 64,6 h chiusa a giugno.
// L'ha sostituita `renderSospette()`, che sta nello stesso posto ma guarda
// tutto l'archivio e distingue cinque tipi di anomalia.
// `sessioneTroppoLunga` resta: la usano le card e lo storico per ingiallire.

// Aggiorna una cella durata live e, sulla card, l'avviso "sessione > 7h".
// Usata da entrambi i timer (scheda Live admin + schermata kiosk), così
// l'avviso compare/sparisce in tempo reale esattamente come la durata.
function refreshLiveDurationEl(d) {
  const inizio = d.getAttribute('data-inizio');
  d.textContent = formatLiveDuration(inizio);
  const sec = Math.floor((Date.now() - new Date(inizio).getTime()) / 1000);
  const over = sec >= LIVE_WARN_SESSIONE_SEC;
  d.classList.toggle('over', over);
  const card = d.closest('.live-card');
  if (card) {
    card.classList.toggle('sess-lunga', over);
    const warn = card.querySelector('.live-card-warn');
    if (warn) warn.style.display = over ? '' : 'none';
  }
}

function formatLiveDuration(inizioISO) {
  const sec = Math.floor((Date.now() - new Date(inizioISO).getTime()) / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return h+'h '+String(m).padStart(2,'0')+'m';
  if (m > 0) return m+'m '+String(s).padStart(2,'0')+'s';
  return s+'s';
}

function formatSecondsHuman(sec) {
  if (sec < 60) return sec + ' s';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + ' min';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h + 'h ' + (m ? m+'m' : '');
}

// ─── VISTA COMMESSE: griglia operatori×tempo con barre commessa ───
// Mostra le commesse assegnate a ogni operatore (passate, presenti, future).
// Ogni barra confronta preventivo e consuntivo: rossa se sfora.
function renderGanttCommesse(root) {
  const cursor = state.ganttCursor instanceof Date ? state.ganttCursor : new Date();
  const zoom = state.ganttZoom || 'mese';

  const range = ganttCalcRange(cursor, zoom);

  const navToolbar = el('div', { class:'gantt-toolbar' },
    el('div', { class:'switch-bar' },
      el('button', { class: zoom === 'giorno' ? 'act' : '', onclick:() => { state.ganttZoom='giorno'; renderTab('gantt_commesse'); } }, 'Giorno'),
      el('button', { class: zoom === 'settimana' ? 'act' : '', onclick:() => { state.ganttZoom='settimana'; renderTab('gantt_commesse'); } }, 'Settimana'),
      el('button', { class: zoom === 'mese' ? 'act' : '', onclick:() => { state.ganttZoom='mese'; renderTab('gantt_commesse'); } }, 'Mese'),
    ),
    el('div', { class:'gantt-nav' },
      el('button', { onclick: () => { state.ganttCursor = ganttShift(cursor, zoom, -1); renderTab('gantt_commesse'); }, title:'Indietro' }, '◀'),
      el('button', { onclick: () => { state.ganttCursor = new Date(); renderTab('gantt_commesse'); } }, 'Oggi'),
      el('button', { onclick: () => { state.ganttCursor = ganttShift(cursor, zoom, +1); renderTab('gantt_commesse'); }, title:'Avanti' }, '▶'),
      el('div', { class:'label' }, ganttRangeLabel(range, zoom)),
    ),
  );

  // Filtro per stato commessa: chip on/off per ciascuno stato.
  // Default: tutti visibili. La selezione vive in state.ganttStatiVisibili (Set).
  if (!(state.ganttStatiVisibili instanceof Set)) {
    state.ganttStatiVisibili = new Set(Object.keys(OP_STATI));
  }
  const statiVis = state.ganttStatiVisibili;
  const chipBar = el('div', { style:'display:flex;gap:6px;flex-wrap:wrap;align-items:center;' });
  Object.entries(OP_STATI).forEach(([key, def]) => {
    const on = statiVis.has(key);
    chipBar.append(el('button', {
      style: 'display:flex;align-items:center;gap:6px;padding:5px 11px;border-radius:20px;cursor:pointer;'
        + `font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.03em;`
        + (on
          ? `background:var(--sur2);border:1px solid ${def.color};color:var(--txt);`
          : 'background:transparent;border:1px solid var(--brd);color:var(--mut);opacity:.55;'),
      title: (on ? 'Nascondi' : 'Mostra') + ' le commesse in stato ' + def.label.toLowerCase(),
      onclick: () => {
        if (statiVis.has(key)) statiVis.delete(key); else statiVis.add(key);
        renderTab('gantt_commesse');
      },
    },
      el('span', { style:`width:9px;height:9px;border-radius:50%;background:${on ? def.color : 'var(--brd)'};flex-shrink:0;` }),
      def.label,
    ));
  });
  navToolbar.append(chipBar);

  // ── Ricerca commessa: salta la timeline sulle sue date ed evidenzia le barre ──
  const searchWrap = el('div', { style:'position:relative;margin-left:auto;' });
  const searchInput = el('input', {
    type:'text', placeholder:'Cerca commessa…', value: state.ganttSearchQ || '',
    style:'font-size:12px;padding:5px 9px;width:210px;',
  });
  const results = el('div', {
    style:'position:absolute;top:100%;left:0;right:0;z-index:50;background:var(--sur);border:1px solid var(--brd);'
      + 'border-radius:6px;margin-top:3px;max-height:260px;overflow:auto;display:none;box-shadow:0 8px 24px var(--shadow);',
  });
  const matchOp = (o, q) => {
    const cli = state.aziende.find(x => x.id === o.cliente_id);
    const art = state.articoli.find(a => a.id === o.articolo_id);
    return [o.numero_ordine, o.riferimento_cliente, o.numero_op, cli && cli.nome, art && art.codice]
      .map(v => (v || '').toLowerCase()).join(' ').includes(q);
  };
  const vaiACommessa = (o) => {
    state.ganttCursor = parseISODate(opInizio(o) || o.scadenza);
    state.ganttHighlightOp = o.id;
    state.ganttScrollTo = o.id;
    state.ganttSearchQ = '';
    renderTab('gantt_commesse');
  };
  const aggiornaRicerca = () => {
    const q = searchInput.value.trim().toLowerCase();
    state.ganttSearchQ = searchInput.value;
    results.innerHTML = '';
    if (q.length < 2) { results.style.display = 'none'; return; }
    const hits = state.operazioni.filter(o => matchOp(o, q)).slice(0, 12);
    if (hits.length === 0) {
      results.append(el('div', { style:'padding:8px 10px;font-size:12px;color:var(--mut);' }, 'Nessuna commessa'));
      results.style.display = 'block'; return;
    }
    hits.forEach(o => {
      const cli = state.aziende.find(x => x.id === o.cliente_id);
      const art = state.articoli.find(a => a.id === o.articolo_id);
      results.append(el('div', {
        style:'padding:7px 10px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--brd);',
        onmouseenter:(e)=>{ e.currentTarget.style.background='var(--sur2)'; },
        onmouseleave:(e)=>{ e.currentTarget.style.background=''; },
        onmousedown:(e)=>{ e.preventDefault(); vaiACommessa(o); },
      },
        el('span', { style:'font-family:JetBrains Mono,monospace;color:var(--txt);' }, o.numero_ordine || o.numero_op || '—'),
        el('span', { style:'color:var(--mut);' }, '  ' + (cli ? cli.nome : '') + (art && art.codice ? ' · ' + art.codice : '')),
      ));
    });
    results.style.display = 'block';
  };
  searchInput.oninput = aggiornaRicerca;
  searchInput.onfocus = aggiornaRicerca;
  searchInput.onblur = () => setTimeout(() => { results.style.display = 'none'; }, 150);
  searchWrap.append(searchInput, results);
  navToolbar.append(searchWrap);
  root.append(navToolbar);

  // ── Legenda (in alto, aggiornata al modello quota/ritardi) ──
  const legVoce = (chip, testo) => el('span',
    { style:'display:inline-flex;align-items:center;gap:5px;white-space:nowrap;' }, chip, testo);
  const legChip = (style) => el('span',
    { style:'display:inline-block;width:22px;height:12px;border-radius:3px;flex-shrink:0;' + style });
  root.append(el('div', {
    style:'margin:6px 0 10px;display:flex;gap:14px;flex-wrap:wrap;align-items:center;'
      + 'font-family:JetBrains Mono,monospace;font-size:11px;color:var(--mut);',
  },
    el('span', { style:'font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:11px;' }, 'Legenda:'),
    legVoce(legChip('background:var(--sur2);border:1px solid var(--brd);position:relative;overflow:hidden;'
      + 'background-image:linear-gradient(to right, var(--blu) 0 55%, transparent 55%);'),
      'barra = quota operatore · riempimento = suoi timbri'),
    legVoce(legChip('background:var(--red);'), '⚠ RIT. = in ritardo, ancorata a oggi'),
    legVoce(legChip('background:#5c2a35;'), 'sforamento quota'),
    legVoce(legChip('background:var(--sur2);border:2px solid var(--grn);'), 'sta lavorando ora'),
    legVoce(legChip('background:var(--sur2);border-left:2px dashed var(--red);border-radius:0;width:10px;'), 'scadenza'),
    legVoce(legChip('background:linear-gradient(to right, var(--blu) 0 35%, var(--sur) 35% 65%, var(--blu) 65%);border:1px solid var(--brd);'),
      'buco = giorni non lavorati'),
    legVoce(legChip('background:rgba(212,140,40,.35);border:1px solid rgba(212,140,40,.6);'), 'fornitori esterni (righe in fondo) · ⚙ = fornitore in quota'),
  ));

  const operatori = state.utenti
    .filter(u => u.attivo && !isKioskRecord(u))
    .sort((a,b) => a.nome.localeCompare(b.nome));
  if (operatori.length === 0) {
    root.append(el('div', { class:'empty' }, 'Nessun utente'));
    return;
  }

  // Set delle operazioni con almeno una sessione aperta adesso
  // (escludo sessioni su attività extra: hanno operazione_id null)
  const opConSessioneAperta = new Set();
  state.sessioni.forEach(s => {
    if (!s.fine && s.operazione_id) opConSessioneAperta.add(s.operazione_id);
  });

  // Range come ISO per intersezione
  const rangeStartIso = toLocalISO(range.start);
  const rangeEndDate = new Date(range.end); rangeEndDate.setDate(rangeEndDate.getDate() - 1);
  const rangeEndIso = toLocalISO(rangeEndDate);

  // Mappa giorni non lavorativi non-weekend nel range visibile (festivi nazionali
  // + chiusure aziendali). Usata per evidenziarli visivamente nel Gantt — il
  // calcolo di capacity li considera già nelle formule. Valore = nome leggibile
  // per il tooltip.
  const annoMin = range.start.getFullYear();
  const annoMax = rangeEndDate.getFullYear();
  const nonLavMap = {};
  for (let y = annoMin; y <= annoMax; y++) {
    festiviNazionali(y).forEach(f => {
      nonLavMap[toLocalISO(f.data)] = f.nome;
    });
  }
  state.chiusure.forEach(c => {
    if (!c.data) return;
    if (c.ricorrente) {
      const md = c.data.substring(5); // "MM-DD"
      for (let y = annoMin; y <= annoMax; y++) {
        nonLavMap[`${y}-${md}`] = c.descrizione || 'Chiusura aziendale';
      }
    } else {
      nonLavMap[c.data] = c.descrizione || 'Chiusura aziendale';
    }
  });

  const wrap = el('div', { class:'gantt-wrap' });
  const slots = range.slots;
  // Larghezza slot: minima per leggibilità, ma si espande per riempire la pagina.
  // root.clientWidth = spazio disponibile; 160 = colonna nomi; -2 per i bordi.
  const minSlot = zoom === 'giorno' ? 60 : (zoom === 'settimana' ? 100 : 30);
  const dispW = (root.clientWidth || 1100) - 160 - 4;
  const slotWidth = Math.max(minSlot, Math.floor(dispW / slots.length));
  const grid = el('div', { class:'gantt-grid',
    style: `grid-template-columns: 160px repeat(${slots.length}, ${slotWidth}px);`,
  });

  // HEADER
  grid.append(el('div', { class:'gantt-hd-corner' }, 'Operatore'));
  const oggiISO = toLocalISO(new Date());
  slots.forEach(slot => {
    const cls = ['gantt-hd-time'];
    if (slot.weekend) cls.push('weekend');
    if (slot.dateISO === oggiISO || slot.isOggi) cls.push('oggi');
    // Festivi nazionali / chiusure aziendali — visibili anche se non sono weekend
    const nomeNonLav = !slot.weekend && nonLavMap[slot.dateISO];
    if (nomeNonLav) cls.push('nonlav');
    const attrs = { class:cls.join(' ') };
    if (nomeNonLav) attrs.title = nomeNonLav;
    grid.append(el('div', attrs, slot.label));
  });

  // larghezza totale area-tempo, per posizionare le barre in %
  const totW = slots.length * slotWidth;
  // mappa: indice slot di una data ISO (per zoom giorno usa il giorno)
  const slotIndexOfIso = (iso) => {
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].dateISO === iso) return i;
    }
    return -1;
  };

  // RIGHE OPERATORI raggruppate per gruppo utenti
  const sezioniCom = raggruppaUtenti(operatori);

  const buildRigaCom = (u) => {
    // Calcolo carico % nel range visibile (stesso periodo del Gantt)
    const carico = calcolaCaricoUtenteRange(u.id, rangeStartIso, rangeEndIso);
    const percRound = Math.round(carico.perc * 100);
    const percTxt = percRound + '%';
    const coloreCarico = {
      libero: 'var(--grn)',
      normale: 'var(--blu)',
      pieno: 'var(--yel)',
      sovraccarico: 'var(--red)',
    }[carico.livello];
    // Larghezza della barra: cap a 100% per la parte "normale", l'eccesso
    // si vede dal colore rosso (sovraccarico) — non disegnare oltre il box.
    const barW = Math.min(100, percRound);

    grid.append(el('div', {
      class:'gantt-row-nome' + (u.esterno ? ' esterno' : ''),
      // Override del flex orizzontale dal CSS condiviso: qui ci stanno
      // due righe (nome + barra carico).
      style:'flex-direction:column;align-items:stretch;justify-content:center;gap:4px;',
      title: `${u.nome}: ${carico.oreCarico.toFixed(1)}h di lavoro residuo su ${carico.oreCapacita.toFixed(0)}h di capacità nel periodo visibile (${percTxt})`,
    },
      el('div', { style:'font-weight:600;line-height:1.1;' }, u.nome + (u.esterno ? ' ✦' : '')),
      // Mini-barra di carico con % dentro:
      // - track: contenitore con altezza fissa e bordo
      // - fill: riempimento colorato (cap a 100% per non sforare)
      // - label: % centrata, sopra entrambi gli strati, colore scuro
      //   per restare leggibile sui colori chiari (verde/giallo/rosso)
      el('div', {
        style: 'position:relative;height:14px;background:var(--sur2);border-radius:3px;overflow:hidden;border:1px solid var(--brd);',
      },
        el('div', {
          style: `position:absolute;left:0;top:0;bottom:0;width:${barW}%;background:${coloreCarico};transition:width .2s;`,
        }),
        el('div', {
          style: 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;'
            + `font-size:11px;font-family:'JetBrains Mono',monospace;font-weight:700;`
            + 'color:var(--bg);letter-spacing:.02em;text-shadow:0 0 2px rgba(255,255,255,.4);',
        }, percTxt),
      ),
    ));

    // Commesse assegnate all'operatore che intersecano il range. Con le fasi:
    // l'operatore occupa la finestra della SUA fase (non l'intera commessa).
    const commesse = [];
    state.operazioni.forEach(o => {
      if (!o.scadenza) return;
      if (!statiVis.has(o.stato || 'aperta')) return;   // filtro per stato
      const mieRighe = (state.opAddetti || []).filter(r => r.operazione_id === o.id && r.utente_id === u.id);
      if (!mieRighe.length) return;
      const fasi = opFasiOf(o);
      const windows = fasi.length ? opFasiWindows(o) : null;
      // Fasi specifiche a cui l'operatore è assegnato (fase_id valido)
      const mieFasi = windows ? mieRighe.map(r => r.fase_id).filter(fid => fid && windows[fid]) : [];

      // IN RITARDO: scadenza passata e lavoro residuo → la finestra a
      // ritroso vive nel PASSATO e la commessa sparirebbe dalla vista del
      // futuro. La si ancora a OGGI: una barra rossa unica, da oggi alla
      // fine stimata del residuo, coi giorni di ritardo dichiarati.
      if (o.scadenza < oggiISO && o.stato !== 'spedita' && o.stato !== 'completata'
          && opCalcOreResidue(o) > 0) {
        const fine = opFineLavoro(o, oggiISO);
        if (fine < rangeStartIso || oggiISO > rangeEndIso) return;
        const dopoScad = parseISODate(o.scadenza); dopoScad.setDate(dopoScad.getDate() + 1);
        const gRit = contaGiorniLavorativi(toLocalISO(dopoScad), oggiISO);
        commesse.push({ op:o, inizio:oggiISO, scadenza:o.scadenza, fine, faseTipo: null, ritardo: gRit });
        return;
      }

      if (fasi.length && mieFasi.length) {
        // Una barra per ciascuna fase dell'operatore, sulla sua finestra
        const visti = new Set();
        mieFasi.forEach(fid => {
          if (visti.has(fid)) return;
          visti.add(fid);
          const w = windows[fid];
          if (w.fine < rangeStartIso || w.inizio > rangeEndIso) return;
          const tipo = state.tipiLav.find(t => t.id === w.tipo_lavorazione_id);
          const f = fasi.find(x => x.id === fid) || null;
          commesse.push({ op:o, inizio:w.inizio, scadenza:o.scadenza, fine:w.fine, faseTipo: tipo || null, fase: f });
        });
      } else {
        // Nessuna fase, oppure assegnato "a tutta la commessa": intera finestra
        const inizio = opInizio(o) || o.scadenza;
        const fine = opFineLavoro(o, inizio);
        if (fine < rangeStartIso || inizio > rangeEndIso) return;
        commesse.push({ op:o, inizio, scadenza:o.scadenza, fine, faseTipo: null });
      }
    });

    // Una cella unica che copre tutti gli slot (track per le barre)
    const track = el('div', {
      class:'gantt-cmrow',
      style:`grid-column: 2 / span ${slots.length}; position:relative;`,
    });

    // Mappa data ISO → assenza valida dell'operatore
    const assByDate = {};
    state.assenze.forEach(a => {
      if (a.utente_id === u.id && a.stato === 'valida') assByDate[a.data] = a;
    });

    // sfondo: weekend/oggi + assenze (ferie/permessi) dell'operatore
    slots.forEach((slot, i) => {
      const nomeNonLav = !slot.weekend && nonLavMap[slot.dateISO];
      const c = el('div', {
        class:'gantt-cmcol'
          + (slot.weekend ? ' weekend' : '')
          + (nomeNonLav ? ' nonlav' : '')
          + ((slot.dateISO === oggiISO || slot.isOggi) ? ' oggi' : ''),
        style:`left:${i*slotWidth}px;width:${slotWidth}px;`,
        title: nomeNonLav || undefined,
      });
      track.append(c);
      // Overlay assenza
      const ass = assByDate[slot.dateISO];
      if (ass) {
        const tipo = state.tipiAssenza.find(t => t.id === ass.tipo_assenza_id);
        const ore = parseFloat(ass.ore) || 0;
        const colA = (tipo && tipo.colore) || '#6b6b64';
        const ov = el('div', {
          class:'gantt-cmass',
          style:`left:${i*slotWidth}px;width:${slotWidth}px;background:${colA}2e;`,
          title:`${u.nome} — ${(tipo&&tipo.nome)||'Assenza'} (${ore}h)`
            + (ass.note ? '\n'+ass.note : ''),
        }, el('span', {}, ((tipo&&tipo.codice)||'?') + (ore < 8 ? String(ore) : '')));
        track.append(ov);
      }
    });

    // barre commesse, impilate
    const BAR_H = 17, GAP = 3;
    commesse.sort((a,b) => a.inizio < b.inizio ? -1 : 1);
    commesse.forEach((c, idx) => {
      let iStart = slotIndexOfIso(c.inizio < rangeStartIso ? rangeStartIso : c.inizio);
      let iEnd = slotIndexOfIso(c.fine > rangeEndIso ? rangeEndIso : c.fine);
      if (iStart < 0) iStart = 0;
      if (iEnd < 0) iEnd = slots.length - 1;
      const left = iStart * slotWidth;
      const width = Math.max(slotWidth, (iEnd - iStart + 1) * slotWidth);

      // QUOTA dell'operatore: preventivo = la SUA parte (fase divisa per gli
      // assegnatari; commessa intera ripartita per pesi), consuntivo = i SUOI
      // timbri. Così le barre e il carico% raccontano la stessa storia.
      const isFase = !!c.fase;
      const prevTot = isFase ? faseCalcOre(c.op, c.fase) : opCalcOre(c.op);
      const prev = isFase ? faseQuotaOreAddetto(c.op, c.fase) : opQuotaOreUtente(c.op, u.id);
      const cons = isFase ? faseCalcOreRealiUtente(c.op, c.fase, u.id) : opCalcOreRealiUtente(c.op, u.id);
      const perc = prev > 0 ? cons / prev : 0;
      const sfora = prev > 0 && cons > prev + tolleranzaOre(prev);
      // "In corso" = una SUA sessione aperta (riga personale, semaforo personale)
      const attiva = state.sessioni.some(s => !s.fine && s.utente_id === u.id
        && s.operazione_id === c.op.id && (!isFase || faseSessioneMatch(s, c.fase)));

      const art = state.articoli.find(a => a.id === c.op.articolo_id);
      const cli = state.aziende.find(x => x.id === c.op.cliente_id);
      // Fornitori coinvolti sulla commessa: dichiarati nel tooltip (in quota)
      const fornNomi = [...new Set((state.opFornitori || [])
        .filter(r => r.operazione_id === c.op.id)
        .map(r => (state.aziende.find(a => a.id === r.azienda_id) || {}).nome || '?'))];

      const bar = el('div', {
        class: 'gantt-cmbar' + (sfora ? ' sfora' : '') + (c.ritardo ? ' inritardo' : '')
          + (attiva ? ' attiva' : '') + (c.op.id === state.ganttHighlightOp ? ' evidenzia' : ''),
        'data-op-id': c.op.id,
        style: `left:${left}px;width:${width}px;top:${idx*(BAR_H+GAP)}px;`
          + (c.faseTipo && c.faseTipo.colore && !sfora && !c.ritardo ? `background:${c.faseTipo.colore};` : ''),
        title:
          'Commessa ' + (c.op.numero_ordine || '')
          + (cli ? '\nCliente: ' + cli.nome : '')
          + (art ? '\nArticolo: ' + (art.codice || '') : '')
          + (c.faseTipo ? '\nFase: ' + c.faseTipo.nome : '')
          + (c.ritardo ? '\n⚠ IN RITARDO di ' + c.ritardo + ' giorn' + (c.ritardo === 1 ? 'o' : 'i')
              + ' lavorativ' + (c.ritardo === 1 ? 'o' : 'i') + ' — barra ancorata a oggi' : '')
          + '\nQuota operatore: ' + prev.toFixed(1) + ' h'
          + (Math.abs(prevTot - prev) > 0.05
              ? ' (' + (isFase ? 'fase intera' : 'commessa intera') + ': ' + prevTot.toFixed(1) + ' h)' : '')
          + '\nSuo consuntivo: ' + cons.toFixed(1) + ' h'
          + (prev > 0 ? '  (' + Math.round(perc*100) + '%)' : '')
          + (sfora ? '\n⚠ SFORAMENTO quota: +' + (cons-prev).toFixed(1) + ' h' : '')
          + (fornNomi.length ? '\nCon fornitore (in quota): ' + fornNomi.join(', ') : '')
          + (attiva ? '\n● sta lavorando ora' : '')
          + '\nLavoro: ' + fmtIT(c.inizio) + ' → ' + fmtIT(c.fine)
          + '\nScadenza: ' + fmtIT(c.scadenza)
          + '\n(clic per aprire la commessa)',
        onclick: () => { if (typeof openOperazioneModal === 'function') openOperazioneModal(c.op); },
      });
      // riempimento consuntivo
      const fill = el('div', {
        class:'gantt-cmbar-fill' + (sfora ? ' sfora' : ''),
        style:`width:${Math.min(100, perc*100)}%;`,
      });
      if (!c.ritardo) bar.append(fill);
      // etichetta (il fornitore è scritto in chiaro, non solo nel tooltip)
      bar.append(el('div', { class:'gantt-cmbar-txt' },
        (c.ritardo ? '⚠ RIT. ' + c.ritardo + 'g · ' : '')
        + (art && art.codice ? art.codice : 'OP')
        + '  ' + Math.round(cons) + '/' + Math.round(prev) + 'h'
        + (fornNomi.length ? ' · ⚙ ' + fornNomi.join(', ') : '')));
      track.append(bar);

      // Interruzioni: la barra NON tira dritto sui giorni in cui non si
      // lavora (weekend, festivi/chiusure, assenza a giornata intera
      // dell'operatore). Il motore già non conta quei giorni (capacitaGiorno
      // = 0): qui lo si rende visibile. Maschere sopra la barra, clic e
      // tooltip passano alla barra sotto.
      for (let i = iStart; i <= iEnd; i++) {
        const slot = slots[i];
        if (!slot) continue;
        const nonLav = !slot.weekend && nonLavMap[slot.dateISO];
        const assTutta = assByDate[slot.dateISO]
          && (parseFloat(assByDate[slot.dateISO].ore) || 0) >= 8;
        if (!slot.weekend && !nonLav && !assTutta) continue;
        track.append(el('div', {
          class:'gantt-cmgap'
            + (slot.weekend ? ' weekend' : '')
            + (nonLav ? ' nonlav' : '')
            + (assTutta ? ' assenza' : ''),
          style:`left:${i*slotWidth}px;width:${slotWidth}px;top:${idx*(BAR_H+GAP)}px;height:${BAR_H}px;`,
        }));
      }

      // Marcatore scadenza: visibile quando la barra NON finisce sulla
      // scadenza (slack per inizio anticipato, o sforamento per inizio
      // tardivo). Con calcolo automatico fine == scadenza → niente marcatore.
      if (c.scadenza !== c.fine && c.scadenza >= rangeStartIso && c.scadenza <= rangeEndIso) {
        const iScad = slotIndexOfIso(c.scadenza);
        if (iScad >= 0) {
          track.append(el('div', {
            class: 'gantt-cmdeadline',
            style: `left:${iScad*slotWidth}px;top:${idx*(BAR_H+GAP)}px;height:${BAR_H}px;`,
            title: 'Scadenza: ' + fmtIT(c.scadenza),
          }));
        }
      }
    });

    // altezza riga in base al numero di barre
    const hRiga = Math.max(38, commesse.length * (BAR_H+GAP) + 8);
    track.style.minHeight = hRiga + 'px';
    grid.append(track);
  };

  // Per ogni gruppo: intestazione che copre tutta la larghezza della griglia,
  // poi le righe degli utenti del gruppo.
  sezioniCom.forEach(sez => {
    grid.append(el('div', {
      class: 'gruppo-hd' + (sez.key === '__nogroup__' ? ' nogroup' : ''),
      style: 'grid-column:1 / -1;',
    }, sez.label));
    sez.utenti.forEach(buildRigaCom);
  });

  // ── Sezione FORNITORI ESTERNI ──
  // Costruisco righe per ogni azienda con is_fornitore=true e attiva che ha
  // almeno una assegnazione in operazioni_fornitori. Le altre non hanno senso
  // mostrarle qui (sezione vuota se nessuno è coinvolto).
  const fornitoriCoinvolti = state.aziende
    .filter(a => a.is_fornitore && a.attivo)
    .filter(a => state.opFornitori.some(r => r.azienda_id === a.id))
    .sort((a, b) => a.nome.localeCompare(b.nome));

  if (fornitoriCoinvolti.length > 0) {
    grid.append(el('div', {
      class: 'gruppo-hd',
      style: 'grid-column:1 / -1;',
    }, 'FORNITORI ESTERNI'));

    const buildRigaForCom = (a) => {
      // Calcolo carico % del fornitore (considera coefficiente capacità)
      const carico = calcolaCaricoFornitoreRange(a.id, rangeStartIso, rangeEndIso);
      const percRound = Math.round(carico.perc * 100);
      const percTxt = percRound + '%';
      const coloreCarico = {
        libero: 'var(--grn)',
        normale: 'var(--blu)',
        pieno: 'var(--yel)',
        sovraccarico: 'var(--red)',
      }[carico.livello];
      const barW = Math.min(100, percRound);

      grid.append(el('div', {
        class:'gantt-row-nome',
        // Lo stile differenzia visivamente i fornitori (sfondo arancione tenue)
        style:'flex-direction:column;align-items:stretch;justify-content:center;gap:4px;'
          + 'background:rgba(212,140,40,.06);border-left:2px solid rgba(212,140,40,.45);',
        title: `${a.nome} (fornitore, coef ${carico.coefficiente.toFixed(2)}): `
          + `${carico.oreCarico.toFixed(1)}h di lavoro residuo su `
          + `${carico.oreCapacita.toFixed(0)}h di capacità nel periodo visibile (${percTxt})`,
      },
        el('div', { style:'font-weight:600;line-height:1.1;color:var(--yel);' },
          a.nome + (carico.coefficiente !== 1
            ? ` · ${carico.coefficiente.toFixed(2)}` : '')),
        el('div', {
          style: 'position:relative;height:14px;background:var(--sur2);border-radius:3px;overflow:hidden;border:1px solid var(--brd);',
        },
          el('div', {
            style: `position:absolute;left:0;top:0;bottom:0;width:${barW}%;background:${coloreCarico};transition:width .2s;`,
          }),
          el('div', {
            style: 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;'
              + `font-size:11px;font-family:'JetBrains Mono',monospace;font-weight:700;`
              + 'color:var(--bg);letter-spacing:.02em;text-shadow:0 0 2px rgba(255,255,255,.4);',
          }, percTxt),
        ),
      ));

      // Commesse in cui il fornitore è coinvolto
      const commesse = [];
      state.operazioni.forEach(o => {
        if (!o.scadenza) return;
        const for_ids = getOperazioneFornitori(o.id);
        if (!for_ids.includes(a.id)) return;
        // In ritardo: ancorata a oggi come nelle righe operatore
        if (o.scadenza < oggiISO && o.stato !== 'spedita' && o.stato !== 'completata'
            && opCalcOreResidue(o) > 0) {
          const fineR = opFineLavoro(o, oggiISO);
          if (fineR < rangeStartIso || oggiISO > rangeEndIso) return;
          const dopoScad = parseISODate(o.scadenza); dopoScad.setDate(dopoScad.getDate() + 1);
          commesse.push({ op:o, inizio:oggiISO, scadenza:o.scadenza, fine:fineR,
            ritardo: contaGiorniLavorativi(toLocalISO(dopoScad), oggiISO) });
          return;
        }
        const inizio = opInizio(o) || o.scadenza;
        const fine = opFineLavoro(o, inizio);
        if (fine < rangeStartIso || inizio > rangeEndIso) return;
        commesse.push({ op:o, inizio, scadenza:o.scadenza, fine });
      });

      const track = el('div', {
        class:'gantt-cmrow',
        style:`grid-column: 2 / span ${slots.length}; position:relative;`
          + 'background:rgba(212,140,40,.03);',
      });

      // Colonne sfondo (weekend, oggi, festivi/chiusure)
      slots.forEach((slot, i) => {
        const cls = ['gantt-cmcol'];
        if (slot.weekend) cls.push('weekend');
        const nomeNonLav = !slot.weekend && nonLavMap[slot.dateISO];
        if (nomeNonLav) cls.push('nonlav');
        if (slot.dateISO === oggiISO || slot.isOggi) cls.push('oggi');
        track.append(el('div', {
          class:cls.join(' '),
          style:`left:${i*slotWidth}px;width:${slotWidth}px;`,
          title: nomeNonLav || undefined,
        }));
      });

      const BAR_H = 18;
      const GAP = 4;

      // Disegno le barre delle commesse (stesso pattern degli utenti)
      commesse.sort((a, b) => (a.inizio || '').localeCompare(b.inizio || ''));
      commesse.forEach((c, idx) => {
        // Clip ai bordi del range visibile: una commessa che attraversa tutto
        // il mese ha inizio/scadenza fuori dagli slot, ma deve comunque
        // mostrare la barra a tutta larghezza. Usiamo lo stesso pattern
        // del blocco utenti sopra.
        let i0 = slotIndexOfIso(c.inizio < rangeStartIso ? rangeStartIso : c.inizio);
        let i1 = slotIndexOfIso(c.fine > rangeEndIso ? rangeEndIso : c.fine);
        if (i0 < 0) i0 = 0;
        if (i1 < 0) i1 = slots.length - 1;
        const left = i0 * slotWidth;
        const width = Math.max(slotWidth * 0.6, (i1 - i0 + 1) * slotWidth - 4);

        const art = state.articoli.find(x => x.id === c.op.articolo_id);
        const cli = state.aziende.find(x => x.id === c.op.cliente_id);
        const prev = opCalcOre(c.op);

        const bar = el('div', {
          class: 'gantt-cmbar' + (c.ritardo ? ' inritardo' : '') + (c.op.id === state.ganttHighlightOp ? ' evidenzia' : ''),
          'data-op-id': c.op.id,
          style: `left:${left}px;width:${width}px;top:${idx*(BAR_H+GAP)}px;`
            + (c.ritardo ? '' : 'border-color:rgba(212,140,40,.6);'),
          title:
            'Commessa ' + (c.op.numero_ordine || '')
            + (cli ? '\nCliente: ' + cli.nome : '')
            + (art ? '\nArticolo: ' + (art.codice || '') : '')
            + (c.ritardo ? '\n⚠ IN RITARDO di ' + c.ritardo + ' giorn' + (c.ritardo === 1 ? 'o' : 'i')
                + ' lavorativ' + (c.ritardo === 1 ? 'o' : 'i') + ' — barra ancorata a oggi' : '')
            + '\nPreventivo: ' + prev.toFixed(1) + ' h'
            + '\nLavoro: ' + fmtIT(c.inizio) + ' → ' + fmtIT(c.fine)
            + '\nScadenza: ' + fmtIT(c.scadenza)
            + '\n(clic per aprire la commessa)',
          onclick: () => { if (typeof openOperazioneModal === 'function') openOperazioneModal(c.op); },
        });
        bar.append(el('div', { class:'gantt-cmbar-txt' },
          (c.ritardo ? '⚠ RIT. ' + c.ritardo + 'g · ' : '')
          + (art && art.codice ? art.codice : 'OP') + '  ' + Math.round(prev) + 'h'));
        track.append(bar);

        // Marcatore scadenza (vedi blocco operatori)
        if (c.scadenza !== c.fine && c.scadenza >= rangeStartIso && c.scadenza <= rangeEndIso) {
          const iScad = slotIndexOfIso(c.scadenza);
          if (iScad >= 0) {
            track.append(el('div', {
              class: 'gantt-cmdeadline',
              style: `left:${iScad*slotWidth}px;top:${idx*(BAR_H+GAP)}px;height:${BAR_H}px;`,
              title: 'Scadenza: ' + fmtIT(c.scadenza),
            }));
          }
        }
      });

      const hRiga = Math.max(38, commesse.length * (BAR_H+GAP) + 8);
      track.style.minHeight = hRiga + 'px';
      grid.append(track);
    };

    fornitoriCoinvolti.forEach(buildRigaForCom);
  }

  wrap.append(grid);
  root.append(wrap);


  // Dopo il render: porta in vista la barra cercata (una volta sola).
  if (state.ganttScrollTo) {
    const target = state.ganttScrollTo;
    state.ganttScrollTo = null;
    setTimeout(() => {
      const bar = root.querySelector('.gantt-cmbar.evidenzia[data-op-id="' + target + '"]');
      if (bar && bar.scrollIntoView) bar.scrollIntoView({ behavior:'smooth', block:'center', inline:'center' });
    }, 60);
  }
}

// ─── Calcola range visualizzato in base a cursor + zoom ───
function ganttCalcRange(cursor, zoom) {
  const slots = [];
  let start, end;

  if (zoom === 'giorno') {
    const d = new Date(cursor); d.setHours(0,0,0,0);
    start = new Date(d);
    end = new Date(d); end.setDate(end.getDate() + 1);
    // 24 slot da 1 ora
    for (let h = 0; h < 24; h++) {
      const slotStart = new Date(d); slotStart.setHours(h, 0, 0, 0);
      const slotEnd = new Date(d); slotEnd.setHours(h + 1, 0, 0, 0);
      slots.push({
        start: slotStart, end: slotEnd,
        label: z(h) + ':00',
        weekend: false,
        dateISO: toLocalISO(d),
        isOggi: false,
      });
    }
  } else if (zoom === 'settimana') {
    // Da lunedì a domenica della settimana del cursore
    const d = new Date(cursor); d.setHours(0,0,0,0);
    const dow = (d.getDay() + 6) % 7; // 0 = lun, 6 = dom
    const lunedi = new Date(d); lunedi.setDate(d.getDate() - dow);
    start = new Date(lunedi);
    end = new Date(lunedi); end.setDate(end.getDate() + 7);
    const giorniNomi = ['Lun','Mar','Mer','Gio','Ven','Sab','Dom'];
    for (let i = 0; i < 7; i++) {
      const g = new Date(lunedi); g.setDate(lunedi.getDate() + i);
      const gEnd = new Date(g); gEnd.setDate(gEnd.getDate() + 1);
      const isToday = toLocalISO(g) === toLocalISO(new Date());
      slots.push({
        start: g, end: gEnd,
        label: giorniNomi[i] + ' ' + z(g.getDate()),
        weekend: i >= 5,
        dateISO: toLocalISO(g),
        isOggi: isToday,
      });
    }
  } else if (zoom === 'mese') {
    // Tutti i giorni del mese del cursore
    const d = new Date(cursor); d.setHours(0,0,0,0);
    const primo = new Date(d.getFullYear(), d.getMonth(), 1);
    const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    start = new Date(primo);
    end = new Date(ultimo); end.setDate(end.getDate() + 1);
    const oggiISO = toLocalISO(new Date());
    for (let i = 1; i <= ultimo.getDate(); i++) {
      const g = new Date(primo.getFullYear(), primo.getMonth(), i);
      const gEnd = new Date(g); gEnd.setDate(gEnd.getDate() + 1);
      const dow = g.getDay();
      slots.push({
        start: g, end: gEnd,
        label: String(i),
        weekend: dow === 0 || dow === 6,
        dateISO: toLocalISO(g),
        isOggi: toLocalISO(g) === oggiISO,
      });
    }
  }

  return { start, end, slots };
}

function ganttShift(cursor, zoom, dir) {
  const d = new Date(cursor);
  if (zoom === 'giorno') d.setDate(d.getDate() + dir);
  else if (zoom === 'settimana') d.setDate(d.getDate() + dir * 7);
  else if (zoom === 'mese') d.setMonth(d.getMonth() + dir);
  return d;
}

function ganttRangeLabel(range, zoom) {
  if (zoom === 'giorno') {
    return fmtIT(toLocalISO(range.start));
  } else if (zoom === 'settimana') {
    const inizio = range.slots[0].start;
    const fine = range.slots[range.slots.length - 1].start;
    return fmtIT(toLocalISO(inizio)) + ' — ' + fmtIT(toLocalISO(fine));
  } else if (zoom === 'mese') {
    const m = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
    return m[range.start.getMonth()] + ' ' + range.start.getFullYear();
  }
  return '';
}


// ─── Modal modifica/elimina sessione (admin) ───
// onDone (opzionale): callback eseguito DOPO un salvataggio/eliminazione andati
// a buon fine, al posto del re-render della tab corrente. Serve ai chiamanti che
// vogliono tornare al proprio contesto (es. drawer storico in Live: le modal non
// si impilano, quindi senza questo l'admin verrebbe rispedito sulla tab Live).
function openSessioneModal(s, onDone) {
  const isAdmin = state.profile?.ruolo === 'admin';
  if (!isAdmin) {
    toast('Solo gli admin possono modificare le sessioni', 'err');
    return;
  }
  const finalize = () => {
    closeModal();
    if (typeof onDone === 'function') onDone();
    else renderTab(state.currentTab);
  };

  const d = descriviSessione(s);
  const operatore = state.utenti.find(u => u.id === s.utente_id);

  const inizioDt = new Date(s.inizio);
  const fineDt = s.fine ? new Date(s.fine) : null;

  // Per input datetime-local con secondi serve formato "YYYY-MM-DDTHH:MM:SS".
  // I secondi sono indispensabili: senza, le sessioni sotto il minuto avrebbero
  // inizio e fine identici (collasso al minuto) e non sarebbero salvabili.
  const dtLocalStr = (d) => `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;

  const modal = el('div', { class:'modal' });
  modal.append(el('div', { class:'mhd' },
    el('h2', {}, 'Modifica sessione di lavoro'),
    el('button', { class:'mclose', onclick:closeModal }, '✕'),
  ));
  const body = el('div', { class:'mbody' });
  const form = el('form');

  // Info contestuali (sola lettura): commessa o attività extra a seconda del tipo
  const infoBox = el('div', { style:'background:var(--sur2);border:1px solid var(--brd);border-radius:4px;padding:10px 12px;margin-bottom:14px;font-family:monospace;font-size:11px;line-height:1.7;' });
  infoBox.append(el('div', {}, el('span', { style:'color:var(--mut)' }, 'Operatore: '), operatore?.nome || '—'));
  if (d.isAttivitaExtra) {
    // Guardia: alcuni record attività extra hanno nome/descrizione salvati come
    // stringa letterale "null" → vanno trattati come vuoti, non stampati.
    const clean = (v) => {
      const t = (v == null ? '' : String(v)).trim();
      return (!t || t === 'null' || t === 'undefined') ? '' : t;
    };
    const attNome = clean(d.attivita?.nome);
    const attDesc = clean(d.attivita?.descrizione);
    infoBox.append(
      el('div', {}, el('span', { style:'color:var(--mut)' }, 'Tipo: '),
        el('span', { style:'color:var(--yel)' }, 'Attività extra')),
      el('div', {}, el('span', { style:'color:var(--mut)' }, 'Attività: '), attNome || '—'),
      ...(attDesc
        ? [el('div', {}, el('span', { style:'color:var(--mut)' }, 'Descrizione: '), attDesc)]
        : []),
    );
  } else {
    infoBox.append(
      el('div', {}, el('span', { style:'color:var(--mut)' }, 'Cliente: '), d.cliente?.nome || '—'),
      el('div', {}, el('span', { style:'color:var(--mut)' }, 'Articolo: '), el('span', { style:'color:var(--or)' }, d.articolo?.codice || '—')),
      el('div', {}, el('span', { style:'color:var(--mut)' }, 'Descrizione: '), (d.articolo?.descrizione || '—')),
      el('div', {}, el('span', { style:'color:var(--mut)' }, 'Numero ordine: '), (d.op?.numero_ordine || '—')),
      el('div', {}, el('span', { style:'color:var(--mut)' }, 'Numero OP: '), (d.op?.numero_op || '—')),
      el('div', {}, el('span', { style:'color:var(--mut)' }, 'Tipo lavorazione: '), d.tipoLav?.nome || '—'),
      el('div', { style:'white-space:pre-wrap;' },
        el('span', { style:'color:var(--mut)' }, 'Note commessa: '),
        (d.op?.note || '').trim() || '—'),
    );
  }
  body.append(infoBox);

  // Il tipo lavorazione è modificabile solo per le sessioni su commessa
  let selTipo = null;
  if (!d.isAttivitaExtra) {
    selTipo = el('select', { name:'tipo_lavorazione_id' },
      ...state.tipiLav.filter(t => t.attivo).map(t =>
        el('option', { value:t.id }, t.nome))
    );
    selTipo.value = s.tipo_lavorazione_id || '';
  }

  const inInizio = el('input', { type:'datetime-local', name:'inizio', step:'1', value:dtLocalStr(inizioDt), required:'true' });
  const inFine = el('input', { type:'datetime-local', name:'fine', step:'1', value: fineDt ? dtLocalStr(fineDt) : '' });

  form.append(
    ...(selTipo ? [el('div', { class:'field' }, el('label', {}, 'Tipo lavorazione'), selTipo)] : []),
    el('div', { class:'frow' },
      el('div', { class:'field' }, el('label', {}, 'Inizio *'), inInizio),
      el('div', { class:'field' }, el('label', {}, 'Fine (vuoto = ancora aperta)'), inFine),
    ),
    el('div', { class:'field' }, el('label', {}, 'Note'),
      el('textarea', { name:'note', rows:'2' }, s.note || '')),
  );

  body.append(form);
  modal.append(body);

  const foot = el('div', { class:'mfoot' });
  foot.append(el('button', { class:'btnd', onclick: async () => {
    if (!confirm('Eliminare questa sessione? L\'azione è irreversibile.')) return;
    const { data, error } = await sb.from('sessioni_lavoro').delete().eq('id', s.id).select();
    if (error) return toast(error.message, 'err');
    if (!data || data.length === 0) return toast('Eliminazione bloccata (verifica policy)', 'err');
    state.sessioni = state.sessioni.filter(x => x.id !== s.id);
    // Tolto l'ultimo timbro, la fase può essere rimasta un guscio vuoto: se
    // non è più prevista in anagrafica e non ha né ore né addetti, se ne va
    // con lui. Senza questo resterebbe in Lavorazione e Consuntivo per sempre.
    let fasiTolte = 0;
    try {
      const op = (state.operazioni || []).find(x => x.id === s.operazione_id);
      const orfane = (op && typeof fasiOrfaneCommessa === 'function') ? fasiOrfaneCommessa(op) : [];
      for (const f of orfane) {
        const { error: eF } = await eseguiConRetry(
          () => sb.from('operazioni_fasi').delete().eq('id', f.id), { label: 'pulizia fase vuota' });
        if (!eF) { state.opFasi = state.opFasi.filter(x => x.id !== f.id); fasiTolte++; }
      }
    } catch (e) { /* best-effort: la sessione è già eliminata, questo è contorno */ }
    toast('Sessione eliminata'
      + (fasiTolte ? ' · tolta anche ' + fasiTolte + (fasiTolte === 1 ? ' fase rimasta vuota' : ' fasi rimaste vuote') : ''));
    finalize();
  } }, '🗑 Elimina'));
  foot.append(el('button', { class:'btng', onclick:closeModal }, 'Annulla'));

  const btnSave = el('button', { class:'btnp' }, 'Salva');
  btnSave.onclick = async () => {
    const fd = new FormData(form);
    const inizioStr = fd.get('inizio');
    const fineStr = fd.get('fine');
    if (!inizioStr) return toast('Inizio obbligatorio', 'err');
    if (fineStr && fineStr <= inizioStr) return toast('Fine deve essere dopo inizio', 'err');
    const payload = {
      inizio: new Date(inizioStr).toISOString(),
      fine: fineStr ? new Date(fineStr).toISOString() : null,
      note: (fd.get('note')||'').trim() || null,
    };
    // ACCAVALLAMENTI: si impediscono qui, che è da dove nascono. Una persona
    // non può lavorare in due posti nello stesso momento, e due timbri
    // sovrapposti contano le ore due volte. Bloccante e non un avviso: qui c'è
    // un admin davanti allo schermo che può correggere subito, e il conflitto
    // è certo — non un'ipotesi come le assenze sui mezzi.
    const conflitto = (typeof sessioneInConflitto === 'function')
      ? sessioneInConflitto(s.utente_id, payload.inizio, payload.fine, s.id) : null;
    if (conflitto) {
      const dc = descriviSessione(conflitto);
      const oraC = fmtT(new Date(conflitto.inizio)) + '→'
        + (conflitto.fine ? fmtT(new Date(conflitto.fine)) : 'aperta');
      return toast('Si accavalla con un altro timbro di ' + (operatore?.nome || 'questo operatore')
        + ': ' + fmtIT(toLocalISO(new Date(conflitto.inizio))) + ' ' + oraC
        + ' · ' + dc.titolo, 'err');
    }
    // tipo_lavorazione_id va aggiornato solo per le sessioni su commessa
    if (!d.isAttivitaExtra) {
      payload.tipo_lavorazione_id = fd.get('tipo_lavorazione_id');
    }
    btnSave.disabled = true; btnSave.textContent = 'Salvataggio…';
    try {
      const { data, error } = await sb.from('sessioni_lavoro').update(payload).eq('id', s.id).select().single();
      if (error) {
        btnSave.disabled = false; btnSave.textContent = 'Salva';
        return toast(error.message, 'err');
      }
      state.sessioni = state.sessioni.map(x => x.id === s.id ? data : x);
      toast('Sessione aggiornata');
      finalize();
    } catch (e) {
      btnSave.disabled = false; btnSave.textContent = 'Salva';
      toast('Errore di rete: '+(e.message||e), 'err');
    }
  };
  foot.append(btnSave);
  modal.append(foot);
  openModal(modal);
}



// ═══════════════════════════════════════════════════════════
// MODULO ASSENZE V2 — modello righe giornaliere + ore
// ═══════════════════════════════════════════════════════════

const TIPI_ASSENZA_COLORI = [
  '#92D050', '#FFFF00', '#FF7575', '#b0b0b0',
  '#FFC000', '#00B0F0', '#7030A0', '#FF6600',
];

const MESI_NOMI = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
const MESI_ESTESI = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
const MESI_BREVI = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
const GIORNI_BREVI = ['L','M','M','G','V','S','D']; // lun-dom (0=lun)

// Festività nazionali italiane (Set di stringhe ISO YYYY-MM-DD)
function festiviAnno(anno) {
  // riusa la funzione esistente festiviNazionali se disponibile (ritorna array di {data, nome})
  if (typeof festiviNazionali === 'function') {
    const lista = festiviNazionali(anno);
    const s = new Set();
    lista.forEach(f => {
      // f.data può essere Date o stringa
      const iso = f.data instanceof Date ? toLocalISO(f.data) : (f.data || '');
      if (iso) s.add(iso);
    });
    return s;
  }
  // fallback semplice
  return new Set([
    `${anno}-01-01`, `${anno}-01-06`, `${anno}-04-25`, `${anno}-05-01`,
    `${anno}-06-02`, `${anno}-08-15`, `${anno}-11-01`,
    `${anno}-12-08`, `${anno}-12-25`, `${anno}-12-26`,
  ]);
}

function isWeekend(dateObj) {
  const d = dateObj.getDay();
  return d === 0 || d === 6;
}

function isFestivo(iso, festSet) {
  return festSet.has(iso);
}

// Trova un'assenza per utente+data (cache, sync)
function getAssenza(utenteId, iso) {
  return state.assenze.find(a =>
    a.utente_id === utenteId && a.data === iso && a.stato === 'valida'
  );
}

// Trova chiusura aziendale per data
function getChiusuraAziendale(iso) {
  return state.chiusure.find(c => c.data === iso);
}

// Conta ore per un mese/anno per un utente (o globale se senza utente)
function contaOreMese(utenteId, anno, mese) {
  return state.assenze.reduce((sum, a) => {
    if (a.stato !== 'valida') return sum;
    if (utenteId && a.utente_id !== utenteId) return sum;
    const d = parseISODate(a.data);
    if (d.getFullYear() !== anno || d.getMonth() !== mese) return sum;
    return sum + (parseFloat(a.ore) || 0);
  }, 0);
}

function contaOreAnno(utenteId, anno) {
  return state.assenze.reduce((sum, a) => {
    if (a.stato !== 'valida') return sum;
    if (utenteId && a.utente_id !== utenteId) return sum;
    const d = parseISODate(a.data);
    if (d.getFullYear() !== anno) return sum;
    return sum + (parseFloat(a.ore) || 0);
  }, 0);
}

// ═══════════════════════════════════════════════════════════
// VISTA AMMINISTRATORE — calendario matrice
// ═══════════════════════════════════════════════════════════

// Trova il record utente collegato al profilo loggato
function getMioUtente() {
  if (!state.profile) return null;
  return state.utenti.find(u => u.account_id === state.profile.id) || null;
}

function renderAssenze(root) {
  const isAdmin = state.profile?.ruolo === 'admin';
  const mioUtente = getMioUtente();
  root.innerHTML = '';

  // Mini-riassunto personale (se ho un utente collegato)
  if (mioUtente) {
    const annoCorr = new Date().getFullYear();
    const mie = state.assenze.filter(a =>
      a.utente_id === mioUtente.id && a.stato === 'valida'
    );
    const oreAnno = contaOreAnno(mioUtente.id, annoCorr);

    // Calcola ore per tipo (anno corrente)
    const orePerTipo = {};
    mie.forEach(a => {
      const d = parseISODate(a.data);
      if (d.getFullYear() !== annoCorr) return;
      orePerTipo[a.tipo_assenza_id] = (orePerTipo[a.tipo_assenza_id] || 0) + (parseFloat(a.ore) || 0);
    });

    const riass = el('div', {
      style: 'background:var(--sur);border:1px solid var(--brd);border-left:3px solid var(--acc);border-radius:4px;padding:10px 14px;margin-bottom:14px;'
    });
    riass.append(el('div', {
      style: 'font-family:JetBrains Mono,monospace;font-size:11px;color:var(--mut);letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;'
    }, `★ Le tue assenze — ${annoCorr}`));

    const statsRow = el('div', {
      style: 'display:flex;gap:18px;flex-wrap:wrap;align-items:baseline;'
    });
    statsRow.append(el('div', {},
      el('span', { style:'font-family:JetBrains Mono,monospace;font-size:18px;font-weight:700;color:var(--acc);' }, oreAnno + 'h'),
      el('span', { style:'font-family:JetBrains Mono,monospace;font-size:11px;color:var(--mut);margin-left:6px;' }, 'totale'),
    ));
    const tipiAttivi = state.tipiAssenza.filter(t => t.attivo).sort((a,b)=>(a.ordine||0)-(b.ordine||0));
    tipiAttivi.forEach(t => {
      const ore = orePerTipo[t.id] || 0;
      if (ore === 0) return;
      statsRow.append(el('div', {},
        el('span', { style:`font-family:JetBrains Mono,monospace;font-size:14px;font-weight:700;color:${t.colore};` }, ore + 'h'),
        el('span', { style:'font-family:JetBrains Mono,monospace;font-size:11px;color:var(--mut);margin-left:4px;' },
          t.codice ? `${t.codice} (${t.nome})` : t.nome),
      ));
    });
    if (oreAnno === 0) {
      statsRow.append(el('span', { style:'font-family:JetBrains Mono,monospace;font-size:11px;color:var(--mut);' },
        'Nessuna assenza registrata quest\'anno'));
    }
    riass.append(statsRow);
    root.append(riass);
  }

  // Toolbar superiore: switch Mese / Riepilogo
  const toolbar = el('div', { class:'assv2-toolbar' },
    el('h2', { style:'flex:1;' }, 'Calendario assenze'),
    el('div', { class:'switch-bar' },
      el('button', {
        class: state.assVistaCal === 'mese' ? 'act' : '',
        onclick: () => { state.assVistaCal = 'mese'; renderTab('cal_assenze'); }
      }, 'Calendario'),
      el('button', {
        class: state.assVistaCal === 'riepilogo' ? 'act' : '',
        onclick: () => { state.assVistaCal = 'riepilogo'; renderTab('cal_assenze'); }
      }, 'Riepilogo annuale'),
    ),
  );
  root.append(toolbar);

  // Selettore anno
  const annoCorr = new Date().getFullYear();
  const anni = [annoCorr - 1, annoCorr, annoCorr + 1];
  const yearpick = el('div', { class:'assv2-yearpick' });
  anni.forEach(y => {
    yearpick.append(el('button', {
      class: state.assAnno === y ? 'act' : '',
      onclick: () => { state.assAnno = y; renderTab('cal_assenze'); }
    }, String(y)));
  });
  root.append(yearpick);

  if (state.assVistaCal === 'riepilogo') {
    renderRiepilogoAssenze(root);
    return;
  }

  // Tab mesi
  const mesiBar = el('div', { class:'assv2-tabbar' });
  MESI_NOMI.forEach((nome, i) => {
    mesiBar.append(el('div', {
      class: 'assv2-tab' + (state.assMese === i ? ' active' : ''),
      onclick: () => { state.assMese = i; renderTab('cal_assenze'); }
    }, nome));
  });
  root.append(mesiBar);

  renderCalendarioMese(root, state.assAnno, state.assMese, isAdmin);
}

function renderCalendarioMese(root, anno, mese, isAdmin) {
  const numGiorni = new Date(anno, mese + 1, 0).getDate();
  const festSet = festiviAnno(anno);
  const oggiISO = toLocalISO(new Date());

  // Costruisci array giorni
  const giorni = [];
  for (let d = 1; d <= numGiorni; d++) {
    const dateObj = new Date(anno, mese, d);
    const iso = toLocalISO(dateObj);
    giorni.push({
      d, iso, dateObj,
      dow: (dateObj.getDay() + 6) % 7, // 0=lun, 6=dom
      weekend: isWeekend(dateObj),
      festivo: isFestivo(iso, festSet),
      oggi: iso === oggiISO,
      chiusura: getChiusuraAziendale(iso), // record o undefined
    });
  }

  // Legenda
  const legend = el('div', { class:'assv2-legend' });
  legend.append(el('span', { style:'font-weight:700;color:var(--mut);letter-spacing:.08em;text-transform:uppercase;font-size:11px;' }, 'Legenda:'));
  legend.append(el('span', { class:'leg' },
    el('span', { class:'ld', style:'background:rgba(255,78,107,.5);' }), 'Sab/Dom'));
  legend.append(el('span', { class:'leg' },
    el('span', { class:'ld', style:'background:rgba(78,184,255,.5);' }), 'Festivo'));
  legend.append(el('span', { class:'leg' },
    el('span', { class:'ld', style:'background:rgba(255,107,53,.5);' }), 'Chiusura azienda'));
  state.tipiAssenza.filter(t => t.attivo).sort((a,b)=>(a.ordine||0)-(b.ordine||0)).forEach(t => {
    legend.append(el('span', { class:'leg' },
      el('span', { class:'ld', style:`background:${t.colore||'#6b6b64'};` }),
      `${t.codice || '?'} = ${t.nome}`));
  });
  root.append(legend);

  // Tabella matrice
  const wrap = el('div', { class:'assv2-cal-wrap' });
  const table = el('table', { class:'assv2-cal' });

  // Colgroup: 1 colonna nome + N colonne giorno tutte uguali
  const colgroup = el('colgroup');
  colgroup.append(el('col', { class:'assv2-colg-name' }));
  giorni.forEach(() => colgroup.append(el('col', { class:'assv2-col-day' })));
  table.append(colgroup);

  // Riga 1: intestazione mese
  const trMonth = el('tr');
  trMonth.append(el('th', { class:'assv2-th-month', colspan: String(numGiorni + 1) },
    MESI_ESTESI[mese].toUpperCase() + ' ' + anno));
  table.append(trMonth);

  // Riga 2: numeri giorni
  const trDays = el('tr', { class:'assv2-tr-days' });
  trDays.append(el('th', { class:'assv2-col-name' }, ''));
  giorni.forEach(g => {
    const cls = ['assv2-th-day'];
    if (g.weekend) cls.push('we');
    else if (g.festivo) cls.push('fes');
    else if (g.chiusura) cls.push('ca');
    if (g.oggi) cls.push('oggi');
    trDays.append(el('th', { class: cls.join(' '), title: g.festivo ? 'Festivo' : '' }, String(g.d)));
  });
  table.append(trDays);

  // Riga 3: giorni della settimana
  const trDow = el('tr', { class:'assv2-tr-dow' });
  trDow.append(el('th', { class:'assv2-col-name' }, ''));
  giorni.forEach(g => {
    const cls = ['assv2-th-dow'];
    if (g.weekend) cls.push('we');
    else if (g.festivo) cls.push('fes');
    trDow.append(el('th', { class: cls.join(' ') }, GIORNI_BREVI[g.dow]));
  });
  table.append(trDow);

  // Righe utenti (kiosk escluso). Gli esterni in sede si pianificano come gli
  // altri: si assegnano alle commesse e devono comparire nel calendario.
  const utenti = state.utenti
    .filter(u => u.attivo && !isKioskRecord(u))
    .sort((a,b) => a.nome.localeCompare(b.nome));

  const mioUtente = getMioUtente();
  const mioUtenteId = mioUtente?.id || null;

  // Per i non-admin: la propria riga in cima (se esiste)
  let utentiOrdinati = utenti;
  if (!isAdmin && mioUtenteId) {
    utentiOrdinati = [
      ...utenti.filter(u => u.id === mioUtenteId),
      ...utenti.filter(u => u.id !== mioUtenteId),
    ];
  }

  // Costruzione di una riga utente, riusata sia con sia senza raggruppamento
  const buildRigaUtente = (u) => {
    const isMia = u.id === mioUtenteId;
    const tr = el('tr', { class: 'assv2-row' });
    tr.dataset.utenteId = u.id;
    if (isMia) tr.classList.add('assv2-row-mia');

    const tdNome = el('td', {
      class: 'assv2-col-name' + (u.esterno ? ' esterno' : ''),
      style: isMia ? 'border-left:3px solid var(--acc);' : '',
    }, (isMia ? '★ ' : '') + u.nome + (u.esterno ? ' ✦' : ''));
    tr.append(tdNome);

    giorni.forEach(g => {
      const cls = ['assv2-td-day'];
      // Priorità visiva: chiusura → festivo → weekend → assenza utente
      if (g.weekend) cls.push('we');
      else if (g.festivo) cls.push('fes');
      else if (g.chiusura) cls.push('ca');

      const ass = getAssenza(u.id, g.iso);
      let label = '';
      let bgInline = '';
      let colInline = '';

      if (g.festivo) label = 'FS';
      else if (g.chiusura) label = 'CA';
      else if (g.weekend) label = '';

      if (ass) {
        const tipo = state.tipiAssenza.find(t => t.id === ass.tipo_assenza_id);
        const codice = tipo?.codice || '?';
        const ore = parseFloat(ass.ore) || 0;
        // Se è giornata intera (8h) → solo codice; altrimenti codice+ore
        if (ore >= 8) label = codice;
        else label = codice + ore;
        cls.push('has-ass');
        // Override colore di sfondo se non è weekend/festivo/chiusura (che hanno già il loro)
        if (!g.weekend && !g.festivo && !g.chiusura) {
          bgInline = (tipo?.colore || '#6b6b64');
          // Determina colore testo contrastante
          colInline = textColorOnBg(bgInline);
        }
      }

      if (g.oggi) cls.push('oggi');

      // Giorno bloccato per i non-admin? (data fuori da una finestra aperta)
      // Vale solo per la propria riga, e gli admin non sono mai bloccati.
      const isMiaRiga = mioUtenteId && u.id === mioUtenteId;
      let bloccatoFinestra = false, motivoBlocco = '';
      if (!isAdmin && isMiaRiga) {
        const v = verificaAccessoAssenza(g.iso, u);
        if (!v.ok) { bloccatoFinestra = true; motivoBlocco = v.motivo; }
      }
      if (bloccatoFinestra) cls.push('bloccato-preavviso');

      const canEdit = (isAdmin || isMiaRiga)
        && !g.weekend && !g.festivo && !g.chiusura
        && !bloccatoFinestra;
      if (canEdit) cls.push('can-edit');

      const td = el('td', {
        class: cls.join(' '),
        title: bloccatoFinestra
          ? 'Bloccato: ' + motivoBlocco + '. Per modifiche contatta un amministratore.'
          : (ass ? `${ass.ore}h - ${state.tipiAssenza.find(t=>t.id===ass.tipo_assenza_id)?.nome || ''}${ass.note ? '\nNote: '+ass.note : ''}` : ''),
      });
      const span = el('span', {}, label);
      if (bgInline) {
        span.style.background = bgInline;
        span.style.color = colInline;
      }
      td.append(span);

      if (canEdit) {
        td.onclick = () => openCellaAssenzaModal(u, g.iso, ass);
      }

      tr.append(td);
    });
    table.append(tr);
  };

  // Raggruppo per gruppo utenti (riga-intestazione + utenti del gruppo).
  // Coerente con le altre viste raggruppate (Carico, Gantt Live, Gantt Commesse, Kiosk).
  const sezioniAss = raggruppaUtenti(utentiOrdinati);
  sezioniAss.forEach(sez => {
    const trHd = el('tr', { class: 'gruppo-hd-row' + (sez.key === '__nogroup__' ? ' nogroup' : '') });
    trHd.append(el('td', { colspan: String(giorni.length + 1) }, sez.label));
    table.append(trHd);
    sez.utenti.forEach(buildRigaUtente);
  });

  wrap.append(table);
  root.append(wrap);

  // Posiziona dinamicamente le righe-intestazione sticky in base
  // all'altezza reale resa dal browser (evita sovrapposizioni/buchi)
  requestAnimationFrame(() => {
    const hMonth = trMonth.getBoundingClientRect().height;
    const hDays  = trDays.getBoundingClientRect().height;
    trDays.querySelectorAll('th').forEach(th => { th.style.top = hMonth + 'px'; });
    trDow.querySelectorAll('th').forEach(th => { th.style.top = (hMonth + hDays) + 'px'; });
  });
}

// Sceglie colore testo bianco/nero in base allo sfondo
function textColorOnBg(hex) {
  const h = (hex || '').replace('#','');
  if (h.length !== 6) return '#000';
  const r = parseInt(h.substring(0,2), 16);
  const g = parseInt(h.substring(2,4), 16);
  const b = parseInt(h.substring(4,6), 16);
  // luminanza percepita
  const lum = (0.299 * r + 0.587 * g + 0.114 * b);
  return lum > 140 ? '#0f0f0e' : '#fff';
}

// ═══════════════════════════════════════════════════════════
// MODAL: gestione assenza singolo giorno (admin)
// ═══════════════════════════════════════════════════════════

function openCellaAssenzaModal(utente, iso, assEsistente) {
  const modal = el('div', { class:'modal' });
  modal.append(el('div', { class:'mhd' },
    el('h2', {}, assEsistente ? 'Modifica Assenza' : 'Nuova Assenza'),
    el('button', { class:'mclose', onclick:closeModal }, '✕'),
  ));

  const body = el('div', { class:'mbody' });

  body.append(el('div', { class:'assv2-modal-step' },
    assEsistente ? `${utente.nome} · ${fmtIT(iso)}` : utente.nome));

  // Step 1: tipo
  body.append(el('div', { style:'font-family:JetBrains Mono,monospace;font-size:11px;color:var(--mut);margin-bottom:6px;text-transform:uppercase;letter-spacing:.08em;' }, 'Tipo:'));
  let tipoSel = assEsistente?.tipo_assenza_id || '';
  let oreSel = assEsistente ? parseFloat(assEsistente.ore) : null;

  // Determina il comportamento ore in base al codice del tipo
  // F/M/FS = giornata fissa 8h; P = permesso con input step 0.5; altri = chips presets
  function modalitaOre(tipoId) {
    const tipo = state.tipiAssenza.find(t => t.id === tipoId);
    if (!tipo) return 'presets';
    const c = (tipo.codice || '').toUpperCase();
    if (c === 'F' || c === 'M') return 'fissa';
    if (c === 'P') return 'permesso';
    return 'presets';
  }

  const chipsTipo = el('div', { class:'assv2-chips' });
  state.tipiAssenza.filter(t => t.attivo)
    .sort((a,b)=>(a.ordine||0)-(b.ordine||0))
    .forEach(t => {
      const chip = el('div', {
        class: 'assv2-chip' + (tipoSel === t.id ? ' sel' : ''),
        style: tipoSel === t.id
          ? `background:${t.colore};color:${textColorOnBg(t.colore)};border-color:${t.colore};`
          : `border-color:${t.colore};color:${t.colore};`,
        onclick: () => {
          tipoSel = t.id;
          // Riassesta le ore in base al tipo
          const mod = modalitaOre(tipoSel);
          if (mod === 'fissa') oreSel = 8;
          else if (mod === 'permesso') {
            // se non era ancora settato o veniva da un tipo "fisso", parto da 0.5
            if (oreSel === null || oreSel >= 8) oreSel = 0.5;
          } else {
            if (oreSel === null) oreSel = parseFloat(t.ore_default) || 8;
          }
          renderUIOre();
          refresh();
        },
      }, t.codice ? `${t.codice} — ${t.nome}` : t.nome);
      chipsTipo.append(chip);
    });
  body.append(chipsTipo);

  // Step 2: sezione ore (cambia in base al tipo)
  const oreLabel = el('div', {
    style:'font-family:JetBrains Mono,monospace;font-size:11px;color:var(--mut);margin-bottom:6px;text-transform:uppercase;letter-spacing:.08em;'
  }, 'Ore:');
  body.append(oreLabel);

  const oreContainer = el('div', {});
  body.append(oreContainer);

  // Funzione che ridisegna la sezione "ore" in base al tipo selezionato
  function renderUIOre() {
    oreContainer.innerHTML = '';
    if (!tipoSel) {
      oreLabel.style.display = 'none';
      return;
    }
    oreLabel.style.display = '';
    const mod = modalitaOre(tipoSel);

    if (mod === 'fissa') {
      // Giornata intera fissa — mostra solo info, niente input
      oreLabel.style.display = 'none';
      const tipo = state.tipiAssenza.find(t => t.id === tipoSel);
      oreContainer.append(el('div', {
        style: `background:var(--sur2);border:1px solid var(--brd);border-left:3px solid ${tipo?.colore || 'var(--mut)'};padding:9px 12px;border-radius:3px;font-family:JetBrains Mono,monospace;font-size:11px;color:var(--mut);margin-bottom:12px;`
      },
        el('span', { style:'color:var(--txt);font-weight:700;' }, '8h '),
        '— giornata intera',
      ));
    } else if (mod === 'permesso') {
      // Permesso: stepper compatto con bottoni −/+ e input step 0.5
      const stepper = el('div', {
        style:'display:flex;align-items:center;gap:6px;margin-bottom:12px;'
      });
      const btnMinus = el('button', {
        type:'button',
        style:'width:38px;height:38px;font-size:18px;font-weight:700;background:var(--sur2);border:2px solid var(--brd);color:var(--txt);border-radius:3px;cursor:pointer;',
        onclick: () => {
          const v = Math.max(0, (oreSel || 0) - 0.5);
          oreSel = Math.round(v * 2) / 2;
          inputOre.value = oreSel;
          refresh();
        },
      }, '−');
      const inputOre = el('input', {
        type:'number',
        step:'0.5',
        min:'0',
        max:'8',
        value: String(oreSel ?? 0.5),
        style:'flex:1;height:38px;text-align:center;font-family:JetBrains Mono,monospace;font-size:16px;font-weight:700;background:var(--sur2);border:2px solid var(--acc);color:var(--acc);border-radius:3px;outline:none;',
      });
      inputOre.onchange = () => {
        const v = parseFloat(inputOre.value);
        if (isNaN(v) || v < 0) { inputOre.value = 0; oreSel = 0; }
        else if (v > 8) { inputOre.value = 8; oreSel = 8; }
        else { oreSel = Math.round(v * 2) / 2; inputOre.value = oreSel; }
        refresh();
      };
      const btnPlus = el('button', {
        type:'button',
        style:'width:38px;height:38px;font-size:18px;font-weight:700;background:var(--sur2);border:2px solid var(--brd);color:var(--txt);border-radius:3px;cursor:pointer;',
        onclick: () => {
          const v = Math.min(8, (oreSel || 0) + 0.5);
          oreSel = Math.round(v * 2) / 2;
          inputOre.value = oreSel;
          refresh();
        },
      }, '+');
      const lbl = el('span', { style:'font-family:JetBrains Mono,monospace;font-size:13px;color:var(--mut);min-width:28px;' }, 'h');
      stepper.append(btnMinus, inputOre, lbl, btnPlus);
      oreContainer.append(stepper);
      oreContainer.append(el('div', {
        style:'font-family:JetBrains Mono,monospace;font-size:11px;color:var(--mut);'
      }, 'Da 0 a 8 ore, scaglioni di 30 minuti'));
    } else {
      // "presets" — chips 8/4/2/1/0.5 + input altro (per tipo "Altro/V")
      const chipsOre = el('div', { class:'assv2-chips' });
      const orePresets = [8, 4, 2, 1, 0.5];
      orePresets.forEach(o => {
        chipsOre.append(el('div', {
          class: 'assv2-chip' + (oreSel === o ? ' sel' : ''),
          onclick: () => { oreSel = o; refresh(); },
        }, o + 'h'));
      });
      const inputAltro = el('input', {
        type:'number', step:'0.5', min:'0', max:'24', placeholder:'altro',
        style:'flex:0 0 70px;height:auto;padding:9px 8px;font-family:JetBrains Mono,monospace;font-size:11px;background:var(--sur2);border:2px solid var(--brd);color:var(--txt);border-radius:3px;',
        value: oreSel !== null && !orePresets.includes(oreSel) ? oreSel : '',
      });
      inputAltro.onchange = () => {
        const v = parseFloat(inputAltro.value);
        if (!isNaN(v) && v >= 0 && v <= 24) {
          oreSel = Math.round(v * 2) / 2;
          refresh();
        }
      };
      chipsOre.append(inputAltro);
      oreContainer.append(chipsOre);
    }
  }

  // Note
  body.append(el('div', { class:'field', style:'margin-top:10px;' },
    el('label', {}, 'Note (opz.)'),
    el('textarea', { id:'ass-note', rows:'2' }, assEsistente?.note || ''),
  ));

  // Periodo: "ripeti fino al" — solo in inserimento (non in modifica).
  // Se valorizzato, crea una riga per ogni giorno del periodo [iso, fine].
  let inputInizio = null, inputFine = null;
  if (!assEsistente) {
    inputInizio = el('input', { type:'date', id:'ass-inizio', value: iso });
    inputFine = el('input', { type:'date', id:'ass-fine', min: iso, value: '', onchange: () => refresh() });
    inputInizio.onchange = () => {
      // L'inizio guida il minimo della fine; se la fine resta indietro, la azzero.
      const v = inputInizio.value || iso;
      inputFine.min = v;
      if (inputFine.value && inputFine.value < v) inputFine.value = '';
      refresh();
    };
    body.append(
      el('div', { class:'field', style:'margin-top:10px;' },
        el('label', {}, 'Dal'),
        inputInizio,
      ),
      el('div', { class:'field', style:'margin-top:10px;' },
        el('label', {}, 'Al (opz. — per un periodo)'),
        inputFine,
        el('div', { style:'font-size:11px;color:var(--mut);margin-top:4px;' },
          'Weekend, festivi e chiusure aziendali vengono saltati automaticamente.'),
      ),
    );
  }

  // Riepilogo selezione
  const riepilogo = el('div', {
    style: 'font-family:JetBrains Mono,monospace;font-size:11px;color:var(--mut);padding:8px 10px;background:var(--sur2);border-radius:3px;margin-top:10px;'
  });
  body.append(riepilogo);

  modal.append(body);

  const foot = el('div', { class:'mfoot' });
  if (assEsistente) {
    foot.append(el('button', {
      class: 'btnd',
      onclick: async () => {
        // Stessa regola del salvataggio: la data deve essere in una
        // finestra di apertura attiva per i non-admin.
        const sonoAdmin = state.profile?.ruolo === 'admin';
        const perMeStesso = utente.account_id === state.profile?.id;
        if (!sonoAdmin && perMeStesso) {
          const verifica = verificaAccessoAssenza(iso, utente);
          if (!verifica.ok) {
            return toast('Eliminazione non consentita: ' + verifica.motivo + '.', 'err');
          }
        }
        if (!confirm(`Eliminare l'assenza di ${utente.nome} del ${fmtIT(iso)}?`)) return;
        await eliminaAssenza(assEsistente);
      },
    }, '🗑 Elimina'));
  }
  foot.append(el('button', { class:'btng', onclick:closeModal }, 'Chiudi'));
  const btnSave = el('button', { class:'btnp' }, 'Salva');
  btnSave.onclick = async () => {
    if (!tipoSel) return toast('Seleziona il tipo', 'err');
    if (oreSel === null || oreSel < 0) return toast('Inserisci le ore', 'err');

    const sonoAdmin = state.profile?.ruolo === 'admin';
    const perMeStesso = utente.account_id === state.profile?.id;
    const note = (document.getElementById('ass-note').value || '').trim() || null;

    // ── MODIFICA: comportamento invariato (singolo giorno) ──
    if (assEsistente) {
      if (!sonoAdmin && perMeStesso) {
        const verifica = verificaAccessoAssenza(iso, utente);
        if (!verifica.ok) return toast('Inserimento non consentito: ' + verifica.motivo + '.', 'err');
      }
      btnSave.disabled = true; btnSave.textContent = 'Salvataggio…';
      try {
        const { data, error } = await eseguiConRetry(
          () => sb.from('assenze').update({ tipo_assenza_id: tipoSel, ore: oreSel, note })
                  .eq('id', assEsistente.id).select().single(),
          { label: 'salvataggio assenza' }
        );
        if (error) {
          btnSave.disabled = false; btnSave.textContent = 'Salva';
          if (error.code === '23505') return toast('Esiste già un\'assenza per questa persona/giorno', 'err');
          return toast(error.message, 'err');
        }
        state.assenze = state.assenze.map(x => x.id === data.id ? data : x);
        toast('Assenza salvata'); closeModal(); renderTab('cal_assenze');
      } catch (e) {
        btnSave.disabled = false; btnSave.textContent = 'Salva';
        toast('Errore: '+(e.message||e), 'err');
      }
      return;
    }

    // ── NUOVA: singolo giorno oppure periodo [inizioIso, fineIso] ──
    const inizioIso = (inputInizio && inputInizio.value) ? inputInizio.value : iso;
    const fineIso = inputFine ? (inputFine.value || '').trim() : '';
    let giorni = [];
    if (fineIso && fineIso < inizioIso) {
      return toast('La data finale deve essere uguale o successiva a quella iniziale', 'err');
    } else if (fineIso && fineIso > inizioIso) {
      const d = parseISODate(inizioIso);
      const fine = parseISODate(fineIso);
      while (d <= fine) {
        if (!isGiornoNonLavorativo(d)) giorni.push(toLocalISO(d));
        d.setDate(d.getDate() + 1);
      }
    } else {
      giorni = [inizioIso];
    }

    // Salta i giorni già con un'assenza per questa persona (no overwrite).
    let giaPresenti = 0;
    giorni = giorni.filter(g => { if (getAssenza(utente.id, g)) { giaPresenti++; return false; } return true; });

    // Non-admin per sé stesso: tieni solo i giorni nella finestra consentita.
    let fuoriFinestra = 0;
    if (!sonoAdmin && perMeStesso) {
      giorni = giorni.filter(g => { if (!verificaAccessoAssenza(g, utente).ok) { fuoriFinestra++; return false; } return true; });
    }

    if (giorni.length === 0) {
      const motivi = [];
      if (giaPresenti) motivi.push(`${giaPresenti} già presenti`);
      if (fuoriFinestra) motivi.push(`${fuoriFinestra} fuori finestra`);
      return toast('Nessun giorno da inserire' + (motivi.length ? ' ('+motivi.join(', ')+')' : ''), 'err');
    }

    btnSave.disabled = true; btnSave.textContent = 'Salvataggio…';
    const rows = giorni.map(g => ({
      utente_id: utente.id, tipo_assenza_id: tipoSel, data: g,
      ore: oreSel, stato: 'valida', note, creato_da: state.profile.id,
    }));
    try {
      const { data, error } = await eseguiConRetry(
        () => sb.from('assenze').insert(rows).select(),
        { label: 'salvataggio assenze' }
      );
      if (error) {
        btnSave.disabled = false; btnSave.textContent = 'Salva';
        if (error.code === '23505') return toast('Alcuni giorni hanno già un\'assenza', 'err');
        return toast(error.message, 'err');
      }
      (data || []).forEach(r => { if (!state.assenze.find(x => x.id === r.id)) state.assenze.unshift(r); });
      let msg = giorni.length === 1 ? 'Assenza salvata' : `${giorni.length} assenze salvate`;
      const extra = [];
      if (giaPresenti) extra.push(`${giaPresenti} già presenti saltate`);
      if (fuoriFinestra) extra.push(`${fuoriFinestra} fuori finestra saltate`);
      if (extra.length) msg += ' (' + extra.join(', ') + ')';
      toast(msg); closeModal(); renderTab('cal_assenze');
    } catch (e) {
      btnSave.disabled = false; btnSave.textContent = 'Salva';
      toast('Errore: '+(e.message||e), 'err');
    }
  };
  foot.append(btnSave);
  modal.append(foot);
  openModal(modal);

  function refresh() {
    // Aggiorna chips tipo
    const tipiAttivi = state.tipiAssenza.filter(x => x.attivo).sort((a,b)=>(a.ordine||0)-(b.ordine||0));
    chipsTipo.querySelectorAll('.assv2-chip').forEach((c, i) => {
      const t = tipiAttivi[i];
      if (!t) return;
      const isSel = tipoSel === t.id;
      c.className = 'assv2-chip' + (isSel ? ' sel' : '');
      c.style.cssText = isSel
        ? `background:${t.colore};color:${textColorOnBg(t.colore)};border-color:${t.colore};`
        : `border-color:${t.colore};color:${t.colore};`;
    });
    // La sezione ore è ridisegnata da renderUIOre quando cambia il tipo;
    // qui aggiorniamo solo il riepilogo finale.
    const tipo = state.tipiAssenza.find(t => t.id === tipoSel);
    if (tipo && oreSel !== null) {
      riepilogo.innerHTML = '';
      const inizioV = (inputInizio && inputInizio.value) ? inputInizio.value : iso;
      const fineV = inputFine ? (inputFine.value || '').trim() : '';
      const periodo = (fineV && fineV > inizioV)
        ? `dal ${fmtIT(inizioV)} al ${fmtIT(fineV)}`
        : fmtIT(inizioV);
      riepilogo.append(
        el('span', { style:'color:var(--txt);font-weight:700;' }, `${tipo.nome}: ${oreSel}h`),
        ' · ',
        el('span', { style:'color:var(--acc);' }, periodo),
      );
    } else {
      riepilogo.textContent = 'Seleziona tipo per continuare';
    }
  }
  // Render iniziale UI ore + refresh per popolare il riepilogo
  renderUIOre();
  refresh();
}

async function eliminaAssenza(a) {
  const { data, error } = await sb.from('assenze').delete().eq('id', a.id).select();
  if (error) return toast(error.message, 'err');
  if (!data || !data.length) return toast('Eliminazione bloccata (verifica policy)', 'err');
  state.assenze = state.assenze.filter(x => x.id !== a.id);
  toast('Assenza eliminata');
  closeModal();
  renderTab('cal_assenze');
}

// ═══════════════════════════════════════════════════════════
// CHIUSURE AZIENDALI da riga matrice (toggle veloce)
// ═══════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════
// RIEPILOGO ANNUALE
// ═══════════════════════════════════════════════════════════

function renderRiepilogoAssenze(root) {
  const anno = state.assAnno;
  // Gli esterni in sede restano fuori DI PROPOSITO: ferie, permessi e monte
  // ore sono rapporti col loro datore di lavoro, non con Cablotec. Qui si
  // timbra il lavoro fatto, non si gestisce il loro contratto.
  const utenti = state.utenti
    .filter(u => u.attivo && !isKioskRecord(u) && !u.esterno)
    .sort((a,b) => a.nome.localeCompare(b.nome));

  root.append(el('div', { class:'sub', style:'margin-bottom:8px;' },
    `Totale ore di assenza per dipendente nei mesi dell'anno ${anno}.`));

  const wrap = el('div', { class:'assv2-rie-wrap' });
  const tbl = el('table', { class:'assv2-rie' });
  const thead = el('thead');
  const trH = el('tr');
  trH.append(el('th', {}, 'Dipendente'));
  MESI_NOMI.forEach(m => trH.append(el('th', {}, m)));
  trH.append(el('th', { style:'color:var(--acc);' }, 'Tot Anno'));
  thead.append(trH);
  tbl.append(thead);

  const tb = el('tbody');
  utenti.forEach(u => {
    const tr = el('tr');
    tr.append(el('td', {}, u.nome));
    let totAnno = 0;
    for (let m = 0; m < 12; m++) {
      const ore = contaOreMese(u.id, anno, m);
      totAnno += ore;
      tr.append(el('td', {}, ore ? ore + 'h' : ''));
    }
    tr.append(el('td', { class:'ore-tot' }, totAnno ? totAnno + 'h' : ''));
    tb.append(tr);
  });
  tbl.append(tb);
  wrap.append(tbl);
  root.append(wrap);

  // Riepilogo per tipo
  root.append(el('div', { class:'sub', style:'margin:20px 0 8px;font-weight:700;color:var(--acc);' },
    'Distribuzione per tipo di assenza'));
  const wrapTipi = el('div', { class:'assv2-rie-wrap' });
  const tblTipi = el('table', { class:'assv2-rie' });
  const trHT = el('tr');
  trHT.append(el('th', {}, 'Dipendente'));
  state.tipiAssenza.filter(t => t.attivo).sort((a,b)=>(a.ordine||0)-(b.ordine||0)).forEach(t => {
    trHT.append(el('th', {}, t.codice ? `${t.codice} (${t.nome})` : t.nome));
  });
  trHT.append(el('th', { style:'color:var(--acc);' }, 'Tot Anno'));
  tblTipi.append(el('thead', {}, trHT));

  const tbT = el('tbody');
  utenti.forEach(u => {
    const tr = el('tr');
    tr.append(el('td', {}, u.nome));
    let totAnno = 0;
    state.tipiAssenza.filter(t => t.attivo).sort((a,b)=>(a.ordine||0)-(b.ordine||0)).forEach(t => {
      const ore = state.assenze.reduce((sum, a) => {
        if (a.stato !== 'valida' || a.utente_id !== u.id || a.tipo_assenza_id !== t.id) return sum;
        const d = parseISODate(a.data);
        if (d.getFullYear() !== anno) return sum;
        return sum + (parseFloat(a.ore) || 0);
      }, 0);
      totAnno += ore;
      tr.append(el('td', {}, ore ? ore + 'h' : ''));
    });
    tr.append(el('td', { class:'ore-tot' }, totAnno ? totAnno + 'h' : ''));
    tbT.append(tr);
  });
  tblTipi.append(tbT);
  wrapTipi.append(tblTipi);
  root.append(wrapTipi);
}

// ═══════════════════════════════════════════════════════════
// IMPOSTAZIONI — configurazioni globali del gestionale
// ═══════════════════════════════════════════════════════════

function renderImpostazioni(root) {
  const isAdmin = state.profile?.ruolo === 'admin';
  root.innerHTML = '';
  root.append(el('div', { class:'toolbar' }, el('h2', {}, 'Impostazioni')));

  if (!isAdmin) {
    root.append(el('div', { class:'empty' }, 'Solo gli amministratori possono modificare le impostazioni.'));
    return;
  }

  const box = el('div', { style:'background:var(--sur);border:1px solid var(--brd);border-radius:6px;padding:20px;max-width:760px;' });

  box.append(el('h3', { style:'margin:0 0 6px;font-family:Syne,sans-serif;font-size:14px;font-weight:700;color:var(--acc);' },
    'Apertura inserimento assenze'));
  box.append(el('div', { style:'font-size:11px;color:var(--mut);margin-bottom:18px;line-height:1.6;' },
    'Definisce quando gli utenti non amministratori possono inserire le proprie assenze (ferie e permessi). Ogni finestra ha due parametri: il ',
    el('strong', {}, 'periodo di apertura'),
    ' (le date in cui possono inserire) e il ',
    el('strong', {}, 'periodo coperto'),
    ' (su quale arco di tempo possono inserire). Le date sono ricorrenti ogni anno (formato gg-mm).'));

  // Genera una riga "Etichetta: [input gg-mm]"
  const inputs = {};
  function fieldGGMM(chiave, label, defaultVal) {
    const wrap = el('div', { style:'display:flex;gap:8px;align-items:center;margin-bottom:8px;' });
    const inp = el('input', {
      type:'text', placeholder:'gg-mm', maxlength:'5',
      value: getImpostazione(chiave, defaultVal),
      style:'width:80px;padding:5px 8px;background:var(--sur2);border:1px solid var(--brd);border-radius:3px;color:var(--txt);font-family:JetBrains Mono,monospace;font-size:12px;text-align:center;',
    });
    inputs[chiave] = inp;
    wrap.append(el('label', { style:'font-size:11px;font-family:Syne,sans-serif;font-weight:600;min-width:220px;' }, label), inp);
    return wrap;
  }

  // ── Finestra estiva ────────────────────────────────────────
  const blocchiEstivi = el('div', { style:'background:var(--sur2);border:1px solid var(--brd);border-radius:4px;padding:14px;margin-bottom:14px;' });
  blocchiEstivi.append(el('div', { style:'font-family:Syne,sans-serif;font-size:13px;font-weight:700;color:var(--txt);margin-bottom:10px;' },
    '☀ Finestra ESTIVA'));
  blocchiEstivi.append(el('div', { style:'font-family:JetBrains Mono,monospace;font-size:11px;color:var(--mut);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em;' },
    'Quando si possono inserire (apertura):'));
  blocchiEstivi.append(fieldGGMM('finestra_estiva_apertura_da', 'Apertura dal:', '01-03'));
  blocchiEstivi.append(fieldGGMM('finestra_estiva_apertura_a',  'Apertura al:',  '31-03'));
  blocchiEstivi.append(el('div', { style:'font-family:JetBrains Mono,monospace;font-size:11px;color:var(--mut);margin:14px 0 8px;text-transform:uppercase;letter-spacing:.05em;' },
    'Su quale periodo si possono inserire:'));
  blocchiEstivi.append(fieldGGMM('finestra_estiva_periodo_da', 'Periodo coperto dal:', '01-04'));
  blocchiEstivi.append(fieldGGMM('finestra_estiva_periodo_a',  'Periodo coperto al:',  '30-09'));
  box.append(blocchiEstivi);

  // ── Finestra invernale ─────────────────────────────────────
  const blocchiInvernali = el('div', { style:'background:var(--sur2);border:1px solid var(--brd);border-radius:4px;padding:14px;margin-bottom:14px;' });
  blocchiInvernali.append(el('div', { style:'font-family:Syne,sans-serif;font-size:13px;font-weight:700;color:var(--txt);margin-bottom:10px;' },
    '❄ Finestra INVERNALE'));
  blocchiInvernali.append(el('div', { style:'font-family:JetBrains Mono,monospace;font-size:11px;color:var(--mut);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em;' },
    'Quando si possono inserire (apertura):'));
  blocchiInvernali.append(fieldGGMM('finestra_invernale_apertura_da', 'Apertura dal:', '01-09'));
  blocchiInvernali.append(fieldGGMM('finestra_invernale_apertura_a',  'Apertura al:',  '30-09'));
  blocchiInvernali.append(el('div', { style:'font-family:JetBrains Mono,monospace;font-size:11px;color:var(--mut);margin:14px 0 8px;text-transform:uppercase;letter-spacing:.05em;' },
    'Su quale periodo si possono inserire:'));
  blocchiInvernali.append(fieldGGMM('finestra_invernale_periodo_da', 'Periodo coperto dal:', '01-10'));
  blocchiInvernali.append(fieldGGMM('finestra_invernale_periodo_a',  'Periodo coperto al:',  '31-03'));
  box.append(blocchiInvernali);

  // ── Esenzioni per gruppo ───────────────────────────────────
  // I gruppi spuntati sono esenti da TUTTI i vincoli di inserimento assenze
  // (finestra di apertura + blocco date passate). Configurazione globale,
  // letta da getGruppiEsentiAssenze() in verificaAccessoAssenza().
  const esentiAttuali = new Set(getGruppiEsentiAssenze());
  const checkboxEsenti = {};
  const blocchiEsenti = el('div', { style:'background:var(--sur2);border:1px solid var(--brd);border-radius:4px;padding:14px;margin-bottom:14px;' });
  blocchiEsenti.append(el('div', { style:'font-family:Syne,sans-serif;font-size:13px;font-weight:700;color:var(--txt);margin-bottom:6px;' },
    '⊘ Esenzioni gruppi'));
  blocchiEsenti.append(el('div', { style:'font-size:11px;color:var(--mut);margin-bottom:12px;line-height:1.6;' },
    'I gruppi spuntati possono inserire/modificare le proprie assenze in qualsiasi data, ignorando le finestre di apertura e il blocco sulle date passate.'));
  GRUPPI_UTENTI.forEach(g => {
    const row = el('label', {
      style:'display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:3px;cursor:pointer;font-family:JetBrains Mono,monospace;font-size:11px;',
      onmouseenter: function(){ this.style.background='var(--sur)'; },
      onmouseleave: function(){ this.style.background='transparent'; },
    });
    const cb = el('input', {
      type:'checkbox',
      style:'cursor:pointer;accent-color:var(--acc);',
    });
    cb.checked = esentiAttuali.has(g.key);
    checkboxEsenti[g.key] = cb;
    row.append(cb, el('span', {}, g.label));
    blocchiEsenti.append(row);
  });
  box.append(blocchiEsenti);

  // ── Anteprima dello stato corrente ─────────────────────────
  const oggiIso = toLocalISO(new Date());
  const finestreCorrenti = getFinestreAssenze();
  const stati = finestreCorrenti.map(f => {
    const aperta = isoDentroIntervallo(oggiIso, f.aperturaDa, f.aperturaA);
    return { nome:f.nome, aperta };
  });
  const statoBox = el('div', { style:'background:var(--sur2);border-left:3px solid var(--acc);border-radius:2px;padding:10px 14px;margin-bottom:18px;font-family:JetBrains Mono,monospace;font-size:11px;' });
  statoBox.append(el('div', { style:'color:var(--mut);margin-bottom:4px;' }, 'Stato oggi:'));
  stati.forEach(s => {
    statoBox.append(el('div', {},
      el('span', { style:'color:' + (s.aperta ? 'var(--grn)' : 'var(--mut)') + ';font-weight:700;' },
        (s.aperta ? '● aperta' : '○ chiusa')),
      el('span', {}, '  Finestra ' + s.nome)));
  });
  box.append(statoBox);

  const msgArea = el('div', { style:'min-height:18px;margin-bottom:10px;font-size:11px;font-family:JetBrains Mono,monospace;' });
  const btnSalva = el('button', { class:'btnp' }, 'Salva impostazioni');
  btnSalva.onclick = async () => {
    // Validazione: tutte le coppie devono essere gg-mm valide
    const chiavi = Object.keys(inputs);
    const valoriDaSalvare = {};
    for (const k of chiavi) {
      const v = (inputs[k].value || '').trim();
      const parsed = parseGGMM(v);
      if (!parsed) {
        msgArea.style.color = 'var(--red)';
        msgArea.textContent = '⚠ Valore non valido per "' + k + '": serve formato gg-mm (es. 15-03).';
        return;
      }
      // Riscrivo in forma canonica zero-padded
      valoriDaSalvare[k] = z(parsed.giorno) + '-' + z(parsed.mese);
    }
    // Esenzioni gruppi (JSON serializzato, lista di key)
    const esentiNuovi = GRUPPI_UTENTI
      .filter(g => checkboxEsenti[g.key]?.checked)
      .map(g => g.key);
    valoriDaSalvare['assenze_gruppi_esenti'] = JSON.stringify(esentiNuovi);
    btnSalva.disabled = true;
    btnSalva.textContent = 'Salvataggio…';
    try {
      const rows = Object.entries(valoriDaSalvare).map(([chiave, valore]) => ({
        chiave, valore, aggiornato_il: new Date().toISOString(),
      }));
      const { error } = await eseguiConRetry(
        () => sb.from('impostazioni').upsert(rows, { onConflict: 'chiave' }),
        { label: 'salva impostazioni assenze' }
      );
      if (error) throw error;
      // Aggiorno lo state locale
      Object.entries(valoriDaSalvare).forEach(([k, v]) => { state.impostazioni[k] = v; });
      msgArea.style.color = 'var(--grn)';
      msgArea.textContent = '✓ Salvato.';
      toast('Impostazioni aggiornate', 'ok');
      // Ridisegno per aggiornare lo stato "aperto/chiuso"
      setTimeout(() => renderImpostazioni(root), 800);
    } catch (e) {
      msgArea.style.color = 'var(--red)';
      msgArea.textContent = '⚠ Errore: ' + (e.message || e);
    } finally {
      btnSalva.disabled = false;
      btnSalva.textContent = 'Salva impostazioni';
    }
  };
  box.append(msgArea, btnSalva);

  root.append(box);
}

// ═══════════════════════════════════════════════════════════
// TIPI ASSENZA (anagrafica) — aggiornato per codice + ore_default
// ═══════════════════════════════════════════════════════════

function renderTipiAssenza(root) {
  const isAdmin = state.profile?.ruolo === 'admin';
  const list = state.tipiAssenza.slice().sort((a,b) => (a.ordine||0) - (b.ordine||0));

  root.innerHTML = '';
  const toolbar = el('div', { class:'toolbar' },
    el('h2', {}, 'Tipi di assenza'),
  );
  if (isAdmin) {
    toolbar.append(el('button', { class:'btnp', onclick:()=>openTipoAssenzaModal() }, '+ Nuovo Tipo'));
  }
  root.append(toolbar);
  root.append(el('div', { class:'sub', style:'margin-bottom:14px;' },
    'Codici visualizzati nel calendario (F=Ferie, P=Permesso, M=Malattia, V=Varie). Puoi modificarli o aggiungerne.'));

  if (list.length === 0) {
    root.append(el('div', { class:'empty' }, 'Nessun tipo definito.'));
    return;
  }

  const tw = el('div', { class:'tw' });
  const tbl = el('table', { class:'rt' });
  tbl.append(el('thead', {}, el('tr', {},
    el('th', { class:'tc', style:'width:50px;' }, 'Ord.'),
    el('th', { class:'tc' }, 'Codice'),
    el('th', {}, 'Nome'),
    el('th', { class:'tc' }, 'Ore def.'),
    el('th', { class:'tc' }, 'Colore'),
    el('th', { class:'tc' }, 'Stato'),
    el('th', { class:'tc' }, 'Azioni'),
  )));
  const tb = el('tbody');
  list.forEach(t => {
    tb.append(el('tr', {},
      el('td', { class:'tc mono' }, String(t.ordine || 0)),
      el('td', { class:'tc mono' }, t.codice
        ? el('span', { style:`display:inline-block;padding:2px 8px;border-radius:2px;background:${t.colore};color:${textColorOnBg(t.colore)};font-weight:700;` }, t.codice)
        : el('span', { class:'sub' }, '—')),
      el('td', {}, t.nome),
      el('td', { class:'tc mono' }, (parseFloat(t.ore_default) || 0) + 'h'),
      el('td', { class:'tc' }, el('span', {
        style: `display:inline-block;width:24px;height:14px;border-radius:2px;background:${t.colore||'#6b6b64'};vertical-align:middle;border:1px solid var(--brd);`,
      })),
      el('td', { class:'tc' }, t.attivo
        ? el('span', { class:'badge bok' }, 'attivo')
        : el('span', { class:'badge bgry' }, 'disatt.')),
      el('td', { class:'tc' },
        isAdmin
          ? el('span', {},
              el('button', { class:'btnsm', onclick:()=>openTipoAssenzaModal(t) }, 'Modifica'),
              ' ',
              el('button', { class:'btnd', onclick:()=>deleteTipoAssenza(t) }, 'Elimina'),
            )
          : '—'
      ),
    ));
  });
  tbl.append(tb);
  tw.append(tbl);
  root.append(tw);
}

function openTipoAssenzaModal(t) {
  const isNew = !t;
  const nextOrdine = isNew
    ? (Math.max(0, ...state.tipiAssenza.map(x => x.ordine||0)) + 1)
    : t.ordine;
  t = t || {
    nome:'',
    codice:'',
    ore_default: 8,
    ordine: nextOrdine,
    colore: TIPI_ASSENZA_COLORI[state.tipiAssenza.length % TIPI_ASSENZA_COLORI.length],
    attivo: true,
  };

  const modal = el('div', { class:'modal' });
  modal.append(el('div', { class:'mhd' },
    el('h2', {}, isNew ? 'Nuovo Tipo Assenza' : 'Modifica Tipo Assenza'),
    el('button', { class:'mclose', onclick:closeModal }, '✕'),
  ));

  const body = el('div', { class:'mbody' });
  const form = el('form');

  const inNome = el('input', { type:'text', name:'nome', value:t.nome||'', required:'true' });
  const inCodice = el('input', { type:'text', name:'codice', value:t.codice||'', maxlength:'2',
    placeholder:'F, P, M…', style:'text-transform:uppercase;' });
  const inOreDef = el('input', { type:'number', name:'ore_default', value:String(t.ore_default||0), step:'0.5', min:'0', max:'24' });
  const inOrdine = el('input', { type:'number', name:'ordine', value:String(t.ordine||0), min:'0' });
  const selAttivo = el('select', { name:'attivo' },
    el('option', { value:'true' }, 'Attivo'),
    el('option', { value:'false' }, 'Disattivato'));
  selAttivo.value = String(!!t.attivo);

  let coloreScelto = t.colore || TIPI_ASSENZA_COLORI[0];
  const palette = el('div', { style:'display:flex;flex-wrap:wrap;gap:6px;padding:6px;background:var(--sur2);border:1px solid var(--brd);border-radius:4px;' });
  const refreshPalette = () => {
    palette.innerHTML = '';
    TIPI_ASSENZA_COLORI.forEach(col => {
      const sel = col === coloreScelto;
      palette.append(el('button', {
        type:'button',
        style: `width:34px;height:28px;border-radius:3px;background:${col};border:2px solid ${sel?'var(--acc)':'transparent'};cursor:pointer;outline:none;`,
        onclick: () => { coloreScelto = col; refreshPalette(); },
      }));
    });
  };
  refreshPalette();

  form.append(
    el('div', { class:'field' }, el('label', {}, 'Nome *'), inNome),
    el('div', { class:'frow' },
      el('div', { class:'field' }, el('label', {}, 'Codice breve (1-2 lettere)'), inCodice,
        el('div', { class:'sub', style:'margin-top:4px;' }, 'Es. "F" per Ferie, "P" per Permesso. Lascia vuoto se non vuoi mostrarlo.')),
      el('div', { class:'field' }, el('label', {}, 'Ore default'), inOreDef,
        el('div', { class:'sub', style:'margin-top:4px;' }, 'Pre-impostato quando selezioni il tipo (es. 8 per giornata).')),
    ),
    el('div', { class:'frow' },
      el('div', { class:'field' }, el('label', {}, 'Ordine'), inOrdine),
      el('div', { class:'field' }, el('label', {}, 'Stato'), selAttivo),
    ),
    el('div', { class:'field' }, el('label', {}, 'Colore'), palette),
  );

  body.append(form);
  modal.append(body);

  const foot = el('div', { class:'mfoot' });
  foot.append(el('button', { class:'btng', onclick:closeModal }, 'Chiudi'));
  const btnSave = el('button', { class:'btnp' }, 'Salva');
  btnSave.onclick = async () => {
    const fd = new FormData(form);
    const payload = {
      nome: (fd.get('nome')||'').trim(),
      codice: ((fd.get('codice')||'').trim().toUpperCase()) || null,
      ore_default: parseFloat(fd.get('ore_default')) || 0,
      ordine: parseInt(fd.get('ordine')) || 0,
      colore: coloreScelto,
      attivo: fd.get('attivo') === 'true',
    };
    if (!payload.nome) return toast('Nome obbligatorio', 'err');
    btnSave.disabled = true;
    btnSave.textContent = 'Salvataggio…';
    try {
      const { data, error } = await eseguiConRetry(
        () => isNew ? sb.from('tipi_assenza').insert(payload).select().single() : sb.from('tipi_assenza').update(payload).eq('id', t.id).select().single(),
        { label: 'salvataggio tipi_assenza' }
      );
      if (error) {
        btnSave.disabled = false;
        btnSave.textContent = 'Salva';
        if (error.code === '23505') return toast('Codice o nome già esistente', 'err');
        return toast(error.message, 'err');
      }
      if (isNew) {
        if (!state.tipiAssenza.find(x => x.id === data.id)) state.tipiAssenza.push(data);
      } else {
        state.tipiAssenza = state.tipiAssenza.map(x => x.id === t.id ? data : x);
      }
      toast(isNew ? 'Tipo creato' : 'Tipo aggiornato');
      closeModal(); renderTab('tipi_assenza');
    } catch (e) {
      btnSave.disabled = false;
      btnSave.textContent = 'Salva';
      toast('Errore: '+(e.message||e), 'err');
    }
  };
  foot.append(btnSave);
  modal.append(foot);
  openModal(modal);
}

async function deleteTipoAssenza(t) {
  if (!confirm(`Eliminare il tipo "${t.nome}"?\nLe assenze che lo usano resteranno ma senza tipo.`)) return;
  const { data, error } = await sb.from('tipi_assenza').delete().eq('id', t.id).select();
  if (error) return toast(error.message, 'err');
  if (!data || !data.length) return toast('Eliminazione bloccata', 'err');
  state.tipiAssenza = state.tipiAssenza.filter(x => x.id !== t.id);
  toast('Tipo eliminato'); renderTab('tipi_assenza');
}

// ── STRISCIA "TIMBRATURE SOSPETTE" (sopra tutte le schede) ─────────────────
// Riepilogo in cima alla scheda Live. Compare SOLO quando c'è qualcosa, e
// finché c'è qualcosa NON si può mettere via (7 ago, decisione Nico): c'era un
// "per oggi basta" che la nascondeva fino al giorno dopo, ed è stato tolto
// perché serviva l'esatto contrario — l'elenco esiste per essere svuotato, e
// una lista che si può zittire si zittisce e basta. Sparisce da sola quando le
// timbrature sono sistemate, che è l'unico modo giusto di farla sparire.
// Le anomalie le trova `timbratureSospette()` nel domain (puro); qui c'è solo
// il disegno.
function renderSospette() {
  const bar = document.getElementById('sospette-bar');
  if (!bar) return;
  bar.innerHTML = '';
  // Ripulisce la chiave del vecchio "per oggi basta": chi l'aveva premuta se
  // la ritroverebbe attiva senza più un bottone per annullarla.
  try { localStorage.removeItem('sospette-chiuse'); } catch (_) {}
  if (typeof timbratureSospette !== 'function') {
    bar.style.display = 'none';
    return;
  }
  const r = timbratureSospette();
  if (!r.n) { bar.style.display = 'none'; return; }
  const isAdmin = state.profile?.ruolo === 'admin';
  const ETICHETTE = {
    aperta: 'aperta da troppo',
    lunga: 'durata assurda',
    doppione: 'doppione',
    sovrapposta: 'accavallate',
  };
  // Le aperte per prime: sono le uniche su cui si può ancora intervenire adesso.
  // Poi le durate assurde: finché restano, quelle ore falsano i conti.
  const ordine = ['aperta', 'lunga', 'doppione', 'sovrapposta'];
  const righe = r.righe.slice().sort((a, b) =>
    (ordine.indexOf(a.tipo) - ordine.indexOf(b.tipo))
    || String(b.quando).localeCompare(String(a.quando)));

  const sommario = ordine.filter(t => r.perTipo[t])
    .map(t => r.perTipo[t] + ' ' + ETICHETTE[t]).join(' · ');
  // L'elenco può essere lungo (servono TUTTE): scorre dentro il suo riquadro
  // invece di spingere giù le card degli operatori.
  const lista = el('div', {
    style:(state.sospetteAperto ? '' : 'display:none;') + 'margin-top:8px;max-height:300px;overflow-y:auto;' });
  // Aperto/chiuso vive in state: il riquadro si ridisegna da solo ogni minuto
  // e senza questo si richiuderebbe sotto le dita mentre lo si legge.
  const btnVedi = el('button', { class:'btnsm', onclick: () => {
    state.sospetteAperto = !state.sospetteAperto;
    lista.style.display = state.sospetteAperto ? '' : 'none';
    btnVedi.textContent = state.sospetteAperto ? 'Nascondi elenco' : 'Vedi quali';
  } }, state.sospetteAperto ? 'Nascondi elenco' : 'Vedi quali');

  bar.className = 'sospette-bar';
  bar.style.display = '';
  bar.append(
    el('div', { class:'sospette-hd' },
      el('span', {}, '⚠ ' + r.n + (r.n === 1 ? ' timbratura da controllare' : ' timbrature da controllare')),
      el('span', { class:'sub' }, sommario),
      el('span', { style:'flex:1;' }),
      btnVedi,
    ),
    lista);

  // TUTTE, nessun tetto (richiesta Nico): l'elenco esiste per sistemarle una
  // per una, e una troncata a 30 lascerebbe le più vecchie invisibili per
  // sempre. Se diventasse lungo, scorre dentro il suo riquadro.
  righe.forEach(x => {
    lista.append(el('div', {
      class:'sospette-riga',
      style: isAdmin ? 'cursor:pointer;' : '',
      title: isAdmin ? 'Apri la timbratura per correggerla' : '',
      onclick: isAdmin ? () => openSessioneModal(x.sessione, () => {
        renderSospette(); renderTab(state.currentTab);
      }) : undefined,
    },
      el('span', { class:'sospette-tag' }, ETICHETTE[x.tipo] || x.tipo),
      el('span', { style:'width:78px;flex-shrink:0;color:var(--mut);' }, fmtIT(x.quando)),
      el('span', { style:'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' },
        x.testo),
    ));
  });
  if (!isAdmin) {
    lista.append(el('div', { class:'sub', style:'font-size:11px;margin-top:6px;' },
      'Le correzioni le fa un amministratore.'));
  }
}

// ── RIFERIMENTO delle attività extra ───────────────────────────────────────
// Un'attività a monte ore (pulizia, riunione) interessa per il TOTALE del
// periodo: gli spezzoni non hanno legame fra loro. Un lavoro con un OGGETTO
// (riparazione, modifica) esiste solo insieme alla cosa su cui si lavora: lì
// le ore vanno sommate PER riferimento e il lavoro si riprende nei giorni.
// Le due colonne arrivano da migrazioni: finché non ci sono, tutto si comporta
// come prima (stesso schema di utenti.azienda_id).
function attivitaRifAttivo() {
  return (state.attivitaExtra || []).some(a => a && ('richiede_riferimento' in a));
}
function sessioniRifAttivo() {
  return (state.sessioni || []).some(s => s && ('riferimento' in s));
}
// Chiave di confronto fra riferimenti: "Quadro Barilla giugno",
// "quadro barilla  giugno" e " QUADRO BARILLA GIUGNO " sono LA STESSA COSA.
// Senza questo, ribattezzare a mano lo stesso lavoro creerebbe due totali
// separati — ed è l'errore più facile da fare e più difficile da vedere.
function rifChiave(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
// Riferimenti già usati per un'attività, dal più recente. Ritorna la forma
// SCRITTA la prima volta (il battesimo) con le ore totali e l'ultima data.
function rifRecenti(attivitaId, giorni = 45) {
  const limite = Date.now() - giorni * 86400000;
  const per = new Map();
  (state.sessioni || []).forEach(s => {
    if (s.attivita_id !== attivitaId) return;
    const rif = String(s.riferimento || '').trim();
    if (!rif) return;
    const t = new Date(s.inizio).getTime();
    if (!(t >= limite)) return;
    const k = rifChiave(rif);
    if (!per.has(k)) per.set(k, { rif, ore: 0, ultimo: 0, n: 0 });
    const v = per.get(k);
    // Il nome buono è quello del PRIMO uso: il battesimo non lo riscrive una
    // digitazione distratta di tre settimane dopo.
    if (t < (v.primo || Infinity)) { v.primo = t; v.rif = rif; }
    v.ore += ((s.fine ? new Date(s.fine) : new Date()) - new Date(s.inizio)) / 3600000;
    v.n++;
    if (t > v.ultimo) v.ultimo = t;
  });
  return [...per.values()].sort((a, b) => b.ultimo - a.ultimo);
}

// ═══════════════════════════════════════════════════════════
// TIMBRI SU ATTIVITÀ EXTRA — scheda di ricerca (Lavoro)
// L'anagrafica delle attività resta in Gestione: qui si guarda COSA è stato
// fatto. Nasce da un conto: 228 h in dieci settimane, il 6,3% del timbrato,
// e nessun posto dove cercarle. I timbri sono `sessioni_lavoro` con
// attivita_id valorizzato e operazione_id nullo.
// ═══════════════════════════════════════════════════════════

function renderTimbriExtra(root) {
  const isAdmin = state.profile?.ruolo === 'admin';
  const q = (state.txSearch || '').trim().toLowerCase();
  const fAtt = state.txAttivita || '';
  const fUte = state.txUtente || '';
  const fMese = state.txMese || '';
  const soloSenzaNota = !!state.txSenzaNota;

  root.innerHTML = '';
  root.append(el('div', { class:'toolbar' }, el('h2', {}, 'Attività extra')));
  root.append(el('div', { class:'sub', style:'margin:-4px 0 14px;max-width:900px;' },
    'Le ore timbrate fuori dalle commesse: pulizia, manutenzione, riunioni, fermi. '
    + 'Il "cosa" sta nell\'attività scelta al kiosk; la nota aggiunge il dettaglio.'));

  const tutti = (state.sessioni || []).filter(s => s.attivita_id);
  if (!tutti.length) {
    root.append(el('div', { class:'empty' },
      'Nessun timbro su attività extra. Le attività si creano in Gestione → Attività extra.'));
    return;
  }

  const attById = Object.fromEntries((state.attivitaExtra || []).map(a => [a.id, a]));
  const nomeAtt = (id) => (attById[id] && attById[id].nome) || '— attività cancellata —';
  const nomeUte = (id) => (state.utentiById[id] && state.utentiById[id].nome) || '—';
  // Sessione aperta = ore che stanno ancora salendo: si contano fino ad adesso,
  // stessa convenzione del resto dell'app.
  const ore = (s) => ((s.fine ? new Date(s.fine) : new Date()) - new Date(s.inizio)) / 3600000;

  let list = tutti.slice();
  if (fAtt) list = list.filter(s => s.attivita_id === fAtt);
  if (fUte) list = list.filter(s => s.utente_id === fUte);
  if (fMese) list = list.filter(s => toLocalISO(new Date(s.inizio)).startsWith(fMese));
  if (soloSenzaNota) list = list.filter(s => !String(s.note || '').trim());
  if (q) {
    list = list.filter(s =>
      String(s.note || '').toLowerCase().includes(q)
      || String(s.riferimento || '').toLowerCase().includes(q)
      || nomeAtt(s.attivita_id).toLowerCase().includes(q)
      || nomeUte(s.utente_id).toLowerCase().includes(q));
  }
  list.sort((a, b) => String(b.inizio).localeCompare(String(a.inizio)));

  // ── Filtri ──────────────────────────────────────────────────────────
  const mesi = [...new Set(tutti.map(s => toLocalISO(new Date(s.inizio)).slice(0, 7)))].sort().reverse();
  const selAtt = el('select', { style:'max-width:220px;',
    onchange: (e) => { state.txAttivita = e.target.value; renderTab('timbri_extra'); } },
    el('option', { value:'' }, 'Tutte le attività'),
    ...[...new Set(tutti.map(s => s.attivita_id))]
      .sort((a, b) => nomeAtt(a).localeCompare(nomeAtt(b)))
      .map(id => el('option', { value:id }, nomeAtt(id))));
  selAtt.value = fAtt;
  const selUte = el('select', { style:'max-width:200px;',
    onchange: (e) => { state.txUtente = e.target.value; renderTab('timbri_extra'); } },
    el('option', { value:'' }, 'Tutti gli operatori'),
    ...[...new Set(tutti.map(s => s.utente_id))]
      .sort((a, b) => nomeUte(a).localeCompare(nomeUte(b)))
      .map(id => el('option', { value:id }, nomeUte(id))));
  selUte.value = fUte;
  const selMese = el('select', { style:'max-width:150px;',
    onchange: (e) => { state.txMese = e.target.value; renderTab('timbri_extra'); } },
    el('option', { value:'' }, 'Tutti i mesi'),
    ...mesi.map(m => el('option', { value:m },
      MESI_ESTESI[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4))));
  selMese.value = fMese;

  root.append(el('div', { style:'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;' },
    el('input', {
      type:'text', class:'search', id:'tx-search', style:'max-width:300px;',
      placeholder:'Cerca nella nota, nell\'attività, nel nome…',
      value: state.txSearch || '',
      oninput: (e) => { state.txSearch = e.target.value; state._focusSearch = 'tx-search'; renderTab('timbri_extra'); },
    }),
    selAtt, selUte, selMese,
    el('button', {
      class: soloSenzaNota ? 'btnp' : 'btnsm',
      onclick: () => { state.txSenzaNota = !soloSenzaNota; renderTab('timbri_extra'); },
      title:'Ore di cui non resta scritto cosa fossero',
    }, 'Solo senza nota'),
    ...(fAtt || fUte || fMese || q || soloSenzaNota
      ? [el('button', { class:'btnsm', onclick: () => {
          state.txSearch = ''; state.txAttivita = ''; state.txUtente = '';
          state.txMese = ''; state.txSenzaNota = false; renderTab('timbri_extra');
        } }, '✕ Azzera filtri')]
      : []),
  ));

  // ── Totali per attività (su quello che i filtri hanno lasciato) ──────
  const perAtt = new Map();
  list.forEach(s => {
    const k = s.attivita_id;
    if (!perAtt.has(k)) perAtt.set(k, { n:0, h:0, senzaNota:0 });
    const v = perAtt.get(k);
    v.n++; v.h += ore(s);
    if (!String(s.note || '').trim()) v.senzaNota++;
  });
  const oreTot = list.reduce((a, s) => a + ore(s), 0);
  const senzaNotaTot = list.filter(s => !String(s.note || '').trim()).length;
  const box = el('div', { style:'background:var(--sur2);border:1px solid var(--brd);border-radius:6px;padding:12px 14px;margin-bottom:14px;' });
  box.append(
    el('div', { style:'font-weight:700;margin-bottom:4px;' },
      list.length + (list.length === 1 ? ' timbro' : ' timbri') + ' · '
      + oreTot.toFixed(1).replace('.', ',') + ' h'),
    el('div', { class:'sub', style:'margin-bottom:8px;font-size:11px;' },
      senzaNotaTot
        ? '⚠ ' + senzaNotaTot + (senzaNotaTot === 1 ? ' timbro non dice' : ' timbri non dicono')
          + ' cosa sia stato fatto: nessuna nota.'
        : 'Tutti i timbri hanno una nota.'),
  );
  [...perAtt.entries()].sort((a, b) => b[1].h - a[1].h).forEach(([id, v]) => {
    const a = attById[id];
    box.append(el('div', { style:'display:flex;align-items:center;gap:10px;font-size:11px;padding:3px 0;border-bottom:1px solid var(--brd);' },
      el('span', { style:'width:12px;height:12px;border-radius:2px;flex-shrink:0;background:'
        + ((a && a.colore) || '#6b6b64') + ';' }),
      el('span', { style:'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' },
        nomeAtt(id) + (a && a.attivo === false ? ' (disattivata)' : '')),
      el('span', { style:'width:70px;text-align:right;font-family:JetBrains Mono,monospace;' },
        v.h.toFixed(1).replace('.', ',') + ' h'),
      el('span', { style:'width:96px;text-align:right;color:var(--mut);font-family:JetBrains Mono,monospace;' },
        v.n + (v.n === 1 ? ' timbro' : ' timbri')),
      el('span', { style:'width:110px;text-align:right;font-family:JetBrains Mono,monospace;color:'
        + (v.senzaNota ? 'var(--yel)' : 'var(--mut)') + ';' },
        v.senzaNota ? v.senzaNota + ' senza nota' : '—'),
    ));
  });
  root.append(box);

  // ── Totali PER LAVORO ────────────────────────────────────────────────
  // Per un'attività a monte ore il totale del mese basta; per un lavoro con un
  // oggetto (riparazione, modifica) la domanda vera è "quante ore su QUELLA
  // cosa" — e la risposta si legge solo qui. Raggruppa a meno di maiuscole e
  // spazi: due totali per lo stesso lavoro sarebbero un errore invisibile.
  const perRif = new Map();
  list.forEach(s => {
    const rif = String(s.riferimento || '').trim();
    if (!rif) return;
    const k = rifChiave(rif);
    if (!perRif.has(k)) perRif.set(k, { rif, n:0, h:0, ultimo:0, attivita:new Set() });
    const v = perRif.get(k);
    v.n++; v.h += ore(s);
    v.attivita.add(s.attivita_id);
    const t = new Date(s.inizio).getTime();
    if (t > v.ultimo) { v.ultimo = t; }
  });
  if (perRif.size) {
    const bx = el('div', { style:'background:var(--sur2);border:1px solid var(--brd);border-radius:6px;padding:12px 14px;margin-bottom:14px;' });
    bx.append(
      el('div', { style:'font-weight:700;margin-bottom:4px;' }, 'Per lavoro'),
      el('div', { class:'sub', style:'margin-bottom:6px;font-size:11px;' },
        perRif.size + (perRif.size === 1 ? ' lavoro con un riferimento' : ' lavori con un riferimento')
        + ' · ore sommate su tutti i loro spezzoni.'));
    [...perRif.values()].sort((a, b) => b.h - a.h).forEach(v => {
      bx.append(el('div', {
        style:'display:flex;align-items:center;gap:10px;font-size:11px;padding:3px 0;border-bottom:1px solid var(--brd);cursor:pointer;',
        title:'Filtra su questo lavoro',
        onclick: () => { state.txSearch = v.rif; renderTab('timbri_extra'); },
      },
        el('span', { style:'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;' }, v.rif),
        el('span', { style:'width:150px;color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' },
          [...v.attivita].map(nomeAtt).join(', ')),
        el('span', { style:'width:70px;text-align:right;font-family:JetBrains Mono,monospace;' },
          v.h.toFixed(1).replace('.', ',') + ' h'),
        el('span', { style:'width:80px;text-align:right;color:var(--mut);font-family:JetBrains Mono,monospace;' },
          v.n + (v.n === 1 ? ' volta' : ' volte')),
        el('span', { style:'width:80px;text-align:right;color:var(--mut);font-family:JetBrains Mono,monospace;' },
          fmtIT(toLocalISO(new Date(v.ultimo)))),
      ));
    });
    root.append(bx);
  }

  if (!list.length) {
    root.append(el('div', { class:'empty' }, 'Nessun timbro con questi filtri.'));
    return;
  }

  // ── Elenco ──────────────────────────────────────────────────────────
  const tw = el('div', { class:'tw' });
  const tbl = el('table', { class:'rt' });
  tbl.append(el('thead', {}, el('tr', {},
    el('th', {}, 'Giorno'),
    el('th', {}, 'Orario'),
    el('th', { class:'tc' }, 'Durata'),
    el('th', {}, 'Operatore'),
    el('th', {}, 'Attività'),
    ...(sessioniRifAttivo() ? [el('th', {}, 'Lavoro')] : []),
    el('th', {}, 'Nota'),
  )));
  const tb = el('tbody');
  // Tetto alla lista: con 143 righe oggi non serve, ma la tabella cresce da
  // sola e una scheda che si pianta non la sistema nessuno.
  const MAX = 500;
  list.slice(0, MAX).forEach(s => {
    const a = attById[s.attivita_id];
    const ini = new Date(s.inizio);
    const fin = s.fine ? new Date(s.fine) : null;
    const nota = String(s.note || '').trim();
    // La pausa scrive 12:30:00 spaccate: quel timbro non è finito, è stato
    // troncato — e va detto, perché la nota lì manca quasi sempre.
    const daPausa = !!fin && fin.getHours() === PAUSA_PRANZO_ORA
      && fin.getMinutes() === PAUSA_PRANZO_MIN && fin.getSeconds() === 0;
    tb.append(el('tr', {
      style: isAdmin ? 'cursor:pointer;' : '',
      title: isAdmin ? 'Apri per correggere orari o nota' : '',
      onclick: isAdmin ? () => openSessioneModal(s, () => renderTab('timbri_extra')) : undefined,
    },
      el('td', { class:'mono' }, fmtIT(toLocalISO(ini))),
      el('td', { class:'mono' }, fmtT(ini) + ' → ' + (fin ? fmtT(fin) : '● in corso')
        + (daPausa ? ' ⏸' : '')),
      el('td', { class:'tc mono' }, ore(s).toFixed(1).replace('.', ',') + ' h'),
      el('td', {}, nomeUte(s.utente_id)),
      el('td', {},
        el('span', { style:'display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;background:'
          + ((a && a.colore) || '#6b6b64') + ';' }),
        nomeAtt(s.attivita_id)),
      ...(sessioniRifAttivo()
        ? [el('td', { class: String(s.riferimento || '').trim() ? '' : 'sub' },
            String(s.riferimento || '').trim() || '—')]
        : []),
      el('td', { class: nota ? '' : 'sub',
        style: nota ? '' : 'color:var(--yel);' },
        nota || (daPausa ? '— troncato dalla pausa, mai scritto —' : '— nessuna nota —')),
    ));
  });
  tbl.append(tb);
  tw.append(tbl);
  root.append(tw);
  if (list.length > MAX) {
    root.append(el('div', { class:'sub', style:'margin-top:8px;font-size:11px;' },
      'Mostrati i ' + MAX + ' più recenti su ' + list.length + '. Restringi coi filtri per vedere gli altri.'));
  }
}

// ═══════════════════════════════════════════════════════════
// ATTIVITÀ EXTRA — anagrafica delle attività non legate a commesse
// (pulizia officina, riunioni, formazione, manutenzione, ecc.).
// Usate dal kiosk come terza opzione accanto a Mezzi e Commesse.
// Modello dati: timbrature salvate sulla stessa tabella sessioni_lavoro,
// con operazione_id = null e attivita_id valorizzato (vedi migration SQL).
// ═══════════════════════════════════════════════════════════

function renderAttivitaExtra(root) {
  const isAdmin = state.profile?.ruolo === 'admin';
  const list = state.attivitaExtra.slice().sort((a,b) => (a.ordine||0) - (b.ordine||0));

  root.innerHTML = '';
  const toolbar = el('div', { class:'toolbar' },
    el('h2', {}, 'Attività extra'),
  );
  if (isAdmin) {
    toolbar.append(el('button', { class:'btnp', onclick:()=>openAttivitaExtraModal() }, '+ Nuova Attività'));
  }
  root.append(toolbar);
  root.append(el('div', { class:'sub', style:'margin-bottom:14px;' },
    'Attività che gli operatori possono timbrare al kiosk quando non lavorano su una commessa (pulizia officina, riunioni, formazione, manutenzione mezzi, ecc.).'));

  if (list.length === 0) {
    root.append(el('div', { class:'empty' },
      'Nessuna attività ancora. Creane una con "+ Nuova Attività".'));
    return;
  }

  const tw = el('div', { class:'tw' });
  const tbl = el('table', { class:'rt' });
  tbl.append(el('thead', {}, el('tr', {},
    el('th', { class:'tc', style:'width:50px;' }, 'Ord.'),
    el('th', {}, 'Nome'),
    el('th', {}, 'Descrizione'),
    el('th', { class:'tc' }, 'Colore'),
    ...(attivitaRifAttivo() ? [el('th', { class:'tc' }, 'Riferimento')] : []),
    el('th', { class:'tc' }, 'Stato'),
    el('th', { class:'tc' }, 'Azioni'),
  )));
  const tb = el('tbody');
  list.forEach(a => {
    tb.append(el('tr', {},
      el('td', { class:'tc mono' }, String(a.ordine || 0)),
      el('td', {}, a.nome),
      el('td', { class:'sub' }, a.descrizione || '—'),
      el('td', { class:'tc' }, el('span', {
        style: `display:inline-block;width:24px;height:14px;border-radius:2px;background:${a.colore||'#6b6b64'};vertical-align:middle;border:1px solid var(--brd);`,
      })),
      ...(attivitaRifAttivo()
        ? [el('td', { class:'tc' }, a.richiede_riferimento
            ? el('span', { class:'badge bok', title:'Al kiosk chiede su cosa si sta lavorando: senza, il timbro non parte' }, 'obbligatorio')
            : el('span', { class:'sub' }, '—'))]
        : []),
      el('td', { class:'tc' }, a.attivo
        ? el('span', { class:'badge bok' }, 'attiva')
        : el('span', { class:'badge bgry' }, 'disatt.')),
      el('td', { class:'tc' },
        isAdmin
          ? el('span', {},
              el('button', { class:'btnsm', onclick:()=>openAttivitaExtraModal(a) }, 'Modifica'),
              ' ',
              el('button', { class:'btnd', onclick:()=>deleteAttivitaExtra(a) }, 'Elimina'),
            )
          : '—'
      ),
    ));
  });
  tbl.append(tb);
  tw.append(tbl);
  root.append(tw);
}

function openAttivitaExtraModal(a) {
  const isNew = !a;
  const nextOrdine = isNew
    ? (Math.max(0, ...state.attivitaExtra.map(x => x.ordine||0)) + 1)
    : a.ordine;
  a = a || {
    nome:'',
    descrizione:'',
    ordine: nextOrdine,
    colore: TIPI_ASSENZA_COLORI[state.attivitaExtra.length % TIPI_ASSENZA_COLORI.length],
    attivo: true,
  };

  const modal = el('div', { class:'modal' });
  modal.append(el('div', { class:'mhd' },
    el('h2', {}, isNew ? 'Nuova Attività Extra' : 'Modifica Attività Extra'),
    el('button', { class:'mclose', onclick:closeModal }, '✕'),
  ));

  const body = el('div', { class:'mbody' });
  const form = el('form');

  const inNome = el('input', { type:'text', name:'nome', value:a.nome||'', required:'true',
    placeholder:'es. Pulizia officina' });
  const inDesc = el('textarea', { name:'descrizione', rows:'2',
    placeholder:'Descrizione opzionale (visibile al kiosk).' }, a.descrizione || '');
  const inOrdine = el('input', { type:'number', name:'ordine', value:String(a.ordine||0), min:'0' });
  const selAttivo = el('select', { name:'attivo' },
    el('option', { value:'true' }, 'Attiva'),
    el('option', { value:'false' }, 'Disattivata'));
  selAttivo.value = String(!!a.attivo);

  // Riuso la palette di TIPI_ASSENZA_COLORI: stesso pattern, niente duplicazione
  let coloreScelto = a.colore || TIPI_ASSENZA_COLORI[0];
  const palette = el('div', { style:'display:flex;flex-wrap:wrap;gap:6px;padding:6px;background:var(--sur2);border:1px solid var(--brd);border-radius:4px;' });
  const refreshPalette = () => {
    palette.innerHTML = '';
    TIPI_ASSENZA_COLORI.forEach(col => {
      const sel = col === coloreScelto;
      palette.append(el('button', {
        type:'button',
        style: `width:34px;height:28px;border-radius:3px;background:${col};border:2px solid ${sel?'var(--acc)':'transparent'};cursor:pointer;outline:none;`,
        onclick: () => { coloreScelto = col; refreshPalette(); },
      }));
    });
  };
  refreshPalette();

  // Riferimento obbligatorio: è la differenza STRUTTURALE fra le due bestie che
  // vivono qui dentro. Un'attività a monte ore (pulizia, riunione) interessa
  // per il totale del periodo e i suoi spezzoni non hanno legame fra loro; un
  // lavoro con un OGGETTO (riparazione, modifica) esiste solo insieme alla cosa
  // su cui si lavora: le ore vanno sommate PER riferimento, e si riprende.
  const selRif = el('select', { name:'richiede_riferimento' },
    el('option', { value:'false' }, 'No — si somma solo per periodo'),
    el('option', { value:'true' }, 'Sì — al kiosk chiede su cosa (senza, non parte)'));
  selRif.value = String(!!a.richiede_riferimento);
  form.append(
    el('div', { class:'field' }, el('label', {}, 'Nome *'), inNome),
    el('div', { class:'field' }, el('label', {}, 'Descrizione'), inDesc),
    el('div', { class:'frow' },
      el('div', { class:'field' }, el('label', {}, 'Ordine'), inOrdine),
      el('div', { class:'field' }, el('label', {}, 'Stato'), selAttivo),
    ),
    el('div', { class:'field' }, el('label', {}, 'Colore'), palette),
    ...(attivitaRifAttivo()
      ? [el('div', { class:'field' },
          el('label', {}, 'Richiede un riferimento'),
          selRif,
          el('div', { class:'sub', style:'margin-top:4px;font-size:11px;' },
            'Metti sì dove il lavoro ha un oggetto (una riparazione, una modifica): '
            + 'le ore si sommano per riferimento e il lavoro si può riprendere nei giorni. '
            + 'Lascia no dove conta solo il totale (pulizia, riunioni).'))]
      : []),
  );

  body.append(form);
  modal.append(body);

  const foot = el('div', { class:'mfoot' });
  foot.append(el('button', { class:'btng', onclick:closeModal }, 'Chiudi'));
  const btnSave = el('button', { class:'btnp' }, 'Salva');
  btnSave.onclick = async () => {
    const fd = new FormData(form);
    const payload = {
      nome: (fd.get('nome')||'').trim(),
      descrizione: (fd.get('descrizione')||'').trim() || null,
      ordine: parseInt(fd.get('ordine')) || 0,
      colore: coloreScelto,
      attivo: fd.get('attivo') === 'true',
    };
    // Solo a migrazione fatta: mandare una colonna che non esiste farebbe
    // fallire il salvataggio di tutta l'attività.
    if (attivitaRifAttivo()) payload.richiede_riferimento = fd.get('richiede_riferimento') === 'true';
    if (!payload.nome) return toast('Nome obbligatorio', 'err');
    btnSave.disabled = true;
    btnSave.textContent = 'Salvataggio…';
    try {
      const { data, error } = await eseguiConRetry(
        () => isNew
          ? sb.from('attivita_extra').insert(payload).select().single()
          : sb.from('attivita_extra').update(payload).eq('id', a.id).select().single(),
        { label: 'salvataggio attivita_extra' }
      );
      if (error) {
        btnSave.disabled = false;
        btnSave.textContent = 'Salva';
        if (error.code === '23505') return toast('Nome già esistente', 'err');
        return toast(error.message, 'err');
      }
      if (isNew) {
        if (!state.attivitaExtra.find(x => x.id === data.id)) state.attivitaExtra.push(data);
      } else {
        state.attivitaExtra = state.attivitaExtra.map(x => x.id === a.id ? data : x);
      }
      toast(isNew ? 'Attività creata' : 'Attività aggiornata');
      closeModal(); renderTab('attivita_extra');
    } catch (e) {
      btnSave.disabled = false;
      btnSave.textContent = 'Salva';
      toast('Errore: '+(e.message||e), 'err');
    }
  };
  foot.append(btnSave);
  modal.append(foot);
  openModal(modal);
}

async function deleteAttivitaExtra(a) {
  // GUARDIA (7 ago): cancellare un'attività con timbri attaccati NON cancella
  // quei timbri — la FK è ON DELETE SET NULL — ma li lascia senza dire a cosa
  // si riferivano: diventano ore di nessuno, invisibili in ogni conteggio.
  // Successo davvero: 144 sessioni e 238 h scollegate con un clic, e il
  // vecchio avviso lo diceva senza numeri, che è come non dirlo.
  // Con dello storico attaccato la cancellazione non si offre più: si disattiva.
  const usi = (state.sessioni || []).filter(s => s.attivita_id === a.id);
  if (usi.length) {
    const ore = usi.reduce((t, s) =>
      t + ((s.fine ? new Date(s.fine) : new Date()) - new Date(s.inizio)) / 3600000, 0);
    if (a.attivo === false) {
      return toast('Già disattivata. Per cancellarla davvero servirebbe prima spostare le '
        + usi.length + ' timbrature.', 'err');
    }
    const ok = confirm(
      `"${a.nome}" ha ${usi.length} timbrature per ${ore.toFixed(1).replace('.', ',')} h.\n\n`
      + 'Cancellandola quelle ore resterebbero nel database ma senza più dire a cosa '
      + 'si riferivano: diventerebbero ore di nessuno.\n\n'
      + 'OK la DISATTIVA: sparisce dal kiosk e lo storico resta leggibile.');
    if (!ok) return;
    const { data, error } = await eseguiConRetry(
      () => sb.from('attivita_extra').update({ attivo: false }).eq('id', a.id).select().single(),
      { label: 'disattivazione attivita_extra' });
    if (error) return toast(error.message, 'err');
    state.attivitaExtra = state.attivitaExtra.map(x => x.id === a.id ? data : x);
    toast('Attività disattivata: lo storico resta'); renderTab('attivita_extra');
    return;
  }
  if (!confirm(`Eliminare l'attività "${a.nome}"?\nNon ha nessuna timbratura attaccata.`)) return;
  const { data, error } = await sb.from('attivita_extra').delete().eq('id', a.id).select();
  if (error) return toast(error.message, 'err');
  if (!data || !data.length) return toast('Eliminazione bloccata', 'err');
  state.attivitaExtra = state.attivitaExtra.filter(x => x.id !== a.id);
  toast('Attività eliminata'); renderTab('attivita_extra');
}

init();

