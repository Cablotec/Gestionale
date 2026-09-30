// I SALVATAGGI DI UTENTE E CLIENTE — 30 set 2026.
//
// Dall'11 al 30 set salvare un utente (nuovo o modificato) non faceva niente:
// tre righe del flag "materiale fornito dal cliente" erano state incollate nel
// salvataggio dell'UTENTE invece che in quello del CLIENTE. Li' usavano
// variabili che non esistono (`contoLavoroDisponibile`, `isCliente`,
// `chkContoLav`): Salva si fermava con un errore che nessuno vedeva, prima di
// arrivare al database. E nella scheda cliente la spunta non si salvava mai.
// `node --check` non se ne accorge: un nome non dichiarato e' un errore di
// RUNTIME. Questa prova guarda dentro le due funzioni.
//
//   node strumenti/test/test-salvataggi-anagrafiche.js .
const fs = require('fs'), path = require('path');
const G = process.argv[2] || '.';
const src = fs.readFileSync(path.resolve(G, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const corpo = (nome) => {
  const i = src.indexOf('function ' + nome + '(');
  if (i < 0) return null;
  let d = 0; const j = src.indexOf('{', src.indexOf(')', i));
  for (let k = j; ; k++) { if (src[k] == '{') d++; if (src[k] == '}' && --d == 0) return src.slice(i, k + 1); }
};
let ok = 0, ko = 0;
const t = (nome, cond) => { if (cond) { ok++; console.log('  ok   ' + nome); }
  else { ko++; console.log('  KO   ' + nome); } };

const utente = corpo('openOperatoreModal'), cliente = corpo('openClienteModal');
t('le due funzioni esistono', !!utente && !!cliente);
// Nel salvataggio dell'utente non si parla di clienti.
['contoLavoroDisponibile', 'chkContoLav', 'isCliente', 'materiale_dal_cliente'].forEach(n =>
  t('l utente non usa `' + n + '`', !utente.includes(n)));
// Nel cliente la spunta si dichiara E si salva.
t('il cliente dichiara la spunta', cliente.includes("const chkContoLav = el('input'"));
t('e la mette nel salvataggio', cliente.includes('payload.materiale_dal_cliente = isCliente ? chkContoLav.checked : false;'));
t('dopo aver saputo se e un cliente',
  cliente.indexOf('const isCliente = chkCliente.checked;') < cliente.indexOf('payload.materiale_dal_cliente'));

console.log('\n' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);
