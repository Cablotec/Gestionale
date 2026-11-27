-- CARTELLA DI RETE DELLE AZIENDE (27 nov 2026)
-- Percorso RELATIVO alla cartella comune del server (es. 'Clienti/ROSSI SRL'),
-- scelta una volta per PC nella scheda azienda. I file restano sul server: qui
-- solo il percorso. Tabella esistente: i GRANT ci sono gia'.
alter table public.aziende add column if not exists cartella text;
