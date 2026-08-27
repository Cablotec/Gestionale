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

// ── ANALISI CLIENTI: reale/pagato e ripartizione fasi (commesse CHIUSE) ──
// Per ogni cliente, sulle commesse spedite/completate con almeno 1h timbrata:
//  - rapporto ore reali / ore pagate: quanto sfora il prezzo, sistematicamente
//    (×1,45 = quel cliente costa il 45% più di quanto paga)
//  - €/ora incassati: ricavo ÷ ore timbrate, SOLO sulle commesse con prezzo
//    (stesso sottoinsieme sopra e sotto la frazione, altrimenti il numero
//    si sgonfia con le ore delle commesse senza prezzo)
//  - quota % media di ogni tipo di lavorazione, con deviazione standard
//    (deviazione alta = lavori troppo diversi, la media non predice)
// Tutto live dai timbri: nessun dato materializzato.
function analisiClienti() {
  const perOp = {};
  (state.operazioni || []).forEach(o => {
    if (o.stato !== 'spedita' && o.stato !== 'completata') return;
    perOp[o.id] = { cliente: o.cliente_id, perTipo: {}, tot: 0,
      pagatoOre: (Number(o.minuti_unitari) || 0) * (Number(o.quantita) || 0) / 60,
      ricavo: (Number(o.prezzo_unitario) || 0) * (Number(o.quantita) || 0) };
  });
  (state.sessioni || []).forEach(s => {
    const c = perOp[s.operazione_id];
    if (!c || !s.fine || !s.tipo_lavorazione_id) return;
    const h = (Number(s.durata_secondi) || 0) / 3600;
    c.perTipo[s.tipo_lavorazione_id] = (c.perTipo[s.tipo_lavorazione_id] || 0) + h;
    c.tot += h;
  });
  const perCliente = {};
  Object.values(perOp).forEach(c => {
    if (c.tot < 1) return; // sotto l'ora timbrata: rumore, fuori
    if (!perCliente[c.cliente]) {
      perCliente[c.cliente] = { quote: [], ratio: [], oreReali: 0, orePagate: 0,
        ricavo: 0, oreConPrezzo: 0, nConPrezzo: 0 };
    }
    const g = perCliente[c.cliente];
    const q = {};
    Object.entries(c.perTipo).forEach(([t, h]) => { q[t] = h / c.tot; });
    g.quote.push(q);
    g.oreReali += c.tot;
    if (c.pagatoOre > 0) { g.ratio.push(c.tot / c.pagatoOre); g.orePagate += c.pagatoOre; }
    if (c.ricavo > 0) { g.ricavo += c.ricavo; g.oreConPrezzo += c.tot; g.nConPrezzo += 1; }
  });
  const media = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const out = [];
  Object.entries(perCliente).forEach(([cid, g]) => {
    const tuttiTipi = [...new Set(g.quote.flatMap(q => Object.keys(q)))];
    const tipi = tuttiTipi.map(t => {
      const vals = g.quote.map(q => q[t] || 0);
      const m = media(vals);
      const dev = Math.sqrt(vals.reduce((s, x) => s + (x - m) ** 2, 0) / vals.length);
      return { tipoId: t, media: m, dev };
    }).filter(r => r.media >= 0.03).sort((a, b) => b.media - a.media);
    out.push({
      clienteId: cid,
      nCommesse: g.quote.length,
      ratio: g.ratio.length ? media(g.ratio) : null,
      oreReali: g.oreReali,
      orePagate: g.orePagate,
      euroOra: g.oreConPrezzo > 0 ? g.ricavo / g.oreConPrezzo : null,
      ricavo: g.ricavo,
      nConPrezzo: g.nConPrezzo,
      tipi,
    });
  });
  out.sort((a, b) => b.nCommesse - a.nCommesse);
  return out;
}

// ── ACCORPAMENTO COMMESSE: spalmatura di un timbro sul gruppo ──────────
// Le commesse con lo stesso `gruppo_id` sono viste come UNA al kiosk. Alla
// chiusura del timbro il tempo lavorato si divide tra le N commesse del gruppo
// IN PROPORZIONE al loro peso (quantità × minuti/pz = lavoro previsto), così
// una commessa da 7 pezzi assorbe più tempo di una da 2. Pesi uguali (o
// mancanti) → parti uguali. Crea N sessioni vere sfalsate nel tempo, non
// sovrapposte, che sommano ESATTAMENTE al totale.
// membri: [{ operazione_id, peso }] — il primo è la commessa già timbrata.
// Ritorna [{ operazione_id, inizio, fine, secondi }] — [0].inizio === inizioIso.
// durata_secondi la ricalcola il DB (colonna generata = fine - inizio).
function ripartisciTimbroGruppo(inizioIso, fineIso, membri) {
  const t0 = new Date(inizioIso).getTime();
  const t1 = new Date(fineIso).getTime();
  const totSec = Math.max(0, Math.round((t1 - t0) / 1000));
  const N = Math.max(1, membri.length);
  let pesi = membri.map(m => Math.max(0, Number(m.peso) || 0));
  let totPeso = pesi.reduce((s, p) => s + p, 0);
  if (totPeso <= 0) { pesi = membri.map(() => 1); totPeso = N; } // fallback ÷uguali
  // Ripartizione intera esatta col metodo del resto più grande.
  const quote = pesi.map(p => (totSec * p) / totPeso);
  const secondi = quote.map(q => Math.floor(q));
  const residuo = totSec - secondi.reduce((s, x) => s + x, 0);
  const ordineResti = quote.map((q, i) => ({ i, r: q - Math.floor(q) }))
    .sort((a, b) => b.r - a.r);
  for (let k = 0; k < residuo; k++) secondi[ordineResti[k % N].i] += 1;
  const out = [];
  let cursor = t0;
  membri.forEach((m, i) => {
    const start = cursor;
    const end = cursor + secondi[i] * 1000;
    out.push({
      operazione_id: m.operazione_id,
      inizio: new Date(start).toISOString(),
      fine: new Date(end).toISOString(),
      secondi: secondi[i],
    });
    cursor = end;
  });
  return out;
}
// Commesse che formano il gruppo lavorabile di una commessa: tutte quelle con
// lo stesso gruppo_id ancora aperte (spedite/completate escluse), col PESO =
// quantità × minuti/pz effettivi. La timbrata è sempre in testa (mappa alla
// sessione già aperta). Ritorna [{ operazione_id, peso }].
function commesseGruppoLavorabili(op) {
  if (!op) return [];
  const peso = (o) => (Number(o.quantita) || 0) * opMinutiEffettivi(o);
  if (!op.gruppo_id) return [{ operazione_id: op.id, peso: peso(op) }];
  const membri = (state.operazioni || [])
    .filter(o => o.gruppo_id === op.gruppo_id
      && o.stato !== 'spedita' && o.stato !== 'completata');
  const altri = membri.filter(o => o.id !== op.id);
  return [op, ...altri].map(o => ({ operazione_id: o.id, peso: peso(o) }));
}

// ── LISTINO VIVO: ultimo prezzo per (articolo, cliente) ────────────────
// Il "listino" non è una tabella: è derivato dai prezzi degli ordini passati.
// Pre-compila il prezzo di una riga nuova con l'ULTIMO usato (non la media:
// i prezzi si negoziano). Chiave articolo+cliente; se quel cliente non ha
// storico su quel codice, ripiega sull'ultimo prezzo con chiunque.
// Asse temporale: created_at dell'ordine (non la scadenza). Ritorna
// { prezzo, clienteId, data, proprioCliente } o null.
function prezzoListino(articoloId, clienteId) {
  if (!articoloId) return null;
  const conPrezzo = (state.operazioni || [])
    .filter(o => o.articolo_id === articoloId && Number(o.prezzo_unitario) > 0);
  if (!conPrezzo.length) return null;
  const piuRecente = (arr) => arr.slice().sort((a, b) =>
    String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
  const stessoCli = clienteId ? conPrezzo.filter(o => o.cliente_id === clienteId) : [];
  const scelta = stessoCli.length ? piuRecente(stessoCli) : piuRecente(conPrezzo);
  return {
    prezzo: Number(scelta.prezzo_unitario),
    clienteId: scelta.cliente_id,
    data: scelta.created_at || scelta.scadenza || null,
    proprioCliente: stessoCli.length > 0,
  };
}
// Storico prezzi di un articolo: tutte le righe con prezzo, per il drill-down
// e l'andamento. Ordinate dal più recente. Ritorna [{ prezzo, clienteId,
// data, numero_ordine, quantita }].
function storicoPrezziArticolo(articoloId) {
  if (!articoloId) return [];
  return (state.operazioni || [])
    .filter(o => o.articolo_id === articoloId && Number(o.prezzo_unitario) > 0)
    .map(o => ({ prezzo: Number(o.prezzo_unitario), clienteId: o.cliente_id,
      data: o.created_at || o.scadenza || null, numero_ordine: o.numero_ordine,
      quantita: Number(o.quantita) || 0 }))
    .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
}

// ── PREZZO consigliato dal TEMPO EFFETTIVO (consuntivo) ────────────────────
// Verso opposto alla regola tariffa cliente: lì il prezzo genera il tempo
// pagato, qui il tempo DAVVERO timbrato genera il prezzo da chiedere.
// Base = somma dei min/pz delle sole fasi con fonte 'storico' (il template è
// una stima, non un consuntivo: entra nel conteggio degli esclusi, mai nel
// numero). Stessa finestra del motore (ultime MEDIA_ULTIME_COMMESSE chiuse).
// nCommesse = il MINIMO tra le fasi: la fase col campione più magro decide
// quanto ci si può fidare. `debole` = una sola commessa alle spalle.
// Derivato e non vincolante: propone, non scrive mai (come tutto il resto).
// Ritorna { prezzo, minPz, ore, tariffa, nCommesse, debole, fasiConsuntivo,
//   fasiTotali, fasiSenzaStorico } o null.
function prezzoDaTempoEffettivo(articoloId, clienteId) {
  if (!articoloId || !clienteId) return null;
  const cli = (state.aziende || []).find(a => a.id === clienteId);
  const tariffa = Number(cli && cli.tariffa_cliente) || 0;
  if (!(tariffa > 0)) return null;
  const fasi = (typeof fasiEffettiveArticolo === 'function')
    ? fasiEffettiveArticolo(articoloId) : [];
  const cons = fasi.filter(f => f.fonte === 'storico' && Number(f.minuti_unitari) > 0);
  if (!cons.length) return null;
  let minPz = 0, nMin = Infinity;
  cons.forEach(f => {
    minPz += Number(f.minuti_unitari);
    nMin = Math.min(nMin, Number(f.nCommesse) || 0);
  });
  if (!(minPz > 0)) return null;
  return {
    prezzo: Math.round(minPz / 60 * tariffa * 100) / 100,
    minPz: Math.round(minPz * 10) / 10,
    ore: minPz / 60,
    tariffa,
    nCommesse: nMin === Infinity ? 0 : nMin,
    debole: nMin <= 1,
    fasiConsuntivo: cons.length,
    fasiTotali: fasi.length,
    fasiSenzaStorico: fasi.length - cons.length,
  };
}

// ── ORE ESTERNE a CONSUNTIVO di una commessa ───────────────────────────────
// Un posto solo per guardare il lavoro esterno già fatto, con DUE fonti che
// non si confondono mai (28 lug, decisione Nico):
//   ⏱ 'timbro'      → ore degli ESTERNI IN SEDE (utenti.esterno con azienda_id)
//                     ricavate dai timbri chiusi. DERIVATE, mai copiate:
//                     tariffa presa live da aziende.tariffa_oraria.
//   📄 'dichiarata'  → righe di `ore_esterne` inserite a mano da rapportino,
//                     per il lavoro fatto NELLA sede del fornitore, che qui
//                     nessuno può timbrare. Tariffa CONGELATA sulla riga: un
//                     costo già sostenuto è un fatto e non si riscrive quando
//                     l'anagrafica cambia (stesso principio di prezzo_unitario).
// NB: questo è CONSUNTIVO. La stima "prezzo suggerito" sulla riga fornitore è
// un PREVENTIVO e vive altrove: le due non vanno sommate.
// Le due fonti sono fisicamente disgiunte (lavoro fatto QUI vs DA LORO), ma il
// doppio conteggio è l'errore che si nasconderebbe meglio → le ditte presenti
// in ENTRAMBE le fonti finiscono in `conflitti`, da dichiarare in UI.
// Ritorna { righe, oreTot, costoTot, senzaTariffa, conflitti }.
function oreEsterneCommessa(operazioneId) {
  const vuoto = { righe: [], oreTot: 0, costoTot: 0, senzaTariffa: [], conflitti: [] };
  if (!operazioneId) return vuoto;
  const nomeAz = (id) => ((state.aziende || []).find(a => a.id === id) || {}).nome || 'Ditta sconosciuta';
  const tariffaAz = (id) => Number(((state.aziende || []).find(a => a.id === id) || {}).tariffa_oraria) || 0;
  const righe = [];

  // 1) TIMBRATE: sessioni chiuse di utenti esterni con una ditta dichiarata.
  //    Senza azienda_id non si sa a chi attribuirle → restano fuori (l'utente
  //    va completato in anagrafica, non indovinato qui).
  const perDitta = new Map();
  (state.sessioni || []).forEach(s => {
    if (s.operazione_id !== operazioneId) return;
    const u = (state.utenti || []).find(x => x.id === s.utente_id);
    if (!u || !u.esterno || !u.azienda_id) return;
    // Le sessioni APERTE contano fino a ora, come in opCalcOreReali: se le
    // escludessimo, "Ore consuntivate" (che le conta) attribuirebbe le ore di
    // un esterno ancora al lavoro alla quota INTERNA, per differenza.
    let sec;
    if (s.fine) sec = Number(s.durata_secondi) || 0;
    else {
      // `inizio` mancante o illeggibile: 0, non NaN. Un dato sporco non deve
      // propagare NaN nelle ore e far sparire un intero totale.
      const t = new Date(s.inizio).getTime();
      sec = Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 1000)) : 0;
    }
    if (!(sec > 0)) return;
    const cur = perDitta.get(u.azienda_id) || { sec: 0, nSess: 0, nAperte: 0 };
    cur.sec += sec; cur.nSess += 1; if (!s.fine) cur.nAperte += 1;
    perDitta.set(u.azienda_id, cur);
  });
  perDitta.forEach((v, aziendaId) => {
    const ore = v.sec / 3600;
    const tariffa = tariffaAz(aziendaId);
    righe.push({
      fonte: 'timbro', aziendaId, azienda: nomeAz(aziendaId),
      ore: Math.round(ore * 100) / 100, tariffa,
      costo: tariffa > 0 ? Math.round(ore * tariffa * 100) / 100 : null,
      nSessioni: v.nSess, nAperte: v.nAperte,
      faseId: null, data: null, riferimento: null, note: null, id: null,
    });
  });

  // 2) DICHIARATE: righe di ore_esterne (tariffa congelata; se la riga non ce
  //    l'ha si ripiega sull'anagrafica, dichiarandolo con tariffaDaAnagrafica).
  (state.oreEsterne || []).forEach(r => {
    if (r.operazione_id !== operazioneId) return;
    const ore = Number(r.ore) || 0;
    if (ore <= 0) return;
    const congelata = Number(r.tariffa) || 0;
    const tariffa = congelata > 0 ? congelata : tariffaAz(r.azienda_id);
    righe.push({
      fonte: 'dichiarata', aziendaId: r.azienda_id, azienda: nomeAz(r.azienda_id),
      ore: Math.round(ore * 100) / 100, tariffa,
      costo: tariffa > 0 ? Math.round(ore * tariffa * 100) / 100 : null,
      tariffaDaAnagrafica: !(congelata > 0),
      nSessioni: 0, faseId: r.fase_id || null, data: r.data || null,
      riferimento: r.riferimento || null, note: r.note || null, id: r.id,
    });
  });

  righe.sort((a, b) => (a.azienda || '').localeCompare(b.azienda || '')
    || (a.fonte === b.fonte ? 0 : (a.fonte === 'timbro' ? -1 : 1)));

  let oreTot = 0, costoTot = 0;
  const senzaTariffa = new Set();
  righe.forEach(r => {
    oreTot += r.ore;
    if (r.costo != null) costoTot += r.costo; else senzaTariffa.add(r.azienda);
  });
  // Ditte presenti in entrambe le fonti: possibile doppio conteggio.
  const conTimbro = new Set(righe.filter(r => r.fonte === 'timbro').map(r => r.aziendaId));
  const conDich = new Set(righe.filter(r => r.fonte === 'dichiarata').map(r => r.aziendaId));
  const conflitti = [...conTimbro].filter(id => conDich.has(id)).map(nomeAz);

  return {
    righe,
    oreTot: Math.round(oreTot * 100) / 100,
    costoTot: Math.round(costoTot * 100) / 100,
    senzaTariffa: [...senzaTariffa],
    conflitti,
  };
}

// ── FASI ORFANE di una commessa ────────────────────────────────────────────
// Una fase va tolta solo se non porta via NIENTE con sé:
//   1. non è (più) fra le fasi effettive dell'articolo — quindi non è lavoro
//      previsto che deve ancora partire, è un residuo;
//   2. non ha ore timbrate — nessun consuntivo da perdere;
//   3. non ha addetti assegnati — nessuna pianificazione da perdere.
// Le tre condizioni INSIEME. Una fase prevista e non ancora iniziata ha 0 ore
// e 0 addetti pure lei, ma è lavoro da fare: toglierla sarebbe un danno.
// Nascono così: al kiosk qualcuno timbra un tipo fuori piano → la fase viene
// creata al volo; poi il timbro si corregge o si cancella e resta il guscio,
// perché il salvataggio per progetto non cancella mai una fase.
// Ritorna l'elenco delle righe di operazioni_fasi rimovibili.
function fasiOrfaneCommessa(op) {
  if (!op) return [];
  const previste = new Set(((typeof fasiEffettiveArticolo === 'function' && op.articolo_id)
    ? fasiEffettiveArticolo(op.articolo_id) : []).map(e => e.tipo_lavorazione_id));
  return (state.opFasi || []).filter(f => {
    if (f.operazione_id !== op.id) return false;
    if (previste.has(f.tipo_lavorazione_id)) return false;
    const haOre = (state.sessioni || []).some(s => s.operazione_id === op.id
      && (s.fase_id === f.id
          || (!s.fase_id && s.tipo_lavorazione_id === f.tipo_lavorazione_id)));
    if (haOre) return false;
    const haAddetti = (state.opAddetti || []).some(a => a.operazione_id === op.id && a.fase_id === f.id);
    return !haAddetti;
  });
}

// ── MATERIALE MANCANTE (fabbisogno importato) ──────────────────────────────
// I mancanti arrivano da un'estrazione esterna ("Fabbisogno Massivo") e sono
// una FOTOGRAFIA: ogni import sostituisce il precedente. L'aggancio alla
// commessa è il numero OP scritto (`numero_op`), non un collegamento rigido:
// così le righe di OdL che nel gestionale non esistono (ancora) restano
// registrate e si agganciano DA SOLE quando la commessa nasce, senza
// reimportare. Coerente col resto: si tiene il dato, si deriva il legame.
// Converte l'OdL dell'estrazione nel formato del gestionale: 2026OP1727 →
// 2026/OP/01727. Ritorna null se il formato non è riconoscibile.
// Accetta TUTTE le forme in cui un OP si scrive nella vita reale, non solo
// quella canonica: 2026OP1727 (come lo stampa l'ERP e come sta sui documenti),
// 2026/OP/1727, 2026/OP/01727, 2026 OP 754, 2026-op-754. Ritorna sempre la
// forma canonica 2026/OP/01727, o null se non è riconoscibile.
// Serve in tre punti: import fabbisogno, inserimento ordini, ricerca al kiosk.
// Prima ognuno aveva la sua regola e la griglia buttava via in silenzio tutto
// ciò che non era già canonico.
function odlANumeroOp(odl) {
  const m = String(odl == null ? '' : odl).trim().toUpperCase()
    .match(/^(\d{4})\s*[\/\-\s]?\s*OP\s*[\/\-\s]?\s*(\d+)$/);
  return m ? m[1] + '/OP/' + m[2].padStart(5, '0') : null;
}
// Una riga è BLOCCANTE se il pezzo è ancora da ordinare: nessuno l'ha
// comprato, quindi non c'è né data né speranza a breve. Se invece è già
// ordinato ha una consegna prevista: manca, ma arriva. La differenza è tutta
// qui, ed è quella che distingue una commessa ferma da una che parte.
// Il TIPO PARTE dell'estrazione (27 ago) divide i mancanti in tre mestieri
// diversi, che prima finivano tutti nello stesso rosso:
//   ACQ  = lo compriamo noi        -> c'e' un ordine da emettere
//   C/L  = conto lavoro            -> arriva dal CLIENTE, non si ordina
//   MAC  = materiale di consumo    -> il filo c'e' sempre, non ferma niente
// Sui dati del 27 ago: 24 ACQ, 222 C/L, 41 MAC. Senza questa distinzione
// 16 commesse su 31 mostravano un rosso da 48, 36, 28 codici "da ordinare"
// quando non c'era niente da ordinare: si aspettava il cliente.
const MANC_ACQUISTO = 'ACQ', MANC_CONTOLAVORO = 'C/L', MANC_CONSUMO = 'MAC';
function mancanteTipo(m) {
  return String((m && m.tipo_parte) || '').trim().toUpperCase();
}

// Categoria di una riga. UNA riga sta in una categoria sola, e l'ordine dei
// controlli e' la regola: prima cosa manca davvero, poi di chi e' la mossa.
//   'consumo'       -> non ferma la commessa
//   'in_arrivo'     -> ordinato, ha una data
//   'attesa_cliente'-> manca e lo deve mandare il cliente (C/L)
//   'da_ordinare'   -> manca e tocca a noi comprarlo
// ⚠ Se `tipo_parte` non c'e' (l'archivio importato PRIMA del 27 ago) ci si
// comporta esattamente come prima: da ordinare se la quantita' e' > 0. Un
// dato vecchio non deve cambiare significato solo perche' e' arrivata una
// colonna nuova.
function mancanteCategoria(m) {
  const tipo = mancanteTipo(m);
  if (tipo === MANC_CONSUMO) return 'consumo';
  if (!(Number(m && m.qta_da_ordinare) > 0)) return 'in_arrivo';
  if (tipo === MANC_CONTOLAVORO) return 'attesa_cliente';
  return 'da_ordinare';
}

// Una riga e' BLOCCANTE se il pezzo e' ancora da ordinare: nessuno l'ha
// comprato, quindi non c'e' ne' data ne' speranza a breve. Se invece e' gia'
// ordinato ha una consegna prevista: manca, ma arriva. La differenza e' tutta
// qui, ed e' quella che distingue una commessa ferma da una che parte.
// Dal 27 ago il conto lavoro NON e' piu' qui dentro: manca anche quello, ma
// non c'e' nessun ordine da emettere e mescolarlo svuotava il rosso di senso.
function mancanteBloccante(m) { return mancanteCategoria(m) === 'da_ordinare'; }
// Manca e ferma la commessa, ma la mossa e' del cliente, non nostra.
function mancanteAttesaCliente(m) { return mancanteCategoria(m) === 'attesa_cliente'; }
// Consegne previste di una riga, ordinate per data. Le righe arrivano dal
// fabbisogno con fino a 5 previsioni di entrata.
function mancanteConsegne(m) {
  const c = (m && m.consegne) || [];
  return (Array.isArray(c) ? c : []).filter(x => x && x.data)
    .slice().sort((a, b) => String(a.data).localeCompare(String(b.data)));
}
// Mancanti di una commessa + coerenza con la tendina "Preparazione materiale".
// `incoerente` = il fabbisogno dice che manca roba ma la preparazione è
// dichiarata completa: contraddizione da mostrare, non da nascondere.
// Ritorna { righe, nCodici, nBloccanti, nInArrivo, prossima, nRitardo,
//   incoerente, dataImport }.
function mancantiCommessa(op, oggiIso) {
  const vuoto = { righe: [], nCodici: 0, nBloccanti: 0, nInArrivo: 0,
    nAttesaCliente: 0, nConsumo: 0, nInArrivoVero: 0,
    prossima: null, nRitardo: 0, incoerente: false, dataImport: null };
  if (!op || !op.numero_op) return vuoto;
  const righe = (state.mancanti || [])
    .filter(m => m.numero_op === op.numero_op)
    .slice()
    // Bloccanti in cima: sono quelle su cui bisogna agire.
    .sort((a, b) => (mancanteBloccante(b) ? 1 : 0) - (mancanteBloccante(a) ? 1 : 0)
      || String(a.codice || '').localeCompare(String(b.codice || '')));
  if (!righe.length) return vuoto;
  const oggi = oggiIso || new Date().toISOString().slice(0, 10);
  const bloccanti = righe.filter(mancanteBloccante);
  const attesaCliente = righe.filter(mancanteAttesaCliente);
  const consumo = righe.filter(m => mancanteCategoria(m) === 'consumo');
  let prossima = null, nRitardo = 0;
  righe.forEach(m => {
    mancanteConsegne(m).forEach(c => {
      if (c.data < oggi) nRitardo++;
      else if (!prossima || c.data < prossima) prossima = c.data;
    });
  });
  return {
    righe,
    nCodici: righe.length,
    nBloccanti: bloccanti.length,
    // Le tre categorie nuove sono in AGGIUNTA: `nInArrivo` continua a valere
    // "quello che non blocca", com'era, così i punti che lo usano non cambiano
    // significato sotto i piedi. Chi vuole il dettaglio ha i campi sotto.
    nInArrivo: righe.length - bloccanti.length,
    nAttesaCliente: attesaCliente.length,
    nConsumo: consumo.length,
    nInArrivoVero: righe.length - bloccanti.length - attesaCliente.length - consumo.length,
    prossima,
    nRitardo,
    incoerente: op.stato_preparazione === 'completo',
    dataImport: righe.reduce((d, m) =>
      (!d || String(m.import_data || '') > d) ? (m.import_data || d) : d, null),
  };
}
// Tutte le consegne previste, appiattite e ordinate per data: una riga del
// fabbisogno può averne fino a 5. `scadute` = attese prima di oggi e mai
// arrivate — è il segnale più utile dell'intero file, e prima non si vedeva.
// Ritorna { prossime, scadute } con righe { data, qta, codice, descrizione,
//   numero_op, ordine, fornitore, mancante }.
function consegnePreviste(oggiIso) {
  const oggi = oggiIso || new Date().toISOString().slice(0, 10);
  const prossime = [], scadute = [];
  (state.mancanti || []).forEach(m => {
    mancanteConsegne(m).forEach(c => {
      const riga = {
        data: c.data, qta: Number(c.qta) || null,
        codice: m.codice, descrizione: m.descrizione,
        numero_op: m.numero_op, ordine: c.ordine || null,
        fornitore: c.fornitore || null, mancante: m,
      };
      (c.data < oggi ? scadute : prossime).push(riga);
    });
  });
  const perData = (a, b) => String(a.data).localeCompare(String(b.data));
  return { prossime: prossime.sort(perData), scadute: scadute.sort(perData) };
}

// ── CONSUNTIVO COMPLETO di una commessa ────────────────────────────────────
// Il consuntivo conta TUTTO il lavoro fatto sul pezzo (28 lug, decisione Nico):
// timbri dei dipendenti + timbri degli esterni in sede + ore dichiarate dai
// fornitori su rapportino. Motivo: la differenza fra interno ed esterno è di
// COSTO, non di DURATA — un pezzo lavorato 24h è a 24h chiunque le abbia fatte.
// Escludere le esterne farebbe leggere il 14% su un pezzo che è al 32%.
//
// BASE DEL CONFRONTO — la regola che evita gli sfori falsi: se nel consuntivo
// conto ore esterne, allora nel preventivo devo ricontare anche il budget
// esterno. Prima di questa funzione il codice assumeva "i timbri sono solo
// interni" (vero finché gli esterni non timbravano): confrontava un consuntivo
// che le comprendeva con un preventivo che le escludeva.
//   nessuna ora esterna → base = previsto INTERNO   (comportamento storico)
//   almeno una          → base = previsto TOTALE    (omogeneo)
// Quando nessuna fase è esternalizzata i due valori coincidono e non cambia
// nulla: la regola morde solo dove serve.
// Ritorna { oreInterne, oreEsterneTimbrate, oreEsterneDichiarate, oreEsterne,
//   oreTot, base, baseTotale, perc, sforo, tolleranza }.
function consuntivoCommessa(op) {
  if (!op) return null;
  const oreTimbri = opCalcOreReali(op);   // dipendenti + esterni in sede
  const oe = (typeof oreEsterneCommessa === 'function')
    ? oreEsterneCommessa(op.id) : { righe: [] };
  const somma = (f) => oe.righe.filter(f).reduce((s, x) => s + x.ore, 0);
  const oreEsterneTimbrate = somma(x => x.fonte === 'timbro');
  const oreEsterneDichiarate = somma(x => x.fonte === 'dichiarata');
  const oreEsterne = oreEsterneTimbrate + oreEsterneDichiarate;
  // Le timbrate sono GIÀ dentro oreTimbri (sono sessioni); le dichiarate no.
  const oreInterne = Math.max(0, oreTimbri - oreEsterneTimbrate);
  const oreTot = oreTimbri + oreEsterneDichiarate;
  const prevTot = opCalcOre(op);
  const prevInt = opCalcOreInterne(op);
  const base = oreEsterne > 0 ? prevTot : prevInt;
  const tolleranza = tolleranzaOre(base);
  // Stessa regola applicata all'altro riferimento del sistema: il TEMPO PAGATO
  // (quello che il cliente riconosce), usato dalla barra ore in intestazione.
  // Se il consuntivo comprende ore esterne, il pagato di confronto è quello
  // INTERO e non la sola quota interna — altrimenti si confronta il lavoro di
  // tutti con la paga di una parte sola.
  const pagatoInt = pagatoOreInterne(op);
  const pagatoTot = (Number(op.minuti_unitari) || 0) * (Number(op.quantita) || 0) / 60;
  const pagato = oreEsterne > 0 ? pagatoTot : pagatoInt;
  const tollPagato = tolleranzaOre(pagato);
  return {
    oreInterne, oreEsterneTimbrate, oreEsterneDichiarate, oreEsterne, oreTot,
    base, baseTotale: oreEsterne > 0 && prevTot !== prevInt,
    perc: base > 0 ? Math.round(oreTot / base * 100) : 0,
    sforo: base > 0 && oreTot > base + tolleranza,
    tolleranza,
    pagato, pagatoTotale: oreEsterne > 0 && pagatoTot !== pagatoInt,
    percPagato: pagato > 0 ? Math.round(oreTot / pagato * 100) : 0,
    sforoPagato: pagato > 0 && oreTot > pagato + tollPagato,
  };
}

// Scostamenti prezzo-vs-consuntivo di un cliente: per ogni suo articolo con
// prezzo, confronta il listino vivo (ultimo prezzo praticato) col prezzo che
// le ore realmente timbrate giustificherebbero. Ordinati per scarto assoluto:
// in cima quelli su cui si perde (o si guadagna) di più, in entrambi i versi.
// Solo articoli con consuntivo vero; chi non ha storico semplicemente non
// compare. Ritorna [{ articoloId, prezzo, suggerito, scarto, ... }].
function scostamentiPrezzoCliente(clienteId) {
  if (!clienteId) return [];
  const cli = (state.aziende || []).find(a => a.id === clienteId);
  if (!cli || !(Number(cli.tariffa_cliente) > 0)) return [];
  const artIds = [...new Set((state.operazioni || [])
    .filter(o => o.cliente_id === clienteId && o.articolo_id && Number(o.prezzo_unitario) > 0)
    .map(o => o.articolo_id))];
  const out = [];
  artIds.forEach(artId => {
    const list = prezzoListino(artId, clienteId);
    const s = prezzoDaTempoEffettivo(artId, clienteId);
    if (!list || !s || !(list.prezzo > 0) || !list.proprioCliente) return;
    out.push({
      articoloId: artId,
      prezzo: list.prezzo,
      suggerito: s.prezzo,
      scarto: s.prezzo / list.prezzo - 1,
      minPz: s.minPz,
      ore: s.ore,
      nCommesse: s.nCommesse,
      debole: s.debole,
      fasiSenzaStorico: s.fasiSenzaStorico,
    });
  });
  return out.sort((a, b) => Math.abs(b.scarto) - Math.abs(a.scarto));
}

// ── ASSENZE DENTRO UNA PRENOTAZIONE MEZZO ──────────────────────────────────
// Chi prenota un mezzo lo fa spesso PER UN ALTRO, e non ha davanti il
// calendario ferie: qui si guardano le assenze di OGNI operatore collegato,
// non solo di chi sta prenotando.
//
// Non decide niente e non blocca (decisione Nico, 5 ago): elenca e basta —
// stessa linea del resto dell'app, il gestionale dichiara e la persona decide.
// Un rientro anticipato o un permesso che non tocca la trasferta sono casi
// veri, e il gestionale non li conosce.
//
// GIORNATA INTERA vs PERMESSO: un permesso di 2 ore non impedisce una
// trasferta, una ferie sì. Le due cose vanno DETTE diverse, non trattate
// uguale. Soglia = ORE_STANDARD_GIORNO, la stessa già usata dalle card Live.
// Più righe nello stesso giorno si sommano (mattina + pomeriggio = intera).
//
// Ritorna [{ utenteId, giorni: [{ data, ore, intera, tipo }], nIntere,
//   nParziali }], un elemento per operatore che ha almeno un'assenza.
function assenzeInPrenotazione(utentiIds, dataInizioIso, dataFineIso) {
  const ids = [...new Set((utentiIds || []).filter(Boolean))];
  if (!ids.length || !dataInizioIso) return [];
  const fine = dataFineIso || dataInizioIso;
  // utenteId → data → ore sommate (e il tipo della prima riga del giorno)
  const perUtente = new Map();
  (state.assenze || []).forEach(a => {
    if (a.stato !== 'valida') return;
    if (!ids.includes(a.utente_id)) return;
    if (!a.data || a.data < dataInizioIso || a.data > fine) return;
    if (!perUtente.has(a.utente_id)) perUtente.set(a.utente_id, new Map());
    const giorni = perUtente.get(a.utente_id);
    const prec = giorni.get(a.data);
    const ore = (parseFloat(a.ore) || 0) + (prec ? prec.ore : 0);
    giorni.set(a.data, { ore, tipoId: prec ? prec.tipoId : a.tipo_assenza_id });
  });
  const out = [];
  // Si scorre `ids` e non la mappa: l'ordine è quello degli operatori scelti.
  ids.forEach(uid => {
    const giorni = perUtente.get(uid);
    if (!giorni || !giorni.size) return;
    const righe = [...giorni.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([data, g]) => {
        const tipo = (state.tipiAssenza || []).find(t => t.id === g.tipoId);
        return {
          data, ore: g.ore,
          // Senza ore scritte non si può dire che sia un mezzo permesso:
          // si considera intera, che è il caso da segnalare.
          intera: !(g.ore > 0) || g.ore >= ORE_STANDARD_GIORNO,
          tipo: (tipo && tipo.nome) || 'Assenza',
        };
      });
    out.push({
      utenteId: uid,
      giorni: righe,
      nIntere: righe.filter(r => r.intera).length,
      nParziali: righe.filter(r => !r.intera).length,
    });
  });
  return out;
}

// ── TIMBRATURE SOSPETTE ────────────────────────────────────────────────────
// Riepilogo delle timbrature che meritano un'occhiata. Puro: legge state e
// ritorna righe, non decide e non tocca niente.
//
// LA PARTE DIFFICILE NON È TROVARLE, È NON GRIDARE AL LUPO. Sui dati veri
// (2.208 sessioni) le coppie con lo STESSO identico intervallo erano 65, e
// sembravano ore contate due volte. Non lo erano:
//   · 41 sono lo SPLIT a mano di 2026/OC/00198 fra i due articoli gemelli
//     (posizione /20 e /40, 62,4 h per lato) — voluto da una persona;
//   · 24 sono le QUOTE dell'accorpamento, cioè un timbro spalmato sul gruppo —
//     il funzionamento previsto.
// Elencarle tutte avrebbe prodotto 65 righe di rumore e, in una settimana, un
// riquadro che nessuno guarda più. Per questo qui si segnala il doppione solo
// quando è sulla STESSA commessa: quello non ha nessuna spiegazione buona.
//
// Ritorna { righe, n, perTipo } — righe: { tipo, sessione, utenteId, quando,
// testo }. Tipi: 'aperta', 'lunga', 'doppione', 'sovrapposta'.
const SOSPETTE_ORE_APERTA = 7;
// L'ora della pausa pranzo, ripetuta qui perché il domain è PURO e non vede le
// costanti del kiosk. Se un giorno la pausa si sposta, va cambiata anche qui.
const PAUSA_ORA_SOSPETTE = 12;
const PAUSA_MIN_SOSPETTE = 30;
function timbratureSospette(soloOggiIso) {
  const ms = (s) => new Date(s.inizio).getTime();
  const fineMs = (s) => s.fine ? new Date(s.fine).getTime() : Date.now();
  const righe = [];
  const sessioni = (state.sessioni || []).filter(s => s && s.inizio);
  const nomeUt = (id) => {
    const u = (state.utenti || []).find(x => x.id === id);
    return (u && u.nome) || 'operatore';
  };
  const opDi = (s) => (state.operazioni || []).find(o => o.id === s.operazione_id);
  const dove = (s) => {
    const o = opDi(s);
    if (o) return (o.numero_ordine || '—') + '/' + (o.pos || '');
    if (s.attivita_id) {
      const a = (state.attivitaExtra || []).find(x => x.id === s.attivita_id);
      return (a && a.nome) || 'attività extra';
    }
    return '—';
  };
  const aggiungi = (tipo, s, testo) => righe.push({
    tipo, sessione: s, utenteId: s.utente_id,
    quando: toLocalISO(new Date(s.inizio)), testo,
  });

  // 1) DURATA ZERO: NON si segnala più (24 ago, decisione Nico).
  // Entrare pochi secondi in una commessa per chiuderla è un gesto VOLUTO e
  // frequente — lo stesso che il collega di Nico aveva raccontato per le fasi,
  // e che i dati confermano: dei 215 timbri sotto i 3 minuti, 112 sono su
  // commesse dove quell'operatore ha una fase completata, 86 entro 5 minuti,
  // mediana 6 secondi.
  // Se la commessa è raggruppata, lo split di quel tocco genera una quota a
  // zero per ogni membro: 15 righe su 19 dell'elenco venivano da lì. Erano il
  // sottoprodotto normale di un gesto normale, e riempivano la lista fino a
  // renderla inutile — che è il modo più rapido per far smettere di guardarla.
  // Lo split resta com'è (nessuna soglia minima): è il segnale a essere
  // sbagliato, non il meccanismo.

  sessioni.forEach(s => {
    const ore = (fineMs(s) - ms(s)) / 3600000;
    if (ore < SOSPETTE_ORE_APERTA) return;
    // 2) Aperta da troppo: l'unica che chiede un intervento ADESSO.
    if (!s.fine) {
      aggiungi('aperta', s, nomeUt(s.utente_id) + ' · ' + dove(s)
        + ' · aperta da ' + ore.toFixed(1).replace('.', ',') + ' h');
      return;
    }
    // 3) CHIUSA ma lunghissima: nessuno lavora 60 ore di fila, quindi da
    // qualche parte c'è un orario sbagliato. Va segnalata anche se è vecchia:
    // finché non la si corregge quelle ore restano dentro i conti (quella da
    // 62,6 h vale da sola il 28% di tutte le ore delle attività extra).
    // È il buco che aveva già il banner di Live, che guarda solo il presente.
    //
    // ECCEZIONE: se l'ha chiusa la PAUSA (fine alle 12:30 spaccate) non è
    // sfuggita a nessuno — l'ha chiusa il gestionale, e più di così non poteva
    // durare. Segnalarla vorrebbe dire gridare al lupo su una mattinata lunga:
    // chi attacca alle 5 arriva a 7,5 h prima di pranzo, ed è normale qui.
    const f = new Date(s.fine);
    if (f.getHours() === PAUSA_ORA_SOSPETTE && f.getMinutes() === PAUSA_MIN_SOSPETTE
        && f.getSeconds() === 0) return;
    aggiungi('lunga', s, nomeUt(s.utente_id) + ' · ' + dove(s) + ' · durata '
      + ore.toFixed(1).replace('.', ',') + ' h ('
      + fmtIT(toLocalISO(new Date(s.inizio))) + ' ' + fmtT(new Date(s.inizio))
      + ' → ' + fmtIT(toLocalISO(new Date(s.fine))) + ' ' + fmtT(new Date(s.fine)) + ')');
  });

  // 3) e 4): confronti a coppie, per persona e in ordine di inizio.
  const perUtente = new Map();
  sessioni.forEach(s => {
    if (!perUtente.has(s.utente_id)) perUtente.set(s.utente_id, []);
    perUtente.get(s.utente_id).push(s);
  });
  perUtente.forEach((lista, uid) => {
    lista.sort((a, b) => ms(a) - ms(b));
    for (let i = 1; i < lista.length; i++) {
      const p = lista[i - 1], c = lista[i];
      if (ms(c) >= fineMs(p) - 1000) continue;         // non si toccano
      const identico = Math.abs(ms(c) - ms(p)) < 2000
        && Math.abs(fineMs(c) - fineMs(p)) < 2000;
      if (identico) {
        // Stesso intervallo su commesse diverse = split o quote di gruppo:
        // spiegato, non si segnala (vedi commento in testa).
        if ((p.operazione_id || null) !== (c.operazione_id || null)) continue;
        aggiungi('doppione', c, nomeUt(uid) + ' · ' + dove(c)
          + ' · due timbri identici sulla stessa commessa');
        continue;
      }
      // Accavallamento parziale: una delle due ha un orario sbagliato.
      const oraP = fmtT(new Date(p.inizio)) + '→' + (p.fine ? fmtT(new Date(p.fine)) : 'aperta');
      const oraC = fmtT(new Date(c.inizio)) + '→' + (c.fine ? fmtT(new Date(c.fine)) : 'aperta');
      aggiungi('sovrapposta', c, nomeUt(uid) + ' · ' + oraP + ' si accavalla con ' + oraC);
    }
  });

  const filtrate = soloOggiIso ? righe.filter(r => r.quando === soloOggiIso) : righe;
  filtrate.sort((a, b) => String(b.quando).localeCompare(String(a.quando)));
  const perTipo = {};
  filtrate.forEach(r => { perTipo[r.tipo] = (perTipo[r.tipo] || 0) + 1; });
  return { righe: filtrate, n: filtrate.length, perTipo };
}

// ── ACCAVALLAMENTI: si impediscono, non si rincorrono ──────────────────────
// Una persona non può lavorare in due posti nello stesso momento: se due suoi
// timbri si sovrappongono, uno dei due ha un orario sbagliato e le ore sono
// contate due volte. Sui dati veri erano 5 casi (giugno-agosto).
// Ritorna la PRIMA sessione in conflitto, o null. `escludiId` serve quando si
// sta modificando una sessione esistente (non deve accavallarsi con sé stessa).
// Estremi che si toccano NON sono conflitto: chiudo alle 10:00 e riparto alle
// 10:00 è la cosa normale che succede tutto il giorno.
function sessioneInConflitto(utenteId, inizioIso, fineIso, escludiId) {
  if (!utenteId || !inizioIso) return null;
  const a1 = new Date(inizioIso).getTime();
  // Una sessione aperta occupa da qui in avanti: per il confronto vale "adesso"
  // se è già passata, altrimenti il suo stesso inizio.
  const a2 = fineIso ? new Date(fineIso).getTime() : Math.max(Date.now(), a1);
  if (!(a2 > a1)) return null;
  const trovata = (state.sessioni || []).find(s => {
    if (!s || s.utente_id !== utenteId || s.id === escludiId || !s.inizio) return null;
    const b1 = new Date(s.inizio).getTime();
    const b2 = s.fine ? new Date(s.fine).getTime() : Math.max(Date.now(), b1);
    if (!(b2 > b1)) return false;          // durata zero: non occupa niente
    return a1 < b2 && b1 < a2;             // si intersecano davvero
  });
  return trovata || null;
}

/* ═══════════════════════════════════════════════════════════════════
   IMPORT ORDINI DALL'ESTRAZIONE ERP (25 ago 2026)

   Funzione PURA: riceve le righe già lette dall'xlsx (array di oggetti
   intestazione→valore, come li dà SheetJS) più le anagrafiche, e ritorna
   il PIANO di import. Non scrive niente: decide e dichiara.
   Le regole stanno qui e non nella UI perché sono la parte che va
   verificata sui dati veri prima di toccare il database.

   Decisioni prese con Nico il 25 ago, tutte visibili nel codice sotto:
   · SOLO sezionale OC. Le righe OD si scartano dichiarandole.
   · Senzani + riferimento che inizia per EL → le righe si FONDONO in una
     sola commessa per ordine: articolo `BOX_<riferimento>`, descrizione
     `SBNE`, pos 0010, quantità 1, prezzo = somma degli imponibili.
     Riproduce esattamente le 11 commesse BOX già a sistema.
     ⚠ Fusione di righe DEL FILE, da non confondere con la funzione
     "⊞ Raggruppa" dell'app (`gruppo_id`), che è un'altra cosa: là si
     spalmano le ore fra commesse distinte, qui le righe dell'estrazione
     non diventano mai commesse. L'import non tocca nessun gruppo.
   · quantità = "Quantita UMI Ordine/Offerta" (l'ordinato, non la residua).
   · scadenza  = "Data Rich. Evasione". 2958465 = 9999-12-31 è la
     sentinella "nessuna data" dell'ERP, non una scadenza tra 8000 anni.
   · Il file è una FOTOGRAFIA: una commessa già presente si AGGIORNA
     (solo quantità, scadenza, prezzo), non si duplica. Tutto il resto —
     stato, fasi, addetti, note, gruppi — è lavoro fatto dentro il
     gestionale e l'import non lo tocca.
   · Una commessa completata o spedita NON si tocca mai, nemmeno per
     aggiornarla: si conta e si dichiara. Una fotografia dell'ERP non deve
     poter riaprire un lavoro finito.
   ═══════════════════════════════════════════════════════════════════ */

// Intestazioni cercate, in ordine di preferenza: prima i nomi veri
// dell'estrazione ERP, poi quelli dell'export del gestionale (così il giro
// esporta→reimporta continua a funzionare come prima).
const IMPORT_ORDINI_COLONNE = {
  eser:       ['eser', 'esercizio', 'anno'],
  sz:         ['sz cl', 'sz', 'sigla'],
  ord:        ['ord/off cliente', 'ord', 'ordine', 'numero'],
  riga:       ['riga', 'pos', 'posizione'],
  codArt:     ['codice articolo', 'codice', 'articolo'],
  descrArt:   ['descrizione articolo', 'descrizione'],
  scadenza:   ['data rich. evasione', 'data richiesta evasione', 'scadenza'],
  qta:        ['quantita umi ordine/offerta', 'quantita umi ordine/offerta',
               'quantita', 'qta'],
  cliente:    ['ragione sociale', 'cliente', 'nome cliente'],
  residua:    ['quantita residua', 'qta residua', 'residua'],
  rif:        ['riferimento cliente', 'rifer. cliente', 'riferimento'],
  prezzo:     ['prezzo netto riga', 'prezzo'],
  imponibile: ['impon. totale riga', 'imponibile'],
};

// Senza queste il file non è un'estrazione ordini e non si va avanti.
const IMPORT_ORDINI_OBBLIGATORIE = ['ord', 'riga', 'codArt', 'scadenza', 'qta', 'cliente'];

// Data da cella Excel: Date (SheetJS con cellDates), seriale, o testo.
// Il seriale si converte in UTC e si affetta a 10 caratteri: costruirlo in
// ora locale e riformattarlo poi è la trappola della sezione ORARI —
// una data a mezzanotte torna indietro di un giorno.
function importOrdiniData(v) {
  if (v === null || v === undefined || v === '') return null;
  // La sentinella va riconosciuta su OGNI strada, non solo sul seriale:
  // l'app legge con cellDates:true, quindi 2958465 arriva come Date e il
  // controllo numerico qui sotto non la vedrebbe mai. Senza questo, una
  // commessa entrerebbe con scadenza 31/12/9999 invece di essere scartata.
  const fuoriScala = iso => (iso && Number(iso.slice(0, 4)) >= 9999) ? null : iso;
  // Riconosciuta dai metodi e non con `instanceof Date`: fra contesti diversi
  // (il banco di prova ne usa uno) `instanceof` e' falso su una Date perfetta,
  // e la data finirebbe nel ramo numerico senza che niente lo segnali.
  if (v && typeof v.getFullYear === 'function' && !isNaN(v.getTime())) {
    // SheetJS costruisce le date a mezzanotte LOCALE: si leggono in locale.
    // (Il seriale 45541 diventa 2024-09-05T22:00Z, cioe' il 6 settembre qui:
    // leggerlo in UTC lo farebbe arretrare di un giorno.)
    return fuoriScala(v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0')
      + '-' + String(v.getDate()).padStart(2, '0'));
  }
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) {
    // 2958465 = 9999-12-31: l'ERP la usa per dire "nessuna data".
    if (n >= 2958465) return null;
    return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) return fuoriScala(m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return fuoriScala(m[1] + '-' + m[2] + '-' + m[3]);
  return null;
}

// Chiave per riconoscere DUE SCRITTURE DELLA STESSA DITTA (25 ago, dopo il
// danno). L'ERP scrive `CABLOTECH SRL`, il gestionale `Cablotech S.r.l.`:
// confrontando solo minuscole e spazi sembrano due aziende diverse, e
// l'import ne creava una nuova accanto a quella che c'era gia'.
// Si toglie tutto cio' che non e' lettera o cifra — punti, spazi, trattini,
// accenti — perche' la differenza sta sempre nella forma giuridica
// (SRL / S.r.l. / S.R.L., snc / S.n.c.), mai nel nome.
// Provata su tutte e 32 le aziende in anagrafica: 32 chiavi distinte,
// nessuna coppia di ditte diverse finisce sulla stessa chiave.
// Toglie gli accenti: serve sia alle intestazioni (l'ERP mescola "Quantita"
// e "Quantità" nello stesso foglio) sia ai nomi delle ditte.
function senzaAccenti(s) {
  return String(s === null || s === undefined ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function importOrdiniChiaveNome(nome) {
  return String(nome === null || nome === undefined ? '' : nome).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// La fusione BOX vale per Senzani e per nessun altro: sui dati veri il
// prefisso EL è esclusivamente suo (177 righe su 177), ma il vincolo sul
// cliente resta esplicito perché un domani un altro cliente potrebbe usare
// la stessa sigla per cose sue.
function importOrdiniEBox(nomeCliente, riferimento) {
  return /senzani/i.test(String(nomeCliente || ''))
    && /^EL/i.test(String(riferimento || '').trim());
}

function analizzaImportOrdini(righe, ctx) {
  righe = righe || [];
  ctx = ctx || {};
  const articoli   = ctx.articoli   || [];
  const aziende    = ctx.aziende    || [];
  const operazioni = ctx.operazioni || [];
  const spedizioni = ctx.spedizioni || [];

  const out = {
    righeLette: righe.length, mappa: {}, colonneMancanti: [],
    scartate: [], scartatePerMotivo: {},
    box: [], nuove: [], aggiornamenti: [], bloccate: [], invariate: 0,
    clientiDaCreare: [], articoliDaCreare: [], clientiRiconosciuti: [],
    clientiDaRinominare: [], rinomineImpossibili: [], residuiDiscordanti: [],
    senzaCodice: [], statiDiscordanti: { chiuseQui: [], viveQui: [] },
  };
  if (!righe.length) return out;

  const norm = s => String(s === null || s === undefined ? '' : s).toLowerCase().trim();
  const headers = Object.keys(righe[0]);
  const quantiPieni = h => righe.reduce((n, r) =>
    n + ((r[h] !== '' && r[h] !== null && r[h] !== undefined) ? 1 : 0), 0);
  const trova = (cands) => {
    for (const c of cands) {
      // SheetJS rinomina le intestazioni doppie con un suffisso _1: l'estrazione
      // ERP ne ha due chiamate "Riferimento Cliente", e quella con i dati è la
      // seconda. Fra omonime vince quella che ha davvero qualcosa dentro,
      // altrimenti il riferimento — la chiave di tutta la regola Senzani —
      // arriverebbe vuoto senza che nessuno se ne accorga.
      // Il .trim() DOPO aver tolto il suffisso non e' pignoleria: le
      // intestazioni dell'ERP finiscono con uno spazio, quindi la seconda
      // omonima diventa "Riferimento Cliente _1" e senza questo trim
      // resterebbe "riferimento cliente " — che non combacia con niente.
      // Gli ACCENTI si tolgono da tutte e due le parti: l'ERP scrive
      // "Quantita UMI Ordine/Offerta" senza accento e "Quantità Residua" con,
      // nello stesso foglio. Inseguire le varianti a mano nella lista dei
      // candidati non finirebbe mai — e la colonna residua era gia' sfuggita
      // proprio cosi'.
      const match = headers.filter(h => senzaAccenti(norm(h)) === c
        || senzaAccenti(norm(h).replace(/_\d+$/, '').trim()) === c);
      if (match.length) return match.slice().sort((a, b) => quantiPieni(b) - quantiPieni(a))[0];
    }
    return null;
  };
  Object.keys(IMPORT_ORDINI_COLONNE).forEach(k => { out.mappa[k] = trova(IMPORT_ORDINI_COLONNE[k]); });
  out.colonneMancanti = IMPORT_ORDINI_OBBLIGATORIE.filter(k => !out.mappa[k]);
  if (out.colonneMancanti.length) return out;

  // Indici sulle anagrafiche
  const artByCod = {};
  articoli.forEach(a => { if (a.codice) artByCod[norm(a.codice)] = a; });
  // Un indice solo sui clienti, per chiave (la stessa ditta comunque scritta).
  // Se la stessa ditta compare piu' volte vince la scheda PIU' VECCHIA: e'
  // quella con le commesse e lo storico attaccati. Non e' teoria — finche' i
  // doppioni del 25 ago non sono ripuliti, cercare per nome esatto
  // aggancerebbe la scheda vuota nata quel giorno invece di quella vera.
  // A parita' di eta' vince il nome scritto identico al file.
  const cliByChiave = {};
  aziende.forEach(a => {
    const k = importOrdiniChiaveNome(a.nome);
    if (!k) return;
    const gia = cliByChiave[k];
    if (!gia) { cliByChiave[k] = a; return; }
    const piuVecchia = String(a.created_at || '') < String(gia.created_at || '');
    const stessaEta  = String(a.created_at || '') === String(gia.created_at || '');
    if (piuVecchia || (stessaEta && norm(a.nome) < norm(gia.nome))) cliByChiave[k] = a;
  });
  // La posizione si confronta come NUMERO, non come testo (25 ago, dopo il
  // danno). Le commesse piu' vecchie hanno `pos` senza zeri davanti — "40"
  // invece di "0040", 191 su 468 — e l'import, che scrive la forma con gli
  // zeri, non le riconosceva: invece di aggiornarle ne creava una accanto.
  // 55 commesse doppie in una passata sola.
  // Le NUOVE continuano a nascere con gli zeri (e' la forma dell'app): qui
  // cambia solo il modo di CERCARE quelle che ci sono gia'.
  const chiaveOp = (numOrd, pos) => {
    const p = (pos === null || pos === undefined || pos === '') ? '' : Number(pos);
    return (numOrd || '') + '|' + (Number.isFinite(p) ? p : String(pos).trim());
  };
  const opByChiave = {};
  operazioni.forEach(o => {
    const k = chiaveOp(o.numero_ordine, o.pos);
    // Se lo stesso ordine+posizione esiste gia' due volte (i doppioni del
    // 25 ago), vince la piu' VECCHIA: e' quella con la storia attaccata.
    const gia = opByChiave[k];
    if (!gia || String(o.created_at || '') < String(gia.created_at || '')) opByChiave[k] = o;
  });

  const val = (r, k) => {
    const col = out.mappa[k];
    if (!col) return '';
    const v = r[col];
    return (v === null || v === undefined) ? '' : String(v).trim();
  };
  const scarta = (nRiga, motivo) => {
    out.scartate.push({ riga: nRiga, motivo });
    out.scartatePerMotivo[motivo] = (out.scartatePerMotivo[motivo] || 0) + 1;
  };

  // Passata 1: normalizzazione riga per riga
  const singole = [];
  const daFondere = {};            // "numeroOrdine::riferimento" -> righe del box
  // Tutte le chiavi ordine+posizione VISTE nel file, anche quelle di righe
  // poi scartate o fuse: servono a non far sembrare sparita da Alnus una
  // commessa la cui riga nel file c'e', solo non importabile.
  const chiaviViste = new Set();
  righe.forEach((r, i) => {
    const nRiga = i + 2;                     // +2: la riga 1 sono le intestazioni
    const sz = (val(r, 'sz') || 'OC').toUpperCase();
    if (sz !== 'OC') return scarta(nRiga, 'sezionale ' + sz + ' (per ora si importa solo OC)');

    const ord = val(r, 'ord');
    if (!ord) return scarta(nRiga, 'numero ordine mancante');
    const eser = val(r, 'eser');
    const numeroOrdine = (eser ? eser + '/' : '') + sz + '/' + String(ord).padStart(5, '0');
    const pos = String(val(r, 'riga') || '').padStart(4, '0');
    chiaviViste.add(chiaveOp(numeroOrdine, pos));

    const clienteNome = val(r, 'cliente');
    if (!clienteNome) return scarta(nRiga, 'cliente mancante');

    const scadenza = importOrdiniData(r[out.mappa.scadenza]);
    if (!scadenza) return scarta(nRiga, 'scadenza mancante o sentinella 9999');

    const qta = Math.round(Number(val(r, 'qta')));
    if (!Number.isFinite(qta) || qta <= 0) return scarta(nRiga, 'quantita mancante o non valida');

    const prezzo     = Number(val(r, 'prezzo')) || 0;
    const imponibile = Number(val(r, 'imponibile')) || (prezzo * qta);
    const rif        = val(r, 'rif');

    const base = {
      nRiga, numeroOrdine, pos, clienteNome, scadenza, qta, prezzo, imponibile,
      riferimento: rif || null,
      // La residua NON si importa: il gestionale la sa gia' calcolare da solo
      // (ordinato meno spedito) ed e' un derivato — regola di casa, derivati
      // live e mai materializzati. Si tiene solo per CONFRONTARLA: dove i due
      // numeri non tornano, uno dei due sistemi e' indietro sulle spedizioni.
      residuaFile: val(r, 'residua') === '' ? null : Number(val(r, 'residua')),
      codArt: val(r, 'codArt'), descrArt: val(r, 'descrArt'),
    };

    if (importOrdiniEBox(clienteNome, rif)) {
      const k = numeroOrdine + '::' + rif.toUpperCase();
      (daFondere[k] = daFondere[k] || []).push(base);
      return;
    }
    if (!base.codArt) {
      // Il codice articolo DEVE esserci sempre (regola di Nico, 25 ago): se
      // manca non e' una riga che non ci riguarda, e' un ERRORE nell'anagrafica
      // di Alnus da correggere la'. Quindi non finisce fra gli scarti generici
      // ma in un elenco suo, con abbastanza dettaglio per andarla a cercare.
      out.senzaCodice.push({
        numeroOrdine, pos, quantita: qta, prezzo,
        cliente: clienteNome, descrizione: base.descrArt || '(nessuna descrizione)',
      });
      return scarta(nRiga, 'codice articolo mancante');
    }
    singole.push(base);
  });

  // Passata 2: ogni insieme di righe Senzani diventa UNA commessa BOX.
  // La scadenza del box e' la PIU' VICINA del gruppo di righe: il kit e'
  // pronto quando e' pronto tutto, quindi comanda la data piu' stringente.
  // Sui dati di oggi le righe fuse hanno tutte la stessa data, ma non e'
  // garantito e un domani la differenza deve saltare fuori, non sparire.
  const voci = singole.map(v => Object.assign({ origine: 'riga', righeOrigine: [v.nRiga] }, v));
  Object.keys(daFondere).sort().forEach(k => {
    const arr = daFondere[k];
    const rif = k.split('::')[1];
    const scadenze = arr.map(x => x.scadenza).sort();
    const voce = {
      origine: 'box',
      nRiga: arr[0].nRiga,
      righeOrigine: arr.map(x => x.nRiga),
      numeroOrdine: arr[0].numeroOrdine,
      pos: '0010',
      clienteNome: arr[0].clienteNome,
      scadenza: scadenze[0],
      scadenzeDiverse: new Set(scadenze).size > 1,
      qta: 1,
      prezzo: Math.round(arr.reduce((s, x) => s + x.imponibile, 0) * 100) / 100,
      riferimento: rif,
      codArt: 'BOX_' + rif,
      descrArt: 'SBNE',
      nRigheFuse: arr.length,
    };
    voci.push(voce);
    out.box.push(voce);
  });

  // Passata 3: confronto con quello che c'e' gia'
  const clientiNuovi = {}, articoliNuovi = {}, riconosciuti = {}, rinomine = {};
  voci.forEach(v => {
    // Il cliente si cerca prima col nome esatto, poi con la chiave che ignora
    // la forma giuridica. La SCHEDA e' sempre quella che c'e' gia' (l'id non
    // cambia mai, quindi commesse e storico restano attaccati); quello che
    // cambia e' il NOME, che d'ora in poi lo detta Alnus.
    const cli = cliByChiave[importOrdiniChiaveNome(v.clienteNome)] || null;
    const art = artByCod[norm(v.codArt)] || null;
    v.cliente = cli;
    v.articolo = art;
    // Scritto diversamente: la scheda va RINOMINATA per allinearla al file
    // (decisione Nico 25 ago: Alnus e' la fonte del nome). Si raccoglie qui e
    // si dichiara nell'anteprima — un nome che cambia si vede in Gantt, negli
    // export e nelle analisi, quindi non puo' succedere in silenzio.
    v.clienteDicituraDiversa = (cli && cli.nome !== v.clienteNome) ? cli.nome : null;
    if (v.clienteDicituraDiversa) {
      riconosciuti[v.clienteNome] = cli.nome;
      (rinomine[cli.id] = rinomine[cli.id] || { id: cli.id, da: cli.nome, a: {} }).a[v.clienteNome] = true;
    }
    if (!cli) clientiNuovi[v.clienteNome] = true;
    if (!art) articoliNuovi[v.codArt] = v.descrArt || null;

    // Minuti pagati, stessa scala di priorita' di "+ Nuovo ordine": la regola
    // tariffa cliente (prezzo / euro-ora x 60) prima del default articolo.
    // `operazioni.minuti_unitari` e' INTEGER: sempre al minuto intero.
    const tariffa = Number(cli && cli.tariffa_cliente) || 0;
    v.minutiDaTariffa = (tariffa > 0 && v.prezzo > 0);
    v.minutiUnitari = v.minutiDaTariffa
      ? Math.round(v.prezzo / tariffa * 60)
      : ((art && art.minuti_unitari != null) ? Math.round(Number(art.minuti_unitari)) : 0);

    const op = opByChiave[chiaveOp(v.numeroOrdine, v.pos)] || null;
    v.esistente = op;
    if (!op) { out.nuove.push(v); return; }
    if (op.stato === 'completata' || op.stato === 'spedita') { out.bloccate.push(v); return; }

    // Solo i tre campi che vengono davvero dall'ERP.
    const campi = [];
    if (Number(op.quantita) !== v.qta) campi.push({ campo: 'quantita', da: op.quantita, a: v.qta });
    if ((op.scadenza || null) !== v.scadenza) campi.push({ campo: 'scadenza', da: op.scadenza, a: v.scadenza });
    const prezzoNuovo   = v.prezzo > 0 ? v.prezzo : null;
    const prezzoVecchio = (op.prezzo_unitario === null || op.prezzo_unitario === undefined)
      ? null : Number(op.prezzo_unitario);
    const prezzoCambia = (prezzoVecchio === null) !== (prezzoNuovo === null)
      || (prezzoVecchio !== null && prezzoNuovo !== null && Math.abs(prezzoVecchio - prezzoNuovo) > 0.005);
    if (prezzoCambia) campi.push({ campo: 'prezzo', da: prezzoVecchio, a: prezzoNuovo });

    if (!campi.length) { out.invariate++; return; }
    out.aggiornamenti.push({ voce: v, op, campi });
  });

  out.clientiDaCreare  = Object.keys(clientiNuovi).sort();
  // ── Controllo incrociato sulla quantita' residua ──
  // Alnus dice quanto resta da evadere; qui lo si ricalcola da ordinato meno
  // spedito. Se i due non tornano, non c'e' un numero da correggere: c'e' una
  // spedizione che uno dei due sistemi non ha registrato. Si dichiara e basta,
  // non si tocca niente — quale dei due sia indietro lo sa solo chi guarda.
  // I BOX restano fuori: la loro quantita' e' 1 kit, non confrontabile con le
  // residue delle righe che ci sono state fuse dentro.
  const spedPerOp = {};
  spedizioni.forEach(s => {
    spedPerOp[s.operazione_id] = (spedPerOp[s.operazione_id] || 0) + Number(s.quantita || 0);
  });
  voci.forEach(v => {
    if (v.origine === 'box' || !v.esistente) return;
    if (v.residuaFile === null || !Number.isFinite(v.residuaFile)) return;
    const spedito = spedPerOp[v.esistente.id] || 0;
    const residuoQui = Number(v.esistente.quantita || 0) - spedito;
    if (residuoQui === v.residuaFile) return;
    out.residuiDiscordanti.push({
      numeroOrdine: v.numeroOrdine, pos: v.pos, stato: v.esistente.stato,
      ordinato: Number(v.esistente.quantita || 0), spedito, residuoQui,
      residuaFile: v.residuaFile,
      // Se anche l'ORDINATO e' diverso, le due residue non sono nemmeno
      // calcolate sulla stessa base e dirlo cambia la lettura della riga.
      // Succede sulle commesse chiuse, che l'import non aggiorna mai.
      ordinatoFile: v.qta,
      basiDiverse: Number(v.esistente.quantita || 0) !== Number(v.qta),
      // Chi dei due e' indietro, per come si legge il numero:
      // se qui risulta spedito piu' che la', e' Alnus a non saperlo.
      chiIndietro: residuoQui < v.residuaFile ? 'alnus' : 'gestionale',
    });
  });
  // ── I due sistemi viaggiano in parallelo? ──
  // L'estrazione contiene SOLO gli ordini ancora in corso su Alnus (scelta
  // voluta). Quindi la presenza o l'ASSENZA di una riga nel file e' essa
  // stessa un'informazione di stato, e si legge nei due versi:
  //   · c'e' nel file ma qui e' chiusa   -> per Alnus e' ancora da fare
  //   · qui e' viva ma nel file non c'e' -> per Alnus e' finita
  // Non si tocca niente: nessuno dei due sistemi ha ragione per definizione.
  // I BOX Senzani restano fuori (decisione Nico): la' la divergenza e'
  // strutturale — Alnus segue le 15-18 righe singole e le chiude quando sono
  // evase tutte, qui c'e' un kit solo — e sarebbe rumore fisso a ogni import.
  // ⚠ Le chiavi si prendono da TUTTE le righe OC lette, non dalle sole voci
  // importabili. Una riga scartata (codice articolo mancante) o fusa in un BOX
  // sta comunque nel file: se si guardassero solo le voci, la sua commessa
  // risulterebbe "sparita da Alnus" quando invece e' li'. Sono le righe
  // Senzani fuse — 177 — e quelle senza codice.
  const ordiniFile = new Set();
  voci.forEach(v => ordiniFile.add(v.numeroOrdine));
  const eChiusa = o => o.stato === 'completata' || o.stato === 'spedita';
  const descriviOp = o => ({
    numeroOrdine: o.numero_ordine, pos: o.pos, stato: o.stato, scadenza: o.scadenza,
    codice: (articoli.find(a => a.id === o.articolo_id) || {}).codice || '',
    cliente: (aziende.find(a => a.id === o.cliente_id) || {}).nome || '',
  });
  out.statiDiscordanti.chiuseQui = out.bloccate
    .filter(v => v.origine !== 'box')
    .map(v => Object.assign(descriviOp(v.esistente), { origine: 'file' }));
  out.statiDiscordanti.viveQui = operazioni
    .filter(o => !eChiusa(o) && !chiaviViste.has(chiaveOp(o.numero_ordine, o.pos)))
    .map(o => Object.assign(descriviOp(o), {
      // Se l'ORDINE c'e' ancora nel file ma la riga no, non e' sparito
      // l'ordine: e' sparita quella posizione. Si legge diversamente.
      ordineNelFile: ordiniFile.has(o.numero_ordine),
    }));
  const perOrdinePos = (a, b) => String(a.numeroOrdine).localeCompare(String(b.numeroOrdine))
    || Number(a.pos) - Number(b.pos);
  out.statiDiscordanti.chiuseQui.sort(perOrdinePos);
  out.statiDiscordanti.viveQui.sort(perOrdinePos);

  out.residuiDiscordanti.sort((a, b) =>
    String(a.numeroOrdine).localeCompare(String(b.numeroOrdine)) || Number(a.pos) - Number(b.pos));

  out.clientiRiconosciuti = Object.keys(riconosciuti).sort()
    .map(daFile => ({ daFile, inAnagrafica: riconosciuti[daFile] }));

  // Rinomine da applicare, con le due situazioni in cui NON si rinomina.
  // Un nome sbagliato e' peggio di un nome vecchio: nel dubbio non si tocca
  // e si dichiara perche'.
  const nomiEsistenti = {};
  aziende.forEach(a => { if (a.nome) (nomiEsistenti[a.nome] = nomiEsistenti[a.nome] || []).push(a.id); });
  Object.values(rinomine).forEach(r => {
    const scritture = Object.keys(r.a);
    if (scritture.length > 1) {
      // Lo stesso cliente scritto in due modi diversi DENTRO LO STESSO FILE:
      // non c'e' un nome giusto da scegliere, si lascia com'e'.
      out.rinomineImpossibili.push({ id: r.id, da: r.da, motivo:
        'nel file compare con ' + scritture.length + ' diciture diverse (' + scritture.join(', ') + ')' });
      return;
    }
    const nuovo = scritture[0];
    const occupanti = (nomiEsistenti[nuovo] || []).filter(id => id !== r.id);
    if (occupanti.length) {
      // Un'ALTRA scheda si chiama gia' cosi' (tipicamente un doppione non
      // ancora ripulito): rinominare creerebbe due schede con lo stesso nome.
      out.rinomineImpossibili.push({ id: r.id, da: r.da, a: nuovo, motivo:
        'esiste gia un\'altra scheda che si chiama "' + nuovo + '"' });
      return;
    }
    out.clientiDaRinominare.push({ id: r.id, da: r.da, a: nuovo });
  });
  out.clientiDaRinominare.sort((x, y) => x.da.localeCompare(y.da));
  out.articoliDaCreare = Object.keys(articoliNuovi).sort()
    .map(c => ({ codice: c, descrizione: articoliNuovi[c] }));
  return out;
}

// La POSIZIONE si scrive SEMPRE a 4 cifre con gli zeri davanti (`0010`, non
// `10`). Non e' estetica: fino al 25 ago il database aveva 191 commesse su
// 417 con la forma corta, perche' create prima che la convenzione esistesse
// o digitate a mano, e l'import ci ha sbattuto contro creando 51 doppioni.
// Il confronto adesso e' numerico e regge comunque, ma tenere UNA forma sola
// evita che la prossima cosa che confronta le pos come testo ricaschi li'.
// Quello che non e' un numero da 1 a 4 cifre si lascia com'e': non si
// indovina la forma di qualcosa che non si capisce.
function posNormalizzata(v) {
  const s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return null;
  return /^\d{1,4}$/.test(s) ? s.padStart(4, '0') : s;
}
