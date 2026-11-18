-- SUPER ADMIN (18 nov 2026, Nico: "crea solo per me il super admin, poi mano a
-- mano ti dico cosa togliere agli admin").
-- Il super admin e' un admin (ruolo = 'admin') con in piu' `super_admin = true`:
-- tutte le policy e i controlli che chiedono "admin" continuano a valere anche
-- per lui senza toccarli. Le cose tolte agli admin useranno `e_super_admin()`.
-- ⚠ Il repo e' pubblico: l'UPDATE che assegna il super admin (con l'email) e'
-- stato dato SOLO in chat. Qui c'e' la struttura.

alter table public.profili add column if not exists super_admin boolean not null default false;

-- Protezione: il flag si assegna solo dal pannello Supabase (nessun utente
-- collegato, auth.uid() nullo). Da app nessuno lo mette o lo toglie, e il
-- profilo del super admin (ruolo, nome, cancellazione) lo tocca solo lui.
create or replace function public.profili_proteggi_super_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    if new.super_admin then raise exception 'Il super admin si assegna solo dal pannello Supabase'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.super_admin then raise exception 'Il profilo del super admin non si elimina dall''app'; end if;
    return old;
  end if;
  if new.super_admin is distinct from old.super_admin then
    raise exception 'Il super admin si assegna solo dal pannello Supabase';
  end if;
  if old.super_admin and auth.uid() <> old.id then
    raise exception 'Il profilo del super admin lo modifica solo lui';
  end if;
  return new;
end $$;

drop trigger if exists profili_super_admin on public.profili;
create trigger profili_super_admin before insert or update or delete on public.profili
  for each row execute function public.profili_proteggi_super_admin();

-- Per le policy future: "solo il super admin".
create or replace function public.e_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profili where id = auth.uid() and ruolo = 'admin' and super_admin);
$$;
revoke execute on function public.e_super_admin() from public, anon;
grant execute on function public.e_super_admin() to authenticated;

-- Assegnazione (dal pannello): update public.profili set super_admin = true
--   where id = (select id from auth.users where lower(email) = lower('<email>'));
