import { NextRequest, NextResponse } from 'next/server'
import { authorizeManager } from '@/lib/auth/serverGuard'
import { createNotification } from '@/lib/notifications'
import { resend, RESEND_FROM, isResendConfigured, resendFromDomain } from '@/lib/resend'
import {
  buildReminderEmail,
  planReminders,
  REMINDER_COOLDOWN_DAYS,
  type ReminderInvoice,
  type ReminderPayment,
  type ReminderRecord,
} from '@/lib/clients/reminders'

// Relances clients automatisées.
//
// POST { dryRun?: boolean, invoice_ids?: string[], cooldownDays?: number }
//   • sans invoice_ids : toutes les factures validées en retard non relancées
//     récemment (délai de carence) ;
//   • avec invoice_ids : uniquement celles-ci.
//
// Envoie un email au client (Resend), enregistre la relance dans
// invoice_reminders et notifie l'équipe in-app. Appelable par un manager
// connecté ou par une tâche planifiée (`Authorization: Bearer $CRON_SECRET`).

const REMINDABLE_STATUSES = ['approved', 'partial']

export async function POST(req: NextRequest) {
  try {
    const auth = await authorizeManager(req)
    if ('error' in auth) return auth.error
    const { client, userId } = auth

    let body: { dryRun?: boolean; invoice_ids?: string[]; cooldownDays?: number } = {}
    try { body = await req.json() } catch { /* corps vide accepté */ }

    const dryRun = !!body.dryRun
    const invoiceIds = Array.isArray(body.invoice_ids) && body.invoice_ids.length ? body.invoice_ids : undefined
    const cooldownDays = Number(body.cooldownDays) > 0 ? Number(body.cooldownDays) : REMINDER_COOLDOWN_DAYS
    const now = new Date()

    let query = client
      .from('invoices')
      .select('id, invoice_number, client_id, due_date, total, status')
      .in('status', REMINDABLE_STATUSES)
    if (invoiceIds) query = query.in('id', invoiceIds)

    const { data: invoices, error: invError } = await query
    if (invError) return NextResponse.json({ error: invError.message }, { status: 500 })
    if (!invoices || invoices.length === 0) {
      return NextResponse.json({ ok: true, ready: 0, sent: 0, failed: 0, onCooldown: 0, withoutEmail: 0, emailConfigured: isResendConfigured() })
    }

    const ids = invoices.map(i => i.id)
    const clientIds = Array.from(new Set(invoices.map(i => i.client_id).filter(Boolean))) as string[]

    const [paymentsRes, remindersRes, clientsRes] = await Promise.all([
      client.from('invoice_payments').select('invoice_id, amount').in('invoice_id', ids),
      client.from('invoice_reminders').select('invoice_id, created_at, level').in('invoice_id', ids),
      clientIds.length
        ? client.from('clients').select('id, name, email').in('id', clientIds)
        : Promise.resolve({ data: [] as { id: string; name: string; email: string | null }[], error: null }),
    ])

    const fetchError = paymentsRes.error || remindersRes.error
    if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })

    const payments = (paymentsRes.data || []) as ReminderPayment[]
    const reminders = (remindersRes.data || []) as ReminderRecord[]
    const clientMap = new Map<string, { id: string; name: string; email: string | null }>(
      ((clientsRes.data || []) as { id: string; name: string; email: string | null }[]).map(c => [c.id, c]),
    )

    const plan = planReminders(invoices as ReminderInvoice[], payments, reminders, now, cooldownDays)
    const withEmail = plan.ready.filter(row => {
      const c = row.invoice.client_id ? clientMap.get(row.invoice.client_id) : null
      return !!c?.email
    })
    const withoutEmail = plan.ready.length - withEmail.length
    const emailConfigured = isResendConfigured()

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        ready: withEmail.length,
        onCooldown: plan.onCooldown.length,
        notOverdue: plan.notOverdue.length,
        withoutEmail,
        emailConfigured,
        items: withEmail.map(row => ({
          id: row.invoice.id,
          invoice_number: row.invoice.invoice_number,
          level: row.level,
          days: row.days,
          balance: row.balance,
          email: clientMap.get(row.invoice.client_id as string)?.email || null,
        })),
      })
    }

    if (!emailConfigured) {
      return NextResponse.json({
        ok: false,
        error: `RESEND_API_KEY non configurée — les relances email sont indisponibles.`,
        ready: withEmail.length,
        emailConfigured: false,
      }, { status: 503 })
    }

    let sent = 0
    let failed = 0

    for (const row of withEmail) {
      const recipient = clientMap.get(row.invoice.client_id as string)
      if (!recipient?.email) continue

      const mail = buildReminderEmail({
        clientName: recipient.name,
        invoiceNumber: row.invoice.invoice_number,
        amountDue: row.balance,
        dueDate: row.invoice.due_date,
        daysOverdue: row.days,
        level: row.level,
      })

      let status: 'sent' | 'failed' = 'sent'
      let errorMessage: string | null = null
      try {
        const result = await resend.emails.send({
          from: RESEND_FROM,
          to: recipient.email,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
        })
        if (result?.error) {
          status = 'failed'
          const detail = String((result.error as { message?: string }).message || 'envoi refusé')
          errorMessage = /domain|verified|verify/i.test(detail)
            ? `${detail} — vérifiez que le domaine ${resendFromDomain()} est validé dans Resend, ou définissez RESEND_FROM.`
            : detail
        }
      } catch (e) {
        status = 'failed'
        errorMessage = e instanceof Error ? e.message : 'erreur réseau'
      }

      if (status === 'sent') sent++
      else failed++

      await client.from('invoice_reminders').insert({
        invoice_id: row.invoice.id,
        client_id: row.invoice.client_id,
        level: row.level,
        channel: 'email',
        recipient_email: recipient.email,
        status,
        amount_due: row.balance,
        days_overdue: row.days,
        error: errorMessage,
        sent_by: userId,
      })

      if (status === 'sent') {
        await createNotification({
          type: 'reminder_sent',
          title: `Relance n°${row.level} envoyée — ${row.invoice.invoice_number}`,
          message: `${recipient.name} relancé pour ${row.balance.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA (${row.days} j de retard).`,
          referenceId: row.invoice.id,
          referenceType: 'invoice',
          link: `/invoices/${row.invoice.id}`,
          sendEmail: false,
          client,
        })
      }
    }

    return NextResponse.json({
      ok: true,
      sent,
      failed,
      onCooldown: plan.onCooldown.length,
      notOverdue: plan.notOverdue.length,
      withoutEmail,
      emailConfigured,
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erreur serveur' }, { status: 500 })
  }
}
