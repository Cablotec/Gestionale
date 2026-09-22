// Prova di RUNTIME delle due funzioni nuove: estratte da app.js ed eseguite
// con uno state finto. --check non le esegue mai.
const fs = require('fs');
const src = fs.readFileSync(process.argv[2] + '/app.js', 'utf8');

function estrai(nome) {
  let i = src.indexOf('function ' + nome + '(');
  if (i < 0) throw new Error('non trovata: ' + nome);
  // ⚠ Se la funzione e' `async function`, partire da `function` le toglie
  // l'`async` e l'`await` dentro diventa un errore di sintassi.
  if (src.slice(Math.max(0, i - 6), i) === 'async ') i -= 6;
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1); }
  }
  throw new Error('corpo non chiuso: ' + nome);
}

let state, refresh = 0;
const kioskRefreshActive = () => { refresh++; };
const toLocalISO = (d) => d.toISOString().slice(0, 10);
// applyChange finto: solo il pezzo che serve (sostituisci/aggiungi/togli)
function applyChange(tabella, p) {
  const mappa = { mezzi:'mezzi', utenti:'utenti', aziende:'aziende', articoli:'articoli',
                  tipi_lavorazione:'tipiLav', prenotazioni:'prenotazioni' };
  const k = mappa[tabella];
  if (p.eventType === 'INSERT') { if (!state[k].find(x => x.id === p.new.id)) state[k].push(p.new); }
  else if (p.eventType === 'UPDATE') state[k] = state[k].map(x => x.id === p.new.id ? p.new : x);
  else if (p.eventType === 'DELETE') state[k] = state[k].filter(x => x.id !== p.old.id);
}

// Stub del client: registra la query mirata e restituisce la riga operatore.
let ultimaQuery = null;
let rispostaOperatori = [];
const sb = { from: (tab) => ({ select: () => ({ eq: (col, val) => {
  ultimaQuery = { tab, col, val };
  return Promise.resolve({ data: rispostaOperatori, error: null });
} }) }) };

eval(estrai('kioskApplyAnagrafica'));
eval(estrai('kioskApplyPrenotazione'));
eval(estrai('kioskSyncOperatoriPren'));

let ok = 0, ko = 0;
const t = (nome, atteso, avuto) => {
  const a = JSON.stringify(atteso), b = JSON.stringify(avuto);
  if (a === b) { ok++; } else { ko++; console.log('  KO ' + nome + '\n     atteso ' + a + '\n     avuto  ' + b); }
};

// 1. disattivazione -> sparisce
state = { utenti:[{id:1,nome:'Anna',attivo:true},{id:2,nome:'Bruno',attivo:true}] };
kioskApplyAnagrafica('utenti','utenti',{eventType:'UPDATE',new:{id:2,nome:'Bruno',attivo:false}},'nome');
t('disattivato sparisce', [1], state.utenti.map(u=>u.id));

// 2. riattivazione -> torna (era il difetto)
kioskApplyAnagrafica('utenti','utenti',{eventType:'UPDATE',new:{id:2,nome:'Bruno',attivo:true}},'nome');
t('riattivato torna', [1,2], state.utenti.map(u=>u.id));

// 3. nuovo operatore -> al suo posto alfabetico, non in fondo
kioskApplyAnagrafica('utenti','utenti',{eventType:'INSERT',new:{id:3,nome:'Aldo',attivo:true}},'nome');
t('ordine alfabetico', ['Aldo','Anna','Bruno'], state.utenti.map(u=>u.nome));

// 4. tipi lavorazione: ordine NUMERICO, non alfabetico (2 prima di 10)
state = { tipiLav:[{id:1,nome:'a',ordine:1,attivo:true},{id:2,nome:'b',ordine:10,attivo:true}] };
kioskApplyAnagrafica('tipi_lavorazione','tipiLav',{eventType:'INSERT',new:{id:3,nome:'c',ordine:2,attivo:true}},'ordine');
t('ordine numerico', [1,2,10], state.tipiLav.map(r=>r.ordine));

// 5. DELETE: `new` e' null, non deve esplodere
state = { mezzi:[{id:1,nome:'Furgone',attivo:true}] };
kioskApplyAnagrafica('mezzi','mezzi',{eventType:'DELETE',new:null,old:{id:1}},'nome');
t('delete senza new', [], state.mezzi.map(r=>r.id));

// 6. riga senza colonna `attivo` (tabella che non ce l'ha): resta
state = { aziende:[{id:1,nome:'Alfa'}] };
kioskApplyAnagrafica('aziende','aziende',{eventType:'UPDATE',new:{id:1,nome:'Alfa Srl'}},'nome');
t('attivo assente = resta', ['Alfa Srl'], state.aziende.map(r=>r.nome));

// 7. prenotazioni: una finita ieri non entra, una che finisce domani si'
const ieri = new Date(Date.now()-864e5).toISOString().slice(0,10);
const domani = new Date(Date.now()+864e5).toISOString().slice(0,10);
state = { prenotazioni:[] };
kioskApplyPrenotazione({eventType:'INSERT',new:{id:1,data_fine:ieri}});
kioskApplyPrenotazione({eventType:'INSERT',new:{id:2,data_fine:domani}});
t('prenotazione scaduta esclusa', [2], state.prenotazioni.map(r=>r.id));

// 8. prenotazione senza data_fine: si tiene (non si butta cio' che non si sa)
kioskApplyPrenotazione({eventType:'INSERT',new:{id:3,data_fine:null}});
t('senza data_fine resta', [2,3], state.prenotazioni.map(r=>r.id));

t('kioskRefreshActive chiamato a ogni evento', 9, refresh);

// ── 9-12. Gli OPERATORI della prenotazione si rileggono da soli ──
// ⚠ Regressione vera, segnalata da Nico il 22 set: il kiosk riconosce
// "questa prenotazione e' tua" SOLO da `prenotazioni_utenti`. Tolta la
// ricarica totale, quella cache restava vecchia e il mezzo che avevi gia'
// prenotato ti appariva libero — niente "conferma rientro", e una seconda
// prenotazione al posto dell'aggiornamento.
(async () => {
  const PREN = 'pren-1', UT = 'utente-1';
  state = { prenotazioni: [], prenOp: [] };
  rispostaOperatori = [{ prenotazione_id: PREN, utente_id: UT }];
  kioskApplyPrenotazione({ eventType:'INSERT', new:{ id:PREN, data_fine:domani } });
  await new Promise(r => setTimeout(r, 30));
  t('rilettura sulla tabella giusta', 'prenotazioni_utenti', ultimaQuery && ultimaQuery.tab);
  t('rilettura sulla prenotazione giusta', PREN, ultimaQuery && ultimaQuery.val);
  t('operatore finito in prenOp', 1, state.prenOp.filter(r => r.prenotazione_id === PREN).length);

  // Niente doppioni se lo stesso evento arriva due volte (il realtime puo' ripetersi)
  kioskApplyPrenotazione({ eventType:'UPDATE', new:{ id:PREN, data_fine:domani } });
  await new Promise(r => setTimeout(r, 30));
  t('evento ripetuto non duplica gli operatori', 1, state.prenOp.filter(r => r.prenotazione_id === PREN).length);

  // Su DELETE non si rilegge: la prenotazione non c'e' piu'
  ultimaQuery = null;
  kioskApplyPrenotazione({ eventType:'DELETE', old:{ id:PREN }, new:null });
  await new Promise(r => setTimeout(r, 30));
  t('su DELETE nessuna rilettura', null, ultimaQuery);

  console.log(ok + ' ok, ' + ko + ' ko');
  process.exit(ko ? 1 : 0);
})();
