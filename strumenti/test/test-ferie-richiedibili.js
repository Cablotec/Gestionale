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

// Il filtro chiede chi e esente: si stubba, cosi la prova e sul FILTRO e non
// sulla lettura delle impostazioni.
let GRUPPI_ESENTI = [];
const sandbox = { console, state: {},
  getGruppiEsentiAssenze: () => GRUPPI_ESENTI };
vm.createContext(sandbox);

let ok = 0, ko = 0;
const sez = t => console.log('\n' + t);
const t = (nome, cond) => { if (cond) { ok++; console.log('  ok   ' + nome); }
  else { ko++; console.log('  KO   ' + nome); } };
const offerti = (tipiAssenza, gruppo, esenti) => {
  GRUPPI_ESENTI = esenti || [];
  sandbox.state = { tipiAssenza, operatore: { gruppo: gruppo || 'cablotec_1' } };
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

sez('I GRUPPI ESENTI METTONO ANCHE I PERMESSI');
{
  // 11 set, precisato da Nico: "l esenzione dei gruppi pero possono mettere
  // anche i permessi". L esenzione vale su COSA si inserisce, non solo su
  // QUANDO: distinguere le due cose avrebbe voluto dire spiegare a qualcuno
  // perche puo scegliere la data ma non il tipo.
  const TIPI = [con(F, true), con(P, false), con(M, false)];
  t('chi non e esente vede solo le ferie',
    JSON.stringify(offerti(TIPI, 'cablotec_1', ['laboratorio']))
      === JSON.stringify(['Ferie']));
  t('chi e esente vede tutto',
    JSON.stringify(offerti(TIPI, 'laboratorio', ['laboratorio']))
      === JSON.stringify(['Ferie', 'Permesso', 'Malattia']));
  t('piu gruppi esenti: valgono tutti',
    offerti(TIPI, 'ufficio', ['laboratorio', 'ufficio']).length === 3);
  t('nessun gruppo esente: solo ferie per tutti',
    offerti(TIPI, 'laboratorio', []).length === 1);
  t('un esente non vede comunque i tipi DISATTIVATI',
    offerti([con(F, true), con(Object.assign({}, P, { attivo:false }), false)],
      'laboratorio', ['laboratorio']).length === 1);
}

sez('TUTTE LE PORTE, NON UNA SOLA');
{
  // Il filtro era stato messo solo sul telefono. Ma dal BROWSER un operatore
  // puo cliccare la propria riga del calendario assenze e arrivare allo
  // stesso gesto: togliere il permesso da una parte lasciandolo aperto
  // dall altra e il modo piu sicuro di non accorgersene.
  const app = fs.readFileSync(path.resolve(G, 'app.js'), 'utf8');
  t('il telefono filtra', src.includes('!dichiarato || esente || t.richiedibile'));
  t('il gestionale filtra', app.includes('!soloRichiedibili || t.richiedibile'));
  t('e il kiosk non chiede assenze',
    !fs.readFileSync(path.resolve(G, 'kiosk.html'), 'utf8').includes('tipi_assenza'));
}

sez('LA MALATTIA NON SPARISCE PER L UFFICIO');
{
  // Il filtro del gestionale vale SOLO per chi non e admin. L ufficio deve
  // continuare a vedere tutti i tipi, o non si potrebbe piu registrare una
  // malattia — che e il caso per cui quel calendario esiste.
  const app = fs.readFileSync(path.resolve(G, 'app.js'), 'utf8');
  t('il filtro si spegne per l admin',
    app.includes("state.profile?.ruolo !== 'admin'") &&
    app.includes('const soloRichiedibili'));
  // Le viste (legenda, statistiche, riepilogo) non devono filtrare nulla:
  // un totale che nasconde la malattia sarebbe un totale sbagliato.
  t('le viste continuano a mostrare tutti i tipi',
    app.split('state.tipiAssenza.filter(t => t.attivo)').length - 1 >= 3);
}

console.log('\n' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);
