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
  t('e lascia un segnale sulla cella',
    /function rendiCopiabile\([\s\S]{0,900}?nodo\.style\.background/.test(src));
  // Su una cella vuota non si fa niente: invitare al click e poi copiare "—"
  // e peggio di una cella spenta.
  t('su una cella vuota non si offre il gesto',
    /function rendiCopiabile\([\s\S]{0,400}?t === '—'/.test(src));
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

sez('LA CASELLA OP RESTA SCRIVIBILE');
{
  // ⚠⚠ Per gli admin la cella OP e un INPUT, e li il click serve gia a mettere
  // il cursore. Copiare al click sulla cella avrebbe rotto la scrittura
  // rapida dell OP, che e una richiesta del 31 ago ("si scrive e si esce").
  // Percio li c e un iconcina ⧉ accanto: un bersaglio suo per un gesto suo.
  t('l input dell OP non copia al click', src.includes('onclick: (e) => e.stopPropagation()'));
  t('accanto c e l iconcina di copia', /'⧉'\),\s*\n\s*o\.numero_op, 'OP'/.test(src));
  // ⚠ Solo quando un OP c e: altrimenti sarebbe un invito a copiare il vuoto.
  t('e compare solo se un OP c e', /if \(o\.numero_op\) \{[\s\S]{0,400}?'⧉'/.test(src));
}

sez('MISURATO NEL BROWSER, NON DECISO A OCCHIO');
{
  // ⚠ Prima misura: la freccia andava A CAPO sotto il numero. Cella 112px,
  // contenuto 123 (⚠ 14 + numero 86 + freccia 17 + margini 6). Stessa cosa
  // sull OP: cella 122, contenuto 135 (casella 110 + icona 20 + spazio).
  // La tabella e `table-layout:auto` e scorre gia in orizzontale (1846px in
  // un contenitore da 594): lasciar crescere due colonne e costato 28px in
  // tutto. Mandare a capo un bersaglio da 17px costa un click sbagliato.
  t('la cella Ordine non manda a capo',
    /const ordineCell = el\('td', \{ class:'mono', style:'white-space:nowrap;' \}\)/.test(src));
  t('e nemmeno la cella OP',
    /const opCell = el\('td', \{ class:'mono', style:'white-space:nowrap;' \}\)/.test(src));
}

console.log('\n' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);
