-- CONTATTI PER RUOLO SULLE AZIENDE (9 nov 2026, Nico: "piu' mail per diversi
-- contatti"; ruoli iniziali Amministrazione, Acquisti, Logistica).
-- Lista [{ ruolo, nome, email, telefono }]. Il menu del materiale offre una
-- voce per ogni contatto con email. Tabella esistente: GRANT gia' presenti.
alter table public.aziende add column if not exists contatti jsonb not null default '[]'::jsonb;
comment on column public.aziende.contatti is
  'Contatti per ruolo: [{ruolo, nome, email, telefono}]. L''email generica resta in aziende.email (facoltativa).';
