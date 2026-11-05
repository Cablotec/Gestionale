-- ═══════════════════════════════════════════════════════════════════
-- RICHIESTE AL MAGAZZINO PER I TERZISTI  (5 nov 2026, pilota Enviro)
--
-- Viene dopo `migrazione-invio-terzista.sql` (trasferimento sede ->
-- terzista). Nico: *"va bene per far preparare il materiale al magazzino?"*
-- — no, quella registrava l'uscita e basta. Adesso l'invio e' in DUE TEMPI:
--
--   1. RICHIESTA (ufficio): dalla commessa si sceglie la FASE ESTERNA
--      (righe della distinta prodotto segnate con un Tipo lavorazione) e il
--      terzista. Nasce una lista con le quantita' gia' calcolate, stato
--      'da_preparare'. La giacenza NON si muove.
--   2. Il magazzino la vede, la stampa, prepara.
--   3. CONFERMA (chi chiude il collo): quantita' REALI, poi i movimenti.
--      Stato 'inviato'. Cosi' si registra cio' che e' partito davvero.
--
-- I MAC (e tutto cio' che il gestionale non conta: ACQ, o una commessa senza
-- "Materiali da DDT") partono e restano REGISTRATI, ma FUORI GIACENZA:
-- `fuori_giacenza = true` sui loro movimenti, e tutti i conti li saltano.
-- Senza, un MAC mai caricato andrebbe in negativo in sede e diventerebbe
-- un codice "del gestionale" al posto della sua riga Alnus.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Movimenti registrati ma fuori dai conti ───────────────────────
alter table movimenti_magazzino add column if not exists fuori_giacenza boolean not null default false;

-- ── 2. Le richieste ──────────────────────────────────────────────────
create table if not exists invii_terzista (
  id            uuid primary key default gen_random_uuid(),
  operazione_id uuid not null references operazioni(id) on delete cascade,
  terzista_id   uuid not null references aziende(id) on delete restrict,
  fase_id       uuid references tipi_lavorazione(id) on delete set null,
  stato         text not null default 'da_preparare'
                check (stato in ('da_preparare', 'inviato', 'annullato')),
  -- [{ codice, descrizione, um, tipo, qta }]; alla conferma ogni riga
  -- prende anche `qta_inviata`.
  righe         jsonb not null check (jsonb_typeof(righe) = 'array'),
  nota          text,
  creato_da     text default lower(coalesce(auth.jwt() ->> 'email', '')),
  creato_il     timestamptz not null default now(),
  inviato_il    timestamptz,
  inviato_da    text,
  annullato_il  timestamptz
);
create index if not exists invii_terzista_operazione_idx on invii_terzista (operazione_id);
create index if not exists invii_terzista_stato_idx on invii_terzista (stato);

-- Le due serrature (vedi CLAUDE.md, "una tabella nuova nasce MUTA"). Niente anon.
grant select, insert, update, delete on public.invii_terzista to authenticated;
grant select, insert, update, delete on public.invii_terzista to service_role;
alter table invii_terzista enable row level security;

-- Leggere: tutti gli autenticati (il magazzino deve vederle).
drop policy if exists invii_terzista_lettura on invii_terzista;
create policy invii_terzista_lettura on invii_terzista for select to authenticated using (true);

-- Creare e annullare: solo admin, e solo finche' e' da preparare. Il
-- passaggio a 'inviato' NON passa di qui: lo fa la funzione di conferma,
-- insieme ai movimenti (le due meta' dello stesso gesto, stessa sorte).
drop policy if exists invii_terzista_crea on invii_terzista;
create policy invii_terzista_crea on invii_terzista for insert to authenticated
  with check (stato = 'da_preparare'
    and exists (select 1 from profili where id = auth.uid() and ruolo = 'admin'));
drop policy if exists invii_terzista_annulla on invii_terzista;
create policy invii_terzista_annulla on invii_terzista for update to authenticated
  using (stato = 'da_preparare'
    and exists (select 1 from profili where id = auth.uid() and ruolo = 'admin'))
  with check (stato in ('da_preparare', 'annullato')
    and exists (select 1 from profili where id = auth.uid() and ruolo = 'admin'));

-- ── 3. La conferma: quantita' reali -> movimenti ────────────────────
-- p_righe: [{ "codice": "...", "qta": 12 }]  (0 o assente = non partito)
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
  v_r     record;
  v_rr    jsonb;
  v_q     numeric;
  v_disp  numeric;
  v_conta boolean;
  v_doc   text;
  v_nota  text;
  v_chi   text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_n     integer := 0;
begin
  if not exists (select 1 from profili where id = auth.uid() and ruolo = 'admin') then
    raise exception 'Solo un amministratore puo'' confermare un invio a terzista';
  end if;
  select * into v_inv from invii_terzista where id = p_invio for update;
  if not found then raise exception 'Richiesta non trovata'; end if;
  if v_inv.stato <> 'da_preparare' then
    raise exception 'Questa richiesta e'' gia'' %', v_inv.stato;
  end if;
  if jsonb_typeof(p_righe) <> 'array' then raise exception 'Righe non valide'; end if;
  select id, numero_ordine, pos, riferimento_cliente, materiali_da_ddt
    into v_op from operazioni where id = v_inv.operazione_id;
  select nome into v_nome from aziende where id = v_inv.terzista_id;

  perform pg_advisory_xact_lock(hashtext('mov_invia_terzista'));

  v_doc  := coalesce(v_op.numero_ordine, '') || '/' || coalesce(v_op.pos, '');
  v_nota := 'Invio a ' || coalesce(v_nome, '?')
            || coalesce(' · ' || (select nome from tipi_lavorazione where id = v_inv.fase_id), '')
            || coalesce(' · ' || nullif(trim(coalesce(p_nota, v_inv.nota)), ''), '');

  for v_r in
    select trim(r->>'codice') as cod, r->>'descrizione' as descr, r->>'um' as um,
           upper(trim(coalesce(r->>'tipo', ''))) as tipo
    from jsonb_array_elements(v_inv.righe) r
  loop
    v_q := null;
    select nullif(x->>'qta', '')::numeric into v_q
      from jsonb_array_elements(p_righe) x where trim(x->>'codice') = v_r.cod limit 1;
    continue when v_q is null or v_q = 0;
    if v_q < 0 then raise exception '%: quantita'' negativa', v_r.cod; end if;
    -- Il gestionale conta solo i C/L delle commesse "Materiali da DDT".
    v_conta := coalesce(v_op.materiali_da_ddt, false) and v_r.tipo = 'C/L';
    if v_conta then
      select coalesce(sum(qta), 0) into v_disp from movimenti_magazzino
        where codice = v_r.cod and presso_id is null and not fuori_giacenza;
      if v_q > v_disp then
        raise exception '%: ne mandi % ma in sede ce ne sono %', v_r.cod, v_q, v_disp;
      end if;
    end if;
    insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
      documento_tipo, documento_numero, documento_data, documento_pos,
      ordine_rif, note, presso_id, operazione_id, invio_id, fuori_giacenza, creato_da)
    values
      (current_date, 'trasferimento', v_r.cod, v_r.descr, -v_q, v_r.um,
       'TERZISTA', v_doc, current_date, v_r.cod, v_op.riferimento_cliente, v_nota,
       null, v_op.id, p_invio, not v_conta, v_chi),
      (current_date, 'trasferimento', v_r.cod, v_r.descr, v_q, v_r.um,
       'TERZISTA', v_doc, current_date, v_r.cod, v_op.riferimento_cliente, v_nota,
       v_inv.terzista_id, v_op.id, p_invio, not v_conta, v_chi);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Nessuna quantita'' da inviare'; end if;

  -- Ogni riga si ricorda quanto e' partito davvero.
  select jsonb_agg(r || jsonb_build_object('qta_inviata', coalesce(
           (select nullif(x->>'qta', '')::numeric from jsonb_array_elements(p_righe) x
             where trim(x->>'codice') = trim(r->>'codice') limit 1), 0)))
    into v_rr from jsonb_array_elements(v_inv.righe) r;
  update invii_terzista set stato = 'inviato', righe = coalesce(v_rr, righe),
    inviato_il = now(), inviato_da = v_chi,
    nota = coalesce(nullif(trim(p_nota), ''), nota)
  where id = p_invio;
  return v_n;
end $$;
revoke all on function public.mov_conferma_invio_terzista(uuid, jsonb, text) from public;
grant execute on function public.mov_conferma_invio_terzista(uuid, jsonb, text) to authenticated;

-- ── 4. I conti esistenti saltano i movimenti fuori giacenza ─────────
-- Il lotto scarica dal terzista solo cio' che e' in conto (i MAC no).
create or replace function public.mov_scarica_lotto(p_lotto uuid, p_operazione uuid,
  p_data date, p_pezzi numeric, p_tipo text, p_nota text)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_op record; v_r record; v_t record; v_resto numeric; v_q numeric;
  v_chi text := lower(coalesce(auth.jwt() ->> 'email', 'database')); v_n integer := 0;
begin
  if p_pezzi is null or p_pezzi <= 0 then return 0; end if;
  select id, numero_ordine, pos, quantita, riferimento_cliente, materiali, materiali_da_ddt
    into v_op from operazioni where id = p_operazione;
  if not found or coalesce(v_op.materiali_da_ddt, false) = false
     or jsonb_typeof(v_op.materiali) <> 'array' then
    return 0;
  end if;
  for v_r in
    select trim(r->>'codice') as cod, r->>'descrizione' as descr, r->>'um' as um,
           round((coalesce(nullif(r->>'qta_pz', '')::numeric,
                           (r->>'qta')::numeric / nullif(v_op.quantita, 0)) * p_pezzi)::numeric, 4) as q
    from jsonb_array_elements(v_op.materiali) r
    where upper(trim(coalesce(r->>'tipo', ''))) = 'C/L'
      and coalesce(trim(r->>'codice'), '') <> ''
      and coalesce(nullif(r->>'qta_pz', '')::numeric, (r->>'qta')::numeric) > 0
  loop
    v_resto := v_r.q;
    continue when v_resto is null or v_resto <= 0;
    for v_t in
      select presso_id, sum(qta) as s from movimenti_magazzino
      where operazione_id = p_operazione and codice = v_r.cod and presso_id is not null
        and not fuori_giacenza
      group by presso_id having sum(qta) > 0 order by presso_id
    loop
      v_q := least(v_resto, v_t.s);
      insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
        documento_tipo, documento_numero, documento_data, documento_pos,
        ordine_rif, note, lotto_id, presso_id, operazione_id, creato_da)
      values (p_data, p_tipo, v_r.cod, v_r.descr, -v_q, v_r.um,
        'PRODUZIONE', coalesce(v_op.numero_ordine, '') || '/' || coalesce(v_op.pos, ''),
        p_data, v_r.cod, v_op.riferimento_cliente, p_nota, p_lotto, v_t.presso_id, p_operazione, v_chi);
      v_n := v_n + 1;
      v_resto := v_resto - v_q;
      exit when v_resto <= 0;
    end loop;
    if v_resto > 0 then
      insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
        documento_tipo, documento_numero, documento_data, documento_pos,
        ordine_rif, note, lotto_id, presso_id, operazione_id, creato_da)
      values (p_data, p_tipo, v_r.cod, v_r.descr, -v_resto, v_r.um,
        'PRODUZIONE', coalesce(v_op.numero_ordine, '') || '/' || coalesce(v_op.pos, ''),
        p_data, v_r.cod, v_op.riferimento_cliente, p_nota, p_lotto, null, p_operazione, v_chi);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.mov_scarica_lotto(uuid, uuid, date, numeric, text, text) from public;

-- L'invio diretto (e il rientro, che serve a correggere) contano solo cio' che e' in conto.
create or replace function public.mov_invia_terzista(p_operazione uuid, p_terzista uuid,
  p_righe jsonb, p_nota text default null, p_verso text default 'invio')
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_op record; v_nome text; v_r record; v_desc text; v_um text; v_disp numeric;
  v_invio uuid := gen_random_uuid(); v_doc text; v_nota text;
  v_chi text := lower(coalesce(auth.jwt() ->> 'email', '')); v_n integer := 0;
begin
  if not exists (select 1 from profili where id = auth.uid() and ruolo = 'admin') then
    raise exception 'Solo un amministratore puo'' registrare un invio a terzista';
  end if;
  if p_verso is null or p_verso not in ('invio', 'rientro') then
    raise exception 'Verso sconosciuto: %', p_verso;
  end if;
  select id, numero_ordine, pos, riferimento_cliente, materiali, materiali_da_ddt
    into v_op from operazioni where id = p_operazione;
  if not found then raise exception 'Commessa non trovata'; end if;
  if coalesce(v_op.materiali_da_ddt, false) = false or jsonb_typeof(v_op.materiali) <> 'array' then
    raise exception 'La commessa %/% non conta i suoi materiali dal gestionale (spunta "Materiali da DDT")',
      v_op.numero_ordine, v_op.pos;
  end if;
  select nome into v_nome from aziende where id = p_terzista;
  if not found then raise exception 'Terzista non trovato'; end if;
  if not exists (select 1 from operazioni_fornitori
                 where operazione_id = p_operazione and azienda_id = p_terzista) then
    raise exception '% non e'' fra i fornitori di questa commessa', v_nome;
  end if;
  if jsonb_typeof(p_righe) <> 'array' or jsonb_array_length(p_righe) = 0 then
    raise exception 'Nessun materiale da inviare';
  end if;
  perform pg_advisory_xact_lock(hashtext('mov_invia_terzista'));
  v_doc  := coalesce(v_op.numero_ordine, '') || '/' || coalesce(v_op.pos, '');
  v_nota := case p_verso when 'invio' then 'Invio a ' else 'Rientro da ' end || v_nome
            || coalesce(' · ' || nullif(trim(p_nota), ''), '');
  for v_r in select trim(e->>'codice') as cod, nullif(e->>'qta', '')::numeric as q
             from jsonb_array_elements(p_righe) e
  loop
    if coalesce(v_r.cod, '') = '' or v_r.q is null or v_r.q <= 0 then
      raise exception 'Riga non valida: codice %, quantita'' %', v_r.cod, v_r.q;
    end if;
    select r->>'descrizione', r->>'um' into v_desc, v_um
      from jsonb_array_elements(v_op.materiali) r
      where trim(r->>'codice') = v_r.cod and upper(trim(coalesce(r->>'tipo', ''))) = 'C/L' limit 1;
    if not found then
      raise exception 'Il codice % non e'' un C/L della lista di questa commessa', v_r.cod;
    end if;
    if p_verso = 'invio' then
      select coalesce(sum(qta), 0) into v_disp from movimenti_magazzino
        where codice = v_r.cod and presso_id is null and not fuori_giacenza;
    else
      select coalesce(sum(qta), 0) into v_disp from movimenti_magazzino
        where codice = v_r.cod and presso_id = p_terzista and operazione_id = p_operazione
          and not fuori_giacenza;
    end if;
    if v_r.q > v_disp then
      raise exception '%: ne vuoi spostare % ma % ce ne sono %', v_r.cod, v_r.q,
        case p_verso when 'invio' then 'in sede' else 'presso ' || v_nome end, v_disp;
    end if;
    insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
      documento_tipo, documento_numero, documento_data, documento_pos,
      ordine_rif, note, presso_id, operazione_id, invio_id, creato_da)
    values
      (current_date, 'trasferimento', v_r.cod, v_desc, -v_r.q, v_um,
       'TERZISTA', v_doc, current_date, v_r.cod, v_op.riferimento_cliente, v_nota,
       case p_verso when 'invio' then null else p_terzista end, p_operazione, v_invio, v_chi),
      (current_date, 'trasferimento', v_r.cod, v_desc, v_r.q, v_um,
       'TERZISTA', v_doc, current_date, v_r.cod, v_op.riferimento_cliente, v_nota,
       case p_verso when 'invio' then p_terzista else null end, p_operazione, v_invio, v_chi);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.mov_invia_terzista(uuid, uuid, jsonb, text, text) from public;
grant execute on function public.mov_invia_terzista(uuid, uuid, jsonb, text, text) to authenticated;

-- ── VERIFICA (dopo il blocco sopra): risposta giusta = errore rosso
--    "VERIFICA OK (annullata)". Annulla tutto quello che scrive.
do $$
declare v_op uuid; v_cl text; v_mac text; v_ter uuid; v_inv uuid; v_n int;
        v_fuori int; v_dentro int; v_stato text;
begin
  select id into v_op from operazioni where numero_ordine = '2026/OC/00392' and pos = '0010';
  select trim(r->>'codice') into v_cl from operazioni o, jsonb_array_elements(o.materiali) r
    where o.id = v_op and upper(trim(coalesce(r->>'tipo', ''))) = 'C/L' limit 1;
  select trim(r->>'codice') into v_mac from operazioni o, jsonb_array_elements(o.materiali) r
    where o.id = v_op and upper(trim(coalesce(r->>'tipo', ''))) = 'MAC' limit 1;
  select id into v_ter from aziende where is_fornitore limit 1;
  insert into movimenti_magazzino (data, tipo, codice, qta, documento_tipo)
    values (current_date, 'carico', v_cl, 1, 'PROVA');      -- almeno 1 in sede
  insert into invii_terzista (operazione_id, terzista_id, righe)
    values (v_op, v_ter, jsonb_build_array(
      jsonb_build_object('codice', v_cl, 'tipo', 'C/L', 'qta', 1),
      jsonb_build_object('codice', v_mac, 'tipo', 'MAC', 'qta', 2)))
    returning id into v_inv;
  -- La conferma vuole un admin collegato: qui si simulano le sue scritture.
  insert into movimenti_magazzino (data, tipo, codice, qta, documento_tipo, presso_id, operazione_id, invio_id, fuori_giacenza)
    values (current_date, 'trasferimento', v_cl, -1, 'TERZISTA', null, v_op, v_inv, false),
           (current_date, 'trasferimento', v_cl,  1, 'TERZISTA', v_ter, v_op, v_inv, false),
           (current_date, 'trasferimento', v_mac, -2, 'TERZISTA', null, v_op, v_inv, true),
           (current_date, 'trasferimento', v_mac,  2, 'TERZISTA', v_ter, v_op, v_inv, true);
  select count(*) into v_fuori from movimenti_magazzino where invio_id = v_inv and fuori_giacenza;
  select count(*) into v_dentro from movimenti_magazzino where invio_id = v_inv and not fuori_giacenza;
  select stato into v_stato from invii_terzista where id = v_inv;
  if v_fuori = 2 and v_dentro = 2 and v_stato = 'da_preparare' then
    raise exception 'VERIFICA OK (annullata): richiesta creata, % e % registrati (MAC fuori giacenza)', v_cl, v_mac;
  else
    raise exception 'VERIFICA KO (annullata): fuori %, dentro %, stato %', v_fuori, v_dentro, v_stato;
  end if;
end $$;
