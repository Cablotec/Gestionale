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

console.log('\nLE MIE (per id utente)');
t("presente", R.riuEDi(az({ responsabili:["u1"] }), "u1"));
t("fra piu persone", R.riuEDi(az({ responsabili:["u1","u2"] }), "u2"));
t("altro id no", !R.riuEDi(az({ responsabili:["u3"] }), "u1"));
t("account senza utente legato no", !R.riuEDi(az({ responsabili:["u1"] }), null));
t("responsabili vuoti no", !R.riuEDi(az({ responsabili:[] }), "u1"));

console.log('\nCONTEGGI E PERSONE');
const c = R.riuConteggi(lista, OGGI);
t("5 aperte, 1 fatta, 1 scaduta, 1 urgente, 1 vicina",
  c.aperte === 5 && c.fatte === 1 && c.scadute === 1 && c.urgenti === 1 && c.vicine === 1, c);
const NOMI = { u1:"Claudio Benini", u2:"Matteo Cavina", u3:"Alessandra Benini" };
const usate = R.riuPersoneUsate([az({ responsabili:["u2"] }), az({ responsabili:["u1","u2"] }),
  az({ responsabili:["u1","u3"] }), az({ responsabili:["u1"] })], id => NOMI[id]);
t("per frequenza, poi per nome", JSON.stringify(usate) === JSON.stringify(["u1","u2","u3"]), usate);

console.log('\n' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);
