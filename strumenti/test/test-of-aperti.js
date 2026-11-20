// Test degli OF D'ACQUISTO APERTI — 20 nov 2026 (OF massivi).
// Il «da ordinare» di Alnus non sa degli OF fatti nel gestionale: si toglie
// quanto e' negli OF emessi e non ancora arrivato.
// Uso: node strumenti/test/test-of-aperti.js [cartella del gestionale]
const G = process.argv[2] || '.';
const M = require(require('path').resolve(G, 'domain/materiali.js'));

let ok = 0, ko = 0;
const sez = t => console.log('\n' + t);
const t = (nome, cond) => { if (cond) { ok++; console.log('  ok   ' + nome); }
  else { ko++; console.log('  KO   ' + nome); } };

sez('Il numero d\'ordine scritto sul DDT');
t('OFS 3/2026', M.chiaveOfDaRif('OFS 3/2026') === '2026/3');
t('of 12 / 2026 (minuscole, spazi)', M.chiaveOfDaRif('of 12 / 2026') === '2026/12');
t('OFS n. 7/2026', M.chiaveOfDaRif('OFS n. 7/2026') === '2026/7');
t('ordine cliente 4700000482: niente', M.chiaveOfDaRif('4700000482') === null);
t('2026/OC/00392: niente', M.chiaveOfDaRif('2026/OC/00392') === null);
t('vuoto: niente', M.chiaveOfDaRif(null) === null);

const ordini = [
  { id: 'a', tipo: 'acquisto', stato: 'emesso', anno: 2026, numero: 3,
    righe: [{ codice: 'fast-1', qta: 100 }, { codice: 'CAVO', qta: 50 }, { codice: 'FAST-1', qta: 20 }] },
  { id: 'b', tipo: 'acquisto', stato: 'emesso', anno: 2026, numero: 5, righe: [{ codice: 'CAVO', qta: 30 }] },
  { id: 'c', tipo: 'acquisto', stato: 'annullato', anno: 2026, numero: 4, righe: [{ codice: 'CAVO', qta: 999 }] },
  { id: 'd', tipo: 'terzista', stato: 'emesso', anno: 2026, numero: 6, righe: [{ operazione_id: 'x', pezzi: 10 }] },
];
const mov = [
  { tipo: 'carico', codice: 'CAVO', qta: 20, ordine_rif: 'OFS 3/2026' },
  { tipo: 'carico', codice: 'CAVO', qta: 40, ordine_rif: 'OFS 5/2026' },   // oltre l'ordinato
  { tipo: 'carico', codice: 'FAST-1', qta: 10, ordine_rif: 'OFS 5/2026' }, // codice non in quell'ordine
  { tipo: 'scarico', codice: 'FAST-1', qta: 5, ordine_rif: 'OFS 3/2026' },
  { tipo: 'carico', codice: 'FAST-1', qta: 7, ordine_rif: '4700000482' },
];

sez('Aperto = emesso − arrivato, per ordine e codice');
{
  const a = M.ordinatoApertoOf(ordini, mov);
  t('FAST-1: due righe dello stesso ordine sommate, maiuscole', a.get('FAST-1') && a.get('FAST-1').aperto === 120);
  t('FAST-1: un DDT di un altro ordine o di un cliente non conta', a.get('FAST-1').ordini[0].arrivato === 0);
  t('CAVO: 50−20 sul 3 + 0 sul 5 (arrivato oltre) = 30', a.get('CAVO') && a.get('CAVO').aperto === 30);
  t('CAVO: due ordini elencati', a.get('CAVO').ordini.length === 2);
  t('annullati e terzisti non contano', a.size === 2);
}

sez('Movimenti non letti: si toglie l\'ordine intero');
{
  const a = M.ordinatoApertoOf(ordini, null);
  t('CAVO 80', a.get('CAVO').aperto === 80);
}

sez('L\'ordine che si sta modificando non toglie se stesso');
{
  const a = M.ordinatoApertoOf(ordini, mov, 'a');
  t('FAST-1 sparisce', !a.has('FAST-1'));
  t('CAVO resta solo il 5, tutto arrivato', a.get('CAVO').aperto === 0);
}

console.log('\n' + ok + ' ok, ' + ko + ' KO');
process.exit(ko ? 1 : 0);
