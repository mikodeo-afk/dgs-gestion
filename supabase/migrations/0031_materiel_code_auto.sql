-- Numéro d'inventaire du matériel attribué automatiquement à l'enregistrement :
-- VR-0001, VR-0002… pour le matériel roulant ; MT-0001… pour le matériel de travail (suite propre à chaque pays).
-- Les numéros déjà saisis restent inchangés.
create or replace function public.equipement_code_auto()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_prefixe text; v_pays text := coalesce(new.pays, public.pays_courant()); v_n int;
begin
  if coalesce(trim(new.code), '') <> '' then return new; end if;
  v_prefixe := case new.categorie when 'Matériel roulant' then 'VR' else 'MT' end;
  perform pg_advisory_xact_lock(hashtext('equipement_code' || coalesce(v_pays, '') || v_prefixe));
  select coalesce(max(substring(code from '^' || v_prefixe || '-(\d+)$')::int), 0) + 1 into v_n
    from equipements where pays is not distinct from v_pays and code ~ ('^' || v_prefixe || '-\d+$');
  new.code := v_prefixe || '-' || lpad(v_n::text, 4, '0');
  return new;
end $$;
create trigger equipement_code_auto before insert on public.equipements
for each row execute function public.equipement_code_auto();
