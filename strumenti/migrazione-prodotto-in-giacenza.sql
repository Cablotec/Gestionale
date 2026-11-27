-- ═══════════════════════════════════════════════════════════════════
-- IL PRODOTTO FINITO HA UNA GIACENZA (27 nov 2026, Nico: "Alnus produce 1 pz
-- dei 30 010 0615 quando consuma il materiale che serve [...] quando lo spedisco
-- torna a 0"; "non possiamo gia' farlo adesso? altrimenti non riesco a
-- sistemare JMA e anche altri").
--
-- Come Alnus (EP1 al versamento, UC2 alla bolla):
--   1. il LOTTO, oltre a scaricare i componenti, CARICA in sede il prodotto
--      della commessa (codice dell'articolo). Stesso trigger, stesso lotto_id:
--      lotto corretto o cancellato = `mov_annulla_lotto` lo restituisce da solo.
--   2. la SPEDIZIONE lo SCARICA (documento_tipo SPEDIZIONE, colonna nuova
--      spedizione_id). Spedizione corretta = la differenza; cancellata = rimesso.
--      Una spedizione PREPARATA (quantita' vuota) non muove niente finche' non
--      si conferma.
--   3. RECUPERO dal punto zero (APERTURA del 23/11): lotti e spedizioni
--      registrati dopo scrivono i loro movimenti, con l'ora in cui erano stati
--      registrati. Prima del punto zero li conta gia' l'apertura.
-- Il prodotto puo' andare sotto zero (una spedizione senza lotto): si vede nel
-- collaudo, non si blocca. Rilanciabile: il recupero salta cio' che c'e' gia'.
-- ═══════════════════════════════════════════════════════════════════

alter table movimenti_magazzino add column if not exists spedizione_id uuid;
create index if not exists movimenti_magazzino_spedizione_idx on movimenti_magazzino (spedizione_id);

-- 1. Il carico del prodotto di un lotto.
create or replace function public.mov_carica_prodotto(p_lotto uuid, p_operazione uuid,
  p_data date, p_pezzi numeric, p_tipo text, p_nota text, p_quando timestamptz default now(),
  p_chi text default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_op record;
begin
  if coalesce(p_pezzi, 0) = 0 then return 0; end if;
  select o.numero_ordine, o.pos, a.codice, a.descrizione into v_op
    from operazioni o join articoli a on a.id = o.articolo_id where o.id = p_operazione;
  if v_op.codice is null or trim(v_op.codice) = '' then return 0; end if;
  insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
    documento_tipo, documento_numero, documento_data, documento_pos,
    note, lotto_id, operazione_id, creato_da, creato_il)
  values (p_data, p_tipo, trim(v_op.codice), v_op.descrizione, p_pezzi, 'PZ',
    'PRODUZIONE', coalesce(v_op.numero_ordine, '') || '/' || coalesce(v_op.pos, ''), p_data, trim(v_op.codice),
    p_nota, p_lotto, p_operazione,
    coalesce(p_chi, lower(coalesce(auth.jwt() ->> 'email', 'database'))), p_quando);
  return 1;
end $$;
revoke all on function public.mov_carica_prodotto(uuid, uuid, date, numeric, text, text, timestamptz, text)
  from public, anon, authenticated;

-- Il trigger del lotto (quello del 5 nov) + il carico del prodotto.
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
    perform mov_carica_prodotto(new.id, new.operazione_id, new.data, new.quantita, 'carico',
      'Prodotto dal lotto: ' || new.quantita || ' pz');
    return new;
  elsif tg_op = 'UPDATE' then
    -- Si annulla tutto (componenti E prodotto) e si rifa'.
    if coalesce(new.quantita, 0) <> coalesce(old.quantita, 0) then
      perform mov_annulla_lotto(old.id,
        'Lotto di produzione corretto: da ' || old.quantita || ' a ' || new.quantita || ' pz');
      perform mov_scarica_lotto(new.id, new.operazione_id, new.data, new.quantita, 'rettifica',
        'Lotto di produzione corretto: ' || new.quantita || ' pz');
      perform mov_carica_prodotto(new.id, new.operazione_id, new.data, new.quantita, 'carico',
        'Prodotto dal lotto corretto: ' || new.quantita || ' pz');
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    perform mov_annulla_lotto(old.id, 'Lotto di produzione annullato: ' || old.quantita || ' pz');
    return old;
  end if;
  return null;
end $$;
revoke all on function public.mov_trigger_lotto() from public;
-- Il trigger consegne_commessa_scarico resta: chiama mov_trigger_lotto.

-- 2. La spedizione scarica il prodotto. Si porta il netto della spedizione a
--    -quantita' (0 se cancellata o solo preparata): una riga per la differenza.
create or replace function public.mov_scarica_spedizione(p_sped uuid, p_operazione uuid,
  p_data date, p_ddt text, p_pezzi numeric, p_nota text, p_quando timestamptz default now(),
  p_chi text default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_op   record;
  v_gia  numeric;
  v_diff numeric;
begin
  select o.numero_ordine, o.pos, a.codice, a.descrizione into v_op
    from operazioni o join articoli a on a.id = o.articolo_id where o.id = p_operazione;
  if v_op.codice is null or trim(v_op.codice) = '' then return 0; end if;
  select coalesce(sum(qta), 0) into v_gia from movimenti_magazzino where spedizione_id = p_sped;
  v_diff := -coalesce(p_pezzi, 0) - v_gia;
  if v_diff = 0 then return 0; end if;
  insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
    documento_tipo, documento_numero, documento_data, documento_pos,
    note, operazione_id, spedizione_id, creato_da, creato_il)
  values (coalesce(p_data, current_date), case when v_gia = 0 and v_diff < 0 then 'scarico' else 'rettifica' end,
    trim(v_op.codice), v_op.descrizione, v_diff, 'PZ',
    'SPEDIZIONE', coalesce(nullif(trim(p_ddt), ''), coalesce(v_op.numero_ordine, '') || '/' || coalesce(v_op.pos, '')),
    p_data, 'S-' || left(p_sped::text, 8),
    p_nota, p_operazione, p_sped,
    coalesce(p_chi, lower(coalesce(auth.jwt() ->> 'email', 'database'))), p_quando);
  return 1;
end $$;
revoke all on function public.mov_scarica_spedizione(uuid, uuid, date, text, numeric, text, timestamptz, text)
  from public, anon, authenticated;

create or replace function public.mov_trigger_spedizione()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform mov_scarica_spedizione(old.id, old.operazione_id, old.data, old.ddt, 0,
      'Spedizione annullata: ' || coalesce(old.quantita, 0) || ' pz');
    return old;
  end if;
  perform mov_scarica_spedizione(new.id, new.operazione_id, new.data, new.ddt, new.quantita,
    case when tg_op = 'INSERT' then 'Spedizione: ' || coalesce(new.quantita, 0) || ' pz'
         else 'Spedizione corretta: ' || coalesce(new.quantita, 0) || ' pz' end);
  return new;
end $$;
revoke all on function public.mov_trigger_spedizione() from public;

drop trigger if exists spedizioni_scarico_prodotto on spedizioni;
create trigger spedizioni_scarico_prodotto
  after insert or update of quantita or delete on spedizioni
  for each row execute function public.mov_trigger_spedizione();

-- 3. RECUPERO dal punto zero (una volta; rilanciabile).
do $$
declare
  v_zero timestamptz;
  v_l    record;
  v_s    record;
  v_nl   integer := 0;
  v_ns   integer := 0;
begin
  select max(creato_il) into v_zero from movimenti_magazzino where documento_tipo = 'APERTURA';
  if v_zero is null then raise exception 'Manca l''APERTURA: niente punto zero'; end if;

  for v_l in
    select c.* from consegne_commessa c
    where c.creato_il > v_zero and coalesce(c.quantita, 0) > 0
      and not exists (select 1 from movimenti_magazzino m
        join operazioni o on o.id = c.operazione_id join articoli a on a.id = o.articolo_id
        where m.lotto_id = c.id and upper(trim(m.codice)) = upper(trim(a.codice)))
  loop
    v_nl := v_nl + mov_carica_prodotto(v_l.id, v_l.operazione_id, v_l.data, v_l.quantita, 'carico',
      'Prodotto dal lotto: ' || v_l.quantita || ' pz (recupero dal punto zero)', v_l.creato_il,
      'recupero prodotti');
  end loop;

  for v_s in
    select s.* from spedizioni s
    where s.creato_il > v_zero and coalesce(s.quantita, 0) > 0
      and not exists (select 1 from movimenti_magazzino m where m.spedizione_id = s.id)
  loop
    v_ns := v_ns + mov_scarica_spedizione(v_s.id, v_s.operazione_id, v_s.data, v_s.ddt, v_s.quantita,
      'Spedizione: ' || v_s.quantita || ' pz (recupero dal punto zero)', v_s.creato_il, 'recupero prodotti');
  end loop;

  raise notice 'Recupero: % carichi di prodotto, % scarichi di spedizione', v_nl, v_ns;
end $$;

-- ── VERIFICA (sola lettura): atteso 20 carichi e 20 scarichi del recupero
--    (dati del 27/11), e i due trigger presenti.
select
  (select count(*) from movimenti_magazzino where creato_da = 'recupero prodotti' and documento_tipo = 'PRODUZIONE') as carichi_recupero,
  (select count(*) from movimenti_magazzino where creato_da = 'recupero prodotti' and documento_tipo = 'SPEDIZIONE') as scarichi_recupero,
  (select count(*) from pg_trigger where tgname in ('consegne_commessa_scarico', 'spedizioni_scarico_prodotto')) as trigger_presenti;
