# Ingresso merci da DDT

È la porta d'ingresso del magazzino del Gestionale, che un giorno sostituirà Alnus.
Legge i DDT in arrivo (scansioni o PDF), li registra in `movimenti_magazzino` e in un registro Excel parallelo, poi archivia il file.
Pilota: Enviro di Tema. Sistema avviato il 13 ott 2026; prima era un progetto a parte, dal 28 ott fa parte del Gestionale.

> **Dove sta il codice.** Gli script girano sul PC di Nico, in `C:\Users\User032\Desktop\DDT_arrivi\`, dove li lancia l'attività di Windows "Cablotec - DDT in arrivo". Non sono in questo repository, che è pubblicato su GitHub Pages: spostarli vuol dire anche registrare di nuovo l'attività, e solo Nico può farlo.
> Le parti dentro il Gestionale (tabella, trigger, schede) sono descritte nella sezione "MATERIALI DA DDT" di `CLAUDE.md`.

## Come funziona

```
\\srv02\scansioni\User032\        <- lo scanner salva qui (anche i PDF dalla mail vanno messi qui)
        |  watcher.ps1 (attività di Windows "Cablotec - DDT in arrivo")
        v
DDT_arrivi\in\<file>               <- copia locale: Claude in background NON legge i percorsi di rete
        |  claude -p  con le istruzioni di prompt.txt
        v
estratti\<CLIENTE>_<nDDT>.json     <- testata e righe lette, con le note scritte a mano
        |  python registra.py
        v
Registro_arrivi.xlsx (Arrivi + Confronto ordini)  +  node invia-movimenti.js -> Gestionale, movimenti_magazzino
        |
in\<file>.esito.json  ->  il watcher sposta l'originale in ELABORATI\<CLIENTE>\<anno>\ oppure DA_VERIFICARE\ (+ .txt col motivo)
```

## File (in `Desktop\DDT_arrivi\`)

| File | A cosa serve |
|---|---|
| `watcher.ps1` | Sorveglia la cartella (notifica + controllo ogni 60 s). Aspetta che lo scanner finisca, lancia Claude, sposta l'originale. Massimo 2 tentativi per file. Resiste alla rete assente. |
| `installa.ps1` | Registra l'attività di Windows: parte all'accesso, senza finestra (`conhost --headless`); ogni 10 minuti la rilancia se è caduta (`IgnoreNew`). `-Rimuovi` la toglie. **La lancia Nico:** dalla sessione di Claude Windows risponde "Accesso negato". |
| `prompt.txt` | Le istruzioni che riceve Claude a ogni elaborazione. |
| `config.json` | I clienti: come riconoscerli, il prefisso del codice Cablotec (Tema = `TS-`) e le distinte d'ordine per il confronto in Excel. |
| `registra.py` | Aggiunge il DDT al registro Excel senza doppioni, ricalcola il "Confronto ordini" e poi lancia `invia-movimenti.js`. Se l'Excel è aperto, lo segnala e scrive comunque nel Gestionale. |
| `invia-movimenti.js` | Scrive le righe come carichi in `movimenti_magazzino`, come `ai@cablotec.local`. La password la legge da `Z:\SOFTWARE\MegaAPP\PW.txt` tramite `strumenti/credenziali.js` e non la stampa mai. Salta le righe già presenti. Con `--prova` fa solo il controllo. |
| `Registro_arrivi.xlsx` | Registro parallelo per la durata della prova. Da dismettere quando il Gestionale sarà affidabile. |
| `ultimo_riepilogo.txt`, `log\` | Esito dell'ultima elaborazione, `watcher.log` e un `run_*.txt` per ogni elaborazione. |

## Nel Gestionale

- **Produzione → Movimenti:** tutti i movimenti, nelle viste *Righe* e *Per documento*.
- **Produzione → Materiali:** per i codici del Gestionale (colonna *Fonte*) la giacenza è il saldo dei movimenti.
- **Commessa → scheda Materiali → spunta "Materiali da DDT":** i codici C/L si contano dai DDT ("arrivati 42 su 60 · mancano 18 · DDT …").
- **Lotto di produzione:** sulle commesse con la spunta, un trigger del database scarica i C/L consumati (`strumenti/migrazione-scarichi-produzione.sql`).
- **Magazzino unico** (deciso il 14 ott): quello che arriva va alla commessa con priorità più alta e scadenza più vicina, qualunque ordine indichi il DDT.
- Tabella e permessi: `strumenti/migrazione-movimenti-magazzino.sql`. Nessuno ha UPDATE/DELETE: un errore si corregge con una *rettifica*.

## Operazioni frequenti

- **Aggiungere un cliente:** aggiungi la sua voce in `clienti` dentro `config.json`, con il nome che lo riconosce e il prefisso del codice. Finché manca, i suoi DDT finiscono in `DA_VERIFICARE`.
- **Rilanciare un DDT a mano** (non crea doppioni né in Excel né nel Gestionale):
  ```
  python registra.py estratti\<file>.json
  ```
- **Il watcher non parte:**
  - Guarda `log\watcher.log`.
  - Lancia `Get-ScheduledTask -TaskName 'Cablotec - DDT in arrivo'`: deve dare `Running`, azione `conhost.exe --headless …`, trigger all'accesso + ogni 10 minuti.
  - Se serve, Nico rilancia `pwsh -NoProfile -File "C:\Users\User032\Desktop\DDT_arrivi\installa.ps1"`.
- **Un DDT letto male:** un movimento non si modifica. Si corregge con una rettifica, per ora dal pannello Supabase.

## Storia

- **13 ott:** prima versione. È stato caricato il DDT Tema 1000003813.
- **14 ott:**
  - verificata tutta la catena con il DDT 1000004522;
  - il watcher, chiuso per sbaglio, è stato reso robusto;
  - deciso il magazzino unico;
  - attivati gli scarichi di produzione;
  - le giacenze sono entrate in Materiali.
- **28 ott:** `installa.ps1` rilanciato da Nico. Verificato: attività senza finestra, con i due trigger, in `Running`.

## Aperto al 28 ott

- Tema deve dire chi fornisce `TS-510000184`, `TS-517000374` e `TS-536000652`.
- Va reimportato in Materiali il Fabbisogno Massivo completo da Alnus: l'archivio è incompleto dall'import del 12 ott (solo C/L).
- Prossimi mattoni, in ordine:
  1. giacenze iniziali;
  2. DDT dei fornitori (ACQ);
  3. regola di Outlook per i PDF dalla mail;
  4. rettifiche dalla UI;
  5. prelievi come scarichi.
