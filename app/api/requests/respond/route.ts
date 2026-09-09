import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resend } from '@/lib/resend'
import { getPublicFileUrl } from '@/lib/storage/uploadFile'

export const dynamic = 'force-dynamic'

const BUCKET = 'request-responses'
const FROM_EMAIL = 'HUB-Distribution <contact@hub-distribution.com>'
const PLACEHOLDER_KEYS = ['placeholder', 're_your-resend-api-key-here']

/**
 * Renvoie au demandeur le fichier de réponse joint à sa demande :
 * charge la demande, construit l'URL publique de téléchargement du
 * bucket 'request-responses' et envoie un email en français via Resend.
 * En cas de succès, horodate email_sent_at sur la ligne.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ ok: false, error: 'Non authentifié.' }, { status: 401 })
    }

    // --- body: { requestId } ---
    let requestId = ''
    try {
      const body = await req.json()
      requestId = typeof body?.requestId === 'string' ? body.requestId.trim() : ''
    } catch {
      requestId = ''
    }
    if (!requestId) {
      return NextResponse.json({ ok: false, error: 'Paramètre manquant : requestId' }, { status: 400 })
    }

    // --- Charge la demande ---
    const { data: row, error: fetchError } = await supabase
      .from('document_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle()
    if (fetchError) {
      return NextResponse.json({ ok: false, error: `Lecture impossible : ${fetchError.message}` }, { status: 500 })
    }
    if (!row) {
      return NextResponse.json({ ok: false, error: 'Demande introuvable.' }, { status: 404 })
    }

    // --- Pré-conditions métier ---
    const filePath: string = row.document_url || ''
    if (!filePath) {
      return NextResponse.json(
        { ok: false, error: "Aucun fichier de réponse joint à cette demande. Joignez le fichier avant d'envoyer l'email." },
        { status: 400 }
      )
    }
    if (row.status !== 'approved' && row.status !== 'processing') {
      return NextResponse.json(
        { ok: false, error: 'Seules les demandes approuvées (ou en cours avec fichier) peuvent être renvoyées par email.' },
        { status: 400 }
      )
    }
    const recipientEmail: string = (row.email || '').trim()
    if (!recipientEmail) {
      return NextResponse.json(
        { ok: false, error: "Adresse email du demandeur manquante sur cette demande. Copiez le lien public et transmettez-le manuellement." },
        { status: 400 }
      )
    }

    // --- Clé Resend absente → échec gracieux (dév local, pas d'email envoyé) ---
    const resendKey = process.env.RESEND_API_KEY
    if (!resendKey || PLACEHOLDER_KEYS.includes(resendKey)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Envoi impossible : clé Resend non configurée (RESEND_API_KEY). L'email n'a pas été envoyé — le fichier reste joint à la demande.",
        },
        { status: 503 }
      )
    }

    // --- URL publique directe (bucket public → aucune session requise) ---
    let downloadUrl = ''
    if (/^https?:\/\//i.test(filePath)) {
      downloadUrl = filePath // déjà une URL absolue (donnée héritée)
    } else {
      const base = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
      if (!base) {
        return NextResponse.json(
          { ok: false, error: 'Configuration manquante : NEXT_PUBLIC_SUPABASE_URL (URL de téléchargement indisponible).' },
          { status: 500 }
        )
      }
      downloadUrl = getPublicFileUrl(BUCKET, filePath)
    }

    const fileName: string = row.response_file_name || row.document_type || 'document'
    const refId = String(row.id).slice(0, 8).toUpperCase()
    const createdLabel = new Date(row.created_at).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })

    const subject = `Votre demande de document — ${row.organization}`
    const text = [
      `Bonjour ${row.requester_name},`,
      ``,
      `Votre demande de document a été traitée par HUB Distribution.`,
      ``,
      `Document demandé : ${row.document_type}`,
      `Organisation : ${row.organization}`,
      `Référence de la demande : ${refId}`,
      ...(row.description ? [`Précisions : ${row.description}`] : []),
      ...(row.response_notes ? [`Message de notre équipe : ${row.response_notes}`] : []),
      ``,
      `Votre document est disponible au téléchargement :`,
      downloadUrl,
      ``,
      `Cordialement,`,
      `L'équipe HUB Distribution`,
    ].join('\n')

    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto">
        <div style="background:#1a3d2b;color:white;padding:22px 26px;border-radius:12px 12px 0 0">
          <div style="font-family:Georgia,serif;font-size:1.25rem;font-weight:800">🌿 HUB Distribution</div>
          <div style="font-size:0.72rem;opacity:0.65;letter-spacing:0.1em;text-transform:uppercase">Votre document est prêt</div>
        </div>
        <div style="padding:26px;background:#f8f5ee;border:1px solid #e8e4db;border-top:none;border-radius:0 0 12px 12px">
          <div style="font-weight:700;color:#1a3d2b;font-size:1.05rem;margin-bottom:14px">Bonjour ${row.requester_name},</div>
          <div style="color:#444;font-size:0.92rem;line-height:1.6;margin-bottom:16px">
            Votre demande de document a été traitée par HUB Distribution.
          </div>
          <table style="width:100%;font-size:0.875rem;color:#444;margin-bottom:18px">
            <tr><td style="padding:4px 0;color:#999;width:170px">Document demandé</td><td style="font-weight:600;color:#1a3d2b">${row.document_type}</td></tr>
            <tr><td style="padding:4px 0;color:#999">Organisation</td><td>${row.organization}</td></tr>
            <tr><td style="padding:4px 0;color:#999">Référence</td><td style="font-family:monospace">${refId}</td></tr>
            <tr><td style="padding:4px 0;color:#999">Demande du</td><td>${createdLabel}</td></tr>
            ${row.response_notes ? `<tr><td style="padding:4px 0;color:#999;vertical-align:top">Message</td><td>${row.response_notes}</td></tr>` : ''}
          </table>
          <div style="text-align:center;margin-bottom:18px">
            <a href="${downloadUrl}" style="display:inline-block;background:#1a3d2b;color:white;padding:13px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:0.95rem">
              📥 Télécharger ${fileName}
            </a>
          </div>
          <div style="font-size:0.78rem;color:#888;text-align:center;margin-bottom:14px">
            Si le bouton ne fonctionne pas : <a href="${downloadUrl}" style="color:#1a3d2b">${downloadUrl}</a>
          </div>
          <div style="border-top:1px solid #e8e4db;padding-top:14px;font-size:0.8rem;color:#888">
            Cordialement,<br/>L'équipe HUB Distribution — Transformation &amp; Distribution Agricole, Brazzaville
          </div>
        </div>
      </div>
    `

    let sendResult: { data: { id: string } | null; error: { message: string } | null }
    try {
      sendResult = await resend.emails.send({
        from: FROM_EMAIL,
        to: recipientEmail,
        subject,
        text,
        html,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'erreur inconnue'
      return NextResponse.json({ ok: false, error: `Envoi échoué : ${msg}` }, { status: 502 })
    }

    if (sendResult.error || !sendResult.data?.id) {
      const msg = sendResult.error?.message || 'erreur inconnue du service email'
      return NextResponse.json({ ok: false, error: `Envoi échoué : ${msg}` }, { status: 502 })
    }

    // --- Succès → horodatage de l'envoi ---
    const now = new Date().toISOString()
    const { error: updateError } = await supabase
      .from('document_requests')
      .update({ email_sent_at: now, updated_at: now })
      .eq('id', requestId)
    if (updateError) {
      return NextResponse.json(
        { ok: false, error: `Email envoyé mais mise à jour impossible : ${updateError.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true, email_sent_at: now, to: recipientEmail })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur serveur inattendue'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
