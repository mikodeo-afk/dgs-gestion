-- DGS Gestion : import d'un fichier Excel pour mettre à jour le stock.
-- Chaque ligne du fichier donne un article (créé s'il n'existe pas encore) et, si une quantité est
-- indiquée, une entrée en stock ou une quantité comptée (inventaire) à l'endroit choisi.
-- Tout le fichier passe, ou rien : la première ligne en erreur est signalée par son numéro.

create or replace function public.importer_stock(p_mode text, p_lieu uuid, p_detenteur uuid, p_lignes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  n int;
  v_code text; v_article uuid; v_client uuid; v_prov text; v_qte numeric; v_seuil numeric;
  v_crees int := 0; v_mvts int := 0; v_ecart numeric;
begin
  if not public.a_droit('stock.gerer') then raise exception 'Vous n''avez pas le droit de gérer le stock.'; end if;
  if p_mode not in ('entree', 'inventaire') then raise exception 'Choisissez : entrée en stock ou inventaire.'; end if;
  if p_mode = 'entree' and p_detenteur is not null then raise exception 'Une entrée se fait au dépôt ou sur un chantier.'; end if;
  perform public.verifier_lieu(p_lieu, p_detenteur);
  if jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) = 0 then raise exception 'Le fichier ne contient aucune ligne.'; end if;
  if jsonb_array_length(p_lignes) > 2000 then raise exception 'Fichier trop long : 2 000 lignes au plus.'; end if;

  for r in select * from jsonb_array_elements(p_lignes) loop
    n := coalesce((r ->> 'ligne')::int, 0);
    begin
      v_code := upper(trim(coalesce(r ->> 'code', '')));
      if v_code = '' then raise exception 'code article manquant'; end if;
      v_qte := nullif(trim(coalesce(r ->> 'quantite', '')), '')::numeric;
      v_seuil := nullif(trim(coalesce(r ->> 'seuil', '')), '')::numeric;
      select id into v_article from articles where pays = public.pays_courant() and lower(trim(code)) = lower(v_code);
      if v_article is null then
        if coalesce(trim(r ->> 'designation'), '') = '' or coalesce(trim(r ->> 'unite'), '') = '' then
          raise exception 'nouvel article % : indiquez la désignation et l''unité', v_code;
        end if;
        v_prov := trim(coalesce(r ->> 'provenance', ''));
        v_client := null;
        if v_prov <> '' and upper(v_prov) not in ('DGS', 'ACHAT', 'ACHETÉ PAR DGS', 'ACHETE PAR DGS') then
          select id into v_client from tiers where pays = public.pays_courant() and type = 'client' and lower(trim(nom)) = lower(v_prov);
          if v_client is null then raise exception 'client « % » inconnu : enregistrez-le dans Clients et fournisseurs, ou écrivez DGS', v_prov; end if;
        end if;
        insert into articles (code, designation, unite, categorie, client_id, seuil_alerte)
        values (v_code, trim(r ->> 'designation'), trim(r ->> 'unite'), nullif(trim(coalesce(r ->> 'categorie', '')), ''), v_client, coalesce(v_seuil, 0))
        returning id into v_article;
        v_crees := v_crees + 1;
      elsif v_seuil is not null then
        update articles set seuil_alerte = v_seuil where id = v_article;
      end if;
      if v_qte is not null then
        if p_mode = 'entree' then
          if v_qte > 0 then
            perform public.entree_stock(v_article, p_lieu, v_qte, coalesce(nullif(trim(coalesce(r ->> 'prix', '')), '')::numeric, 0),
                                        null, r ->> 'fournisseur', coalesce(nullif(trim(coalesce(r ->> 'reference', '')), ''), 'Import Excel'));
            v_mvts := v_mvts + 1;
          elsif v_qte < 0 then
            raise exception 'quantité négative';
          end if;
        else
          v_ecart := public.inventaire_stock(v_article, p_lieu, p_detenteur, v_qte,
                                             coalesce(nullif(trim(coalesce(r ->> 'reference', '')), ''), 'Inventaire importé (Excel)'));
          if v_ecart <> 0 then v_mvts := v_mvts + 1; end if;
        end if;
      end if;
    exception when others then
      raise exception 'Ligne % : %', n, sqlerrm;
    end;
  end loop;
  return jsonb_build_object('lignes', jsonb_array_length(p_lignes), 'articles_crees', v_crees, 'mouvements', v_mvts);
end $$;
grant execute on function public.importer_stock(text, uuid, uuid, jsonb) to authenticated;
