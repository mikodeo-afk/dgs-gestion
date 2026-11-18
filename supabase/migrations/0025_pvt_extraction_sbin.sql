-- Ventes terrain : lecture directe des extractions SBIN (fichiers d'octobre 2026).
-- • Les offres prennent les codes SBIN (colonne DEBIT : FTTH_Home_50M, FTTH_PRO_50M, FIBRE_PRO_MAX_100M…).
-- • Chaque vendeur a son login SBIN (pvt_dgs_xxx, ou pvt_dgs_xxx.ftth en B2C) : les lignes de
--   l'extraction lui sont attribuées automatiquement, et un vendeur inconnu est créé.
-- • Statut SBIN : « A payer » / « Arriéré à payer » = validée (comptée dans le mois de l'extraction),
--   « Paiement reporté » = reportée (reste ouverte), « Vte non validée » = rejetée avec le motif.
-- • L'état de la ligne (ACTIF, blockage, clôture) alimente la rétention.

alter table public.pvt_vendeurs add column login_sbin text;
create unique index pvt_vendeurs_login on public.pvt_vendeurs (pays, lower(login_sbin)) where login_sbin is not null;

alter table public.pvt_ventes drop constraint if exists pvt_ventes_statut_check;
alter table public.pvt_ventes add constraint pvt_ventes_statut_check check (statut in ('Déclarée','Validée','Reportée','Rejetée'));

-- Codes et débits SBIN (le plan de commission SBIN reprend les montants de l'annexe 3 avec les débits actuels).
update public.pvt_offres o set code = n.code, libelle = n.libelle
from (values
  ('HOME50',        'FTTH_Home_50M',                'Fibre HOME 50M'),
  ('HOME100',       'FTTH_Home_100M',               'Fibre HOME 100M'),
  ('PRO25',         'FTTH_PRO_50M',                 'Fibre Pro 50M'),
  ('PROMAX50',      'FIBRE_PRO_MAX_100M',           'Fibre Pro Max 100M'),
  ('PROMEGA80',     'FIBRE_PRO_MEGA_150M',          'Fibre Pro Méga 150M'),
  ('OFFMAX150',     'FIBRE_OFFICE_MAX_200M',        'Fibre Office Max 200M'),
  ('OFFMEGA200',    'FIBRE_OFFICE_MEGA_250M',       'Fibre Office Méga 250M'),
  ('PRO25-6M',      'FTTH_PRO_50M-6M',              'Fibre Pro 50M – paiement 6 mois'),
  ('PROMAX50-6M',   'FIBRE_PRO_MAX_100M-6M',        'Fibre Pro Max 100M – paiement 6 mois'),
  ('PROMEGA80-6M',  'FIBRE_PRO_MEGA_150M-6M',       'Fibre Pro Méga 150M – paiement 6 mois'),
  ('OFFMAX150-6M',  'FIBRE_OFFICE_MAX_200M-6M',     'Fibre Office Max 200M – paiement 6 mois'),
  ('OFFMEGA200-6M', 'FIBRE_OFFICE_MEGA_250M-6M',    'Fibre Office Méga 250M – paiement 6 mois'),
  ('PRO25-12M',     'FTTH_PRO_50M-12M',             'Fibre Pro 50M – paiement 12 mois'),
  ('PROMAX50-12M',  'FIBRE_PRO_MAX_100M-12M',       'Fibre Pro Max 100M – paiement 12 mois'),
  ('PROMEGA80-12M', 'FIBRE_PRO_MEGA_150M-12M',      'Fibre Pro Méga 150M – paiement 12 mois'),
  ('OFFMAX150-12M', 'FIBRE_OFFICE_MAX_200M-12M',    'Fibre Office Max 200M – paiement 12 mois'),
  ('OFFMEGA200-12M','FIBRE_OFFICE_MEGA_250M-12M',   'Fibre Office Méga 250M – paiement 12 mois')
) as n(ancien, code, libelle)
where o.code = n.ancien;

-- Rapprochement avec l'extraction SBIN.
-- p_lignes : [{ ligne, offre (code), date, client, login, statut (Validée|Reportée|Rejetée), motif, etat (Active|Suspendue|Résiliée) }]
drop function if exists public.pvt_rapprocher_extraction(date, jsonb);
create or replace function public.pvt_rapprocher_extraction(p_mois date, p_lignes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d jsonb; v_pays text := public.pays_courant(); v_ligne text; v_offre uuid; v_vente pvt_ventes; v_vendeur uuid;
  v_login text; v_statut text; v_motif text; v_etat text; v_date date; v_debut date;
  n_valides int := 0; n_reportees int := 0; n_rejetees int := 0; n_ajoutees int := 0; n_vendeurs int := 0; n_inconnues int := 0;
  v_n int := 0; v_codes text[] := '{}';
begin
  if not public.a_droit('pvt.gerer') then raise exception 'Vous n''avez pas le droit de gérer les ventes terrain.'; end if;
  if extract(day from p_mois) <> 1 then raise exception 'Mois invalide.'; end if;
  if jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) = 0 then raise exception 'Extraction vide.'; end if;
  select coalesce(date_debut, p_mois) into v_debut from pvt_contrats where pays = v_pays;
  for d in select * from jsonb_array_elements(p_lignes) loop
    v_n := v_n + 1;
    v_ligne := nullif(regexp_replace(coalesce(d ->> 'ligne', ''), '[^0-9A-Za-z-]', '', 'g'), '');
    if v_ligne is null then raise exception 'Ligne % de l''extraction : numéro manquant.', v_n; end if;
    v_statut := coalesce(nullif(d ->> 'statut', ''), 'Validée');
    if v_statut not in ('Validée','Reportée','Rejetée') then raise exception 'Ligne % : statut SBIN inconnu (%).', v_n, v_statut; end if;
    v_motif := nullif(trim(d ->> 'motif'), '');
    v_etat := nullif(d ->> 'etat', '');
    if v_etat is not null and v_etat not in ('Active','Suspendue','Résiliée') then v_etat := null; end if;
    v_date := coalesce(nullif(d ->> 'date', '')::date, p_mois);
    select id into v_offre from pvt_offres where pays = v_pays and lower(trim(code)) = lower(trim(coalesce(d ->> 'offre', '')));

    -- Vendeur d'après son login SBIN (le suffixe « .ftth » est ignoré) ; créé s'il est inconnu.
    v_login := nullif(lower(regexp_replace(trim(coalesce(d ->> 'login', '')), '\.[a-z]+$', '')), '');
    v_vendeur := null;
    if v_login is not null then
      select id into v_vendeur from pvt_vendeurs where pays = v_pays and lower(login_sbin) = v_login;
      if v_vendeur is null then
        insert into pvt_vendeurs (pays, nom, login_sbin, segment, debut)
        values (v_pays, initcap(regexp_replace(v_login, '^pvt_[a-z0-9]+_', '')) || ' (' || v_login || ')', v_login,
                case when coalesce(d ->> 'login', '') ~* '\.ftth$' then 'B2C' else 'B2B' end, least(v_debut, v_date))
        on conflict do nothing
        returning id into v_vendeur;
        if v_vendeur is null then
          select id into v_vendeur from pvt_vendeurs where pays = v_pays and lower(login_sbin) = v_login;
        else
          n_vendeurs := n_vendeurs + 1;
        end if;
      end if;
    end if;

    -- Vente déjà connue pour cette ligne : d'abord une vente encore ouverte, sinon une rejetée (revalidation).
    select * into v_vente from pvt_ventes
     where pays = v_pays and ligne = v_ligne
     order by (statut = 'Validée') desc, (statut in ('Déclarée','Reportée')) desc, (offre_id = v_offre) desc nulls last, date_vente desc
     limit 1;

    if v_vente.id is not null and v_vente.statut = 'Validée' then
      -- Déjà validée (extraction réimportée, ou ligne d'un mois précédent) : on ne met à jour que l'état de la ligne.
      if v_etat is not null then update pvt_ventes set etat_ligne = v_etat, etat_maj_le = current_date where id = v_vente.id; end if;
    elsif v_offre is null then
      n_inconnues := n_inconnues + 1;
      v_codes := array_append(v_codes, coalesce(nullif(d ->> 'offre', ''), '?'));
    elsif v_vente.id is not null then
      update pvt_ventes set
        statut = v_statut, offre_id = v_offre, vendeur_id = coalesce(v_vendeur, vendeur_id),
        mois = case when v_statut = 'Validée' then p_mois else mois end,
        valide_le = case when v_statut = 'Validée' then current_date end,
        motif = case when v_statut = 'Validée' then null else coalesce(v_motif, case v_statut when 'Reportée' then 'Paiement reporté par SBIN' else 'Vente non validée par SBIN' end) end,
        client = coalesce(client, nullif(trim(d ->> 'client'), '')),
        etat_ligne = case when v_statut = 'Validée' then coalesce(v_etat, etat_ligne) end,
        etat_maj_le = case when v_statut = 'Validée' and v_etat is not null then current_date else etat_maj_le end
       where id = v_vente.id;
    else
      insert into pvt_ventes (pays, mois, date_vente, vendeur_id, offre_id, client, ligne, statut, source, motif, valide_le, etat_ligne, etat_maj_le)
      values (v_pays, case when v_statut = 'Validée' then p_mois else date_trunc('month', v_date)::date end, v_date, v_vendeur, v_offre,
              nullif(trim(d ->> 'client'), ''), v_ligne, v_statut, 'Extraction SBIN',
              case when v_statut = 'Validée' then null else coalesce(v_motif, case v_statut when 'Reportée' then 'Paiement reporté par SBIN' else 'Vente non validée par SBIN' end) end,
              case when v_statut = 'Validée' then current_date end,
              case when v_statut = 'Validée' then v_etat end, case when v_statut = 'Validée' and v_etat is not null then current_date end);
      n_ajoutees := n_ajoutees + 1;
    end if;

    if v_offre is not null and (v_vente.id is null or v_vente.statut <> 'Validée') then
      case v_statut when 'Validée' then n_valides := n_valides + 1; when 'Reportée' then n_reportees := n_reportees + 1; else n_rejetees := n_rejetees + 1; end case;
    end if;
    v_vente := null; v_offre := null;
  end loop;
  insert into pvt_mois (pays, mois, extraction_recue_le) values (v_pays, p_mois, current_date)
  on conflict (pays, mois) do update set extraction_recue_le = coalesce(pvt_mois.extraction_recue_le, current_date);
  return jsonb_build_object('validees', n_valides, 'reportees', n_reportees, 'rejetees', n_rejetees, 'ajoutees', n_ajoutees,
                            'vendeurs_crees', n_vendeurs, 'offres_inconnues', n_inconnues,
                            'codes_inconnus', (select coalesce(jsonb_agg(distinct c), '[]'::jsonb) from unnest(v_codes) c));
end $$;
grant execute on function public.pvt_rapprocher_extraction(date, jsonb) to authenticated;
