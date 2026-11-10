-- DGS Gestion : pointage de l'arrivée par téléphone (GPS + selfie), contrôlé par les RH.
-- L'agent pointe lui-même depuis le site ouvert sur son téléphone : sa position doit être dans le
-- rayon du chantier, et un selfie est pris. Les RH comparent ensuite le selfie à la photo de
-- référence de l'agent et marquent le pointage conforme ou rejeté (rejeté = absent).
-- La reconnaissance faciale automatique viendra avec l'application mobile.

alter table public.presences
  add column latitude     double precision,
  add column longitude    double precision,
  add column precision_m  int,
  add column photo_chemin text,
  add column controle     text check (controle in ('À contrôler','Conforme','Rejeté')),
  add column controle_par uuid references public.profils(id) on delete set null,
  add column controle_le  timestamptz,
  add column motif_rejet  text;

alter table public.profils add column photo_reference text;

insert into public.parametres (pays, cle, valeur, libelle)
select code, 'precision_gps_max', 150, 'Imprécision GPS maximale acceptée au pointage (m)' from public.pays
on conflict do nothing;

-- Distance en mètres entre deux points GPS (formule de haversine).
create or replace function public.distance_m(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)))
$$;

-- Les colonnes du pointage ne se modifient que par les fonctions ci-dessous.
create or replace function public.garde_pointage()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null or current_setting('dgs.pointage', true) = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    if new.latitude is not null or new.longitude is not null or new.photo_chemin is not null
       or new.controle is not null or new.controle_par is not null or new.heure_arrivee is not null
       or new.distance_m is not null or new.score_visage is not null then
      raise exception 'Le pointage se fait depuis l''écran « Je pointe ».';
    end if;
  elsif (new.latitude, new.longitude, new.precision_m, new.photo_chemin, new.controle, new.controle_par, new.controle_le,
         new.motif_rejet, new.heure_arrivee, new.distance_m, new.score_visage, new.chantier_id)
        is distinct from
        (old.latitude, old.longitude, old.precision_m, old.photo_chemin, old.controle, old.controle_par, old.controle_le,
         old.motif_rejet, old.heure_arrivee, old.distance_m, old.score_visage, old.chantier_id) then
    raise exception 'Un pointage ne se modifie pas : il se contrôle (conforme ou rejeté).';
  end if;
  return new;
end $$;
create trigger garde_pointage before insert or update on public.presences
for each row execute function public.garde_pointage();

create or replace function public.garde_photo_reference()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and current_setting('dgs.pointage', true) is distinct from 'on'
     and (new.photo_reference is distinct from old.photo_reference or new.visage_enregistre is distinct from old.visage_enregistre) then
    raise exception 'La photo de référence est enregistrée par les RH.';
  end if;
  return new;
end $$;
create trigger garde_photo_reference before update on public.profils
for each row execute function public.garde_photo_reference();

-- Chantiers où l'agent peut pointer : ceux de son périmètre dont la position est connue.
create or replace function public.chantiers_pointage()
returns table (id uuid, code text, nom text, latitude double precision, longitude double precision, rayon_pointage int)
language sql stable security definer set search_path = public as $$
  select c.id, c.code, c.nom, c.latitude, c.longitude, c.rayon_pointage
  from chantiers c
  where c.id in (select public.mes_chantiers()) and c.pays = public.pays_courant()
    and c.latitude is not null and c.longitude is not null and c.statut in ('Démarrage','En cours')
  order by c.code
$$;

-- L'agent pointe son arrivée : position dans le rayon du chantier, selfie déposé dans son dossier.
create or replace function public.pointer(p_chantier uuid, p_lat double precision, p_lon double precision, p_precision int, p_photo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  c chantiers;
  v_distance int;
  v_max int;
  v_deja timestamptz;
begin
  if v_uid is null or not public.a_droit('pointer') then
    raise exception 'Vous n''avez pas le droit de pointer.';
  end if;
  select * into c from chantiers where id = p_chantier;
  if c.id is null or c.id not in (select public.mes_chantiers()) or c.pays <> public.pays_courant() then
    raise exception 'Ce chantier ne fait pas partie de vos chantiers.';
  end if;
  if c.latitude is null or c.longitude is null then
    raise exception 'La position du chantier % n''est pas renseignée : demandez au chef de projet de l''enregistrer.', c.code;
  end if;
  if p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180 then
    raise exception 'Position GPS invalide.';
  end if;
  if coalesce(p_photo, '') not like public.pays_courant() || '/' || v_uid || '/%' then
    raise exception 'Le selfie est obligatoire pour pointer.';
  end if;
  select coalesce((select valeur::int from parametres where pays = c.pays and cle = 'precision_gps_max'), 150) into v_max;
  if p_precision is not null and p_precision > v_max then
    raise exception 'Position GPS trop imprécise (± % m). Mettez-vous à découvert, attendez quelques secondes et réessayez.', p_precision;
  end if;
  v_distance := round(public.distance_m(p_lat, p_lon, c.latitude, c.longitude));
  if v_distance > c.rayon_pointage then
    raise exception 'Vous êtes à % m du chantier %, hors du rayon de pointage (% m).', v_distance, c.code, c.rayon_pointage;
  end if;
  select heure_arrivee into v_deja from presences where profil_id = v_uid and jour = current_date and heure_arrivee is not null;
  if v_deja is not null then
    raise exception 'Vous avez déjà pointé aujourd''hui à %.', to_char(v_deja at time zone 'UTC', 'HH24:MI') || ' (UTC)';
  end if;

  perform set_config('dgs.pointage', 'on', true);
  insert into presences (profil_id, jour, statut, heure_arrivee, chantier_id, distance_m, latitude, longitude, precision_m,
                         photo_chemin, controle, saisi_par, maj_le)
  values (v_uid, current_date, 'P', now(), c.id, v_distance, p_lat, p_lon, p_precision, p_photo, 'À contrôler', v_uid, now())
  on conflict (profil_id, jour) do update set
    statut = 'P', heure_arrivee = now(), chantier_id = c.id, distance_m = v_distance, latitude = p_lat, longitude = p_lon,
    precision_m = p_precision, photo_chemin = p_photo, controle = 'À contrôler', controle_par = null, controle_le = null,
    motif_rejet = null, saisi_par = v_uid, maj_le = now();
  perform set_config('dgs.pointage', 'off', true);
  return jsonb_build_object('chantier', c.code, 'distance_m', v_distance, 'rayon_m', c.rayon_pointage);
end $$;

-- Les RH (ou la direction) contrôlent le selfie : conforme, ou rejeté avec un motif (l'agent est alors absent).
create or replace function public.controler_pointage(p_profil uuid, p_jour date, p_conforme boolean, p_motif text default null)
returns void language plpgsql security definer set search_path = public as $$
declare p presences;
begin
  if not (public.a_droit('pres.saisir') and public.est_global()) then
    raise exception 'Seuls les RH et la direction contrôlent les pointages.';
  end if;
  if p_profil = auth.uid() then
    raise exception 'On ne contrôle pas son propre pointage.';
  end if;
  select * into p from presences where profil_id = p_profil and jour = p_jour;
  if p.photo_chemin is null or public.pays_de_profil(p_profil) <> public.pays_courant() then
    raise exception 'Aucun pointage par téléphone à contrôler.';
  end if;
  if not p_conforme and length(trim(coalesce(p_motif, ''))) < 3 then
    raise exception 'Indiquez pourquoi le pointage est rejeté.';
  end if;
  perform set_config('dgs.pointage', 'on', true);
  update presences set
    controle = case when p_conforme then 'Conforme' else 'Rejeté' end,
    statut = case when p_conforme then 'P' else 'A' end,
    motif_rejet = case when p_conforme then null else trim(p_motif) end,
    controle_par = auth.uid(), controle_le = now(), maj_le = now()
  where profil_id = p_profil and jour = p_jour;
  perform set_config('dgs.pointage', 'off', true);
end $$;

-- Les RH enregistrent la photo de référence d'un agent (base de comparaison des selfies).
create or replace function public.definir_photo_reference(p_profil uuid, p_chemin text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.a_droit('pres.saisir') and public.est_global()) then
    raise exception 'Seuls les RH et la direction enregistrent les photos de référence.';
  end if;
  if public.pays_de_profil(p_profil) <> public.pays_courant()
     or coalesce(p_chemin, '') not like public.pays_courant() || '/reference/' || p_profil || '-%' then
    raise exception 'Photo de référence invalide.';
  end if;
  perform set_config('dgs.pointage', 'on', true);
  update profils set photo_reference = p_chemin, visage_enregistre = true where id = p_profil;
  perform set_config('dgs.pointage', 'off', true);
end $$;

-- Stockage privé des selfies et des photos de référence : {pays}/{agent}/… et {pays}/reference/{agent}-….
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('pointages', 'pointages', false, 5242880, array['image/jpeg','image/png','image/webp'])
    on conflict (id) do nothing;
    execute $p$create policy "pointages : dépôt" on storage.objects for insert to authenticated
      with check (bucket_id = 'pointages' and (storage.foldername(name))[1] = public.pays_courant()
        and ((storage.foldername(name))[2] = auth.uid()::text
             or ((storage.foldername(name))[2] = 'reference' and public.a_droit('pres.saisir') and public.est_global())))$p$;
    execute $p$create policy "pointages : lecture" on storage.objects for select to authenticated
      using (bucket_id = 'pointages' and (storage.foldername(name))[1] = public.pays_courant()
        and ((storage.foldername(name))[2] = auth.uid()::text
             or (public.a_droit('pres.saisir') and public.est_global())))$p$;
  end if;
end $$;
