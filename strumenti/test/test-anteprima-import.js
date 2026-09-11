// SMOKE TEST dell anteprima import ordini.
//
// Nasce da un difetto vero (9 set): l anteprima usava `fmtE`, definita quattro
// volte DENTRO altre schede e mai al livello del file. Risultato: "Errore
// lettura file: fmtE is not defined", e l import non si apriva piu.
// `node --check` non lo vedeva (la sintassi era giusta), i test sul motore
// nemmeno (il motore stava bene), il caricamento in browser neanche — quel
// codice gira solo quando si apre davvero l anteprima.
//
// Quindi qui l anteprima si APRE per davvero, con un DOM finto, e si accende
// OGNI sezione. Non verifica come e fatta la schermata: verifica che ci sia.
const fs = require('fs'), vm = require('vm'), path = require('path');
const G = process.argv[2] || '.';
const src = fs.readFileSync(path.resolve(G, 'app.js'), 'utf8').replace(/\r\n/g, '\n');

// La funzione dell anteprima, estratta dal guscio: app.js intero fuori dal
// browser non si carica (Supabase, listener, DOM vero).
const inizio = src.indexOf('function openOperazioniImportPreviewModal(rows) {');
if (inizio < 0) { console.error('KO: funzione non trovata'); process.exit(1); }
const fine = src.indexOf('\n}\n', inizio) + 3;
const fnSrc = src.slice(inizio, fine);

// Un elemento finto: tiene figli e testo, quanto basta per accorgersi che una
// riga e stata costruita senza esplodere.
const el = (tag, attrs, ...figli) => {
  // `childNodes` col nome vero: l anteprima lo interroga per sapere se una
  // sezione ha prodotto qualcosa. Un finto elemento che non ce l ha fa cadere
  // il test per il motivo sbagliato.
  const n = { tag, attrs: attrs || {}, childNodes: [], testo: '' };
  n.figli = n.childNodes;
  n.append = (...x) => { x.forEach(y => { if (y == null) return;
    n.childNodes.push(y);
    n.testo += (typeof y === 'string' ? y : (y.testo || '')); }); return n; };
  n.prepend = (...x) => { n.childNodes.unshift(...x.filter(y => y != null)); return n; };
  n.querySelector = () => null;
  n.addEventListener = () => {};
  n.append(...figli);
  return n;
};

const sandbox = {
  console, el,
  state: { articoli: [], aziende: [], operazioni: [], spedizioni: [], profile: { ruolo: 'admin' } },
  closeModal(){}, openModal(m){ sandbox._modal = m; }, toast(){},
  document: { createTextNode: (t) => ({ tag:'#text', testo: String(t), figli: [] }) },
};
vm.createContext(sandbox);
// Il motore vero: il piano non e finto, lo calcola `analizzaImportOrdini`.
vm.runInContext(fs.readFileSync(path.resolve(G, 'domain/scheduling.js'), 'utf8').replace(/\r\n/g, '\n'), sandbox);
// I formattatori veri, presi dal file: se uno sparisse, il test cade.
['const z =', 'const parseISODate', 'const fmtIT', 'const fmtE'].forEach(m => {
  const i = src.indexOf(m);
  if (i < 0) { console.error('KO: manca ' + m); process.exit(1); }
  vm.runInContext(src.slice(i, src.indexOf('\n', src.indexOf(';', i))), sandbox);
});
vm.runInContext(fnSrc, sandbox);

let ok = 0, ko = 0;
const t = (nome, fn) => {
  try { fn(); ok++; console.log('  ok   ' + nome); }
  catch (e) { ko++; console.log('  KO   ' + nome + '  ->  ' + ((e && e.message) || e));
    if (process.env.TRACCIA) console.log(String((e && e.stack) || '').split('\n').slice(0, 5).join('\n')); }
};

// Riga tipo dell estrazione, come nel file vero (intestazioni con lo spazio).
const R = (o) => Object.assign({
  'Eser ': '2026', 'Sz Cl ': 'OC', 'Ord/Off Cliente ': '400', 'Riga ': '10',
  'Codice Articolo ': 'ART-1', 'Descrizione Articolo ': 'Descrizione',
  'Data Rich. Evasione ': 46000, 'Quantita UMI Ordine/Offerta ': 3,
  'Ragione Sociale ': 'Cliente Uno', 'Riferimento Cliente ': '',
  'Riferimento Cliente _1': 'RIF-1', 'Prezzo Netto Riga ': 10, 'Impon. Totale Riga ': 30,
}, o);
const apri = (righe) => sandbox.openOperazioniImportPreviewModal(righe);
const conStato = (op, art, azi) => {
  sandbox.state.articoli   = art || [{ id:'a1', codice:'ART-1', minuti_unitari: 42 }];
  sandbox.state.aziende    = azi || [{ id:'c1', nome:'Cliente Uno', tariffa_cliente: 27.3 }];
  sandbox.state.operazioni = op || [];
  sandbox.state.spedizioni = [];
};
const OP = (o) => Object.assign({
  id:'o1', numero_ordine:'2026/OC/00400', pos:'0010', articolo_id:'a1', cliente_id:'c1',
  quantita: 3, scadenza:'2025-12-09', prezzo_unitario: 10, riferimento_cliente:'RIF-1',
  stato:'aperta', created_at:'2026-01-01' }, o);

console.log('\nL ANTEPRIMA SI APRE');
t('file vuoto: non esplode', () => { conStato([]); apri([]); });
t('file che non e un estrazione ordini', () => apri([{ 'Pippo ': 1, 'Pluto ': 2 }]));
t('solo commesse nuove', () => { conStato([]); apri([R({})]); });

console.log('\nOGNI SEZIONE, ACCESA UNA PER UNA');
t('aggiornamenti (quantita diversa)', () => { conStato([OP({ quantita: 99 })]); apri([R({})]); });
t('PREZZI discordanti (sezione del 9 set)', () => { conStato([OP({ prezzo_unitario: 7 })]); apri([R({})]); });
t('SCADENZE discordanti', () => { conStato([OP({ scadenza:'2026-06-01' })]); apri([R({})]); });
t('PREZZI fuori storico (commessa nuova)', () => {
  conStato([OP({ id:'vecchia', numero_ordine:'2026/OC/00100', prezzo_unitario: 8,
    stato:'spedita', created_at:'2026-05-01T10:00:00Z' })]); apri([R({})]); });
t('residui discordanti', () => { conStato([OP({})]); apri([R({ 'Quantita Residua ': 99 })]); });
t('cliente e articolo da creare', () => { conStato([], [], []);
  apri([R({ 'Ragione Sociale ':'Ditta Nuova', 'Codice Articolo ':'ART-MAI-VISTO' })]); });
t('commessa chiusa: non si tocca', () => { conStato([OP({ quantita: 99, stato:'spedita' })]); apri([R({})]); });
t('rinomina cliente scritto diversamente', () => {
  conStato([], null, [{ id:'c1', nome:'CLIENTE UNO S.R.L.' }]);
  apri([R({ 'Ragione Sociale ':'Cliente Uno S.r.l.' })]); });
t('fusione BOX di Senzani', () => {
  conStato([], [{ id:'abox', codice:'BOX_EL000999' }], [{ id:'csz', nome:'Senzani Brevetti S.p.a.' }]);
  apri([R({ 'Ragione Sociale ':'SENZANI BREVETTI S.p.a.', 'Riferimento Cliente _1':'EL000999' }),
        R({ 'Ragione Sociale ':'SENZANI BREVETTI S.p.a.', 'Riferimento Cliente _1':'EL000999', 'Riga ':'20' })]); });
t('righe scartate: OD e senza codice', () => { conStato([]);
  apri([R({ 'Sz Cl ':'OD' }), R({ 'Codice Articolo ':'', 'Riga ':'20' })]); });

console.log('\n' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);
