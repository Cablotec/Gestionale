-- CANCELLAZIONE TIMBRATURE SOSPETTE (7 ago 2026, decisa con Nico)
-- Da eseguire dal pannello Supabase: la DELETE su sessioni_lavoro e'
-- riservata agli admin, l account applicativo viene bloccato dall RLS.
--
-- Le 18 righe sono salvate per intero in scratchpad/da_cancellare.json,
-- e c'e' il backup completo di oggi nella cartella backup-gestionale.
--
-- 1) Le 17 righe a DURATA ZERO: quote generate dallo split del gruppo da un
--    tocco di un secondo (Contoli 05:56 e Fabbri 07:26 del 4 agosto).
--    Verificato: nessuna ha una fase collegata e nessuna ha chiuso una fase,
--    quindi non sono il gesto "entro un attimo e chiudo la mia parte".
--    Valgono zero ore: non spostano nessun numero.
DELETE FROM sessioni_lavoro WHERE id IN (
  '9d054288-faa5-4c7a-b2fb-e856b053ae24',
  '47c63aac-cf5a-4ef7-8f9b-08f29f5b109e',
  '1622ee65-cf24-4521-9f29-850a782d9e7a',
  '41e3e48a-19ea-4e70-b809-c7448b76d6d7',
  'b7f0d244-89c3-46d3-a57a-706f3f11067e',
  'b3d037c5-65aa-4ceb-af1a-d02a42a91dd1',
  'b9beb4d4-0f9c-476b-a379-98dcdb87a892',
  '5a5e81aa-ef3d-4124-939f-21d5531cebd9',
  '69e1920d-a377-4ece-b23e-61eb2ddcfc6d',
  '6ca80d71-8060-4755-a442-b685c04037ff',
  'b10ea718-a73e-4a3f-991f-05cbf0237b6b',
  'fbc3b45b-8c62-4bba-bcb7-d8cf72861fff',
  '67a51ba4-050a-467e-897c-1e3bfbf0ecd4',
  '2e024189-d320-4919-b7b8-12053dd1e414',
  '24292670-2a27-4567-87f3-8e12f0f14df9',
  'ab3c00fa-36ee-4533-a474-7bb2103a69f7',
  'e4afc8b6-2ed6-4923-b7e5-064719dbf18f'
);

-- 2) Il DOPPIONE di Marco Ceroni del 5 agosto su 2026/OC/00209/30:
--    due timbri identici 09:21->11:14, cioe' 1,87 h contate DUE VOLTE.
--    Si cancella UNA sola delle due: l altra resta e le ore restano giuste.
DELETE FROM sessioni_lavoro WHERE id IN (
  'd56bdd9c-5be7-4170-84a6-12c810283bd5'
);

-- Controprova: deve tornare 2230 (erano 2248).
SELECT count(*) FROM sessioni_lavoro;
