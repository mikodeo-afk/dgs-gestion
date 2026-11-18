-- DGS Gestion : ventes terrain Celtiis (contrat PVT avec SBIN SA, Bénin, juillet 2026).
-- DGS est « Partenaire Vente Terrain » : ses vendeurs recrutent des clients Celtiis (fibre, mobile,
-- FWA, Business Connect…). SBIN paie des commissions et des primes (annexe 3) sur les ventes
-- mises en service, d'après l'extraction qu'elle envoie au plus tard le 15 du mois suivant.
-- DGS verse une avance aux vendeurs entre le 30 et le 05 sur leurs ventes déclarées, puis
-- régularise quand l'extraction SBIN est reçue et validée.

-- Le vendeur terrain est un poste de terrain : périmètre limité à lui-même, pas de frais généraux.
create or replace function public.est_global()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.mon_poste() not in ('cp','ce','tech','vendeur'), false)
$$;
create or replace function public.poste_administratif(p public.poste)
returns boolean language sql immutable as $$ select p not in ('cp','ce','tech','vendeur') $$;
create or replace function public.mes_chantiers()
returns setof uuid language plpgsql stable security definer set search_path = public as $$
declare v_poste public.poste := public.mon_poste(); v_pays text := public.pays_courant();
begin
  if v_poste is null or v_poste = 'vendeur' then return; end if;
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

insert into public.permissions (cle, groupe, libelle, ordre) values
  ('pvt.voir',   'Ventes terrain', 'Voir les ventes terrain Celtiis (PVT)', 80),
  ('pvt.saisir', 'Ventes terrain', 'Déclarer les ventes des vendeurs', 81),
  ('pvt.gerer',  'Ventes terrain', 'Gérer les ventes terrain : offres, vendeurs et leurs comptes, extraction SBIN, avances, facture', 82),
  ('pvt.declarer', 'Ventes terrain', 'Déclarer ses propres ventes et mettre à jour le statut de ses lignes (vendeur)', 83)
on conflict do nothing;
insert into public.permissions_poste (poste, cle) values
  ('pdg','pvt.voir'),('do','pvt.voir'),('raf','pvt.voir'),('compta','pvt.voir'),('commercial','pvt.voir'),
  ('pdg','pvt.saisir'),('do','pvt.saisir'),('commercial','pvt.saisir'),
  ('pdg','pvt.gerer'),('do','pvt.gerer'),('commercial','pvt.gerer'),
  ('vendeur','pvt.declarer')
on conflict do nothing;

-- Contrat (un par pays) et réglages.
create table public.pvt_contrats (
  id              uuid primary key default gen_random_uuid(),
  pays            text references public.pays(code),
  reference       text not null default 'Contrat PVT SBIN',
  operateur       text not null default 'SBIN SA (Celtiis)',
  date_debut      date not null,
  taux_avance     numeric(5,2) not null default 50 check (taux_avance between 0 and 100), -- % de la part vendeur des ventes déclarées
  cree_le         timestamptz not null default now()
);
create unique index pvt_contrats_pays on public.pvt_contrats (pays);

-- Grille des offres (annexe 3), modifiable : SBIN peut la faire évoluer.
create table public.pvt_offres (
  id              uuid primary key default gen_random_uuid(),
  pays            text references public.pays(code),
  code            text not null check (trim(code) <> ''),
  libelle         text not null check (trim(libelle) <> ''),
  segment         text not null check (segment in ('B2C','B2B')),
  famille         text not null,                        -- FTTH, FTTO, FWA, Business Connect, FTTR, BMC…
  commission      numeric(12,0) not null check (commission >= 0),   -- commission vente (one shot) HT
  part_vendeur    numeric(12,0) not null check (part_vendeur >= 0),
  part_partenaire numeric(12,0) generated always as (commission - part_vendeur) stored,
  performance     boolean not null default true,        -- compte pour la prime de performance
  actif           boolean not null default true,
  ordre           int not null default 0,
  check (part_vendeur <= commission)
);
create unique index pvt_offres_code on public.pvt_offres (pays, lower(trim(code)));

-- Vendeurs terrain (art. 7 : identité, pièce, numéro Celtiis transmis à SBIN).
create table public.pvt_vendeurs (
  id              uuid primary key default gen_random_uuid(),
  pays            text references public.pays(code),
  nom             text not null check (trim(nom) <> ''),
  telephone       text,
  numero_celtiis  text,
  piece_identite  text,
  segment         text not null default 'B2C' check (segment in ('B2C','B2B')),
  profil_id       uuid references public.profils(id) on delete set null,  -- compte dans l'application, s'il en a un
  debut           date not null default current_date,
  actif           boolean not null default true,
  cree_le         timestamptz not null default now()
);
create unique index pvt_vendeurs_nom on public.pvt_vendeurs (pays, lower(trim(nom)));

-- Ventes : déclarées par les vendeurs, puis validées (ou non) par l'extraction SBIN.
create table public.pvt_ventes (
  id              uuid primary key default gen_random_uuid(),
  pays            text references public.pays(code),
  mois            date not null check (extract(day from mois) = 1),
  date_vente      date not null,
  vendeur_id      uuid references public.pvt_vendeurs(id) on delete restrict,  -- vide : ligne SBIN non attribuée
  offre_id        uuid not null references public.pvt_offres(id) on delete restrict,
  client          text,
  ligne           text check (ligne is null or ligne ~ '^[0-9A-Za-z-]+$'),
  contact         text,
  statut          text not null default 'Déclarée' check (statut in ('Déclarée','Validée','Rejetée')),
  source          text not null default 'Déclaration' check (source in ('Déclaration','Extraction SBIN')),
  motif           text,
  valide_le       date,
  etat_ligne      text check (etat_ligne in ('Active','Suspendue','Résiliée')),  -- mis à jour par le vendeur en fin de mois (rétention)
  etat_maj_le     date,
  cree_par        uuid references public.profils(id) on delete set null default auth.uid(),
  cree_le         timestamptz not null default now()
);
create index on public.pvt_ventes (pays, mois, statut);
create index on public.pvt_ventes (vendeur_id);
create unique index pvt_ventes_ligne on public.pvt_ventes (pays, offre_id, ligne) where ligne is not null and statut <> 'Rejetée';

-- Suivi mensuel : avance, extraction, facture SBIN, paiement, ajustements.
create table public.pvt_mois (
  id                  uuid primary key default gen_random_uuid(),
  pays                text references public.pays(code),
  mois                date not null check (extract(day from mois) = 1),
  extraction_recue_le date,
  facture_numero      text,
  facture_ht          numeric(14,0),
  facture_envoyee_le  date,
  payee_le            date,
  montant_paye        numeric(14,0),
  ajustement          numeric(14,0) not null default 0,   -- bonus/malus de rétention, régularisations SBIN (HT, + ou −)
  ajustement_motif    text,
  note                text,
  cloture             boolean not null default false
);
create unique index pvt_mois_unique on public.pvt_mois (pays, mois);

-- Versements aux vendeurs : avance (30 → 05) puis solde après validation SBIN.
create table public.pvt_versements (
  id              uuid primary key default gen_random_uuid(),
  pays            text references public.pays(code),
  mois            date not null check (extract(day from mois) = 1),
  vendeur_id      uuid not null references public.pvt_vendeurs(id) on delete restrict,
  type            text not null check (type in ('Avance','Solde')),
  montant         numeric(12,0) not null check (montant <> 0),
  verse_le        date not null default current_date,
  mode            text,
  cree_par        uuid references public.profils(id) on delete set null default auth.uid(),
  cree_le         timestamptz not null default now()
);
create index on public.pvt_versements (pays, mois);

-- ---------------------------------------------------------------------------
-- Droits : lecture pvt.voir ; ventes pvt.saisir (un vendeur ayant un compte voit et déclare les siennes) ;
-- le reste pvt.gerer.
-- ---------------------------------------------------------------------------
create or replace function public.mes_vendeurs()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from pvt_vendeurs where profil_id = auth.uid()
$$;

do $$
declare t text;
begin
  foreach t in array array['pvt_contrats','pvt_offres','pvt_vendeurs','pvt_ventes','pvt_mois','pvt_versements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create trigger garde_pays before insert or update on public.%I for each row execute function public.garde_pays()', t);
    execute format('create policy pays on public.%I as restrictive for all to authenticated using (pays = public.pays_courant()) with check (pays = public.pays_courant())', t);
  end loop;
end $$;

create policy lecture on public.pvt_contrats for select to authenticated using (public.a_droit('pvt.voir') or public.a_droit('pvt.saisir'));
create policy gestion on public.pvt_contrats for all to authenticated using (public.a_droit('pvt.gerer')) with check (public.a_droit('pvt.gerer'));
create policy lecture on public.pvt_offres for select to authenticated using (true);
create policy gestion on public.pvt_offres for all to authenticated using (public.a_droit('pvt.gerer')) with check (public.a_droit('pvt.gerer'));
create policy lecture on public.pvt_vendeurs for select to authenticated
  using (public.a_droit('pvt.voir') or public.a_droit('pvt.saisir') or profil_id = auth.uid());
create policy gestion on public.pvt_vendeurs for all to authenticated using (public.a_droit('pvt.gerer')) with check (public.a_droit('pvt.gerer'));
create policy lecture on public.pvt_ventes for select to authenticated
  using (public.a_droit('pvt.voir') or public.a_droit('pvt.saisir') or vendeur_id in (select public.mes_vendeurs()));
-- Déclaration : par la personne habilitée, ou par le vendeur lui-même pour ses ventes ; toujours « Déclarée ».
create policy declaration on public.pvt_ventes for insert to authenticated
  with check (statut = 'Déclarée' and source = 'Déclaration'
              and (public.a_droit('pvt.saisir') or public.a_droit('pvt.gerer') or vendeur_id in (select public.mes_vendeurs())));
-- Correction d'une vente encore déclarée (pas de validation hors gestion).
create policy correction on public.pvt_ventes for update to authenticated
  using (statut = 'Déclarée' and (public.a_droit('pvt.saisir') or vendeur_id in (select public.mes_vendeurs())))
  with check (statut = 'Déclarée');
create policy suppression on public.pvt_ventes for delete to authenticated
  using (statut = 'Déclarée' and (public.a_droit('pvt.saisir') or public.a_droit('pvt.gerer') or vendeur_id in (select public.mes_vendeurs())));
create policy gestion on public.pvt_ventes for all to authenticated using (public.a_droit('pvt.gerer')) with check (public.a_droit('pvt.gerer'));
create policy lecture on public.pvt_mois for select to authenticated using (public.a_droit('pvt.voir'));
create policy gestion on public.pvt_mois for all to authenticated using (public.a_droit('pvt.gerer')) with check (public.a_droit('pvt.gerer'));
create policy lecture on public.pvt_versements for select to authenticated
  using (public.a_droit('pvt.voir') or vendeur_id in (select public.mes_vendeurs()));
create policy gestion on public.pvt_versements for all to authenticated using (public.a_droit('pvt.gerer')) with check (public.a_droit('pvt.gerer'));

-- Statut de la ligne d'un client (rétention) : le vendeur le met à jour à la fin de chaque mois,
-- ce qui déclenche le bonus ou le malus de rétention selon son taux de lignes actives.
create or replace function public.pvt_etat_ligne(p_vente uuid, p_etat text)
returns void language plpgsql security definer set search_path = public as $$
declare v pvt_ventes;
begin
  select * into v from pvt_ventes where id = p_vente and pays = public.pays_courant();
  if v.id is null then raise exception 'Vente introuvable.'; end if;
  if not (public.a_droit('pvt.gerer') or public.a_droit('pvt.saisir') or v.vendeur_id in (select public.mes_vendeurs())) then
    raise exception 'Seul le vendeur de cette ligne ou son superviseur met à jour son statut.';
  end if;
  if v.statut <> 'Validée' then raise exception 'Seules les ventes validées par SBIN ont un statut de ligne.'; end if;
  if p_etat is not null and p_etat not in ('Active','Suspendue','Résiliée') then raise exception 'Statut de ligne inconnu.'; end if;
  update pvt_ventes set etat_ligne = p_etat, etat_maj_le = current_date where id = p_vente;
end $$;

-- ---------------------------------------------------------------------------
-- Rapprochement avec l'extraction SBIN du mois : les lignes présentes passent en « Validée »
-- (avec l'offre d'après SBIN), les lignes SBIN inconnues sont ajoutées sans vendeur (à attribuer).
-- p_lignes : [{ ligne, offre (code), date (AAAA-MM-JJ), client }]
-- ---------------------------------------------------------------------------
create or replace function public.pvt_rapprocher_extraction(p_mois date, p_lignes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d jsonb; v_pays text := public.pays_courant(); v_ligne text; v_offre uuid; v_vente uuid;
  v_valides int := 0; v_ajoutees int := 0; v_inconnues int := 0; v_n int := 0; v_codes text[] := '{}';
begin
  if not public.a_droit('pvt.gerer') then raise exception 'Vous n''avez pas le droit de gérer les ventes terrain.'; end if;
  if extract(day from p_mois) <> 1 then raise exception 'Mois invalide.'; end if;
  if jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) = 0 then raise exception 'Extraction vide.'; end if;
  for d in select * from jsonb_array_elements(p_lignes) loop
    v_n := v_n + 1;
    v_ligne := nullif(regexp_replace(coalesce(d ->> 'ligne', ''), '[^0-9A-Za-z-]', '', 'g'), '');
    if v_ligne is null then raise exception 'Ligne % de l''extraction : numéro manquant.', v_n; end if;
    select id into v_offre from pvt_offres where pays = v_pays and lower(trim(code)) = lower(trim(coalesce(d ->> 'offre', '')));
    -- Vente déclarée de cette ligne (quel que soit le mois de déclaration, encore ouverte).
    select id into v_vente from pvt_ventes
     where pays = v_pays and ligne = v_ligne and statut = 'Déclarée'
     order by (offre_id = v_offre) desc nulls last, date_vente limit 1;
    if v_vente is not null then
      update pvt_ventes set statut = 'Validée', mois = p_mois, valide_le = coalesce(nullif(d ->> 'date', '')::date, current_date),
             offre_id = coalesce(v_offre, offre_id), motif = null
       where id = v_vente;
      v_valides := v_valides + 1;
    elsif exists (select 1 from pvt_ventes where pays = v_pays and ligne = v_ligne and statut = 'Validée') then
      continue;  -- déjà validée (extraction importée deux fois)
    elsif v_offre is null then
      v_inconnues := v_inconnues + 1;
      v_codes := array_append(v_codes, coalesce(d ->> 'offre', '?'));
    else
      insert into pvt_ventes (pays, mois, date_vente, offre_id, client, ligne, statut, source, valide_le)
      values (v_pays, p_mois, coalesce(nullif(d ->> 'date', '')::date, p_mois), v_offre, nullif(trim(d ->> 'client'), ''), v_ligne,
              'Validée', 'Extraction SBIN', coalesce(nullif(d ->> 'date', '')::date, current_date));
      v_ajoutees := v_ajoutees + 1;
    end if;
    v_vente := null; v_offre := null;
  end loop;
  insert into pvt_mois (pays, mois, extraction_recue_le) values (v_pays, p_mois, current_date)
  on conflict (pays, mois) do update set extraction_recue_le = coalesce(pvt_mois.extraction_recue_le, current_date);
  return jsonb_build_object('validees', v_valides, 'ajoutees', v_ajoutees, 'offres_inconnues', v_inconnues,
                            'codes_inconnus', (select coalesce(jsonb_agg(distinct c), '[]'::jsonb) from unnest(v_codes) c));
end $$;

-- Après l'extraction : les ventes déclarées du mois absentes de l'extraction sont rejetées (ou reportées).
create or replace function public.pvt_rejeter_non_validees(p_mois date, p_motif text default 'Absente de l''extraction SBIN')
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if not public.a_droit('pvt.gerer') then raise exception 'Vous n''avez pas le droit de gérer les ventes terrain.'; end if;
  update pvt_ventes set statut = 'Rejetée', motif = coalesce(nullif(trim(p_motif), ''), 'Absente de l''extraction SBIN')
   where pays = public.pays_courant() and mois = p_mois and statut = 'Déclarée';
  get diagnostics v = row_count;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Données du contrat SBIN (Bénin) : contrat signé le 31/07/2026, grille de l'annexe 3.
-- ---------------------------------------------------------------------------
insert into public.pvt_contrats (pays, reference, date_debut, taux_avance)
select 'BJ', 'Contrat de distribution PVT – SBIN SA (Celtiis)', date '2026-07-31', 50
where exists (select 1 from public.pays where code = 'BJ');

insert into public.pvt_offres (pays, code, libelle, segment, famille, commission, part_vendeur, ordre)
select 'BJ', o.code, o.libelle, o.segment, o.famille, o.commission, o.part_vendeur, o.ordre
from (values
  ('HOME50',      'Fibre HOME 50M',                         'B2C', 'FTTH',             10000,  8000, 10),
  ('HOME100',     'Fibre HOME 100M',                        'B2C', 'FTTH',             15000, 12000, 11),
  ('PRO25',       'Fibre Pro 25M',                          'B2B', 'FTTO',             12000,  9600, 20),
  ('PROMAX50',    'Fibre Pro Max 50M',                      'B2B', 'FTTO',             17000, 13600, 21),
  ('PROMEGA80',   'Fibre Pro Méga 80M',                     'B2B', 'FTTO',             23000, 18400, 22),
  ('OFFMAX150',   'Fibre Office Max 150M',                  'B2B', 'FTTO',             30000, 24000, 23),
  ('OFFMEGA200',  'Fibre Office Méga 200M',                 'B2B', 'FTTO',             35000, 28000, 24),
  ('PRO25-6M',    'Fibre Pro 25M – paiement 6 mois',        'B2B', 'FTTO',             22000, 17600, 30),
  ('PROMAX50-6M', 'Fibre Pro Max 50M – paiement 6 mois',    'B2B', 'FTTO',             27000, 21600, 31),
  ('PROMEGA80-6M','Fibre Pro Méga 80M – paiement 6 mois',   'B2B', 'FTTO',             33000, 26400, 32),
  ('OFFMAX150-6M','Fibre Office Max 150M – paiement 6 mois','B2B', 'FTTO',             40000, 32000, 33),
  ('OFFMEGA200-6M','Fibre Office Méga 200M – paiement 6 mois','B2B','FTTO',            45000, 36000, 34),
  ('PRO25-12M',   'Fibre Pro 25M – paiement 12 mois',       'B2B', 'FTTO',             27000, 21600, 40),
  ('PROMAX50-12M','Fibre Pro Max 50M – paiement 12 mois',   'B2B', 'FTTO',             32000, 25600, 41),
  ('PROMEGA80-12M','Fibre Pro Méga 80M – paiement 12 mois', 'B2B', 'FTTO',             38000, 30400, 42),
  ('OFFMAX150-12M','Fibre Office Max 150M – paiement 12 mois','B2B','FTTO',            45000, 36000, 43),
  ('OFFMEGA200-12M','Fibre Office Méga 200M – paiement 12 mois','B2B','FTTO',          50000, 40000, 44),
  ('FWA',         'FWA prépayé',                            'B2B', 'FWA',               2500,  1750, 50),
  ('BCONNECT',    'Business Connect prépayé avec Pocket',   'B2B', 'Business Connect',  2400,  1680, 51),
  ('FTTR-BASIC',  'Smart Wifi Pack Basic (FTTR)',           'B2B', 'FTTR',            120000, 72000, 60),
  ('FTTR-PREMIUM','Smart Wifi Pack Premium (FTTR)',         'B2B', 'FTTR',            160000, 96000, 61),
  ('BMC-10',      'BMC flotte max 10 lignes',               'B2B', 'BMC',              10000,  6000, 70),
  ('BMC-25',      'BMC flotte 11 à 25 lignes',              'B2B', 'BMC',              25000, 15000, 71),
  ('BMC-50',      'BMC flotte 26 à 50 lignes',              'B2B', 'BMC',              50000, 30000, 72),
  ('BMC-75',      'BMC flotte 51 à 75 lignes',              'B2B', 'BMC',              75000, 45000, 73),
  ('BMC-100',     'BMC flotte 76 à 100 lignes',             'B2B', 'BMC',             100000, 60000, 74),
  ('BMC-101',     'BMC flotte 101 lignes et plus',          'B2B', 'BMC',             150000, 90000, 75)
) as o(code, libelle, segment, famille, commission, part_vendeur, ordre)
where exists (select 1 from public.pays where code = 'BJ');
-- Le Pack Pocket ne compte pas pour la prime de performance (annexe 3).
update public.pvt_offres set performance = false where code = 'BCONNECT';

grant select, insert, update, delete on public.pvt_contrats, public.pvt_offres, public.pvt_vendeurs,
  public.pvt_ventes, public.pvt_mois, public.pvt_versements to authenticated;
grant execute on function public.mes_vendeurs(), public.pvt_rapprocher_extraction(date, jsonb),
  public.pvt_rejeter_non_validees(date, text), public.pvt_etat_ligne(uuid, text) to authenticated;
