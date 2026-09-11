// Test del filtro della FINESTRA FERIE — 11 set 2026.
// Chiesto da Nico: "togliere permessi, malattia e altro. non ha senso
// programmare quelli, ma solo ferie".
// La scelta e un DATO sul tipo (`tipi_assenza.richiedibile`), non un codice
// scritto nel telefono: domani nasce "Ferie a ore" e la spunta la mette
// l ufficio.
const fs = require('fs'), vm = require('vm'), path = require('path');
const G = process.argv[2] || '.';
const src = fs.readFileSync(path.resolve(G, 'mobile.html'), 'utf8').replace(/\r\n/g, '\n');

// Il filtro vero, estratto dalla pagina: se cambia li, cambia qui.
const i = src.indexOf('const dichiarato = (state.tipiAssenza || [])');
if (i < 0) { console.error('KO: filtro non trovato in mobile.html'); process.exit(1); }
const j = src.indexOf('if (tipi.length === 0)', i);
const filtro = src.slice(i, j);

const sandbox = { console, state: {} };
vm.createContext(sandbox);

let ok = 0, ko = 0;
const sez = t => console.log('\n' + t);
const t = (nome, cond) => { if (cond) { ok++; console.log('  ok   ' + nome); }
  else { ko++; console.log('  KO   ' + nome); } };
const offerti = (tipiAssenza) => {
  sandbox.state = { tipiAssenza };
  // avvolto in un blocco: le const del filtro non devono restare
  // nel contesto fra una prova e l altra.
  vm.runInContext('{' + filtro + '; RIS = tipi.map(x => x.nome); }', sandbox);
  return sandbox.RIS;
};

const F = { id:'f', nome:'Ferie',    codice:'F', attivo:true,  ordine:1 };
const P = { id:'p', nome:'Permesso', codice:'P', attivo:true,  ordine:2 };
const M = { id:'m', nome:'Malattia', codice:'M', attivo:true,  ordine:3 };
const X = { id:'x', nome:'Vecchio',  codice:'V', attivo:false, ordine:4 };
const con = (o, v) => Object.assign({}, o, { richiedibile: v });

sez('PRIMA della migrazione: si comporta come sempre');
{
  // Una funzione che sparisce e peggio di una che chiede troppo.
  const r = offerti([F, P, M, X]);
  t('senza la colonna restano tutti i tipi attivi',
    JSON.stringify(r) === JSON.stringify(['Ferie', 'Permesso', 'Malattia']));
}

sez('DOPO la migrazione');
{
  const r = offerti([con(F, true), con(P, false), con(M, false)]);
  t('solo le ferie', JSON.stringify(r) === JSON.stringify(['Ferie']));
}
{
  const r = offerti([con(F, true), con(P, true), con(M, false)]);
  t('se l ufficio apre anche i permessi, compaiono',
    JSON.stringify(r) === JSON.stringify(['Ferie', 'Permesso']));
}
{
  // Domani nasce "Ferie a ore": basta la spunta, nessuna modifica al codice.
  const FO = { id:'fo', nome:'Ferie a ore', codice:'FO', attivo:true, ordine:5, richiedibile:true };
  const r = offerti([con(F, true), con(M, false), FO]);
  t('un tipo NUOVO entra senza toccare il telefono',
    JSON.stringify(r) === JSON.stringify(['Ferie', 'Ferie a ore']));
}
{
  const r = offerti([con(Object.assign({}, F, { attivo:false }), true), con(P, false)]);
  t('un tipo disattivato resta fuori anche se richiedibile', r.length === 0);
}
{
  const r = offerti([con(F, false), con(P, false), con(M, false)]);
  t('nessuno richiedibile: finestra vuota, e lo dice', r.length === 0);
}
{
  const r = offerti([]);
  t('nessun tipo configurato: non esplode', Array.isArray(r) && r.length === 0);
}

sez('LA MALATTIA NON SPARISCE DAL GESTIONALE');
{
  // Il filtro vale SOLO sulla finestra del telefono. Il calendario assenze
  // dell ufficio deve continuare a vedere tutti i tipi, o non si potrebbe
  // piu registrare una malattia.
  const app = fs.readFileSync(path.resolve(G, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
  const quante = app.split('state.tipiAssenza.filter(t => t.attivo)').length - 1;
  t('il calendario assenze non filtra per richiedibile', quante >= 1);
  t('il filtro sta solo in mobile.html', !app.includes('!dichiarato || t.richiedibile'));
}

console.log('\n' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);
