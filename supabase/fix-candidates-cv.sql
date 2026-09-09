-- =====================================================
-- FIX: Upload CV des candidats (module Recrutement)
--
-- Problème: la table candidates possède déjà la colonne
-- cv_url mais aucun CV n'est branché sur le stockage
-- objet Supabase. Le module Recrutement est noté 5/10
-- avec l'écart "Upload CV (cv_url) non branché".
--
-- Solution: créer un bucket PRIVÉ 'cvs' et autoriser les
-- utilisateurs authentifiés à lire (SELECT), déposer
-- (INSERT) et remplacer (UPDATE) les CV dans ce bucket.
-- Le client stocke dans candidates.cv_url le chemin objet
-- retourné par l'upload (uploadFilePath -> 'cvs/<date>_<nom>')
-- et le visualise via createSignedUrl (URL signée, 1 h).
--
-- Idempotent : exécutable plusieurs fois sans erreur.
-- À exécuter dans Supabase SQL Editor (Dashboard → SQL),
-- une seule fois par environnement (local / prod).
-- =====================================================

-- ── Bucket privé "cvs" (CV des candidats) ───────────────────────────
-- public = false : l'accès passe par les politiques ci-dessous et par
-- des URLs signées générées côté client (getSignedFileUrl).
INSERT INTO storage.buckets (id, name, public)
VALUES ('cvs', 'cvs', false)
ON CONFLICT (id) DO NOTHING;

-- Lecture : nécessaire pour createSignedUrl (lire les métadonnées)
DROP POLICY IF EXISTS "cvs_storage_select" ON storage.objects;
CREATE POLICY "cvs_storage_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'cvs');

-- Dépôt : upload d'un nouveau CV (création de candidat)
DROP POLICY IF EXISTS "cvs_storage_insert" ON storage.objects;
CREATE POLICY "cvs_storage_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cvs');

-- Remplacement : upload d'un CV mis à jour (édition de candidat)
DROP POLICY IF EXISTS "cvs_storage_update" ON storage.objects;
CREATE POLICY "cvs_storage_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'cvs')
  WITH CHECK (bucket_id = 'cvs');

-- Note: la table candidates n'est PAS modifiée — la colonne
-- cv_url (text) existe déjà dans setup.sql. Aucun changement
-- de schéma nécessaire pour brancher l'upload.
