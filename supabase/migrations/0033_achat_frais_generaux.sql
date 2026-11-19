-- Demande d'achat et bon de commande imputables aux frais généraux (hors projet), comme les dépenses :
-- « chantier_id » vide = frais généraux. Le personnel administratif peut le choisir ; le personnel
-- de terrain reste limité à ses projets (sauf droit « fg.saisir »). La facture fournisseur liée au
-- bon de commande reprend l'imputation (frais généraux), comme pour un projet.
alter table public.demandes_achat alter column chantier_id drop not null;
alter table public.bons_commande  alter column chantier_id drop not null;

create or replace function public.voit_achats(p_chantier uuid, p_demandeur uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_demandeur = auth.uid()
      or public.a_droit('bc.initier') or public.a_droit('bc.valider')
      or ((public.a_droit('da.demander') or public.a_droit('fin.voir')) and p_chantier in (select public.mes_chantiers()))
      or (p_chantier is null and (public.a_droit('fg.voir') or public.a_droit('fg.saisir')))
$$;

drop policy creation on public.demandes_achat;
create policy creation on public.demandes_achat for insert to authenticated
  with check (public.a_droit('da.demander') and demandeur_id = auth.uid() and statut = 'Soumise' and traite_par is null
              and (case when chantier_id is null then public.est_global() or public.a_droit('fg.saisir')
                        else public.est_global() or chantier_id in (select public.mes_chantiers()) end));

-- Le RAF choisit l'imputation du bon de commande (projet ou frais généraux) ; par défaut celle de la demande.
-- p_imputation : vide = celle de la demande, 'FG' = frais généraux, sinon l'identifiant du projet.
drop function public.initier_bon_commande(uuid, text, numeric, numeric, date);
create or replace function public.initier_bon_commande(p_demande uuid, p_fournisseur text, p_montant_ht numeric,
                                                      p_taux_tva numeric default 18, p_livraison date default null,
                                                      p_imputation text default null)
returns text language plpgsql security definer set search_path = public as $$
declare d demandes_achat; v_num text; v_chantier uuid;
begin
  if not public.a_droit('bc.initier') then raise exception 'Vous n''avez pas le droit d''initier un bon de commande.'; end if;
  select * into d from demandes_achat where id = p_demande for update;
  if not found then raise exception 'Demande d''achat introuvable.'; end if;
  if d.statut <> 'Soumise' then raise exception 'Cette demande a déjà été traitée.'; end if;
  if coalesce(trim(p_imputation), '') = '' then
    v_chantier := d.chantier_id;
  elsif p_imputation = 'FG' then
    v_chantier := null;
  else
    select id into v_chantier from chantiers where id = p_imputation::uuid and pays = d.pays;
    if v_chantier is null then raise exception 'Projet introuvable pour ce bon de commande.'; end if;
  end if;
  insert into bons_commande (demande_id, chantier_id, fournisseur, objet, montant_ht, taux_tva, livraison_le)
  values (d.id, v_chantier, trim(p_fournisseur), d.objet, p_montant_ht, coalesce(p_taux_tva, 18), p_livraison)
  returning numero into v_num;
  update demandes_achat set statut = 'Commandée', traite_par = auth.uid(), traite_le = now() where id = d.id;
  return v_num;
end $$;
grant execute on function public.initier_bon_commande(uuid, text, numeric, numeric, date, text) to authenticated;
