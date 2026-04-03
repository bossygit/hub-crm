import { createClient } from '@/lib/supabase/server'
import { resend } from '@/lib/resend'

type NotificationType = 'invoice_pending' | 'bl_pending' | 'leave_pending' | 'quote_pending'

const typeLabels: Record<NotificationType, string> = {
  invoice_pending: 'Facture en attente de validation',
  bl_pending: 'Bon de livraison en attente',
  leave_pending: 'Demande de conge en attente',
  quote_pending: 'Devis en attente de validation',
}

const typeIcons: Record<NotificationType, string> = {
  invoice_pending: '🧾',
  bl_pending: '🚚',
  leave_pending: '🏖',
  quote_pending: '📝',
}

export async function createNotification(params: {
  type: NotificationType
  title: string
  message: string
  referenceId: string
  referenceType: string
  link: string
}) {
  const supabase = await createClient()

  let recipients: { id: string; email?: string; full_name?: string }[] = []

  if (params.type === 'invoice_pending') {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('can_validate_invoices', true)
    recipients = (data || []).map(p => ({ id: p.id, full_name: p.full_name || undefined }))
  } else {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .in('role', ['admin', 'ceo', 'manager'])
    recipients = (data || []).map(p => ({ id: p.id, full_name: p.full_name || undefined }))
  }

  if (recipients.length === 0) return { inserted: 0, emailed: 0 }

  const notifications = recipients.map(r => ({
    type: params.type,
    title: params.title,
    message: params.message,
    reference_id: params.referenceId,
    reference_type: params.referenceType,
    link: params.link,
    recipient_id: r.id,
  }))

  await supabase.from('notifications').insert(notifications)

  let emailed = 0
  const resendKey = process.env.RESEND_API_KEY
  if (resendKey && resendKey !== 're_your-resend-api-key-here') {
    const appBase =
      (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '') ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
    const { data: authUsers } = await supabase.auth.admin.listUsers()
    const emailMap = new Map<string, string>()
    if (authUsers?.users) {
      for (const u of authUsers.users) {
        if (u.email) emailMap.set(u.id, u.email)
      }
    }

    for (const r of recipients) {
      const email = emailMap.get(r.id)
      if (!email) continue
      try {
        await resend.emails.send({
          from: 'HUB-Distribution <contact@hub-distribution.com>',
          to: email,
          subject: `${typeIcons[params.type]} ${params.title}`,
          html: `
            <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:520px;margin:0 auto">
              <div style="background:#1a3d2b;color:white;padding:20px 24px;border-radius:12px 12px 0 0">
                <div style="font-family:Georgia,serif;font-size:1.2rem;font-weight:800">HUB Distribution</div>
                <div style="font-size:0.72rem;opacity:0.6;letter-spacing:0.1em;text-transform:uppercase">Notification</div>
              </div>
              <div style="padding:24px;background:#f8f5ee;border-radius:0 0 12px 12px;border:1px solid #e8e4db;border-top:none">
                <div style="font-size:1.5rem;margin-bottom:8px">${typeIcons[params.type]}</div>
                <div style="font-weight:700;color:#1a3d2b;font-size:1.05rem;margin-bottom:8px">${params.title}</div>
                <div style="color:#555;font-size:0.9rem;margin-bottom:16px">${params.message}</div>
                <a href="${appBase}${params.link}"
                   style="display:inline-block;background:#1a3d2b;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.875rem">
                  Voir le document
                </a>
              </div>
            </div>
          `,
        })
        emailed++
      } catch {
        // Silently fail for individual email errors
      }
    }
  }

  return { inserted: recipients.length, emailed }
}
