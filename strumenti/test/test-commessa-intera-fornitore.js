// Commessa intera a un fornitore ma lavorata anche in casa (6 nov, Elcotec
// 00438/0010): il tempo pagato di confronto deve essere l'intero, non zero.
// Uso: node strumenti/test/test-commessa-intera-fornitore.js <radice Gestionale>
const fs = require('fs'), vm = require('vm'), path = require('path');
const G = process.argv[2] || '.';
const ctx = { console, Date, Math, Number, String, Set, Map, Array, Object, JSON };
ctx.state = { sessioni: [], opFasi: [], opFornitori: [], operazioni: [], aziende: [], tipiLav: [] };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(G, 'domain/scheduling.js'), 'utf8'), ctx);

let ok = 0, ko = 0;
const t = (nome, cond) => { if (cond) { ok++; console.log('  ok  ', nome); } else { ko++; console.log('  KO  ', nome); } };

const op = { id: 'O1', quantita: 1, minuti_unitari: 332 };
ctx.state.opFornitori = [{ operazione_id: 'O1', azienda_id: 'ANGELA', fase_id: null, allocazione: 1 }];

// 1. nessuna ora nostra: tutta fuori, come prima
t('senza ore nostre: pagato interno 0', ctx.pagatoOreInterne(op) === 0);
t('senza ore nostre: previsto interno 0', ctx.opCalcOreInterne(op) === 0);

// 2. 17,2 ore timbrate da noi: lavoro condiviso, si confronta con l'intero
ctx.state.sessioni = [{ operazione_id: 'O1', fine: '2026-10-15T10:00:00Z', durata_secondi: 17.2 * 3600 }];
const pag = ctx.pagatoOreInterne(op);
t('con ore nostre: pagato = intero 5,53 h', Math.abs(pag - 332 / 60) < 1e-9);
t('con ore nostre: previsto interno = intero', Math.abs(ctx.opCalcOreInterne(op) - ctx.opCalcOre(op)) < 1e-9);
const cc = ctx.consuntivoCommessa(op);
t('consuntivo: 17,2 su 5,5 pagate, sforo', cc && Math.abs(cc.pagato - 332 / 60) < 1e-9 && cc.sforoPagato && cc.percPagato === 311);

// 3. senza fornitore: niente cambia
ctx.state.opFornitori = [];
t('senza fornitore: pagato intero', Math.abs(ctx.pagatoOreInterne(op) - 332 / 60) < 1e-9);

// 4. CONTO: prezzo − importo concordato del fornitore, diviso le ore nostre
ctx.state.opFornitori = [{ operazione_id: 'O1', azienda_id: 'ANGELA', fase_id: null, importo: 40 }];
ctx.state.aziende = [{ id: 'ANGELA', nome: 'Angela' }, { id: 'ELC', nome: 'Elcotec', tariffa_cliente: 27.3 }];
const opP = { id: 'O1', quantita: 1, minuti_unitari: 332, prezzo_unitario: 151.2, cliente_id: 'ELC' };
const c = ctx.contoCommessa(opP);
t('conto: 151,20 − 40 = 111,20', c && c.resta === 111.2 && c.costoFornitori === 40);
t('conto: 111,20 / 17,2 h = 6,47 euro/h', c && c.euroOra === 6.47 && c.tariffa === 27.3);
t('conto: fonte concordato', c && c.fornitori[0].fonte === 'concordato');
ctx.state.opFornitori.push({ operazione_id: 'O1', azienda_id: 'ANGELA', fase_id: 'F2', importo: 40 });
t('conto: fornitore su due fasi contato una volta', ctx.contoCommessa(opP).costoFornitori === 40);
ctx.state.opFornitori = [{ operazione_id: 'O1', azienda_id: 'ANGELA', fase_id: null }];
const s = ctx.contoCommessa(opP);
t('conto: senza importo = senza costo, non zero nascosto', s.senzaCosto === 1 && s.fornitori[0].costo === null);
t('conto: senza prezzo = null', ctx.contoCommessa({ id: 'O1', quantita: 1 }) === null);

console.log('\n' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);
