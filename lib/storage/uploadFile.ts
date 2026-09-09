import { createClient } from '@/lib/supabase/client'

/**
 * Utilitaire générique d'upload Supabase Storage (tous types de fichiers).
 * Pattern : les buckets sont créés côté SQL (supabase/fix-*.sql) avec
 * storage.buckets + policies ; l'upload passe par le client anon authentifié.
 */

export function sanitizeFileName(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
  return base || 'fichier'
}

/**
 * Chemin recommandé : {dossier}/{date}-{nom-assaini}
 * ex. uploadFilePath('cvs', 'mon-cv.pdf') -> cvs/2026-09-09T10-00-00_mon-cv.pdf
 */
export function uploadFilePath(folder: string, fileName: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `${folder}/${stamp}_${sanitizeFileName(fileName)}`
}

export async function uploadFile(
  bucket: string,
  filePath: string,
  file: File | Blob
): Promise<{ storagePath: string | null; error: string | null }> {
  const supabase = createClient()
  const contentType = file instanceof File && file.type ? file.type : 'application/octet-stream'
  const { error } = await supabase.storage
    .from(bucket)
    .upload(filePath, file, { contentType, upsert: true })
  if (error) return { storagePath: null, error: error.message }
  return { storagePath: filePath, error: null }
}

/**
 * URL signée (bucket privé) — pour ouvrir/télécharger un fichier côté client.
 */
export async function getSignedFileUrl(
  bucket: string,
  filePath: string,
  expiresIn = 3600
): Promise<string | null> {
  const supabase = createClient()
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(filePath, expiresIn)
  if (error || !data) return null
  return data.signedUrl
}

/**
 * URL publique directe (bucket public) — utilisée pour les liens envoyés
 * par email à des tiers (aucune session requise).
 */
export function getPublicFileUrl(bucket: string, filePath: string): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${encodeURI(filePath)}`
}
