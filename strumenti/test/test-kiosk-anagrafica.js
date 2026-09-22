// Prova di RUNTIME delle due funzioni nuove: estratte da app.js ed eseguite
// con uno state finto. --check non le esegue mai.
const fs = require('fs');
const src = fs.readFileSync(process.argv[2] + '/app.js', 'utf8');

function estrai(nome) {
  const i = src.indexOf('function ' + nome + '(');
  if (i < 0) throw new Error('non trovata: ' + nome);
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

eval(estrai('kioskApplyAnagrafica'));
eval(estrai('kioskApplyPrenotazione'));

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
console.log(ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);
