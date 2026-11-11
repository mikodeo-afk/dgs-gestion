-- DGS Gestion : raccordements clients (activité permanente).
-- 1. Équipes de raccordement : un chef (qui détient le matériel doté chaque jour), des membres,
--    rattachées à un chantier de raccordement (où le matériel consommé est imputé).
-- 2. Dossiers : reçus chaque jour par le manager (Excel ou photo), importés puis affectés aux équipes.
-- 3. Rapport d'installation : le message de l'équipe (WhatsApp) est lu par l'application,
--    rattaché au dossier par le numéro de ligne, et le matériel déclaré est déduit du stock
--    du chef d'équipe. Si ce stock ne suffit pas, la ligne reste « À régulariser » pour le gestionnaire.
-- Le mot de passe de la box du client n'est jamais enregistré.

insert into public.permissions (cle, groupe, libelle, ordre) values
  ('racc.gerer', 'Raccordements', 'Gérer les raccordements (dossiers, équipes, affectations)', 80)
on conflict do nothing;
insert into public.permissions_poste (poste, cle) values
  ('pdg','racc.gerer'),('do','racc.gerer'),('rt','racc.gerer'),('cp','racc.gerer')
on conflict do nothing;

create table public.equipes (
  id          uuid primary key default gen_random_uuid(),
  pays        text references public.pays(code),
  nom         text not null check (trim(nom) <> ''),
  chef_id     uuid not null references public.profils(id) on delete restrict,
  chantier_id uuid not null references public.chantiers(id) on delete restrict,
  actif       boolean not null default true,
  cree_le     timestamptz not null default now()
);
create unique index equipes_nom_unique on public.equipes (pays, lower(trim(nom)));

create table public.equipe_membres (
  equipe_id uuid not null references public.equipes(id) on delete cascade,
  profil_id uuid not null references public.profils(id) on delete cascade,
  primary key (equipe_id, profil_id)
);

create table public.raccordements (
  id            uuid primary key default gen_random_uuid(),
  pays          text references public.pays(code),
  chantier_id   uuid not null references public.chantiers(id) on delete restrict,
  equipe_id     uuid references public.equipes(id) on delete set null,
  client        text not null check (trim(client) <> ''),
  ligne         text not null check (ligne ~ '^[0-9]+$'),   -- chiffres, sans les zéros de tête
  mobile        text,
  msan          text,
  offre         text,
  latitude      double precision,
  longitude     double precision,
  date_demande  date,
  date_limite   date,
  statut        text not null default 'À affecter' check (statut in ('À affecter','Affecté','Réalisé','Échec')),
  affecte_le    timestamptz,
  realise_le    date,
  rapport       jsonb,              -- valeurs lues dans le rapport d'installation
  rapport_brut  text,               -- message reçu, sans le mot de passe
  rapporte_par  uuid references public.profils(id) on delete set null,
  rapporte_le   timestamptz,
  motif_echec   text,
  cree_par      uuid references public.profils(id) on delete set null default auth.uid(),
  cree_le       timestamptz not null default now()
);
create index on public.raccordements (pays, statut);
create index on public.raccordements (pays, ligne);
create index on public.raccordements (equipe_id);
-- Un seul dossier ouvert par ligne.
create unique index raccordements_ligne_ouverte on public.raccordements (pays, ligne) where statut in ('À affecter','Affecté');

-- Rubrique du rapport → article du stock (« cable:CPC » pour le linéaire d'un type de câble, « cable » par défaut).
create table public.materiel_raccordement (
  pays       text not null references public.pays(code),
  rubrique   text not null check (rubrique ~ '^[a-z0-9_]+(:[A-Z0-9_ -]+)?$'),
  article_id uuid not null references public.articles(id) on delete cascade,
  primary key (pays, rubrique)
);

create table public.consommations_raccordement (
  id              uuid primary key default gen_random_uuid(),
  pays            text references public.pays(code),
  raccordement_id uuid not null references public.raccordements(id) on delete cascade,
  rubrique        text not null,
  article_id      uuid references public.articles(id) on delete restrict,
  quantite        numeric(14,3) not null check (quantite > 0),
  statut          text not null check (statut in ('Déduit','À régulariser','Non relié','Ignoré')),
  mouvement_id    uuid references public.mouvements_stock(id) on delete set null,
  note            text,
  cree_le         timestamptz not null default now()
);
create index on public.consommations_raccordement (raccordement_id);
create index on public.consommations_raccordement (pays, statut);

-- ---------------------------------------------------------------------------
-- Fonctions
-- ---------------------------------------------------------------------------
create or replace function public.normaliser_ligne(p text)
returns text language sql immutable as $$
  select nullif(ltrim(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '0'), '')
$$;

create or replace function public.mes_equipes()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from equipes where chef_id = auth.uid() and pays = public.pays_courant()
  union
  select m.equipe_id from equipe_membres m join equipes e on e.id = m.equipe_id
  where m.profil_id = auth.uid() and e.pays = public.pays_courant()
$$;

create or replace function public.voit_raccordements()
returns boolean language sql stable security definer set search_path = public as $$
  select public.est_global() or public.a_droit('racc.gerer') or public.a_droit('stock.gerer')
$$;

-- Déduit une consommation du stock du chef d'équipe, si ce stock suffit.
create or replace function public.deduire_consommation(p_conso uuid)
returns text language plpgsql security definer set search_path = public as $$
declare c consommations_raccordement; r raccordements; e equipes; v_cmp numeric; v_mvt uuid;
begin
  select * into c from consommations_raccordement where id = p_conso for update;
  if c.statut not in ('À régulariser') or c.article_id is null then return c.statut; end if;
  select * into r from raccordements where id = c.raccordement_id;
  select * into e from equipes where id = r.equipe_id;
  if e.id is null then return c.statut; end if;
  perform pg_advisory_xact_lock(hashtext(c.article_id::text));
  if public.quantite_en_stock(c.article_id, null, e.chef_id) < c.quantite then return c.statut; end if;
  v_cmp := public.cmp_article(c.article_id);
  insert into mouvements_stock (pays, article_id, type, lieu_id, detenteur_id, quantite, prix_unitaire, valeur, chantier_id, motif)
  values (r.pays, c.article_id, 'Utilisation', null, e.chef_id, -c.quantite, v_cmp, -round(c.quantite * v_cmp), e.chantier_id,
          format('Raccordement ligne %s · %s', r.ligne, r.client))
  returning id into v_mvt;
  update consommations_raccordement set statut = 'Déduit', mouvement_id = v_mvt, note = null where id = c.id;
  return 'Déduit';
end $$;
revoke execute on function public.deduire_consommation(uuid) from public, authenticated;

-- Enregistre le rapport d'installation d'une équipe.
-- p_donnees : { ligne, client, mobile, date (AAAA-MM-JJ), latitude, longitude, cable (type),
--               champs : {…valeurs lues…}, materiel : { rubrique: quantité, … } }
create or replace function public.enregistrer_rapport(p_equipe uuid, p_donnees jsonb, p_brut text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e equipes; r raccordements; v_ligne text := public.normaliser_ligne(p_donnees ->> 'ligne');
  v_date date := coalesce(nullif(p_donnees ->> 'date', '')::date, current_date);
  v_rub text; v_qte numeric; v_art uuid; v_conso uuid; v_cable text := upper(trim(coalesce(p_donnees ->> 'cable', '')));
  v_deduits int := 0; v_attente int := 0; v_non_relies int := 0; v_cree boolean := false;
begin
  select * into e from equipes where id = p_equipe and pays = public.pays_courant() and actif;
  if e.id is null then raise exception 'Équipe inconnue.'; end if;
  if not (public.a_droit('racc.gerer') or p_equipe in (select public.mes_equipes())) then
    raise exception 'Seuls les membres de l''équipe ou le manager enregistrent ses rapports.';
  end if;
  if v_ligne is null then raise exception 'Numéro de ligne introuvable dans le rapport.'; end if;
  if v_date > current_date + 1 then raise exception 'La date du rapport est dans le futur.'; end if;

  select * into r from raccordements
  where pays = e.pays and ligne = v_ligne and statut in ('À affecter','Affecté') for update;
  if r.id is null then
    if exists (select 1 from raccordements where pays = e.pays and ligne = v_ligne and statut = 'Réalisé' and realise_le = v_date) then
      raise exception 'Le rapport de la ligne % du % est déjà enregistré.', v_ligne, to_char(v_date, 'DD/MM/YYYY');
    end if;
    -- Dossier non reçu : on le crée à partir du rapport.
    insert into raccordements (pays, chantier_id, equipe_id, client, ligne, mobile, statut, affecte_le)
    values (e.pays, e.chantier_id, e.id, coalesce(nullif(trim(p_donnees ->> 'client'), ''), 'Client ligne ' || v_ligne), v_ligne,
            nullif(trim(p_donnees ->> 'mobile'), ''), 'Affecté', now())
    returning * into r;
    v_cree := true;
  end if;

  update raccordements set
    equipe_id = e.id, statut = 'Réalisé', realise_le = v_date,
    affecte_le = coalesce(affecte_le, now()),
    mobile = coalesce(mobile, nullif(trim(p_donnees ->> 'mobile'), '')),
    latitude = coalesce(nullif(p_donnees ->> 'latitude', '')::double precision, latitude),
    longitude = coalesce(nullif(p_donnees ->> 'longitude', '')::double precision, longitude),
    rapport = coalesce(p_donnees -> 'champs', '{}'::jsonb), rapport_brut = left(p_brut, 8000),
    rapporte_par = auth.uid(), rapporte_le = now()
  where id = r.id;

  for v_rub, v_qte in
    select key, (value #>> '{}')::numeric from jsonb_each(coalesce(p_donnees -> 'materiel', '{}'::jsonb))
  loop
    continue when v_qte is null or v_qte <= 0;
    if v_rub = 'cable' then
      select article_id into v_art from materiel_raccordement where pays = e.pays and rubrique = 'cable:' || v_cable;
      if v_art is null then select article_id into v_art from materiel_raccordement where pays = e.pays and rubrique = 'cable'; end if;
    else
      select article_id into v_art from materiel_raccordement where pays = e.pays and rubrique = v_rub;
    end if;
    insert into consommations_raccordement (pays, raccordement_id, rubrique, article_id, quantite, statut)
    values (e.pays, r.id, case when v_rub = 'cable' and v_cable <> '' then 'cable:' || v_cable else v_rub end, v_art, v_qte,
            case when v_art is null then 'Non relié' else 'À régulariser' end)
    returning id into v_conso;
    if v_art is null then v_non_relies := v_non_relies + 1;
    elsif public.deduire_consommation(v_conso) = 'Déduit' then v_deduits := v_deduits + 1;
    else
      v_attente := v_attente + 1;
      update consommations_raccordement set note = 'Stock du chef d''équipe insuffisant' where id = v_conso;
    end if;
    v_art := null;
  end loop;

  return jsonb_build_object('raccordement', r.id, 'ligne', v_ligne, 'dossier_cree', v_cree,
                            'deduits', v_deduits, 'a_regulariser', v_attente, 'non_relies', v_non_relies);
end $$;

-- Le gestionnaire relance une consommation (après dotation) ou l'ignore.
create or replace function public.regulariser_consommation(p_conso uuid, p_ignorer boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare c consommations_raccordement;
begin
  if not public.a_droit('stock.gerer') then raise exception 'Vous n''avez pas le droit de gérer le stock.'; end if;
  select * into c from consommations_raccordement where id = p_conso and pays = public.pays_courant();
  if c.id is null then raise exception 'Consommation inconnue.'; end if;
  if c.statut <> 'À régulariser' then raise exception 'Cette ligne est déjà « % ».', c.statut; end if;
  if p_ignorer then
    update consommations_raccordement set statut = 'Ignoré', note = 'Ignoré par ' || coalesce((select nom from profils where id = auth.uid()), '?') where id = c.id;
    return 'Ignoré';
  end if;
  if public.deduire_consommation(c.id) <> 'Déduit' then
    raise exception 'Le stock du chef d''équipe est toujours insuffisant : dotez-le d''abord.';
  end if;
  return 'Déduit';
end $$;

-- Import des dossiers du jour (Excel ou photo lue), tout ou rien ; les doublons sont ignorés.
create or replace function public.importer_dossiers(p_chantier uuid, p_lignes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d jsonb; v_ligne text; v_crees int := 0; v_doublons int := 0; v_n int := 0; v_pays text := public.pays_courant();
begin
  if not public.a_droit('racc.gerer') then raise exception 'Vous n''avez pas le droit de gérer les raccordements.'; end if;
  if not exists (select 1 from chantiers where id = p_chantier and pays = v_pays) then raise exception 'Chantier inconnu.'; end if;
  if jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) = 0 then raise exception 'Aucun dossier à importer.'; end if;
  if jsonb_array_length(p_lignes) > 1000 then raise exception 'Au plus 1 000 dossiers par import.'; end if;
  for d in select * from jsonb_array_elements(p_lignes) loop
    v_n := v_n + 1;
    v_ligne := public.normaliser_ligne(d ->> 'ligne');
    if v_ligne is null then raise exception 'Dossier % : numéro de ligne manquant.', v_n; end if;
    if coalesce(trim(d ->> 'client'), '') = '' then raise exception 'Dossier % : nom du client manquant.', v_n; end if;
    if exists (select 1 from raccordements where pays = v_pays and ligne = v_ligne
               and (statut in ('À affecter','Affecté') or date_demande is not distinct from nullif(d ->> 'date_demande', '')::date)) then
      v_doublons := v_doublons + 1;
      continue;
    end if;
    insert into raccordements (pays, chantier_id, client, ligne, mobile, msan, offre, latitude, longitude, date_demande, date_limite)
    values (v_pays, p_chantier, trim(d ->> 'client'), v_ligne, nullif(trim(d ->> 'mobile'), ''), nullif(trim(d ->> 'msan'), ''),
            nullif(trim(d ->> 'offre'), ''), nullif(d ->> 'latitude', '')::double precision, nullif(d ->> 'longitude', '')::double precision,
            nullif(d ->> 'date_demande', '')::date, nullif(d ->> 'date_limite', '')::date);
    v_crees := v_crees + 1;
  end loop;
  return jsonb_build_object('crees', v_crees, 'doublons', v_doublons);
end $$;

create or replace function public.affecter_raccordements(p_ids uuid[], p_equipe uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if not public.a_droit('racc.gerer') then raise exception 'Vous n''avez pas le droit de gérer les raccordements.'; end if;
  if p_equipe is not null and not exists (select 1 from equipes where id = p_equipe and pays = public.pays_courant() and actif) then
    raise exception 'Équipe inconnue.';
  end if;
  update raccordements set equipe_id = p_equipe,
         statut = case when p_equipe is null then 'À affecter' else 'Affecté' end,
         affecte_le = case when p_equipe is null then null else now() end
  where id = any(p_ids) and pays = public.pays_courant() and statut in ('À affecter','Affecté');
  get diagnostics v = row_count;
  return v;
end $$;

create or replace function public.signaler_echec(p_id uuid, p_motif text)
returns void language plpgsql security definer set search_path = public as $$
declare r raccordements;
begin
  select * into r from raccordements where id = p_id and pays = public.pays_courant();
  if r.id is null then raise exception 'Dossier inconnu.'; end if;
  if not (public.a_droit('racc.gerer') or r.equipe_id in (select public.mes_equipes())) then
    raise exception 'Seule l''équipe affectée ou le manager signale un échec.';
  end if;
  if r.statut not in ('À affecter','Affecté') then raise exception 'Ce dossier est déjà « % ».', r.statut; end if;
  if coalesce(trim(p_motif), '') = '' then raise exception 'Indiquez le motif (client absent, pas de port libre…).'; end if;
  update raccordements set statut = 'Échec', motif_echec = trim(p_motif) where id = p_id;
end $$;

-- Remet en attente un dossier en échec (nouveau passage).
create or replace function public.rouvrir_raccordement(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.a_droit('racc.gerer') then raise exception 'Vous n''avez pas le droit de gérer les raccordements.'; end if;
  update raccordements set statut = case when equipe_id is null then 'À affecter' else 'Affecté' end, motif_echec = null
  where id = p_id and pays = public.pays_courant() and statut = 'Échec';
  if not found then raise exception 'Seul un dossier en échec peut être rouvert.'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Pays, droits d'accès
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['equipes','raccordements','materiel_raccordement','consommations_raccordement'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create trigger garde_pays before insert or update on public.%I for each row execute function public.garde_pays()', t);
    execute format('create policy pays on public.%I as restrictive for all to authenticated using (pays = public.pays_courant()) with check (pays = public.pays_courant())', t);
  end loop;
end $$;
alter table public.equipe_membres enable row level security;

create policy lecture on public.equipes for select to authenticated using (true);
create policy creation on public.equipes for insert to authenticated with check (public.a_droit('racc.gerer'));
create policy modification on public.equipes for update to authenticated using (public.a_droit('racc.gerer')) with check (public.a_droit('racc.gerer'));

create policy lecture on public.equipe_membres for select to authenticated
  using (exists (select 1 from equipes e where e.id = equipe_id));
create policy ajout on public.equipe_membres for insert to authenticated
  with check (public.a_droit('racc.gerer') and exists (select 1 from equipes e where e.id = equipe_id));
create policy retrait on public.equipe_membres for delete to authenticated
  using (public.a_droit('racc.gerer') and exists (select 1 from equipes e where e.id = equipe_id));

-- Les dossiers et rapports s'écrivent par les fonctions ; lecture : bureau, logistique, l'équipe affectée.
create policy lecture on public.raccordements for select to authenticated
  using (public.voit_raccordements() or equipe_id in (select public.mes_equipes()) or chantier_id in (select public.mes_chantiers()));
create policy lecture on public.consommations_raccordement for select to authenticated
  using (exists (select 1 from raccordements r where r.id = raccordement_id));

create policy lecture on public.materiel_raccordement for select to authenticated using (true);
create policy gestion on public.materiel_raccordement for insert to authenticated with check (public.a_droit('stock.gerer') or public.a_droit('racc.gerer'));
create policy modification on public.materiel_raccordement for update to authenticated
  using (public.a_droit('stock.gerer') or public.a_droit('racc.gerer')) with check (public.a_droit('stock.gerer') or public.a_droit('racc.gerer'));
create policy suppression on public.materiel_raccordement for delete to authenticated using (public.a_droit('stock.gerer') or public.a_droit('racc.gerer'));

grant select on public.equipes, public.equipe_membres, public.raccordements, public.materiel_raccordement,
                public.consommations_raccordement to authenticated;
grant insert, update on public.equipes to authenticated;
grant insert, delete on public.equipe_membres to authenticated;
grant insert, update, delete on public.materiel_raccordement to authenticated;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.deduire_consommation(uuid) from authenticated;
