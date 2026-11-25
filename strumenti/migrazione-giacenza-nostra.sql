-- ═══════════════════════════════════════════════════════════════════
-- LA GIACENZA E' DEL GESTIONALE (25 nov 2026, Nico: "Alnus serve solo come
-- termine di paragone finale. le nostre azioni anche se differenti devono
-- portare allo stesso risultato di Alnus. i movimenti da adesso devono essere
-- al 100% del nostro gestionale").
--
-- Punto zero = la foto d'apertura gia' scritta (APERTURA del 23/11). Da li':
--   1. i movimenti di Alnus importati (ALNUS) sono SOLO REGISTRO: si vedono e
--      servono al collaudo, ma non toccano la giacenza. Quelli gia' scritti
--      passano fuori giacenza; `mov_allinea_alnus` scrive i nuovi gia' cosi'
--      (UP1 compresi: niente piu' giro a parte).
--   2. un consumo solo non serve piu': `consumo_commessa` non conta gli UP1,
--      quindi il lotto consuma sempre tutta la sua quantita' e l'annullo la
--      restituisce tutta.
--   3. il reso al cliente vale anche per i codici di Alnus.
--   4. il nostro DDT Comet 7467 del 23/11 (A32100THB00TEH00101T, 100 pz),
--      entrato solo registro perche' il codice e' di Alnus, entra in giacenza.
-- Le rettifiche e i DDT nuovi li manda gia' in giacenza l'app.
-- Nessuna riga cancellata. Rilanciabile.
-- ═══════════════════════════════════════════════════════════════════

-- 2. Gli UP1 di Alnus non sono piu' un consumo.
create or replace function public.consumo_commessa(p_op uuid, p_cod text)
returns table (n numeric, a numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(-sum(qta) filter (where documento_tipo = 'PRODUZIONE'), 0), 0::numeric
  from movimenti_magazzino
  where operazione_id = p_op and upper(trim(codice)) = upper(trim(p_cod));
$$;
revoke all on function public.consumo_commessa(uuid, text) from public, anon, authenticated;

-- 1. L'allineamento: apertura come prima, movimenti di Alnus solo registro.
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
begin
  if not exists (select 1 from profili where id = auth.uid() and ruolo = 'admin') then
    raise exception 'Solo un amministratore puo'' allineare i movimenti di Alnus';
  end if;

  select * into v_foto from alnus_fotografie
    where tipo = 'giacenze' and apertura order by preso_il desc limit 1;
  if v_foto.id is null then raise exception 'Manca la foto d''apertura delle giacenze nello Specchio Alnus'; end if;

  -- APERTURA (una volta per foto): invariata.
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

  -- MOVIMENTI di Alnus dopo la foto: tutti, SOLO REGISTRO (termine di paragone).
  insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um, mittente,
    documento_tipo, documento_numero, documento_pos, documento_data, note, creato_da, creato_il,
    operazione_id, fuori_giacenza)
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
       and o.numero_op = m.anno_doc || '/OP/' || lpad(m.numero_doc::text, 5, '0') limit 1),
    true
  from alnus_movimenti m
  where m.data > v_foto.preso_il and upper(trim(m.magazzino)) in ('01', '02', 'WIP')
  on conflict do nothing;
  get diagnostics v_movimenti = row_count;

  return jsonb_build_object('foto', v_foto.preso_il, 'aperture', v_aperture, 'movimenti', v_movimenti);
end $$;
revoke all on function public.mov_allinea_alnus() from public, anon;
grant execute on function public.mov_allinea_alnus() to authenticated;

-- 1. I movimenti di Alnus gia' scritti: solo registro.
update movimenti_magazzino set fuori_giacenza = true
where documento_tipo = 'ALNUS' and not coalesce(fuori_giacenza, false);

-- 4. Il DDT Comet 7467 del 23/11: in giacenza.
update movimenti_magazzino set fuori_giacenza = false
where id = 'bd1d6cef-940f-4fcc-8372-9b6dd01b30e0' and documento_tipo = 'DDT' and documento_numero = '7467';

-- 3. Il reso al cliente anche per i codici di Alnus.
create or replace function public.mov_reso_cliente(p_cliente uuid, p_numero text, p_data date, p_righe jsonb, p_nota text default null)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_num   text := trim(coalesce(p_numero, ''));
  v_cli   text;
  v_chi   text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_nota  text := nullif(trim(coalesce(p_nota, '')), '');
  r       jsonb;
  i       int := 0;
  v_cod   text;
  v_qta   numeric;
  v_posto uuid;
  v_op    uuid;
  v_disp  numeric;
begin
  if not exists (select 1 from profili where id = auth.uid() and ruolo = 'admin') then
    raise exception 'Solo un amministratore puo'' registrare un reso';
  end if;
  select nome into v_cli from aziende where id = p_cliente;
  if v_cli is null then raise exception 'Cliente non trovato in Aziende'; end if;
  if v_num = '' then raise exception 'Manca il numero del DDT di reso'; end if;
  if p_data is null then raise exception 'Manca la data del reso'; end if;
  if p_righe is null or jsonb_typeof(p_righe) <> 'array' or jsonb_array_length(p_righe) = 0 then
    raise exception 'Il reso non ha righe';
  end if;
  if exists (select 1 from movimenti_magazzino where documento_tipo = 'RESO' and documento_numero = v_num
             and azienda_id = p_cliente) then
    raise exception 'Il reso % a % e'' gia'' registrato', v_num, v_cli;
  end if;

  for r in select * from jsonb_array_elements(p_righe) loop
    i := i + 1;
    v_cod   := upper(trim(coalesce(r->>'codice', '')));
    v_qta   := nullif(r->>'qta', '')::numeric;
    v_posto := nullif(r->>'presso_id', '')::uuid;
    v_op    := nullif(r->>'operazione_id', '')::uuid;
    if v_cod = '' then raise exception 'Riga %: manca il codice', i; end if;
    if v_qta is null or v_qta <= 0 then raise exception 'Riga % (%): la quantita'' deve essere maggiore di zero', i, v_cod; end if;
    select coalesce(sum(qta), 0) into v_disp from movimenti_magazzino
     where codice = v_cod and not fuori_giacenza
       and presso_id is not distinct from v_posto
       and (v_posto is null or operazione_id is not distinct from v_op);
    if v_qta > v_disp then
      raise exception '%: ne rendi % ma % ce ne sono %', v_cod, v_qta,
        case when v_posto is null then 'in sede' else 'in quel posto' end, v_disp;
    end if;
    insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um, mittente, azienda_id,
      documento_tipo, documento_numero, documento_data, documento_pos, note, presso_id, operazione_id,
      fuori_giacenza, creato_da)
    values (p_data, 'scarico', v_cod, nullif(trim(coalesce(r->>'descrizione', '')), ''), -v_qta,
      nullif(trim(coalesce(r->>'um', '')), ''), v_cli, p_cliente,
      'RESO', v_num, p_data, lpad(i::text, 4, '0'),
      'Reso a ' || v_cli || coalesce(' · ' || v_nota, ''), v_posto, case when v_posto is null then null else v_op end,
      false, v_chi);
  end loop;
  return i;
end $$;
revoke all on function public.mov_reso_cliente(uuid, text, date, jsonb, text) from public, anon;
grant execute on function public.mov_reso_cliente(uuid, text, date, jsonb, text) to authenticated;

-- Verifica (sola lettura).
select 'GIACENZA DEL GESTIONALE' as esito,
  (select count(*) from movimenti_magazzino where documento_tipo = 'ALNUS' and not fuori_giacenza) as alnus_in_giacenza_deve_essere_0,
  (select count(*) from movimenti_magazzino where documento_tipo = 'ALNUS') as alnus_solo_registro,
  (select not fuori_giacenza from movimenti_magazzino where id = 'bd1d6cef-940f-4fcc-8372-9b6dd01b30e0') as comet_in_giacenza;
