-- Droits par défaut des postes Responsable commercial et RLA.
-- Ce sont des postes du siège : ils voient toute la filiale (pas de périmètre limité)
-- et leur salaire compte dans les frais généraux.
insert into public.permissions_poste (poste, cle) values
  ('commercial','fin.voir'), ('commercial','fc.emettre'), ('commercial','dep.demander'),
  ('rla','dep.demander'), ('rla','ff.enregistrer'), ('rla','fin.voir'), ('rla','geo.voir')
on conflict do nothing;

-- Tout poste hors terrain (chef de projet, chef d'équipe, technicien) est administratif.
create or replace function public.poste_administratif(p public.poste)
returns boolean language sql immutable as $$ select p not in ('cp','ce','tech') $$;
