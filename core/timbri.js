/* ═══════════════════════════════════════════════════════════════════
   CORE/TIMBRI.JS — le regole dei timbri, UNA volta per tutte le interfacce

   Gestionale, kiosk e telefono chiudono e controllano i timbri con queste
   funzioni, non con copie loro. Nato il 30 set: il telefono aveva una sua
   chiusura con un update secco, e sulle commesse raggruppate metteva tutto il
   tempo su una sola (lo stesso difetto della pausa pranzo, corretto al kiosk
   il 24 ago e rimasto vivo li').

   Non sta in domain/ perche' SCRIVE sul database: domain resta senza
   Supabase. Le regole pure che usa (come si divide il tempo, chi fa parte del
   gruppo) invece stanno li': ripartisciTimbroGruppo, commesseGruppoLavorabili.

   Dipendenze (globali): sb e eseguiConRetry da core/db.js, le funzioni di
   domain/scheduling.js, e `state` con `operazioni`, `opFasi`, `sessioni`.
   Si carica DOPO core/db.js e domain/scheduling.js, PRIMA delle pagine.

   ⚠ Cosa resta alle interfacce: il MODO. Il kiosk chiude in silenzio i timbri
   rimasti aperti, il telefono prima chiede. La regola sotto e' la stessa.
   ═══════════════════════════════════════════════════════════════════ */

// I timbri aperti di una persona, chiesti al SERVER. Non `state.sessioni`:
// e' la copia locale di cui ogni postazione si fidava, e da li' nascevano gli
// accavallamenti (7 ago: una postazione non vede il timbro aperto sull'altra).
// Ritorna { data, error } come Supabase.
async function timbriApertiDi(uid) {
  if (!uid) return { data: [], error: null };
  return eseguiConRetry(
    () => sb.from('sessioni_lavoro').select('*').eq('utente_id', uid).is('fine', null),
    { label: 'controllo timbri aperti' });
}

// Chiude una sessione scrivendo la fine passata, spalmando sul gruppo se la commessa
// ne fa parte. UNA sola strada per tutte le chiusure automatiche (7 ago): la
// pausa pranzo faceva un update secco e NON spalmava, quindi chi lavorava a
// mezzogiorno su una commessa raggruppata si vedeva tutte le ore su una sola
// posizione. Sui dati veri erano 87 timbri per 305 ore. Due strade per chiudere
// la stessa cosa, e una sola sapeva del gruppo.
// Ritorna { data, gruppoN }.
async function chiudiConSplitGruppo(sess, fineIso, nota) {
  const inizio = sess.inizio;
  const op = (state.operazioni || []).find(o => o.id === sess.operazione_id);
  // Le attività extra non si spalmano: non hanno commessa, quindi niente gruppo.
  const gruppo = (op && !sess.attivita_id)
    ? commesseGruppoLavorabili(op)
    : [{ operazione_id: sess.operazione_id, peso: 1 }];

  if (gruppo.length > 1) {
    const parti = ripartisciTimbroGruppo(inizio, fineIso, gruppo);
    // 1) la sessione già aperta = quota della sua commessa (parti[0]).
    // CHIUDE SOLO SE È ANCORA APERTA (`is('fine', null)`): se qualcuno l'ha già
    // chiusa, l'update non tocca niente e le quote NON si creano una seconda
    // volta. Senza questa guardia una chiusura partita due volte raddoppia le
    // ore — successo davvero, 9 volte: un doppio tocco (3 secondi) e sette
    // ritentativi di `eseguiConRetry` dopo il timeout di 10 secondi, cioè il
    // rischio dichiarato nel handoff ("insert riuscita ma risposta persa").
    const { data: righe, error } = await eseguiConRetry(
      () => sb.from('sessioni_lavoro')
        .update(nota ? { fine: parti[0].fine, note: (sess.note ? sess.note + ' · ' : '') + nota } : { fine: parti[0].fine })
        .eq('id', sess.id).is('fine', null).select(),
      { label: 'chiusura timbratura (gruppo)' }
    );
    if (error) throw error;
    if (!righe || !righe.length) {
      // Già chiusa da un'altra strada: niente quote, niente ore doppie.
      const gia = (state.sessioni || []).find(s => s.id === sess.id);
      return { data: gia || sess, gruppoN: 1, giaChiusa: true };
    }
    const data = righe[0];
    state.sessioni = state.sessioni.map(s => s.id === sess.id ? data : s);
    // 2) una sessione per ciascuna delle ALTRE commesse del gruppo
    const nuove = parti.slice(1).map(p => ({
      operazione_id: p.operazione_id,
      utente_id: sess.utente_id,
      tipo_lavorazione_id: sess.tipo_lavorazione_id,
      fase_id: null,
      attivita_id: null,
      sede: sess.sede,
      inizio: p.inizio,
      fine: p.fine,
      // Niente marchio "[gruppo]" (tolto su richiesta di Nico, 5 ago): sporcava
      // il campo note, che ora serve alle note vere degli operatori. Le quote
      // restano riconoscibili dal fatto che la commessa ha un gruppo_id e che
      // le sessioni sono fette contigue dello stesso intervallo.
      note: sess.note || null,
    }));
    try {
      const { data: ins } = await eseguiConRetry(
        () => sb.from('sessioni_lavoro').insert(nuove).select(),
        { label: 'quote timbro del gruppo' }
      );
      if (ins) ins.forEach(r => { if (!state.sessioni.find(x => x.id === r.id)) state.sessioni.push(r); });
    } catch (e) { /* best-effort: il timbro principale è già salvo, mai perso */ }
    return { data, gruppoN: gruppo.length };
  }

  // Chiusura normale (nessun gruppo). Stessa guardia: chiude solo se aperta.
  const { data: righe, error } = await eseguiConRetry(
    () => sb.from('sessioni_lavoro')
      .update(nota ? { fine: fineIso, note: (sess.note ? sess.note + ' · ' : '') + nota } : { fine: fineIso })
      .eq('id', sess.id).is('fine', null).select(),
    { label: 'chiusura timbratura' }
  );
  if (error) throw error;
  if (!righe || !righe.length) {
    const gia = (state.sessioni || []).find(s => s.id === sess.id);
    return { data: gia || sess, gruppoN: 1, giaChiusa: true };
  }
  const data = righe[0];
  state.sessioni = state.sessioni.map(s => s.id === sess.id ? data : s);
  return { data, gruppoN: 1 };
}
