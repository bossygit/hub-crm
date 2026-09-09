-- =====================================================
-- FIX: Fiche partenaire enrichie (module Clients)
--
-- Problème: la table clients ne porte que des champs de
-- contact basiques (name/type/email/phone/address/tax_id/
-- notes). Le fichier partenaire est trop pauvre: pas de
-- RCCM, pas de ville dédiée, pas de contact de terrain,
-- pas d'état actif/inactif, pas de conditions commerciales.
--
-- Solution: ajouter les colonnes métier de la fiche
-- partenaire complète. Idempotent — peut être rejoué.
--
-- À exécuter dans Supabase SQL Editor (Dashboard → SQL)
-- =====================================================

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS tax_id text,
  ADD COLUMN IF NOT EXISTS rccm text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS payment_terms text NOT NULL DEFAULT '30 jours',
  ADD COLUMN IF NOT EXISTS credit_limit numeric NOT NULL DEFAULT 0;

-- Index utilitaires (recherche & filtres du module Clients)
CREATE INDEX IF NOT EXISTS idx_clients_name_lower ON public.clients (lower(name));
CREATE INDEX IF NOT EXISTS idx_clients_type ON public.clients (type);
CREATE INDEX IF NOT EXISTS idx_clients_is_active ON public.clients (is_active);
CREATE INDEX IF NOT EXISTS idx_clients_tax_id ON public.clients (tax_id);

-- Les politiques RLS existantes (clients_all FOR ALL) couvrent
-- automatiquement les nouvelles colonnes : aucun changement requis.
