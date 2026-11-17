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
