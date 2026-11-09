-- FORNITORE ABITUALE SUL CODICE (9 nov 2026, Nico)
--
-- Il menu sullo stato di un materiale (scheda Materiali della commessa)
-- scrive al fornitore. Il nome lo da' l'OF di Alnus quando c'e'; quando non
-- c'e' (da ordinare, MAC) serve sapere da chi si compra QUEL codice.
--   codice -> fornitore abituale (qui, testo come lo scrive Alnus)
--   fornitore -> email (nella scheda Aziende, campo email gia' esistente)
-- L'email NON sta sul codice: TECNOS copre centinaia di codici, e un cambio
-- d'indirizzo si fa una volta sola.
--
-- SEME, non regola: l'import dell'estrazione scrive il fornitore dell'OF solo
-- dove il campo e' vuoto. Chi lo cambia a mano comanda.
--
-- Si scrive SOLO dalla funzione qui sotto (security definer): tocca la sola
-- colonna fornitore, e non serve allargare le policy di `materiali`.

alter table public.materiali add column if not exists fornitore text;
comment on column public.materiali.fornitore is
  'Fornitore abituale del codice, nome come lo scrive Alnus. Seminato dall''import (solo se vuoto), cambiabile a mano dal menu del materiale.';

create or replace function public.materiali_imposta_fornitore(
  p_codici text[], p_fornitore text, p_solo_vuoti boolean default true)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'non autenticato'; end if;
  update public.materiali
     set fornitore = nullif(trim(p_fornitore), '')
   where codice = any(p_codici)
     and (not p_solo_vuoti or fornitore is null or trim(fornitore) = '');
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.materiali_imposta_fornitore(text[], text, boolean) from public, anon;
grant execute on function public.materiali_imposta_fornitore(text[], text, boolean) to authenticated, service_role;

-- Primo seme dall'archivio di oggi: per ogni codice, il fornitore della
-- consegna con la data piu' vicina.
update public.materiali m
   set fornitore = s.fornitore
  from (
    select distinct on (x.codice) x.codice, c->>'fornitore' as fornitore
      from public.mancanti x, jsonb_array_elements(coalesce(x.consegne, '[]'::jsonb)) c
     where coalesce(c->>'fornitore', '') <> ''
     order by x.codice, c->>'data'
  ) s
 where m.codice = s.codice
   and (m.fornitore is null or trim(m.fornitore) = '');

-- Verifica: quanti codici hanno un fornitore abituale, per fornitore.
select fornitore, count(*) from public.materiali
 where fornitore is not null group by fornitore order by 2 desc;
