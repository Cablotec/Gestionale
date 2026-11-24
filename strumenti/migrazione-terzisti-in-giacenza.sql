-- ═══════════════════════════════════════════════════════════════════
-- PASSO 5 DEL RISERVATO: I TERZISTI (24 nov 2026, Nico: «ogni pezzo ha un
-- posto e un padrone»). Il materiale dato a un terzista esce dallo scaffale
-- ed e' riservato alla sua commessa, anche sui codici di Alnus (in Alnus
-- restava nello 01 come se fosse sullo scaffale: il WIP esterno).
--
-- 1. mov_conferma_invio_terzista: verso reparto E terzisti conta tutto
--    tranne MAC e i codici lavorazione _K; il controllo sulla sede vale anche qui.
-- 2. mov_scarica_lotto: il ramo dei codici di Alnus consuma ogni posto fino
--    alla SUA quota (come i C/L di Tema), poi sede, poi altri posti.
--    Un consumo solo con gli UP1 (passo 4) invariato.
-- 3. UNA TANTUM: il materiale ancora presso Bellini e Botturi passa in
--    giacenza. Per commessa, terzista e codice: si annulla tutto il registro
--    fuori giacenza (le liste di prima) e si scrive in giacenza quanto e'
--    ANCORA la': il minimo fra il dato e quota × pezzi ancora da fare.
--    Quantita' confermate da Nico il 24 nov (elenco in chat). MAC e _K esclusi.
--    20 080 2455 ESCLUSO: 85 ai terzisti contro 50 in giacenza, da chiarire.
--    Rilanciabile: la seconda volta non scrive niente.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.mov_conferma_invio_terzista(p_invio uuid, p_righe jsonb,
  p_nota text default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv   record;
  v_op    record;
  v_nome  text;
  v_rep   boolean;
  v_r     record;
  v_rr    jsonb;
  v_q     numeric;
  v_disp  numeric;
  v_conta boolean;
  v_nota  text;
  v_doc   text;
  v_chi   text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_n     integer := 0;
begin
  if not exists (select 1 from profili where id = auth.uid() and ruolo = 'admin') then
    raise exception 'Solo un amministratore puo'' confermare una richiesta';
  end if;
  select * into v_inv from invii_terzista where id = p_invio for update;
  if not found then raise exception 'Richiesta non trovata'; end if;
  if v_inv.stato <> 'da_preparare' then
    raise exception 'Questa richiesta e'' gia'' %', v_inv.stato;
  end if;
  if jsonb_typeof(p_righe) <> 'array' then raise exception 'Righe non valide'; end if;
  select nome, coalesce(is_reparto, false) into v_nome, v_rep from aziende where id = v_inv.terzista_id;

  perform pg_advisory_xact_lock(hashtext('mov_invia_terzista'));

  v_doc  := case when v_rep then 'REPARTO' else 'TERZISTA' end;
  v_nota := case when v_rep then 'In reparto' else 'Invio a ' || coalesce(v_nome, '?') end
            || coalesce(' · ' || (select nome from tipi_lavorazione where id = v_inv.fase_id), '')
            || coalesce(' · ' || nullif(trim(coalesce(p_nota, v_inv.nota)), ''), '');

  for v_r in
    select trim(r->>'codice') as cod, r->>'descrizione' as descr, r->>'um' as um,
           upper(trim(coalesce(r->>'tipo', ''))) as tipo,
           coalesce(nullif(r->>'operazione_id', '')::uuid, v_inv.operazione_id) as op_id
    from jsonb_array_elements(v_inv.righe) r
  loop
    v_q := null;
    select nullif(x->>'qta', '')::numeric into v_q
      from jsonb_array_elements(p_righe) x
     where trim(x->>'codice') = v_r.cod
       and coalesce(nullif(x->>'operazione_id', '')::uuid, v_inv.operazione_id) = v_r.op_id
     limit 1;
    continue when v_q is null or v_q = 0;
    if v_q < 0 then raise exception '%: quantita'' negativa', v_r.cod; end if;

    select id, numero_ordine, pos, riferimento_cliente
      into v_op from operazioni where id = v_r.op_id;
    if not found then raise exception '%: commessa della riga non trovata', v_r.cod; end if;

    -- 24 nov: decide il codice, non la spunta della commessa.
    -- PASSO 5 (24 nov): verso il reparto E i terzisti conta tutto tranne MAC
    -- e i codici lavorazione _K (articoli finti dell'ordine al terzista).
    v_conta := (v_r.tipo = 'C/L' and not codice_di_alnus(v_r.cod))
            or (v_r.tipo <> 'MAC' and v_r.cod !~* '_K[A-Z]?$');
    if v_conta then
      select coalesce(sum(qta), 0) into v_disp from movimenti_magazzino
        where codice = v_r.cod and presso_id is null and not fuori_giacenza;
      if v_q > v_disp then
        raise exception '%: ne sposti % (commessa %/%) ma in sede ne restano %',
          v_r.cod, v_q, v_op.numero_ordine, v_op.pos, v_disp;
      end if;
    end if;
    insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
      documento_tipo, documento_numero, documento_data, documento_pos,
      ordine_rif, note, presso_id, operazione_id, invio_id, fuori_giacenza, creato_da)
    values
      (current_date, 'trasferimento', v_r.cod, v_r.descr, -v_q, v_r.um,
       v_doc, coalesce(v_op.numero_ordine, '') || '/' || coalesce(v_op.pos::text, ''),
       current_date, v_r.cod, v_op.riferimento_cliente, v_nota,
       null, v_op.id, p_invio, not v_conta, v_chi),
      (current_date, 'trasferimento', v_r.cod, v_r.descr, v_q, v_r.um,
       v_doc, coalesce(v_op.numero_ordine, '') || '/' || coalesce(v_op.pos::text, ''),
       current_date, v_r.cod, v_op.riferimento_cliente, v_nota,
       v_inv.terzista_id, v_op.id, p_invio, not v_conta, v_chi);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Nessuna quantita'' da spostare'; end if;

  select jsonb_agg(r || jsonb_build_object('qta_inviata', coalesce(
           (select nullif(x->>'qta', '')::numeric from jsonb_array_elements(p_righe) x
             where trim(x->>'codice') = trim(r->>'codice')
               and coalesce(nullif(x->>'operazione_id', '')::uuid, v_inv.operazione_id)
                 = coalesce(nullif(r->>'operazione_id', '')::uuid, v_inv.operazione_id)
             limit 1), 0)))
    into v_rr from jsonb_array_elements(v_inv.righe) r;
  update invii_terzista set stato = 'inviato', righe = coalesce(v_rr, righe),
    inviato_il = now(), inviato_da = v_chi,
    nota = coalesce(nullif(trim(p_nota), ''), nota)
  where id = p_invio;
  return v_n;
end $$;
revoke all on function public.mov_conferma_invio_terzista(uuid, jsonb, text) from public;
grant execute on function public.mov_conferma_invio_terzista(uuid, jsonb, text) to authenticated;

create or replace function public.mov_scarica_lotto(p_lotto uuid, p_operazione uuid,
  p_data date, p_pezzi numeric, p_tipo text, p_nota text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_op    record;
  v_r     record;
  v_t     record;
  v_rep   uuid;
  v_resto numeric;
  v_q     numeric;
  v_quota numeric;
  v_sede  numeric;
  v_doc   text;
  v_chi   text := lower(coalesce(auth.jwt() ->> 'email', 'database'));
  v_n     integer := 0;
  v_cn    numeric;   -- consumo gia' registrato dai nostri lotti (commessa, codice)
  v_ca    numeric;   -- consumo gia' registrato dagli UP1 di Alnus
  v_c     numeric;   -- parte che CONTA (sposta la giacenza)
  v_f     numeric;   -- parte di solo registro (l'ha gia' consumata Alnus)
begin
  if p_pezzi is null or p_pezzi <= 0 then return 0; end if;
  select id, numero_ordine, pos, quantita, riferimento_cliente, materiali
    into v_op from operazioni where id = p_operazione;
  if not found or jsonb_typeof(v_op.materiali) <> 'array' then
    return 0;
  end if;
  select id into v_rep from aziende where is_reparto limit 1;
  v_doc := coalesce(v_op.numero_ordine, '') || '/' || coalesce(v_op.pos::text, '');

  -- A) C/L che Alnus non conosce (come prima)
  for v_r in
    select trim(r->>'codice') as cod, r->>'descrizione' as descr, r->>'um' as um,
           coalesce(nullif(r->>'qta_pz', '')::numeric,
                    (r->>'qta')::numeric / nullif(v_op.quantita, 0)) as qpz,
           case when jsonb_typeof(r->'fasi_esterne') = 'object' then r->'fasi_esterne' else '{}'::jsonb end as fe
    from jsonb_array_elements(v_op.materiali) r
    where upper(trim(coalesce(r->>'tipo', ''))) = 'C/L'
      and coalesce(trim(r->>'codice'), '') <> ''
      and not codice_di_alnus(r->>'codice')
      and coalesce(nullif(r->>'qta_pz', '')::numeric, (r->>'qta')::numeric) > 0
  loop
    v_resto := round((v_r.qpz * p_pezzi)::numeric, 4);
    continue when v_resto is null or v_resto <= 0;

    -- 1) Ogni posto di QUESTA commessa, fino alla sua quota.
    for v_t in
      select presso_id, sum(qta) as s from movimenti_magazzino
      where operazione_id = p_operazione and codice = v_r.cod and presso_id is not null
        and not fuori_giacenza
      group by presso_id having sum(qta) > 0 order by presso_id
    loop
      exit when v_resto <= 0;
      if v_t.presso_id = v_rep then
        select greatest(0, v_r.qpz - coalesce(sum(nullif(value, '')::numeric), 0)) into v_quota
          from jsonb_each_text(v_r.fe);
      else
        v_quota := coalesce(nullif(v_r.fe->>(v_t.presso_id::text), '')::numeric, 0);
      end if;
      v_q := least(v_resto, v_t.s, round((v_quota * p_pezzi)::numeric, 4));
      continue when v_q is null or v_q <= 0;
      insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
        documento_tipo, documento_numero, documento_data, documento_pos,
        ordine_rif, note, lotto_id, presso_id, operazione_id, creato_da)
      values (p_data, p_tipo, v_r.cod, v_r.descr, -v_q, v_r.um, 'PRODUZIONE', v_doc,
        p_data, v_r.cod, v_op.riferimento_cliente, p_nota, p_lotto, v_t.presso_id, p_operazione, v_chi);
      v_n := v_n + 1;
      v_resto := v_resto - v_q;
    end loop;

    -- 2) Il resto dalla sede, fin dove c'e'.
    if v_resto > 0 then
      select coalesce(sum(qta), 0) into v_sede from movimenti_magazzino
        where codice = v_r.cod and presso_id is null and not fuori_giacenza;
      v_q := least(v_resto, greatest(v_sede, 0));
      if v_q > 0 then
        insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
          documento_tipo, documento_numero, documento_data, documento_pos,
          ordine_rif, note, lotto_id, presso_id, operazione_id, creato_da)
        values (p_data, p_tipo, v_r.cod, v_r.descr, -v_q, v_r.um, 'PRODUZIONE', v_doc,
          p_data, v_r.cod, v_op.riferimento_cliente, p_nota, p_lotto, null, p_operazione, v_chi);
        v_n := v_n + 1;
        v_resto := v_resto - v_q;
      end if;
    end if;

    -- 3) Ultima risorsa: quello che resta negli altri posti della commessa.
    if v_resto > 0 then
      for v_t in
        select presso_id, sum(qta) as s from movimenti_magazzino
        where operazione_id = p_operazione and codice = v_r.cod and presso_id is not null
          and not fuori_giacenza
        group by presso_id having sum(qta) > 0 order by presso_id
      loop
        exit when v_resto <= 0;
        v_q := least(v_resto, v_t.s);
        continue when v_q <= 0;
        insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
          documento_tipo, documento_numero, documento_data, documento_pos,
          ordine_rif, note, lotto_id, presso_id, operazione_id, creato_da)
        values (p_data, p_tipo, v_r.cod, v_r.descr, -v_q, v_r.um, 'PRODUZIONE', v_doc,
          p_data, v_r.cod, v_op.riferimento_cliente, p_nota, p_lotto, v_t.presso_id, p_operazione, v_chi);
        v_n := v_n + 1;
        v_resto := v_resto - v_q;
      end loop;
    end if;

    -- 4) Se ancora non basta, la sede va in negativo.
    if v_resto > 0 then
      insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
        documento_tipo, documento_numero, documento_data, documento_pos,
        ordine_rif, note, lotto_id, presso_id, operazione_id, creato_da)
      values (p_data, p_tipo, v_r.cod, v_r.descr, -v_resto, v_r.um, 'PRODUZIONE', v_doc,
        p_data, v_r.cod, v_op.riferimento_cliente, p_nota, p_lotto, null, p_operazione, v_chi);
      v_n := v_n + 1;
    end if;
  end loop;

  -- B) codici di Alnus (tranne MAC e _K): il nostro lotto e' il nostro UP1.
  --    PASSO 5 (24 nov): come il ramo A, ogni posto della commessa fino alla
  --    SUA quota (reparto = il resto, terzista = fasi_esterne), poi la sede,
  --    poi gli altri posti, poi la sede sotto zero. Un consumo solo con gli UP1.
  for v_r in
    select trim(r->>'codice') as cod, r->>'descrizione' as descr, r->>'um' as um,
           coalesce(nullif(r->>'qta_pz', '')::numeric,
                    (r->>'qta')::numeric / nullif(v_op.quantita, 0)) as qpz,
           case when jsonb_typeof(r->'fasi_esterne') = 'object' then r->'fasi_esterne' else '{}'::jsonb end as fe
    from jsonb_array_elements(v_op.materiali) r
    where upper(trim(coalesce(r->>'tipo', ''))) <> 'MAC'
      and coalesce(trim(r->>'codice'), '') <> ''
      and trim(r->>'codice') !~* '_K[A-Z]?$'
      and codice_di_alnus(r->>'codice')
      and coalesce(nullif(r->>'qta_pz', '')::numeric, (r->>'qta')::numeric) > 0
  loop
    v_q := round((v_r.qpz * p_pezzi)::numeric, 4);
    continue when v_q is null or v_q <= 0;
    select n, a into v_cn, v_ca from consumo_commessa(p_operazione, v_r.cod);
    v_c := greatest(v_cn + v_q, v_ca) - greatest(v_cn, v_ca);
    v_f := v_q - v_c;
    v_resto := v_c;
    -- 1) ogni posto della commessa, fino alla sua quota
    for v_t in
      select presso_id, sum(qta) as s from movimenti_magazzino
      where operazione_id = p_operazione and upper(trim(codice)) = upper(v_r.cod) and presso_id is not null
        and not fuori_giacenza
      group by presso_id having sum(qta) > 0 order by presso_id
    loop
      exit when v_resto <= 0;
      if v_t.presso_id = v_rep then
        select greatest(0, v_r.qpz - coalesce(sum(nullif(value, '')::numeric), 0)) into v_quota
          from jsonb_each_text(v_r.fe);
      else
        v_quota := coalesce(nullif(v_r.fe->>(v_t.presso_id::text), '')::numeric, 0);
      end if;
      v_q := least(v_resto, v_t.s, round((v_quota * p_pezzi)::numeric, 4));
      continue when v_q is null or v_q <= 0;
      insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
        documento_tipo, documento_numero, documento_data, documento_pos,
        ordine_rif, note, lotto_id, presso_id, operazione_id, creato_da)
      values (p_data, p_tipo, v_r.cod, v_r.descr, -v_q, v_r.um, 'PRODUZIONE', v_doc,
        p_data, v_r.cod, v_op.riferimento_cliente, p_nota, p_lotto, v_t.presso_id, p_operazione, v_chi);
      v_n := v_n + 1;
      v_resto := v_resto - v_q;
    end loop;
    -- 2) la sede, fin dove c'e'
    if v_resto > 0 then
      select coalesce(sum(qta), 0) into v_sede from movimenti_magazzino
        where upper(trim(codice)) = upper(v_r.cod) and presso_id is null and not fuori_giacenza;
      v_q := least(v_resto, greatest(v_sede, 0));
      if v_q > 0 then
      insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
        documento_tipo, documento_numero, documento_data, documento_pos,
        ordine_rif, note, lotto_id, presso_id, operazione_id, creato_da)
      values (p_data, p_tipo, v_r.cod, v_r.descr, -v_q, v_r.um, 'PRODUZIONE', v_doc,
        p_data, v_r.cod, v_op.riferimento_cliente, p_nota, p_lotto, null, p_operazione, v_chi);
        v_n := v_n + 1;
        v_resto := v_resto - v_q;
      end if;
    end if;
    -- 3) gli altri posti della commessa (oltre la quota)
    if v_resto > 0 then
      for v_t in
        select presso_id, sum(qta) as s from movimenti_magazzino
        where operazione_id = p_operazione and upper(trim(codice)) = upper(v_r.cod) and presso_id is not null
          and not fuori_giacenza
        group by presso_id having sum(qta) > 0 order by presso_id
      loop
        exit when v_resto <= 0;
        v_q := least(v_resto, v_t.s);
        continue when v_q <= 0;
      insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
        documento_tipo, documento_numero, documento_data, documento_pos,
        ordine_rif, note, lotto_id, presso_id, operazione_id, creato_da)
      values (p_data, p_tipo, v_r.cod, v_r.descr, -v_q, v_r.um, 'PRODUZIONE', v_doc,
        p_data, v_r.cod, v_op.riferimento_cliente, p_nota, p_lotto, v_t.presso_id, p_operazione, v_chi);
        v_n := v_n + 1;
        v_resto := v_resto - v_q;
      end loop;
    end if;
    -- 4) la sede sotto zero (il rosso dice che manca un carico)
    if v_resto > 0 then
      insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
        documento_tipo, documento_numero, documento_data, documento_pos,
        ordine_rif, note, lotto_id, presso_id, operazione_id, creato_da)
      values (p_data, p_tipo, v_r.cod, v_r.descr, -v_resto, v_r.um, 'PRODUZIONE', v_doc,
        p_data, v_r.cod, v_op.riferimento_cliente, p_nota, p_lotto, null, p_operazione, v_chi);
      v_n := v_n + 1;
    end if;
    -- 5) la parte gia' consumata da Alnus: solo registro
    if v_f > 0 then
      insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
        documento_tipo, documento_numero, documento_data, documento_pos,
        ordine_rif, note, lotto_id, presso_id, operazione_id, fuori_giacenza, creato_da)
      values (p_data, p_tipo, v_r.cod, v_r.descr, -v_f, v_r.um, 'PRODUZIONE', v_doc,
        p_data, v_r.cod, v_op.riferimento_cliente, coalesce(p_nota || ' · ', '') || 'gia'' consumato da Alnus (UP1)', p_lotto, null, p_operazione, true, v_chi);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.mov_scarica_lotto(uuid, uuid, date, numeric, text, text) from public;

-- 3. UNA TANTUM: materiale ancora presso i terzisti in giacenza.
with v (op, ter, codice, resta) as (values
  ('32298d85-da5d-421f-b71d-2f3160f1d0b0'::uuid, '46e5dc67-aa98-4db9-9579-9d8cb06a7a87'::uuid, '8471E0PVC000PLA0008Y', 24.96),
  ('5f2ef9d9-c2f0-41f1-bc02-8ad596a0d6b1'::uuid, '46e5dc67-aa98-4db9-9579-9d8cb06a7a87'::uuid, '8471E0PVC000PLA0008Y', 48.36),
  ('bbe82e60-2279-4f47-a2ab-f9fb96e4293a'::uuid, '46e5dc67-aa98-4db9-9579-9d8cb06a7a87'::uuid, '8471E0PVC000PLA0008Y', 23.4),
  ('32298d85-da5d-421f-b71d-2f3160f1d0b0'::uuid, '46e5dc67-aa98-4db9-9579-9d8cb06a7a87'::uuid, '8471E0PVC000PLA0010K', 12.8),
  ('5f2ef9d9-c2f0-41f1-bc02-8ad596a0d6b1'::uuid, '46e5dc67-aa98-4db9-9579-9d8cb06a7a87'::uuid, '8471E0PVC000PLA0010K', 24.8),
  ('bbe82e60-2279-4f47-a2ab-f9fb96e4293a'::uuid, '46e5dc67-aa98-4db9-9579-9d8cb06a7a87'::uuid, '8471E0PVC000PLA0010K', 12),
  ('32298d85-da5d-421f-b71d-2f3160f1d0b0'::uuid, '46e5dc67-aa98-4db9-9579-9d8cb06a7a87'::uuid, '8471E0PVC000TUBPVC04', 21.12),
  ('5f2ef9d9-c2f0-41f1-bc02-8ad596a0d6b1'::uuid, '46e5dc67-aa98-4db9-9579-9d8cb06a7a87'::uuid, '8471E0PVC000TUBPVC04', 40.92),
  ('bbe82e60-2279-4f47-a2ab-f9fb96e4293a'::uuid, '46e5dc67-aa98-4db9-9579-9d8cb06a7a87'::uuid, '8471E0PVC000TUBPVC04', 19.8),
  ('32298d85-da5d-421f-b71d-2f3160f1d0b0'::uuid, '46e5dc67-aa98-4db9-9579-9d8cb06a7a87'::uuid, '8471F003216458QI29A0', 16),
  ('5f2ef9d9-c2f0-41f1-bc02-8ad596a0d6b1'::uuid, '46e5dc67-aa98-4db9-9579-9d8cb06a7a87'::uuid, '8471F003216458QI29A0', 31),
  ('bbe82e60-2279-4f47-a2ab-f9fb96e4293a'::uuid, '46e5dc67-aa98-4db9-9579-9d8cb06a7a87'::uuid, '8471F003216458QI29A0', 15),
  ('32298d85-da5d-421f-b71d-2f3160f1d0b0'::uuid, '46e5dc67-aa98-4db9-9579-9d8cb06a7a87'::uuid, 'FLAT10P', 17.92),
  ('5f2ef9d9-c2f0-41f1-bc02-8ad596a0d6b1'::uuid, '46e5dc67-aa98-4db9-9579-9d8cb06a7a87'::uuid, 'FLAT10P', 34.72),
  ('bbe82e60-2279-4f47-a2ab-f9fb96e4293a'::uuid, '46e5dc67-aa98-4db9-9579-9d8cb06a7a87'::uuid, 'FLAT10P', 16.8),
  ('df24c431-ebbb-4132-b0dc-ec7099174cc8'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 130 0035', 35),
  ('df24c431-ebbb-4132-b0dc-ec7099174cc8'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 130 0165', 105),
  ('df24c431-ebbb-4132-b0dc-ec7099174cc8'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 135 0725', 35),
  ('df24c431-ebbb-4132-b0dc-ec7099174cc8'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 135 0765', 35),
  ('df24c431-ebbb-4132-b0dc-ec7099174cc8'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 170 0039', 11.9),
  ('df24c431-ebbb-4132-b0dc-ec7099174cc8'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 170 0040', 11.55),
  ('df24c431-ebbb-4132-b0dc-ec7099174cc8'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 170 0043', 11.9),
  ('df24c431-ebbb-4132-b0dc-ec7099174cc8'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 205 0016', 3.675),
  ('df24c431-ebbb-4132-b0dc-ec7099174cc8'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 205 0026', 1.05),
  ('df24c431-ebbb-4132-b0dc-ec7099174cc8'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 205 0039', 5.95),
  ('2252404e-e871-4fa6-8b4c-e4e978c5c2f2'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 095 0146', 50),
  ('3ae21f7e-b8b6-48b7-867c-d059dcaef09c'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 095 0155', 100),
  ('40c4f1df-20a9-4daa-ba18-0faea2b09e18'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 095 1890', 250),
  ('c4752f50-a44c-438f-9260-4f6a3460d6de'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 095 3410', 83),
  ('c4752f50-a44c-438f-9260-4f6a3460d6de'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 130 0035', 200),
  ('65457b52-936b-4492-a63a-2cc0847e68ae'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 130 0035', 100),
  ('8845d31f-44d0-48df-93bb-de15599da840'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 130 0035', 200),
  ('40c4f1df-20a9-4daa-ba18-0faea2b09e18'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 130 0165', 500),
  ('65457b52-936b-4492-a63a-2cc0847e68ae'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 130 0165', 300),
  ('8845d31f-44d0-48df-93bb-de15599da840'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 130 0165', 600),
  ('c4752f50-a44c-438f-9260-4f6a3460d6de'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 130 0195', 200),
  ('c4752f50-a44c-438f-9260-4f6a3460d6de'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 130 0235', 200),
  ('65457b52-936b-4492-a63a-2cc0847e68ae'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 135 0725', 100),
  ('8845d31f-44d0-48df-93bb-de15599da840'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 135 0725', 200),
  ('65457b52-936b-4492-a63a-2cc0847e68ae'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 135 0765', 100),
  ('8845d31f-44d0-48df-93bb-de15599da840'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 135 0765', 200),
  ('65457b52-936b-4492-a63a-2cc0847e68ae'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 170 0039', 34),
  ('8845d31f-44d0-48df-93bb-de15599da840'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 170 0039', 68),
  ('65457b52-936b-4492-a63a-2cc0847e68ae'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 170 0040', 33),
  ('8845d31f-44d0-48df-93bb-de15599da840'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 170 0040', 66),
  ('65457b52-936b-4492-a63a-2cc0847e68ae'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 170 0043', 34),
  ('8845d31f-44d0-48df-93bb-de15599da840'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 170 0043', 68),
  ('40c4f1df-20a9-4daa-ba18-0faea2b09e18'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 170 0045', 47.5),
  ('40c4f1df-20a9-4daa-ba18-0faea2b09e18'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 170 0046', 47.5),
  ('c4752f50-a44c-438f-9260-4f6a3460d6de'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 170 0216', 45),
  ('65457b52-936b-4492-a63a-2cc0847e68ae'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 205 0016', 10.5),
  ('8845d31f-44d0-48df-93bb-de15599da840'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 205 0016', 21),
  ('c4752f50-a44c-438f-9260-4f6a3460d6de'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 205 0026', 3),
  ('40c4f1df-20a9-4daa-ba18-0faea2b09e18'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 205 0026', 7.5),
  ('65457b52-936b-4492-a63a-2cc0847e68ae'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 205 0026', 3),
  ('8845d31f-44d0-48df-93bb-de15599da840'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 205 0026', 6),
  ('40c4f1df-20a9-4daa-ba18-0faea2b09e18'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 205 0039', 40),
  ('65457b52-936b-4492-a63a-2cc0847e68ae'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 205 0039', 17),
  ('8845d31f-44d0-48df-93bb-de15599da840'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '05 205 0039', 34),
  ('3ae21f7e-b8b6-48b7-867c-d059dcaef09c'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '30 010 0690', 100),
  ('2252404e-e871-4fa6-8b4c-e4e978c5c2f2'::uuid, 'b577fc6d-e224-4306-bf95-76c22d446f39'::uuid, '30 010 0695', 50)
), dato as (
  select v.op, v.ter, v.codice, v.resta, max(m.descrizione) as descr, max(m.um) as um, sum(m.qta) as fuori
  from v join movimenti_magazzino m on m.operazione_id = v.op and m.presso_id = v.ter and m.codice = v.codice and m.fuori_giacenza
  group by v.op, v.ter, v.codice, v.resta
  having sum(m.qta) > 0
), t as (
  select d.*, coalesce(o.numero_ordine, '') || '/' || coalesce(o.pos::text, '') as doc, o.riferimento_cliente as orif
  from dato d join operazioni o on o.id = d.op
  where not exists (select 1 from movimenti_magazzino x
                    where x.documento_numero = coalesce(o.numero_ordine, '') || '/' || coalesce(o.pos::text, '') || ' terzista in giacenza'
                      and x.codice = d.codice and x.presso_id = d.ter)
)
insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um, documento_tipo, documento_numero, documento_data,
  documento_pos, ordine_rif, note, presso_id, operazione_id, fuori_giacenza, creato_da)
select current_date, 'trasferimento', t.codice, t.descr, x.q, t.um, 'TERZISTA', t.doc || ' terzista in giacenza', current_date,
  t.codice, t.orif, 'Il materiale ancora dal terzista passa in giacenza (passo 5 del riservato)', x.presso, t.op, x.fuori, 'passo 5 · 24/11'
from t cross join lateral (values (-t.fuori, t.ter, true), (t.fuori, null::uuid, true),
                                  (-t.resta, null::uuid, false), (t.resta, t.ter, false)) x(q, presso, fuori);

-- Verifica (sola lettura): attesi 61 righe commessa/codice in giacenza e 0 sedi sotto zero.
select
  (select count(*) from (select operazione_id, codice from movimenti_magazzino
     where documento_numero like '% terzista in giacenza' and not fuori_giacenza and presso_id is not null
     group by operazione_id, codice having sum(qta) > 0) a) as righe_in_giacenza,
  (select count(*) from (select s.codice from movimenti_magazzino s
     where s.presso_id is null and not s.fuori_giacenza
       and s.codice in (select codice from movimenti_magazzino where documento_numero like '% terzista in giacenza')
     group by s.codice having sum(s.qta) < 0) b) as sedi_sotto_zero;
