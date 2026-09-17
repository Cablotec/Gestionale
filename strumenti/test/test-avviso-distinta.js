// Test dell'AVVISO DISTINTA MANCANTE — 11 set 2026.
// Chiesto da Nico: segnalare negli alert a sinistra degli ordini se manca la
// distinta, tranne Elcotec.
// L'eccezione NON e su Elcotec: e sui clienti che mandano loro il materiale,
// dichiarato in anagrafica. Elcotec e uno di quelli, Senzani un altro (22
// commesse su 22 senza distinta): scrivere "tranne Elcotec" nel codice
// avrebbe acceso 22 falsi allarmi il giorno stesso.
//
// ⚠⚠ 17 SET: IL CLIENTE NON GOVERNA PIU, SEMINA. `materiale_dal_cliente` era
// rimasta l'ultima regola-cliente di questa casa a decidere DAL VIVO, a ogni
// disegno della tabella. Adesso scrive `senza_distinta` sulla commessa appena
// nata e poi tace, come `tariffa_cliente` e come i minuti sull'articolo.
// Il motivo non e l'eleganza, e una richiesta: *"se per caso un ordine dovesse
// avere qualche componente io potrei cambiarlo togliendo la spunta dall'ordine
// specifico"*. Finche il cliente parlava dal vivo quella spunta tolta non
// aveva effetto — il flag zittiva l'avviso comunque, e la casella sembrava
// rotta. Meta di questo test e cambiata di conseguenza, ed e giusto cosi: la
// regola e cambiata. Quello che NON deve cambiare e che l'avviso taccia dove
// non c'e niente da comprare.
const fs = require('fs'), vm = require('vm'), path = require('path');
const G = process.argv[2] || '.';
const src = fs.readFileSync(path.resolve(G, 'app.js'), 'utf8').replace(/\r\n/g, '\n');

const sandbox = { console, state: {} };
vm.createContext(sandbox);
// Le tre funzioni pure, estratte dal guscio.
// ⚠ Dal 16 set la regola vive in `distintaMancante` e non piu' dentro
// `opCampiMancanti`: l'avviso e' passato dalla colonna Ordine (i campi della
// PIANIFICAZIONE) alla colonna Prep. Materiale, dove uno guarda quando si
// chiede se il materiale c'e'. Il test ci ha guadagnato: prova la regola
// direttamente, invece che attraverso un aggregatore che fa altre otto cose.
['function contoLavoroDichiarato()', 'function materialeDalCliente(',
 'function senzaDistintaDichiarabile()', 'function distintaMancante('].forEach(m => {
  const i = src.indexOf(m);
  if (i < 0) { console.error('KO: manca ' + m); process.exit(1); }
  vm.runInContext(src.slice(i, src.indexOf('\n}\n', i) + 3), sandbox);
});

let ok = 0, ko = 0;
const sez = t => console.log('\n' + t);
const t = (nome, cond) => { if (cond) { ok++; console.log('  ok   ' + nome); }
  else { ko++; console.log('  KO   ' + nome); } };
// Ritorna il CODICE del prodotto senza distinta, o null.
const avvisi = (op) => sandbox.distintaMancante(op);
const haDistinta = (codice) => !!codice;
const OP = { id:'o1', cliente_id:'c1', articolo_id:'a1', scadenza:'2026-01-01', minuti:5 };

// ⚠ `operazioni` nello stato non e decorazione: da li `senzaDistintaDichiarabile`
// capisce se la colonna esiste. Senza, l'avviso e spento del tutto.
const conColonna = (materiale_dal_cliente, distinta) => {
  sandbox.state = {
    aziende: [{ id:'c1', nome:'Cliente Uno', materiale_dal_cliente }],
    articoli: [{ id:'a1', codice:'ART-1', distinta }],
    operazioni: [{ id:'o1', senza_distinta: false }] };
};

sez('PRIMA della migrazione: chi non sa non accusa');
{
  // ⚠ 17 set: la colonna che conta adesso e `operazioni.senza_distinta`, non
  // piu `aziende.materiale_dal_cliente`. E la stessa regola di sempre applicata
  // alla fonte nuova: senza quella colonna la dichiarazione non si puo
  // leggere, e ogni commessa di conto lavoro sembrerebbe rotta. Sui dati del
  // 17 set sarebbero 245 righe che urlano tutte insieme.
  sandbox.state = { aziende: [{ id:'c1', nome:'Cliente Uno', materiale_dal_cliente: false }],
    articoli: [{ id:'a1', codice:'ART-1', distinta: null }],
    operazioni: [{ id:'o1' }] };   // niente `senza_distinta` fra le chiavi
  t('colonna assente: nessun avviso sulla distinta', !haDistinta(avvisi(OP)));
  // Anche con lo stato vuoto: all avvio, prima che le operazioni arrivino.
  sandbox.state = { aziende: [], articoli: [{ id:'a1', codice:'ART-1', distinta:null }] };
  t('stato ancora vuoto: nessun avviso inventato', !haDistinta(avvisi(OP)));
}

sez('DOPO la migrazione');
{
  conColonna(false, null);
  t('cliente normale senza distinta: avvisa', haDistinta(avvisi(OP)));
  t('e dice quale prodotto', avvisi(OP) === 'ART-1');
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
  conColonna(false, null);
  sandbox.state.articoli = [];
  t('prodotto che non esiste: nessun avviso inventato', !haDistinta(avvisi(OP)));
}

sez('IL CLIENTE NON PARLA PIU DAL VIVO (17 set)');
{
  // ⚠⚠ QUESTO E IL RIBALTAMENTO. Fino al 16 set `materiale_dal_cliente` da
  // solo bastava a zittire l'avviso, e infatti qui c'era scritto "materiale
  // dal cliente: NESSUN avviso". Adesso NO: il flag semina alla nascita, e
  // quello che l'avviso legge e il seme sulla commessa. Su una commessa nata
  // prima che il flag esistesse (o nata male) l'avviso si accende — ed e
  // giusto: nessuno le ha mai detto niente, e il backfill serve a questo.
  conColonna(true, null);
  t('flag cliente da solo: NON zittisce piu', haDistinta(avvisi(OP)));
  const OPsem = Object.assign({}, OP, { senza_distinta: true });
  t('col seme scritto sulla commessa: zitto', !haDistinta(avvisi(OPsem)));
  // ⚠ E il punto della richiesta: togliere la spunta sul singolo ordine DEVE
  // riaccendere l'avviso anche se il cliente ha il flag. Prima era impossibile.
  t('spunta tolta su un cliente di conto lavoro: l avviso torna',
    haDistinta(avvisi(Object.assign({}, OP, { senza_distinta: false }))));
}
{
  conColonna(true, [{ codice:'X', qta:1 }]);
  t('distinta presente: zitto comunque, seme o no', !haDistinta(avvisi(OP)));
}
{
  // Il seme di un cliente non deve arrivare addosso a un altro: e la commessa
  // a portarlo, quindi due commesse di due clienti sono indipendenti per
  // costruzione. Si prova lo stesso, perche era il caso del 11 set.
  sandbox.state = {
    aziende: [{ id:'c1', nome:'Elcotec', materiale_dal_cliente: true },
              { id:'c2', nome:'Sacmi',   materiale_dal_cliente: false }],
    articoli: [{ id:'a1', codice:'ART-1', distinta: null }],
    operazioni: [{ id:'o1', senza_distinta: true }] };
  t('Elcotec seminata: zitta', !haDistinta(avvisi(Object.assign({}, OP, { senza_distinta:true }))));
  t('Sacmi non seminata: avvisa', haDistinta(avvisi(Object.assign({}, OP, { cliente_id:'c2' }))));
}

sez('LA DICHIARAZIONE SULLA SINGOLA COMMESSA (17 set)');
{
  // Chiesto da Nico: *"posso spuntare una casella all interno dell ordine nei
  // materiali per dichiarare che quest ordine non ha distinta"*. Dal seme in
  // poi la casella non e piu il livello piu basso di tre: e l'UNICO posto che
  // l'avviso legge. Il cliente e il prodotto restano i modi comodi di
  // riempirla (il primo seminando, il secondo perche una distinta che c'e
  // toglie la domanda), ma chi decide e la riga.
  conColonna(false, null);
  const OPdich = Object.assign({}, OP, { senza_distinta: true });
  t('commessa dichiarata senza distinta: nessun avviso', !haDistinta(avvisi(OPdich)));
  t('e senza la spunta l avviso torna', haDistinta(avvisi(OP)));
}

sez('IL SEME: dove si scrive, e dove NON si scrive');
{
  // Il seme vive in `seminaSenzaDistinta`, chiamata da `creaMaterialiPerCommesse`
  // — il punto unico dove passano tutte e tre le porte d'ingresso delle
  // commesse (import Alnus, griglia "+ Nuovo ordine", modal singolo).
  const quante = (x) => src.split(x).length - 1;
  t('la funzione del seme esiste', quante('async function seminaSenzaDistinta(') === 1);
  t('e la chiama chi crea le liste',
    /creaMaterialiPerCommesse[\s\S]{0,1400}?await seminaSenzaDistinta\(r\)/.test(src));
  // ⚠⚠ `contoLavoroDichiarato()` PRIMA di `materialeDalCliente()`: la seconda
  // risponde true per TUTTI quando la colonna non esiste (e fatta per non
  // accusare), e li quel true vorrebbe dire seminare l'intero archivio.
  t('non semina finche il flag cliente non esiste',
    /seminaSenzaDistinta[\s\S]{0,400}?contoLavoroDichiarato\(\)[\s\S]{0,200}?materialeDalCliente\(/.test(src));
  // ⚠ Non semina dove una lista c'e gia: scriverebbe "questa commessa non ha
  // distinta" su una che ce l'ha. Sui dati del 17 set e 1 commessa su 181,
  // e sono proprio quelle che Nico vuole poter gestire a mano.
  t('non semina dove la lista e gia nata',
    /if \(nuove\.length\) \{[\s\S]{0,200}?\} else if \(await seminaSenzaDistinta\(r\)\)/.test(src));
  // ⚠ La lista puo non nascere per tre motivi (articolo sconosciuto, quantita
  // a zero, distinta vuota) e il seme va messo in tutti e tre: prima erano tre
  // `continue` che uscivano dal giro in silenzio.
  t('i tre continue che saltavano il seme non ci sono piu',
    !/const pezzi = Number\(r\.quantita\) \|\| 0;\s*\n\s*if \(!art \|\| !art\.codice \|\| !\(pezzi > 0\)\) continue;/.test(src));
  // Il seme aggiorna anche la copia in `state`, come fa la spunta a mano:
  // la tabella Ordini cliente legge da li.
  t('il seme aggiorna anche la copia in state',
    /seminaSenzaDistinta[\s\S]{0,600}?inState\.senza_distinta = true/.test(src));
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
  // ⚠ Un bottone che offre di creare una lista da una distinta che non esiste
  // e peggio di un messaggio sbagliato: e un invito a premerlo. Vale per il
  // conto lavoro E per le commesse dichiarate senza distinta (17 set).
  t('niente bottone Crea dalla distinta dove la distinta non ci sara',
    src.includes('if (!isNew && !dalCliente && !dichiarataSenza && isAdmin && art)'));
  // ⚠ La regola sta in UNA funzione, e la colonna Prep. Materiale la chiama.
  // Se qualcuno la ricopiasse nella cella, le due copie divergerebbero al
  // primo cambio dell'eccezione conto lavoro.
  t('la regola della distinta e in una funzione sola',
    quante('function distintaMancante(') === 1);
  t('e non e tornata dentro opCampiMancanti',
    !/opCampiMancanti[\s\S]{0,1600}?art\.distinta/.test(src));
  t('la colonna Prep. Materiale la usa',
    src.includes('const senzaDistinta = (typeof distintaMancante'));
  // ⚠ INERTE FINCHE LA COLONNA NON ESISTE, come `tipo_parte` il 27 ago: la
  // casella non deve comparire prima della migrazione, o si spunta e il
  // salvataggio fallisce su una colonna che il database non conosce.
  // ⚠ La domanda si fa in UN posto solo (`senzaDistintaDichiarabile`): la UI
  // se la rifaceva a mano, e due copie della stessa domanda sono due occasioni
  // di rispondere diverso — l'avviso spento e la casella visibile, o il
  // contrario.
  t('la domanda sulla colonna e in una funzione sola',
    quante("some(x => x && ('senza_distinta' in x))") === 1);
  t('e la casella la usa', src.includes('isAdmin && senzaDistintaDichiarabile()'));
  // ⚠ Il salvataggio aggiorna ANCHE la copia in `state`: la tabella Ordini
  // cliente legge da li, e senza sembrerebbe che la spunta non funzioni
  // finche non si ricarica la pagina.
  t('la spunta aggiorna anche la copia in state',
    /const inState = \(state\.operazioni \|\| \[\]\)\.find/.test(src));
  // La dichiarazione vale anche in reparto: "nessuna lista" si legge come un
  // dato mancante e manda l operatore a chiedere.
  t('anche il kiosk la rispetta', src.includes("op.senza_distinta"));
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
