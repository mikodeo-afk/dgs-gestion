-- DGS Gestion : dossiers de raccordement, seconde date = date d'affectation du dossier à DGS
-- (et non une date limite). Le suivi se fait en jours d'attente depuis cette date.
alter table public.raccordements rename column date_limite to date_affectation;

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
    insert into raccordements (pays, chantier_id, client, ligne, mobile, msan, offre, latitude, longitude, date_demande, date_affectation)
    values (v_pays, p_chantier, trim(d ->> 'client'), v_ligne, nullif(trim(d ->> 'mobile'), ''), nullif(trim(d ->> 'msan'), ''),
            nullif(trim(d ->> 'offre'), ''), nullif(d ->> 'latitude', '')::double precision, nullif(d ->> 'longitude', '')::double precision,
            nullif(d ->> 'date_demande', '')::date, nullif(coalesce(d ->> 'date_affectation', d ->> 'date_limite'), '')::date);
    v_crees := v_crees + 1;
  end loop;
  return jsonb_build_object('crees', v_crees, 'doublons', v_doublons);
end $$;
