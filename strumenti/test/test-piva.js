// P.IVA: normalizzaPIva + controllaPIva (27 nov 2026).
//   node strumenti/test/test-piva.js .
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.resolve(process.argv[2] || '.', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const pezzo = (n) => { const i = src.indexOf('function ' + n + '('); return src.slice(i, src.indexOf('\n}\n', i) + 3); };
eval(pezzo('normalizzaPIva') + pezzo('controllaPIva'));
let ok = 0, ko = 0;
const t = (nome, cond) => { if (cond) { ok++; console.log('  ok   ' + nome); } else { ko++; console.log('  KO   ' + nome); } };
t('11 cifre prendono IT', normalizzaPIva(' 0355 2340279 ') === 'IT03552340279');
t('minuscole e spazi', normalizzaPIva('it 03552340279') === 'IT03552340279');
t('vuoto = null', normalizzaPIva('  ') === null);
t('P.IVA vera valida (00743110157)', controllaPIva('00743110157').ok);
t('P.IVA vera valida con IT (IT12345678903)', controllaPIva('IT12345678903').ok);
t('refuso respinto (00743110158)', !controllaPIva('00743110158').ok && /controllo/.test(controllaPIva('00743110158').msg));
t('10 cifre respinte', !controllaPIva('0074311015').ok);
t('IT con lettere respinta', !controllaPIva('IT0074311015A').ok);
t('tedesca accettata', controllaPIva('DE123456789').tipo === 'estera' && controllaPIva('DE123456789').ok);
t('austriaca accettata', controllaPIva('ATU12345678').ok);
t('svizzera accettata', controllaPIva('CHE-123.456.789'.replace(/[-.]/g, '')).ok);
t('codice fiscale accettato', controllaPIva('RSSMRA80A01H501U').tipo === 'cf');
t('vuota non ok', !controllaPIva('').ok && controllaPIva('').tipo === null);
t('roba a caso respinta', !controllaPIva('ciao!').ok);
console.log('\n' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);
