-- P.IVA SEMPRE CON «IT» (27 nov 2026, Nico: "voglio che siano tutte con IT").
-- Stessa regola di normalizzaPIva (app.js): spazi tolti, maiuscole, 11 cifre → IT davanti.
-- Codici fiscali (16) e partite estere non si toccano.

-- 1) ANTEPRIMA: cosa cambia
select nome, p_iva as prima,
       case when regexp_replace(p_iva, '\s', '', 'g') ~ '^[0-9]{11}$'
            then 'IT' || regexp_replace(p_iva, '\s', '', 'g')
            else upper(regexp_replace(p_iva, '\s', '', 'g')) end as dopo
from public.aziende
where p_iva is not null
  and p_iva is distinct from (case when regexp_replace(p_iva, '\s', '', 'g') ~ '^[0-9]{11}$'
            then 'IT' || regexp_replace(p_iva, '\s', '', 'g')
            else upper(regexp_replace(p_iva, '\s', '', 'g')) end)
order by nome;

-- 2) DA GUARDARE A MANO: quello che non e' una P.IVA italiana (CF, estere, refusi)
select nome, p_iva from public.aziende
where p_iva is not null and upper(regexp_replace(p_iva, '\s', '', 'g')) !~ '^IT[0-9]{11}$'
   and regexp_replace(p_iva, '\s', '', 'g') !~ '^[0-9]{11}$'
order by nome;

-- 3) LA MODIFICA
update public.aziende
set p_iva = case when regexp_replace(p_iva, '\s', '', 'g') ~ '^[0-9]{11}$'
                 then 'IT' || regexp_replace(p_iva, '\s', '', 'g')
                 else upper(regexp_replace(p_iva, '\s', '', 'g')) end
where p_iva is not null
  and p_iva is distinct from (case when regexp_replace(p_iva, '\s', '', 'g') ~ '^[0-9]{11}$'
                 then 'IT' || regexp_replace(p_iva, '\s', '', 'g')
                 else upper(regexp_replace(p_iva, '\s', '', 'g')) end);
