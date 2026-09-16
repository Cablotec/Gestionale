// Test dell'AVVISO DISTINTA MANCANTE — 11 set 2026.
// Chiesto da Nico: segnalare negli alert a sinistra degli ordini se manca la
// distinta, tranne Elcotec.
// L'eccezione NON e su Elcotec: e sui clienti che mandano loro il materiale,
// dichiarato in anagrafica. Elcotec e uno di quelli, Senzani un altro (22
// commesse su 22 senza distinta): scrivere "tranne Elcotec" nel codice
// avrebbe acceso 22 falsi allarmi il giorno stesso.
const fs = require('fs'), vm = require('vm'), path = require('path');
const G = process.argv[2] || '.';
const src = fs.readFileSync(path.resolve(G, 'app.js'), 'utf8').replace(/\r\n/g, '\n');

const sandbox = { console, state: {} };
vm.createContext(sandbox);
// Le tre funzioni pure, estratte dal guscio.
['function contoLavoroDichiarato()', 'function materialeDalCliente(', 'function opCampiMancanti('].forEach(m => {
  const i = src.indexOf(m);
  if (i < 0) { console.error('KO: manca ' + m); process.exit(1); }
  vm.runInContext(src.slice(i, src.indexOf('\n}\n', i) + 3), sandbox);
});
// Le dipendenze di opCampiMancanti, ridotte all'osso: qui si prova la regola
// della distinta, non il resto.
vm.runInContext('function opFasiOf(){return[];} function opMinutiEffettivi(o){return o.minuti||1;}'
  + ' function getOperazioneAddetti(){return[{}];} function getOperazioneFornitori(){return[];}'
  + ' function faseAssegnatari(){return{addetti:[],fornitori:[]};}', sandbox);

let ok = 0, ko = 0;
const sez = t => console.log('\n' + t);
const t = (nome, cond) => { if (cond) { ok++; console.log('  ok   ' + nome); }
  else { ko++; console.log('  KO   ' + nome); } };
const avvisi = (op) => sandbox.opCampiMancanti(op);
const haDistinta = (m) => m.some(x => /Distinta di/.test(x));
const OP = { id:'o1', cliente_id:'c1', articolo_id:'a1', scadenza:'2026-01-01', minuti:5 };

sez('PRIMA della migrazione: chi non sa non accusa');
{
  // Nessuna azienda ha la colonna: acceso a meta darebbe 39 falsi allarmi su
  // Elcotec e 22 su Senzani il giorno stesso.
  sandbox.state = { aziende: [{ id:'c1', nome:'Cliente Uno' }],
    articoli: [{ id:'a1', codice:'ART-1', distinta: null }] };
  t('colonna assente: nessun avviso sulla distinta', !haDistinta(avvisi(OP)));
}

sez('DOPO la migrazione');
const conColonna = (materiale_dal_cliente, distinta) => {
  sandbox.state = {
    aziende: [{ id:'c1', nome:'Cliente Uno', materiale_dal_cliente }],
    articoli: [{ id:'a1', codice:'ART-1', distinta }] };
};
{
  conColonna(false, null);
  t('cliente normale senza distinta: avvisa', haDistinta(avvisi(OP)));
  t('e dice quale prodotto', avvisi(OP).some(x => /ART-1/.test(x)));
}
{
  conColonna(false, []);
  // [] vuol dire "dichiarata vuota": il prodotto non ha materiali. E una
  // scelta di qualcuno, non un buco — ma la lista resta vuota lo stesso.
  t('distinta dichiarata vuota: avvisa comunque', haDistinta(avvisi(OP)));
}
{
  conColonna(false, [{ codice:'X', qta:1 }]);
  t('distinta c e: nessun avviso', !haDistinta(avvisi(OP)));
}
{
  conColonna(true, null);
  t('materiale dal cliente: NESSUN avviso', !haDistinta(avvisi(OP)));
}
{
  conColonna(true, [{ codice:'X', qta:1 }]);
  t('materiale dal cliente e distinta presente: comunque zitto', !haDistinta(avvisi(OP)));
}
{
  // Un cliente marcato non deve zittire gli altri.
  sandbox.state = {
    aziende: [{ id:'c1', nome:'Elcotec', materiale_dal_cliente: true },
              { id:'c2', nome:'Sacmi',   materiale_dal_cliente: false }],
    articoli: [{ id:'a1', codice:'ART-1', distinta: null }] };
  t('Elcotec zitto', !haDistinta(avvisi(OP)));
  t('Sacmi avvisa', haDistinta(avvisi(Object.assign({}, OP, { cliente_id:'c2' }))));
}
{
  conColonna(false, null);
  sandbox.state.articoli = [];
  t('prodotto che non esiste: nessun avviso inventato', !haDistinta(avvisi(OP)));
}

sez('DUE SCHERMATE, UNA SOLA FONTE DELLE PAROLE');
{
  // La storia, perche questa sezione non si legga come una fissazione.
  // Fino al 15 set erano due i posti che rispondevano a "cosa manca a questa
  // commessa": la scheda Materiali dentro la commessa e un riquadro gemello
  // nella scheda Materiali generale (`riquadroMaterialiCommessa`). L 11 set
  // la frase sul conto lavoro era stata corretta in uno solo dei due, e Nico
  // guardava l altro. Il gemello e stato tolto il 15.
  // ⚠ Aveva anche un difetto mai visto: leggeva `o.cliente_id` dove la
  // variabile si chiamava `op`, e sul conto lavoro tirava un ReferenceError
  // invece della frase. Una copia non si limita a divergere: si rompe dove
  // nessuno guarda.
  //
  // Il 16 set le schermate sono tornate DUE — gestionale e kiosk — e stavolta
  // e giusto: sono due pubblici diversi, l ufficio e l operatore in reparto.
  // Quello che NON deve tornare doppio e la logica. Le parole ("disponibile"
  // contro "coperto", il consumo, il segnaposto, le lavorazioni) si scrivono
  // in `materialeStatoRiga` e basta. Questa sezione sorveglia quello.
  const quante = (t) => src.split(t).length - 1;
  t('il riquadro gemello non e tornato',
    !src.includes('function riquadroMaterialiCommessa'));
  t('la parola sul materiale si scrive in UN posto solo',
    quante('function materialeStatoRiga') === 1);
  t('e il contesto si costruisce in UN posto solo',
    quante('function materialiStatoCommessa') === 1);
  // 1 definizione + almeno 2 chiamate: il modal della commessa e il kiosk.
  // Se una schermata smettesse di passare di li, questo scenderebbe.
  t('la usano tutte e due le schermate', quante('materialeStatoRiga(') >= 3);
  // La frase sul conto lavoro e la stessa, parola per parola, nei due posti:
  // e proprio quella che l 11 set era stata corretta a meta.
  t('la frase sul conto lavoro e identica nelle due schermate',
    quante('Materiale fornito dal cliente: questa commessa') === 2);
  // Un bottone che offre di creare una lista da una distinta che non esiste
  // e peggio di un messaggio sbagliato: e un invito a premerlo.
  t('niente bottone Crea dalla distinta sul conto lavoro',
    src.includes('if (!isNew && !dalCliente && isAdmin && art)'));
  // Il kiosk non scrive niente: e una schermata di sola lettura. Se manca un
  // pezzo la mossa e dell ufficio acquisti, non dell operatore, e un bottone
  // che promettesse il contrario sarebbe peggio del silenzio.
  // Si guarda TUTTO il blocco kiosk dei materiali, dall intestazione alla
  // schermata successiva: se domani ci si infilasse una scrittura, si vede.
  const daKiosk = src.indexOf('// KIOSK — I MATERIALI DELLA COMMESSA');
  const aKiosk = src.indexOf('// ─── Schermata selezione tipo lavorazione ───', daKiosk);
  const bloccoKiosk = (daKiosk >= 0 && aKiosk > daKiosk) ? src.slice(daKiosk, aKiosk) : '';
  t('il blocco kiosk dei materiali esiste ed e delimitato', bloccoKiosk.length > 500);
  t('e non contiene nessuna scrittura a database',
    !/\.(insert|update|delete|upsert)\s*\(/.test(bloccoKiosk));
  // ⚠ SENZA GIACENZE NON SI DICE "DISPONIBILE". L archivio si carica all avvio
  // e puo non arrivare (tabella assente, RLS, rete): in quel caso
  // `state.mancanti` resta null, e null NON e `[]`. Se qualcuno lo
  // inizializzasse a lista vuota, ogni riga direbbe "disponibile" e il kiosk
  // manderebbe l operatore a montare un pezzo che non c e.
  t('il caricamento fallito lascia null, non una lista vuota',
    /state\.mancanti = null/.test(bloccoKiosk));
  t('e il conto si rifiuta di parlare senza archivio',
    /!Array\.isArray\(state\.mancanti\)/.test(bloccoKiosk));
  // Il conto per tutte le commesse si fa UNA volta, fuori dal ciclo delle
  // card: dentro `materialiCommessa` c e `fabbisognoDaListe`, che ricostruisce
  // la domanda di tutte. Chiamarla per card vorrebbe dire rifare quel giro
  // cinquanta volte.
  t('il conto delle card si fa una volta prima del ciclo',
    (src.split('kioskRicalcolaMateriali()').length - 1) >= 2);
}

console.log('\n' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);
