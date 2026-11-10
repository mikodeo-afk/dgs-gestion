-- DGS Bamako Gestion : montants HT, TVA et TTC sur toutes les factures.
-- La TVA et le TTC sont calculés par la base (arrondis au franc), jamais saisis à la main.

-- Factures clients : le taux vient du paramètre « tva » (18 %).
alter table public.factures_clients
  add column montant_tva numeric(14,0) generated always as (round(montant_ht * taux_tva / 100)) stored,
  add column montant_ttc numeric(14,0) generated always as (montant_ht + round(montant_ht * taux_tva / 100)) stored;

-- Factures fournisseurs : le taux est celui de la facture reçue (18 % par défaut, 0 % si exonérée).
alter table public.factures_fournisseurs
  add column taux_tva numeric(5,2) not null default 18 check (taux_tva >= 0 and taux_tva <= 100),
  add column montant_tva numeric(14,0) generated always as (round(montant_ht * taux_tva / 100)) stored,
  add column montant_ttc numeric(14,0) generated always as (montant_ht + round(montant_ht * taux_tva / 100)) stored;
