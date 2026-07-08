/* ═══════════════════════════════════════════════════════════════════
   DOMAIN/SCHEDULING.JS — Motore di pianificazione (Cablotec Gestionale)

   Logica PURA di scheduling: niente DOM, niente Supabase. Legge lo stato
   globale (`state`, helper dati) e produce date/ore/percentuali.
   Estratto da index.html; caricato come script classico PRIMA dello
   script principale (scope globale condiviso).

   Contenuto:
   1) Calendario e capacità: giorni lavorativi avanti/indietro,
      capacità giornaliera addetti+fornitori, assenze.
   2) Motore commesse/fasi: ore previste/residue/reali, inizio calcolato
      (opCalcInizio/opInizio), finestre fasi (opFasiWindows), ritardi.
   3) Carico %: distribuzione ore sul periodo, pesi addetti/fornitori,
      carico pianificato per operatore e fornitore.

   Dipendenze rimaste in index (risolte a runtime come globali):
   toLocalISO/parseISODate (formato), giornoNonLavorativo, festiviNazIsoSet,
   chiusureIsoSet, state.*, getOperazioneAddetti, getOperazioneFornitoriDettaglio,
   quantitaConsegnata, orariUtente e affini.
   ═══════════════════════════════════════════════════════════════════ */

// Calcola data inizio: data scadenza - N giorni lavorativi
function indietroGiorniLavorativi(scadenzaIso, giorni) {
  const d = parseISODate(scadenzaIso);
  let rest = giorni;
  while (rest > 0) {
    d.setDate(d.getDate() - 1);
    if (!isGiornoNonLavorativo(d)) rest--;
  }
  return toLocalISO(d);
}

// Conta giorni lavorativi tra due date (incluse)
function contaGiorniLavorativi(daIso, aIso) {
  let count = 0;
  const a = parseISODate(daIso);
  const b = parseISODate(aIso);
  while (a <= b) {
    if (!isGiornoNonLavorativo(a)) count++;
    a.setDate(a.getDate() + 1);
  }
  return count;
}

// ═══════════════════════════════════════════════════════════
// CAPACITY PLANNING — pianificazione che tiene conto delle
// ferie degli addetti assegnati a una commessa
// ═══════════════════════════════════════════════════════════
const ORE_STANDARD_GIORNO = 8;

// Ore di assenza valida di un singolo utente in un dato giorno (ISO)
function oreAssenzaUtenteGiorno(utenteId, iso) {
  let tot = 0;
  state.assenze.forEach(a => {
    if (a.stato === 'valida' && a.utente_id === utenteId && a.data === iso) {
      tot += parseFloat(a.ore) || 0;
    }
  });
  return tot;
}

// Capacità lavorativa (in ore) di una squadra di addetti in un dato giorno.
// Weekend / festivi / chiusure aziendali → 0. Altrimenti: addetti × 8 ore
// meno le ore di assenza di ciascuno (un addetto non scende mai sotto 0).
function capacitaGiorno(dateObj, addettiIds, fornitoriRows) {
  if (isGiornoNonLavorativo(dateObj)) return 0;
  const iso = toLocalISO(dateObj);
  let cap = 0;
  // Contributo addetti interni (capacità - assenze valide)
  addettiIds.forEach(uid => {
    const assenti = oreAssenzaUtenteGiorno(uid, iso);
    cap += Math.max(0, ORE_STANDARD_GIORNO - assenti);
  });
  // Contributo fornitori esterni: 8h × coefficiente × allocazione.
  // fornitoriRows è array di {azienda_id, allocazione} (formato di state.opFornitori
  // o equivalente passato dal modal di creazione). Niente assenze per i fornitori.
  if (fornitoriRows && fornitoriRows.length) {
    fornitoriRows.forEach(r => {
      const az = state.aziende.find(a => a.id === r.azienda_id);
      if (!az || !az.is_fornitore) return;
      const coef = Number(az.coefficiente != null ? az.coefficiente : 1.0);
      const alloc = Number(r.allocazione != null ? r.allocazione : 1.0);
      cap += ORE_STANDARD_GIORNO * coef * alloc;
    });
  }
  return cap;
}

// Data di inizio calcolata a ore: parte dalla scadenza e va indietro
// accumulando la capacità reale di ogni giorno finché copre oreTotali.
// fornitoriRows opzionale: array {azienda_id, allocazione}
function indietroOreCapacita(scadenzaIso, oreTotali, addettiIds, fornitoriRows) {
  const d = parseISODate(scadenzaIso);
  let rest = oreTotali;
  let guard = 0; // salvagente: evita loop infiniti (max ~10 anni)
  while (rest > 0 && guard < 3700) {
    const cap = capacitaGiorno(d, addettiIds, fornitoriRows);
    if (cap > 0) rest -= cap;
    if (rest > 0) d.setDate(d.getDate() - 1);
    guard++;
  }
  return toLocalISO(d);
}

// Versioni "in avanti": speculari alle indietro*. Dato un inizio, restituiscono
// la data di FINE lavoro. Sono inverse esatte: se inizio = indietro…(scadenza, X),
// allora avanti…(inizio, X) = scadenza. Servono al Gantt per dimensionare la
// barra sul VOLUME di lavoro, non sulla finestra inizio→scadenza.
function avantiGiorniLavorativi(inizioIso, giorni) {
  const d = parseISODate(inizioIso);
  let rest = giorni;
  while (rest > 0) {
    d.setDate(d.getDate() + 1);
    if (!isGiornoNonLavorativo(d)) rest--;
  }
  return toLocalISO(d);
}
function avantiOreCapacita(inizioIso, oreTotali, addettiIds, fornitoriRows) {
  const d = parseISODate(inizioIso);
  let rest = oreTotali;
  let guard = 0;
  while (rest > 0 && guard < 3700) {
    const cap = capacitaGiorno(d, addettiIds, fornitoriRows);
    if (cap > 0) rest -= cap;
    if (rest > 0) d.setDate(d.getDate() + 1);
    guard++;
  }
  return toLocalISO(d);
}

/* ───────────────────────────────────────────────────────────────── */

// Calcoli al volo (non in DB)
// ── Helper modello a fasi ──────────────────────────────────────────
// Fasi di una commessa, ordinate. [] se non ne ha (→ comportamento classico).
function opFasiOf(op) {
  if (!op) return [];
  return (state.opFasi || []).filter(f => f.operazione_id === op.id)
    .slice().sort((a, b) => (a.ordine || 0) - (b.ordine || 0));
}
// Fasi "complete" e pianificabili: presenti e ognuna coi minuti/pz > 0
// (interna o terzista che sia). Se manca, si ricade sull'aggregato (budget).
function opFasiComplete(op) {
  const f = opFasiOf(op);
  return f.length > 0 && f.every(x => (Number(x.minuti_unitari) || 0) > 0);
}
// Fasi da usare per la PIANIFICAZIONE: le fasi se complete, altrimenti [] → la
// commessa ricade sul calcolo aggregato (minuti_unitari, il budget). Così "una
// fase coi minuti, le altre a 0" non sotto-schedula: usa il budget pieno.
function opFasiPianif(op) {
  return opFasiComplete(op) ? opFasiOf(op) : [];
}
// Ore "pagate" attribuibili alla parte INTERNA del lavoro (fasi NON date a
// terzisti). Il pagato (minuti_unitari) è dell'intero job e non è spezzato per
// fase, quindi lo ripartisco sulla quota di lavoro pianificato che resta in
// casa. Così nello Storico il confronto cons/pag è interno-contro-interno e
// sparisce il falso "10 contro 100" di chi esternalizza una fase.
function pagatoOreInterne(op) {
  const q = Number(op && op.quantita || 0);
  const pagWhole = (Number(op && op.minuti_unitari || 0)) * q / 60;
  if (pagWhole <= 0) return 0;
  const fasi = opFasiOf(op);
  const fuori = new Set((state.opFornitori || [])
    .filter(r => r.operazione_id === op.id && r.fase_id).map(r => r.fase_id));
  if (fasi.length === 0) {
    // Senza fasi: se la commessa intera è a un terzista, niente interno.
    const tuttaFuori = (state.opFornitori || []).some(r => r.operazione_id === op.id && !r.fase_id);
    return tuttaFuori ? 0 : pagWhole;
  }
  const totMin = fasi.reduce((s, f) => s + (Number(f.minuti_unitari) || 0), 0);
  if (totMin <= 0) return pagWhole; // fasi senza minuti: non so ripartire, tengo l'intero
  const intMin = fasi.filter(f => !fuori.has(f.id))
    .reduce((s, f) => s + (Number(f.minuti_unitari) || 0), 0);
  return pagWhole * (intMin / totMin);
}
// Ore PREVISTE della sola parte INTERNA: esclude le fasi affidate a fornitori
// esterni (fase_id in operazioni_fornitori). I timbri sono solo interni:
// ogni confronto consuntivo-vs-preventivo deve usare QUESTA, non il totale.
// STESSA BASE di opCalcOre: fasi pianificabili (complete). Con fasi assenti o
// incomplete (una a 0 min → si pianifica sul budget) il totale è il budget e
// resta tutto interno, salvo commessa intera a terzista (fase_id null) → 0.
// Altrimenti la differenza budget-vs-somma fasi verrebbe spacciata per
// "esterna" anche senza fornitori.
function opCalcOreInterne(op) {
  if (!op) return 0;
  const q = Number(op.quantita || 0);
  const fasi = opFasiPianif(op);
  if (fasi.length === 0) {
    const tuttaFuori = (state.opFornitori || []).some(r => r.operazione_id === op.id && !r.fase_id);
    return tuttaFuori ? 0 : opCalcOre(op);
  }
  const fuori = new Set((state.opFornitori || [])
    .filter(r => r.operazione_id === op.id && r.fase_id).map(r => r.fase_id));
  const minInt = fasi.filter(f => !fuori.has(f.id))
    .reduce((s, f) => s + (Number(f.minuti_unitari) || 0), 0);
  return (q * minInt) / 60;
}
// Minuti/pezzo "effettivi" per la pianificazione: somma delle fasi se presenti,
// altrimenti il minuti_unitari (tempo pagato). Il pagato resta solo budget.
function opMinutiEffettivi(op) {
  const fasi = opFasiPianif(op);
  if (fasi.length) return fasi.reduce((s, f) => s + (Number(f.minuti_unitari) || 0), 0);
  const budget = Number((op && op.minuti_unitari) || 0);
  if (budget > 0) return budget;
  // Fasi incomplete E budget commessa a 0: meglio una stima parziale (somma dei
  // minuti delle fasi già compilate) che zero, altrimenti la commessa "non
  // pesa" su nessuno nel calcolo del carico.
  return opFasiOf(op).reduce((s, f) => s + (Number(f.minuti_unitari) || 0), 0);
}
// Modalità fasi: PER ORA tutte SEQUENZIALI (parallelo disattivato su richiesta).
// Unico interruttore: vale per nuove, auto-generate ed esistenti, senza
// migrazioni di dati. Per riattivare il parallelo in futuro:
//   return !!op.fasi_sequenziali;
function opSequenziale(op) { return true; }
// Assegnatari di una fase: i suoi addetti/fornitori (per fase_id). Se la fase
// non ne ha di propri, ripiega sugli assegnatari "a tutta la commessa" (fase_id nullo).
function faseAssegnatari(op, faseId) {
  const add = (state.opAddetti || []).filter(r => r.operazione_id === op.id && r.fase_id === faseId).map(r => r.utente_id);
  const forn = (state.opFornitori || []).filter(r => r.operazione_id === op.id && r.fase_id === faseId)
    .map(r => ({ azienda_id: r.azienda_id, allocazione: r.allocazione }));
  if (add.length === 0 && forn.length === 0) {
    const addC = (state.opAddetti || []).filter(r => r.operazione_id === op.id && r.fase_id == null).map(r => r.utente_id);
    const fornC = (state.opFornitori || []).filter(r => r.operazione_id === op.id && r.fase_id == null)
      .map(r => ({ azienda_id: r.azienda_id, allocazione: r.allocazione }));
    return { addetti: addC, fornitori: fornC };
  }
  return { addetti: add, fornitori: forn };
}
// Inizio/fine di una singola fase (a ritroso / in avanti), con fallback 8h/giorno
// se la fase non ha capacità (nessun assegnatario).
function inizioPerFase(scadenzaIso, oreFase, addetti, fornitori) {
  if (oreFase <= 0) return scadenzaIso;
  if (addetti.length > 0 || fornitori.length > 0) return indietroOreCapacita(scadenzaIso, oreFase, addetti, fornitori);
  const giorni = Math.ceil(oreFase / 8);
  return giorni <= 0 ? scadenzaIso : indietroGiorniLavorativi(scadenzaIso, giorni);
}
function finePerFase(inizioIso, oreFase, addetti, fornitori) {
  if (oreFase <= 0) return inizioIso;
  if (addetti.length > 0 || fornitori.length > 0) return avantiOreCapacita(inizioIso, oreFase, addetti, fornitori);
  const giorni = Math.ceil(oreFase / 8);
  return giorni <= 0 ? inizioIso : avantiGiorniLavorativi(inizioIso, giorni);
}

// ── Inizio/fine di UNA fase: durata = minuti/pz × pezzi sulla capacità degli
// assegnatari. Vale anche per il terzista: il fornitore non carica i TUOI
// operatori (capacità separata), ma la durata scala coi pezzi. Senza minuti la
// fase non sposta nulla.
function faseInizio(op, fase, fineIso, pezzi) {
  const minuti = Number(fase.minuti_unitari) || 0;
  if (minuti <= 0) return fineIso;
  const { addetti, fornitori } = faseAssegnatari(op, fase.id);
  return inizioPerFase(fineIso, (pezzi * minuti) / 60, addetti, fornitori);
}
function faseFine(op, fase, inizioIso, pezzi) {
  const minuti = Number(fase.minuti_unitari) || 0;
  if (minuti <= 0) return inizioIso;
  const { addetti, fornitori } = faseAssegnatari(op, fase.id);
  return finePerFase(inizioIso, (pezzi * minuti) / 60, addetti, fornitori);
}

function opCalcOre(op) {
  return ((op.quantita || 0) * opMinutiEffettivi(op)) / 60;
}

// ── Tappa 7: suggerimento minuti/pezzo per fase dallo storico ──────────
// Media storica dei minuti/pezzo per (articolo, tipo lavorazione), dal
// consuntivo: somma delle durate delle sessioni CHIUSE di quel tipo sulle
// commesse di quell'articolo, diviso i pezzi prodotti di quelle commesse.
// Il match è per tipo_lavorazione_id (stabile su tutto lo storico, anche
// pre-fasi). Ritorna { minPz, nSessioni, nCommesse } o null se non c'è storico.

// Finestra della media: contano solo le ultime N commesse chiuse per
// (articolo, tipo). 5 = assorbe una commessa storta senza restare ancorata
// al passato; ritoccare qui se serve più reattività (3) o stabilità (10).
const MEDIA_ULTIME_COMMESSE = 5;
function storicoMinutiPz(articoloId, tipoLavId) {
  if (!articoloId || !tipoLavId) return null;
  const opIds = new Set((state.operazioni || [])
    .filter(o => o.articolo_id === articoloId).map(o => o.id));
  if (opIds.size === 0) return null;
  // Raggruppo i secondi delle sessioni CHIUSE per commessa.
  const secPerOp = {}, nSessPerOp = {};
  (state.sessioni || []).forEach(s => {
    if (!s.fine || s.tipo_lavorazione_id !== tipoLavId || !opIds.has(s.operazione_id)) return;
    secPerOp[s.operazione_id] = (secPerOp[s.operazione_id] || 0) + (Number(s.durata_secondi) || 0);
    nSessPerOp[s.operazione_id] = (nSessPerOp[s.operazione_id] || 0) + 1;
  });
  // Una commessa entra nello storico se è 'spedita' O 'completata': le ORE
  // si consolidano alla chiusura del lavoro (completata), la spedizione è
  // logistica e non cambia più i timbri. Le commesse ancora in lavorazione
  // restano fuori (dati parziali).
  // FINESTRA: contano solo le ULTIME N chiuse (le più recenti per data di
  // consegna/scadenza). Quando una lavorazione migliora, i tempi vecchi
  // escono dalla media da soli — niente da cancellare.
  const candidate = [];
  Object.keys(secPerOp).forEach(id => {
    const op = (state.operazioni || []).find(o => o.id === id);
    if (!op || (op.stato !== 'spedita' && op.stato !== 'completata')) return;
    const prod = quantitaConsegnata(id);
    const pz = prod > 0 ? prod : Number(op.quantita || 0);
    if (pz <= 0) return;
    candidate.push({ sec: secPerOp[id], pz, nSess: nSessPerOp[id],
      data: op.consegnato_il || op.scadenza || '' });
  });
  candidate.sort((a, b) => String(b.data).localeCompare(String(a.data)));
  const finestra = candidate.slice(0, MEDIA_ULTIME_COMMESSE);
  let totSec = 0, pezzi = 0, nSessioni = 0;
  finestra.forEach(c => { totSec += c.sec; pezzi += c.pz; nSessioni += c.nSess; });
  if (totSec <= 0 || pezzi <= 0) return null;
  return { minPz: (totSec / 60) / pezzi, nSessioni, nCommesse: finestra.length };
}

// ── Fasi EFFETTIVE di un articolo (per le commesse nuove) ──────────────
// La media storica (spedite+completate) è il valore VIVO: si allarga o si
// restringe da sola a ogni commessa chiusa, niente da ricopiare a mano in
// anagrafica. Il template resta il valore di partenza per i tipi senza
// storico. Ordine: quello del template; i tipi solo-storico in coda
// (ordine dei tipi di lavorazione).
// Ritorna [{ tipo_lavorazione_id, minuti_unitari, fonte:'storico'|'template', nCommesse }]
function fasiEffettiveArticolo(articoloId) {
  const art = (state.articoli || []).find(a => a.id === articoloId);
  if (!art) return [];
  const out = [];
  const visti = new Set();
  const tmpl = (Array.isArray(art.fasi) ? art.fasi.slice() : [])
    .sort((a, b) => (a.ordine || 0) - (b.ordine || 0));
  tmpl.forEach(f => {
    if (!f.tipo_lavorazione_id || visti.has(f.tipo_lavorazione_id)) return;
    visti.add(f.tipo_lavorazione_id);
    const st = storicoMinutiPz(articoloId, f.tipo_lavorazione_id);
    if (st && st.minPz > 0) {
      out.push({ tipo_lavorazione_id: f.tipo_lavorazione_id,
        minuti_unitari: Math.round(st.minPz * 10) / 10, fonte: 'storico', nCommesse: st.nCommesse });
    } else {
      out.push({ tipo_lavorazione_id: f.tipo_lavorazione_id,
        minuti_unitari: Number(f.minuti_unitari) || 0, fonte: 'template', nCommesse: 0 });
    }
  });
  (state.tipiLav || [])
    .filter(t => t.attivo !== false)
    .sort((a, b) => (a.ordine || 0) - (b.ordine || 0))
    .forEach(t => {
      if (visti.has(t.id)) return;
      const st = storicoMinutiPz(articoloId, t.id);
      if (st && st.minPz > 0) {
        visti.add(t.id);
        out.push({ tipo_lavorazione_id: t.id,
          minuti_unitari: Math.round(st.minPz * 10) / 10, fonte: 'storico', nCommesse: st.nCommesse });
      }
    });
  return out;
}

// ── SCHEMA RIUSABILE: dato-storia di entità + render timeline ───────────────
// Pensati per traslocare in core.js tali e quali: leggono solo `state`, niente
// dipendenze dal contesto chiamante.

// DATO sorgente dietro la media storica di una fase. Replica ESATTA della
// logica di storicoMinutiPz (media pesata = secondi totali / pezzi totali sulle
// sole spedite+completate) ma restituisce anche il dettaglio per-commessa, così il
// drill-down quadra col numero mostrato. È questa la funzione-dato che domani
// riusano cliente/fornitore/operatore.
function datiStoricoFase(articoloId, tipoLavId) {
  if (!articoloId || !tipoLavId) return null;
  const opIds = new Set((state.operazioni || [])
    .filter(o => o.articolo_id === articoloId).map(o => o.id));
  if (opIds.size === 0) return null;
  const secPerOp = {}, nSessPerOp = {};
  (state.sessioni || []).forEach(s => {
    if (!s.fine || s.tipo_lavorazione_id !== tipoLavId || !opIds.has(s.operazione_id)) return;
    secPerOp[s.operazione_id] = (secPerOp[s.operazione_id] || 0) + (Number(s.durata_secondi) || 0);
    nSessPerOp[s.operazione_id] = (nSessPerOp[s.operazione_id] || 0) + 1;
  });
  let righe = [];
  Object.keys(secPerOp).forEach(id => {
    const op = (state.operazioni || []).find(o => o.id === id);
    if (!op || (op.stato !== 'spedita' && op.stato !== 'completata')) return;
    const prod = quantitaConsegnata(id);
    const pz = prod > 0 ? prod : Number(op.quantita || 0);
    if (pz <= 0) return;
    const sec = secPerOp[id];
    righe.push({
      opId: id,
      label: op.numero_ordine || op.numero_op || op.riferimento_cliente || ('#' + String(id).slice(0, 6)),
      data: op.consegnato_il || op.scadenza || null,
      pezzi: pz, sec, minPz: (sec / 60) / pz, nSess: nSessPerOp[id],
    });
  });
  // Stessa FINESTRA di storicoMinutiPz: solo le ultime N chiuse. Il
  // drill-down mostra esattamente le commesse che compongono il numero.
  righe.sort((x, y) => String(y.data || '').localeCompare(String(x.data || '')));
  righe = righe.slice(0, MEDIA_ULTIME_COMMESSE);
  let totSec = 0, pezzi = 0, nSessioni = 0;
  righe.forEach(r => { totSec += r.sec; pezzi += r.pezzi; nSessioni += r.nSess; });
  if (totSec <= 0 || pezzi <= 0) return null;
  return { righe, minPz: (totSec / 60) / pezzi, nSessioni, nCommesse: righe.length, pezzi, debole: righe.length <= 1 };
}

// COMPONENTE riusabile: header aggregato cliccabile che espande/comprime un
// elenco di righe sorgente. Generico: riceve testo già pronto, non sa cosa
// rappresentano le righe. opts: { sommario, righe:[{titolo,meta,valore}],
//   debole?, apertaDiDefault?, vuoto? }
function entityTimeline(opts = {}) {
  const righe = opts.righe || [];
  let aperta = !!opts.apertaDiDefault;
  const det = el('div', { class:'etl-det', style: aperta ? '' : 'display:none;' });
  const caret = el('span', { class:'etl-caret' }, aperta ? '▾' : '▸');
  const head = el('button', {
    type:'button', class:'etl-head' + (opts.debole ? ' debole' : ''),
    onclick: () => { aperta = !aperta; det.style.display = aperta ? '' : 'none'; caret.textContent = aperta ? '▾' : '▸'; },
  },
    caret,
    el('span', { class:'etl-sommario' }, opts.sommario || ''),
    opts.debole ? el('span', { class:'etl-debole' }, '⚠ debole') : null,
  );
  if (righe.length === 0) {
    det.append(el('div', { class:'etl-vuoto' }, opts.vuoto || 'Nessun dato.'));
  } else {
    righe.forEach(r => det.append(el('div', { class:'etl-riga' },
      el('div', { class:'etl-riga-main' },
        el('span', { class:'etl-titolo' }, r.titolo || ''),
        r.meta ? el('span', { class:'etl-meta' }, r.meta) : null),
      (r.valore != null) ? el('span', { class:'etl-valore' }, r.valore) : null,
    )));
  }
  return el('div', { class:'etl' }, head, det);
}

// Ore di lavoro RESIDUO: pezzi ancora da produrre × minuti_unitari.
// Usata dove serve "quanto lavoro c'è davanti" (carico, calcolo inizio):
// se ho già prodotto parte dell'ordine (lotti in `consegne_commessa`),
// quel lavoro è fatto.
// NON usare per confronti preventivo/consuntivo nel modal — lì serve il
// totale ordinato (vedi opCalcOre). Mai negativa.
function opCalcOreResidue(op) {
  if (!op) return 0;
  const qtaOrd = Number(op.quantita || 0);
  const qtaConsegnata = (typeof quantitaConsegnata === 'function')
    ? quantitaConsegnata(op.id) : 0;
  const residua = Math.max(0, qtaOrd - qtaConsegnata);
  return (residua * opMinutiEffettivi(op)) / 60;
}

// Calcola ore reali consuntivate (somma sessioni chiuse + sessioni aperte stimate)
function opCalcOreReali(op) {
  let totSec = 0;
  state.sessioni.forEach(s => {
    if (s.operazione_id !== op.id) return;
    if (s.fine) {
      totSec += (s.durata_secondi || 0);
    } else {
      // Sessione aperta: calcola fino ad ora
      totSec += Math.max(0, Math.floor((Date.now() - new Date(s.inizio).getTime()) / 1000));
    }
  });
  return totSec / 3600;
}

// Tolleranza di sforo (in ore), criterio UNICO per tutto il sistema.
// È il MAGGIORE tra un minimo assoluto (assorbe il rumore delle timbrature:
// secondi, micro-scarti — costante a prescindere dalla dimensione) e una
// percentuale del budget (dà respiro proporzionale alle commesse grandi).
// Un consuntivo è "sforo" solo se supera il budget di più di questo.
const TOLL_MIN_ORE = 0.05;   // ~3 minuti
const TOLL_PERC    = 0.02;   // 2% del budget
function tolleranzaOre(base) {
  return Math.max(TOLL_MIN_ORE, (Number(base) || 0) * TOLL_PERC);
}
// ── Ore di una SINGOLA fase ────────────────────────────────────────────
// Preventivo: quantità × minuti unitari della fase.
function faseCalcOre(op, fase) {
  return ((op.quantita || 0) * (Number(fase?.minuti_unitari) || 0)) / 60;
}
// Consuntivo: sessioni della commessa attribuibili alla fase. Match per
// fase_id quando presente (sessioni nuove); ripiego sul tipo di lavorazione
// per le sessioni storiche registrate prima dell'introduzione di fase_id.
function faseSessioneMatch(s, fase) {
  if (!fase) return false;
  if (s.fase_id) return s.fase_id === fase.id;
  return s.tipo_lavorazione_id === fase.tipo_lavorazione_id;
}
function faseCalcOreReali(op, fase) {
  let totSec = 0;
  state.sessioni.forEach(s => {
    if (s.operazione_id !== op.id || !faseSessioneMatch(s, fase)) return;
    if (s.fine) totSec += (s.durata_secondi || 0);
    else totSec += Math.max(0, Math.floor((Date.now() - new Date(s.inizio).getTime()) / 1000));
  });
  return totSec / 3600;
}
function opCalcInizio(op, addettiOverride, fornitoriOverride, pezziOverride) {
  if (!op.scadenza) return null;

  // ── Calcolo PER FASE ──────────────────────────────────────────────
  // Solo se la commessa ha fasi e NON stiamo usando override (gli override
  // servono all'anteprima di una commessa non ancora salvata, dove
  // l'assegnazione per fase non è ancora su DB: lì resta il calcolo aggregato).
  const fasi = opFasiPianif(op);
  if (fasi.length && !addettiOverride && !fornitoriOverride) {
    const pezzi = (pezziOverride != null) ? pezziOverride
      : (op.inizio_manuale
        ? Number(op.quantita || 0)
        : Math.max(0, Number(op.quantita || 0) - ((typeof quantitaConsegnata === 'function') ? quantitaConsegnata(op.id) : 0)));
    if (pezzi <= 0) return op.scadenza;

    if (opSequenziale(op)) {
      // Catena a ritroso: l'ultima fase finisce alla scadenza, il suo inizio
      // diventa la "scadenza" della fase precedente, e così via.
      let cursore = op.scadenza;
      for (let i = fasi.length - 1; i >= 0; i--) {
        cursore = faseInizio(op, fasi[i], cursore, pezzi);
      }
      return cursore;
    }
    // Parallelo: ogni fase a ritroso dalla scadenza; inizio = il più vecchio.
    let minInizio = op.scadenza;
    fasi.forEach(f => {
      const ore = (pezzi * (Number(f.minuti_unitari) || 0)) / 60;
      const { addetti, fornitori } = faseAssegnatari(op, f.id);
      const ini = inizioPerFase(op.scadenza, ore, addetti, fornitori);
      if (ini < minInizio) minInizio = ini;
    });
    return minInizio;
  }

  // ── Calcolo AGGREGATO (nessuna fase, oppure anteprima con override) ──
  // Se l'admin ha bloccato manualmente l'inizio, calcoliamo sulle ore TOTALI;
  // altrimenti sulle ore RESIDUE (tiene conto del lavoro già prodotto).
  const ore = (pezziOverride != null) ? (pezziOverride * opMinutiEffettivi(op)) / 60
    : (op.inizio_manuale ? opCalcOre(op) : opCalcOreResidue(op));
  if (ore <= 0) return op.scadenza;

  let addetti = addettiOverride;
  if (!addetti) {
    addetti = (typeof getOperazioneAddetti === 'function') ? getOperazioneAddetti(op.id) : [];
  }
  let fornitori = fornitoriOverride;
  if (!fornitori) {
    fornitori = (typeof getOperazioneFornitoriDettaglio === 'function') ? getOperazioneFornitoriDettaglio(op.id) : [];
  }
  if (fornitori.length && typeof fornitori[0] === 'string') {
    fornitori = fornitori.map(id => ({ azienda_id: id, allocazione: 1.0 }));
  }
  if (addetti.length > 0 || fornitori.length > 0) {
    return indietroOreCapacita(op.scadenza, ore, addetti, fornitori);
  }
  const giorni = Math.ceil(ore / 8);
  if (giorni <= 0) return op.scadenza;
  return indietroGiorniLavorativi(op.scadenza, giorni);
}

// Data di inizio EFFETTIVA di una commessa:
// se è stata impostata una data manuale, vale quella; altrimenti il calcolo.
// È questa la funzione da usare ovunque serva "quando inizia davvero".
function opInizio(op) {
  if (op && op.inizio_manuale) return op.inizio_manuale;
  return opCalcInizio(op);
}

// Data di FINE lavoro a partire da un inizio dato. Speculare a opCalcInizio:
// usa lo stesso volume di ore (totali se inizio manuale, residue se automatico)
// e la stessa capacità (addetti/fornitori, con fallback a giorni da 8h). Serve
// al Gantt per disegnare la barra lunga quanto il LAVORO, ancorata all'inizio,
// invece di stiracchiarla fino alla scadenza (che con inizio manuale è arbitraria).
function opFineLavoro(op, inizioIso) {
  if (!op || !inizioIso) return (op && op.scadenza) || inizioIso;

  const fasi = opFasiPianif(op);
  if (fasi.length) {
    const pezzi = op.inizio_manuale
      ? Number(op.quantita || 0)
      : Math.max(0, Number(op.quantita || 0) - ((typeof quantitaConsegnata === 'function') ? quantitaConsegnata(op.id) : 0));
    if (pezzi <= 0) return inizioIso;

    if (opSequenziale(op)) {
      // Catena in avanti: ogni fase parte dove finisce la precedente.
      let cursore = inizioIso;
      fasi.forEach(f => {
        cursore = faseFine(op, f, cursore, pezzi);
      });
      return cursore;
    }
    // Parallelo: la fine è quella della fase più lunga partendo dall'inizio.
    let maxFine = inizioIso;
    fasi.forEach(f => {
      const ore = (pezzi * (Number(f.minuti_unitari) || 0)) / 60;
      const { addetti, fornitori } = faseAssegnatari(op, f.id);
      const fine = finePerFase(inizioIso, ore, addetti, fornitori);
      if (fine > maxFine) maxFine = fine;
    });
    return maxFine;
  }

  // ── aggregato (nessuna fase) ──
  const ore = op.inizio_manuale ? opCalcOre(op) : opCalcOreResidue(op);
  if (ore <= 0) return inizioIso;
  let addetti = (typeof getOperazioneAddetti === 'function') ? getOperazioneAddetti(op.id) : [];
  let fornitori = (typeof getOperazioneFornitoriDettaglio === 'function')
    ? getOperazioneFornitoriDettaglio(op.id) : [];
  if (fornitori.length && typeof fornitori[0] === 'string') {
    fornitori = fornitori.map(id => ({ azienda_id: id, allocazione: 1.0 }));
  }
  if (addetti.length > 0 || fornitori.length > 0) {
    return avantiOreCapacita(inizioIso, ore, addetti, fornitori);
  }
  const giorni = Math.ceil(ore / 8);
  if (giorni <= 0) return inizioIso;
  return avantiGiorniLavorativi(inizioIso, giorni);
}

// Finestre temporali di ogni fase di una commessa: { faseId: {inizio, fine,
// ordine, tipo_lavorazione_id} }. Usa la stessa logica del motore: sequenziale
// = catena a ritroso dalla scadenza; parallelo = ogni fase a ritroso per sé.
// Serve al Gantt per posizionare la barra di ciascun addetto sulla SUA fase.
function opFasiWindows(op, pezziOverride) {
  const fasi = opFasiPianif(op);
  if (!fasi.length || !op.scadenza) return {};
  const pezzi = (pezziOverride != null) ? pezziOverride
    : (op.inizio_manuale
      ? Number(op.quantita || 0)
      : Math.max(0, Number(op.quantita || 0) - ((typeof quantitaConsegnata === 'function') ? quantitaConsegnata(op.id) : 0)));
  const out = {};
  if (opSequenziale(op)) {
    let cursore = op.scadenza;
    for (let i = fasi.length - 1; i >= 0; i--) {
      const f = fasi[i];
      const inizio = faseInizio(op, f, cursore, pezzi);
      out[f.id] = { inizio, fine: cursore, ordine: f.ordine, tipo_lavorazione_id: f.tipo_lavorazione_id };
      cursore = inizio;
    }
  } else {
    fasi.forEach(f => {
      const ore = (pezzi * (Number(f.minuti_unitari) || 0)) / 60;
      const { addetti, fornitori } = faseAssegnatari(op, f.id);
      const inizio = inizioPerFase(op.scadenza, ore, addetti, fornitori);
      out[f.id] = { inizio, fine: op.scadenza, ordine: f.ordine, tipo_lavorazione_id: f.tipo_lavorazione_id };
    });
  }
  return out;
}
function opIsRitardo(op) {
  if (op.stato === 'spedita' || op.stato === 'completata') return false;
  if (!op.scadenza) return false;
  const oggi = toLocalISO(new Date());
  return op.scadenza < oggi;
}

/* ───────────────────────────────────────────────────────────────── */

// Distribuisce le ore di un addetto sui giorni lavorativi di [inizio, scadenza].
function distribuisciOreOperazione(inizioIso, scadenzaIso, oreAddetto) {
  const giorniLav = [];
  const d = parseISODate(inizioIso);
  const fine = parseISODate(scadenzaIso);
  let guard = 0;
  while (d <= fine && guard < 1500) {
    if (!isGiornoNonLavorativo(d)) giorniLav.push(toLocalISO(d));
    d.setDate(d.getDate() + 1);
    guard++;
  }
  const mappa = {};
  if (giorniLav.length === 0) return mappa;
  const orePerGiorno = oreAddetto / giorniLav.length;
  giorniLav.forEach(iso => { mappa[iso] = orePerGiorno; });
  return mappa;
}

// ────────────────────────────────────────────────────────────
// CARICO UTENTE NEL RANGE (helper riutilizzabile)
// ────────────────────────────────────────────────────────────
// Calcola il carico % di un utente in una finestra temporale.
// Modello: ore residue distribuite sui giorni lavorativi, divise per il
// numero di addetti. Coerente con opCalcInizio e indietroOreCapacita.
//
// Returns: { oreCarico, oreCapacita, perc, livello }
//   livello: 'libero' | 'normale' | 'pieno' | 'sovraccarico'
// Calcola i pesi di ripartizione di una commessa tra addetti e fornitori.
// Modello: ogni entità riceve quota proporzionale al proprio peso di capacità.
//   - Addetto interno → peso 1.0 (capacità piena)
//   - Fornitore → peso (coefficiente × allocazione)
// Ritorna: { totale, addetti: Map<utente_id, peso>, fornitori: Map<azienda_id, peso> }
// Usato sia da calcolaCaricoUtenteRange sia da calcolaCaricoFornitoreRange,
// così la ripartizione è SEMPRE coerente: l'aggiunta di un fornitore alleggerisce
// gli addetti, e viceversa.
function pesiEntitaCommessa(opId) {
  const addetti = getOperazioneAddetti(opId);
  const fornitoriRows = getOperazioneFornitoriDettaglio(opId);
  const pesiAdd = new Map();
  const pesiFor = new Map();
  let totale = 0;
  addetti.forEach(uid => {
    pesiAdd.set(uid, 1.0);
    totale += 1.0;
  });
  const azViste = new Set();
  fornitoriRows.forEach(r => {
    if (azViste.has(r.azienda_id)) return; // un fornitore pesa 1 volta, anche se su più fasi
    azViste.add(r.azienda_id);
    const az = state.aziende.find(a => a.id === r.azienda_id);
    if (!az) return;
    const coef = Number(az.coefficiente != null ? az.coefficiente : 1.0);
    const alloc = Number(r.allocazione != null ? r.allocazione : 1.0);
    const peso = coef * alloc;
    pesiFor.set(r.azienda_id, peso);
    totale += peso;
  });
  return { totale, addetti: pesiAdd, fornitori: pesiFor };
}

//   perc: 0..N (può superare 1 in caso di sovraccarico)
function calcolaCaricoUtenteRange(uid, isoStart, isoEnd) {
  // Capacità: giorni lavorativi nel range × 8h
  let giorniLav = 0;
  const d = parseISODate(isoStart);
  const fine = parseISODate(isoEnd);
  let guard = 0;
  while (d <= fine && guard < 1500) {
    if (!isGiornoNonLavorativo(d)) giorniLav++;
    d.setDate(d.getDate() + 1);
    guard++;
  }
  const oreCapacita = giorniLav * 8;

  // Sottrai le ore di assenze valide nel range (ferie, permessi, malattia…)
  let oreAssenze = 0;
  state.assenze.forEach(a => {
    if (a.utente_id !== uid) return;
    if (a.stato !== 'valida') return;
    if (a.data < isoStart || a.data > isoEnd) return;
    oreAssenze += Number(a.ore) || 0;
  });
  const capacitaNetta = Math.max(0, oreCapacita - oreAssenze);

  // Carico: ore residue ripartite tra addetti+fornitori proporzionalmente
  // ai loro pesi. Un addetto su una commessa con anche fornitori vede ridurre
  // la sua quota (perché i fornitori coprono parte del lavoro).
  let oreCarico = 0;
  state.operazioni
    // OCCUPAZIONE PIANIFICATA: tutte le commesse con scadenza la cui finestra
    // cade nel periodo, a prescindere dallo stato. Conta le ore PREVISTE intere
    // (quantità piena), non il residuo: così completare un lavoro non svuota il
    // periodo in cui è stato fatto. La selezione la fa la sovrapposizione
    // finestra-periodo più sotto.
    .filter(o => o.scadenza)
    .forEach(o => {
      // Ramo per-fase SOLO se le fasi sono complete (pianificabili): se anche
      // una fase è a minuti 0, opFasiWindows tornerebbe vuoto → useremmo
      // l'aggregato (qui fasi = [] → si va sull'else col budget).
      const fasi = opFasiPianif(o);
      const mieRighe = (state.opAddetti || []).filter(r => r.operazione_id === o.id && r.utente_id === uid);
      if (!mieRighe.length) return;
      const pezzi = Number(o.quantita || 0); // pieni, non residui (occupazione pianificata)
      // Fasi specifiche dell'utente (fase_id valido e ancora esistente)
      const mieFasi = fasi.length ? mieRighe.map(r => r.fase_id).filter(fid => fid && fasi.some(f => f.id === fid)) : [];

      if (fasi.length && mieFasi.length) {
        // ── Carico PER FASE: solo le ore delle fasi dell'utente, sulla loro finestra ──
        if (pezzi <= 0) return;
        const windows = opFasiWindows(o, pezzi);
        const visti = new Set();
        mieFasi.forEach(fid => {
          if (visti.has(fid)) return;
          visti.add(fid);
          const f = fasi.find(x => x.id === fid);
          const w = windows[fid];
          if (!f || !w) return;
          const oreFase = (pezzi * (Number(f.minuti_unitari) || 0)) / 60;
          if (oreFase <= 0) return;
          // Peso della fase: addetti (1 cad.) + fornitori (coef × allocazione)
          const { addetti, fornitori } = faseAssegnatari(o, fid);
          let totFase = addetti.length * 1.0;
          fornitori.forEach(fr => {
            const az = state.aziende.find(a => a.id === fr.azienda_id);
            const coef = az ? Number(az.coefficiente != null ? az.coefficiente : 1.0) : 1.0;
            totFase += coef * Number(fr.allocazione != null ? fr.allocazione : 1.0);
          });
          if (totFase <= 0) return;
          const quota = oreFase * (1.0 / totFase);
          const distrib = distribuisciOreOperazione(w.inizio, w.fine, quota);
          Object.keys(distrib).forEach(iso => {
            if (iso >= isoStart && iso <= isoEnd) oreCarico += distrib[iso];
          });
        });
      } else {
        // ── Aggregato (nessuna fase, o assegnato a livello commessa) ──
        const pesi = pesiEntitaCommessa(o.id);
        const pesoUtente = pesi.addetti.get(uid);
        if (!pesoUtente || pesi.totale <= 0) return;
        const oreTot = opCalcOre(o); // ore PREVISTE intere (non residue)
        if (oreTot <= 0) return;
        const inizio = o.inizio_manuale || opCalcInizio(o, null, null, pezzi); // finestra pianificata
        if (!inizio) return;
        if (o.scadenza < isoStart || inizio > isoEnd) return;
        const orePerAddetto = oreTot * (pesoUtente / pesi.totale);
        const distrib = distribuisciOreOperazione(inizio, o.scadenza, orePerAddetto);
        Object.keys(distrib).forEach(iso => {
          if (iso >= isoStart && iso <= isoEnd) oreCarico += distrib[iso];
        });
      }
    });

  const perc = capacitaNetta > 0 ? (oreCarico / capacitaNetta) : 0;
  let livello;
  if (perc < 0.60) livello = 'libero';
  else if (perc < 0.95) livello = 'normale';
  else if (perc < 1.10) livello = 'pieno';
  else livello = 'sovraccarico';

  return { oreCarico, oreCapacita: capacitaNetta, perc, livello };
}

// Calcola il carico % di un'azienda fornitrice in una finestra temporale.
// Capacità: giorni lavorativi × 8h × coefficiente. Niente assenze (le aziende
// non hanno ferie nel modello).
// Carico: usa la stessa ripartizione per pesi di calcolaCaricoUtenteRange,
// garantendo coerenza (somma quote = ore_totali residue).
function calcolaCaricoFornitoreRange(aziendaId, isoStart, isoEnd) {
  const az = state.aziende.find(a => a.id === aziendaId);
  const coef = Number((az && az.coefficiente != null) ? az.coefficiente : 1.0);

  // Capacità: giorni lavorativi nel range × 8h × coefficiente
  let giorniLav = 0;
  const d = parseISODate(isoStart);
  const fine = parseISODate(isoEnd);
  let guard = 0;
  while (d <= fine && guard < 1500) {
    if (!isGiornoNonLavorativo(d)) giorniLav++;
    d.setDate(d.getDate() + 1);
    guard++;
  }
  const oreCapacita = giorniLav * 8 * coef;

  // Carico: occupazione PIANIFICATA — ore previste intere ripartite per peso,
  // tutte le commesse la cui finestra cade nel periodo (qualsiasi stato).
  let oreCarico = 0;
  state.operazioni
    .filter(o => o.scadenza)
    .forEach(o => {
      const pesi = pesiEntitaCommessa(o.id);
      const pesoFornitore = pesi.fornitori.get(aziendaId);
      if (!pesoFornitore || pesi.totale <= 0) return;
      const oreTot = opCalcOre(o); // ore PREVISTE intere (non residue)
      if (oreTot <= 0) return;
      const inizio = o.inizio_manuale || opCalcInizio(o, null, null, Number(o.quantita || 0)); // finestra pianificata
      if (!inizio) return;
      if (o.scadenza < isoStart || inizio > isoEnd) return;
      const orePerFornitore = oreTot * (pesoFornitore / pesi.totale);
      const distrib = distribuisciOreOperazione(inizio, o.scadenza, orePerFornitore);
      Object.keys(distrib).forEach(iso => {
        if (iso >= isoStart && iso <= isoEnd) {
          oreCarico += distrib[iso];
        }
      });
    });

  const perc = oreCapacita > 0 ? (oreCarico / oreCapacita) : 0;
  let livello;
  if (perc < 0.60) livello = 'libero';
  else if (perc < 0.95) livello = 'normale';
  else if (perc < 1.10) livello = 'pieno';
  else livello = 'sovraccarico';

  return { oreCarico, oreCapacita, perc, livello, coefficiente: coef };
}


// ════════════════════════════════════════════════════════════
// QUOTE PER-OPERATORE (Gantt): la SUA parte, non l'intera fase
// ════════════════════════════════════════════════════════════
// Ore di UN addetto su una fase: ore intere della fase divise per il peso
// totale degli assegnatari (addetti = 1, fornitori = coefficiente × allocazione).
// Stessa ripartizione di calcolaCaricoUtenteRange: barre e carico% coerenti.
function faseQuotaOreAddetto(op, fase) {
  const pezzi = Number(op && op.quantita || 0);
  const oreFase = (pezzi * (Number(fase && fase.minuti_unitari) || 0)) / 60;
  if (oreFase <= 0) return 0;
  const { addetti, fornitori } = faseAssegnatari(op, fase.id);
  let tot = addetti.length * 1.0;
  fornitori.forEach(fr => {
    const az = state.aziende.find(a => a.id === fr.azienda_id);
    const coef = az ? Number(az.coefficiente != null ? az.coefficiente : 1.0) : 1.0;
    tot += coef * Number(fr.allocazione != null ? fr.allocazione : 1.0);
  });
  return tot > 0 ? oreFase / tot : oreFase;
}
// Quota dell'utente sulle ore INTERE della commessa (modello aggregato,
// per chi è assegnato "a tutta la commessa").
function opQuotaOreUtente(op, uid) {
  const pesi = pesiEntitaCommessa(op.id);
  const peso = pesi.addetti.get(uid);
  if (!peso || pesi.totale <= 0) return opCalcOre(op);
  return opCalcOre(op) * (peso / pesi.totale);
}
// Consuntivo dei SOLI timbri dell'utente sulla commessa / sulla fase.
function opCalcOreRealiUtente(op, uid) {
  let sec = 0;
  state.sessioni.forEach(s => {
    if (s.operazione_id !== op.id || s.utente_id !== uid) return;
    sec += s.fine ? (s.durata_secondi || 0)
      : Math.max(0, Math.floor((Date.now() - new Date(s.inizio).getTime()) / 1000));
  });
  return sec / 3600;
}
function faseCalcOreRealiUtente(op, fase, uid) {
  let sec = 0;
  state.sessioni.forEach(s => {
    if (s.operazione_id !== op.id || s.utente_id !== uid || !faseSessioneMatch(s, fase)) return;
    sec += s.fine ? (s.durata_secondi || 0)
      : Math.max(0, Math.floor((Date.now() - new Date(s.inizio).getTime()) / 1000));
  });
  return sec / 3600;
}
// ════════════════════════════════════════════════════════════
// LIVELLAMENTO RISORSE (v1) — fila del lavoro residuo per operatore
// ════════════════════════════════════════════════════════════
// Mette in fila il lavoro RESIDUO di un operatore in avanti da oggi, senza
// sovrapposizioni. SOLO VISTA: nessuna data scritta su DB, si ricalcola a
// ogni render. Ordine fila: priorità manuale (numero basso = prima, chi non
// ce l'ha va in coda), scadenza a pareggio; dentro la stessa commessa le
// fasi restano nel loro ordine. Una fase alla volta, senza spezzarla.
// Capacità: 8h/giorno lavorativo meno le assenze valide dell'operatore.
// Esclude dipendenze incrociate tra operatori (v1): la fase di Tizio non
// aspetta che Caio finisca la precedente.
//
// Ritorna una mappa: chiave 'opId' (assegnazione a tutta la commessa)
// oppure 'opId|faseId' (assegnazione per fase) →
//   { inizio, fine, ore, scadenza, sfora, giorniSforo }
function livellaOperatore(uid, oggiIso) {
  const oggi = oggiIso || toLocalISO(new Date());

  // ── 1. Raccogli il lavoro residuo dell'operatore ──
  const items = [];
  (state.operazioni || []).forEach(o => {
    if (!o.scadenza) return;
    if (o.stato === 'spedita' || o.stato === 'completata') return;
    const mieRighe = (state.opAddetti || []).filter(r => r.operazione_id === o.id && r.utente_id === uid);
    if (!mieRighe.length) return;
    const pezzi = Math.max(0, Number(o.quantita || 0)
      - ((typeof quantitaConsegnata === 'function') ? quantitaConsegnata(o.id) : 0));
    if (pezzi <= 0) return;

    const fasi = opFasiPianif(o);
    const mieFasi = fasi.length
      ? mieRighe.map(r => r.fase_id).filter(fid => fid && fasi.some(f => f.id === fid))
      : [];

    if (fasi.length && mieFasi.length) {
      // Per fase: quota dell'operatore = ore fase / peso totale degli
      // assegnatari (stessa ripartizione di calcolaCaricoUtenteRange).
      const visti = new Set();
      mieFasi.forEach(fid => {
        if (visti.has(fid)) return;
        visti.add(fid);
        const f = fasi.find(x => x.id === fid);
        const oreFase = (pezzi * (Number(f.minuti_unitari) || 0)) / 60;
        if (oreFase <= 0) return;
        const { addetti, fornitori } = faseAssegnatari(o, fid);
        let totFase = addetti.length * 1.0;
        fornitori.forEach(fr => {
          const az = state.aziende.find(a => a.id === fr.azienda_id);
          const coef = az ? Number(az.coefficiente != null ? az.coefficiente : 1.0) : 1.0;
          totFase += coef * Number(fr.allocazione != null ? fr.allocazione : 1.0);
        });
        items.push({ op: o, faseId: fid, ordineFase: Number(f.ordine) || 0,
          ore: totFase > 0 ? oreFase / totFase : oreFase });
      });
    } else {
      // Aggregato (nessuna fase, o assegnato a tutta la commessa)
      const pesi = pesiEntitaCommessa(o.id);
      const pesoUtente = pesi.addetti.get(uid);
      if (!pesoUtente || pesi.totale <= 0) return;
      const ore = opCalcOreResidue(o) * (pesoUtente / pesi.totale);
      if (ore <= 0) return;
      items.push({ op: o, faseId: null, ordineFase: 0, ore });
    }
  });

  // ── 2. Ordina la fila ──
  items.sort((x, y) => {
    if (x.op.id === y.op.id) return x.ordineFase - y.ordineFase;
    const pa = x.op.priorita, pb = y.op.priorita;
    const aHas = pa != null && pa !== '';
    const bHas = pb != null && pb !== '';
    if (aHas && bHas && Number(pa) !== Number(pb)) return Number(pa) - Number(pb);
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    const sa = x.op.scadenza || '9999', sb = y.op.scadenza || '9999';
    if (sa !== sb) return sa < sb ? -1 : 1;
    return x.ordineFase - y.ordineFase;
  });

  // ── 3. Accoda consumando la capacità giorno per giorno ──
  const capGiorno = (dObj) => {
    if (isGiornoNonLavorativo(dObj)) return 0;
    return Math.max(0, ORE_STANDARD_GIORNO - oreAssenzaUtenteGiorno(uid, toLocalISO(dObj)));
  };
  const out = {};
  const d = parseISODate(oggi);
  let guard = 0; // salvagente globale: max ~10 anni di calendario
  let capResidua = capGiorno(d);
  items.forEach(it => {
    let rest = it.ore;
    while (capResidua <= 1e-9 && guard < 3700) {
      d.setDate(d.getDate() + 1); capResidua = capGiorno(d); guard++;
    }
    const inizio = toLocalISO(d);
    while (rest > capResidua + 1e-9 && guard < 3700) {
      rest -= capResidua;
      do { d.setDate(d.getDate() + 1); capResidua = capGiorno(d); guard++; }
      while (capResidua <= 1e-9 && guard < 3700);
    }
    capResidua -= rest;
    const fine = toLocalISO(d);
    const sfora = fine > it.op.scadenza;
    let giorniSforo = 0;
    if (sfora) {
      const ds = parseISODate(it.op.scadenza);
      ds.setDate(ds.getDate() + 1);
      giorniSforo = contaGiorniLavorativi(toLocalISO(ds), fine);
    }
    out[it.op.id + (it.faseId ? '|' + it.faseId : '')] = {
      inizio, fine, ore: it.ore, scadenza: it.op.scadenza, sfora, giorniSforo,
    };
  });
  return out;
}

// ── Data REALISTICA per una commessa NUOVA (promessa onesta al cliente) ──
// Modello IN AVANTI: gli addetti scelti si liberano quando finisce la loro
// coda attuale (livellaOperatore, che rispetta ferie/chiusure/priorità);
// la commessa nuova parte dal più tardo dei "liberi" e le sue fasi corrono
// in catena sulla capacità della squadra scelta (assenze comprese).
// I fornitori aggiungono capacità e non hanno coda interna.
// fasiNuove: [{minuti_unitari}] · Ritorna { inizio, fine, oreTot, liberi } o null.
function stimaFineCommessaNuova(addettiIds, fornitoriRows, fasiNuove, pezzi, oggiIso) {
  const oggi = oggiIso || toLocalISO(new Date());
  const oreTot = (Number(pezzi) || 0)
    * (fasiNuove || []).reduce((s, f) => s + (Number(f.minuti_unitari) || 0), 0) / 60;
  if (oreTot <= 0) return null;
  if ((!addettiIds || !addettiIds.length) && (!fornitoriRows || !fornitoriRows.length)) return null;
  // Quando si libera ciascun addetto scelto (fine della sua coda attuale)
  const liberi = (addettiIds || []).map(uid => {
    const coda = livellaOperatore(uid, oggi);
    let libero = oggi;
    Object.values(coda).forEach(w => { if (w.fine > libero) libero = w.fine; });
    return { uid, libero };
  });
  // V1: squadra unita, fasi in catena → si parte quando è libero l'ULTIMO
  // (il giorno lavorativo successivo alla fine della sua coda).
  let inizio = oggi;
  liberi.forEach(l => { if (l.libero > inizio) inizio = l.libero; });
  if (inizio > oggi) inizio = avantiGiorniLavorativi(inizio, 1);
  const fine = avantiOreCapacita(inizio, oreTot, addettiIds || [], fornitoriRows || []);
  return { inizio, fine, oreTot, liberi };
}
