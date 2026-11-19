-- Demande de dépense : le personnel administratif (RH, RLA, commercial, RT…) peut imputer sa demande
-- aux frais généraux (hors projet), et plus seulement la comptabilité. La demande reste soumise à la
-- validation habituelle (RAF jusqu'au seuil, PDG/DO au-delà). Le personnel de terrain impute toujours
-- à ses projets (ou aux frais généraux si on lui donne le droit « fg.saisir »).
drop policy demande on public.depenses;
create policy demande on public.depenses for insert to authenticated with check (
  public.a_droit('dep.demander') and demandeur_id = auth.uid() and statut = 'Demandée'
  and valideur_id is null and payeur_id is null
  and (case when chantier_id is null then public.est_global() or public.a_droit('fg.saisir')
            else public.est_global() or chantier_id in (select public.mes_chantiers()) end)
);
