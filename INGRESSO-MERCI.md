# Ingresso merci da DDT

È la porta d'ingresso del magazzino del Gestionale, che un giorno sostituirà Alnus.
Legge i DDT in arrivo (scansioni o PDF), li registra in `movimenti_magazzino` e in un registro Excel parallelo, poi archivia il file.
Pilota: Enviro di Tema. Sistema avviato il 13 ott 2026; prima era un progetto a parte, dal 28 ott fa parte del Gestionale. **Dal 19 nov legge i DDT di qualsiasi azienda dell'anagrafica**, non solo di Tema.

> **Dove sta il codice** (dal 28 ott):
> - Script, config, registro Excel, distinte d'ordine e JSON estratti stanno in `Z:\SOFTWARE\MegaAPP\DDT_arrivi\`. È accanto a questo repository e non dentro, perché il repository è pubblicato su GitHub Pages.
> - L'attività di Windows "Cablotec - DDT in arrivo" gira sul PC di Nico e lancia `\\SRV02\Dati\SOFTWARE\MegaAPP\DDT_arrivi\watcher.ps1`. Usa il percorso UNC, non Z:, perché all'accesso la lettera Z: può non essere ancora collegata.
> - Claude, quando gira in background, non legge i percorsi di rete. Per questo lavora in una cartella locale, `C:\Users\User032\Cablotec\DDT_arrivi\` (`in\`, `estratti\`, `log\`):
>   - a ogni elaborazione il watcher ci copia `config.json`, `registra.py` e `invia-movimenti.js`;
>   - finita l'elaborazione, riporta sul server i JSON estratti e `ultimo_riepilogo.txt`.
> - **Gli script si modificano solo sul server.** Le copie locali vengono sovrascritte a ogni elaborazione.
> - Registrare l'attività (`installa.ps1`) può farlo solo Nico: dalla sessione di Claude è bloccato.
> Le parti dentro il Gestionale (tabella, trigger, schede) sono descritte nella sezione "MATERIALI DA DDT" di `CLAUDE.md`.

## Come funziona

```
\\srv02\Scansioni\DDT\            <- lo scanner salva qui (anche i PDF dalla mail vanno messi qui)
        |  watcher.ps1 (attività di Windows "Cablotec - DDT in arrivo")
        v
C:\Users\User032\Cablotec\DDT_arrivi\in\<file>   <- copia locale: Claude in background NON legge i percorsi di rete
        |  claude -p  con le istruzioni di prompt.txt
        v
estratti\<CLIENTE>_<nDDT>.json     <- testata e righe lette, con le note scritte a mano
        |  python registra.py
        v
Registro_arrivi.xlsx (Arrivi + Confronto ordini)  +  node invia-movimenti.js -> Gestionale, movimenti_magazzino
        |
in\<file>.esito.json  ->  il watcher sposta l'originale in ELABORATI\<CLIENTE>\<anno>\ oppure DA_VERIFICARE\ (+ .txt col motivo)
```

## File (in `Z:\SOFTWARE\MegaAPP\DDT_arrivi\`)

| File | A cosa serve |
|---|---|
| `watcher.ps1` | Sorveglia la cartella (notifica + controllo ogni 60 s). Aspetta che lo scanner finisca, lancia Claude, sposta l'originale. Massimo 2 tentativi per file. Resiste alla rete assente. |
| `installa.ps1` | Registra l'attività di Windows: parte all'accesso, senza finestra (`conhost --headless`); ogni 10 minuti la rilancia se è caduta (`IgnoreNew`). `-Rimuovi` la toglie. **La lancia Nico:** dalla sessione di Claude Windows risponde "Accesso negato". |
| `prompt.txt` | Le istruzioni che riceve Claude a ogni elaborazione. |
| `config.json` | I clienti che mandano materiale in conto lavoro: come riconoscerli, il prefisso del codice Cablotec (Tema = `TS-`) e le distinte d'ordine per il confronto in Excel. |
| `aziende.js` → `aziende.json` | (19 nov) L'anagrafica del Gestionale (id, nome, P.IVA, ruolo). Il watcher la riscarica nella cartella locale prima di ogni elaborazione; Claude ci riconosce il mittente di un DDT che non è in `config.json`. |
| `accesso.js` | Il login come `ai@cablotec.local`, comune a `aziende.js` e `invia-movimenti.js`. |
| `registra.py` | Aggiunge il DDT al registro Excel senza doppioni, ricalcola il "Confronto ordini" e poi lancia `invia-movimenti.js`. Se l'Excel è aperto, lo segnala e scrive comunque nel Gestionale. |
| `invia-movimenti.js` | Scrive le righe come carichi in `movimenti_magazzino`, come `ai@cablotec.local`. La password la legge da `Z:\SOFTWARE\MegaAPP\PW.txt` tramite `strumenti/credenziali.js` e non la stampa mai. Salta le righe già presenti. Con `--prova` fa solo il controllo. Per i DDT dei fornitori decide quali righe vanno «fuori giacenza» (vedi sotto). |
| `Registro_arrivi.xlsx` | Registro parallelo per la durata della prova. Da dismettere quando il Gestionale sarà affidabile. |
| `estratti\`, `distinte\` | I JSON letti dai DDT (archivio) e le distinte d'ordine dei clienti per il confronto. |
| `ultimo_riepilogo.txt` | Esito dell'ultima elaborazione. `watcher.log` e i `run_*.txt` stanno invece nella cartella locale, sotto `log\`. |

## DDT dei fornitori (19 nov)

Nico: *"ddt automatici da scansione ok per tutti i fornitori"*.
- **Mittente:** prima i clienti di `config.json` (come prima), poi `aziende.json` per P.IVA e per nome. Il JSON estratto porta `azienda_id` e `cliente_key` = nome in maiuscolo (es. `FABBI_IMOLA_SRL`, cartella `ELABORATI\FABBI_IMOLA_SRL\2026`). Un mittente che non è in anagrafica va in `DA_VERIFICARE`: si crea la sua scheda in Aziende e si rimette il file nella cartella.
- **Codici:** Claude scrive il NOSTRO codice se il DDT lo riporta («Vs. codice»), se no quello del fornitore con una nota; il codice del fornitore va sempre come 7o elemento della riga (`codice_mittente`). Nessun prefisso.
- **Ordine:** il nostro numero d'ordine se stampato sul DDT (es. «OFS 3/2026»), in `ordine_rif`. Servirà ad abbinare gli arrivi agli OF quando gli ordini partiranno dal Gestionale.
- ⚠ **Giacenza:** una riga di un fornitore entra nella giacenza del Gestionale solo se il codice è già del Gestionale (ha movimenti in conto) o è un C/L di una commessa viva «Materiali da DDT». Tutte le altre partono `fuori_giacenza` («solo registro»): la giacenza di quei codici (ACQ) la tiene ancora Alnus, e un carico in conto farebbe sostituire nel Gestionale la riga Alnus con la sola quantità del DDT. È la stessa regola del carico a mano (Produzione → Documenti → «＋ DDT in entrata»). I clienti di `config.json` restano come prima: tutto in giacenza.
- Si vedono in **Produzione → Documenti** come «DDT ricevuto».
- Provato a secco il 19 nov (`--prova`): un DDT Fabbi di prova con un codice già del Gestionale (in giacenza) e un connettore ACQ (fuori giacenza); un DDT Tema già caricato resta «0 da inserire»; il registro Excel riconosce lo stesso DDT anche col nome scritto diverso. Il primo DDT vero di un fornitore non è ancora passato.
- Copie di prima: `*.bak-1119` in `Z:\SOFTWARE\MegaAPP\DDT_arrivi`.

## Nel Gestionale

- **Produzione → Movimenti:** tutti i movimenti, nelle viste *Righe* e *Per documento*.
- **Produzione → Materiali:** per i codici del Gestionale (colonna *Fonte*) la giacenza è il saldo dei movimenti.
- **Commessa → scheda Materiali → spunta "Materiali da DDT":** i codici C/L si contano dai DDT ("arrivati 42 su 60 · mancano 18 · DDT …").
- **Lotto di produzione:** sulle commesse con la spunta, un trigger del database scarica i C/L consumati (`strumenti/migrazione-scarichi-produzione.sql`).
- **Magazzino unico** (deciso il 14 ott): quello che arriva va alla commessa con priorità più alta e scadenza più vicina, qualunque ordine indichi il DDT.
- Tabella e permessi: `strumenti/migrazione-movimenti-magazzino.sql`. Nessuno ha UPDATE/DELETE: un errore si corregge con una *rettifica*.

## Operazioni frequenti

- **Un ordine con piu' articoli** (es. Tema 4700000482: 358010100 e 358010075): in `distinte_ordini` l'ordine prende una LISTA di distinte, una per articolo, e il Confronto ordini somma le quantita'. Senza, i codici dell'articolo mancante escono "NON IN DISTINTA".
- **Aggiungere un cliente che manda materiale in conto lavoro:** aggiungi la sua voce in `clienti` dentro `config.json`, con il nome che lo riconosce, il prefisso del codice e `azienda_id`. Finché manca, i suoi DDT si leggono come quelli di un fornitore (righe fuori giacenza se il codice non è già del Gestionale).
- **Un fornitore nuovo:** basta la sua scheda in Aziende (meglio con la P.IVA). Il watcher riscarica l'anagrafica a ogni elaborazione.
- **Rilanciare un DDT a mano** (non crea doppioni né in Excel né nel Gestionale). Va lanciato dalla cartella locale `C:\Users\User032\Cablotec\DDT_arrivi`: da `\\SRV02\...` Node non parte (`ERR_INVALID_PACKAGE_CONFIG`) e i movimenti non arrivano.
  ```
  python registra.py estratti\<file>.json
  ```
- **Il watcher non parte:**
  - Guarda `log\watcher.log`.
  - Lancia `Get-ScheduledTask -TaskName 'Cablotec - DDT in arrivo'`: deve dare `Running`, azione `conhost.exe --headless …`, trigger all'accesso + ogni 10 minuti.
  - Se serve, Nico rilancia `pwsh -NoProfile -File "\\SRV02\Dati\SOFTWARE\MegaAPP\DDT_arrivi\installa.ps1"`.
  - Il log è sul PC: `C:\Users\User032\Cablotec\DDT_arrivi\log\watcher.log`.
- **Login di Claude scaduto:** nel `run_*.txt` compare `Failed to authenticate: OAuth session expired`, e `%USERPROFILE%\.local\bin\claude.exe auth status` dice `loggedIn: false`. Dopo 2 tentativi falliti il watcher non riprova più quel file finché non lo si riavvia (`Stop-ScheduledTask` + `Start-ScheduledTask`, non serve admin). Rimedio duraturo, con l'abbonamento e senza API a consumo: `claude setup-token` (token di un anno) salvato in `CLAUDE_CODE_OAUTH_TOKEN` dell'utente, poi riavviare l'attività.
- **Un DDT letto male:** un movimento non si modifica. Si corregge con una rettifica, per ora dal pannello Supabase.

## Storia

- **13 ott:** prima versione. È stato caricato il DDT Tema 1000003813.
- **14 ott:**
  - verificata tutta la catena con il DDT 1000004522;
  - il watcher, chiuso per sbaglio, è stato reso robusto;
  - deciso il magazzino unico;
  - attivati gli scarichi di produzione;
  - le giacenze sono entrate in Materiali.
- **28 ott:** `installa.ps1` rilanciato da Nico. Verificato: attività senza finestra, con i due trigger, in `Running`. Lo stesso giorno la cartella è passata dal Desktop a `MegaAPP\DDT_arrivi`, con il lavoro di Claude in locale. Il test di `registra.py` dai nuovi percorsi ha salvato il registro sul server e ha raggiunto il Gestionale.
  Primo DDT nuovo dalla nuova sede: Tema 1000005135, ordine 4700000482, articolo 358010100.
  - Claude l'ha letto bene (20 righe), ma ha lanciato `registra.py` con lo strumento PowerShell, mentre `--allowedTools` autorizzava solo quello Bash. È stato quindi bloccato, e il DDT è finito in DA_VERIFICARE.
  - Correzione: autorizzati entrambi gli strumenti.
  - Il DDT è stato registrato a mano (20 movimenti) e archiviato.
  - Questo DDT ha portato in prova un secondo prodotto, `TS-358010100`, sulla commessa 00464/0030 (30 pz, col flag). La sua distinta C/L è il DDT diviso per 30, come indicato da Nico.
  - In `config.json` c'è ora l'ordine 4700000482, con `distinte\distinta 358010100 ordine 4700000482.xlsx` (quantità totali per i 30 pz) per il Confronto ordini.

## Aperto al 28 ott

- Tema deve dire chi fornisce `TS-510000184`, `TS-517000374` e `TS-536000652`.
- Va reimportato in Materiali il Fabbisogno Massivo completo da Alnus: l'archivio è incompleto dall'import del 12 ott (solo C/L).
- Prossimi mattoni, in ordine:
  1. giacenze iniziali;
  2. DDT dei fornitori (ACQ);
  3. regola di Outlook per i PDF dalla mail;
  4. rettifiche dalla UI;
  5. prelievi come scarichi.
- **2 nov:** DDT 1000005134 (23/10) letto dalla scansione: e' il materiale di 00464/0010 (`TS-358010075`, 20 pz, gia' spedita), non della 0030. Scritte la distinta di `TS-358010075` (DDT / 20 pz, 23 C/L + rondella MAC), la lista e il flag sulla 0010, e lo scarico del lotto del 26/10 (23 righe PRODUZIONE col `lotto_id` del lotto: giacenza di quel DDT tornata a zero). In `config.json` l'ordine 482 ha ora due distinte; `registra.py` le somma. Confronto ordine 482: 0 codici aperti. Backup in `C:\Users\User032\Cablotec\tmp` (`backup-358075-prima.json`, `registra.py.bak-0211`, `config.json.bak-0211`, `Registro_arrivi.bak-0211.xlsx`).
- **2 nov, doppioni legati all'anagrafica:** prima i tre controlli (registro Excel, `invia-movimenti.js`, indice unico) riconoscevano un DDT dal nome del mittente come lo legge la scansione, e un nome letto diverso ("Tema Sinergie SpA") lo avrebbe fatto entrare due volte. Adesso:
  - `config.json`: ogni cliente porta `azienda_id`, la sua scheda in anagrafica (Tema = Tema Sinergie S.p.a.). Un cliente nuovo va aggiunto con il suo `azienda_id`.
  - `invia-movimenti.js` scrive `azienda_id` su ogni carico e cerca i doppioni per azienda oppure per i nomi di `riconosci`.
  - `registra.py` riconosce il doppione da cliente + numero DDT.
  - Database: indice unico su tipo + azienda + numero + posizione (SQL eseguito dal pannello, vedi CLAUDE.md).
  - Provato con il DDT 1000005134 e il mittente scritto "Tema Sinergie SpA": Excel lo salta, gestionale 26 righe gia' presenti e 0 da inserire.
- **3 nov, correzione:** il DDT 1000005134 e' il materiale di **00269/0030** (OP 01338, 20 pz, da produrre), non della 00464/0010 come avevo dedotto dall'ordine stampato (482). Annullato lo scarico della 0010 con 23 rettifiche, tolto il flag della 0010. Il confronto Excel resta per ordine come scritto sul DDT (482).
- **16 nov:** la cartella sorvegliata passa da `\srv02\scansioni\User032` a **`\srv02\Scansioni\DDT`**, dedicata ai DDT. Cambiati `$Scansioni` in `watcher.ps1` e `cartella_scansioni` in `config.json` (backup `.bak-1116`); `ELABORATI` e `DA_VERIFICARE` stanno ora lì dentro. Lo stesso giorno il DDT Tema 1000005137 è fallito due volte per login di Claude scaduto. Valutato il watcher su srv02 per non dipendere dal PC: l'installazione di Node, Python e Claude si fa senza admin, ma un'attività che parte all'avvio con nessuno collegato richiede l'admin del server. Per ora resta sul PC.
- **16 nov, distinta d'ordine 376001134:** l'ordine Tema 4700000482 ha una terza riga, `TS-376001134` × 6 pz (commessa 00464/0040). Aggiunto `distinte/distinta 376001134 ordine 4700000482.xlsx` (11 codici, quantità del DDT 1000005137 = 6 pz) alla lista dell'ordine in `config.json` (backup `.bak-1116b`). Rilanciato `registra.py` sul DDT: ordine 482 con 0 codici aperti, nessun doppione nel Gestionale.
- **16 nov, DDT 1000005139:** una sola riga, `357500021` «B.M. CABLAGGIO Multiport USB-C PD», 6 pz, ordine 4700000482. Il codice non era in nessuna distinta. Aggiunto alla distinta d'ordine 376001134 marcato «DA VERIFICARE», perché Nico non è sicuro che esista davvero (vedi CLAUDE.md, fili aperti).
- **16 nov, scansione con 6 DDT Tema** (`doc00227720261116112104.pdf`): 104 righe registrate. La pag. 1 del DDT 1000005558, scansionata due volte, è stata registrata una volta sola. Il DDT 1000005674 (ordine 4700000575, `TS-376001134`, 00499/0020) porta tre codici che la distinta non aveva. Su indicazione di Nico sono stati aggiunti come C/L a distinta, liste di 00499/0020 e 00464/0040 e distinta d'ordine 482: `506000646` contenitore Takachi 1/pz, `506000647` gancio DIN 1/pz, `515000799` guida-luce 4/pz. Sullo stesso DDT l'alimentatore `502000275` è arrivato in 2 su 6, e così anche il contenitore. Gli ordini 575, 328 e 329 non hanno distinta in `config.json`.
