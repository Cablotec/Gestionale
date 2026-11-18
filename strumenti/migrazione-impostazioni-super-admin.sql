-- IMPOSTAZIONI SOLO AL SUPER ADMIN (18 nov 2026, Nico: "il pannello
-- impostazioni lo posso vedere solo io", "chiudi anche il database, utenti
-- solo io"). Richiede strumenti/migrazione-super-admin.sql (e_super_admin()).
--
-- Policy RESTRICTIVE: si sommano (AND) a quelle che ci sono gia', senza
-- toccarle. La lettura non cambia; scrivere/modificare/eliminare richiede in
-- piu' il super admin. Il service role (Edge Functions) non passa dalla RLS.
-- Si applicano solo dove la RLS e' attiva: le tabelle senza RLS si segnalano
-- (NOTICE) e restano come sono, perche' accenderla senza policy di lettura
-- bloccherebbe anche le letture.
--
-- Tabelle scritte SOLO da Impostazioni (verificato nel codice il 18 nov):
-- chiusure_aziendali, eventi, tipi_assenza, mezzi, tipi_lavorazione, utenti,
-- attivita_extra. `impostazioni`: la chiave `ddt_mittente` la scrive anche il
-- DDT fac simile dalla commessa (admin), quindi resta fuori. `profili`: cambio
-- ruolo solo dal super admin (l'inserimento dei profili nuovi lo fa il server).

do $$
declare t text;
begin
  foreach t in array array['chiusure_aziendali','eventi','tipi_assenza','mezzi',
                           'tipi_lavorazione','utenti','attivita_extra'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relname = t and c.relrowsecurity) then
      raise notice 'RLS NON attiva su %: lasciata com''e''', t;
      continue;
    end if;
    execute format('drop policy if exists solo_super_admin_ins on public.%I', t);
    execute format('drop policy if exists solo_super_admin_upd on public.%I', t);
    execute format('drop policy if exists solo_super_admin_del on public.%I', t);
    execute format('create policy solo_super_admin_ins on public.%I as restrictive for insert to authenticated with check (public.e_super_admin())', t);
    execute format('create policy solo_super_admin_upd on public.%I as restrictive for update to authenticated using (public.e_super_admin()) with check (public.e_super_admin())', t);
    execute format('create policy solo_super_admin_del on public.%I as restrictive for delete to authenticated using (public.e_super_admin())', t);
  end loop;
end $$;

drop policy if exists solo_super_admin_ins on public.impostazioni;
drop policy if exists solo_super_admin_upd on public.impostazioni;
drop policy if exists solo_super_admin_del on public.impostazioni;
create policy solo_super_admin_ins on public.impostazioni as restrictive for insert to authenticated
  with check (public.e_super_admin() or chiave = 'ddt_mittente');
create policy solo_super_admin_upd on public.impostazioni as restrictive for update to authenticated
  using (public.e_super_admin() or chiave = 'ddt_mittente') with check (public.e_super_admin() or chiave = 'ddt_mittente');
create policy solo_super_admin_del on public.impostazioni as restrictive for delete to authenticated
  using (public.e_super_admin());

drop policy if exists solo_super_admin_upd on public.profili;
drop policy if exists solo_super_admin_del on public.profili;
create policy solo_super_admin_upd on public.profili as restrictive for update to authenticated
  using (public.e_super_admin()) with check (public.e_super_admin());
create policy solo_super_admin_del on public.profili as restrictive for delete to authenticated
  using (public.e_super_admin());

-- Controllo: 3 righe per tabella (2 per profili), tutte RESTRICTIVE.
select tablename, policyname, cmd, permissive from pg_policies
where schemaname = 'public' and policyname like 'solo_super_admin%' order by 1, 2;
