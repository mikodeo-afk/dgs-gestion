-- Droits par défaut du Responsable technique (qualiticien en chef).
-- Il voit tous les chantiers (poste du siège), organise et suit les tâches de toutes les équipes,
-- suit les présences et la position des agents, et voit l'avancement financier des projets.
insert into public.permissions_poste (poste, cle) values
  ('rt','tache.creer'), ('rt','tache.maj'), ('rt','dep.demander'), ('rt','pres.saisir'),
  ('rt','geo.voir'), ('rt','fin.voir')
on conflict do nothing;

-- L'équipe d'une personne suit toute la chaîne d'encadrement (DO → Responsable technique →
-- chef de projet → chef d'équipe → technicien), quelle que soit sa profondeur.
create or replace function public.equipe_de(p_profil uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  with recursive e(id) as (
    select p_profil
    union
    select p.id from profils p join e on p.responsable_id = e.id
  )
  select id from e
$$;
