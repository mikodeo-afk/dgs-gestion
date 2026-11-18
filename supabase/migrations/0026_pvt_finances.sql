-- Ventes terrain : les finances passent par le circuit commun (PV → facture → encaissement).
-- • Le contrat PVT est rattaché à un projet (chantier) : ses factures, encaissements et dépenses
--   entrent dans la rentabilité et les finances de l'entreprise, comme tout autre projet.
-- • L'extraction SBIN définitive vaut PV de réception : quand le superviseur (ou un responsable)
--   l'enregistre, un PV client signé est créé par segment (FTTH, FTTO…) ; les finances le facturent
--   à SBIN puis encaissent le paiement, avec les écrans habituels.
-- • Le mois est alors clôturé : ses ventes ne changent plus (sauf l'état des lignes pour la rétention).
-- • Chaque versement à un vendeur (avance, solde) est une dépense payée du projet.

alter table public.pvt_contrats add column chantier_id uuid references public.chantiers(id) on delete restrict;
alter table public.pvt_mois
  add column pv_b2c_id uuid references public.pv_execution(id) on delete set null,
  add column pv_b2b_id uuid references public.pv_execution(id) on delete set null,
  add column definitive_le date,
  add column definitive_par uuid references public.profils(id);
alter table public.pvt_versements add column depense_id uuid references public.depenses(id) on delete set null;

-- Le mois clôturé est figé.
create or replace function public.pvt_mois_cloture(p_pays text, p_mois date)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select cloture from pvt_mois where pays = p_pays and mois = p_mois), false)
$$;

create or replace function public.pvt_garde_mois()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.statut = new.statut and old.mois = new.mois and old.offre_id = new.offre_id then
    return new;  -- état de la ligne, vendeur, client : toujours modifiables
  end if;
  if (tg_op <> 'INSERT' and public.pvt_mois_cloture(old.pays, old.mois))
     or (tg_op <> 'DELETE' and public.pvt_mois_cloture(coalesce(new.pays, public.pays_courant()), new.mois)) then
    raise exception 'Ce mois est clôturé : son extraction SBIN définitive est enregistrée (PV de réception). Annulez le PV pour le rouvrir.';
  end if;
  return coalesce(new, old);
end $$;
create trigger pvt_garde_mois before insert or update or delete on public.pvt_ventes
for each row execute function public.pvt_garde_mois();

-- Extraction SBIN définitive → PV de réception signé, un par segment.
-- p_lignes : [{ segment (B2C|B2B), designation, unite, quantite, prix }] (montants HT calculés par l'application).
create or replace function public.pvt_extraction_definitive(p_mois date, p_lignes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_pays text := public.pays_courant(); c pvt_contrats; ch chantiers; m pvt_mois; v_seg text; v_pv uuid; v_total numeric;
  v_negatif boolean; v_nom_mois text; v_tiers text; d jsonb; v_res jsonb := '{}'::jsonb;
  v_mois_fr text[] := array['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
begin
  if not public.a_droit('pvt.gerer') then raise exception 'Seul le superviseur ou un responsable des ventes terrain enregistre l''extraction définitive.'; end if;
  if extract(day from p_mois) <> 1 then raise exception 'Mois invalide.'; end if;
  select * into c from pvt_contrats where pays = v_pays;
  if c.chantier_id is null then raise exception 'Rattachez d''abord le contrat PVT à son projet (onglet « Offres et contrat »).'; end if;
  select * into ch from chantiers where id = c.chantier_id;
  select * into m from pvt_mois where pays = v_pays and mois = p_mois for update;
  if m.cloture then raise exception 'L''extraction définitive de ce mois est déjà enregistrée.'; end if;
  if m.extraction_recue_le is null then raise exception 'Importez d''abord l''extraction SBIN de ce mois.'; end if;
  if jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) = 0 then raise exception 'Aucune vente validée ce mois-ci : rien à facturer.'; end if;
  v_nom_mois := v_mois_fr[extract(month from p_mois)::int] || ' ' || extract(year from p_mois);
  v_tiers := coalesce((select nom from tiers where id = ch.client_id), ch.client, c.operateur);

  foreach v_seg in array array['B2C','B2B'] loop
    select coalesce(sum((x ->> 'quantite')::numeric * (x ->> 'prix')::numeric), 0), bool_or((x ->> 'prix')::numeric < 0)
      into v_total, v_negatif
      from jsonb_array_elements(p_lignes) x where x ->> 'segment' = v_seg;
    if v_total <= 0 then continue; end if;
    insert into pv_execution (pays, chantier_id, type, tiers, tiers_id, objet, date_pv, montant_ht, statut, initie_par)
    values (v_pays, c.chantier_id, 'client', v_tiers, ch.client_id,
            'Ventes terrain ' || case v_seg when 'B2C' then 'FTTH (B2C)' else 'FTTO et B2B' end || ' – ' || v_nom_mois || ' – extraction SBIN définitive',
            current_date, 0, 'Établi', auth.uid())
    returning id into v_pv;
    if v_negatif then
      update pv_execution set montant_ht = round(v_total) where id = v_pv;  -- malus : montant net, sans détail par ligne
    else
      for d in select * from jsonb_array_elements(p_lignes) x where x ->> 'segment' = v_seg loop
        insert into pv_lignes (pv_id, designation, unite, quantite, prix_unitaire_ht)
        values (v_pv, d ->> 'designation', coalesce(nullif(d ->> 'unite', ''), 'forfait'), (d ->> 'quantite')::numeric, round((d ->> 'prix')::numeric));
      end loop;
    end if;
    update pv_execution set statut = 'Signé', signe_le = current_date where id = v_pv;
    if v_seg = 'B2C' then m.pv_b2c_id := v_pv; else m.pv_b2b_id := v_pv; end if;
    v_res := v_res || jsonb_build_object(v_seg, (select numero from pv_execution where id = v_pv));
  end loop;
  if v_res = '{}'::jsonb then raise exception 'Aucun montant à facturer ce mois-ci.'; end if;

  update pvt_mois set cloture = true, definitive_le = current_date, definitive_par = auth.uid(), pv_b2c_id = m.pv_b2c_id, pv_b2b_id = m.pv_b2b_id
   where pays = v_pays and mois = p_mois;
  return v_res;
end $$;

-- Un PV de réception annulé (dans « PV d'exécution ») rouvre le mois, pour réimporter et recommencer.
create or replace function public.pvt_pv_annule()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.statut = 'Annulé' and old.statut <> 'Annulé' then
    update pvt_mois set cloture = false, definitive_le = null, definitive_par = null,
           pv_b2c_id = case when pv_b2c_id = new.id then null else pv_b2c_id end,
           pv_b2b_id = case when pv_b2b_id = new.id then null else pv_b2b_id end
     where pv_b2c_id = new.id or pv_b2b_id = new.id;
  end if;
  return new;
end $$;
create trigger pvt_pv_annule after update of statut on public.pv_execution
for each row execute function public.pvt_pv_annule();

-- Versement à un vendeur = dépense payée du projet PVT.
create or replace function public.pvt_versement_depense()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_chantier uuid; v_dep uuid; v_nom text;
begin
  if tg_op = 'DELETE' then
    if old.depense_id is not null then delete from depenses where id = old.depense_id; end if;
    return old;
  end if;
  select chantier_id into v_chantier from pvt_contrats where pays = new.pays;
  if v_chantier is null or new.montant <= 0 then return new; end if;
  select nom into v_nom from pvt_vendeurs where id = new.vendeur_id;
  insert into depenses (pays, chantier_id, objet, montant, demandeur_id, date_depense, statut, valideur_id, valide_le, payeur_id, paye_le)
  values (new.pays, v_chantier,
          'Ventes terrain : ' || lower(new.type) || ' ' || to_char(new.mois, 'MM/YYYY') || ' à ' || coalesce(v_nom, 'vendeur') || coalesce(' (' || new.mode || ')', ''),
          new.montant, coalesce(auth.uid(), new.cree_par), new.verse_le, 'Payée', auth.uid(), now(), auth.uid(), now())
  returning id into v_dep;
  update pvt_versements set depense_id = v_dep where id = new.id;
  return new;
end $$;
create trigger pvt_versement_depense after insert or delete on public.pvt_versements
for each row execute function public.pvt_versement_depense();

grant execute on function public.pvt_mois_cloture(text, date), public.pvt_extraction_definitive(date, jsonb) to authenticated;
