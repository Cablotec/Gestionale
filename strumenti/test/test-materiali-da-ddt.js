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
  // SEQUENZA (17 nov): il segnaposto del reparto non e' un fornitore.
  const conRep = M.quoteFasiEsterne([{ reparto: true }, ...fasi]);
  t('segnaposto reparto ignorato dalle quote', conRep.get('CL-1').size === 2 && conRep.get('CL-1').get('FILI') === 30);
  const perPezzo = new Map([['CL-1', 100], ['MAC-1', 0.8]]);
  const r = M.ripartoFasiEsterne(perPezzo, fasi);
  t('100 in distinta, 50 fuori (30 + 20), 50 in casa',
    r.get('CL-1').distinta === 100 && r.get('CL-1').fuori === 50 && r.get('CL-1').inCasa === 50 && !r.get('CL-1').eccede);
  t('MAC: 0,5 fuori, 0,3 in casa', Math.abs(r.get('MAC-1').inCasa - 0.3) < 1e-9);
  t('codice non piu in distinta: segnalato', r.get('SPARITO').sconosciuto && r.get('SPARITO').eccede);
  const troppo = M.ripartoFasiEsterne(perPezzo, [{ fornitore: 'FILI', righe: [{ codice: 'CL-1', qta: 120 }] }]);
  t('fuori piu della distinta: eccede, in casa 0', troppo.get('CL-1').eccede && troppo.get('CL-1').inCasa === 0);
}

sez('Richiesta per piu commesse: la quantita si divide per scadenza (6 nov)');
{
  const c391 = { id: 391, scadenza: '2026-11-20' }, c392 = { id: 392, scadenza: '2026-11-27' }, c394 = { id: 394, scadenza: '2026-12-04' };
  // in ordine sparso: deve contare la scadenza, non l'ordine della lista
  const voci = [{ commessa: c394, serve: 150 }, { commessa: c391, serve: 450 }, { commessa: c392, serve: 300 }];
  const a = M.assegnaPerServizio(voci, 600);
  t('600 su 900: 391 tutto, 392 il resto, 394 niente', a[1] === 450 && a[2] === 150 && a[0] === 0);
  const b = M.assegnaPerServizio(voci, 900);
  t('basta per tutti', b[0] === 150 && b[1] === 450 && b[2] === 300);
  const c = M.assegnaPerServizio(voci, 1000);
  t('di piu: l avanzo alla prima che scade', c[1] === 550 && c[0] === 150);
  t('zero: niente a nessuno', M.assegnaPerServizio(voci, 0).every(x => x === 0));
  const pr = M.assegnaPerServizio([{ commessa: { id: 1, scadenza: '2026-12-31', priorita_ordine: 1 }, serve: 10 },
    { commessa: { id: 2, scadenza: '2026-11-01' }, serve: 10 }], 10);
  t('la priorita dell ordine viene prima della scadenza', pr[0] === 10 && pr[1] === 0);
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

sez('Rigenerare tiene i terzisti della commessa');
{
  const T = M.terzistiDellaCommessa;
  const prod = [{ codice: 'A', qta_pz: 2, fasi_esterne: { BEL: 2 } }, { codice: 'B', qta_pz: 3, fasi_esterne: { BEL: 1, ANG: 1 } },
    { codice: 'C', qta_pz: 1, fasi_esterne: null }, { codice: 'N', qta_pz: 1, fasi_esterne: { BEL: 1 } }];
  // Nessun cambio: uguale al prodotto.
  const r0 = T(prod, [{ codice: 'A', fasi_esterne: { BEL: 2 } }], ['BEL', 'ANG']);
  t('senza cambi resta come il prodotto', JSON.stringify(r0.map(r => r.fasi_esterne))
    === JSON.stringify([{ BEL: 2 }, { BEL: 1, ANG: 1 }, null, { BEL: 1 }]));
  // BEL sostituito da TEC sulla commessa.
  const vec = [{ codice: 'A', fasi_esterne: { TEC: 2 } }, { codice: 'B', fasi_esterne: { TEC: 1, ANG: 1 } }, { codice: 'C', fasi_esterne: null }];
  const r1 = T(prod, vec, ['TEC', 'ANG']);
  t('cambio: la quota di BEL va a TEC', r1[0].fasi_esterne.TEC === 2 && !('BEL' in r1[0].fasi_esterne));
  t('cambio: l altro terzista sulla riga resta', r1[1].fasi_esterne.TEC === 1 && r1[1].fasi_esterne.ANG === 1);
  t('cambio: un codice NUOVO del prodotto segue lo scambio', r1[3].fasi_esterne && r1[3].fasi_esterne.TEC === 1);
  t('riga senza terzisti resta senza', r1[2].fasi_esterne === null);
  // ANG tolto (fase tolta): la sua quota resta in casa.
  const r2 = T(prod, [{ codice: 'B', fasi_esterne: { BEL: 1 } }], ['BEL']);
  t('fase tolta: la quota resta in casa', JSON.stringify(r2[1].fasi_esterne) === JSON.stringify({ BEL: 1 }));
  // Tutti tolti: null.
  const r3 = T(prod, [], []);
  t('nessun terzista sulla commessa: tutto in casa', r3.every(r => r.fasi_esterne === null));
  t('quantita e codici restano quelli del prodotto', r3.map(r => r.codice + r.qta_pz).join() === 'A2,B3,C1,N1');
}

sez('Codici non riconosciuti nei DDT (20 nov)');
{
  const noti = new Set(['2900KLOVA00GX1691U25', 'A1']);
  const mov = [
    { tipo: 'carico', fuori_giacenza: true, codice: 'GX1691U25', codice_mittente: 'GX1691U25', azienda_id: 'lov', mittente: 'LOVATO', qta: 50, documento_numero: '26030479' },
    { tipo: 'carico', fuori_giacenza: true, codice: 'gx1691u25', azienda_id: 'lov', mittente: 'LOVATO', qta: 10, documento_numero: '26030500' },
    { tipo: 'carico', fuori_giacenza: true, codice: '2900KLOVA00GX1691U25', azienda_id: 'lov', qta: 50 },
    { tipo: 'carico', fuori_giacenza: false, codice: 'TS-1', azienda_id: 'tema', qta: 5 },
    { tipo: 'trasferimento', fuori_giacenza: true, codice: 'MAC-X', qta: -1 },
    { tipo: 'carico', fuori_giacenza: true, codice: 'ZZ9', azienda_id: 'fab', mittente: 'FABBI', qta: 3, documento_numero: '1' } ];
  const ordini = [{ serie: 'OF', numero: 762, anno: 2026, fornitore_id: 'lov', righe: [{ codice: '2900KLOVA00GX1691U25', codice_fornitore: 'GX1691U25' }] },
    { serie: 'OF', numero: 1, anno: 2026, fornitore_id: 'altro', righe: [{ codice: 'A1', codice_fornitore: 'ZZ9' }] }];
  const r = M.carichiCodiceSconosciuto(mov, noti, ordini);
  t('due codici sconosciuti (Lovato e Fabbi), TS- e trasferimenti esclusi', r.map(x => x.codice).join() === 'GX1691U25,ZZ9');
  t('stesso codice in maiuscole diverse: una voce, due DDT', r[0].qta === 60 && r[0].righe === 2 && r[0].documenti.length === 2);
  t('proposta dal suo OF', r[0].proposta && r[0].proposta.codice === '2900KLOVA00GX1691U25' && r[0].proposta.ordine === 'OF 762/2026');
  t('proposta solo dallo STESSO fornitore', r[1].proposta === null);
  // 23 nov, DDT Fabbi: Alnus scrive la marca davanti al codice del fornitore.
  const el = [{ azienda_id: 'fab', codice_fornitore: 'SIE 3VA99880BL33', codice: '2330ASIEMVA99880BL33' },
    { azienda_id: 'fab', codice_fornitore: 'WEI 1651970000', codice: '26022WEID01651970000' },
    { azienda_id: 'fab', codice_fornitore: '6SL32105BB125BV1', codice: '29800SIEM000BB125BV1' },
    { azienda_id: 'fab', codice_fornitore: 'X 1', codice: 'A' }, { azienda_id: 'fab', codice_fornitore: 'X-1', codice: 'B' }];
  t('marca davanti: 3VA99880BL33 trova SIE 3VA99880BL33', M.trovaCodiceNostro(el, 'fab', '3VA99880BL33') === '2330ASIEMVA99880BL33');
  t('codice intero con la marca vale lo stesso', M.trovaCodiceNostro(el, 'fab', 'WEI 1651970000') === '26022WEID01651970000');
  t('senza marca resta com\'e\'', M.trovaCodiceNostro(el, 'fab', '6SL3210-5BB12-5BV1') === '29800SIEM000BB125BV1');
  t('altro fornitore: niente', M.trovaCodiceNostro(el, 'lov', '3VA99880BL33') === null);
  t('chiave che porta a due codici: niente', M.trovaCodiceNostro(el, 'fab', 'X1') === null);
  const fab = [{ azienda_id: 'fab', codice: '2313CSIEM0005SY63027', codice_fornitore: 'SIE 5SY63027' }];
  t('voce: letto «5SY63027», forma del fornitore «SIE 5SY63027»', M.voceCodiceFornitore(fab, 'fab', '5SY63027').codice_fornitore === 'SIE 5SY63027');
  t('voce ristretta al nostro codice giusto e sbagliato', !!M.voceCodiceFornitore(fab, 'fab', '5SY63027', '2313csiem0005sy63027') && M.voceCodiceFornitore(fab, 'fab', '5SY63027', 'ALTRO') === null);
  // Candidati del ricevimento (23 nov).
  const voci = [
    { codice: '24512SIEM00003NW7063', codice_fornitore: 'SIE 3NW7063', descrizione: 'PORTAFUSIBILE SIEMENS 10X38 3P', ordine: 'OF 763/2026', aperto: 88 },
    { codice: '24512SIEM00003NW7023', codice_fornitore: 'SIE 3NW70232', descrizione: 'PORTAFUSIBILE SIEMENS 10X38 2P', ordine: 'OF 761/2026', aperto: 0 },
    { codice: '26022WEID01651970000', codice_fornitore: 'WEI 1651970000', descrizione: 'MORSETTO DI DISTRIBUZIONE', ordine: 'OF 775/2026', aperto: 1000 } ];
  const c1 = M.candidatiRicevimento({ codice_mittente: '3NW70632', descrizione: 'PORTAFUSIBILE 3P 10X38', qta: 88, ordine: 'OF 2026/763' }, voci);
  t('candidati: OF citato + stessa quantita\' + codice simile in cima', c1[0].codice === '24512SIEM00003NW7063' && c1[0].perche.includes('ordine citato sul DDT') && c1[0].perche.includes('aspetta proprio 88'));
  const c2 = M.candidatiRicevimento({ codice_mittente: '1651970000', qta: 923 }, voci);
  t('candidati: codice fornitore uguale vale piu\' di tutto', c2[0].codice === '26022WEID01651970000' && c2[0].punteggio >= 100);
  const c3 = M.candidatiRicevimento({ codice_mittente: '46928', descrizione: 'CAPICORDA', qta: 9000 }, voci);
  t('candidati: niente in comune = punteggi bassi', c3.every(x => x.punteggio < 35));
  const c4 = M.candidatiRicevimento({ codice_mittente: '050ASL', qta: 4, ordine: 'OF 2026/805' }, [
    { codice: '24512MERS00000CUSCC2', codice_fornitore: 'XES CUSCC2', ordine: 'OF 805/2026' },
    { codice: '2822GELFI00000050DSL', codice_fornitore: null, ordine: 'OF 805/2026' }]);
  t('candidati: un carattere di differenza (050ASL / 050DSL) passa in cima', c4[0].codice === '2822GELFI00000050DSL' && c4[0].perche.includes('codice quasi uguale'));
  t('proposta nel riquadro con la marca', M.carichiCodiceSconosciuto([{ tipo: 'carico', fuori_giacenza: true, codice: 'RZKE65', azienda_id: 'fab', qta: 1 }], new Set(),
    [{ serie: 'OF', numero: 807, anno: 2026, fornitore_id: 'fab', righe: [{ codice: '242AA0DKC00000RZKE65', codice_fornitore: 'DKC RZKE65' }] }])[0].proposta.codice === '242AA0DKC00000RZKE65');
}

console.log('\n' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);
