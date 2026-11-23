-- ── RICEVIMENTO DEI DDT DEI FORNITORI (23 nov 2026) ─────────────────────
-- Nico: "rendere agevole all'operatore l'inserimento e l'abbinamento dei codici
-- in entrata agli ordini fornitori che aspettano l'ingresso di quei codici".
--
-- Prima la scansione di un DDT di un fornitore scriveva subito i carichi: un
-- codice del fornitore non tradotto restava sbagliato per sempre (Lovato
-- GX1691U25, Fabbi 22 righe su 24). Adesso:
--   1. l'automazione (ai@) scrive il DDT letto in `ddt_ricevimenti` come BOZZA
--      («da_confermare»), coi codici che ha saputo tradurre;
--   2. un admin lo apre nel Gestionale, abbina ogni riga alla riga d'ordine che
--      la aspetta (o al nostro codice) e conferma;
--   3. `conferma_ricevimento` scrive i carichi (stessa `mov_carica_ddt` del DDT
--      a mano), IMPARA gli abbinamenti nuovi in `codici_fornitore` e chiude la
--      bozza. Tutto insieme o niente.
-- I DDT dei clienti in conto lavoro (Tema) restano automatici: non passano di qui.
-- Il DDT a mano usa la stessa finestra e la stessa funzione (p_id null).

create table if not exists public.ddt_ricevimenti (
  id            uuid primary key default gen_random_uuid(),
  azienda_id    uuid references public.aziende(id),
  mittente      text,
  ddt_numero    text not null,
  ddt_data      date,
  ordine        text,
  righe         jsonb not null default '[]'::jsonb,
  file          text,
  stato         text not null default 'da_confermare' check (stato in ('da_confermare', 'confermato', 'scartato')),
  creato_il     timestamptz not null default now(),
  creato_da     text,
  confermato_il timestamptz,
  confermato_da text
);
create unique index if not exists ddt_ricevimenti_uq on public.ddt_ricevimenti (azienda_id, upper(trim(ddt_numero)));

-- Dal 30 ott le tabelle nuove nascono mute: GRANT espliciti, niente anon.
grant select, insert, update, delete on public.ddt_ricevimenti to authenticated;
grant select, insert, update, delete on public.ddt_ricevimenti to service_role;
alter table public.ddt_ricevimenti enable row level security;

drop policy if exists ddt_ricevimenti_lettura on public.ddt_ricevimenti;
create policy ddt_ricevimenti_lettura on public.ddt_ricevimenti
  for select to authenticated using (true);
drop policy if exists ddt_ricevimenti_scrive on public.ddt_ricevimenti;
create policy ddt_ricevimenti_scrive on public.ddt_ricevimenti
  for insert to authenticated with check (exists (select 1 from profili where id = auth.uid() and ruolo = 'admin'));
drop policy if exists ddt_ricevimenti_modifica on public.ddt_ricevimenti;
create policy ddt_ricevimenti_modifica on public.ddt_ricevimenti
  for update to authenticated using (exists (select 1 from profili where id = auth.uid() and ruolo = 'admin'));
drop policy if exists ddt_ricevimenti_elimina on public.ddt_ricevimenti;
create policy ddt_ricevimenti_elimina on public.ddt_ricevimenti
  for delete to authenticated using (exists (select 1 from profili where id = auth.uid() and ruolo = 'admin'));

-- mov_carica_ddt riscritta: ora salva anche il codice del fornitore (codice_mittente)
-- e il file della scansione. Il resto e' quello del 19 nov.
create or replace function public.mov_carica_ddt(p_azienda uuid, p_numero text, p_data date, p_righe jsonb)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_num   text := trim(coalesce(p_numero, ''));
  v_mitt  text;
  v_chi   text := lower(coalesce(auth.jwt() ->> 'email', ''));
  r       jsonb;
  i       int := 0;
  v_cod   text;
  v_qta   numeric;
begin
  if not exists (select 1 from profili where id = auth.uid() and ruolo = 'admin') then
    raise exception 'Solo un amministratore puo'' caricare un DDT';
  end if;
  select nome into v_mitt from aziende where id = p_azienda;
  if v_mitt is null then raise exception 'Mittente non trovato in Aziende'; end if;
  if v_num = '' then raise exception 'Manca il numero del DDT'; end if;
  if p_data is null then raise exception 'Manca la data del DDT'; end if;
  if p_righe is null or jsonb_typeof(p_righe) <> 'array' or jsonb_array_length(p_righe) = 0 then
    raise exception 'Il DDT non ha righe';
  end if;
  if exists (select 1 from movimenti_magazzino where documento_tipo = 'DDT' and documento_numero = v_num
             and (azienda_id = p_azienda or upper(mittente) = upper(v_mitt))) then
    raise exception 'Il DDT % di % e'' gia'' caricato', v_num, v_mitt;
  end if;

  for r in select * from jsonb_array_elements(p_righe) loop
    i := i + 1;
    v_cod := upper(trim(coalesce(r->>'codice', '')));
    v_qta := nullif(r->>'qta', '')::numeric;
    if v_cod = '' then raise exception 'Riga %: manca il codice', i; end if;
    if v_qta is null or v_qta <= 0 then raise exception 'Riga % (%): la quantita'' deve essere maggiore di zero', i, v_cod; end if;
    insert into movimenti_magazzino (data, tipo, codice, codice_mittente, descrizione, qta, um, mittente, azienda_id,
      documento_tipo, documento_numero, documento_data, documento_pos, ordine_rif, note, file, fuori_giacenza, creato_da)
    values (p_data, 'carico', v_cod, nullif(trim(coalesce(r->>'codice_mittente', '')), ''),
      nullif(trim(coalesce(r->>'descrizione', '')), ''), v_qta,
      nullif(trim(coalesce(r->>'um', '')), ''), v_mitt, p_azienda,
      'DDT', v_num, p_data, coalesce(nullif(trim(coalesce(r->>'pos', '')), ''), lpad(i::text, 4, '0')),
      nullif(trim(coalesce(r->>'ordine_rif', '')), ''),
      nullif(trim(coalesce(r->>'note', '')), ''), nullif(trim(coalesce(r->>'file', '')), ''),
      coalesce((r->>'fuori_giacenza')::boolean, false), v_chi);
  end loop;
  return i;
end $$;
revoke all on function public.mov_carica_ddt(uuid, text, date, jsonb) from public, anon;
grant execute on function public.mov_carica_ddt(uuid, text, date, jsonb) to authenticated;

-- La conferma: carichi + abbinamenti imparati + bozza chiusa, tutto insieme.
-- p_id null = DDT scritto a mano (nessuna bozza da chiudere).
-- p_abbinamenti = [{ "codice": nostro, "codice_fornitore": suo }]: si aggiungono
-- solo quelli che quel fornitore non ha gia' (stesso suo codice).
create or replace function public.conferma_ricevimento(p_id uuid, p_azienda uuid, p_numero text, p_data date,
  p_righe jsonb, p_abbinamenti jsonb)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n   int;
  v_chi text := lower(coalesce(auth.jwt() ->> 'email', ''));
  a     jsonb;
  v_cf  text;
  v_cod text;
begin
  if not exists (select 1 from profili where id = auth.uid() and ruolo = 'admin') then
    raise exception 'Solo un amministratore puo'' confermare un DDT';
  end if;
  if p_id is not null and not exists (select 1 from ddt_ricevimenti where id = p_id and stato = 'da_confermare') then
    raise exception 'Questo DDT non e'' piu'' da confermare (gia'' confermato o scartato)';
  end if;
  v_n := mov_carica_ddt(p_azienda, p_numero, p_data, p_righe);
  if p_abbinamenti is not null and jsonb_typeof(p_abbinamenti) = 'array' then
    for a in select * from jsonb_array_elements(p_abbinamenti) loop
      v_cf := trim(coalesce(a->>'codice_fornitore', ''));
      v_cod := upper(trim(coalesce(a->>'codice', '')));
      if v_cf = '' or v_cod = '' or upper(v_cf) = v_cod then continue; end if;
      if not exists (select 1 from codici_fornitore where azienda_id = p_azienda and upper(trim(codice_fornitore)) = upper(v_cf)) then
        insert into codici_fornitore (codice, azienda_id, codice_fornitore, nota)
        values (v_cod, p_azienda, v_cf, 'dal ricevimento del DDT ' || trim(p_numero));
      end if;
    end loop;
  end if;
  if p_id is not null then
    update ddt_ricevimenti set stato = 'confermato', confermato_il = now(), confermato_da = v_chi where id = p_id;
  end if;
  return v_n;
end $$;
revoke all on function public.conferma_ricevimento(uuid, uuid, text, date, jsonb, jsonb) from public, anon;
grant execute on function public.conferma_ricevimento(uuid, uuid, text, date, jsonb, jsonb) to authenticated;

select 'RICEVIMENTO DDT PRONTO' as esito;
