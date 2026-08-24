-- ANNULLA LA PARTE RETROATTIVA DELLA RIDISTRIBUZIONE (24 ago 2026)
--
-- Ridistribuendo i timbri chiusi dalla pausa ho diviso anche 25 timbri
-- fatti PRIMA che il loro gruppo esistesse: 28,9 h spostate applicando
-- all indietro un raggruppamento che a quella data non c era.
-- E il contrario di quello che vale per il caso di Cocco: le ore timbrate
-- prima del raggruppamento sono fatti e restano dove sono.
--
-- Qui si cancellano le 62 quote nate da quei 25 timbri. Subito DOPO,
-- i 25 originali vanno riportati alla durata di prima (lo fa lo script
-- ripristina-durate, che ha gli orari originali salvati).
--
-- ORDINE: prima le durate, poi questa DELETE. Cosi nella finestra fra le
-- due le ore risultano contate in piu (si vede) e non in meno (non si vede).
--
-- Effetto su OC/00209: pos 40 +13,1 h, pos 20 -13,1 h, pos 10 +8,0, pos 30 -8,0.
DELETE FROM sessioni_lavoro WHERE id IN (
  'd9cf71d7-6ef8-4c69-a9e6-4ad0203431df',
  '47a64d3b-9c4f-4520-b029-78a7fc316085',
  '6001e03d-dc1b-4141-860f-8d70d847a31e',
  'c58eeba8-35bd-4ad0-9e33-4c837dbcb38c',
  '45fa759f-5062-41fe-9932-28e3a656905e',
  'c9ef1ec6-b7dd-4d1d-9080-cdb18b765601',
  'f3e0a55a-7bc3-46cc-8f70-62299b4dcbfd',
  '59775867-8893-40c1-8c15-d44e57261fb4',
  '192f377c-5a42-4a43-99f9-6553bcae50d6',
  '2db7a0b7-e504-47ac-a9b7-70ec189c93c7',
  '8379ce84-ff85-46db-81b0-e3337765c479',
  'c4ffbb42-7c59-4633-b6b1-add3a76d13ba',
  'd74f260a-f962-470f-b73a-d18bb8cdc7ce',
  'a827982f-09c8-47fb-a897-396feb62bba2',
  '12c9298d-7da4-475b-adab-b10cbf0c2332',
  '37c7b35a-a4e9-4c81-ac57-decb98db582e',
  'dd98946e-1141-40c2-bbf1-fabad899c760',
  'ee091db2-a7bd-417f-9890-e6e59f966245',
  '90b2b0e9-88b4-4967-837b-a0bfa2b00371',
  '4b953b35-cba5-45a4-a28a-21499e571aa3',
  '24616254-0473-4061-99d5-fa22d29d010c',
  '8b0c3233-d05d-4aad-bee9-0751f5508514',
  '120e70f9-4418-4ae3-b085-81cf586dc518',
  '35e7340e-dd0d-43a9-9083-125d8066d200',
  '2ff89c5a-2418-4f2e-963b-39231b6bb4a6',
  '09e19a94-9fd1-4465-b599-caf2099865a2',
  '3c438d89-67d7-4802-9fa7-d05a96769699',
  '74b5450a-6721-4ee0-b426-d33dacb21863',
  '4c57c744-f6b0-4254-a106-8ace94700337',
  'd8733492-f144-45af-adfc-8d66fb1148f5',
  '628d7c61-aab5-4bc9-a27f-58f50b4acc06',
  '7186afea-4731-49de-ac9c-ebf83b4faf21',
  '91ae189b-9f5a-4898-830f-db3960fb3a3b',
  '28196068-237a-4d28-b4f0-459f03172933',
  '1901b957-bec1-431a-babf-491c682022fb',
  '02e52673-e23f-4c01-8716-17f46c806040',
  '5366d8ca-44ab-4160-a8ec-f1a5b5de4734',
  '9dc9c903-c8c5-4a71-8d12-0b01fae7889d',
  '90d48510-1cb5-42e7-90c2-f89547e16940',
  '3f3046ff-c51c-4096-a034-00307c147025',
  '9d345747-06be-464e-b045-8531b5570e9c',
  'e5cc98df-09e7-4b21-b14e-5e3d4c3bcd27',
  'f17bb43e-4f57-4d63-b9c1-5f3e8b0df02a',
  '058c54af-529a-432d-81e5-8a9753be2dd6',
  '05dbc370-cc15-4317-a900-65327a87515f',
  'f18b33df-4a89-434e-a11f-7e608f4effc9',
  'c45b1389-0ab9-4011-b535-3e3d6bdc0a2e',
  '7e27784b-f428-45c8-8001-c3d7941076e4',
  '901e84ae-4106-406b-a53e-107b2d5cb337',
  'f62b13ac-67b4-4b4e-91aa-f9b00240a034',
  '6801e837-edb7-42b6-9430-d704fa039a1a',
  '80c3c55b-bd92-4409-b6d8-611613355760',
  '6f05bd27-ac60-474e-9753-3c7e4370bd93',
  '067b6cf5-11f9-4283-b3fb-232a829175e1',
  '9ad2470f-7c3a-472b-85bb-b16014aca3bd',
  '6aa96536-5317-46a6-9c56-91abe743ffdd',
  '2dec5acb-3b60-41c2-bf01-2aa035e02626',
  'ec05e3d6-d87f-4d75-b263-db8de5f1066c',
  '43eeafc5-f5c6-40f8-b28b-59b1a3c65ec0',
  '65e17c62-dc77-44c9-a0c7-5e89f91d8ba3',
  '680a3f1b-9a94-4b77-bd95-d647b8c0a6c1',
  '7c08d714-ca67-4ce1-b9a6-5d3b72b118e3'
);

-- Controprova: deve togliere esattamente 62 righe.
