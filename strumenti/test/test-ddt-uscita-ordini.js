// Test del DDT IN USCITA DAGLI ORDINI (28 nov 2026). Le due decisioni di Nico:
// sugli OC solo i pronti; sugli OD tutto il residuo, il lotto lo fa la spedizione.
const fs = require('fs'), vm = require('vm');
const G = process.argv[2] || '.';
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(G + '/domain/scheduling.js', 'utf8').replace(/\r\n/g, '\n'), sandbox);
const { righeOrdiniDaSpedire: righe, controllaRigaDdtOrdine: controlla, ordineDaSpedireOD: od } = sandbox;

let ok = 0, ko = 0;
const t = (nome, cond) => { if (cond) { ok++; console.log('  ok   ' + nome); } else { ko++; console.log('  KO   ' + nome); } };

const ops = [
  { id: 'a', cliente_id: 'JMA', numero_ordine: '2026/OD/00072', pos: '0010', quantita: 42, stato: 'aperta' },
  { id: 'b', cliente_id: 'JMA', numero_ordine: '2026/OD/00066', pos: '0080', quantita: 46, stato: 'aperta' },
  { id: 'c', cliente_id: 'JMA', numero_ordine: '2026/OC/00385', pos: '0100', quantita: 150, stato: 'aperta' },
  { id: 'd', cliente_id: 'JMA', numero_ordine: '2026/OC/00385', pos: '0020', quantita: 10, stato: 'aperta' },
  { id: 'e', cliente_id: 'JMA', numero_ordine: '2026/OD/00001', pos: '0010', quantita: 4, stato: 'spedita' },
  { id: 'f', cliente_id: 'ALTRO', numero_ordine: '2026/OD/00009', pos: '0010', quantita: 6, stato: 'aperta' },
  { id: 'g', cliente_id: 'JMA', numero_ordine: '2026/OD/00072', pos: '0070', quantita: 7, stato: 'aperta' },
];
const prod = { a: 0, b: 10, c: 100, d: 0, e: 4, f: 0, g: 7 };
const sped = { a: 0, b: 10, c: 40, d: 0, e: 4, f: 0, g: 7 };
const R = righe(ops, 'JMA', id => prod[id], id => sped[id]);
const per = id => R.find(r => r.op.id === id);

console.log('\nquali righe propone');
t('OD con residuo e niente prodotto: c\'e\'', !!per('a'));
t('OD: max = residuo (42)', per('a').max === 42 && per('a').od);
t('OD gia\' in parte spedito: residuo 36', per('b').residuo === 36 && per('b').pronti === 0);
t('OC con pronti: max = pronti (60)', per('c').max === 60 && !per('c').od);
t('OC senza pronti: non c\'e\'', !per('d'));
t('commessa spedita: non c\'e\'', !per('e'));
t('altro cliente: non c\'e\'', !per('f'));
t('OD tutto spedito: non c\'e\'', !per('g'));
t('ordinate per ordine e posizione', R.map(r => r.op.id).join() === 'c,b,a');
t('senza cliente: niente', righe(ops, '', () => 0, () => 0).length === 0);

console.log('\nil controllo dei pezzi');
t('vuota = non usata', controlla(per('a'), '').pezzi === 0 && !controlla(per('a'), '').errore);
t('OD 15 su 0 prodotti: lotto 15', controlla(per('a'), '15').lotto === 15 && !controlla(per('a'), '15').errore);
t('OD oltre il residuo: errore', /da spedire 42/.test(controlla(per('a'), '43').errore));
t('OC entro i pronti: niente lotto', controlla(per('c'), '60').lotto === 0 && !controlla(per('c'), '60').errore);
t('OC oltre i pronti: bloccata', /prima la produzione/.test(controlla(per('c'), '61').errore));
t('decimali rifiutati', !!controlla(per('a'), '1,5').errore);
t('zero rifiutato', !!controlla(per('a'), '0').errore);
const parz = { od: true, residuo: 20, pronti: 5 };
t('OD con 5 pronti, spedisco 8: lotto 3', controlla(parz, '8').lotto === 3);
t('OD con 5 pronti, spedisco 4: niente lotto', controlla(parz, '4').lotto === 0);

console.log('\nOD dal numero');
t('/OD/ riconosciuto', od('2026/OD/00072') && od('2026/od/1'));
t('OC non e\' OD', !od('2026/OC/00072') && !od(null));

console.log('\nmatricole incollate da Excel');
const mt = sandbox.matricoleDaTesto;
t('colonna di Excel (a capo Windows)', mt('1062686022\r\n1062686023\r\n').join() === '1062686022,1062686023');
t('spazi e righe vuote tolti', mt('  1063145001 \n\n\n').join() === '1063145001');
t('tab e punto e virgola separano', mt('A1\tA2;A3').length === 3);
t('doppioni scartati, ordine tenuto', mt('B\nA\nB').join() === 'B,A');
t('vuoto = nessuna', mt('').length === 0 && mt(null).length === 0);

console.log('\n' + ok + ' ok, ' + ko + ' KO');
process.exit(ko ? 1 : 0);
