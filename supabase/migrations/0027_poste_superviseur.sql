-- Nouveau poste : Superviseur des ventes terrain (PVT). Ses droits sont donnés dans 0028
-- (une valeur d'énumération ne s'utilise pas dans la transaction qui la crée).
alter type public.poste add value if not exists 'superviseur' after 'tech';
