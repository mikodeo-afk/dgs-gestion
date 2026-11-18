-- DGS Gestion : le projet raccordement a deux branches.
--   Production : Raccordement (client), Implantation poteaux, Armement (sous-activités)
--   SAV        : interventions après installation
-- Chaque dossier porte son activité ; une même ligne peut avoir un dossier ouvert par activité.
alter table public.raccordements add column activite text not null default 'Raccordement'
  check (activite in ('Raccordement','Implantation poteaux','Armement','SAV'));
alter table public.raccordements add column branche text generated always as
  (case when activite = 'SAV' then 'SAV' else 'Production' end) stored;
drop index public.raccordements_ligne_ouverte;
create unique index raccordements_ligne_ouverte on public.raccordements (pays, ligne, activite) where statut in ('À affecter','Affecté');
create index on public.raccordements (pays, activite, statut);

-- Équipes : activités qu'elles réalisent (toutes par défaut).
alter table public.equipes add column activites text[] not null default array['Raccordement','Implantation poteaux','Armement','SAV']
  check (activites <@ array['Raccordement','Implantation poteaux','Armement','SAV'] and cardinality(activites) > 0);

-- Rapport d'une équipe : rattaché au dossier ouvert de la même ligne ET de la même activité.
create or replace function public.enregistrer_rapport(p_equipe uuid, p_donnees jsonb, p_brut text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e equipes; r raccordements; v_ligne text := public.normaliser_ligne(p_donnees ->> 'ligne');
  v_date date := coalesce(nullif(p_donnees ->> 'date', '')::date, current_date);
  v_rub text; v_qte numeric; v_art uuid; v_conso uuid; v_cable text := upper(trim(coalesce(p_donnees ->> 'cable', '')));
  v_act text := coalesce(nullif(trim(p_donnees ->> 'activite'), ''), 'Raccordement');
  v_deduits int := 0; v_attente int := 0; v_non_relies int := 0; v_cree boolean := false;
begin
  select * into e from equipes where id = p_equipe and pays = public.pays_courant() and actif;
  if e.id is null then raise exception 'Équipe inconnue.'; end if;
  if not (public.a_droit('racc.gerer') or p_equipe in (select public.mes_equipes())) then
    raise exception 'Seuls les membres de l''équipe ou le manager enregistrent ses rapports.';
  end if;
  if v_act not in ('Raccordement','Implantation poteaux','Armement','SAV') then raise exception 'Activité inconnue : %.', v_act; end if;
  if v_ligne is null then raise exception 'Numéro de ligne introuvable dans le rapport.'; end if;
  if v_date > current_date + 1 then raise exception 'La date du rapport est dans le futur.'; end if;

  select * into r from raccordements
  where pays = e.pays and ligne = v_ligne and activite = v_act and statut in ('À affecter','Affecté') for update;
  if r.id is null then
    if exists (select 1 from raccordements where pays = e.pays and ligne = v_ligne and activite = v_act and statut = 'Réalisé' and realise_le = v_date) then
      raise exception 'Le rapport % de la ligne % du % est déjà enregistré.', v_act, v_ligne, to_char(v_date, 'DD/MM/YYYY');
    end if;
    -- Dossier non reçu : on le crée à partir du rapport.
    insert into raccordements (pays, chantier_id, equipe_id, activite, client, ligne, mobile, statut, affecte_le)
    values (e.pays, e.chantier_id, e.id, v_act, coalesce(nullif(trim(p_donnees ->> 'client'), ''), 'Client ligne ' || v_ligne), v_ligne,
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

  return jsonb_build_object('raccordement', r.id, 'ligne', v_ligne, 'dossier_cree', v_cree, 'activite', v_act,
                            'deduits', v_deduits, 'a_regulariser', v_attente, 'non_relies', v_non_relies);
end $$;


-- Import des dossiers : chaque ligne porte son activité (Raccordement par défaut).
create or replace function public.importer_dossiers(p_chantier uuid, p_lignes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d jsonb; v_ligne text; v_act text; v_crees int := 0; v_doublons int := 0; v_n int := 0; v_pays text := public.pays_courant();
begin
  if not public.a_droit('racc.gerer') then raise exception 'Vous n''avez pas le droit de gérer les raccordements.'; end if;
  if not exists (select 1 from chantiers where id = p_chantier and pays = v_pays) then raise exception 'Chantier inconnu.'; end if;
  if jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) = 0 then raise exception 'Aucun dossier à importer.'; end if;
  if jsonb_array_length(p_lignes) > 1000 then raise exception 'Au plus 1 000 dossiers par import.'; end if;
  for d in select * from jsonb_array_elements(p_lignes) loop
    v_n := v_n + 1;
    v_ligne := public.normaliser_ligne(d ->> 'ligne');
    if v_ligne is null then raise exception 'Dossier % : numéro de ligne manquant.', v_n; end if;
    v_act := coalesce(nullif(trim(d ->> 'activite'), ''), 'Raccordement');
    if v_act not in ('Raccordement','Implantation poteaux','Armement','SAV') then raise exception 'Dossier % : activité inconnue (%).', v_n, v_act; end if;
    if coalesce(trim(d ->> 'client'), '') = '' then raise exception 'Dossier % : nom du client manquant.', v_n; end if;
    if exists (select 1 from raccordements where pays = v_pays and ligne = v_ligne and activite = v_act
               and (statut in ('À affecter','Affecté') or date_demande is not distinct from nullif(d ->> 'date_demande', '')::date)) then
      v_doublons := v_doublons + 1;
      continue;
    end if;
    insert into raccordements (pays, chantier_id, activite, client, ligne, mobile, msan, offre, latitude, longitude, date_demande, date_affectation)
    values (v_pays, p_chantier, v_act, trim(d ->> 'client'), v_ligne, nullif(trim(d ->> 'mobile'), ''), nullif(trim(d ->> 'msan'), ''),
            nullif(trim(d ->> 'offre'), ''), nullif(d ->> 'latitude', '')::double precision, nullif(d ->> 'longitude', '')::double precision,
            nullif(d ->> 'date_demande', '')::date, nullif(coalesce(d ->> 'date_affectation', d ->> 'date_limite'), '')::date);
    v_crees := v_crees + 1;
  end loop;
  return jsonb_build_object('crees', v_crees, 'doublons', v_doublons);
end $$;
