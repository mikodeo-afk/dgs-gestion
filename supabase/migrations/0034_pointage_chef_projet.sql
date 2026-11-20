-- Le chef de projet voit les pointages faits sur ses chantiers, même par des équipes qui ne lui sont pas rattachées.
drop policy if exists lecture on public.presences;
create policy lecture on public.presences for select to authenticated using (
  profil_id = auth.uid()
  or (public.est_global() and (public.a_droit('pres.saisir') or public.a_droit('sal.voir') or public.a_droit('paie.voir')
      or public.a_droit('paie.preparer') or public.a_droit('paie.valider') or public.a_droit('paie.payer')))
  or (public.a_droit('pres.saisir') and profil_id in (select public.equipe_de(auth.uid())))
  or profil_id in (select id from profils where responsable_id = auth.uid())
  or (chantier_id is not null and exists (select 1 from chantiers c where c.id = chantier_id and c.chef_projet_id = auth.uid()))
);
