/* ═══════════════════════════════════════════════════════════════════
   DOMAIN/CALENDARIO.JS — date, festivi, chiusure, eventi, finestre ferie

   UNA volta per tutte le interfacce (30 set): gestionale, kiosk e telefono
   caricano questo file invece di averne ognuno la sua copia. Il telefono le
   aveva copiate, e le copie si erano gia' allontanate: nomi dei festivi
   diversi, frasi diverse, e il 16 set una tabella letta col nome sbagliato
   che ha messo 40 ore di ferie su giorni di chiusura.

   Le versioni sono quelle del GESTIONALE, che girano sui dati veri da piu'
   tempo. Dal telefono si e' preso solo cio' che era piu' robusto (una data
   vuota scritta '—' invece di NaN) e le regole che il gestionale non aveva
   ancora (festivoDelGiorno, chiusuraDelGiorno, motivoNonLavorativo,
   primoGiornoInseribile).

   Come domain/scheduling.js: niente DOM, niente Supabase. Legge `state`
   (chiusure, eventi, impostazioni, assenze) come risolto a runtime.
   Si carica PRIMA degli altri file di domain: scheduling.js usa
   toLocalISO, parseISODate e isGiornoNonLavorativo.
   ═══════════════════════════════════════════════════════════════════ */

// ─── Formati ───────────────────────────────────────────────────────────
const z = n => String(n).padStart(2,'0');

const toLocalISO = d => `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`;

const parseISODate = s => { const [y,m,d] = String(s).split('-').map(Number); return new Date(y,m-1,d); };

// Una data vuota si scrive '—' (dal telefono, 30 set): prima nel gestionale
// usciva `NaN/NaN/NaN`. Accetta anche un timestamp: conta solo il giorno.
const fmtIT = iso => { if (!iso) return '—'; const d = parseISODate(String(iso).slice(0, 10)); return `${z(d.getDate())}/${z(d.getMonth()+1)}/${d.getFullYear()}`; };

const fmtT = d => `${z(d.getHours())}:${z(d.getMinutes())}`;

// "01-02" e' GG-MM: si scrive 01/02, come tutte le date dell'app. Col trattino
// "dal 01-02 al 28-02" sembra un intervallo di numeri, non due date.
function ggmmIT(s) { return String(s || '').replace('-', '/'); }

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

// Oggi come 'AAAA-MM-GG', ora locale (non UTC).
const todayISO = () => toLocalISO(new Date());

// ─── Festivi nazionali ─────────────────────────────────────────────────
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

// Il nome del festivo nazionale di questo giorno, o null. Stessi nomi di
// `festiviNazionali`: il telefono ne aveva una lista sua, e diceva
// "Liberazione" dove il gestionale diceva "Festa della Liberazione".
function festivoDelGiorno(iso) {
  if (!iso) return null;
  const f = festiviNazionali(parseISODate(iso).getFullYear())
    .find(x => toLocalISO(x.data) === iso);
  return f ? f.nome : null;
}

// ─── Chiusure aziendali e giorni lavorativi ────────────────────────────
// Set di ISO date per le chiusure aziendali (con ricorrenza)
function chiusureIsoSet(annoMin, annoMax) {
  const s = new Set();
  // `|| []`: sul telefono le chiusure arrivano con la sezione Ferie, e il
  // calendario puo' essere interrogato prima.
  (state.chiusure || []).forEach(c => {
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

// La chiusura di questo giorno, o null. Ritorna la RIGA e non un booleano:
// in calendario serve anche la descrizione ("Chiusura Natalizia", "Ponte"),
// e un giorno chiuso senza il perche' si legge come un errore.
// Stessa regola di `chiusureIsoSet` (le ricorrenti valgono ogni anno).
function chiusuraDelGiorno(iso) {
  return (state.chiusure || []).find(c => {
    if (!c.data) return false;
    return c.ricorrente ? c.data.substring(5) === iso.substring(5) : c.data === iso;
  }) || null;
}

// Perche' questo giorno non e' lavorativo, in parole. null = lo e'.
function motivoNonLavorativo(iso) {
  const ch = chiusuraDelGiorno(iso);
  if (ch) return { tipo:'chiusura', testo: ch.descrizione || 'Chiusura aziendale' };
  const fe = festivoDelGiorno(iso);
  if (fe) return { tipo:'festivo', testo: fe };
  const dow = parseISODate(iso).getDay();
  if (dow === 0 || dow === 6) return { tipo:'weekend', testo:'Weekend' };
  return null;
}

// ─── Eventi aziendali ──────────────────────────────────────────────────
// Gli eventi che toccano questo giorno. `data_fine` null = un giorno solo.
// Ordinati: prima quelli di tutto il giorno (senza ora), poi per orario.
function eventiDelGiorno(iso) {
  return (state.eventi || []).filter(e => {
    if (!e || !e.data) return false;
    const fine = e.data_fine || e.data;
    return iso >= e.data && iso <= fine;
  }).sort((a, b) => String(a.ora || '').localeCompare(String(b.ora || ''))
    || String(a.titolo || '').localeCompare(String(b.titolo || '')));
}

// L'evento in una riga di testo: "🍝 12:30 — Pranzo aziendale · Trattoria X".
function eventoEtichetta(e) {
  return (e.ora ? e.ora + ' — ' : '') + (e.titolo || 'Evento');
}

// ─── Assenze: impostazioni, finestre ferie, chi puo inserire ───────────
// Legge un'impostazione globale con fallback. Le impostazioni sono salvate
// come testo nel DB; il secondo argomento è il default usato se la chiave
// non c'è. Se serve un numero, parsalo dal chiamante.
function getImpostazione(chiave, defaultVal) {
  const v = state.impostazioni && state.impostazioni[chiave];
  return (v === undefined || v === null) ? defaultVal : v;
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

// ⚠⚠ SI DICE SEMPRE ANCHE COSA SI PUO' FARE (16 set, segnalato da Nico:
// *"avviso errato nel mobile su ferie estive"*).
// Il difetto: il form si apre sulla data di oggi, e a settembre oggi cade nel
// periodo ESTIVO, che si prenota a febbraio. Quindi la prima cosa che si
// leggeva era un rosso sulle ferie estive **proprio nel mese in cui le ferie
// si prenotano davvero** — perche' a settembre e' aperta la finestra
// INVERNALE. Il messaggio era vero sulla data e sbagliato sulla domanda.
// **Un avviso che dice solo di no, quando un si' esiste, e' un avviso
// sbagliato anche quando la frase e' esatta.**
function finestraApertaOra(oggiIso) {
  return getFinestreAssenze()
    .find(f => isoDentroIntervallo(oggiIso, f.aperturaDa, f.aperturaA)) || null;
}

// La meta' positiva dell'avviso, una frase sola. Sta in una funzione perche'
// la usano quattro punti diversi fra telefono e gestionale, e devono dirla
// con le stesse parole.
function frasePeriodoAperto(oggiIso) {
  const aperta = finestraApertaOra(oggiIso);
  if (aperta) {
    return 'Adesso e aperta la finestra ' + aperta.nome + ': puoi chiedere dal '
      + ggmmIT(aperta.periodoDa) + ' al ' + ggmmIT(aperta.periodoA) + '.';
  }
  const prossime = getFinestreAssenze()
    .map(x => x.nome + ' dal ' + ggmmIT(x.aperturaDa) + ' al ' + ggmmIT(x.aperturaA)).join(' · ');
  return 'Oggi non e aperta nessuna finestra. Si prenota: ' + prossime + '.';
}

// CHI puo inserire un tipo di assenza. Tre risposte, non due (11 set,
// corretto da Nico: "i gruppi esenti possono solo ferie e permessi"):
//   'tutti'   -> chiunque, dentro la finestra        (ferie)
//   'esenti'  -> solo i gruppi esenti                (permessi)
//   'admin'   -> nessun operatore, solo un amministratore  (malattia)
// ⚠ Con due valori sarebbe servito un nome proprio da qualche parte: o il
// codice del permesso nel codice, o gli esenti che vedono TUTTO e quindi
// anche la malattia. Tre valori tengono la regola dentro il dato.
// ⚠ IL VALORE E 'admin' E NON 'ufficio' (11 set, corretto da Nico:
// "hai messo ufficio invece degli admin, dando per scontato che chi fosse
// in ufficio fosse autorizzato"). Aveva ragione: `ufficio` e anche una
// CHIAVE DI GRUPPO (GRUPPI_UTENTI), quindi quel valore si leggeva come "lo
// puo mettere il gruppo Ufficio" — mentre il controllo vero e sul RUOLO.
// Stare in ufficio e essere amministratore sono due cose diverse, e un nome
// che ne confonde due e una trappola che scatta la prima volta che qualcuno
// configura da solo.
function tipoInseribileDa(tipo, esente) {
  const chi = String((tipo && tipo.chi_inserisce) || '').toLowerCase();
  if (chi === 'tutti') return true;
  if (chi === 'esenti') return !!esente;
  return false;
}

// Decide se un utente non-admin può oggi inserire/modificare un'assenza sulla
// data 'iso'. Regola: oggi deve cadere nella finestra di apertura associata
// al periodo a cui appartiene 'iso'. Restituisce { ok, motivo, finestra }.
// UNA funzione per il calendario del gestionale e il telefono (30 set): prima
// erano due copie con frasi diverse per lo stesso rifiuto.
function verificaAccessoAssenza(iso, utente) {
  // ⚠ LE DATE PASSATE NON LE INSERISCE NESSUNO (11 set, corretto da Nico:
  // "le date passate no!"). Il controllo sta PRIMA dell'esenzione, ed e
  // l'ordine a fare la regola: l'esenzione salta la FINESTRA, non il
  // passato. Segnare ferie la settimana scorsa non e una comodita, e un
  // modo di far tornare i conti a posteriori.
  const oggiIso = toLocalISO(new Date());
  if (iso < oggiIso) {
    // La frase del telefono (30 set): la legge un operatore, e "dagli utenti"
    // parla di lui in terza persona.
    return { ok: false, motivo: 'le date passate non sono inseribili' };
  }
  // I gruppi esenti scavalcano solo la finestra di apertura: possono
  // programmare quando vogliono, purche' avanti. Configurabile da
  // Impostazioni → Calendari.
  const esenti = getGruppiEsentiAssenze();
  if (utente?.gruppo && esenti.includes(utente.gruppo)) {
    return { ok: true, esenzione: utente.gruppo };
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
      // ⚠ "finestra estiva", non "periodo estiva": i nomi sono femminili
      // perche' nati per accordarsi a "finestra".
      motivo: `questa data sta nella finestra ${finestra.nome} (${ggmmIT(finestra.periodoDa)} – ${ggmmIT(finestra.periodoA)}), che si prenota dal ${ggmmIT(finestra.aperturaDa)} al ${ggmmIT(finestra.aperturaA)}`,
      finestra,
    };
  }
  return { ok: true, finestra };
}

// Trova un'assenza per utente+data (cache, sync)
function getAssenza(utenteId, iso) {
  return (state.assenze || []).find(a =>
    a.utente_id === utenteId && a.data === iso && a.stato === 'valida'
  );
}

// Il primo giorno che questa persona puo' chiedere: dentro la finestra
// aperta E lavorativo. Si cerca in avanti giorno per giorno invece di
// calcolarlo: i periodi scavallano l'anno (01-10 -> 28-02) e l'aritmetica
// sugli intervalli circolari e' il posto dove si sbaglia. 400 giri di una
// funzione che costa niente, una volta all'apertura del form.
function primoGiornoInseribile(utente) {
  const d = new Date();
  for (let i = 0; i < 400; i++) {
    const iso = toLocalISO(d);
    if (verificaAccessoAssenza(iso, utente).ok && !isGiornoNonLavorativo(d)) return iso;
    d.setDate(d.getDate() + 1);
  }
  return todayISO();
}
