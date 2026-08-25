-- ⚠ NON ESEGUITO, e per ora non va eseguito.
-- Decisione di Nico del 25 ago: Alnus e la fonte della scadenza, perche
-- dovrebbe essere lo specchio del programma di produzione. Quindi le date
-- di Alnus RESTANO, e sono semmai loro da aggiornare la dove sono rimaste
-- indietro (elenco in strumenti/date-da-allineare-in-alnus.xlsx).
-- Questo file esiste solo come marcia indietro, se un giorno si cambia idea.
--
-- Ripristina le scadenze RIPIANIFICATE A MANO che l'import del 25 ago
-- ha riportato alle date originali di Alnus.
-- 54 righe. Tocca SOLO `scadenza`: quantita e prezzo,
-- che vengono legittimamente dall'ERP, restano come sono.
-- Le date qui sotto sono quelle del backup del 24 ago 2026 ore 22:00.
begin;
update operazioni set scadenza = date '2026-09-30' where id = '24c31edc-a846-4dcf-9e31-881132436138';   -- 2025/OC/00497/40  (l'import l'aveva messa al 2025-12-01)
update operazioni set scadenza = date '2026-09-18' where id = '25675b55-389c-41d0-a7d6-5774d00353f7';   -- 2026/OC/00174/60  (l'import l'aveva messa al 2026-08-08)
update operazioni set scadenza = date '2026-08-28' where id = 'a131fe5c-d23f-4f5e-85f9-c136fc07fa59';   -- 2026/OC/00154/40  (l'import l'aveva messa al 2026-07-15)
update operazioni set scadenza = date '2026-09-11' where id = 'f2ceef4f-7bec-4a6f-ab28-425471751efe';   -- 2026/OC/00306/0010  (l'import l'aveva messa al 2026-08-07)
update operazioni set scadenza = date '2026-08-28' where id = '428d2175-a900-4d78-8d76-6007476938c4';   -- 2026/OC/00326/0020  (l'import l'aveva messa al 2026-08-06)
update operazioni set scadenza = date '2026-08-28' where id = 'bf8be4fb-19dc-4400-93a6-9a275aab5329';   -- 2026/OC/00326/0010  (l'import l'aveva messa al 2026-08-06)
update operazioni set scadenza = date '2026-09-11' where id = '3f023ffe-20a6-448f-863f-05cdf858019c';   -- 2026/OC/00336/0010  (l'import l'aveva messa al 2026-07-28)
update operazioni set scadenza = date '2026-12-23' where id = 'a8cab85b-43d8-40ee-9147-e56f4736049c';   -- 2026/OC/00339/0020  (l'import l'aveva messa al 2026-11-30)
update operazioni set scadenza = date '2026-12-23' where id = '7f903130-4c51-42a6-923a-78bbf6d4a197';   -- 2026/OC/00339/0010  (l'import l'aveva messa al 2026-11-30)
update operazioni set scadenza = date '2026-08-28' where id = '6e87cfd5-c17c-4ab7-8934-0f4b1d9c29ed';   -- 2026/OC/00343/0010  (l'import l'aveva messa al 2026-07-31)
update operazioni set scadenza = date '2026-09-18' where id = '8a89b414-eb58-44dd-9f78-210c7e54bc41';   -- 2026/OC/00263/0030  (l'import l'aveva messa al 2026-07-08)
update operazioni set scadenza = date '2026-09-04' where id = '3f92aebd-fec6-4654-87ae-b0e014a05b3a';   -- 2026/OC/00278/0010  (l'import l'aveva messa al 2026-07-31)
update operazioni set scadenza = date '2026-09-11' where id = 'b6fb4464-40e9-46f3-b607-8a1d335347f8';   -- 2026/OC/00329/0050  (l'import l'aveva messa al 2026-09-02)
update operazioni set scadenza = date '2026-09-25' where id = '31505abc-4858-4471-b9d6-ad9234d28bc1';   -- 2026/OC/00154/30  (l'import l'aveva messa al 2026-07-15)
update operazioni set scadenza = date '2026-09-11' where id = '0742cebb-8700-4399-981d-89fb6d990cae';   -- 2026/OC/00155/50  (l'import l'aveva messa al 2026-08-07)
update operazioni set scadenza = date '2026-08-31' where id = '7dc90693-b013-45aa-9f76-70a8f87e75e4';   -- 2026/OC/00213/80  (l'import l'aveva messa al 2026-05-06)
update operazioni set scadenza = date '2026-09-11' where id = '49f2fa56-6ad3-46f7-896f-42904dd236ef';   -- 2026/OC/00331/0010  (l'import l'aveva messa al 2026-09-02)
update operazioni set scadenza = date '2026-09-30' where id = 'dcce959b-f847-42e4-8cb8-d38f64121461';   -- 2025/OC/00497/60  (l'import l'aveva messa al 2025-12-01)
update operazioni set scadenza = date '2026-09-30' where id = '8cd75d58-5069-4187-9ceb-0a42896b4b97';   -- 2025/OC/00497/80  (l'import l'aveva messa al 2025-12-01)
update operazioni set scadenza = date '2026-09-30' where id = '43ccab7e-267b-4aa7-a33d-00fcf32f0c87';   -- 2025/OC/00497/100  (l'import l'aveva messa al 2025-12-01)
update operazioni set scadenza = date '2026-09-30' where id = '488faca2-fe4f-401d-9a59-b8496f5a1d59';   -- 2025/OC/00497/110  (l'import l'aveva messa al 2025-12-01)
update operazioni set scadenza = date '2026-09-30' where id = 'da20bdf8-0538-42c0-b274-ed17d83edb5d';   -- 2025/OC/00497/120  (l'import l'aveva messa al 2025-12-01)
update operazioni set scadenza = date '2026-09-30' where id = 'dd05a144-dd94-4916-a1ca-61e76e07f08f';   -- 2025/OC/00498/40  (l'import l'aveva messa al 2025-12-01)
update operazioni set scadenza = date '2026-09-30' where id = '6b901496-66e1-4a43-91ec-f897beca4f31';   -- 2025/OC/00498/60  (l'import l'aveva messa al 2025-12-01)
update operazioni set scadenza = date '2026-09-30' where id = '54b80428-cd23-459b-ae33-be23a1fd5720';   -- 2025/OC/00498/80  (l'import l'aveva messa al 2025-12-01)
update operazioni set scadenza = date '2026-09-30' where id = '7706c7b1-19c3-4942-ba9e-9829214dc21a';   -- 2025/OC/00498/100  (l'import l'aveva messa al 2025-12-01)
update operazioni set scadenza = date '2026-09-10' where id = '5a7f4a33-473b-4a8d-bb62-1abcdefb5259';   -- 2026/OC/00155/40  (l'import l'aveva messa al 2026-07-10)
update operazioni set scadenza = date '2026-09-18' where id = 'e46212cb-0ca3-40e9-af12-bf97fad2aff5';   -- 2026/OC/00310/0020  (l'import l'aveva messa al 2026-07-22)
update operazioni set scadenza = date '2026-09-30' where id = '516d6a78-989f-4bf1-bab4-837bfee2b2af';   -- 2025/OC/00498/110  (l'import l'aveva messa al 2025-12-01)
update operazioni set scadenza = date '2026-09-18' where id = 'e4ffee9f-fee5-48b6-b818-fe45c3175f3d';   -- 2026/OC/00107/40  (l'import l'aveva messa al 2026-06-19)
update operazioni set scadenza = date '2026-09-30' where id = 'de589965-5ed4-45d2-a6b3-7cbcff506ad4';   -- 2025/OC/00498/120  (l'import l'aveva messa al 2025-12-01)
update operazioni set scadenza = date '2026-05-29' where id = '03df3338-6a64-41da-ae2b-c3fc59496f69';   -- 2025/OC/00643/10  (l'import l'aveva messa al 2026-02-18)
update operazioni set scadenza = date '2026-08-28' where id = '6a50c64d-6b25-4639-b56d-03f10bc4e42f';   -- 2026/OC/00155/10  (l'import l'aveva messa al 2026-06-12)
update operazioni set scadenza = date '2026-10-02' where id = '921d8484-a714-4093-87c0-b9ab47932d8c';   -- 2026/OC/00346/0010  (l'import l'aveva messa al 2026-09-11)
update operazioni set scadenza = date '2026-09-18' where id = 'c852a3d2-d3ae-4014-bd56-4af27281a6cb';   -- 2026/OC/00359/0010  (l'import l'aveva messa al 2026-09-02)
update operazioni set scadenza = date '2026-09-11' where id = '5c442e29-a7cb-42f7-a2e4-f19aef410fc2';   -- 2026/OC/00359/0020  (l'import l'aveva messa al 2026-09-02)
update operazioni set scadenza = date '2026-09-18' where id = '4953d771-bb47-4bee-85db-f39b7559743f';   -- 2026/OC/00107/10  (l'import l'aveva messa al 2026-06-19)
update operazioni set scadenza = date '2026-09-10' where id = 'fb3de6cc-1e2d-4fce-b6fb-34c689ec5d48';   -- 2026/OC/00155/30  (l'import l'aveva messa al 2026-07-10)
update operazioni set scadenza = date '2026-09-11' where id = 'f744df59-bf03-4cb8-a978-eb06e1310793';   -- 2026/OC/00155/60  (l'import l'aveva messa al 2026-08-07)
update operazioni set scadenza = date '2026-09-18' where id = '3b205b36-e918-49ab-bfcb-45c5910ee9ca';   -- 2026/OC/00174/50  (l'import l'aveva messa al 2026-08-08)
update operazioni set scadenza = date '2026-09-11' where id = 'f165aea2-c4f6-478d-b280-dd07971722c9';   -- 2026/OC/00233/0010  (l'import l'aveva messa al 2026-07-30)
update operazioni set scadenza = date '2026-09-11' where id = 'c608e084-5962-4246-82e1-affcbf2b8a29';   -- 2026/OC/00317/0010  (l'import l'aveva messa al 2026-09-09)
update operazioni set scadenza = date '2026-08-28' where id = 'c3d42fd7-5567-45cb-a91d-c583b25d572d';   -- 2026/OC/00209/30  (l'import l'aveva messa al 2026-08-05)
update operazioni set scadenza = date '2026-08-28' where id = '4ca1c858-7639-45e7-ad4f-98efb5d82c8b';   -- 2026/OC/00209/40  (l'import l'aveva messa al 2026-08-05)
update operazioni set scadenza = date '2026-09-07' where id = '98625561-10bf-425b-9d5c-c599404c4dfd';   -- 2026/OC/00213/50  (l'import l'aveva messa al 2026-05-06)
update operazioni set scadenza = date '2026-08-31' where id = '9c59d36a-ab7f-41d8-bd1a-d6efd11b8f54';   -- 2026/OC/00213/70  (l'import l'aveva messa al 2026-05-06)
update operazioni set scadenza = date '2026-09-11' where id = '3b9609bb-f8aa-4b1c-8242-84d97a74cbe6';   -- 2026/OC/00233/0020  (l'import l'aveva messa al 2026-07-30)
update operazioni set scadenza = date '2026-09-07' where id = 'd0578544-9dbe-43cd-a46b-d4eb41b18601';   -- 2026/OC/00213/130  (l'import l'aveva messa al 2026-05-06)
update operazioni set scadenza = date '2026-09-10' where id = '56eb8b71-2d78-42aa-8f41-da74f455a92d';   -- 2026/OC/00222/10  (l'import l'aveva messa al 2026-07-30)
update operazioni set scadenza = date '2026-09-10' where id = 'd55ea36e-7bc3-4592-958c-57c8f94dd385';   -- 2026/OC/00222/20  (l'import l'aveva messa al 2026-07-30)
update operazioni set scadenza = date '2026-08-28' where id = 'e5410e28-75d5-4ad4-bbe9-04ebfa480cf2';   -- 2026/OC/00222/30  (l'import l'aveva messa al 2026-07-30)
update operazioni set scadenza = date '2026-08-30' where id = '2e8c9b6d-26aa-4d62-9079-8cb89d4ca76c';   -- 2026/OC/00236/0010  (l'import l'aveva messa al 2026-07-03)
update operazioni set scadenza = date '2026-09-18' where id = '519a1e5a-f333-4a82-9147-95ae9d149835';   -- 2026/OC/00310/0010  (l'import l'aveva messa al 2026-07-22)
update operazioni set scadenza = date '2026-08-28' where id = 'c695f8dd-b3dc-4c6a-8ab3-a25dfd2aebb0';   -- 2026/OC/00155/20  (l'import l'aveva messa al 2026-06-12)

-- deve tornare 54
select count(*) as ripristinate from operazioni where id in (
  '24c31edc-a846-4dcf-9e31-881132436138',
  '25675b55-389c-41d0-a7d6-5774d00353f7',
  'a131fe5c-d23f-4f5e-85f9-c136fc07fa59',
  'f2ceef4f-7bec-4a6f-ab28-425471751efe',
  '428d2175-a900-4d78-8d76-6007476938c4',
  'bf8be4fb-19dc-4400-93a6-9a275aab5329',
  '3f023ffe-20a6-448f-863f-05cdf858019c',
  'a8cab85b-43d8-40ee-9147-e56f4736049c',
  '7f903130-4c51-42a6-923a-78bbf6d4a197',
  '6e87cfd5-c17c-4ab7-8934-0f4b1d9c29ed',
  '8a89b414-eb58-44dd-9f78-210c7e54bc41',
  '3f92aebd-fec6-4654-87ae-b0e014a05b3a',
  'b6fb4464-40e9-46f3-b607-8a1d335347f8',
  '31505abc-4858-4471-b9d6-ad9234d28bc1',
  '0742cebb-8700-4399-981d-89fb6d990cae',
  '7dc90693-b013-45aa-9f76-70a8f87e75e4',
  '49f2fa56-6ad3-46f7-896f-42904dd236ef',
  'dcce959b-f847-42e4-8cb8-d38f64121461',
  '8cd75d58-5069-4187-9ceb-0a42896b4b97',
  '43ccab7e-267b-4aa7-a33d-00fcf32f0c87',
  '488faca2-fe4f-401d-9a59-b8496f5a1d59',
  'da20bdf8-0538-42c0-b274-ed17d83edb5d',
  'dd05a144-dd94-4916-a1ca-61e76e07f08f',
  '6b901496-66e1-4a43-91ec-f897beca4f31',
  '54b80428-cd23-459b-ae33-be23a1fd5720',
  '7706c7b1-19c3-4942-ba9e-9829214dc21a',
  '5a7f4a33-473b-4a8d-bb62-1abcdefb5259',
  'e46212cb-0ca3-40e9-af12-bf97fad2aff5',
  '516d6a78-989f-4bf1-bab4-837bfee2b2af',
  'e4ffee9f-fee5-48b6-b818-fe45c3175f3d',
  'de589965-5ed4-45d2-a6b3-7cbcff506ad4',
  '03df3338-6a64-41da-ae2b-c3fc59496f69',
  '6a50c64d-6b25-4639-b56d-03f10bc4e42f',
  '921d8484-a714-4093-87c0-b9ab47932d8c',
  'c852a3d2-d3ae-4014-bd56-4af27281a6cb',
  '5c442e29-a7cb-42f7-a2e4-f19aef410fc2',
  '4953d771-bb47-4bee-85db-f39b7559743f',
  'fb3de6cc-1e2d-4fce-b6fb-34c689ec5d48',
  'f744df59-bf03-4cb8-a978-eb06e1310793',
  '3b205b36-e918-49ab-bfcb-45c5910ee9ca',
  'f165aea2-c4f6-478d-b280-dd07971722c9',
  'c608e084-5962-4246-82e1-affcbf2b8a29',
  'c3d42fd7-5567-45cb-a91d-c583b25d572d',
  '4ca1c858-7639-45e7-ad4f-98efb5d82c8b',
  '98625561-10bf-425b-9d5c-c599404c4dfd',
  '9c59d36a-ab7f-41d8-bd1a-d6efd11b8f54',
  '3b9609bb-f8aa-4b1c-8242-84d97a74cbe6',
  'd0578544-9dbe-43cd-a46b-d4eb41b18601',
  '56eb8b71-2d78-42aa-8f41-da74f455a92d',
  'd55ea36e-7bc3-4592-958c-57c8f94dd385',
  'e5410e28-75d5-4ad4-bbe9-04ebfa480cf2',
  '2e8c9b6d-26aa-4d62-9079-8cb89d4ca76c',
  '519a1e5a-f333-4a82-9147-95ae9d149835',
  'c695f8dd-b3dc-4c6a-8ab3-a25dfd2aebb0'
);
commit;