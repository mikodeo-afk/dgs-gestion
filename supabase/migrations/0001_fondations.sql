-- DGS Bamako Gestion : fondations
-- Profils, droits par poste et par personne, chantiers, tâches, journal.
-- Toutes les règles d'accès sont vérifiées dans la base (Row Level Security),
-- pas seulement à l'écran.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Postes et droits
-- ---------------------------------------------------------------------------
create type public.poste as enum ('pdg','do','raf','rh','compta','cp','ce','tech');

create table public.permissions (
  cle      text primary key,
  groupe   text not null,
  libelle  text not null,
  ordre    int  not null
);

create table public.permissions_poste (
  poste public.poste not null,
  cle   text not null references public.permissions(cle) on delete cascade,
  primary key (poste, cle)
);

create table public.profils (
  id                uuid primary key references auth.users(id) on delete cascade,
  nom               text not null,
  email             text,
  poste             public.poste not null default 'tech',
  responsable_id    uuid references public.profils(id) on delete set null,
  telephone         text,
  contrat           text not null default 'CDD' check (contrat in ('CDI','CDD','Stage','Journalier','Mandataire')),
  date_embauche     date not null default current_date,
  date_fin          date,
  visage_enregistre boolean not null default false,
  actif             boolean not null default false,
  cree_le           timestamptz not null default now()
);

-- Les salaires sont dans une table à part : seuls les postes autorisés y ont accès.
create table public.remunerations (
  profil_id    uuid primary key references public.profils(id) on delete cascade,
  salaire_base numeric(14,0) not null default 0 check (salaire_base >= 0)
);

-- Droits accordés ou retirés à une personne, en plus des droits de son poste.
create table public.droits_personne (
  profil_id   uuid not null references public.profils(id) on delete cascade,
  cle         text not null references public.permissions(cle) on delete cascade,
  accorde     boolean not null,
  modifie_par uuid references public.profils(id) on delete set null default auth.uid(),
  modifie_le  timestamptz not null default now(),
  primary key (profil_id, cle)
);

-- ---------------------------------------------------------------------------
-- Activités
-- ---------------------------------------------------------------------------
create table public.chantiers (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  nom             text not null,
  domaine         text not null check (domaine in ('BTP','Énergie','Télécoms')),
  lieu            text,
  client          text,
  chef_projet_id  uuid references public.profils(id) on delete set null,
  date_debut      date not null default current_date,
  statut          text not null default 'Démarrage' check (statut in ('Démarrage','En cours','Suspendu','Terminé')),
  latitude        double precision,
  longitude       double precision,
  rayon_pointage  int not null default 300 check (rayon_pointage between 50 and 2000),
  cree_le         timestamptz not null default now()
);

-- Montants du chantier : visibles seulement avec le droit « fin.voir », dans son périmètre.
create table public.chantiers_finance (
  chantier_id      uuid primary key references public.chantiers(id) on delete cascade,
  montant_marche   numeric(14,0) not null default 0 check (montant_marche >= 0),
  budget_depenses  numeric(14,0) not null default 0 check (budget_depenses >= 0)
);

create table public.taches (
  id           uuid primary key default gen_random_uuid(),
  chantier_id  uuid not null references public.chantiers(id) on delete cascade,
  titre        text not null,
  assigne_id   uuid references public.profils(id) on delete set null,
  avancement   int not null default 0 check (avancement between 0 and 100),
  echeance     date,
  cree_par     uuid references public.profils(id) on delete set null default auth.uid(),
  maj_le       timestamptz not null default now()
);
create index on public.taches (chantier_id);
create index on public.taches (assigne_id);

create table public.journal (
  id        bigint generated always as identity primary key,
  auteur_id uuid references public.profils(id) on delete set null default auth.uid(),
  message   text not null,
  cree_le   timestamptz not null default now()
);
create index on public.journal (cree_le desc);

-- ---------------------------------------------------------------------------
-- Fonctions d'accès (security definer : elles lisent les tables sans boucle RLS)
-- ---------------------------------------------------------------------------
create or replace function public.poste_de(p_profil uuid)
returns public.poste language sql stable security definer set search_path = public as $$
  select poste from profils where id = p_profil and actif
$$;

create or replace function public.mon_poste()
returns public.poste language sql stable security definer set search_path = public as $$
  select public.poste_de(auth.uid())
$$;

-- Vrai si la personne a le droit : d'abord son réglage personnel, sinon celui de son poste.
-- Le PDG et le DO gardent toujours « droits.gerer » pour que personne ne puisse les bloquer.
create or replace function public.a_droit(p_cle text, p_profil uuid default auth.uid())
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_poste public.poste;
  v_perso boolean;
begin
  v_poste := public.poste_de(p_profil);
  if v_poste is null then return false; end if;
  if p_cle = 'droits.gerer' and v_poste in ('pdg','do') then return true; end if;
  select accorde into v_perso from droits_personne where profil_id = p_profil and cle = p_cle;
  if found then return v_perso; end if;
  return exists (select 1 from permissions_poste where poste = v_poste and cle = p_cle);
end $$;

-- Les postes de terrain ne voient que leur périmètre ; les autres voient toute la filiale.
create or replace function public.est_global()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.mon_poste() not in ('cp','ce','tech'), false)
$$;

-- La personne, les gens qu'elle encadre, et les gens encadrés par ceux-ci.
create or replace function public.equipe_de(p_profil uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select p_profil
  union select id from profils where responsable_id = p_profil
  union select p2.id from profils p1 join profils p2 on p2.responsable_id = p1.id where p1.responsable_id = p_profil
$$;

-- Chantiers dans le périmètre de l'utilisateur connecté.
create or replace function public.mes_chantiers()
returns setof uuid language plpgsql stable security definer set search_path = public as $$
declare v_poste public.poste := public.mon_poste();
begin
  if v_poste is null then return; end if;
  if v_poste not in ('cp','ce','tech') then
    return query select id from chantiers;
  elsif v_poste = 'cp' then
    return query select id from chantiers where chef_projet_id = auth.uid()
                 union select chantier_id from taches where assigne_id in (select public.equipe_de(auth.uid()));
  else
    return query select distinct chantier_id from taches where assigne_id in (select public.equipe_de(auth.uid()));
  end if;
end $$;

-- Avancement de tous les chantiers : tout le monde suit l'évolution globale,
-- même sans voir le détail des tâches.
create or replace function public.avancement_chantiers()
returns table (chantier_id uuid, avancement numeric, nb_taches int, nb_retard int)
language sql stable security definer set search_path = public as $$
  select c.id,
         coalesce(round(avg(t.avancement), 0), 0),
         count(t.id)::int,
         count(t.id) filter (where t.avancement < 100 and t.echeance < current_date)::int
  from chantiers c left join taches t on t.chantier_id = c.id
  where public.mon_poste() is not null
  group by c.id
$$;

-- Liste des droits effectifs de l'utilisateur connecté (pour l'affichage).
create or replace function public.mes_droits()
returns setof text language sql stable security definer set search_path = public as $$
  select cle from permissions where public.a_droit(cle)
$$;

-- ---------------------------------------------------------------------------
-- Création des profils
-- ---------------------------------------------------------------------------
-- Le tout premier compte devient PDG et est actif. Tout autre compte créé par
-- inscription publique reste inactif sans droits : les employés sont créés par
-- les RH depuis l'application, qui active le compte et fixe le poste.
create or replace function public.creer_profil()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_premier boolean;
begin
  select not exists (select 1 from profils) into v_premier;
  insert into profils (id, nom, email, poste, actif, contrat)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data->>'nom',''), split_part(new.email,'@',1)),
          new.email,
          case when v_premier then 'pdg'::poste else 'tech'::poste end,
          v_premier,
          case when v_premier then 'Mandataire' else 'CDD' end);
  return new;
end $$;

create trigger creer_profil_apres_inscription
after insert on auth.users for each row execute function public.creer_profil();

-- ---------------------------------------------------------------------------
-- Garde-fous
-- ---------------------------------------------------------------------------
-- auth.uid() est vide quand le serveur agit avec la clé de service, après avoir
-- vérifié lui-même les droits : on le laisse passer.
create or replace function public.controle_profil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.poste is distinct from old.poste or new.actif is distinct from old.actif then
    if not public.a_droit('droits.gerer') then
      raise exception 'Seule une personne qui gère les droits peut changer un poste ou désactiver un compte.';
    end if;
    if old.poste = 'pdg' and public.mon_poste() <> 'pdg' then
      raise exception 'Seul le PDG peut changer le poste ou le statut du PDG.';
    end if;
    if new.poste = 'pdg' and old.poste <> 'pdg' and public.mon_poste() <> 'pdg' then
      raise exception 'Seul le PDG peut nommer un autre PDG.';
    end if;
  end if;
  return new;
end $$;
create trigger controle_profil before update on public.profils
for each row execute function public.controle_profil();

create or replace function public.controle_droit_personne()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cle = 'droits.gerer' and not new.accorde and public.poste_de(new.profil_id) in ('pdg','do') then
    raise exception 'Le PDG et le Directeur des Opérations gardent toujours la gestion des droits.';
  end if;
  if public.poste_de(new.profil_id) = 'pdg' and coalesce(public.mon_poste()::text,'') <> 'pdg' and auth.uid() is not null then
    raise exception 'Seul le PDG peut modifier ses propres droits.';
  end if;
  new.modifie_le := now();
  new.modifie_par := coalesce(auth.uid(), new.modifie_par);
  return new;
end $$;
create trigger controle_droit_personne before insert or update on public.droits_personne
for each row execute function public.controle_droit_personne();

-- Hors des postes de direction, une mise à jour de tâche ne change que l'avancement.
create or replace function public.controle_tache()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if not public.est_global() and not public.a_droit('tache.creer')
     and (new.titre is distinct from old.titre or new.chantier_id is distinct from old.chantier_id
          or new.assigne_id is distinct from old.assigne_id or new.echeance is distinct from old.echeance) then
    raise exception 'Vous pouvez seulement mettre à jour l''avancement de cette tâche.';
  end if;
  new.maj_le := now();
  return new;
end $$;
create trigger controle_tache before update on public.taches
for each row execute function public.controle_tache();

-- ---------------------------------------------------------------------------
-- Sécurité ligne par ligne
-- ---------------------------------------------------------------------------
alter table public.permissions        enable row level security;
alter table public.permissions_poste  enable row level security;
alter table public.profils            enable row level security;
alter table public.remunerations      enable row level security;
alter table public.droits_personne    enable row level security;
alter table public.chantiers          enable row level security;
alter table public.chantiers_finance  enable row level security;
alter table public.taches             enable row level security;
alter table public.journal            enable row level security;

create policy lecture on public.permissions       for select to authenticated using (true);
create policy lecture on public.permissions_poste for select to authenticated using (true);

-- Noms et postes : visibles par tous les employés actifs (annuaire).
create policy lecture on public.profils for select to authenticated using (public.mon_poste() is not null);
create policy modification on public.profils for update to authenticated
  using (public.a_droit('emp.ajouter') or public.a_droit('droits.gerer'))
  with check (public.a_droit('emp.ajouter') or public.a_droit('droits.gerer'));

create policy lecture on public.remunerations for select to authenticated
  using (public.a_droit('sal.voir') or profil_id = auth.uid());
create policy ecriture on public.remunerations for all to authenticated
  using (public.a_droit('emp.ajouter')) with check (public.a_droit('emp.ajouter'));

create policy lecture on public.droits_personne for select to authenticated using (public.mon_poste() is not null);
create policy ecriture on public.droits_personne for all to authenticated
  using (public.a_droit('droits.gerer')) with check (public.a_droit('droits.gerer'));

create policy lecture on public.chantiers for select to authenticated using (public.mon_poste() is not null);
create policy creation on public.chantiers for insert to authenticated with check (public.a_droit('chantier.creer'));
create policy modification on public.chantiers for update to authenticated
  using (public.a_droit('chantier.creer')) with check (public.a_droit('chantier.creer'));

create policy lecture on public.chantiers_finance for select to authenticated
  using (public.a_droit('fin.voir') and chantier_id in (select public.mes_chantiers()));
create policy ecriture on public.chantiers_finance for all to authenticated
  using (public.a_droit('chantier.creer')) with check (public.a_droit('chantier.creer'));

create policy lecture on public.taches for select to authenticated
  using (
    (public.est_global() and (public.a_droit('tache.maj') or public.a_droit('tache.creer')))
    or exists (select 1 from public.chantiers c where c.id = chantier_id and c.chef_projet_id = auth.uid())
    or assigne_id in (select public.equipe_de(auth.uid()))
  );
create policy creation on public.taches for insert to authenticated
  with check (
    public.a_droit('tache.creer')
    and (public.est_global() or exists (select 1 from public.chantiers c where c.id = chantier_id and c.chef_projet_id = auth.uid()))
  );
create policy modification on public.taches for update to authenticated
  using (
    public.a_droit('tache.maj')
    and (public.est_global()
         or exists (select 1 from public.chantiers c where c.id = chantier_id and c.chef_projet_id = auth.uid())
         or assigne_id in (select public.equipe_de(auth.uid())))
  )
  with check (public.a_droit('tache.maj'));
create policy suppression on public.taches for delete to authenticated
  using (public.a_droit('tache.creer')
         and (public.est_global() or exists (select 1 from public.chantiers c where c.id = chantier_id and c.chef_projet_id = auth.uid())));

create policy lecture on public.journal for select to authenticated using (public.mon_poste() is not null);
create policy ecriture on public.journal for insert to authenticated
  with check (auteur_id = auth.uid() and public.mon_poste() is not null);

-- ---------------------------------------------------------------------------
-- Catalogue des droits et droits par défaut de chaque poste
-- ---------------------------------------------------------------------------
insert into public.permissions (cle, groupe, libelle, ordre) values
  ('chantier.creer',   'Activités',           'Créer et modifier un chantier', 10),
  ('tache.creer',      'Activités',           'Créer et assigner des tâches', 11),
  ('tache.maj',        'Activités',           'Mettre à jour l''avancement des tâches', 12),
  ('pointer',          'Activités',           'Pointer son arrivée (visage + rayon du chantier)', 13),
  ('dep.demander',     'Dépenses',            'Demander ou enregistrer une dépense', 20),
  ('dep.valider',      'Dépenses',            'Valider jusqu''à 2 000 000 FCFA (dépenses et factures fournisseurs)', 21),
  ('dep.valider_tout', 'Dépenses',            'Valider au-delà de 2 000 000 FCFA', 22),
  ('dep.payer',        'Dépenses',            'Payer les dépenses et les factures fournisseurs', 23),
  ('fin.voir',         'Finances',            'Voir la rentabilité et les factures', 30),
  ('fc.emettre',       'Finances',            'Émettre une facture client', 31),
  ('fc.encaisser',     'Finances',            'Encaisser une facture client', 32),
  ('ff.enregistrer',   'Finances',            'Enregistrer une facture fournisseur', 33),
  ('fg.voir',          'Finances',            'Voir les frais généraux', 34),
  ('fg.saisir',        'Finances',            'Saisir des frais généraux', 35),
  ('sal.voir',         'Ressources humaines', 'Voir les salaires et les contrats', 40),
  ('emp.ajouter',      'Ressources humaines', 'Ajouter et modifier un employé', 41),
  ('pres.saisir',      'Ressources humaines', 'Saisir les présences', 42),
  ('paie.voir',        'Ressources humaines', 'Voir la paie de tout le personnel', 43),
  ('paie.preparer',    'Ressources humaines', 'Préparer la paie', 44),
  ('paie.valider',     'Ressources humaines', 'Valider la paie', 45),
  ('paie.payer',       'Ressources humaines', 'Payer les salaires', 46),
  ('geo.voir',         'Géolocalisation',     'Voir la position des agents', 50),
  ('droits.gerer',     'Administration',      'Attribuer les postes, accorder et retirer des droits', 60);

insert into public.permissions_poste (poste, cle)
select p.poste::public.poste, k.cle from (values ('pdg'),('do')) p(poste) cross join public.permissions k;

insert into public.permissions_poste (poste, cle) values
  ('raf','dep.valider'),('raf','dep.payer'),('raf','fin.voir'),('raf','fc.emettre'),('raf','fc.encaisser'),
  ('raf','ff.enregistrer'),('raf','fg.voir'),('raf','fg.saisir'),('raf','sal.voir'),('raf','paie.voir'),('raf','paie.valider'),
  ('rh','sal.voir'),('rh','emp.ajouter'),('rh','pres.saisir'),('rh','paie.voir'),('rh','paie.preparer'),('rh','geo.voir'),
  ('compta','dep.demander'),('compta','dep.payer'),('compta','fin.voir'),('compta','fc.emettre'),('compta','fc.encaisser'),
  ('compta','ff.enregistrer'),('compta','fg.voir'),('compta','fg.saisir'),('compta','paie.voir'),('compta','paie.payer'),
  ('cp','tache.creer'),('cp','tache.maj'),('cp','dep.demander'),('cp','fin.voir'),('cp','geo.voir'),
  ('ce','tache.maj'),('ce','dep.demander'),('ce','pres.saisir'),('ce','geo.voir'),('ce','pointer'),
  ('tech','tache.maj'),('tech','dep.demander'),('tech','pointer');

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on type public.poste to authenticated;
grant execute on all functions in schema public to authenticated;
