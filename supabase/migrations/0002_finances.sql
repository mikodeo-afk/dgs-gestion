-- DGS Bamako Gestion : dépenses, factures clients et fournisseurs,
-- frais généraux et rentabilité par projet.
-- Chaque dépense et chaque facture est rattachée à un chantier ;
-- « chantier_id » vide = frais généraux de fonctionnement (hors projet).

create table public.parametres (
  cle    text primary key,
  valeur numeric not null,
  libelle text not null
);
insert into public.parametres values
  ('seuil_validation', 2000000, 'Au-delà de ce montant (FCFA), seuls les détenteurs du droit « Valider au-delà » valident'),
  ('tva', 18, 'Taux de TVA appliqué aux factures clients (%)');

create or replace function public.parametre(p_cle text)
returns numeric language sql stable security definer set search_path = public as $$
  select valeur from parametres where cle = p_cle
$$;

-- ---------------------------------------------------------------------------
-- Dépenses
-- ---------------------------------------------------------------------------
create table public.depenses (
  id            uuid primary key default gen_random_uuid(),
  chantier_id   uuid references public.chantiers(id) on delete restrict,
  objet         text not null,
  montant       numeric(14,0) not null check (montant > 0),
  demandeur_id  uuid not null references public.profils(id) default auth.uid(),
  date_depense  date not null default current_date,
  statut        text not null default 'Demandée' check (statut in ('Demandée','Validée','Rejetée','Payée')),
  valideur_id   uuid references public.profils(id),
  valide_le     timestamptz,
  payeur_id     uuid references public.profils(id),
  paye_le       timestamptz,
  cree_le       timestamptz not null default now()
);
create index on public.depenses (chantier_id);
create index on public.depenses (demandeur_id);

-- ---------------------------------------------------------------------------
-- Factures clients (toujours rattachées à un projet)
-- ---------------------------------------------------------------------------
create table public.factures_clients (
  id            uuid primary key default gen_random_uuid(),
  numero        text unique,
  chantier_id   uuid not null references public.chantiers(id) on delete restrict,
  objet         text not null,
  montant_ht    numeric(14,0) not null check (montant_ht > 0),
  taux_tva      numeric(5,2) not null default 18,
  date_emission date not null default current_date,
  echeance      date not null,
  statut        text not null default 'Émise' check (statut in ('Émise','Payée','Annulée')),
  encaisse_le   date,
  emise_par     uuid references public.profils(id) default auth.uid(),
  cree_le       timestamptz not null default now()
);

create or replace function public.numeroter_facture()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_annee text := to_char(new.date_emission, 'YYYY'); v_n int;
begin
  perform pg_advisory_xact_lock(hashtext('factures_clients_' || v_annee));
  select count(*) + 1 into v_n from factures_clients where numero like 'FAC-' || v_annee || '-%';
  new.numero := 'FAC-' || v_annee || '-' || lpad(v_n::text, 3, '0');
  new.taux_tva := public.parametre('tva');
  return new;
end $$;
create trigger numeroter_facture before insert on public.factures_clients
for each row execute function public.numeroter_facture();

-- ---------------------------------------------------------------------------
-- Factures fournisseurs (projet ou frais généraux)
-- ---------------------------------------------------------------------------
create table public.factures_fournisseurs (
  id             uuid primary key default gen_random_uuid(),
  fournisseur    text not null,
  numero         text not null,
  chantier_id    uuid references public.chantiers(id) on delete restrict,
  objet          text not null,
  montant_ht     numeric(14,0) not null check (montant_ht > 0),
  date_reception date not null default current_date,
  echeance       date,
  statut         text not null default 'Reçue' check (statut in ('Reçue','Validée','Rejetée','Payée')),
  saisie_par     uuid references public.profils(id) default auth.uid(),
  valideur_id    uuid references public.profils(id),
  valide_le      timestamptz,
  paye_le        timestamptz,
  cree_le        timestamptz not null default now(),
  unique (fournisseur, numero)
);

-- ---------------------------------------------------------------------------
-- Frais généraux saisis à la main (loyer, internet, véhicules de direction…)
-- ---------------------------------------------------------------------------
create table public.frais_generaux (
  id        uuid primary key default gen_random_uuid(),
  mois      date not null check (extract(day from mois) = 1),
  categorie text not null,
  libelle   text not null,
  montant   numeric(14,0) not null check (montant > 0),
  saisi_par uuid references public.profils(id) default auth.uid(),
  cree_le   timestamptz not null default now()
);
create index on public.frais_generaux (mois);

-- ---------------------------------------------------------------------------
-- Circuit de validation : seules ces fonctions changent un statut.
-- ---------------------------------------------------------------------------
create or replace function public.peut_valider(p_montant numeric)
returns boolean language sql stable security definer set search_path = public as $$
  select public.a_droit('dep.valider_tout')
      or (public.a_droit('dep.valider') and p_montant <= public.parametre('seuil_validation'))
$$;

create or replace function public.decider_depense(p_id uuid, p_accepte boolean)
returns void language plpgsql security definer set search_path = public as $$
declare d depenses;
begin
  select * into d from depenses where id = p_id for update;
  if not found then raise exception 'Dépense introuvable.'; end if;
  if d.statut <> 'Demandée' then raise exception 'Cette dépense a déjà été traitée.'; end if;
  if d.demandeur_id = auth.uid() then raise exception 'Vous ne pouvez pas valider votre propre demande.'; end if;
  if not public.peut_valider(d.montant) then
    raise exception 'Ce montant dépasse votre seuil de validation.';
  end if;
  update depenses set statut = case when p_accepte then 'Validée' else 'Rejetée' end,
                      valideur_id = auth.uid(), valide_le = now()
  where id = p_id;
end $$;

create or replace function public.payer_depense(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.a_droit('dep.payer') then raise exception 'Vous n''avez pas le droit de payer les dépenses.'; end if;
  update depenses set statut = 'Payée', payeur_id = auth.uid(), paye_le = now() where id = p_id and statut = 'Validée';
  if not found then raise exception 'Seule une dépense validée peut être payée.'; end if;
end $$;

create or replace function public.decider_facture_fournisseur(p_id uuid, p_accepte boolean)
returns void language plpgsql security definer set search_path = public as $$
declare f factures_fournisseurs;
begin
  select * into f from factures_fournisseurs where id = p_id for update;
  if not found then raise exception 'Facture introuvable.'; end if;
  if f.statut <> 'Reçue' then raise exception 'Cette facture a déjà été traitée.'; end if;
  if f.saisie_par = auth.uid() then raise exception 'Vous ne pouvez pas valider une facture que vous avez saisie.'; end if;
  if not public.peut_valider(f.montant_ht) then raise exception 'Ce montant dépasse votre seuil de validation.'; end if;
  update factures_fournisseurs set statut = case when p_accepte then 'Validée' else 'Rejetée' end,
                                   valideur_id = auth.uid(), valide_le = now()
  where id = p_id;
end $$;

create or replace function public.payer_facture_fournisseur(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.a_droit('dep.payer') then raise exception 'Vous n''avez pas le droit de payer les fournisseurs.'; end if;
  update factures_fournisseurs set statut = 'Payée', paye_le = now() where id = p_id and statut = 'Validée';
  if not found then raise exception 'Seule une facture validée (bon à payer) peut être payée.'; end if;
end $$;

create or replace function public.encaisser_facture(p_id uuid, p_date date default current_date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.a_droit('fc.encaisser') then raise exception 'Vous n''avez pas le droit d''encaisser.'; end if;
  update factures_clients set statut = 'Payée', encaisse_le = p_date where id = p_id and statut = 'Émise';
  if not found then raise exception 'Cette facture n''est pas en attente de paiement.'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Rentabilité et frais généraux
-- ---------------------------------------------------------------------------
-- Postes dont le salaire est un frais général ; les autres (terrain) sont imputés aux projets.
create or replace function public.poste_administratif(p public.poste)
returns boolean language sql immutable as $$ select p in ('pdg','do','raf','rh','compta') $$;

-- Chantiers sur lesquels travaille une personne de terrain.
create or replace function public.chantiers_de(p_profil uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from chantiers where chef_projet_id = p_profil
  union
  select chantier_id from taches where assigne_id in (select public.equipe_de(p_profil))
    and public.poste_de(p_profil) in ('ce','tech')
$$;

-- Coût mensuel de main-d'œuvre d'un chantier : salaires du personnel de terrain,
-- répartis à parts égales entre les chantiers où chacun travaille.
create or replace function public.main_oeuvre_mensuelle(p_chantier uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(r.salaire_base / nullif((select count(*) from public.chantiers_de(p.id)), 0)), 0)
  from profils p join remunerations r on r.profil_id = p.id
  where p.actif and not public.poste_administratif(p.poste)
    and p_chantier in (select public.chantiers_de(p.id))
$$;

create or replace function public.rentabilite_chantiers()
returns table (
  chantier_id uuid, code text, nom text, montant_marche numeric, budget_depenses numeric,
  facture_ht numeric, encaisse_ht numeric, depenses numeric, factures_fournisseurs numeric,
  main_oeuvre numeric, couts numeric, marge numeric
) language sql stable security definer set search_path = public as $$
  with base as (
    select c.id, c.code, c.nom, coalesce(f.montant_marche,0) marche, coalesce(f.budget_depenses,0) budget,
      (select coalesce(sum(montant_ht),0) from factures_clients x where x.chantier_id = c.id and x.statut <> 'Annulée') fact,
      (select coalesce(sum(montant_ht),0) from factures_clients x where x.chantier_id = c.id and x.statut = 'Payée') enc,
      (select coalesce(sum(montant),0) from depenses d where d.chantier_id = c.id and d.statut in ('Validée','Payée')) dep,
      (select coalesce(sum(montant_ht),0) from factures_fournisseurs ff where ff.chantier_id = c.id and ff.statut in ('Validée','Payée')) ff,
      round(public.main_oeuvre_mensuelle(c.id) *
        ((extract(year from age(date_trunc('month', current_date), date_trunc('month', c.date_debut))) * 12
          + extract(month from age(date_trunc('month', current_date), date_trunc('month', c.date_debut))) + 1))) mo
    from chantiers c left join chantiers_finance f on f.chantier_id = c.id
    where public.a_droit('fin.voir') and c.id in (select public.mes_chantiers())
  )
  select id, code, nom, marche, budget, fact, enc, dep, ff, mo, dep + ff + mo, fact - (dep + ff + mo)
  from base order by code
$$;

-- Détail des frais généraux d'un mois : saisies, dépenses et factures hors projet,
-- et salaires du personnel administratif.
create or replace function public.frais_generaux_du_mois(p_mois date)
returns table (source text, categorie text, libelle text, montant numeric)
language sql stable security definer set search_path = public as $$
  select * from (
    select 'Saisie'::text, categorie, libelle, montant from frais_generaux
      where mois = date_trunc('month', p_mois)::date
    union all
    select 'Dépense', 'Divers', objet, montant from depenses
      where chantier_id is null and statut in ('Validée','Payée') and date_trunc('month', date_depense) = date_trunc('month', p_mois)
    union all
    select 'Facture ' || numero, fournisseur, objet, montant_ht from factures_fournisseurs
      where chantier_id is null and statut in ('Validée','Payée') and date_trunc('month', date_reception) = date_trunc('month', p_mois)
    union all
    select 'Paie', 'Salaires', 'Salaires du personnel administratif (direction, RAF, RH, comptabilité)',
      coalesce(sum(r.salaire_base), 0)
      from profils p join remunerations r on r.profil_id = p.id
      where p.actif and public.poste_administratif(p.poste)
  ) x
  where public.a_droit('fg.voir') or public.a_droit('fg.saisir')
$$;

-- ---------------------------------------------------------------------------
-- Sécurité ligne par ligne
-- ---------------------------------------------------------------------------
alter table public.parametres            enable row level security;
alter table public.depenses              enable row level security;
alter table public.factures_clients      enable row level security;
alter table public.factures_fournisseurs enable row level security;
alter table public.frais_generaux        enable row level security;

create policy lecture on public.parametres for select to authenticated using (public.mon_poste() is not null);
create policy modification on public.parametres for update to authenticated
  using (public.a_droit('droits.gerer')) with check (public.a_droit('droits.gerer'));

-- Dépenses : la direction et la finance voient tout ; le chef de projet celles de ses
-- chantiers ; chacun voit les siennes et celles de son équipe.
create policy lecture on public.depenses for select to authenticated using (
  (public.est_global() and (public.a_droit('dep.valider') or public.a_droit('dep.valider_tout')
     or public.a_droit('dep.payer') or public.a_droit('fin.voir') or public.a_droit('dep.demander')))
  or demandeur_id in (select public.equipe_de(auth.uid()))
  or exists (select 1 from chantiers c where c.id = chantier_id and c.chef_projet_id = auth.uid())
);
create policy demande on public.depenses for insert to authenticated with check (
  public.a_droit('dep.demander') and demandeur_id = auth.uid() and statut = 'Demandée'
  and valideur_id is null and payeur_id is null
  and (case when chantier_id is null then public.a_droit('fg.saisir')
            else public.est_global() or chantier_id in (select public.mes_chantiers()) end)
);

create policy lecture on public.factures_clients for select to authenticated
  using (public.a_droit('fin.voir') and chantier_id in (select public.mes_chantiers()));
create policy emission on public.factures_clients for insert to authenticated
  with check (public.a_droit('fc.emettre') and statut = 'Émise');

create policy lecture on public.factures_fournisseurs for select to authenticated using (
  public.a_droit('fin.voir') and (
    chantier_id in (select public.mes_chantiers())
    or (chantier_id is null and (public.a_droit('fg.voir') or public.a_droit('fg.saisir')))
  )
);
create policy saisie on public.factures_fournisseurs for insert to authenticated
  with check (public.a_droit('ff.enregistrer') and statut = 'Reçue' and valideur_id is null);

create policy lecture on public.frais_generaux for select to authenticated
  using (public.a_droit('fg.voir') or public.a_droit('fg.saisir'));
create policy saisie on public.frais_generaux for insert to authenticated with check (public.a_droit('fg.saisir'));
create policy suppression on public.frais_generaux for delete to authenticated using (public.a_droit('fg.saisir'));

grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
