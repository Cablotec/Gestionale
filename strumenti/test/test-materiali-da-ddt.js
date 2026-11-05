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

sez('Giacenze del gestionale nella scheda Materiali (14 ott)');
{
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const sb = { state: { sessioni: [], mancanti: [], operazioni: [] }, console };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.resolve(G, 'domain/scheduling.js'), 'utf8').replace(/\r\n/g, '\n'), sb);
  const a = op('A', [{ codice: 'TS-1', qta: 60, tipo: 'C/L', descrizione: 'Samtec', um: 'PZ' },
    { codice: 'TS-2', qta: 15, tipo: 'C/L' }, { codice: 'ACQ-1', qta: 9, tipo: 'ACQ' }]);
  const b = op('B', [{ codice: 'TS-1', qta: 124, tipo: 'C/L' }]);
  const mov = [car('TS-1', 166, 'D1', '2026-09-14'), car('TS-2', 15, 'D1', '2026-09-14'),
    car('TS-9', 4, 'D1', '2026-09-14'), { codice: 'TS-2', qta: -5, tipo: 'scarico' }];
  const r = new Map(M.righeGiacenzaGestionale(mov, [a, b]).map(x => [x.codice, x]));
  const t1 = r.get('TS-1');
  t('giacenza = somma dei movimenti, impegno = somma delle commesse', t1.giacenza === 166 && t1.impegno === 184);
  t('manca la differenza: 18', t1.qta_da_ordinare === 18 && t1.qta_richiesta === 18);
  t('la categoria della scheda e "attesa cliente"', sb.mancanteCategoria(t1) === 'attesa_cliente');
  t('descrizione e UM dalla lista quando i movimenti non le hanno', t1.um === 'PZ');
  const t2 = r.get('TS-2');
  t('lo scarico entra nel saldo: 15 - 5 = 10, chiesti 15', t2.giacenza === 10 && t2.qta_da_ordinare === 5);
  t('un codice arrivato e non chiesto e "coperto"', sb.mancanteCategoria(r.get('TS-9')) === 'coperto');
  t('ACQ resta di Alnus: non diventa una riga del gestionale', !r.has('ACQ-1'));
  t('ogni riga dichiara la sua fonte', [...r.values()].every(x => x.fonte === 'gestionale'));
  const vuota = M.righeGiacenzaGestionale([], [op('C', [{ codice: 'TS-5', qta: 15, tipo: 'C/L' }])]);
  t('C/L chiesto e mai arrivato: giacenza 0, mancano 15',
    vuota.length === 1 && vuota[0].giacenza === 0 && vuota[0].qta_da_ordinare === 15);
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

sez('Invio a terzista: trasferimento, non scarico (5 nov)');
{
  // Invio di 40 per la commessa A a Botturi: −40 in sede, +40 presso.
  const inv = (codice, qta, opId, presso) => [
    { codice, qta: -qta, tipo: 'trasferimento', operazione_id: opId, presso_id: null, documento_numero: 'X' },
    { codice, qta, tipo: 'trasferimento', operazione_id: opId, presso_id: presso, documento_numero: 'X' }];
  const a = op('A', [{ codice: 'TS-1', qta: 60, tipo: 'C/L' }], { scadenza: '2026-11-30' });
  const b = op('B', [{ codice: 'TS-1', qta: 60, tipo: 'C/L' }], { scadenza: '2026-10-16' });
  const base = [car('TS-1', 100, 'D1', '2026-09-14')];
  const mov = base.concat(inv('TS-1', 40, 'A', 'BOT'));
  const p = M.pressoTerzisti(mov);
  t('presso: 40 da BOT per A', p.get('TS-1').length === 1 && p.get('TS-1')[0].qta === 40
    && p.get('TS-1')[0].presso_id === 'BOT' && p.get('TS-1')[0].operazione_id === 'A');
  t('in sede: 60', M.saldoInSede(mov).get('TS-1') === 60);
  const r0a = M.arriviDaDdt(a, [a, b], base), r0b = M.arriviDaDdt(b, [a, b], base);
  t('prima dell invio: B (scade prima) 60 arrivati, A 40',
    r0b.get('TS-1').arrivato === 60 && r0a.get('TS-1').arrivato === 40);
  const ra = M.arriviDaDdt(a, [a, b], mov), rb = M.arriviDaDdt(b, [a, b], mov);
  // Sede 60, B scade prima e se li prende tutti; ad A restano i suoi 40 dal
  // terzista, che B non puo' toccare: prima dell'invio erano gli stessi 40.
  t('dopo: A tiene i 40 dal terzista, mancano 20',
    ra.get('TS-1').arrivato === 40 && ra.get('TS-1').manca === 20 && ra.get('TS-1').serve === 60);
  t('dopo: B prende la sede, 60', rb.get('TS-1').arrivato === 60 && rb.get('TS-1').manca === 0);
  const aPrio = Object.assign({}, a, { priorita_ordine: 1 }), bTarda = b;
  t('A urgente: 40 dal terzista + 20 dalla sede; B ne ha 40',
    M.arriviDaDdt(aPrio, [aPrio, bTarda], mov).get('TS-1').manca === 0
    && M.arriviDaDdt(bTarda, [aPrio, bTarda], mov).get('TS-1').arrivato === 40);
  const c = op('C', [{ codice: 'TS-1', qta: 100, tipo: 'C/L' }], { scadenza: '2026-09-01' });
  t('una commessa urgentissima non si prende il materiale dal terzista di A',
    M.arriviDaDdt(c, [a, c], mov).get('TS-1').arrivato === 60
    && M.arriviDaDdt(a, [a, c], mov).get('TS-1').arrivato === 40);
  t('A sa dove sta: 40 presso BOT', ra.get('TS-1').presso.length === 1 && ra.get('TS-1').presso[0].qta === 40);
  t('B non ha niente presso terzisti', rb.get('TS-1').presso.length === 0);
  t('il trasferimento non e un DDT di arrivo', ra.get('TS-1').documenti.map(d => d.numero).join() === 'D1');
  // Al lotto il trigger scarica prima dal terzista: presso torna a zero.
  const dopoLotto = mov.concat([{ codice: 'TS-1', qta: -40, tipo: 'scarico', operazione_id: 'A', presso_id: 'BOT' }]);
  t('scaricato dal terzista: niente piu presso', !M.pressoTerzisti(dopoLotto).has('TS-1'));
  const g = M.righeGiacenzaGestionale(mov, [a, b]).find(x => x.codice === 'TS-1');
  t('giacenza totale invariata (100), di cui 40 presso terzisti', g.giacenza === 100 && g.presso_terzisti === 40);
  t('senza invii: presso vuoto', M.arriviDaDdt(a, [a], base).get('TS-1').presso.length === 0);
}

sez('Fasi esterne del prodotto: una parte va fuori, il resto in casa (5 nov)');
{
  const fasi = [
    { fornitore: 'FILI', righe: [{ codice: 'CL-1', qta: 30 }, { codice: 'MAC-1', qta: 0.5 }, { codice: 'VUOTO', qta: 0 }] },
    { fornitore: 'CAB', righe: [{ codice: 'CL-1', qta: 20 }, { codice: 'SPARITO', qta: 1 }] },
    { fornitore: null, righe: [{ codice: 'CL-9', qta: 1 }] }];
  const q = M.quoteFasiEsterne(fasi);
  t('per fornitore e per codice', q.get('CL-1').get('FILI') === 30 && q.get('CL-1').get('CAB') === 20);
  t('quantita zero scartata', !q.has('VUOTO'));
  t('blocco senza fornitore scartato', !q.has('CL-9'));
  t('nessuna sezione = nessuna quota', M.quoteFasiEsterne(null).size === 0);
  const perPezzo = new Map([['CL-1', 100], ['MAC-1', 0.8]]);
  const r = M.ripartoFasiEsterne(perPezzo, fasi);
  t('100 in distinta, 50 fuori (30 + 20), 50 in casa',
    r.get('CL-1').distinta === 100 && r.get('CL-1').fuori === 50 && r.get('CL-1').inCasa === 50 && !r.get('CL-1').eccede);
  t('MAC: 0,5 fuori, 0,3 in casa', Math.abs(r.get('MAC-1').inCasa - 0.3) < 1e-9);
  t('codice non piu in distinta: segnalato', r.get('SPARITO').sconosciuto && r.get('SPARITO').eccede);
  const troppo = M.ripartoFasiEsterne(perPezzo, [{ fornitore: 'FILI', righe: [{ codice: 'CL-1', qta: 120 }] }]);
  t('fuori piu della distinta: eccede, in casa 0', troppo.get('CL-1').eccede && troppo.get('CL-1').inCasa === 0);
}

sez('Movimenti fuori giacenza (MAC mandati al terzista)');
{
  const a = op('A', [{ codice: 'TS-1', qta: 10, tipo: 'C/L' }]);
  const mov = [car('TS-1', 10, 'D1', '2026-09-14'),
    { codice: 'MAC-1', qta: -2, tipo: 'trasferimento', presso_id: null, operazione_id: 'A', fuori_giacenza: true },
    { codice: 'MAC-1', qta: 2, tipo: 'trasferimento', presso_id: 'BOT', operazione_id: 'A', fuori_giacenza: true }];
  t('non sono presso nei conti', !M.pressoTerzisti(mov).has('MAC-1'));
  t('non toccano la sede', !M.saldoInSede(mov).has('MAC-1'));
  t('non diventano una riga del gestionale', !M.righeGiacenzaGestionale(mov, [a]).some(r => r.codice === 'MAC-1'));
  t('il C/L resta contato', M.arriviDaDdt(a, [a], mov).get('TS-1').manca === 0);
}

console.log('\n' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);
