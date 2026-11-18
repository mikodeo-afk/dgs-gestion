-- DGS Gestion : les personnes à accès groupe (PDG, DO, accès accordé) travaillent dans plusieurs pays.
-- Leur photo de référence et leurs pointages par téléphone se gèrent depuis le pays où l'on se trouve,
-- même si leur compte a été créé dans un autre pays (avant : « Photo de référence invalide »).

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
  if p.photo_chemin is null or (public.pays_de_profil(p_profil) <> public.pays_courant() and not public.acces_groupe(p_profil)) then
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

create or replace function public.definir_photo_reference(p_profil uuid, p_chemin text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.a_droit('pres.saisir') and public.est_global()) then
    raise exception 'Seuls les RH et la direction enregistrent les photos de référence.';
  end if;
  if (public.pays_de_profil(p_profil) <> public.pays_courant() and not public.acces_groupe(p_profil))
     or coalesce(p_chemin, '') not like public.pays_courant() || '/reference/' || p_profil || '-%' then
    raise exception 'Photo de référence invalide.';
  end if;
  perform set_config('dgs.pointage', 'on', true);
  update profils set photo_reference = p_chemin, visage_enregistre = true where id = p_profil;
  perform set_config('dgs.pointage', 'off', true);
end $$;
