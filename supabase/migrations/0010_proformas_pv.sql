-- DGS Bamako Gestion : proformas de soumission et PV d'exécution.
-- Proforma : en soumissionnant, le Responsable technique initie la proforma ;
--            elle est étudiée et validée par le DG (PDG) ET par le DO (deux visas).
-- PV d'exécution : le chef de projet établit les PV pour les clients et pour les prestataires.
--            Un PV signé sert de base à la facture (client ou prestataire).

insert into public.permissions (cle, groupe, libelle, ordre) values
  ('pf.initier', 'Commercial', 'Initier une proforma de soumission', 14),
  ('pf.valider', 'Commercial', 'Viser les proformas (visa DG ou visa DO)', 15),
  ('pv.initier', 'Activités',  'Établir les PV d''exécution (clients et prestataires)', 16)
on conflict do nothing;

insert into public.permissions_poste (poste, cle) values
  ('rt',  'pf.initier'),
  ('pdg', 'pf.valider'), ('do', 'pf.valider'),
  ('cp',  'pv.initier')
on conflict do nothing;

create or replace function public.numeroter_document()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_pref text := case tg_table_name when 'proformas' then 'PF' else 'PV' end;
        v_annee text := to_char(current_date, 'YYYY'); v_n int;
begin
  perform pg_advisory_xact_lock(hashtext(tg_table_name || v_annee));
  execute format('select count(*) + 1 from public.%I where numero like $1', tg_table_name)
    into v_n using v_pref || '-' || v_annee || '-%';
  new.numero := v_pref || '-' || v_annee || '-' || lpad(v_n::text, 3, '0');
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Proformas de soumission
-- ---------------------------------------------------------------------------
create table public.proformas (
  id            uuid primary key default gen_random_uuid(),
  numero        text unique,
  client        text not null,
  objet         text not null,
  domaine       text not null check (domaine in ('BTP','Énergie','Télécoms')),
  details       text,
  montant_ht    numeric(14,0) not null check (montant_ht > 0),
  taux_tva      numeric(5,2) not null default 18 check (taux_tva >= 0 and taux_tva <= 100),
  montant_tva   numeric(14,0) generated always as (round(montant_ht * taux_tva / 100)) stored,
  montant_ttc   numeric(14,0) generated always as (montant_ht + round(montant_ht * taux_tva / 100)) stored,
  date_limite   date,
  statut        text not null default 'À viser' check (statut in ('À viser','Validée','Rejetée','Gagnée','Perdue')),
  visa_dg_par   uuid references public.profils(id),
  visa_dg_le    timestamptz,
  visa_do_par   uuid references public.profils(id),
  visa_do_le    timestamptz,
  motif_rejet   text,
  initie_par    uuid not null references public.profils(id) default auth.uid(),
  cree_le       timestamptz not null default now()
);
create trigger numeroter before insert on public.proformas for each row execute function public.numeroter_document();

alter table public.proformas enable row level security;
create policy lecture on public.proformas for select to authenticated using (
  initie_par = auth.uid() or public.a_droit('pf.initier') or public.a_droit('pf.valider') or public.a_droit('fc.emettre')
  or (public.est_global() and public.a_droit('fin.voir'))
);
create policy creation on public.proformas for insert to authenticated with check (
  public.a_droit('pf.initier') and initie_par = auth.uid() and statut = 'À viser'
  and visa_dg_par is null and visa_do_par is null
);

-- Visa du DG ou du DO. Les deux visas sont nécessaires ; un refus de l'un rejette la proforma.
create or replace function public.viser_proforma(p_id uuid, p_accepte boolean, p_motif text default null)
returns text language plpgsql security definer set search_path = public as $$
declare f proformas; v_poste public.poste := public.mon_poste();
begin
  if not public.a_droit('pf.valider') or v_poste not in ('pdg','do') then
    raise exception 'Seuls le DG et le DO visent les proformas.';
  end if;
  select * into f from proformas where id = p_id for update;
  if not found then raise exception 'Proforma introuvable.'; end if;
  if f.statut <> 'À viser' then raise exception 'Cette proforma a déjà été traitée.'; end if;
  if (v_poste = 'pdg' and f.visa_dg_par is not null) or (v_poste = 'do' and f.visa_do_par is not null) then
    raise exception 'Vous avez déjà visé cette proforma.';
  end if;
  if not p_accepte then
    if coalesce(trim(p_motif), '') = '' then raise exception 'Indiquez le motif du refus.'; end if;
    update proformas set statut = 'Rejetée', motif_rejet = trim(p_motif) where id = p_id;
    return 'Rejetée';
  end if;
  if v_poste = 'pdg' then
    update proformas set visa_dg_par = auth.uid(), visa_dg_le = now() where id = p_id returning * into f;
  else
    update proformas set visa_do_par = auth.uid(), visa_do_le = now() where id = p_id returning * into f;
  end if;
  if f.visa_dg_par is not null and f.visa_do_par is not null then
    update proformas set statut = 'Validée' where id = p_id;
    return 'Validée';
  end if;
  return 'À viser';
end $$;

-- Résultat de la soumission (proforma validée seulement).
create or replace function public.resultat_proforma(p_id uuid, p_gagnee boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.a_droit('pf.initier') or public.a_droit('pf.valider') or public.a_droit('fc.emettre')) then
    raise exception 'Vous n''avez pas le droit de suivre les soumissions.';
  end if;
  update proformas set statut = case when p_gagnee then 'Gagnée' else 'Perdue' end where id = p_id and statut = 'Validée';
  if not found then raise exception 'Seule une proforma validée par le DG et le DO peut être gagnée ou perdue.'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- PV d'exécution (clients et prestataires)
-- ---------------------------------------------------------------------------
create table public.pv_execution (
  id            uuid primary key default gen_random_uuid(),
  numero        text unique,
  chantier_id   uuid not null references public.chantiers(id) on delete restrict,
  type          text not null check (type in ('client','prestataire')),
  tiers         text not null,
  objet         text not null,
  date_pv       date not null default current_date,
  avancement    int check (avancement between 0 and 100),
  montant_ht    numeric(14,0) not null check (montant_ht > 0),
  statut        text not null default 'Établi' check (statut in ('Établi','Signé','Facturé')),
  signe_le      date,
  initie_par    uuid not null references public.profils(id) default auth.uid(),
  cree_le       timestamptz not null default now()
);
create index on public.pv_execution (chantier_id);
create trigger numeroter before insert on public.pv_execution for each row execute function public.numeroter_document();

alter table public.pv_execution enable row level security;
create policy lecture on public.pv_execution for select to authenticated using (
  initie_par = auth.uid()
  or ((public.a_droit('pv.initier') or public.a_droit('fin.voir')) and chantier_id in (select public.mes_chantiers()))
  or public.a_droit('fc.emettre') or public.a_droit('ff.enregistrer')
);
create policy creation on public.pv_execution for insert to authenticated with check (
  public.a_droit('pv.initier') and initie_par = auth.uid() and statut = 'Établi' and signe_le is null
  and chantier_id in (select public.mes_chantiers())
);

-- Le chef de projet enregistre la signature du PV par le client ou le prestataire.
create or replace function public.signer_pv(p_id uuid, p_le date default current_date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.a_droit('pv.initier') then raise exception 'Vous n''avez pas le droit de gérer les PV d''exécution.'; end if;
  update pv_execution set statut = 'Signé', signe_le = coalesce(p_le, current_date)
  where id = p_id and statut = 'Établi' and chantier_id in (select public.mes_chantiers());
  if not found then raise exception 'Seul un PV établi de vos projets peut être marqué signé.'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Les factures s'appuient sur les PV signés
-- ---------------------------------------------------------------------------
alter table public.factures_clients add column pv_id uuid unique references public.pv_execution(id) on delete restrict;
alter table public.factures_fournisseurs
  add column pv_id uuid unique references public.pv_execution(id) on delete restrict,
  add column bon_commande_id uuid references public.bons_commande(id) on delete restrict;

-- Facture client : un PV client signé et non facturé est obligatoire ; le projet et le montant HT viennent du PV.
create or replace function public.facture_client_depuis_pv()
returns trigger language plpgsql security definer set search_path = public as $$
declare p pv_execution;
begin
  if new.pv_id is null then raise exception 'Une facture client doit s''appuyer sur un PV d''exécution client signé.'; end if;
  select * into p from pv_execution where id = new.pv_id for update;
  if not found or p.type <> 'client' or p.statut <> 'Signé' then
    raise exception 'Le PV choisi doit être un PV client signé et pas encore facturé.';
  end if;
  new.chantier_id := p.chantier_id;
  new.montant_ht := p.montant_ht;
  update pv_execution set statut = 'Facturé' where id = p.id;
  return new;
end $$;
create trigger facture_client_depuis_pv before insert on public.factures_clients
for each row execute function public.facture_client_depuis_pv();

-- Facture fournisseur : PV prestataire signé et/ou bon de commande validé, facultatifs, du même projet.
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
create trigger facture_fournisseur_liens before insert on public.factures_fournisseurs
for each row execute function public.facture_fournisseur_liens();

grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
