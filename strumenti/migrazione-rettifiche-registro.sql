-- RETTIFICHE «SOLO REGISTRO» PER IL COLLAUDO (25 nov 2026, Nico: "io carico i movimenti
-- e tu mi dici cosa fare sul nostro gestionale").
--
-- Durante il collaudo Nico rifa' nel gestionale le rettifiche che trova fra i movimenti
-- di Alnus. Su un codice di Alnus la giacenza la porta gia' l'ER1/UR1 importato: la
-- nostra rettifica deve restare SOLO REGISTRO (fuori_giacenza), altrimenti la stessa
-- correzione conterebbe due volte. Conta invece nel confronto «Collaudo» dello Specchio.
--
-- `mov_rettifica` prende un parametro in piu', `p_registro` (di serie false: le chiamate
-- di prima non cambiano). Si toglie la vecchia firma, o PostgREST non saprebbe quale
-- delle due chiamare. Rilanciabile.

drop function if exists public.mov_rettifica(text, numeric, text, uuid, uuid, date);

create or replace function public.mov_rettifica(p_codice text, p_qta numeric, p_motivo text,
  p_presso uuid default null, p_operazione uuid default null, p_data date default current_date,
  p_registro boolean default false)
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
    documento_tipo, note, presso_id, operazione_id, fuori_giacenza, creato_da)
  values (coalesce(p_data, current_date), 'rettifica', v_cod, v_descr, p_qta, v_um,
    'RETTIFICA', 'Rettifica a mano' || case when coalesce(p_registro, false) then ' (collaudo, solo registro)' else '' end
      || ' · ' || trim(p_motivo), p_presso, p_operazione, coalesce(p_registro, false), v_chi)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.mov_rettifica(text, numeric, text, uuid, uuid, date, boolean) from public, anon;
grant execute on function public.mov_rettifica(text, numeric, text, uuid, uuid, date, boolean) to authenticated;

select 'RETTIFICHE SOLO REGISTRO PRONTE' as esito;
