-- DGS Bamako Gestion : présences et paie.

insert into public.parametres values
  ('inps_salarie', 3.6, 'Retenue INPS part salariale (%) — taux à confirmer'),
  ('jours_ouvres_mois', 22, 'Jours ouvrés par mois pour la retenue d''absence');

-- ---------------------------------------------------------------------------
-- Présences (une ligne par employé et par jour)
-- ---------------------------------------------------------------------------
create table public.presences (
  profil_id     uuid not null references public.profils(id) on delete cascade,
  jour          date not null,
  statut        text not null check (statut in ('P','A','C')),
  heure_arrivee timestamptz,
  chantier_id   uuid references public.chantiers(id) on delete set null,
  distance_m    int,
  score_visage  int check (score_visage between 0 and 100),
  saisi_par     uuid references public.profils(id) default auth.uid(),
  maj_le        timestamptz not null default now(),
  primary key (profil_id, jour)
);
create index on public.presences (jour);

-- Qui peut saisir la présence de qui : RH et direction pour tout le monde et tout jour ;
-- un chef d'équipe pour son équipe, le jour même seulement.
create or replace function public.peut_saisir_presence(p_profil uuid, p_jour date)
returns boolean language sql stable security definer set search_path = public as $$
  select public.a_droit('pres.saisir')
     and (public.est_global() or (p_jour = current_date and p_profil in (select public.equipe_de(auth.uid()))))
$$;

alter table public.presences enable row level security;
create policy lecture on public.presences for select to authenticated using (
  profil_id = auth.uid()
  or (public.est_global() and (public.a_droit('pres.saisir') or public.a_droit('sal.voir') or public.a_droit('paie.voir')
      or public.a_droit('paie.preparer') or public.a_droit('paie.valider') or public.a_droit('paie.payer')))
  or (public.a_droit('pres.saisir') and profil_id in (select public.equipe_de(auth.uid())))
  or profil_id in (select id from profils where responsable_id = auth.uid())
);
create policy saisie on public.presences for insert to authenticated
  with check (public.peut_saisir_presence(profil_id, jour));
create policy correction on public.presences for update to authenticated
  using (public.peut_saisir_presence(profil_id, jour)) with check (public.peut_saisir_presence(profil_id, jour));

-- ---------------------------------------------------------------------------
-- Paie : un circuit par mois (RH prépare → RAF/PDG/DO valide → comptable paie)
-- ---------------------------------------------------------------------------
create table public.paies (
  mois      date primary key check (extract(day from mois) = 1),
  statut    text not null default 'En préparation' check (statut in ('En préparation','Soumise','Validée','Payée')),
  maj_par   uuid references public.profils(id) default auth.uid(),
  maj_le    timestamptz not null default now()
);

create table public.lignes_paie (
  mois      date not null references public.paies(mois) on delete cascade,
  profil_id uuid not null references public.profils(id) on delete cascade,
  primes    numeric(14,0) not null default 0 check (primes >= 0),
  avances   numeric(14,0) not null default 0 check (avances >= 0),
  primary key (mois, profil_id)
);

create or replace function public.voit_paie()
returns boolean language sql stable security definer set search_path = public as $$
  select public.a_droit('paie.voir') or public.a_droit('paie.preparer') or public.a_droit('paie.valider') or public.a_droit('paie.payer')
$$;

alter table public.paies       enable row level security;
alter table public.lignes_paie enable row level security;
create policy lecture on public.paies for select to authenticated using (public.mon_poste() is not null);
create policy lecture on public.lignes_paie for select to authenticated using (public.voit_paie() or profil_id = auth.uid());
create policy preparation on public.lignes_paie for all to authenticated
  using (public.a_droit('paie.preparer') and exists (select 1 from paies p where p.mois = lignes_paie.mois and p.statut = 'En préparation'))
  with check (public.a_droit('paie.preparer') and exists (select 1 from paies p where p.mois = lignes_paie.mois and p.statut = 'En préparation'));

-- Ouvre la paie d'un mois (RH).
create or replace function public.ouvrir_paie(p_mois date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.a_droit('paie.preparer') then raise exception 'Vous n''avez pas le droit de préparer la paie.'; end if;
  insert into paies (mois) values (date_trunc('month', p_mois)::date) on conflict do nothing;
end $$;

-- Fait avancer la paie d'une étape, selon les droits.
create or replace function public.avancer_paie(p_mois date, p_statut text)
returns void language plpgsql security definer set search_path = public as $$
declare v_actuel text;
begin
  select statut into v_actuel from paies where mois = date_trunc('month', p_mois)::date for update;
  if not found then raise exception 'Cette paie n''existe pas encore.'; end if;
  if (v_actuel = 'En préparation' and p_statut = 'Soumise' and public.a_droit('paie.preparer'))
     or (v_actuel = 'Soumise' and p_statut in ('Validée','En préparation') and public.a_droit('paie.valider'))
     or (v_actuel = 'Validée' and p_statut = 'Payée' and public.a_droit('paie.payer')) then
    update paies set statut = p_statut, maj_par = auth.uid(), maj_le = now() where mois = date_trunc('month', p_mois)::date;
  else
    raise exception 'Étape impossible : la paie est « % » et votre profil ne permet pas de la passer à « % ».', v_actuel, p_statut;
  end if;
end $$;

-- Bulletins du mois. Chacun voit le sien ; les postes autorisés voient tout le monde.
-- Retenue d'absence = salaire ÷ jours ouvrés × absences non justifiées (A).
create or replace function public.bulletins(p_mois date)
returns table (profil_id uuid, nom text, poste public.poste, base numeric, primes numeric, absences int,
               retenue_absences numeric, brut numeric, inps numeric, avances numeric, net numeric)
language sql stable security definer set search_path = public as $$
  with m as (select date_trunc('month', p_mois)::date d),
  b as (
    select p.id, p.nom, p.poste, r.salaire_base base,
      coalesce(l.primes, 0) primes, coalesce(l.avances, 0) avances,
      (select count(*)::int from presences x, m where x.profil_id = p.id and x.statut = 'A'
         and x.jour >= m.d and x.jour < (m.d + interval '1 month')) abs
    from profils p join remunerations r on r.profil_id = p.id
    cross join m left join lignes_paie l on l.profil_id = p.id and l.mois = m.d
    where p.actif and r.salaire_base > 0 and (public.voit_paie() or p.id = auth.uid())
  ),
  c as (
    select *, round(base / public.parametre('jours_ouvres_mois') * abs) ret from b
  )
  select id, nom, poste, base, primes, abs, ret, greatest(base + primes - ret, 0),
         round(greatest(base + primes - ret, 0) * public.parametre('inps_salarie') / 100), avances,
         greatest(base + primes - ret, 0) - round(greatest(base + primes - ret, 0) * public.parametre('inps_salarie') / 100) - avances
  from c order by nom
$$;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
