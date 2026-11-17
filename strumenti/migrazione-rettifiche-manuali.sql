-- ── RETTIFICHE MANUALI (17 nov 2026) ───────────────────────────────────
-- Nico: "possibilita' di effettuare rettifiche manuali, creando movimenti
-- per aggiustare codici". Un movimento non si corregge e non si cancella:
-- se ne scrive un altro, tipo 'rettifica', con il motivo nella nota.
--
-- Perche' una FUNZIONE e non una policy di INSERT piu' larga: la tabella
-- resta scritta solo da ai@ e dalle funzioni del database. Questa controlla
-- che chi chiama sia admin, che la quantita' non sia zero e che il motivo
-- ci sia, e scrive UNA riga sola, sempre con le stesse colonne.
--
-- p_presso null = in sede; altrimenti il terzista o il reparto.
-- p_operazione: facoltativa, la commessa a cui appartiene il materiale
-- fuori sede (come gli invii). Descrizione e UM: dall'ultimo movimento del
-- codice, se no dall'anagrafica materiali.

create or replace function public.mov_rettifica(p_codice text, p_qta numeric, p_motivo text,
  p_presso uuid default null, p_operazione uuid default null, p_data date default current_date)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cod   text := upper(trim(coalesce(p_codice, '')));
  v_descr text;
  v_um    text;
  v_id    uuid;
  v_chi   text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if not exists (select 1 from profili where id = auth.uid() and ruolo = 'admin') then
    raise exception 'Solo un amministratore puo'' registrare una rettifica';
  end if;
  if v_cod = '' then raise exception 'Manca il codice'; end if;
  if p_qta is null or p_qta = 0 then raise exception 'La quantita'' non puo'' essere zero'; end if;
  if nullif(trim(coalesce(p_motivo, '')), '') is null then raise exception 'Scrivi il motivo'; end if;
  if p_presso is not null and not exists (select 1 from aziende where id = p_presso) then
    raise exception 'Posto non trovato';
  end if;

  select m.descrizione, m.um into v_descr, v_um from movimenti_magazzino m
    where m.codice = v_cod order by m.creato_il desc limit 1;
  if v_descr is null then
    select descrizione, um into v_descr, v_um from materiali where codice = v_cod limit 1;
  end if;

  insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
    documento_tipo, note, presso_id, operazione_id, creato_da)
  values (coalesce(p_data, current_date), 'rettifica', v_cod, v_descr, p_qta, v_um,
    'RETTIFICA', 'Rettifica a mano · ' || trim(p_motivo), p_presso, p_operazione, v_chi)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.mov_rettifica(text, numeric, text, uuid, uuid, date) from public;
grant execute on function public.mov_rettifica(text, numeric, text, uuid, uuid, date) to authenticated;

select 'RETTIFICHE MANUALI PRONTE' as esito;

-- ── MODIFICARE UNA RETTIFICA A MANO (17 nov, Nico) ─────────────────────
-- "vorrei poter modificare la rettifica anche una volta fatta". Eccezione
-- dichiarata alla regola "un movimento non si modifica": vale SOLO per le
-- rettifiche scritte a mano (documento_tipo RETTIFICA, tipo rettifica),
-- mai per carichi DDT, scarichi di lotto, invii o rettifiche dei trigger.
-- La traccia resta nella nota: "· modificata il gg/mm/aaaa da <chi> (era +3)".
create or replace function public.mov_modifica_rettifica(p_id uuid, p_qta numeric, p_motivo text,
  p_data date default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_m     record;
  v_trac  text;
  v_chi   text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if not exists (select 1 from profili where id = auth.uid() and ruolo = 'admin') then
    raise exception 'Solo un amministratore puo'' modificare una rettifica';
  end if;
  select * into v_m from movimenti_magazzino where id = p_id for update;
  if not found then raise exception 'Movimento non trovato'; end if;
  if v_m.tipo <> 'rettifica' or coalesce(v_m.documento_tipo, '') <> 'RETTIFICA' then
    raise exception 'Si modificano solo le rettifiche fatte a mano';
  end if;
  if p_qta is null or p_qta = 0 then raise exception 'La quantita'' non puo'' essere zero'; end if;
  if nullif(trim(coalesce(p_motivo, '')), '') is null then raise exception 'Scrivi il motivo'; end if;

  v_trac := coalesce(substring(v_m.note from ' · modificata .*$'), '')
    || ' · modificata il ' || to_char(current_date, 'DD/MM/YYYY') || ' da ' || v_chi
    || ' (era ' || case when v_m.qta > 0 then '+' else '' end || rtrim(to_char(v_m.qta, 'FM999999990.###'), '.')
    || case when coalesce(p_data, v_m.data) <> v_m.data then ' del ' || to_char(v_m.data, 'DD/MM/YYYY') else '' end || ')';
  update movimenti_magazzino
     set qta = p_qta, data = coalesce(p_data, v_m.data),
         note = 'Rettifica a mano · ' || trim(p_motivo) || v_trac
   where id = p_id;
  return p_id;
end $$;
revoke all on function public.mov_modifica_rettifica(uuid, numeric, text, date) from public;
grant execute on function public.mov_modifica_rettifica(uuid, numeric, text, date) to authenticated;

select 'MODIFICA RETTIFICHE PRONTA' as esito;
