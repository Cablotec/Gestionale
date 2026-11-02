// Test di `ripartisciOrdinato` (domain/materiali.js) e `statoMaterialeCommessa`
// (domain/scheduling.js) — 2 nov 2026.
//
// Nico su `30 010 0615_K` in 00385/0050: "perche' mi dice da ordinare al
// terzista? li ho gia' ordinati". Alnus: impegno 550, giacenza 215, OF655 da
// 35, 300 da ordinare. Alla 00385 (250, scade prima) mancano 35 = l'OF655;
// i 300 da ordinare sono delle due 00492.
//
//   node strumenti/test/test-ripartisci-ordinato.js .
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const G = process.argv[2] || '.';
const { ripartisciOrdinato, ripartisciGiacenza } = require(path.resolve(G, 'domain/materiali.js'));
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.resolve(G, 'domain/calendario.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.resolve(G, 'domain/scheduling.js'), 'utf8'), ctx);
const statoMaterialeCommessa = vm.runInContext('statoMaterialeCommessa', ctx);

let ok = 0, ko = 0;
const t = (nome, cond) => { if (cond) { ok++; console.log('  ok   ' + nome); }
  else { ko++; console.log('  KO   ' + nome); } };

const c385 = { id: 'a' }, c492b = { id: 'b' }, c492c = { id: 'c' };
const righe = [{ commessa: c385, qta: 250 }, { commessa: c492b, qta: 100 }, { commessa: c492c, qta: 200 }];
const { esito } = ripartisciGiacenza(righe, 215);
const of655 = [{ qta: 35, data: '2026-12-01', ordine: '2026OF655', fornitore: 'Botturi Simone' }];
const r = ripartisciOrdinato(esito, of655, 0);
t('00385: i 35 che mancano sono tutti ordinati', r.get('a').ordinato === 35);
t('00385: arrivano con OF655 il 1/12', r.get('a').arrivo.ordine === '2026OF655' && r.get('a').arrivo.data === '2026-12-01');
t('00492/0020: niente di ordinato', r.get('b').ordinato === 0 && r.get('b').arrivo === null);
t('00492/0030: niente di ordinato', r.get('c').ordinato === 0);

const m = { codice: '30 010 0615_K', giacenza: 215, impegno: 550, qta_da_ordinare: 300,
  tipo_parte: 'ACQ', consegne: of655 };
const oggi = '2026-11-02';
const s385 = statoMaterialeCommessa(m, { manca: 35, ordinato: 35, arrivo: r.get('a').arrivo }, oggi);
t('00385: in arrivo, non da ordinare', s385.stato === 'in_arrivo' && s385.of === '2026OF655');
t('00492: resta da ordinare', statoMaterialeCommessa(m, { manca: 100, ordinato: 0, arrivo: null }, oggi).stato === 'da_ordinare');
t('coperto solo in parte: resta da ordinare',
  statoMaterialeCommessa(m, { manca: 50, ordinato: 35, arrivo: r.get('a').arrivo }, oggi).stato === 'da_ordinare');
t('consegna gia passata: in ritardo',
  statoMaterialeCommessa(m, { manca: 35, ordinato: 35, arrivo: { data: '2026-10-20', ordine: 'X' } }, oggi).stato === 'in_ritardo');
t('codice gia in arrivo per Alnus: invariato',
  statoMaterialeCommessa(Object.assign({}, m, { qta_da_ordinare: 0 }), { manca: 35, ordinato: 0 }, oggi).stato === 'in_arrivo');

// Due consegne: chi scade prima prende la prima, l'ultima che gli serve da' la data.
const due = [{ qta: 20, data: '2026-12-10', ordine: 'B' }, { qta: 30, data: '2026-11-20', ordine: 'A' }];
const e2 = [{ commessa: { id: 1 }, qta: 40, scoperto: 40 }, { commessa: { id: 2 }, qta: 10, scoperto: 10 }];
const r2 = ripartisciOrdinato(e2, due, 0);
t('consegne in ordine di data: la prima commessa chiude con la seconda consegna',
  r2.get(1).ordinato === 40 && r2.get(1).arrivo.ordine === 'B');
t('la seconda commessa prende il resto', r2.get(2).ordinato === 10);
// Domanda che non vediamo oltre la giacenza: si prende per prima l'arrivo.
const r3 = ripartisciOrdinato(e2, due, 30);
t('riservato oltre la giacenza mangia le prime consegne', r3.get(1).ordinato === 20 && r3.get(2).ordinato === 0);
t('consegne assenti: ordinato 0', ripartisciOrdinato(e2, undefined, 0).get(1).ordinato === 0);

console.log('\n' + ok + ' ok, ' + ko + ' KO');
process.exit(ko ? 1 : 0);
