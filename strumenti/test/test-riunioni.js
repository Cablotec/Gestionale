// Regole della scheda Riunioni (domain/riunioni.js) — 14 ott 2026.
//   node strumenti/test/test-riunioni.js .
const path = require('path');
const G = process.argv[2] || '.';
const R = require(path.resolve(G, 'domain/riunioni.js'));

let ok = 0, ko = 0;
const t = (nome, cond, extra) => {
  if (cond) { ok++; console.log('  ok   ' + nome); }
  else { ko++; console.log('  KO   ' + nome + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};
const OGGI = '2026-10-14';
const az = (o) => Object.assign({ id: 1, riunione_id: 1, ordine: 0, stato: 'aperta', urgente: false,
  scadenza: null, responsabili: [] }, o);

console.log('\nCONDIZIONE');
t('fatta batte la scadenza passata', R.riuCondizione(az({ stato:'fatta', scadenza:'2026-10-01' }), OGGI) === 'fatta');
t('annullata', R.riuCondizione(az({ stato:'annullata' }), OGGI) === 'annullata');
t('scadenza ieri = scaduta', R.riuCondizione(az({ scadenza:'2026-10-13' }), OGGI) === 'scaduta');
t('scaduta batte urgente', R.riuCondizione(az({ scadenza:'2026-10-13', urgente:true }), OGGI) === 'scaduta');
t('scadenza oggi = vicina (non scaduta)', R.riuCondizione(az({ scadenza:'2026-10-14' }), OGGI) === 'vicina');
t('fra 3 giorni = vicina', R.riuCondizione(az({ scadenza:'2026-10-17' }), OGGI) === 'vicina');
t('fra 4 giorni = ok', R.riuCondizione(az({ scadenza:'2026-10-18' }), OGGI) === 'ok');
t('urgente con data lontana = urgente', R.riuCondizione(az({ scadenza:'2026-11-30', urgente:true }), OGGI) === 'urgente');
t('URGENTE senza data = urgente', R.riuCondizione(az({ urgente:true }), OGGI) === 'urgente');
t('senza data ne urgenza = senza', R.riuCondizione(az({}), OGGI) === 'senza');
t('cambio ora (25 ott) non sposta i giorni', R.riuGiorniFra('2026-10-24', '2026-10-26') === 2);

console.log('\nORDINE "DA FARE"');
const lista = [
  az({ id:1, stato:'fatta' }),
  az({ id:2 }),
  az({ id:3, scadenza:'2026-11-30' }),
  az({ id:4, urgente:true }),
  az({ id:5, scadenza:'2026-10-10' }),
  az({ id:6, scadenza:'2026-10-15' }),
];
const ord = R.riuOrdinaDaFare(lista, OGGI).map(a => a.id);
t('scadute, urgenti, vicine, con data, senza, fatte', JSON.stringify(ord) === '[5,4,6,3,2,1]', ord);
t('non tocca la lista originale', lista[0].id === 1);

console.log('\nRESPONSABILI DAL TESTO');
const d = (s) => JSON.stringify(R.riuResponsabiliDaTesto(s));
t('Claudio/Cocco/Alessandra', d('Claudio/Cocco/Alessandra') === '["Claudio","Cocco","Alessandra"]', d('Claudio/Cocco/Alessandra'));
t('virgole, punto e virgola, "e"', d('Claudio, Matteo; Paola e Fabrizio') === '["Claudio","Matteo","Paola","Fabrizio"]');
t('doppioni con maiuscole diverse: vince il primo', d('Claudio / claudio / CLAUDIO') === '["Claudio"]');
t('spazi compattati', d('  Massimo   Contoli / ') === '["Massimo Contoli"]');
t('"e" dentro un nome non spezza', d('Daniele') === '["Daniele"]');
t('vuoto', d('') === '[]' && d(null) === '[]');

console.log('\nLE MIE');
t('nome di battesimo', R.riuEDi(az({ responsabili:['Claudio'] }), 'Claudio Benini'));
t('nome completo, maiuscole', R.riuEDi(az({ responsabili:['claudio benini'] }), 'Claudio Benini'));
t('fra piu nomi', R.riuEDi(az({ responsabili:['Claudio','Matteo'] }), 'Matteo Cavina'));
t('altro nome no', !R.riuEDi(az({ responsabili:['Fabrizio'] }), 'Claudio Benini'));
t('profilo senza nome no', !R.riuEDi(az({ responsabili:['Claudio'] }), ''));

console.log('\nCONTEGGI E NOMI');
const c = R.riuConteggi(lista, OGGI);
t('5 aperte, 1 fatta, 1 scaduta, 1 urgente, 1 vicina',
  c.aperte === 5 && c.fatte === 1 && c.scadute === 1 && c.urgenti === 1 && c.vicine === 1, c);
const nomi = R.riuNomiUsati([az({ responsabili:['Matteo'] }), az({ responsabili:['Claudio','Matteo'] }), az({ responsabili:['Claudio'] }), az({ responsabili:['Claudio'] })]);
t('per frequenza', JSON.stringify(nomi) === '["Claudio","Matteo"]', nomi);

console.log('\n' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);
