// Test dei MATERIALI DA DDT — 13 ott 2026, pilota Enviro di Tema.
// Una commessa con `materiali_da_ddt` conta i suoi codici C/L dai carichi
// letti dai DDT (`movimenti_magazzino`), non dalla giacenza di Alnus.
// Uso: node strumenti/test/test-materiali-da-ddt.js [cartella del gestionale]
const G = process.argv[2] || '.';
const M = require(require('path').resolve(G, 'domain/materiali.js'));

let ok = 0, ko = 0;
const sez = t => console.log('\n' + t);
const t = (nome, cond) => { if (cond) { ok++; console.log('  ok   ' + nome); }
  else { ko++; console.log('  KO   ' + nome); } };

sez('La lista della commessa porta il tipo della foglia');
{
  const figliDi = new Map([
    ['PROD', [{ figlio: 'CL-1', qta: 2, tipo: 'C/L' }, { figlio: 'ACQ-1', qta: 1, tipo: 'ACQ' },
              { figlio: 'MAC-1', qta: 5, tipo: 'MAC' }, { figlio: 'SUB', qta: 1, tipo: 'C/L' },
              { figlio: 'NUDO', qta: 1 }]],
    ['SUB', [{ figlio: 'CL-2', qta: 3, tipo: 'c/l' }]],
  ]);
  const e = M.esplodiDistinta('PROD', 15, figliDi);
  t('C/L di primo livello', e.tipi.get('CL-1') && e.tipi.get('CL-1').has('C/L'));
  t('ACQ', e.tipi.get('ACQ-1') && e.tipi.get('ACQ-1').has('ACQ'));
  t('il tipo della foglia dentro un sottoassieme e quello del SUO arco (maiuscolo)',
    e.tipi.get('CL-2') && e.tipi.get('CL-2').has('C/L'));
  t('il sottoassieme non e una foglia: non ha tipo', !e.tipi.has('SUB'));
  t('MAC resta nel consumo, non nei tipi delle foglie', e.consumo.has('MAC-1') && !e.tipi.has('MAC-1'));
  t('riga senza tipo: nessun tipo, come prima', !e.tipi.has('NUDO'));
}

const op = (id, materiali, extra) => Object.assign({ id, stato: 'aperta', scadenza: '2026-10-16',
  materiali_da_ddt: true, materiali }, extra || {});
const car = (codice, qta, numero, data) => ({ codice, qta, tipo: 'carico',
  documento_numero: numero, documento_data: data });

sez('Arrivato e mancante di una commessa');
{
  const a = op('A', [{ codice: 'TS-1', qta: 60, tipo: 'C/L' }, { codice: 'TS-2', qta: 15, tipo: 'C/L' },
    { codice: 'ACQ-1', qta: 10, tipo: 'ACQ' }, { codice: 'MAC-1', qta: 5, tipo: 'MAC' }]);
  const r = M.arriviDaDdt(a, [a], [car('TS-1', 42, '1000003813', '2026-09-14'), car('TS-2', 15, '1000003813', '2026-09-14')]);
  const x = r.get('TS-1');
  t('parziale: 42 su 60, mancano 18', x && x.arrivato === 42 && x.serve === 60 && x.manca === 18);
  t('completo: manca 0', r.get('TS-2').manca === 0);
  t('il DDT viene ricordato', x.documenti.length === 1 && x.documenti[0].numero === '1000003813');
  t('ACQ non si conta dai DDT', !r.has('ACQ-1'));
  t('MAC non si conta dai DDT', !r.has('MAC-1'));
}
{
  const a = op('A', [{ codice: 'TS-1', qta: 15, tipo: 'C/L' }]);
  const r = M.arriviDaDdt(a, [a], []);
  t('niente DDT: manca tutto, nessun documento', r.get('TS-1').manca === 15 && !r.get('TS-1').documenti.length);
}
{
  const a = op('A', [{ codice: 'TS-1', qta: 15, tipo: 'C/L' }]);
  const r = M.arriviDaDdt(a, [a], [car('TS-1', 10, 'D1', '2026-09-14'), car('TS-1', 5, 'D2', '2026-09-20')]);
  t('due DDT si sommano', r.get('TS-1').manca === 0 && r.get('TS-1').arrivato === 15);
  t('i DDT in ordine di data', r.get('TS-1').documenti.map(d => d.numero).join() === 'D1,D2');
}
{
  const a = op('A', [{ codice: 'TS-1', qta: 15, tipo: 'C/L' }]);
  const r = M.arriviDaDdt(a, [a], [car('TS-1', 15, 'D1', '2026-09-14'),
    { codice: 'TS-1', qta: -3, tipo: 'rettifica', documento_numero: null }]);
  t('una rettifica negativa toglie: mancano 3', r.get('TS-1').manca === 3);
}

sez('Scarichi di produzione (14 ott)');
{
  // 00392 da 15 pz: arrivati 60, prodotti 10 pezzi -> scaricati 40.
  // La commessa chiede il residuo (5 pz = 20), sullo scaffale ce ne sono 20.
  const a = op('A', [{ codice: 'TS-1', qta: 20, tipo: 'C/L' }]);   // gia' a residuo
  const mov = [car('TS-1', 60, 'D1', '2026-09-14'),
    { codice: 'TS-1', qta: -40, tipo: 'scarico', documento_numero: '2026/OC/00392/0010', documento_data: '2026-10-14' }];
  const r = M.arriviDaDdt(a, [a], mov).get('TS-1');
  t('scaffale = carichi - scarichi: 20, la commessa a residuo e coperta', r.arrivato === 20 && r.manca === 0);
  t('lo scarico non compare fra i documenti "arrivato con"', r.documenti.length === 1 && r.documenti[0].numero === 'D1');
}
{
  // La sorella da 31 pz non deve vedere il materiale gia montato sulla prima.
  const a = op('A', [{ codice: 'TS-1', qta: 0, tipo: 'C/L' }], { scadenza: '2026-10-16' });   // prodotta tutta
  const b = op('B', [{ codice: 'TS-1', qta: 124, tipo: 'C/L' }], { scadenza: '2026-10-30' });
  const mov = [car('TS-1', 42, 'D1', '2026-09-14'), car('TS-1', 124, 'D2', '2026-09-25'),
    { codice: 'TS-1', qta: -60, tipo: 'scarico', documento_numero: 'x' }];
  t('dopo lo scarico della prima, alla seconda restano 106: mancano 18',
    M.arriviDaDdt(b, [a, b], mov).get('TS-1').manca === 18);
  const senza = mov.slice(0, 2);
  t('SENZA scarico la seconda risulterebbe coperta (il difetto che lo scarico toglie)',
    M.arriviDaDdt(b, [a, b], senza).get('TS-1').manca === 0);
}
{
  const a = op('A', [{ codice: 'TS-1', qta: 15, tipo: 'C/L' }]);
  const mov = [car('TS-1', 15, 'D1', '2026-09-14'),
    { codice: 'TS-1', qta: -15, tipo: 'scarico', documento_numero: 'L', lotto_id: 'l1' },
    { codice: 'TS-1', qta: 15, tipo: 'rettifica', documento_numero: 'L', lotto_id: 'l1' }];
  const r = M.arriviDaDdt(a, [a], mov).get('TS-1');
  t('lotto annullato: la rettifica restituisce, e non e un "documento"', r.manca === 0 && r.documenti.length === 1);
}

sez('Lo stesso DDT non si conta due volte fra due commesse');
{
  const a = op('A', [{ codice: 'TS-1', qta: 15, tipo: 'C/L' }], { scadenza: '2026-10-16' });
  const b = op('B', [{ codice: 'TS-1', qta: 15, tipo: 'C/L' }], { scadenza: '2026-11-30' });
  const mov = [car('TS-1', 20, 'D1', '2026-09-14')];
  const ra = M.arriviDaDdt(a, [a, b], mov), rb = M.arriviDaDdt(b, [a, b], mov);
  t('la prima per scadenza e coperta', ra.get('TS-1').manca === 0);
  t('alla seconda ne restano 5: mancano 10', rb.get('TS-1').arrivato === 5 && rb.get('TS-1').manca === 10);
  const bPrio = Object.assign({}, b, { priorita_ordine: 1 });
  t('la priorita dell ordine passa davanti alla scadenza',
    M.arriviDaDdt(bPrio, [a, bPrio], mov).get('TS-1').manca === 0);
  const c = Object.assign({}, b, { materiali_da_ddt: false });
  t('una commessa SENZA flag non si prende la sua parte',
    M.arriviDaDdt(a, [a, c], [car('TS-1', 15, 'D1', '2026-09-14')]).get('TS-1').manca === 0);
}

console.log('\n' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);
