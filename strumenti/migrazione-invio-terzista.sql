-- ═══════════════════════════════════════════════════════════════════
-- INVIO A TERZISTA  (5 nov 2026, pilota Enviro di Tema)
--
-- Chiesto da Nico: da una commessa mandare a un terzista solo ALCUNE
-- quantita' dei suoi materiali. Prova solo sulle commesse con "Materiali da
-- DDT" (Enviro), i cui C/L il gestionale li conta da se'. Niente documento
-- (DDT) per ora: si registra solo lo spostamento.
--
-- MODELLO, deciso da Nico (5 nov): TRASFERIMENTO, non scarico.
-- Il materiale dal terzista resta NOSTRO, cambia solo posto. Un invio scrive
-- due movimenti per codice, legati dallo stesso `invio_id`:
--     −q in sede          (presso_id null)
--     +q presso il terzista (presso_id = la sua azienda)
-- tutti e due con la commessa per cui parte (`operazione_id`).
-- Il totale non cambia, quindi tutti i conti di oggi (arrivato, giacenza,
-- ripartizione fra commesse) restano giusti con o senza invio.
--
-- PERCHE' NON UNO SCARICO: la commessa continuerebbe a chiedere quel
-- materiale (risulterebbe "mancano 40" mentre e' dal terzista) e al lotto il
-- trigger lo scaricherebbe una seconda volta.
--
-- AL LOTTO (trigger riscritto qui sotto): per ogni C/L si scarica PRIMA
-- quello che sta dal terzista per QUELLA commessa, poi il resto dalla sede.
-- Lotto cancellato o cambiato: rettifica uguale e contraria per ogni posto,
-- cosi' il materiale torna dove era stato preso.
--
-- CHI PUO' SCRIVERE: nessun utente scrive movimenti a mano (regola della
-- tabella). L'invio passa da `mov_invia_terzista`, security definer, che
-- controlla da sola che chi chiama sia admin. Stessa strada del trigger dei
-- lotti: la policy di INSERT resta chiusa.
-- `p_verso = 'rientro'` fa il contrario (dal terzista alla sede): oggi la
-- schermata non lo offre, ma serve per correggere un invio sbagliato.
--
-- ⚠ Senza questa migrazione il gestionale non si rompe: se ne accorge
-- (le colonne non ci sono) e non mostra il bottone.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Le colonne ────────────────────────────────────────────────────
alter table movimenti_magazzino add column if not exists presso_id uuid references aziende(id) on delete restrict;
alter table movimenti_magazzino add column if not exists operazione_id uuid references operazioni(id) on delete set null;
alter table movimenti_magazzino add column if not exists invio_id uuid;
create index if not exists movimenti_magazzino_presso_idx on movimenti_magazzino (presso_id) where presso_id is not null;
create index if not exists movimenti_magazzino_operazione_idx on movimenti_magazzino (operazione_id);
create index if not exists movimenti_magazzino_invio_idx on movimenti_magazzino (invio_id);

-- ── 2. Il tipo 'trasferimento' ──────────────────────────────────────
-- Il vincolo sul tipo e' nato senza nome: lo si cerca invece di indovinarlo.
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.movimenti_magazzino'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%tipo%'
  loop
    execute format('alter table movimenti_magazzino drop constraint %I', c);
  end loop;
end $$;
alter table movimenti_magazzino add constraint movimenti_magazzino_tipo_check
  check (tipo in ('carico', 'scarico', 'rettifica', 'trasferimento'));

-- ── 3. L'invio (e il rientro) ───────────────────────────────────────
-- p_righe: [{ "codice": "TS-536000577", "qta": 40 }, ...]
create or replace function public.mov_invia_terzista(p_operazione uuid, p_terzista uuid,
  p_righe jsonb, p_nota text default null, p_verso text default 'invio')
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_op    record;
  v_nome  text;
  v_r     record;
  v_desc  text;
  v_um    text;
  v_disp  numeric;
  v_invio uuid := gen_random_uuid();
  v_doc   text;
  v_nota  text;
  v_chi   text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_n     integer := 0;
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

  -- Due invii nello stesso istante non devono poter spendere la stessa sede.
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
      where trim(r->>'codice') = v_r.cod and upper(trim(coalesce(r->>'tipo', ''))) = 'C/L'
      limit 1;
    if not found then
      raise exception 'Il codice % non e'' un C/L della lista di questa commessa', v_r.cod;
    end if;

    if p_verso = 'invio' then
      select coalesce(sum(qta), 0) into v_disp from movimenti_magazzino
        where codice = v_r.cod and presso_id is null;
    else
      select coalesce(sum(qta), 0) into v_disp from movimenti_magazzino
        where codice = v_r.cod and presso_id = p_terzista and operazione_id = p_operazione;
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

-- ── 4. Gli scarichi di produzione, ora con i terzisti ──────────────
-- Stessa firma di prima (14 ott). Cambia solo DA DOVE si scarica: prima dal
-- terzista per questa commessa, poi dalla sede. Senza invii scrive
-- esattamente le righe di prima (una per codice, in sede), piu' la commessa.
-- ⚠ Vuole pezzi > 0: il "meno" di un lotto corretto ora lo fa
-- `mov_annulla_lotto`, che sa da quale posto era uscito ogni pezzo.
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
  v_resto numeric;
  v_q     numeric;
  v_chi   text := lower(coalesce(auth.jwt() ->> 'email', 'database'));
  v_n     integer := 0;
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
           -- qta_pz salvato sulla riga; se manca, dal totale diviso i pezzi.
           round((coalesce(nullif(r->>'qta_pz', '')::numeric,
                           (r->>'qta')::numeric / nullif(v_op.quantita, 0)) * p_pezzi)::numeric, 4) as q
    from jsonb_array_elements(v_op.materiali) r
    where upper(trim(coalesce(r->>'tipo', ''))) = 'C/L'
      and coalesce(trim(r->>'codice'), '') <> ''
      and coalesce(nullif(r->>'qta_pz', '')::numeric, (r->>'qta')::numeric) > 0
  loop
    v_resto := v_r.q;
    continue when v_resto is null or v_resto <= 0;
    -- Prima quello che sta dal terzista per QUESTA commessa.
    for v_t in
      select presso_id, sum(qta) as s from movimenti_magazzino
      where operazione_id = p_operazione and codice = v_r.cod and presso_id is not null
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
    -- Il resto dalla sede.
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

-- Rettifica uguale e contraria a TUTTO quello che un lotto ha mosso, posto
-- per posto: il materiale torna esattamente da dove era uscito.
create or replace function public.mov_annulla_lotto(p_lotto uuid, p_nota text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n integer := 0;
begin
  insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
    documento_tipo, documento_numero, documento_data, documento_pos,
    ordine_rif, note, lotto_id, presso_id, operazione_id, creato_da)
  select current_date, 'rettifica', m.codice, max(m.descrizione), -sum(m.qta), max(m.um),
         'PRODUZIONE', max(m.documento_numero), max(m.documento_data), m.codice,
         max(m.ordine_rif), p_nota, p_lotto, m.presso_id, m.operazione_id,
         lower(coalesce(auth.jwt() ->> 'email', 'database'))
  from movimenti_magazzino m
  where m.lotto_id = p_lotto
  group by m.codice, m.presso_id, m.operazione_id
  having sum(m.qta) <> 0;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.mov_trigger_lotto()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform mov_scarica_lotto(new.id, new.operazione_id, new.data, new.quantita, 'scarico',
      'Lotto di produzione: ' || new.quantita || ' pz');
    return new;
  elsif tg_op = 'UPDATE' then
    -- Si annulla tutto e si rifa': cosi' ogni pezzo torna e riparte dal posto giusto.
    if coalesce(new.quantita, 0) <> coalesce(old.quantita, 0) then
      perform mov_annulla_lotto(old.id,
        'Lotto di produzione corretto: da ' || old.quantita || ' a ' || new.quantita || ' pz');
      perform mov_scarica_lotto(new.id, new.operazione_id, new.data, new.quantita, 'rettifica',
        'Lotto di produzione corretto: ' || new.quantita || ' pz');
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    perform mov_annulla_lotto(old.id, 'Lotto di produzione annullato: ' || old.quantita || ' pz');
    return old;
  end if;
  return null;
end $$;

revoke all on function public.mov_scarica_lotto(uuid, uuid, date, numeric, text, text) from public;
revoke all on function public.mov_annulla_lotto(uuid, text) from public;
revoke all on function public.mov_trigger_lotto() from public;
-- Il trigger consegne_commessa_scarico resta quello del 14 ott: chiama
-- mov_trigger_lotto, che qui sopra e' stata solo riscritta.

-- ── VERIFICA, senza lasciare tracce (da eseguire DOPO il blocco sopra) ──
-- Simula un invio di 2 pezzi del primo C/L della 00392 al primo fornitore
-- dell'anagrafica, registra un lotto finto da 1 pz, controlla che lo scarico
-- sia uscito PRIMA dal terzista, cancella il lotto, controlla che il
-- terzista riabbia i suoi 2. Poi si ferma con un ERRORE APPOSTA, che annulla
-- tutto quello che il blocco ha scritto.
-- ⚠ La risposta GIUSTA e' un messaggio rosso che comincia con:
--    VERIFICA OK (annullata)
do $$
declare v_op uuid; v_cod text; v_qpz numeric; v_ter uuid; v_lotto uuid;
        v_dopo_lotto numeric; v_dopo_annullo numeric; v_sede_lotto numeric;
begin
  select id into v_op from operazioni where numero_ordine = '2026/OC/00392' and pos = '0010';
  select trim(r->>'codice'), coalesce(nullif(r->>'qta_pz', '')::numeric, 1) into v_cod, v_qpz
    from operazioni o, jsonb_array_elements(o.materiali) r
    where o.id = v_op and upper(trim(coalesce(r->>'tipo', ''))) = 'C/L' limit 1;
  select id into v_ter from aziende where is_fornitore limit 1;
  -- L'invio come lo scrive mov_invia_terzista (che qui non si puo' chiamare:
  -- nell'editor SQL non c'e' un utente admin collegato).
  insert into movimenti_magazzino (data, tipo, codice, qta, documento_tipo, presso_id, operazione_id)
    values (current_date, 'trasferimento', v_cod, -(2 * v_qpz), 'TERZISTA', null, v_op),
           (current_date, 'trasferimento', v_cod,  (2 * v_qpz), 'TERZISTA', v_ter, v_op);
  insert into consegne_commessa (operazione_id, data, quantita, nota)
    values (v_op, current_date, 1, 'PROVA migrazione invio terzista') returning id into v_lotto;
  select coalesce(sum(qta), 0) into v_dopo_lotto from movimenti_magazzino
    where codice = v_cod and presso_id = v_ter and operazione_id = v_op;
  select coalesce(sum(qta), 0) into v_sede_lotto from movimenti_magazzino
    where lotto_id = v_lotto and codice = v_cod and presso_id is null;
  delete from consegne_commessa where id = v_lotto;
  select coalesce(sum(qta), 0) into v_dopo_annullo from movimenti_magazzino
    where codice = v_cod and presso_id = v_ter and operazione_id = v_op;
  if v_dopo_lotto = v_qpz and v_sede_lotto = 0 and v_dopo_annullo = 2 * v_qpz then
    raise exception 'VERIFICA OK (annullata): % · presso il terzista 2 pz, dopo il lotto 1 pz, dopo l''annullo di nuovo 2 pz', v_cod;
  else
    raise exception 'VERIFICA KO (annullata): % · dopo il lotto % (atteso %), dalla sede % (atteso 0), dopo l''annullo % (atteso %)',
      v_cod, v_dopo_lotto, v_qpz, v_sede_lotto, v_dopo_annullo, 2 * v_qpz;
  end if;
end $$;
