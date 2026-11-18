-- Superviseur des ventes terrain (PVT) et contrats de prestation.
-- • Superviseur PVT : gère les vendeurs (comptes), les ventes, les extractions SBIN et les avances ;
--   son périmètre de projets est le projet PVT (dépenses, pointage, finances si on lui donne le droit).
-- • Contrat « Prestation » : prestataires (vendeurs terrain, etc.) payés sur facture ou commission,
--   hors masse salariale (ni ITS ni cotisations sociales), sans droits à congés.

insert into public.permissions_poste (poste, cle) values
  ('superviseur','pvt.voir'), ('superviseur','pvt.saisir'), ('superviseur','pvt.gerer'),
  ('superviseur','pointer'), ('superviseur','dep.demander'), ('superviseur','tache.maj')
on conflict do nothing;

create or replace function public.est_global()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.mon_poste() not in ('cp','ce','tech','vendeur','superviseur'), false)
$$;
create or replace function public.poste_administratif(p public.poste)
returns boolean language sql immutable as $$ select p not in ('cp','ce','tech','vendeur','superviseur') $$;

create or replace function public.mes_chantiers()
returns setof uuid language plpgsql stable security definer set search_path = public as $$
declare v_poste public.poste := public.mon_poste(); v_pays text := public.pays_courant();
begin
  if v_poste is null or v_poste = 'vendeur' then return; end if;
  if v_poste = 'superviseur' then
    return query select chantier_id from pvt_contrats where pays = v_pays and chantier_id is not null
                 union select t.chantier_id from taches t join chantiers c on c.id = t.chantier_id
                       where c.pays = v_pays and t.assigne_id = auth.uid();
    return;
  end if;
  if v_poste not in ('cp','ce','tech') then
    return query select id from chantiers where pays = v_pays;
  elsif v_poste = 'cp' then
    return query select id from chantiers where chef_projet_id = auth.uid() and pays = v_pays
                 union select t.chantier_id from taches t join chantiers c on c.id = t.chantier_id
                       where c.pays = v_pays and t.assigne_id in (select public.equipe_de(auth.uid()));
  else
    return query select distinct t.chantier_id from taches t join chantiers c on c.id = t.chantier_id
                 where c.pays = v_pays and t.assigne_id in (select public.equipe_de(auth.uid()));
  end if;
end $$;

alter table public.profils drop constraint if exists profils_contrat_check;
alter table public.profils add constraint profils_contrat_check check (contrat in ('CDI','CDD','Stage','Journalier','Mandataire','Prestation'));
update public.profils set contrat = 'Prestation' where poste = 'vendeur' and contrat = 'Mandataire';

-- Les prestataires ne font pas partie de la masse salariale déclarée.
create or replace function public.masse_salariale_fiscale(p_mois date)
returns table (profil_id uuid, nom text, poste public.poste, contrat text, brut numeric, cnss_salarie numeric,
               declare_cnss boolean, numero_cnss text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.a_droit('fisc.voir') or public.a_droit('fisc.declarer')) then
    raise exception 'Vous n''avez pas accès au calendrier fiscal.';
  end if;
  return query
  with m as (select date_trunc('month', p_mois)::date d),
  b as (
    select p.id, p.nom, p.poste, p.contrat, r.salaire_base base, r.declare_cnss dc, r.numero_cnss nc,
      coalesce(l.primes, 0) primes,
      (select count(*)::int from presences x, m where x.profil_id = p.id and x.statut = 'A'
         and x.jour >= m.d and x.jour < (m.d + interval '1 month')) abs
    from profils p join remunerations r on r.profil_id = p.id
    cross join m left join lignes_paie l on l.profil_id = p.id and l.mois = m.d and l.pays = p.pays
    where p.actif and r.salaire_base > 0 and p.contrat <> 'Prestation' and p.pays = public.pays_courant()
      and p.date_embauche < m.d + interval '1 month'
  ),
  c as (select *, greatest(base + primes - round(base / public.parametre('jours_ouvres_mois') * abs), 0) brut_calc from b)
  select c.id, c.nom, c.poste, c.contrat, c.brut_calc,
         round(c.brut_calc * coalesce(public.parametre('inps_salarie'), 0) / 100), c.dc, c.nc
  from c order by c.nom;
end $$;
grant execute on function public.masse_salariale_fiscale(date) to authenticated;
