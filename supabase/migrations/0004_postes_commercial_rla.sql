-- Nouveaux postes : Responsable commercial et Responsable Logistique et Achats (RLA).
-- PostgreSQL n'autorise pas l'usage d'une valeur d'énumération dans la transaction
-- qui la crée : les droits par défaut sont donnés dans 0005.
alter type public.poste add value if not exists 'commercial' after 'compta';
alter type public.poste add value if not exists 'rla' after 'commercial';
