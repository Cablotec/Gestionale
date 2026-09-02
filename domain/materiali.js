// ═══════════════════════════════════════════════════════════════════
// MOTORE MATERIALI — esplosione della distinta e ripartizione della
// giacenza. PURO: niente DOM, niente Supabase, niente `state`.
//
// ⚠ NON e ancora agganciato ai gusci HTML: lo usa solo
// `strumenti/prova-fabbisogno.js`. Si aggiunge lo <script> quando una
// scheda comincera a usarlo davvero — prima si verificano i numeri.
//
// Le tre funzioni rispondono a tre domande diverse, e vanno tenute
// distinte perche sbagliano in modi diversi:
//   esplodiDistinta   -> di questo articolo, quali materiali servono?
//   fabbisognoPerCodice -> di questo materiale, CHI ne vuole e quanto?
//   ripartisciGiacenza  -> a chi tocca quello che c e?
// ═══════════════════════════════════════════════════════════════════

// Profondita massima dell esplosione. Sul file del 2 set il piu profondo
// arriva a 3 livelli e i cicli sono zero, ma la guardia resta: una distinta
// modificata domani puo chiudersi ad anello, e senza guardia il calcolo non
// darebbe un numero sbagliato — girerebbe per sempre.
const DISTINTA_PROFONDITA_MAX = 20;

// Esplode `codice` per `qta` pezzi, scendendo tutta la distinta.
// `figliDi`: Map codice -> [{ figlio, qta }].
// Ritorna { materiali: Map codice->qta, cicli: Set, tagliati: n }.
//
// ⚠ Le FOGLIE sono il risultato: un codice senza figli e un materiale vero
// da comprare o prelevare. E quello che rende corretto trattare i codici di
// LAVORAZIONE (`_K`, `_KF`: "va ordinata a Botturi") come foglie invece che
// come distinte mancanti — non hanno figli perche non devono averne.
function esplodiDistinta(codice, qta, figliDi, acc) {
  const out = acc || { materiali: new Map(), cicli: new Set(), tagliati: 0 };
  scendi(codice, Number(qta) || 0, new Set(), 0);
  return out;

  function scendi(cod, q, inCammino, prof) {
    if (!cod || !(q > 0)) return;
    if (prof > DISTINTA_PROFONDITA_MAX) { out.tagliati++; return; }
    const figli = figliDi.get(cod);
    if (!figli || !figli.length) {
      out.materiali.set(cod, (out.materiali.get(cod) || 0) + q);
      return;
    }
    // Il ciclo si riconosce sul CAMMINO, non sui codici gia visti in
    // assoluto: lo stesso sottoassieme puo comparire sotto due padri
    // diversi senza che sia un anello — e succede, e legittimo.
    if (inCammino.has(cod)) { out.cicli.add(cod); return; }
    inCammino.add(cod);
    figli.forEach(f => scendi(f.figlio, q * (Number(f.qta) || 0), inCammino, prof + 1));
    inCammino.delete(cod);
  }
}

// Ribalta la domanda: per ogni materiale, l elenco di CHI lo vuole.
// `commesse`: [{ id, numero_op, codiceArticolo, quantita, scadenza, ... }].
// Ritorna Map codice -> [{ commessa, qta }], ogni elenco ordinato per
// scadenza (chi scade prima viene prima).
//
// ⚠ E QUI sta la differenza con Alnus. La sua estrazione attribuisce un
// mancante a UNA commessa sola — quella del "prossimo impegno" — e le altre
// che vogliono lo stesso codice risultano pulite. Qui il codice sa di tutte,
// perche la domanda si costruisce dalle commesse e non dal magazzino.
function fabbisognoPerCodice(commesse, figliDi) {
  const perCodice = new Map();
  (commesse || []).forEach(c => {
    if (!c || !c.codiceArticolo) return;
    const e = esplodiDistinta(c.codiceArticolo, c.quantita, figliDi);
    e.materiali.forEach((q, cod) => {
      if (!perCodice.has(cod)) perCodice.set(cod, []);
      perCodice.get(cod).push({ commessa: c, qta: q });
    });
  });
  const senzaData = '9999-12-31';
  perCodice.forEach(righe => righe.sort((a, b) =>
    String(a.commessa.scadenza || senzaData).localeCompare(String(b.commessa.scadenza || senzaData))));
  return perCodice;
}

// Ripartisce quello che c e fra chi lo vuole, in ordine di scadenza.
// `righe`: [{ commessa, qta }] gia ordinate. `disponibile`: numero.
// Ritorna [{ commessa, qta, coperto, scoperto }] piu il residuo.
//
// La regola e dichiarata, non implicita: **chi scade prima serve prima**.
// Una regola qualunque, purche scritta, batte l attribuzione silenziosa a
// una commessa sola — perche si puo discutere e cambiare, e soprattutto
// perche ogni commessa vede la SUA copertura invece di ereditare quella
// della sorella.
function ripartisciGiacenza(righe, disponibile) {
  let resta = Number(disponibile) || 0;
  const esito = (righe || []).map(r => {
    const vuole = Number(r.qta) || 0;
    const coperto = Math.min(vuole, Math.max(0, resta));
    resta -= coperto;
    return { commessa: r.commessa, qta: vuole, coperto, scoperto: +(vuole - coperto).toFixed(4) };
  });
  return { esito, residuo: Math.max(0, resta) };
}

// Comodo per i chiamanti: da righe di `distinta` a Map padre -> figli.
function indiceDistinta(righe) {
  const m = new Map();
  (righe || []).forEach(r => {
    if (!r || !r.padre) return;
    if (!m.has(r.padre)) m.set(r.padre, []);
    m.get(r.padre).push({ figlio: r.figlio, qta: r.qta, um: r.um, tipo_parte: r.tipo_parte });
  });
  return m;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DISTINTA_PROFONDITA_MAX, esplodiDistinta, fabbisognoPerCodice,
    ripartisciGiacenza, indiceDistinta };
}
