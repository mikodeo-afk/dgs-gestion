-- Nouveau poste : Vendeur terrain (ventes Celtiis). Compte créé par le superviseur des ventes,
-- qui ne voit que ses propres ventes. Ses droits sont donnés dans 0024 (PostgreSQL n'autorise pas
-- l'usage d'une valeur d'énumération dans la transaction qui la crée).
alter type public.poste add value if not exists 'vendeur' after 'tech';
