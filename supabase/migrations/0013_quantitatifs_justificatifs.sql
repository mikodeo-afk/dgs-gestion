-- DGS Gestion : quantitatifs ligne par ligne et justificatifs signés.
-- 1. Clients, fournisseurs et prestataires, chacun avec son bordereau des prix (prix unitaire HT par libellé).
-- 2. Chantier : activités à mener et quantitatifs prévisionnels, ligne par ligne (prix du bordereau du client).
-- 3. PV d'exécution : quantités réellement exécutées, ligne par ligne ; le montant du PV en est la somme.
--    La facture reprend les lignes du PV signé.
-- 4. Un PV ne peut être marqué signé qu'après le dépôt du document signé (scan ou photo).
--    Les autres pièces (bons de commande, factures, proformas, dépenses) peuvent aussi recevoir leur justificatif.

insert into public.permissions (cle, groupe, libelle, ordre) values
  ('tiers.gerer', 'Finances', 'Enregistrer les clients, fournisseurs et prestataires et leurs bordereaux des prix', 37)
on conflict do nothing;
insert into public.permissions_poste (poste, cle) values
  ('pdg','tiers.gerer'),('do','tiers.gerer'),('raf','tiers.gerer'),('commercial','tiers.gerer'),('rla','tiers.gerer')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Clients, fournisseurs, prestataires et bordereaux des prix
-- ---------------------------------------------------------------------------
create table public.tiers (
  id         uuid primary key default gen_random_uuid(),
  pays       text references public.pays(code),
  type       text not null check (type in ('client','fournisseur','prestataire')),
  nom        text not null check (trim(nom) <> ''),
  ifu        text,
  rccm       text,
  adresse    text,
  telephone  text,
  email      text,
  contact    text,
  actif      boolean not null default true,
  cree_par   uuid references public.profils(id) default auth.uid(),
  cree_le    timestamptz not null default now()
);
create unique index tiers_nom_unique on public.tiers (pays, type, lower(trim(nom)));

create table public.bordereau_prix (
  id               uuid primary key default gen_random_uuid(),
  pays             text references public.pays(code),
  tiers_id         uuid not null references public.tiers(id) on delete cascade,
  code             text,
  designation      text not null check (trim(designation) <> ''),
  unite            text not null check (trim(unite) <> ''),
  prix_unitaire_ht numeric(14,0) not null check (prix_unitaire_ht >= 0),
  actif            boolean not null default true,
  cree_le          timestamptz not null default now(),
  unique (tiers_id, designation)
);
create index on public.bordereau_prix (tiers_id);

-- Le pays d'une ligne du bordereau est celui du tiers (le nom « bordereau_pays » passe avant « garde_pays »).
create or replace function public.bordereau_pays()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select pays into new.pays from tiers where id = new.tiers_id;
  return new;
end $$;
create trigger bordereau_pays before insert or update on public.bordereau_prix
for each row execute function public.bordereau_pays();

create or replace function public.voit_tiers()
returns boolean language sql stable security definer set search_path = public as $$
  select public.a_droit('tiers.gerer') or public.a_droit('fin.voir') or public.a_droit('pv.initier') or public.a_droit('chantier.creer')
      or public.a_droit('fc.emettre') or public.a_droit('ff.enregistrer') or public.a_droit('bc.initier') or public.a_droit('da.demander')
      or public.a_droit('pf.initier')
$$;

-- ---------------------------------------------------------------------------
-- Chantier : activités et quantitatifs prévisionnels
-- ---------------------------------------------------------------------------
alter table public.chantiers add column client_id uuid references public.tiers(id) on delete restrict;

create table public.chantier_lignes (
  id               uuid primary key default gen_random_uuid(),
  chantier_id      uuid not null references public.chantiers(id) on delete cascade,
  ordre            int not null default 0,
  bordereau_id     uuid references public.bordereau_prix(id) on delete set null,
  designation      text not null check (trim(designation) <> ''),
  unite            text not null check (trim(unite) <> ''),
  quantite_prevue  numeric(14,3) not null check (quantite_prevue > 0),
  prix_unitaire_ht numeric(14,0) not null default 0 check (prix_unitaire_ht >= 0),
  montant_ht       numeric(14,0) generated always as (round(quantite_prevue * prix_unitaire_ht)) stored,
  cree_le          timestamptz not null default now()
);
create index on public.chantier_lignes (chantier_id);

-- Une ligne tirée du bordereau reprend son libellé, son unité et son prix.
create or replace function public.ligne_depuis_bordereau()
returns trigger language plpgsql security definer set search_path = public as $$
declare b bordereau_prix;
begin
  if new.bordereau_id is not null then
    select * into b from bordereau_prix where id = new.bordereau_id;
    if not found then raise exception 'Ligne du bordereau introuvable.'; end if;
    new.designation := b.designation;
    new.unite := b.unite;
    new.prix_unitaire_ht := b.prix_unitaire_ht;
  end if;
  return new;
end $$;
create trigger ligne_depuis_bordereau before insert on public.chantier_lignes
for each row execute function public.ligne_depuis_bordereau();

-- ---------------------------------------------------------------------------
-- PV : quantités réellement exécutées
-- ---------------------------------------------------------------------------
alter table public.pv_execution
  add column tiers_id uuid references public.tiers(id) on delete restrict,
  drop constraint pv_execution_montant_ht_check,
  add constraint pv_execution_montant_ht_check check (montant_ht >= 0);
alter table public.pv_execution alter column montant_ht set default 0;

create table public.pv_lignes (
  id                uuid primary key default gen_random_uuid(),
  pv_id             uuid not null references public.pv_execution(id) on delete cascade,
  chantier_ligne_id uuid references public.chantier_lignes(id) on delete restrict,
  bordereau_id      uuid references public.bordereau_prix(id) on delete set null,
  designation       text not null check (trim(designation) <> ''),
  unite             text not null check (trim(unite) <> ''),
  quantite          numeric(14,3) not null check (quantite > 0),
  prix_unitaire_ht  numeric(14,0) not null check (prix_unitaire_ht >= 0),
  montant_ht        numeric(14,0) generated always as (round(quantite * prix_unitaire_ht)) stored,
  cree_le           timestamptz not null default now()
);
create index on public.pv_lignes (pv_id);
create index on public.pv_lignes (chantier_ligne_id);

-- Les lignes ne changent que tant que le PV n'est pas signé ; les prix viennent du marché
-- (ligne du chantier pour un PV client) ou du bordereau du prestataire.
create or replace function public.controle_pv_ligne()
returns trigger language plpgsql security definer set search_path = public as $$
declare p pv_execution; l chantier_lignes; b bordereau_prix; v_pv uuid := coalesce(new.pv_id, old.pv_id);
begin
  select * into p from pv_execution where id = v_pv for update;
  if p.statut <> 'Établi' then raise exception 'Ce PV est signé ou annulé : ses lignes ne peuvent plus changer.'; end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and new.pv_id <> old.pv_id then raise exception 'Une ligne ne change pas de PV.'; end if;
  if new.chantier_ligne_id is not null then
    select * into l from chantier_lignes where id = new.chantier_ligne_id;
    if not found or l.chantier_id <> p.chantier_id then raise exception 'Cette activité n''appartient pas au chantier du PV.'; end if;
    new.designation := l.designation;
    new.unite := l.unite;
    if p.type = 'client' then new.prix_unitaire_ht := l.prix_unitaire_ht; end if;
  end if;
  if new.bordereau_id is not null then
    select * into b from bordereau_prix where id = new.bordereau_id;
    if not found or (p.tiers_id is not null and b.tiers_id <> p.tiers_id) then
      raise exception 'Ce prix n''appartient pas au bordereau du client ou du prestataire du PV.';
    end if;
    if new.chantier_ligne_id is null then new.designation := b.designation; new.unite := b.unite; end if;
    new.prix_unitaire_ht := b.prix_unitaire_ht;
  end if;
  return new;
end $$;
create trigger controle_pv_ligne before insert or update or delete on public.pv_lignes
for each row execute function public.controle_pv_ligne();

create or replace function public.total_pv()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_pv uuid := coalesce(new.pv_id, old.pv_id);
begin
  update pv_execution set montant_ht = (select coalesce(sum(montant_ht), 0) from pv_lignes where pv_id = v_pv) where id = v_pv;
  return null;
end $$;
create trigger total_pv after insert or update or delete on public.pv_lignes
for each row execute function public.total_pv();

-- ---------------------------------------------------------------------------
-- Justificatifs (documents signés déposés)
-- ---------------------------------------------------------------------------
create table public.justificatifs (
  id          uuid primary key default gen_random_uuid(),
  pays        text references public.pays(code),
  objet       text not null check (objet in ('pv','bon_commande','facture_client','facture_fournisseur','proforma','depense')),
  objet_id    uuid not null,
  chemin      text not null unique,
  nom_fichier text not null,
  taille      bigint,
  type_mime   text,
  depose_par  uuid references public.profils(id) default auth.uid(),
  depose_le   timestamptz not null default now()
);
create index on public.justificatifs (objet, objet_id);
create trigger garde_pays before insert or update on public.justificatifs
for each row execute function public.garde_pays();

create or replace function public.peut_justifier(p_objet text)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_objet
    when 'pv' then public.a_droit('pv.initier') or public.a_droit('doc.annuler')
    when 'bon_commande' then public.a_droit('bc.initier') or public.a_droit('bc.valider')
    when 'facture_client' then public.a_droit('fc.emettre')
    when 'facture_fournisseur' then public.a_droit('ff.enregistrer')
    when 'proforma' then public.a_droit('pf.initier') or public.a_droit('pf.valider')
    when 'depense' then public.a_droit('dep.demander') or public.a_droit('dep.payer')
    else false end
$$;

-- Le chemin du fichier commence par le pays, puis le type de pièce et son identifiant.
create or replace function public.controle_justificatif()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if split_part(new.chemin, '/', 1) <> coalesce(new.pays, public.pays_courant())
     or split_part(new.chemin, '/', 2) <> new.objet or split_part(new.chemin, '/', 3) <> new.objet_id::text then
    raise exception 'Chemin de fichier invalide.';
  end if;
  new.depose_par := auth.uid();
  new.depose_le := now();
  return new;
end $$;
create trigger controle_justificatif before insert on public.justificatifs
for each row execute function public.controle_justificatif();

-- Le PV ne passe à « Signé » qu'avec son document signé et au moins un montant.
create or replace function public.signer_pv(p_id uuid, p_le date default current_date)
returns void language plpgsql security definer set search_path = public as $$
declare p pv_execution;
begin
  if not public.a_droit('pv.initier') then raise exception 'Vous n''avez pas le droit de gérer les PV d''exécution.'; end if;
  select * into p from pv_execution where id = p_id and statut = 'Établi' and chantier_id in (select public.mes_chantiers()) for update;
  if not found then raise exception 'Seul un PV établi de vos projets peut être marqué signé.'; end if;
  if p.montant_ht <= 0 then raise exception 'Ajoutez les quantités exécutées avant de faire signer le PV.'; end if;
  if not exists (select 1 from justificatifs where objet = 'pv' and objet_id = p_id) then
    raise exception 'Déposez d''abord le PV signé (scan ou photo) pour justifier la signature.';
  end if;
  update pv_execution set statut = 'Signé', signe_le = coalesce(p_le, current_date) where id = p_id;
end $$;

-- La facture d'un prestataire liée à un PV reprend son montant.
create or replace function public.facture_fournisseur_liens()
returns trigger language plpgsql security definer set search_path = public as $$
declare p pv_execution; b bons_commande;
begin
  if new.pv_id is not null then
    select * into p from pv_execution where id = new.pv_id for update;
    if not found or p.type <> 'prestataire' or p.statut <> 'Signé' then
      raise exception 'Le PV choisi doit être un PV prestataire signé et pas encore facturé.';
    end if;
    new.chantier_id := p.chantier_id;
    new.montant_ht := p.montant_ht;
    update pv_execution set statut = 'Facturé' where id = p.id;
  end if;
  if new.bon_commande_id is not null then
    select * into b from bons_commande where id = new.bon_commande_id;
    if not found or b.statut <> 'Validé' then raise exception 'Le bon de commande choisi doit être validé par le DO.'; end if;
    if new.chantier_id is distinct from b.chantier_id then
      if new.pv_id is not null then raise exception 'Le PV et le bon de commande ne concernent pas le même projet.'; end if;
      new.chantier_id := b.chantier_id;
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Droits d'accès
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['tiers','bordereau_prix'] loop
    execute format('create trigger garde_pays before insert or update on public.%I for each row execute function public.garde_pays()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy pays on public.%I as restrictive for all to authenticated using (pays = public.pays_courant()) with check (pays = public.pays_courant())', t);
    execute format('create policy lecture on public.%I for select to authenticated using (public.voit_tiers())', t);
    execute format('create policy ecriture on public.%I for insert to authenticated with check (public.a_droit(''tiers.gerer''))', t);
    execute format('create policy modification on public.%I for update to authenticated using (public.a_droit(''tiers.gerer'')) with check (public.a_droit(''tiers.gerer''))', t);
  end loop;
end $$;
create policy suppression on public.bordereau_prix for delete to authenticated using (public.a_droit('tiers.gerer'));

alter table public.chantier_lignes enable row level security;
create policy pays on public.chantier_lignes as restrictive for all to authenticated
  using (public.pays_de_chantier(chantier_id) = public.pays_courant()) with check (public.pays_de_chantier(chantier_id) = public.pays_courant());
create policy lecture on public.chantier_lignes for select to authenticated using (
  public.a_droit('chantier.creer') or public.a_droit('fc.emettre')
  or ((public.a_droit('fin.voir') or public.a_droit('pv.initier')) and chantier_id in (select public.mes_chantiers())));
create policy ecriture on public.chantier_lignes for all to authenticated
  using (public.a_droit('chantier.creer')) with check (public.a_droit('chantier.creer'));

alter table public.pv_lignes enable row level security;
create policy lecture on public.pv_lignes for select to authenticated using (pv_id in (select id from public.pv_execution));
create policy ecriture on public.pv_lignes for all to authenticated
  using (public.a_droit('pv.initier') and exists (select 1 from public.pv_execution p where p.id = pv_id and p.chantier_id in (select public.mes_chantiers())))
  with check (public.a_droit('pv.initier') and exists (select 1 from public.pv_execution p where p.id = pv_id and p.chantier_id in (select public.mes_chantiers())));

alter table public.justificatifs enable row level security;
create policy pays on public.justificatifs as restrictive for all to authenticated
  using (pays = public.pays_courant()) with check (pays = public.pays_courant());
create policy lecture on public.justificatifs for select to authenticated using (public.peut_justifier(objet) or public.a_droit('fin.voir'));
create policy depot on public.justificatifs for insert to authenticated with check (public.peut_justifier(objet));

grant select, insert, update, delete on public.tiers, public.bordereau_prix, public.chantier_lignes, public.pv_lignes to authenticated;
grant select, insert on public.justificatifs to authenticated;
grant execute on all functions in schema public to authenticated;

-- ---------------------------------------------------------------------------
-- Stockage des fichiers (Supabase Storage) : un dossier par pays, lecture et dépôt dans son pays
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('justificatifs', 'justificatifs', false, 20971520, array['application/pdf','image/jpeg','image/png','image/webp'])
    on conflict (id) do nothing;
    execute $p$create policy "justificatifs : dépôt dans son pays" on storage.objects for insert to authenticated
      with check (bucket_id = 'justificatifs' and (storage.foldername(name))[1] = public.pays_courant())$p$;
    execute $p$create policy "justificatifs : lecture dans son pays" on storage.objects for select to authenticated
      using (bucket_id = 'justificatifs' and (storage.foldername(name))[1] = public.pays_courant())$p$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Dossier administratif et fiscal des clients, fournisseurs et prestataires
-- ---------------------------------------------------------------------------
-- Documents administratifs (RCCM, IFU, statuts…) déposés à l'enregistrement de la société ;
-- documents fiscaux (attestation de régularité fiscale…) avec leur date de fin de validité.
alter table public.justificatifs
  add column type_document text,
  add column valide_jusquau date,
  drop constraint justificatifs_objet_check,
  add constraint justificatifs_objet_check check (objet in ('pv','bon_commande','facture_client','facture_fournisseur','proforma','depense','tiers'));

create or replace function public.categorie_document(p_type text)
returns text language sql immutable as $$
  select case
    when p_type in ('RCCM','IFU / NIF','Statuts','Pièce d''identité du gérant','Autre document administratif') then 'administratif'
    when p_type in ('Attestation de régularité fiscale','Quitus fiscal','Attestation CNSS / INPS','Autre document fiscal') then 'fiscal'
  end
$$;

create or replace function public.controle_document_tiers()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.objet = 'tiers' then
    if public.categorie_document(new.type_document) is null then raise exception 'Précisez le type de document.'; end if;
    if public.categorie_document(new.type_document) = 'fiscal' and new.valide_jusquau is null then
      raise exception 'Indiquez jusqu''à quand ce document fiscal est valable.';
    end if;
  end if;
  return new;
end $$;
create trigger controle_document_tiers before insert on public.justificatifs
for each row execute function public.controle_document_tiers();

create or replace function public.peut_justifier(p_objet text)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_objet
    when 'pv' then public.a_droit('pv.initier') or public.a_droit('doc.annuler')
    when 'bon_commande' then public.a_droit('bc.initier') or public.a_droit('bc.valider')
    when 'facture_client' then public.a_droit('fc.emettre')
    when 'facture_fournisseur' then public.a_droit('ff.enregistrer')
    when 'proforma' then public.a_droit('pf.initier') or public.a_droit('pf.valider')
    when 'depense' then public.a_droit('dep.demander') or public.a_droit('dep.payer')
    when 'tiers' then public.a_droit('tiers.gerer')
    else false end
$$;
-- Les documents des sociétés se consultent comme leur fiche.
drop policy lecture on public.justificatifs;
create policy lecture on public.justificatifs for select to authenticated
  using (public.peut_justifier(objet) or public.a_droit('fin.voir') or (objet = 'tiers' and public.voit_tiers()));

create or replace function public.dossier_administratif(p_tiers uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from justificatifs where objet = 'tiers' and objet_id = p_tiers and public.categorie_document(type_document) = 'administratif')
$$;
create or replace function public.fiscal_valide(p_tiers uuid, p_date date default current_date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from justificatifs where objet = 'tiers' and objet_id = p_tiers
                 and type_document in ('Attestation de régularité fiscale','Quitus fiscal') and valide_jusquau >= p_date)
$$;

-- Une société sans dossier administratif ne peut pas figurer sur un PV, un chantier ou une facture.
create or replace function public.exige_dossier_tiers()
returns trigger language plpgsql security definer set search_path = public as $$
declare v uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
begin
  if v is not null and (tg_op = 'INSERT' or v is distinct from (to_jsonb(old) ->> tg_argv[0])::uuid)
     and not public.dossier_administratif(v) then
    raise exception 'Cette société n''a pas encore de dossier administratif : déposez ses documents (RCCM, IFU…) sur sa fiche.';
  end if;
  return new;
end $$;
alter table public.factures_fournisseurs add column tiers_id uuid references public.tiers(id) on delete restrict;
create trigger exige_dossier_tiers before insert or update on public.pv_execution for each row execute function public.exige_dossier_tiers('tiers_id');
create trigger exige_dossier_tiers before insert or update on public.chantiers for each row execute function public.exige_dossier_tiers('client_id');
create trigger exige_dossier_tiers before insert or update on public.factures_fournisseurs for each row execute function public.exige_dossier_tiers('tiers_id');

-- Bon à payer et paiement d'une facture fournisseur : la société doit être enregistrée
-- et à jour de ses obligations fiscales (attestation en cours de validité).
create or replace function public.controle_fiscal_paiement(p_facture uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare f factures_fournisseurs;
begin
  select * into f from factures_fournisseurs where id = p_facture;
  if f.tiers_id is null then
    raise exception 'Rattachez cette facture à un fournisseur enregistré (avec son dossier) avant de la payer.';
  end if;
  if not public.fiscal_valide(f.tiers_id) then
    raise exception 'Le fournisseur n''a pas d''attestation fiscale en cours de validité : déposez-la sur sa fiche avant le paiement.';
  end if;
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
  if p_accepte then perform public.controle_fiscal_paiement(p_id); end if;
  update factures_fournisseurs set statut = case when p_accepte then 'Validée' else 'Rejetée' end,
                                   valideur_id = auth.uid(), valide_le = now()
  where id = p_id;
end $$;

create or replace function public.payer_facture_fournisseur(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.a_droit('dep.payer') then raise exception 'Vous n''avez pas le droit de payer les fournisseurs.'; end if;
  perform public.controle_fiscal_paiement(p_id);
  update factures_fournisseurs set statut = 'Payée', paye_le = now() where id = p_id and statut = 'Validée';
  if not found then raise exception 'Seule une facture validée (bon à payer) peut être payée.'; end if;
end $$;

-- Le nom du fournisseur sur la facture est celui de sa fiche.
create or replace function public.facture_fournisseur_nom()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tiers_id is not null then select nom into new.fournisseur from tiers where id = new.tiers_id; end if;
  return new;
end $$;
create trigger facture_fournisseur_nom before insert or update on public.factures_fournisseurs
for each row execute function public.facture_fournisseur_nom();

grant execute on all functions in schema public to authenticated;

-- ---------------------------------------------------------------------------
-- Ouverture d'un chantier : bon de commande du client, ou validation du DG / DO
-- ---------------------------------------------------------------------------
-- Un chantier créé dans l'application est « À valider ». Il est ouvert dès que le bon de commande
-- du client est déposé, ou, en son absence, quand le DG ou le DO (autre que son créateur) le valide.
-- Tant qu'il n'est pas ouvert : ni PV, ni demande d'achat, ni dépense sur ce chantier.
alter table public.chantiers
  add column validation text not null default 'Validé' check (validation in ('À valider','Validé')),
  add column ouverture text,
  add column valide_par uuid references public.profils(id),
  add column valide_le timestamptz,
  add column cree_par uuid references public.profils(id) default auth.uid();
update public.chantiers set ouverture = 'Chantier existant' where ouverture is null;

alter table public.justificatifs drop constraint justificatifs_objet_check,
  add constraint justificatifs_objet_check check (objet in ('pv','bon_commande','facture_client','facture_fournisseur','proforma','depense','tiers','bc_client'));

create or replace function public.peut_justifier(p_objet text)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_objet
    when 'pv' then public.a_droit('pv.initier') or public.a_droit('doc.annuler')
    when 'bon_commande' then public.a_droit('bc.initier') or public.a_droit('bc.valider')
    when 'facture_client' then public.a_droit('fc.emettre')
    when 'facture_fournisseur' then public.a_droit('ff.enregistrer')
    when 'proforma' then public.a_droit('pf.initier') or public.a_droit('pf.valider')
    when 'depense' then public.a_droit('dep.demander') or public.a_droit('dep.payer')
    when 'tiers' then public.a_droit('tiers.gerer')
    when 'bc_client' then public.a_droit('chantier.creer')
    else false end
$$;

create or replace function public.chantier_a_valider()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.validation := 'À valider';
    new.ouverture := null; new.valide_par := null; new.valide_le := null;
    new.cree_par := auth.uid();
  end if;
  return new;
end $$;
create trigger chantier_a_valider before insert on public.chantiers
for each row execute function public.chantier_a_valider();

-- Le statut d'ouverture ne se modifie pas à la main.
create or replace function public.garde_validation_chantier()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and current_setting('dgs.ouverture', true) is distinct from 'on'
     and (new.validation, new.ouverture, new.valide_par, new.valide_le, new.cree_par)
         is distinct from (old.validation, old.ouverture, old.valide_par, old.valide_le, old.cree_par) then
    raise exception 'L''ouverture d''un chantier passe par le bon de commande du client ou la validation du DG ou du DO.';
  end if;
  return new;
end $$;
create trigger garde_validation_chantier before update on public.chantiers
for each row execute function public.garde_validation_chantier();

-- Dépôt du bon de commande du client : le chantier est ouvert.
create or replace function public.ouvrir_par_bc_client()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.objet = 'bc_client' then
    perform set_config('dgs.ouverture', 'on', true);
    update chantiers set validation = 'Validé', ouverture = 'Bon de commande du client', valide_par = auth.uid(), valide_le = now()
    where id = new.objet_id and validation = 'À valider';
    perform set_config('dgs.ouverture', 'off', true);
  end if;
  return null;
end $$;
create trigger ouvrir_par_bc_client after insert on public.justificatifs
for each row execute function public.ouvrir_par_bc_client();

-- Sans bon de commande : validation par le DG (PDG) ou le DO, qui n'a pas créé le chantier.
create or replace function public.valider_chantier(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c chantiers;
begin
  if public.mon_poste() not in ('pdg','do') then raise exception 'Seuls le DG et le DO valident l''ouverture d''un chantier.'; end if;
  select * into c from chantiers where id = p_id for update;
  if not found or c.validation <> 'À valider' then raise exception 'Ce chantier n''est pas en attente de validation.'; end if;
  if c.cree_par = auth.uid() then raise exception 'Le chantier doit être validé par l''autre dirigeant (DG ou DO) que celui qui l''a créé.'; end if;
  perform set_config('dgs.ouverture', 'on', true);
  update chantiers set validation = 'Validé', ouverture = 'Validé sans bon de commande', valide_par = auth.uid(), valide_le = now() where id = p_id;
  perform set_config('dgs.ouverture', 'off', true);
end $$;

create or replace function public.exige_chantier_ouvert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.chantier_id is not null and exists (select 1 from chantiers where id = new.chantier_id and validation = 'À valider') then
    raise exception 'Ce chantier attend son ouverture : déposez le bon de commande du client, ou faites-le valider par le DG ou le DO.';
  end if;
  return new;
end $$;
create trigger exige_chantier_ouvert before insert on public.pv_execution for each row execute function public.exige_chantier_ouvert();
create trigger exige_chantier_ouvert before insert on public.demandes_achat for each row execute function public.exige_chantier_ouvert();
create trigger exige_chantier_ouvert before insert on public.depenses for each row execute function public.exige_chantier_ouvert();

grant execute on all functions in schema public to authenticated;
