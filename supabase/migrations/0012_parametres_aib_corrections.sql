-- DGS Gestion : paramètres réglables par pays, AIB sur les factures, corrections.
-- 1. Le PDG, le DO et le RAF règlent les paramètres de leur pays (TVA, AIB, seuil…).
-- 2. AIB (acompte sur impôt assis sur les bénéfices) : calculé sur le HT, retenu par le
--    client sur nos factures et par DGS sur les factures fournisseurs. Net = TTC − AIB.
-- 3. Corrections : une pièce enregistrée n'est jamais modifiée. On l'annule avec un motif
--    (trace de qui, quand, pourquoi) puis on en saisit une nouvelle ; une facture client
--    encaissée ou déjà remise au client se corrige par un avoir.

insert into public.permissions (cle, groupe, libelle, ordre) values
  ('doc.annuler',  'Finances',       'Annuler une facture ou un PV (avec motif) et émettre des avoirs', 36),
  ('param.gerer',  'Administration', 'Régler les paramètres du pays (TVA, AIB, seuil de validation…)', 61)
on conflict do nothing;

insert into public.permissions_poste (poste, cle) values
  ('pdg','doc.annuler'),('do','doc.annuler'),('raf','doc.annuler'),
  ('pdg','param.gerer'),('do','param.gerer'),('raf','param.gerer')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Paramètres
-- ---------------------------------------------------------------------------
insert into public.parametres (pays, cle, valeur, libelle)
select p.code, 'aib', case p.code when 'BJ' then 1 else 0 end,
       'Taux AIB proposé par défaut sur les factures (%) — 0 = non applicable'
from public.pays p
on conflict do nothing;
update public.parametres set libelle = 'Taux de TVA des factures (%)' where cle = 'tva';

alter table public.parametres
  add column modifie_par uuid references public.profils(id),
  add column modifie_le  timestamptz,
  add constraint parametres_valeur_check check (valeur >= 0 and (cle not in ('tva','aib','inps_salarie') or valeur <= 100));

drop policy modification on public.parametres;
create policy modification on public.parametres for update to authenticated
  using (public.a_droit('param.gerer')) with check (public.a_droit('param.gerer'));

create or replace function public.trace_parametre()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cle is distinct from old.cle then raise exception 'La clé d''un paramètre ne change pas.'; end if;
  new.modifie_par := auth.uid();
  new.modifie_le := now();
  return new;
end $$;
create trigger trace_parametre before update on public.parametres
for each row execute function public.trace_parametre();

-- ---------------------------------------------------------------------------
-- AIB et traces d'annulation sur les factures
-- ---------------------------------------------------------------------------
alter table public.factures_clients
  add column taux_aib numeric(5,2) not null default 0 check (taux_aib >= 0 and taux_aib <= 100),
  add column montant_aib numeric(14,0) generated always as (round(montant_ht * taux_aib / 100)) stored,
  add column net_a_payer numeric(14,0) generated always as
    (montant_ht + round(montant_ht * taux_tva / 100) - round(montant_ht * taux_aib / 100)) stored,
  add column annulee_par uuid references public.profils(id),
  add column annulee_le timestamptz,
  add column motif_annulation text;

alter table public.factures_fournisseurs
  add column taux_aib numeric(5,2) not null default 0 check (taux_aib >= 0 and taux_aib <= 100),
  add column montant_aib numeric(14,0) generated always as (round(montant_ht * taux_aib / 100)) stored,
  add column net_a_payer numeric(14,0) generated always as
    (montant_ht + round(montant_ht * taux_tva / 100) - round(montant_ht * taux_aib / 100)) stored,
  add column annulee_par uuid references public.profils(id),
  add column annulee_le timestamptz,
  add column motif_annulation text,
  drop constraint factures_fournisseurs_statut_check,
  add constraint factures_fournisseurs_statut_check check (statut in ('Reçue','Validée','Rejetée','Payée','Annulée'));

alter table public.pv_execution
  add column annule_par uuid references public.profils(id),
  add column annule_le timestamptz,
  add column motif_annulation text,
  drop constraint pv_execution_statut_check,
  add constraint pv_execution_statut_check check (statut in ('Établi','Signé','Facturé','Annulé'));

-- Une facture annulée libère son PV, qui peut être refacturé.
alter table public.factures_clients drop constraint factures_clients_pv_id_key;
create unique index factures_clients_pv_actif on public.factures_clients (pv_id) where statut <> 'Annulée';
alter table public.factures_fournisseurs drop constraint factures_fournisseurs_pv_id_key;
create unique index factures_fournisseurs_pv_actif on public.factures_fournisseurs (pv_id) where statut not in ('Annulée','Rejetée');
-- Le numéro d'une facture fournisseur annulée peut être ressaisi correctement.
alter table public.factures_fournisseurs drop constraint factures_fournisseurs_pays_fournisseur_numero_key;
create unique index factures_fournisseurs_numero_actif on public.factures_fournisseurs (pays, fournisseur, numero) where statut <> 'Annulée';

-- TVA d'une facture client : le taux du pays, ou 0 si la facture est exonérée.
create or replace function public.numeroter_facture()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_annee text := to_char(new.date_emission, 'YYYY'); v_n int;
begin
  perform pg_advisory_xact_lock(hashtext('factures_clients_' || new.pays || v_annee));
  select count(*) + 1 into v_n from factures_clients where pays = new.pays and numero like 'FAC-' || v_annee || '-%';
  new.numero := 'FAC-' || v_annee || '-' || lpad(v_n::text, 3, '0');
  if coalesce(new.taux_tva, -1) <> 0 then new.taux_tva := public.parametre('tva', new.pays); end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Annulations (motif obligatoire)
-- ---------------------------------------------------------------------------
create or replace function public.annuler_facture_client(p_id uuid, p_motif text)
returns void language plpgsql security definer set search_path = public as $$
declare f factures_clients;
begin
  if not public.a_droit('doc.annuler') then raise exception 'Vous n''avez pas le droit d''annuler une facture.'; end if;
  if coalesce(trim(p_motif), '') = '' then raise exception 'Indiquez le motif de l''annulation.'; end if;
  select * into f from factures_clients where id = p_id for update;
  if not found then raise exception 'Facture introuvable.'; end if;
  if f.statut <> 'Émise' then
    raise exception 'Seule une facture émise et non encaissée peut être annulée. Pour une facture encaissée, émettez un avoir.';
  end if;
  if exists (select 1 from avoirs_clients where facture_id = p_id) then
    raise exception 'Cette facture a déjà un avoir : corrigez-la par un nouvel avoir.';
  end if;
  update factures_clients set statut = 'Annulée', annulee_par = auth.uid(), annulee_le = now(), motif_annulation = trim(p_motif)
  where id = p_id;
  if f.pv_id is not null then update pv_execution set statut = 'Signé' where id = f.pv_id and statut = 'Facturé'; end if;
end $$;

create or replace function public.annuler_facture_fournisseur(p_id uuid, p_motif text)
returns void language plpgsql security definer set search_path = public as $$
declare f factures_fournisseurs;
begin
  if not public.a_droit('doc.annuler') then raise exception 'Vous n''avez pas le droit d''annuler une facture.'; end if;
  if coalesce(trim(p_motif), '') = '' then raise exception 'Indiquez le motif de l''annulation.'; end if;
  select * into f from factures_fournisseurs where id = p_id for update;
  if not found then raise exception 'Facture introuvable.'; end if;
  if f.statut not in ('Reçue','Validée') then raise exception 'Seule une facture fournisseur non payée peut être annulée.'; end if;
  update factures_fournisseurs set statut = 'Annulée', annulee_par = auth.uid(), annulee_le = now(), motif_annulation = trim(p_motif)
  where id = p_id;
  if f.pv_id is not null then update pv_execution set statut = 'Signé' where id = f.pv_id and statut = 'Facturé'; end if;
end $$;

-- Un PV facturé s'annule après sa facture. Le chef de projet peut annuler son PV non signé.
create or replace function public.annuler_pv(p_id uuid, p_motif text)
returns void language plpgsql security definer set search_path = public as $$
declare p pv_execution;
begin
  if coalesce(trim(p_motif), '') = '' then raise exception 'Indiquez le motif de l''annulation.'; end if;
  select * into p from pv_execution where id = p_id for update;
  if not found then raise exception 'PV introuvable.'; end if;
  if not (public.a_droit('doc.annuler')
          or (public.a_droit('pv.initier') and p.initie_par = auth.uid() and p.statut = 'Établi')) then
    raise exception 'Vous n''avez pas le droit d''annuler ce PV.';
  end if;
  if p.statut = 'Facturé' then raise exception 'Ce PV est facturé : annulez d''abord la facture.'; end if;
  if p.statut = 'Annulé' then raise exception 'Ce PV est déjà annulé.'; end if;
  update pv_execution set statut = 'Annulé', annule_par = auth.uid(), annule_le = now(), motif_annulation = trim(p_motif)
  where id = p_id;
end $$;

-- ---------------------------------------------------------------------------
-- Avoirs sur factures clients
-- ---------------------------------------------------------------------------
create table public.avoirs_clients (
  id          uuid primary key default gen_random_uuid(),
  pays        text references public.pays(code),
  numero      text,
  facture_id  uuid not null references public.factures_clients(id) on delete restrict,
  chantier_id uuid references public.chantiers(id) on delete restrict,
  motif       text not null check (trim(motif) <> ''),
  montant_ht  numeric(14,0) not null check (montant_ht > 0),
  taux_tva    numeric(5,2) not null default 0,
  taux_aib    numeric(5,2) not null default 0,
  montant_tva numeric(14,0) generated always as (round(montant_ht * taux_tva / 100)) stored,
  montant_ttc numeric(14,0) generated always as (montant_ht + round(montant_ht * taux_tva / 100)) stored,
  montant_aib numeric(14,0) generated always as (round(montant_ht * taux_aib / 100)) stored,
  net_a_payer numeric(14,0) generated always as
    (montant_ht + round(montant_ht * taux_tva / 100) - round(montant_ht * taux_aib / 100)) stored,
  date_avoir  date not null default current_date,
  emis_par    uuid references public.profils(id) default auth.uid(),
  cree_le     timestamptz not null default now(),
  unique (pays, numero)
);
create index on public.avoirs_clients (facture_id);

-- Le nom « avoir_controle » passe avant « garde_pays » : le pays vient de la facture.
create or replace function public.avoir_controle()
returns trigger language plpgsql security definer set search_path = public as $$
declare f factures_clients; v_deja numeric; v_annee text := to_char(new.date_avoir, 'YYYY'); v_n int;
begin
  select * into f from factures_clients where id = new.facture_id for update;
  if not found or f.statut not in ('Émise','Payée') then raise exception 'Un avoir porte sur une facture émise ou encaissée.'; end if;
  select coalesce(sum(montant_ht), 0) into v_deja from avoirs_clients where facture_id = f.id;
  if v_deja + new.montant_ht > f.montant_ht then
    raise exception 'Les avoirs ne peuvent pas dépasser le montant HT de la facture (reste : % FCFA).', f.montant_ht - v_deja;
  end if;
  new.pays := f.pays;
  new.chantier_id := f.chantier_id;
  new.taux_tva := f.taux_tva;
  new.taux_aib := f.taux_aib;
  new.emis_par := auth.uid();
  perform pg_advisory_xact_lock(hashtext('avoirs_clients' || f.pays || v_annee));
  select count(*) + 1 into v_n from avoirs_clients where pays = f.pays and numero like 'AV-' || v_annee || '-%';
  new.numero := 'AV-' || v_annee || '-' || lpad(v_n::text, 3, '0');
  return new;
end $$;
create trigger avoir_controle before insert on public.avoirs_clients
for each row execute function public.avoir_controle();
create trigger garde_pays before insert or update on public.avoirs_clients
for each row execute function public.garde_pays();

alter table public.avoirs_clients enable row level security;
create policy pays on public.avoirs_clients as restrictive for all to authenticated
  using (pays = public.pays_courant()) with check (pays = public.pays_courant());
create policy lecture on public.avoirs_clients for select to authenticated
  using (public.a_droit('fc.emettre') or public.a_droit('doc.annuler')
         or (public.a_droit('fin.voir') and chantier_id in (select public.mes_chantiers())));
create policy emission on public.avoirs_clients for insert to authenticated
  with check (public.a_droit('doc.annuler'));

-- ---------------------------------------------------------------------------
-- Rentabilité : les avoirs réduisent le facturé (et l'encaissé s'ils portent sur une facture payée)
-- ---------------------------------------------------------------------------
create or replace function public.rentabilite_chantiers()
returns table (
  chantier_id uuid, code text, nom text, montant_marche numeric, budget_depenses numeric,
  facture_ht numeric, encaisse_ht numeric, depenses numeric, factures_fournisseurs numeric,
  main_oeuvre numeric, couts numeric, marge numeric
) language sql stable security definer set search_path = public as $$
  with base as (
    select c.id, c.code, c.nom, coalesce(f.montant_marche,0) marche, coalesce(f.budget_depenses,0) budget,
      (select coalesce(sum(montant_ht),0) from factures_clients x where x.chantier_id = c.id and x.statut <> 'Annulée')
        - (select coalesce(sum(a.montant_ht),0) from avoirs_clients a where a.chantier_id = c.id) fact,
      (select coalesce(sum(montant_ht),0) from factures_clients x where x.chantier_id = c.id and x.statut = 'Payée')
        - (select coalesce(sum(a.montant_ht),0) from avoirs_clients a join factures_clients x on x.id = a.facture_id
           where a.chantier_id = c.id and x.statut = 'Payée') enc,
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

grant select, insert, update, delete on public.avoirs_clients to authenticated;
grant execute on all functions in schema public to authenticated;
