// Test del CLICK CHE COPIA — 17 set 2026.
// Chiesto da Nico: *"posso fare che se clicco su un codice in ordini me lo
// copia direttamente?"*. Si', su tutte e quattro le colonne che portano un
// codice: Ordine, OP, Rif. cliente, Codice articolo.
//
// ⚠⚠ E IL DISEGNO E SUO, e risolve un guaio che c era gia: *"su Ordine farei
// in piccolo riquadro con freccia (simbolo link esterno) per aprire l ordine
// intero"*. Fino al 16 set quel numero faceva DUE mestieri con un click solo
// — copiare non si poteva, e aprire l ordine intero era l unica cosa che
// facesse. Adesso sono due bersagli: **il testo e un dato** e si copia, **la
// freccia e una navigazione** e apre.
const fs = require('fs'), path = require('path');
const G = process.argv[2] || '.';
const src = fs.readFileSync(path.resolve(G, 'app.js'), 'utf8').replace(/\r\n/g, '\n');

let ok = 0, ko = 0;
const sez = t => console.log('\n' + t);
const t = (nome, cond) => { if (cond) { ok++; console.log('  ok   ' + nome); }
  else { ko++; console.log('  KO   ' + nome); } };
const quante = (x) => src.split(x).length - 1;

sez('UNA SOLA FUNZIONE DI COPIA');
{
  t('copiaTesto e definita una volta sola', quante('async function copiaTesto(') === 1);
  t('rendiCopiabile e definita una volta sola', quante('function rendiCopiabile(') === 1);
  // ⚠ La schermata Codifica aveva la SUA copia scritta a mano (`navigator.
  // clipboard` + catch + toast, tre righe uguali). Adesso chiama questa.
  // Se ricompare un secondo `writeText` sparso, e tornata la seconda copia:
  // e quella che poi perde il ripiego, o il toast, o tutti e due.
  // ⚠ Si conta la CHIAMATA, non il nome: il commento dentro `copiaTesto`
  // nomina `navigator.clipboard` per spiegare il ripiego, e contare il nome
  // faceva fallire il test su un commento. È il secondo inciampo uguale in
  // due giorni: **una regex che pesca un commento non sta provando il codice.**
  t('la chiamata a writeText è in UN posto solo',
    quante('navigator.clipboard.writeText(') === 1);
  t('e quel posto e dentro copiaTesto',
    /async function copiaTesto\([\s\S]{0,700}?navigator\.clipboard\.writeText/.test(src));
}

sez('IL RIPIEGO, CHE E LA PARTE CHE CONTA');
{
  // ⚠⚠ `navigator.clipboard` VUOLE UN CONTESTO SICURO (https o localhost). Su
  // un indirizzo IP in chiaro — la rete di fabbrica, un domani — l oggetto
  // sparisce SENZA DIRE NIENTE: si preme e non si ha niente negli appunti, e
  // lo si scopre quando si incolla. Il `prompt()` e brutto ma il codice lo
  // porta via lo stesso, e soprattutto SI VEDE che qualcosa e diverso.
  t('c e un ripiego con prompt()', /catch[\s\S]{0,200}?prompt\(/.test(src));
  // ⚠ Nel `catch` e non in un `if` sulla presenza dell oggetto: `writeText`
  // puo fallire da sola (permesso negato, finestra non a fuoco), e un
  // controllo sull esistenza non prenderebbe quei casi.
  t('il ripiego sta nel catch, non in un if sull oggetto',
    !/if\s*\(\s*!?\s*navigator\.clipboard\s*\)/.test(src));
  t('copiaTesto dice se ha funzionato', /return true;[\s\S]{0,300}?return false;/.test(src));
}

sez('COPIARE NON DEVE APRIRE NIENTE');
{
  // ⚠⚠ La riga di Ordini cliente apre la commessa al click. Senza
  // `stopPropagation` ogni copia aprirebbe anche una finestra: un gesto che
  // ne fa due, che e esattamente il difetto da cui parte questa richiesta.
  t('rendiCopiabile ferma la propagazione',
    /function rendiCopiabile\([\s\S]{0,700}?e\.stopPropagation\(\)/.test(src));
  // Il segnale sta sulla CELLA, non solo nel toast: chi copia tre codici di
  // fila guarda la tabella, non l angolo dello schermo.
  t('e lascia un segnale sul nodo',
    /function rendiCopiabile\([\s\S]{0,900}?nodo\.style\.background/.test(src));
  // Su una cella vuota non si fa niente: invitare al click e poi copiare "—"
  // e peggio di una cella spenta.
  t('su una cella vuota non si offre il gesto',
    /function rendiCopiabile\([\s\S]{0,400}?t === '—'/.test(src));
}

sez('IL BERSAGLIO E LA SCRITTA, NON LA CELLA (17 set)');
{
  // Chiesto da Nico il giorno stesso: *"copiare cliccando la scritta e non
  // tutta la cella"*. ⚠⚠ Non e un dettaglio estetico: una cella e larga
  // quanto la colonna, e su un codice corto i due terzi che si copiavano
  // erano **vuoti**. Chi clicca lo spazio accanto si aspetta il gesto della
  // riga — aprire la commessa — e invece si vedeva copiare qualcosa.
  // Misurato nel browser dopo: click sul vuoto → apre la commessa (1 finestra,
  // 0 copie); click sulla scritta → copia (1 scrittura, 0 finestre).
  t('c e una funzione per la scritta copiabile',
    quante('function testoCopiabile(') === 1);
  // Le tre colonne di solo testo passano di li. La quarta (Ordine) aveva gia
  // il suo span, perche accanto ci va la freccia.
  t('Codice: la cella CONTIENE la scritta, non e la scritta',
    /el\('td', \{ class:'mono', style:'color:var\(--or\);' \},\s*\n\s*testoCopiabile\(art\?\.codice/.test(src));
  t('Rif. cliente: idem', /\}, testoCopiabile\(o\.riferimento_cliente/.test(src));
  t('OP non-admin: idem', /opCell\.append\(testoCopiabile\(o\.numero_op/.test(src));
  // ⚠ Nessuna cella deve essere resa copiabile per intero: se `rendiCopiabile`
  // torna a ricevere un `td`, il vuoto ricomincia a copiare.
  t('nessuna cella intera e copiabile',
    !/rendiCopiabile\(el\('td'/.test(src) && !/rendiCopiabile\((\w*C|c)ell,/.test(src));
  // Il vestito sta nel CSS e si vede solo al passaggio del mouse: quattro
  // colonne sottolineate di continuo sarebbero una tabella tutta righe.
  const css = fs.readFileSync(path.resolve(G, 'app.css'), 'utf8');
  t('la classe .copiabile esiste nel CSS', /\.copiabile\{/.test(css));
  t('e si sottolinea solo al passaggio del mouse', /\.copiabile:hover\{[^}]*underline/.test(css));
  t('e il codice usa la classe, non uno stile a mano',
    src.includes("nodo.classList.add('copiabile')"));
}

sez('LA COLONNA «INIZIO» E STATA TOLTA (17 set)');
{
  // Chiesta da Nico. Era la data di partenza calcolata (o forzata a mano): in
  // una tabella da 15 colonne occupava spazio per un dato che si guarda nel
  // Gantt e nella scheda della commessa, dove si puo anche cambiare.
  t('non c e piu l intestazione', !src.includes("sortHead('inizio',"));
  t('e nemmeno il suo ordinamento', !src.includes("sortKey === 'inizio'"));
  // ⚠ `opInizio` RESTA: la usano il Gantt e la scheda della commessa. Togliere
  // la colonna non vuol dire togliere il dato.
  t('ma opInizio e ancora li', src.includes('opInizio('));
  // ⚠ E la variabile della riga se n e andata con la cella: lasciarla avrebbe
  // fatto un calcolo per riga per nessuno.
  t('e la riga non la calcola piu per niente',
    !/const inizio = opInizio\(o\);\s*\n\s*const ritardo/.test(src));
}

sez('LE QUATTRO COLONNE, E LA FRECCIA');
{
  t('Ordine: il numero si copia', src.includes("o.numero_ordine, 'Ordine'"));
  t('OP: si copia', src.includes("o.numero_op, 'OP'"));
  t('Rif. cliente: si copia', src.includes("o.riferimento_cliente, 'Rif. cliente'"));
  t('Codice articolo: si copia', src.includes("art?.codice, 'Codice'"));
  // ⚠ La freccia ↗ e un bersaglio SUO, separato dal numero: e la meta
  // "navigazione" del gesto che prima era uno solo.
  t('la freccia apre l ordine intero',
    /'↗'/.test(src) && /title:'Apri l\\'ordine per intero[\s\S]{0,300}?openOrdineClienteModal/.test(src));
  // ⚠ NON in modalita Raggruppa: li il click sulla riga serve a selezionare, e
  // una porta verso un altra finestra in mezzo a una selezione multipla e un
  // modo per perdere quello che si e scelto.
  t('ma non mentre si raggruppa',
    /if \(!inGruppoMode\) \{[\s\S]{0,800}?'↗'/.test(src));
}

sez('LA CASELLA OP: NIENTE ICONCINA (tolta il 17 set)');
{
  // Per gli admin la cella OP e un INPUT, e li il click serve gia a mettere il
  // cursore: percio la cella non copia, e la scrittura rapida dell OP (chiesta
  // il 31 ago, "si scrive e si esce") resta intatta.
  t('l input dell OP non copia al click', src.includes('onclick: (e) => e.stopPropagation()'));
  // ⚠⚠ L ICONCINA ⧉ C E STATA PER TRE ORE. Nico: *"potendo modificare all
  // interno del campo e gia facile copiarla"*. Vero: in una casella di testo
  // il codice si prende col doppio click o con Ctrl+A, gesti che uno gia
  // conosce. L avevo messa per SIMMETRIA con le altre tre colonne — ma quelle
  // sono testo morto, dove senza un click non si copia niente.
  // **La simmetria non e un motivo per aggiungere un comando: il gesto
  // mancante lo e.** Se ricompare, e tornata la simmetria a decidere.
  t('niente iconcina di copia accanto alla casella',
    !/'⧉'\),\s*\n\s*o\.numero_op, 'OP'/.test(src));
  t('e la cella non e piu allargata per farcela stare',
    /const opCell = el\('td', \{ class:'mono' \}\)/.test(src));
  // ⚠ Per chi NON e admin quella cella e testo morto come le altre, e li il
  // click serve: non c e nessuna casella da cui prendere il codice a mano.
  t('ma per i non-admin la scritta si copia ancora',
    /opCell\.append\(testoCopiabile\(o\.numero_op/.test(src));
}

sez('MISURATO NEL BROWSER, NON DECISO A OCCHIO');
{
  // ⚠ Prima misura: la freccia andava A CAPO sotto il numero. Cella 112px,
  // contenuto 123 (⚠ 14 + numero 86 + freccia 17 + margini 6).
  // (Sull OP c era lo stesso problema — 122 contro 135 — ma si e risolto da
  // se quando l iconcina e stata tolta: la casella da sola ci sta.)
  // La tabella e `table-layout:auto` e scorre gia in orizzontale (1846px in
  // un contenitore da 594): lasciar crescere due colonne e costato 28px in
  // tutto. Mandare a capo un bersaglio da 17px costa un click sbagliato.
  t('la cella Ordine non manda a capo',
    /const ordineCell = el\('td', \{ class:'mono', style:'white-space:nowrap;' \}\)/.test(src));

  // ⚠⚠ I TRE TAGLI CHE FANNO STARE LA TABELLA IN UN FULL HD (17 set, Nico:
  // *"quale altra colonna ridurresti per vedere sempre tutta la schermata fino
  // al furgoncino?"*). La tabella chiedeva **1955px** contro i 1869 di un
  // monitor 1920, e quegli 86 stavano tutti in queste tre colonne di testo.
  // Tagliate a 150 / 210 / 165: minimo sceso a **1860**, niente scorrimento
  // orizzontale, furgoncino dentro lo schermo (bordo destro a 1887 su 1920).
  // ⚠ Se qualcuno le riporta a cifre tonde, la barra di scorrimento torna e
  // il furgoncino sparisce di nuovo: sono numeri MISURATI, non arrotondati.
  // ⚠ Quello che NON funziona, provato: accorciare le intestazioni
  // (`PREP. MATERIALE`→`MATERIALE`, `ORDINATI`→`ORD.`, via `AZIONI`) rende
  // **4px in tutto**, perche' in `table-layout:auto` lo spazio liberato se lo
  // riprendono subito queste tre, che di testo ne vogliono di piu' (Note da
  // sola ne vorrebbe 860). **Si stringe chi ha fame, non chi avanza.**
  t('Note tagliata a 150', src.includes("style: 'max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;',\n      title: o.note"));
  t('Descrizione tagliata a 210', /max-width:210px;[\s\S]{0,120}?title: desc,/.test(src));
  t('Cliente tagliato a 165', /max-width:165px;[\s\S]{0,120}?title: cli\?\.nome/.test(src));
}

console.log('\n' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);
