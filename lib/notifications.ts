import { createClient } from '@/lib/supabase/server'
import { resend, RESEND_FROM, isResendConfigured } from '@/lib/resend'
import type { SupabaseClient } from '@supabase/supabase-js'

type NotificationType =
  | 'invoice_pending' | 'bl_pending' | 'leave_pending' | 'quote_pending'
  | 'quote_approved' | 'quote_rejected' | 'quote_converted'
  | 'stock_low' | 'invoice_overdue' | 'reminder_sent' | 'inventory_planned'

const typeLabels: Record<NotificationType, string> = {
  invoice_pending: 'Facture en attente de validation',
  bl_pending: 'Bon de livraison en attente',
  leave_pending: 'Demande de conge en attente',
  quote_pending: 'Devis en attente de validation',
  quote_approved: 'Devis accepte',
  quote_rejected: 'Devis refuse',
  quote_converted: 'Devis converti en facture',
  stock_low: 'Stock bas',
  invoice_overdue: 'Facture en retard',
  reminder_sent: 'Relance client envoyee',
  inventory_planned: 'Inventaire planifie',
}

const typeIcons: Record<NotificationType, string> = {
  invoice_pending: '🧾',
  bl_pending: '🚚',
  leave_pending: '🏖',
  quote_pending: '📝',
  quote_approved: '✅',
  quote_rejected: '❌',
  quote_converted: '🔄',
  stock_low: '📦',
  invoice_overdue: '⏰',
  reminder_sent: '✉️',
  inventory_planned: '📋',
}

export async function createNotification(params: {
  type: NotificationType
  title: string
  message: string
  referenceId: string
  referenceType: string
  link: string
  /** false = notification in-app uniquement (évite l'envoi d'email). */
  sendEmail?: boolean
  /** Client explicite (service role pour une tâche planifiée) ; sinon session. */
  client?: SupabaseClient
}) {
  const supabase = params.client || (await createClient())

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
  const emailEnabled = params.sendEmail !== false
  if (emailEnabled && isResendConfigured()) {
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
        const result = await resend.emails.send({
          from: RESEND_FROM,
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
        if (result?.error) {
          console.warn('[notifications] e-mail refusé par Resend :', result.error.message)
          continue
        }
        emailed++
      } catch (e) {
        console.warn('[notifications] échec e-mail :', e instanceof Error ? e.message : e)
      }
    }
  }

  return { inserted: recipients.length, emailed }
}
