-- Nouveau poste : Responsable technique, qualiticien en chef.
-- Il couvre toutes les équipes opérationnelles (chefs de projet, chefs d'équipe, techniciens)
-- et rend compte au Directeur des Opérations.
-- Ses droits par défaut sont dans 0009 (une valeur d'énumération ne s'utilise pas dans la transaction qui la crée).
alter type public.poste add value if not exists 'rt' after 'do';
