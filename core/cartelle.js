// CARTELLE DI RETE — 27 nov 2026 (Nico: "legare clienti e fornitori a un
// percorso di rete [...] per avere il peso di allegati ed altro scaricato in
// locale"; scelta la soluzione con l'elenco dei file dentro la scheda).
//
// I file NON passano da Supabase: stanno sul server aziendale e il browser li
// legge e scrive direttamente, con la File System Access API (Chrome / Edge).
//
// Il modello:
//   - RADICE: la cartella comune del server (es. \\SERVER\Clienti e fornitori),
//     scelta UNA volta per PC/browser. Il browser non svela il percorso vero,
//     da' solo una "maniglia" (handle) che si conserva in IndexedDB.
//   - la cartella di un'azienda e' quella che dentro la radice si chiama come
//     la sua P.IVA (app.js, `cartellaDiAzienda`): niente da salvare a database,
//     e ogni PC puo' arrivare alla radice da una lettera d'unita' diversa.
//
// Niente DOM e niente Supabase qui: solo l'accesso alle cartelle. La scheda
// (app.js, `boxDocumentiAzienda`) decide cosa mostrare.

const CARTELLE_DB = 'cablotec-cartelle';
const CARTELLE_STORE = 'maniglie';
const CARTELLE_CHIAVE_RADICE = 'radice';

function cartelleSupportate() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

function _cartelleIdb(modo, fn) {
  return new Promise((ok, ko) => {
    const req = indexedDB.open(CARTELLE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(CARTELLE_STORE);
    req.onerror = () => ko(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(CARTELLE_STORE, modo);
      const r = fn(tx.objectStore(CARTELLE_STORE));
      tx.oncomplete = () => { db.close(); ok(r && 'result' in r ? r.result : undefined); };
      tx.onerror = () => { db.close(); ko(tx.error); };
    };
  });
}

// La radice salvata su questo PC, o null.
async function cartellaRadice() {
  try { return (await _cartelleIdb('readonly', s => s.get(CARTELLE_CHIAVE_RADICE))) || null; }
  catch (_) { return null; }
}

// Fa scegliere la radice (serve un clic dell'utente) e la ricorda.
async function cartellaRadiceScegli() {
  const h = await window.showDirectoryPicker({ id: 'cablotec-radice', mode: 'readwrite' });
  await _cartelleIdb('readwrite', s => s.put(h, CARTELLE_CHIAVE_RADICE));
  return h;
}

// 'granted' | 'prompt' | 'denied'. Con `chiedi` mostra la richiesta del
// browser: funziona SOLO dentro un clic.
async function cartellaPermesso(h, chiedi) {
  if (!h || typeof h.queryPermission !== 'function') return 'granted';
  const o = { mode: 'readwrite' };
  let p = await h.queryPermission(o);
  if (p !== 'granted' && chiedi) p = await h.requestPermission(o);
  return p;
}

// "Clienti/ROSSI SRL" → ['Clienti', 'ROSSI SRL']. Accetta anche le "\".
function cartellaSegmenti(percorso) {
  return String(percorso || '').split(/[\\/]+/).map(x => x.trim()).filter(x => x && x !== '.' && x !== '..');
}
function cartellaPercorso(segmenti) { return (segmenti || []).join('/'); }

// La cartella `percorso` dentro la radice. Errore NotFoundError se non c'e'.
async function cartellaApri(radice, percorso, crea) {
  let d = radice;
  for (const s of cartellaSegmenti(percorso)) d = await d.getDirectoryHandle(s, { create: !!crea });
  return d;
}

// Il contenuto di una cartella: prima le sottocartelle, poi i file, per nome.
// [{ nome, tipo:'cartella'|'file', handle, dimensione, modificato }]
async function cartellaElenco(dir) {
  const out = [];
  for await (const [nome, h] of dir.entries()) {
    // File di sistema e temporanei di Office: rumore.
    if (/^(desktop\.ini|thumbs\.db)$/i.test(nome) || nome.startsWith('~$')) continue;
    if (h.kind === 'directory') { out.push({ nome, tipo: 'cartella', handle: h }); continue; }
    let f = null;
    try { f = await h.getFile(); } catch (_) {}
    out.push({ nome, tipo: 'file', handle: h, dimensione: f ? f.size : null, modificato: f ? f.lastModified : null });
  }
  const coll = new Intl.Collator('it', { numeric: true, sensitivity: 'base' });
  out.sort((a, b) => (a.tipo === b.tipo ? coll.compare(a.nome, b.nome) : (a.tipo === 'cartella' ? -1 : 1)));
  return out;
}

// Un nome valido per Windows (niente < > : " / \ | ? *, niente punti o spazi in fondo).
function cartellaNomeValido(nome) {
  return String(nome || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
}

// Scrive `file` in `dir` SENZA sovrascrivere: se il nome c'e' gia' diventa
// "nome (2).ext", "nome (3).ext"... Restituisce il nome usato.
async function cartellaSalvaFile(dir, file) {
  const esiste = async (n) => { try { await dir.getFileHandle(n); return true; } catch (_) { return false; } };
  const nome0 = cartellaNomeValido(file.name) || 'file';
  const p = nome0.lastIndexOf('.');
  const base = p > 0 ? nome0.slice(0, p) : nome0, ext = p > 0 ? nome0.slice(p) : '';
  let nome = nome0;
  for (let i = 2; await esiste(nome); i++) nome = base + ' (' + i + ')' + ext;
  const fh = await dir.getFileHandle(nome, { create: true });
  const w = await fh.createWritable();
  try { await w.write(file); await w.close(); }
  catch (e) { try { await w.abort(); } catch (_) {} throw e; }
  return nome;
}
