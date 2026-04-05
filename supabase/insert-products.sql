-- ─────────────────────────────────────────────────────
-- Insertion des 20 produits catalogue HUB Distribution
-- Exécuter dans Supabase → SQL Editor
-- ─────────────────────────────────────────────────────

INSERT INTO products (name, category, quantity, unit, threshold_alert, price_per_unit) VALUES
  -- Chocolats
  ('Chocolat noir à la cardamome d''Afrique centrale', 'Chocolats', 50, 'pièce', 20, 3500),
  ('Chocolat noir 100% sans sucre ajouté', 'Chocolats', 50, 'pièce', 20, 3500),
  ('Chocolat noir 75% NZOKO', 'Chocolats', 50, 'pièce', 20, 2000),
  ('Chocolat noir 70% aux éclats d''arachides sucrées', 'Chocolats', 50, 'pièce', 20, 3500),
  ('Chocolat noir 70%', 'Chocolats', 50, 'pièce', 20, 2000),
  ('Chocolat au lait aux éclats d''arachides sucrées', 'Chocolats', 50, 'pièce', 20, 3000),
  ('Chocolat au lait', 'Chocolats', 50, 'pièce', 20, 2000),
  ('Chocolat Noir 70% Kongo', 'Chocolats', 50, 'pièce', 20, 1800),
  -- Farines / Céréales
  ('Farine de maïs jaune 700g', 'Farines / Céréales', 50, 'pièce', 30, 1000),
  ('Semoule de manioc 700g', 'Farines / Céréales', 50, 'pièce', 30, 1000),
  ('Farine de maïs blanc 700g', 'Farines / Céréales', 50, 'pièce', 30, 1000),
  ('Farine de soja', 'Farines / Céréales', 50, 'pièce', 30, 2000),
  ('Farine de manioc 700g', 'Farines / Céréales', 50, 'pièce', 30, 1000),
  -- Graines / Légumineuses
  ('Haricot 700g', 'Graines / Légumineuses', 50, 'pièce', 20, 2000),
  ('Fève de cacao torréfiée 700g', 'Graines / Légumineuses', 50, 'pièce', 20, 6000),
  ('Graine de soja', 'Graines / Légumineuses', 50, 'pièce', 20, 2000),
  -- Autres produits alimentaires
  ('Pâte d''arachide', 'Autres produits alimentaires', 50, 'pièce', 20, 6000),
  ('Gari', 'Autres produits alimentaires', 50, 'pièce', 20, 1500),
  ('Bulukutu', 'Autres produits alimentaires', 50, 'pièce', 20, 700),
  ('Bissap Hibiscus', 'Autres produits alimentaires', 50, 'pièce', 20, 1500)
ON CONFLICT DO NOTHING;
