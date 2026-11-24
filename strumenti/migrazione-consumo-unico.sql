-- ═══════════════════════════════════════════════════════════════════
-- PASSI 3 E 4 DEL RISERVATO: UN CONSUMO SOLO (24 nov 2026, Nico: «ogni pezzo
-- ha un posto e un padrone»; il gestionale fa i suoi gesti, Alnus conferma).
--
-- PASSO 3: il LOTTO di produzione consuma anche i codici di Alnus (tutti
--   tranne MAC): dal reparto della commessa, poi dalla sede. E' il nostro UP1.
-- PASSO 4: l'UP1 di Alnus di un OP che e' una nostra commessa non consuma una
--   seconda volta.
-- LA REGOLA, per commessa e codice: consumo in giacenza = il PIU' GRANDE fra
--   quello dei nostri lotti (N) e quello degli UP1 importati (A). Chi arriva
--   secondo scrive in giacenza solo l'eccedenza; il resto e' registro (fuori
--   giacenza) con la nota «gia' consumato da …». Si corregge da sola: se uno
--   dei due e' in ritardo la giacenza resta indietro, ma non scende mai due volte.
--   L'UP1 che conta consuma prima dal reparto della commessa (il materiale e'
--   sul banco), poi dalla sede.
-- L'annullo di un lotto restituisce in giacenza solo quanto serve a tornare al
--   piu' grande fra lotti rimasti e UP1; il resto torna come registro.
-- UT1/ET1 di Alnus non cambiano: 01 e WIP sono entrambi sede (netto zero).
-- I C/L che Alnus non conosce (TS- di Tema): esattamente come prima.
-- Verificato il 24 nov: nessun UP1 e' ancora entrato nei movimenti reali
-- (nessun dato da sistemare); 52 UP1 su 83 dello Specchio sono di OP con una
-- nostra commessa.
-- ═══════════════════════════════════════════════════════════════════

-- Il consumo gia' registrato per una commessa e un codice: N dai lotti
-- (PRODUZIONE, in giacenza e no, al netto degli annulli), A dagli UP1.
create or replace function public.consumo_commessa(p_op uuid, p_cod text)
returns table (n numeric, a numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(-sum(qta) filter (where documento_tipo = 'PRODUZIONE'), 0),
         coalesce(-sum(qta) filter (where documento_tipo = 'ALNUS' and documento_numero like '%/UP1/%'), 0)
  from movimenti_magazzino
  where operazione_id = p_op and upper(trim(codice)) = upper(trim(p_cod));
$$;
revoke all on function public.consumo_commessa(uuid, text) from public, anon, authenticated;

-- ── PASSO 3: lo scarico del lotto ───────────────────────────────────
-- A) i C/L che Alnus non conosce: IDENTICO a prima (migrazione-spunta-per-codice).
-- B) i codici di Alnus (tranne MAC): un consumo solo con gli UP1.
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

  -- B) PASSO 3: i codici di Alnus (tutti tranne MAC). Il nostro lotto e' il
  --    nostro UP1: consuma dal reparto della commessa, poi dalla sede.
  --    Un consumo solo con gli UP1 di Alnus (vedi in testa).
  for v_r in
    select trim(r->>'codice') as cod, r->>'descrizione' as descr, r->>'um' as um,
           coalesce(nullif(r->>'qta_pz', '')::numeric,
                    (r->>'qta')::numeric / nullif(v_op.quantita, 0)) as qpz
    from jsonb_array_elements(v_op.materiali) r
    where upper(trim(coalesce(r->>'tipo', ''))) <> 'MAC'
      and coalesce(trim(r->>'codice'), '') <> ''
      and codice_di_alnus(r->>'codice')
      and coalesce(nullif(r->>'qta_pz', '')::numeric, (r->>'qta')::numeric) > 0
  loop
    v_q := round((v_r.qpz * p_pezzi)::numeric, 4);
    continue when v_q is null or v_q <= 0;
    select n, a into v_cn, v_ca from consumo_commessa(p_operazione, v_r.cod);
    v_c := greatest(v_cn + v_q, v_ca) - greatest(v_cn, v_ca);
    v_f := v_q - v_c;
    v_resto := v_c;
    -- 1) dai posti della commessa che contano (reparto per primo)
    for v_t in
      select presso_id, sum(qta) as s from movimenti_magazzino
      where operazione_id = p_operazione and upper(trim(codice)) = upper(v_r.cod) and presso_id is not null
        and not fuori_giacenza
      group by presso_id having sum(qta) > 0 order by (presso_id = v_rep) desc, presso_id
    loop
      exit when v_resto <= 0;
      v_q := least(v_resto, v_t.s);
      insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
        documento_tipo, documento_numero, documento_data, documento_pos,
        ordine_rif, note, lotto_id, presso_id, operazione_id, creato_da)
      values (p_data, p_tipo, v_r.cod, v_r.descr, -v_q, v_r.um, 'PRODUZIONE', v_doc,
        p_data, v_r.cod, v_op.riferimento_cliente, p_nota, p_lotto, v_t.presso_id, p_operazione, v_chi);
      v_n := v_n + 1;
      v_resto := v_resto - v_q;
    end loop;
    -- 2) il resto dalla sede (anche sotto zero: il rosso dice che manca un carico)
    if v_resto > 0 then
      insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
        documento_tipo, documento_numero, documento_data, documento_pos,
        ordine_rif, note, lotto_id, presso_id, operazione_id, creato_da)
      values (p_data, p_tipo, v_r.cod, v_r.descr, -v_resto, v_r.um, 'PRODUZIONE', v_doc,
        p_data, v_r.cod, v_op.riferimento_cliente, p_nota, p_lotto, null, p_operazione, v_chi);
      v_n := v_n + 1;
    end if;
    -- 3) la parte gia' consumata da Alnus: solo registro
    if v_f > 0 then
      insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
        documento_tipo, documento_numero, documento_data, documento_pos,
        ordine_rif, note, lotto_id, presso_id, operazione_id, fuori_giacenza, creato_da)
      values (p_data, p_tipo, v_r.cod, v_r.descr, -v_f, v_r.um, 'PRODUZIONE', v_doc,
        p_data, v_r.cod, v_op.riferimento_cliente, coalesce(p_nota || ' · ', '') || 'gia'' consumato da Alnus (UP1)',
        p_lotto, null, p_operazione, true, v_chi);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.mov_scarica_lotto(uuid, uuid, date, numeric, text, text) from public;

-- ── L'annullo del lotto ─────────────────────────────────────────────
-- TS- e codici senza commessa: come prima, posto per posto (e ora anche
-- «in giacenza o no» come era uscito). Codici di Alnus: in giacenza torna solo
-- quanto serve a riportare il consumo al piu' grande fra lotti rimasti e UP1.
create or replace function public.mov_annulla_lotto(p_lotto uuid, p_nota text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n   integer := 0;
  v_g   record;
  v_t   record;
  v_cn  numeric;
  v_ca  numeric;
  v_rc  numeric;   -- quanto restituire IN giacenza
  v_tot numeric;   -- quanto restituire in tutto
  v_x   numeric;
  v_chi text := lower(coalesce(auth.jwt() ->> 'email', 'database'));
begin
  for v_g in
    select codice, operazione_id, -sum(qta) as l, max(descrizione) as descr, max(um) as um,
           max(documento_numero) as dn, max(documento_data) as dd, max(ordine_rif) as orif
    from movimenti_magazzino where lotto_id = p_lotto
    group by codice, operazione_id having sum(qta) <> 0
  loop
    if v_g.operazione_id is null or v_g.l <= 0 or not codice_di_alnus(v_g.codice) then
      insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
        documento_tipo, documento_numero, documento_data, documento_pos,
        ordine_rif, note, lotto_id, presso_id, operazione_id, fuori_giacenza, creato_da)
      select current_date, 'rettifica', m.codice, v_g.descr, -sum(m.qta), v_g.um,
             'PRODUZIONE', v_g.dn, v_g.dd, m.codice, v_g.orif, p_nota, p_lotto, m.presso_id, m.operazione_id,
             m.fuori_giacenza, v_chi
      from movimenti_magazzino m
      where m.lotto_id = p_lotto and m.codice = v_g.codice and m.operazione_id is not distinct from v_g.operazione_id
      group by m.codice, m.presso_id, m.operazione_id, m.fuori_giacenza
      having sum(m.qta) <> 0;
      v_n := v_n + 1;
      continue;
    end if;
    select n, a into v_cn, v_ca from consumo_commessa(v_g.operazione_id, v_g.codice);
    v_rc := greatest(v_cn, v_ca) - greatest(v_cn - v_g.l, v_ca);
    v_tot := v_g.l;
    for v_t in
      select presso_id, -sum(qta) as s from movimenti_magazzino
      where lotto_id = p_lotto and codice = v_g.codice and operazione_id = v_g.operazione_id and not fuori_giacenza
      group by presso_id having sum(qta) < 0 order by (presso_id is not null) desc, presso_id
    loop
      exit when v_rc <= 0;
      v_x := least(v_rc, v_t.s);
      insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um, documento_tipo, documento_numero, documento_data,
        documento_pos, ordine_rif, note, lotto_id, presso_id, operazione_id, creato_da)
      values (current_date, 'rettifica', v_g.codice, v_g.descr, v_x, v_g.um, 'PRODUZIONE', v_g.dn, v_g.dd,
        v_g.codice, v_g.orif, p_nota, p_lotto, v_t.presso_id, v_g.operazione_id, v_chi);
      v_rc := v_rc - v_x; v_tot := v_tot - v_x;
    end loop;
    if v_rc > 0 then
      insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um, documento_tipo, documento_numero, documento_data,
        documento_pos, ordine_rif, note, lotto_id, presso_id, operazione_id, creato_da)
      values (current_date, 'rettifica', v_g.codice, v_g.descr, v_rc, v_g.um, 'PRODUZIONE', v_g.dn, v_g.dd,
        v_g.codice, v_g.orif, p_nota, p_lotto, null, v_g.operazione_id, v_chi);
      v_tot := v_tot - v_rc;
    end if;
    if v_tot > 0 then
      insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um, documento_tipo, documento_numero, documento_data,
        documento_pos, ordine_rif, note, lotto_id, presso_id, operazione_id, fuori_giacenza, creato_da)
      values (current_date, 'rettifica', v_g.codice, v_g.descr, v_tot, v_g.um, 'PRODUZIONE', v_g.dn, v_g.dd,
        v_g.codice, v_g.orif, coalesce(p_nota || ' · ', '') || 'resta consumato da Alnus (UP1)', p_lotto, null,
        v_g.operazione_id, true, v_chi);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.mov_annulla_lotto(uuid, text) from public;

-- ── PASSO 4: l'allineamento dei movimenti di Alnus ──────────────────
-- Come prima (migrazione-movimenti-alnus-reali.sql) piu': ogni riga di un OP
-- porta la sua commessa (`operazione_id`), e gli UP1 di un OP che e' una
-- nostra commessa passano dal giro 3 (un consumo solo col nostro lotto).
create or replace function public.mov_allinea_alnus()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_foto      alnus_fotografie%rowtype;
  v_aperture  integer := 0;
  v_movimenti integer := 0;
  v_gia       boolean;
  v_m         record;
  v_t         record;
  v_op        uuid;
  v_key       text;
  v_mag       text;
  v_nota      text;
  v_data      date;
  v_u         numeric;
  v_cn        numeric;
  v_ca        numeric;
  v_c         numeric;
  v_f         numeric;
  v_q         numeric;
  v_i         integer;
  v_rep       uuid;
begin
  if not exists (select 1 from profili where id = auth.uid() and ruolo = 'admin') then
    raise exception 'Solo un amministratore puo'' allineare i movimenti di Alnus';
  end if;

  select * into v_foto from alnus_fotografie
    where tipo = 'giacenze' and apertura order by preso_il desc limit 1;
  if v_foto.id is null then raise exception 'Manca la foto d''apertura delle giacenze nello Specchio Alnus'; end if;

  -- 1. APERTURA (una volta per foto) — invariata
  select exists (select 1 from movimenti_magazzino
    where documento_tipo = 'APERTURA' and documento_numero = v_foto.id::text) into v_gia;
  if not v_gia then
    with foto as (
      select upper(trim(codice)) as codice, max(descrizione) as descrizione, max(um) as um, sum(qta) as qta
      from alnus_giacenze
      where fotografia_id = v_foto.id and upper(trim(magazzino)) in ('01', '02', 'WIP')
      group by upper(trim(codice))
    ),
    di_alnus as (
      select upper(trim(codice)) as codice from alnus_giacenze
      union select upper(trim(codice)) from alnus_movimenti
    ),
    saldo as (
      select upper(trim(codice)) as codice, sum(qta) as qta
      from movimenti_magazzino
      where presso_id is null and not coalesce(fuori_giacenza, false)
        and coalesce(creato_il, now()) <= v_foto.preso_il
      group by upper(trim(codice))
    ),
    righe as (
      select coalesce(f.codice, s.codice) as codice, f.descrizione, f.um,
             coalesce(f.qta, 0) - coalesce(s.qta, 0) as delta,
             coalesce(f.qta, 0) as foto
      from foto f full join saldo s on s.codice = f.codice
      where f.codice is not null or s.codice in (select codice from di_alnus)
    )
    insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um, mittente,
      documento_tipo, documento_numero, documento_pos, documento_data, note, creato_da, creato_il)
    select v_foto.preso_il::date, 'rettifica', r.codice, r.descrizione, r.delta, r.um, 'Alnus',
      'APERTURA', v_foto.id::text, r.codice, v_foto.preso_il::date,
      'Apertura da Alnus · foto del ' || to_char(v_foto.preso_il at time zone 'Europe/Rome', 'DD/MM/YYYY HH24:MI')
        || ' · giacenza ' || rtrim(to_char(r.foto, 'FM999999990.###'), '.'),
      'alnus', v_foto.preso_il
    from righe r
    where r.delta <> 0 or r.foto <> 0;
    get diagnostics v_aperture = row_count;
  end if;

  -- 2. MOVIMENTI dopo la foto (tranne gli UP1 di una nostra commessa)
  insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um, mittente,
    documento_tipo, documento_numero, documento_pos, documento_data, note, creato_da, creato_il, operazione_id)
  select (m.data at time zone 'Europe/Rome')::date,
    case when upper(m.causale) in ('ER1', 'UR1') then 'rettifica'
         when upper(m.causale) like 'UT%' or upper(m.causale) like 'ET%' then 'trasferimento'
         when m.qta >= 0 then 'carico' else 'scarico' end,
    upper(trim(m.codice)), m.descrizione, m.qta, m.um, coalesce(nullif(trim(m.soggetto), ''), 'Alnus'),
    'ALNUS', m.eser || '/' || upper(m.causale) || '/' || m.numero, upper(trim(m.magazzino)),
    (m.data at time zone 'Europe/Rome')::date,
    'Alnus · ' || upper(m.causale) || ' · mag ' || upper(trim(m.magazzino))
      || coalesce(' · ' || nullif(trim(m.tipo_doc), '') || ' ' || coalesce(m.anno_doc::text || '/', '') || m.numero_doc, '')
      || coalesce(' · ' || nullif(trim(m.operatore), ''), ''),
    'alnus', m.data,
    (select o.id from operazioni o where upper(coalesce(m.tipo_doc, '')) = 'OP'
       and o.numero_op = m.anno_doc || '/OP/' || lpad(m.numero_doc::text, 5, '0') limit 1)
  from alnus_movimenti m
  where m.data > v_foto.preso_il and upper(trim(m.magazzino)) in ('01', '02', 'WIP')
    and not (upper(m.causale) = 'UP1' and upper(coalesce(m.tipo_doc, '')) = 'OP'
             and exists (select 1 from operazioni o where o.numero_op = m.anno_doc || '/OP/' || lpad(m.numero_doc::text, 5, '0')))
  on conflict do nothing;
  get diagnostics v_movimenti = row_count;

  -- 3. PASSO 4: UP1 di un OP che e' una nostra commessa (un consumo solo).
  select id into v_rep from aziende where is_reparto limit 1;
  for v_m in
    select m.*, (select o.id from operazioni o where o.numero_op = m.anno_doc || '/OP/' || lpad(m.numero_doc::text, 5, '0') limit 1) as op_id
    from alnus_movimenti m
    where m.data > v_foto.preso_il and upper(trim(m.magazzino)) in ('01', '02', 'WIP')
      and upper(m.causale) = 'UP1' and upper(coalesce(m.tipo_doc, '')) = 'OP'
    order by m.data, m.numero
  loop
    continue when v_m.op_id is null;
    v_key := v_m.eser || '/UP1/' || v_m.numero;
    continue when exists (select 1 from movimenti_magazzino where documento_tipo = 'ALNUS' and documento_numero = v_key
                          and upper(trim(codice)) = upper(trim(v_m.codice)));
    v_op := v_m.op_id;
    v_mag := upper(trim(v_m.magazzino));
    v_data := (v_m.data at time zone 'Europe/Rome')::date;
    v_nota := 'Alnus · UP1 · mag ' || v_mag || ' · OP ' || coalesce(v_m.anno_doc::text || '/', '') || v_m.numero_doc
      || coalesce(' · ' || nullif(trim(v_m.operatore), ''), '');
    v_u := -v_m.qta;
    if v_u <= 0 then
      -- un UP1 positivo (storno): in sede, come prima
      insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um, mittente, documento_tipo, documento_numero,
        documento_pos, documento_data, note, creato_da, creato_il, operazione_id)
      values (v_data, 'carico', upper(trim(v_m.codice)), v_m.descrizione, v_m.qta, v_m.um, 'Alnus',
        'ALNUS', v_key, v_mag, v_data, v_nota, 'alnus', v_m.data, v_op)
      on conflict do nothing;
      v_movimenti := v_movimenti + 1;
      continue;
    end if;
    select n, a into v_cn, v_ca from consumo_commessa(v_op, upper(trim(v_m.codice)));
    v_c := greatest(v_ca + v_u, v_cn) - greatest(v_ca, v_cn);
    v_f := v_u - v_c;
    v_i := 0;
    -- in giacenza: prima dal reparto (e dai posti) della commessa
    for v_t in
      select presso_id, sum(qta) as s from movimenti_magazzino
      where operazione_id = v_op and upper(trim(codice)) = upper(trim(v_m.codice)) and presso_id is not null and not fuori_giacenza
      group by presso_id having sum(qta) > 0 order by (presso_id = v_rep) desc, presso_id
    loop
      exit when v_c <= 0;
      v_q := least(v_c, v_t.s);
      v_i := v_i + 1;
      insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um, mittente, documento_tipo, documento_numero,
        documento_pos, documento_data, note, creato_da, creato_il, operazione_id, presso_id)
      values (v_data, 'scarico', upper(trim(v_m.codice)), v_m.descrizione, -v_q, v_m.um, 'Alnus',
        'ALNUS', v_key, v_mag || '·P' || v_i, v_data, v_nota || ' · dal reparto della commessa',
        'alnus', v_m.data, v_op, v_t.presso_id)
      on conflict do nothing;
      v_c := v_c - v_q;
    end loop;
    if v_c > 0 then
      insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um, mittente, documento_tipo, documento_numero,
        documento_pos, documento_data, note, creato_da, creato_il, operazione_id)
      values (v_data, 'scarico', upper(trim(v_m.codice)), v_m.descrizione, -v_c, v_m.um, 'Alnus',
        'ALNUS', v_key, v_mag, v_data, v_nota, 'alnus', v_m.data, v_op)
      on conflict do nothing;
    end if;
    if v_f > 0 then
      insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um, mittente, documento_tipo, documento_numero,
        documento_pos, documento_data, note, creato_da, creato_il, operazione_id, fuori_giacenza)
      values (v_data, 'scarico', upper(trim(v_m.codice)), v_m.descrizione, -v_f, v_m.um, 'Alnus',
        'ALNUS', v_key, v_mag || '·F', v_data, v_nota || ' · gia'' consumato dal lotto del gestionale',
        'alnus', v_m.data, v_op, true)
      on conflict do nothing;
    end if;
    v_movimenti := v_movimenti + 1;
  end loop;

  return jsonb_build_object('foto', v_foto.preso_il, 'aperture', v_aperture, 'movimenti', v_movimenti);
end $$;
revoke all on function public.mov_allinea_alnus() from public, anon;
grant execute on function public.mov_allinea_alnus() to authenticated;

-- Verifica (sola lettura): le quattro funzioni ci sono.
select string_agg(proname, ', ' order by proname) as funzioni from pg_proc
where proname in ('consumo_commessa', 'mov_scarica_lotto', 'mov_annulla_lotto', 'mov_allinea_alnus');
