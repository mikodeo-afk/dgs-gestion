-- Pointage « terrain » : certains agents (le superviseur PVT par défaut) travaillent sur le terrain,
-- sans lieu fixe. Leur pointage ne dépend ni du bureau ni d'un rayon : ils pointent où ils se trouvent,
-- avec le selfie et la position GPS enregistrés, que les RH contrôlent comme tout pointage.
-- Le droit « pointer.terrain » se donne ou se retire à chacun dans « Droits ».

insert into public.permissions (cle, groupe, libelle, ordre) values
  ('pointer.terrain', 'Activités', 'Pointer depuis le terrain, sans bureau ni rayon (selfie et position enregistrés)', 14)
on conflict (cle) do nothing;
insert into public.permissions_poste (poste, cle) values ('superviseur', 'pointer.terrain') on conflict do nothing;

alter table public.presences add column terrain boolean not null default false;

create or replace function public.garde_pointage()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null or current_setting('dgs.pointage', true) = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    if new.latitude is not null or new.longitude is not null or new.photo_chemin is not null
       or new.controle is not null or new.controle_par is not null or new.heure_arrivee is not null
       or new.distance_m is not null or new.score_visage is not null or new.terrain then
      raise exception 'Le pointage se fait depuis l''écran « Je pointe ».';
    end if;
  elsif (new.latitude, new.longitude, new.precision_m, new.photo_chemin, new.controle, new.controle_par, new.controle_le,
         new.motif_rejet, new.heure_arrivee, new.distance_m, new.score_visage, new.chantier_id, new.terrain)
        is distinct from
        (old.latitude, old.longitude, old.precision_m, old.photo_chemin, old.controle, old.controle_par, old.controle_le,
         old.motif_rejet, old.heure_arrivee, old.distance_m, old.score_visage, old.chantier_id, old.terrain) then
    raise exception 'Un pointage ne se modifie pas : il se contrôle (conforme ou rejeté).';
  end if;
  return new;
end $$;

-- p_chantier vide = bureau, ou terrain pour qui a le droit « pointer.terrain » (sans rayon).
create or replace function public.pointer(p_chantier uuid, p_lat double precision, p_lon double precision, p_precision int, p_photo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_pays text := public.pays_courant();
  v_terrain boolean := false;
  v_lieu text; v_clat double precision; v_clon double precision; v_rayon int;
  v_distance int;
  v_max int;
  v_deja timestamptz;
begin
  if v_uid is null or not public.a_droit('pointer') then
    raise exception 'Vous n''avez pas le droit de pointer.';
  end if;
  if p_chantier is null and public.a_droit('pointer.terrain') then
    v_terrain := true;
    v_lieu := 'le terrain';
  elsif p_chantier is null then
    if exists (select 1 from public.chantiers_pointage()) then
      raise exception 'Vous êtes affecté à un chantier : pointez sur ce chantier.';
    end if;
    select 'le bureau', bureau_latitude, bureau_longitude, bureau_rayon into v_lieu, v_clat, v_clon, v_rayon from pays where code = v_pays;
    if v_clat is null then
      raise exception 'La position du bureau n''est pas encore enregistrée : demandez-le à la direction (Paramètres).';
    end if;
  else
    select 'le chantier ' || x.code, x.latitude, x.longitude, x.rayon_pointage into v_lieu, v_clat, v_clon, v_rayon
    from public.chantiers_pointage() x where x.id = p_chantier;
    if v_lieu is null then
      raise exception 'Vous n''êtes pas affecté à ce chantier.';
    end if;
    if v_clat is null or v_clon is null then
      raise exception 'La position du chantier n''est pas renseignée : demandez au chef de projet de l''enregistrer.';
    end if;
  end if;
  if p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180 then
    raise exception 'Position GPS invalide.';
  end if;
  if coalesce(p_photo, '') not like v_pays || '/' || v_uid || '/%' then
    raise exception 'Le selfie est obligatoire pour pointer.';
  end if;
  select coalesce((select valeur::int from parametres where pays = v_pays and cle = 'precision_gps_max'), 150) into v_max;
  if p_precision is not null and p_precision > v_max then
    raise exception 'Position GPS trop imprécise (± % m). Mettez-vous à découvert, attendez quelques secondes et réessayez.', p_precision;
  end if;
  if not v_terrain then
    v_distance := round(public.distance_m(p_lat, p_lon, v_clat, v_clon));
    if v_distance > v_rayon then
      raise exception 'Vous êtes à % m de %, hors du rayon de pointage (% m).', v_distance, v_lieu, v_rayon;
    end if;
  end if;
  select heure_arrivee into v_deja from presences where profil_id = v_uid and jour = current_date and heure_arrivee is not null;
  if v_deja is not null then
    raise exception 'Vous avez déjà pointé aujourd''hui à %.', to_char(v_deja at time zone 'UTC', 'HH24:MI') || ' (UTC)';
  end if;

  perform set_config('dgs.pointage', 'on', true);
  insert into presences (profil_id, jour, statut, heure_arrivee, chantier_id, distance_m, latitude, longitude, precision_m,
                         photo_chemin, controle, saisi_par, maj_le, terrain)
  values (v_uid, current_date, 'P', now(), p_chantier, v_distance, p_lat, p_lon, p_precision, p_photo, 'À contrôler', v_uid, now(), v_terrain)
  on conflict (profil_id, jour) do update set
    statut = 'P', heure_arrivee = now(), chantier_id = p_chantier, distance_m = v_distance, latitude = p_lat, longitude = p_lon,
    precision_m = p_precision, photo_chemin = p_photo, controle = 'À contrôler', controle_par = null, controle_le = null,
    motif_rejet = null, saisi_par = v_uid, maj_le = now(), terrain = v_terrain;
  perform set_config('dgs.pointage', 'off', true);
  return jsonb_build_object('lieu', v_lieu, 'distance_m', v_distance, 'rayon_m', v_rayon, 'terrain', v_terrain);
end $$;
