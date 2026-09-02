-- ═══════════════════════════════════════════════════════════════════
-- ANAGRAFICA MATERIALI + DISTINTA BASE  (2 set 2026)
--
-- Da eseguire nel pannello Supabase: CREATE TABLE richiede l'ownership,
-- che l'account tecnico non ha (e giusto cosi: chi puo creare puo anche
-- fare DROP).
--
-- COSA ENTRA, dall'estrazione Alnus CAPRTESP0101.xls:
--   materiali  ~4.200 righe   (i codici componente, con descrizione e UM)
--   distinta   ~38.500 righe  (padre -> figlio, con quantita per pezzo)
--
-- PERCHE' DUE TABELLE E NON UNA: hanno vite diverse. `materiali` e
-- un'ANAGRAFICA — nasce una volta e si arricchisce nel tempo (fornitore
-- abituale, scorta minima, lead time). `distinta` e una FOTOGRAFIA, come
-- i mancanti: ogni import sostituisce il precedente, perche una distinta
-- cambia e tenere le vecchie accanto alle nuove darebbe due verita.
--
-- ⚠ IL LEGAME E' PER CODICE SCRITTO, NON PER FK. E la stessa scelta dei
-- mancanti, e qui serve ancora di piu: dei 5.366 padri del file solo 229
-- corrispondono a un articolo in anagrafica. Con una FK il 96% delle
-- distinte non si potrebbe nemmeno salvare. Cosi invece si salvano tutte
-- e si agganciano DA SOLE quando l'articolo nasce.
--
-- ⚠⚠ `distinta` NON VA MAI CARICATA IN `state`. Sono 38.500 righe: il
-- gestionale carica tutto all'avvio e a quel peso la scheda non si apre
-- piu, oltre a mangiarsi l'egress. Si interroga per `padre`, che ha il suo
-- indice. Questa e la prima tabella del progetto che deve restare al di la
-- del filo.
--
-- SENZA QUESTA MIGRAZIONE non si rompe niente: il caricatore se ne accorge
-- e lo dichiara, il resto dell'app non sa che queste tabelle esistono.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Anagrafica materiali ────────────────────────────────────────
-- La chiave e il CODICE, e non e una scelta: l'hanno decisa i dati.
-- 357 dei 358 codici che Alnus riporta come mancanti compaiono come
-- componente nelle distinte, e 3.213 dei 4.156 sono gia nel formato a 20
-- caratteri della Codifica — lo stesso che si scansiona ai prelievi.
CREATE TABLE materiali (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codice text NOT NULL UNIQUE,
  descrizione text,
  um text,
  -- ACQ lo compriamo noi · C/L arriva dal cliente · MAC materiale di
  -- consumo · PRD produzione. Stessa scala dei mancanti.
  tipo_parte text,
  -- Da riempire col tempo, non all'import: sono i campi che serviranno
  -- alle proposte d'acquisto, e oggi non li sappiamo.
  fornitore_id uuid REFERENCES aziende(id) ON DELETE SET NULL,
  lead_giorni integer,
  scorta_minima numeric,
  lotto_minimo numeric,
  note text,
  attivo boolean DEFAULT true,
  visto_il date,           -- ultima estrazione in cui e comparso
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE materiali ENABLE ROW LEVEL SECURITY;
CREATE POLICY materiali_all ON materiali FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 2. Distinta base ───────────────────────────────────────────────
-- Una riga per legame padre->figlio. Il MULTILIVELLO non si appiattisce
-- qui: si tiene piatto e si esplode ricorsivamente al calcolo, perche la
-- stessa sotto-distinta serve a padri diversi e appiattirla la
-- duplicherebbe. Verificato sui dati: `TS-342015G00` e padre di 11
-- componenti ED e figlio di `TS-342010003`.
-- ⚠ Chi scrivera l'esplosione metta una GUARDIA SUI CICLI, o una distinta
-- che si richiama fa girare il calcolo all'infinito.
CREATE TABLE distinta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  padre text NOT NULL,
  figlio text NOT NULL,
  qta numeric,
  um text,
  tipo_parte text,
  riga text,                 -- "Nr. Riga" del file, per ritrovare l'ordine
  padre_descrizione text,
  figlio_descrizione text,
  import_data date NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE distinta ENABLE ROW LEVEL SECURITY;
CREATE POLICY distinta_all ON distinta FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Gli indici sono la ragione per cui questa tabella puo stare a database
-- invece che in memoria: si scende (padre) e si risale (figlio).
CREATE INDEX distinta_padre ON distinta (padre);
CREATE INDEX distinta_figlio ON distinta (figlio);

-- ── Verifica ───────────────────────────────────────────────────────
-- Dopo l'esecuzione, entrambe devono rispondere 0:
--   SELECT count(*) FROM materiali;
--   SELECT count(*) FROM distinta;
