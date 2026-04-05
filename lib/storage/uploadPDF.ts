import { createClient } from '@/lib/supabase/client'

export async function uploadPDF(
  bucket: string,
  filePath: string,
  pdfBlob: Blob
): Promise<{ storagePath: string | null; error: string | null }> {
  const supabase = createClient()

  const { error } = await supabase.storage
    .from(bucket)
    .upload(filePath, pdfBlob, {
      contentType: 'application/pdf',
      upsert: true,
    })

  if (error) return { storagePath: null, error: error.message }
  return { storagePath: filePath, error: null }
}

export async function getSignedPDFUrl(
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

export async function savePDFAndUpdateRecord(
  bucket: string,
  filePath: string,
  pdfBlob: Blob,
  table: string,
  recordId: string
): Promise<{ success: boolean; error: string | null }> {
  const supabase = createClient()

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(filePath, pdfBlob, {
      contentType: 'application/pdf',
      upsert: true,
    })

  if (uploadError) return { success: false, error: uploadError.message }

  const storagePath = `${bucket}/${filePath}`
  const { error: updateError } = await supabase
    .from(table)
    .update({ file_url: storagePath })
    .eq('id', recordId)

  if (updateError) return { success: false, error: updateError.message }
  return { success: true, error: null }
}
