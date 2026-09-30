/* ═══════════════════════════════════════════════════════════════════
   DOMAIN/MEZZI.JS — le regole delle prenotazioni dei mezzi

   UNA volta per tutte le interfacce (30 set): il gestionale le usa nel
   modal di prenotazione, il telefono quando si prenota da li'. Prima il
   telefono ne aveva una copia sua.

   Niente DOM, niente Supabase: legge `state.prenotazioni` e `state.prenOp`
   (gli operatori di ogni prenotazione, da `prenotazioni_utenti`).
   ═══════════════════════════════════════════════════════════════════ */

// Verifica sovrapposizioni dalla cache in memoria (no fetch).
// Considera gli ORARI: due prenotazioni dello stesso mezzo lo stesso giorno in
// fasce diverse (es. 08:00–12:00 e 14:00–18:00) NON sono in conflitto. Stessa
// regola del vincolo DB tsrange e di kioskConflittoOrarioMezzo: istanti
// effettivi, fallback 00:00–23:59 per prenotazioni senza orario, bound [) così
// che 08–12 e 12–18 (estremi che si toccano) non confliggano.
function checkSovrapposizioni(mezzoId, dataInizio, dataFine, escludiId, oraInizio, oraFine) {
  // Istanti della prenotazione in esame.
  const aInizio = new Date(dataInizio + 'T' + (oraInizio || '00:00'));
  const aFine = new Date(dataFine + 'T' + (oraFine || '23:59'));
  const usaOrari = !isNaN(aInizio.getTime()) && !isNaN(aFine.getTime());

  const res = (state.prenotazioni || []).filter(p => {
    if (p.mezzo_id !== mezzoId) return false;
    if (escludiId && p.id === escludiId) return false;
    // Filtro grossolano per giorno: se i giorni non si toccano, niente conflitto.
    if (!(p.data_inizio <= dataFine && p.data_fine >= dataInizio)) return false;
    // Affinamento orario (se disponibili gli istanti di entrambe).
    if (usaOrari) {
      const bInizio = new Date(p.data_inizio + 'T' + (p.ora_inizio || '00:00'));
      const bFine = new Date(p.data_fine + 'T' + (p.ora_fine || '23:59'));
      if (!isNaN(bInizio.getTime()) && !isNaN(bFine.getTime())) {
        // Sovrapposizione su intervalli semiaperti [inizio, fine).
        return aInizio < bFine && bInizio < aFine;
      }
    }
    return true;
  });
  return res;
}

// Conflitto OPERATORE: lo stesso operatore non può stare su due mezzi (due
// prenotazioni diverse) che si sovrappongono nel tempo. Stessa semantica a
// intervalli semiaperti [inizio, fine) di checkSovrapposizioni: 08–12 e 12–18
// NON confliggono. Ritorna [{ pren, operatori:[id...] }] per ogni conflitto.
function checkSovrapposizioniOperatori(utentiIds, dataInizio, dataFine, escludiId, oraInizio, oraFine) {
  const ids = new Set(utentiIds || []);
  if (ids.size === 0) return [];
  const aInizio = new Date(dataInizio + 'T' + (oraInizio || '00:00'));
  const aFine = new Date(dataFine + 'T' + (oraFine || '23:59'));
  const usaOrari = !isNaN(aInizio.getTime()) && !isNaN(aFine.getTime());

  const res = [];
  (state.prenotazioni || []).forEach(p => {
    if (escludiId && p.id === escludiId) return;
    // Operatori di QUESTA prenotazione che coincidono con quelli in esame.
    const comuni = (state.prenOp || [])
      .filter(r => r.prenotazione_id === p.id && ids.has(r.utente_id))
      .map(r => r.utente_id);
    if (comuni.length === 0) return;
    // Filtro grossolano per giorno.
    if (!(p.data_inizio <= dataFine && p.data_fine >= dataInizio)) return;
    // Affinamento orario (se disponibili gli istanti di entrambe).
    if (usaOrari) {
      const bInizio = new Date(p.data_inizio + 'T' + (p.ora_inizio || '00:00'));
      const bFine = new Date(p.data_fine + 'T' + (p.ora_fine || '23:59'));
      if (!isNaN(bInizio.getTime()) && !isNaN(bFine.getTime())) {
        if (!(aInizio < bFine && bInizio < aFine)) return;
      }
    }
    res.push({ pren: p, operatori: comuni });
  });
  return res;
}
