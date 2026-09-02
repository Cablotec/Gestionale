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

// ── SEGNAPOSTO: righe di distinta che non sono materiali ───────────
// `COMP GENERICO` compare in 3.409 distinte, `VARIE` in 404, nessuno dei due
// e mai un padre e tutti e due sono in `nr`: sono riempitivi che il
// progettista mette dove il dettaglio non serve, non pezzi da comprare.
// Sommarli produceva il primo posto della classifica dei fabbisogni con un
// numero che non vuole dire niente (27.577 di "COMP GENERICO" contro i 21
// che ne dichiara Alnus).
// ⚠ Si escludono QUI, al calcolo, e non all'import: a database le righe
// restano come stanno nel file. Un dato non si cancella perche non lo si sa
// usare — si cancella la pretesa di usarlo.
// Aggiungerne uno: basta scriverlo in questa lista.
const MATERIALI_SEGNAPOSTO = ['COMP GENERICO', 'VARIE'];
const _segnaposto = new Set(MATERIALI_SEGNAPOSTO.map(c => c.toUpperCase()));
function eSegnaposto(codice) {
  return _segnaposto.has(String(codice == null ? '' : codice).trim().toUpperCase());
}

// I codici che finiscono in `_K` / `_KF` sono LAVORAZIONI, non pezzi da
// magazzino: `30 010 0510_K` e "Lavorazione Botturi", il promemoria che quella
// lavorazione va ordinata a un terzista (detto da Nico, 2 set). Non hanno
// sottodistinta e non devono averla — nell'esplosione sono foglie.
// Vanno mostrate a parte: mescolarle ai materiali fa cercare in magazzino una
// cosa che si ordina, e il gesto per rimediare e completamente diverso.
function eLavorazione(codice) {
  return /_K[A-Z]?$/i.test(String(codice == null ? '' : codice).trim());
}

// Esplode `codice` per `qta` pezzi, scendendo tutta la distinta.
// `figliDi`: Map codice -> [{ figlio, qta }].
// Ritorna { materiali: Map codice->qta, cicli: Set, tagliati: n }.
//
// ⚠ Le FOGLIE sono il risultato: un codice senza figli e un materiale vero
// da comprare o prelevare. E quello che rende corretto trattare i codici di
// LAVORAZIONE (`_K`, `_KF`: "va ordinata a Botturi") come foglie invece che
// come distinte mancanti — non hanno figli perche non devono averne.
function esplodiDistinta(codice, qta, figliDi, acc) {
  const out = acc || { materiali: new Map(), segnaposto: new Map(), cicli: new Set(), tagliati: 0 };
  scendi(codice, Number(qta) || 0, new Set(), 0);
  return out;

  function scendi(cod, q, inCammino, prof) {
    if (!cod || !(q > 0)) return;
    if (prof > DISTINTA_PROFONDITA_MAX) { out.tagliati++; return; }
    const figli = figliDi.get(cod);
    if (!figli || !figli.length) {
      // Il segnaposto si ferma qui: non e un materiale, non diventa
      // fabbisogno. Si conta a parte, cosi non sparisce in silenzio.
      if (eSegnaposto(cod)) { out.segnaposto.set(cod, (out.segnaposto.get(cod) || 0) + q); return; }
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

// ⚠⚠ LA GIACENZA NON E TUTTA NOSTRA DA DISTRIBUIRE (2 set, chiesto da Nico:
// *"stai tenendo conto anche degli impegni giusto?"*).
// Alnus dichiara per ogni codice un `impegno`: quanto ne e gia promesso a
// qualcuno. Noi la domanda ce la calcoliamo dalle commesse VIVE NEL
// GESTIONALE. Se il suo impegno e piu grande della nostra domanda, la
// differenza e domanda che NON VEDIAMO — commesse chiuse qui e aperte la,
// ordini che non passano da noi, scorte gia promesse — e quella parte di
// magazzino e gia parlata.
// Distribuirla lo stesso vorrebbe dire dire a una commessa che e coperta
// mentre il pezzo e destinato a un altro: l'errore piu caro di tutti, perche
// si scopre in linea.
// Quando invece la nostra domanda e >= al suo impegno, non c'e niente di
// nascosto e la giacenza e tutta disponibile.
function disponibilePerNoi(giacenza, impegnoAlnus, nostraDomanda) {
  const g = Number(giacenza) || 0;
  const imp = Number(impegnoAlnus) || 0;
  const nostra = Number(nostraDomanda) || 0;
  const riservato = Math.max(0, imp - nostra);
  return { disponibile: Math.max(0, g - riservato), riservato };
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

// Le distinte scritte a mano nella scheda articolo VINCONO su quelle di
// Alnus, e vincono PER INTERO: si sostituisce l'elenco dei figli di quel
// padre, non si fondono i due. Una distinta meta' da una parte e meta'
// dall'altra darebbe un fabbisogno che nessuno riesce piu' a spiegare.
// `articoli`: [{ codice, distinta:[{codice,qta,um}] }].
function applicaDistinteLocali(figliDi, articoli) {
  const locali = new Set();
  (articoli || []).forEach(a => {
    const d = a && a.distinta;
    if (!a || !a.codice || !Array.isArray(d) || !d.length) return;
    figliDi.set(a.codice, d
      .filter(r => r && r.codice)
      .map(r => ({ figlio: String(r.codice).trim(), qta: Number(r.qta) || 0, um: r.um || null })));
    locali.add(a.codice);
  });
  return locali;
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
  module.exports = { DISTINTA_PROFONDITA_MAX, MATERIALI_SEGNAPOSTO, eSegnaposto,
    esplodiDistinta, fabbisognoPerCodice, ripartisciGiacenza, indiceDistinta,
    applicaDistinteLocali, disponibilePerNoi, eLavorazione };
}
