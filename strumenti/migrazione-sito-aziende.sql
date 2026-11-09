-- SITO WEB SULLE AZIENDE (9 nov 2026, Nico: "mail o direttamente link sito
-- se fornitore online"). Per i fornitori dove si ordina dal sito (Farnell,
-- Mouser...): il menu del materiale offre «Apri il sito» accanto alla mail.
-- Tabella esistente: i GRANT ci sono gia', niente da aggiungere.
alter table public.aziende add column if not exists sito text;
comment on column public.aziende.sito is
  'Sito web per ordinare online (https://...). Usato dal menu del materiale.';
