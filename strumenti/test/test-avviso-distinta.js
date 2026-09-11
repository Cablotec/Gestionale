// Test dell'AVVISO DISTINTA MANCANTE — 11 set 2026.
// Chiesto da Nico: segnalare negli alert a sinistra degli ordini se manca la
// distinta, tranne Elcotec.
// L'eccezione NON e su Elcotec: e sui clienti che mandano loro il materiale,
// dichiarato in anagrafica. Elcotec e uno di quelli, Senzani un altro (22
// commesse su 22 senza distinta): scrivere "tranne Elcotec" nel codice
// avrebbe acceso 22 falsi allarmi il giorno stesso.
const fs = require('fs'), vm = require('vm'), path = require('path');
const G = process.argv[2] || '.';
const src = fs.readFileSync(path.resolve(G, 'app.js'), 'utf8');

const sandbox = { console, state: {} };
vm.createContext(sandbox);
// Le tre funzioni pure, estratte dal guscio.
['function contoLavoroDichiarato()', 'function materialeDalCliente(', 'function opCampiMancanti('].forEach(m => {
  const i = src.indexOf(m);
  if (i < 0) { console.error('KO: manca ' + m); process.exit(1); }
  vm.runInContext(src.slice(i, src.indexOf('\n}\n', i) + 3), sandbox);
});
// Le dipendenze di opCampiMancanti, ridotte all'osso: qui si prova la regola
// della distinta, non il resto.
vm.runInContext('function opFasiOf(){return[];} function opMinutiEffettivi(o){return o.minuti||1;}'
  + ' function getOperazioneAddetti(){return[{}];} function getOperazioneFornitori(){return[];}'
  + ' function faseAssegnatari(){return{addetti:[],fornitori:[]};}', sandbox);

let ok = 0, ko = 0;
const sez = t => console.log('\n' + t);
const t = (nome, cond) => { if (cond) { ok++; console.log('  ok   ' + nome); }
  else { ko++; console.log('  KO   ' + nome); } };
const avvisi = (op) => sandbox.opCampiMancanti(op);
const haDistinta = (m) => m.some(x => /Distinta di/.test(x));
const OP = { id:'o1', cliente_id:'c1', articolo_id:'a1', scadenza:'2026-01-01', minuti:5 };

sez('PRIMA della migrazione: chi non sa non accusa');
{
  // Nessuna azienda ha la colonna: acceso a meta darebbe 39 falsi allarmi su
  // Elcotec e 22 su Senzani il giorno stesso.
  sandbox.state = { aziende: [{ id:'c1', nome:'Cliente Uno' }],
    articoli: [{ id:'a1', codice:'ART-1', distinta: null }] };
  t('colonna assente: nessun avviso sulla distinta', !haDistinta(avvisi(OP)));
}

sez('DOPO la migrazione');
const conColonna = (materiale_dal_cliente, distinta) => {
  sandbox.state = {
    aziende: [{ id:'c1', nome:'Cliente Uno', materiale_dal_cliente }],
    articoli: [{ id:'a1', codice:'ART-1', distinta }] };
};
{
  conColonna(false, null);
  t('cliente normale senza distinta: avvisa', haDistinta(avvisi(OP)));
  t('e dice quale prodotto', avvisi(OP).some(x => /ART-1/.test(x)));
}
{
  conColonna(false, []);
  // [] vuol dire "dichiarata vuota": il prodotto non ha materiali. E una
  // scelta di qualcuno, non un buco — ma la lista resta vuota lo stesso.
  t('distinta dichiarata vuota: avvisa comunque', haDistinta(avvisi(OP)));
}
{
  conColonna(false, [{ codice:'X', qta:1 }]);
  t('distinta c e: nessun avviso', !haDistinta(avvisi(OP)));
}
{
  conColonna(true, null);
  t('materiale dal cliente: NESSUN avviso', !haDistinta(avvisi(OP)));
}
{
  conColonna(true, [{ codice:'X', qta:1 }]);
  t('materiale dal cliente e distinta presente: comunque zitto', !haDistinta(avvisi(OP)));
}
{
  // Un cliente marcato non deve zittire gli altri.
  sandbox.state = {
    aziende: [{ id:'c1', nome:'Elcotec', materiale_dal_cliente: true },
              { id:'c2', nome:'Sacmi',   materiale_dal_cliente: false }],
    articoli: [{ id:'a1', codice:'ART-1', distinta: null }] };
  t('Elcotec zitto', !haDistinta(avvisi(OP)));
  t('Sacmi avvisa', haDistinta(avvisi(Object.assign({}, OP, { cliente_id:'c2' }))));
}
{
  conColonna(false, null);
  sandbox.state.articoli = [];
  t('prodotto che non esiste: nessun avviso inventato', !haDistinta(avvisi(OP)));
}

console.log('\n' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);
