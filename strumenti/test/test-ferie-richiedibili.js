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
// La funzione vera, presa da mobile.html: il test prova QUELLA, non una copia.
{
  const a = src.indexOf('function tipoInseribileDa(tipo, esente) {');
  if (a < 0) { console.error('KO: tipoInseribileDa non trovata in mobile.html'); process.exit(1); }
  vm.runInContext(src.slice(a, src.indexOf('\n}\n', a) + 3), sandbox);
}

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

const T = (nome, chi, attivo) => ({ id:nome, nome, attivo: attivo !== false, ordine:1, chi_inserisce: chi });
const FERIE    = T('Ferie',    'tutti');
const PERMESSO = T('Permesso', 'esenti');
const MALATTIA = T('Malattia', 'ufficio');

sez('PRIMA della migrazione: si comporta come sempre');
{
  // Una funzione che sparisce e peggio di una che chiede troppo.
  const senzaColonna = [{ id:'f', nome:'Ferie', attivo:true, ordine:1 },
                        { id:'p', nome:'Permesso', attivo:true, ordine:2 }];
  t('senza la colonna restano tutti i tipi attivi',
    offerti(senzaColonna, 'cablotec_1', ['laboratorio']).length === 2);
}

sez('CHI NON E ESENTE: solo ferie');
{
  const TIPI = [FERIE, PERMESSO, MALATTIA];
  const r = offerti(TIPI, 'cablotec_1', ['laboratorio']);
  t('niente permessi', JSON.stringify(r) === JSON.stringify(['Ferie']));
}

sez('GRUPPI ESENTI: ferie e permessi, NON la malattia');
{
  // 11 set, corretto da Nico: "i gruppi esenti possono solo ferie e
  // permessi". Con due soli valori gli esenti avrebbero visto TUTTO, e
  // quindi anche la malattia: e il motivo per cui i valori sono tre.
  const TIPI = [FERIE, PERMESSO, MALATTIA];
  const r = offerti(TIPI, 'laboratorio', ['laboratorio']);
  t('ferie e permessi', JSON.stringify(r) === JSON.stringify(['Ferie', 'Permesso']));
  t('la malattia resta all ufficio', !r.includes('Malattia'));
}
{
  const r = offerti([FERIE, PERMESSO, MALATTIA], 'ufficio', ['laboratorio', 'ufficio']);
  t('piu gruppi esenti: valgono tutti', r.length === 2);
}
{
  const r = offerti([FERIE, PERMESSO], 'laboratorio', []);
  t('nessun gruppo esente configurato: solo ferie', r.length === 1);
}
{
  const r = offerti([FERIE, T('Permesso', 'esenti', false)], 'laboratorio', ['laboratorio']);
  t('un tipo DISATTIVATO resta fuori anche per un esente', r.length === 1);
}
{
  const r = offerti([T('Senza valore', ''), FERIE], 'laboratorio', ['laboratorio']);
  t('un tipo senza dichiarazione non si offre a nessuno',
    JSON.stringify(r) === JSON.stringify(['Ferie']));
}

sez('TUTTE LE PORTE, NON UNA SOLA');
{
  // Togliere un tipo da una parte lasciandolo aperto dall altra e il modo
  // piu sicuro di non accorgersene.
  const app = fs.readFileSync(path.resolve(G, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
  t('il telefono filtra', src.includes('tipoInseribileDa(t, esente)'));
  t('il gestionale filtra', app.includes('tipoInseribileDa(t, esenteQui)'));
  t('la regola e la STESSA funzione nelle due porte',
    src.includes("if (chi === 'esenti') return !!esente;") &&
    app.includes("if (chi === 'esenti') return !!esente;"));
  t('e il kiosk non chiede assenze',
    !fs.readFileSync(path.resolve(G, 'kiosk.html'), 'utf8').includes('tipi_assenza'));
}

sez('LE DATE PASSATE NON LE INSERISCE NESSUNO');
{
  // 11 set: "le date passate no!". L esenzione salta la finestra, non il
  // passato — e a farlo e l ORDINE dei controlli.
  const app = fs.readFileSync(path.resolve(G, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
  const posizione = (s, testo) => s.indexOf(testo);
  const bloccoApp = app.slice(app.indexOf('function verificaAccessoAssenza'),
                              app.indexOf('const finestre = getFinestreAssenze();',
                                app.indexOf('function verificaAccessoAssenza')));
  t('nel gestionale il passato si controlla PRIMA dell esenzione',
    posizione(bloccoApp, 'iso < oggiIso') < posizione(bloccoApp, 'esenti.includes'));
  const bloccoMob = src.slice(src.indexOf('function verificaAccessoAssenza'),
                              src.indexOf('const finestre = getFinestreAssenze();',
                                src.indexOf('function verificaAccessoAssenza')));
  t('e sul telefono pure',
    posizione(bloccoMob, 'iso < oggiIso') < posizione(bloccoMob, 'esenti.includes'));
}

sez('L UFFICIO VEDE TUTTO');
{
  const app = fs.readFileSync(path.resolve(G, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
  t('il filtro si spegne per l admin',
    app.includes("state.profile?.ruolo !== 'admin' && chiInserisceDichiarato()"));
  t('le viste mostrano tutti i tipi',
    app.split('state.tipiAssenza.filter(t => t.attivo)').length - 1 >= 3);
}

console.log('\n' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);
