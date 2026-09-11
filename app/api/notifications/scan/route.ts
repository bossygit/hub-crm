import { NextRequest, NextResponse } from 'next/server'
import { authorizeManager } from '@/lib/auth/serverGuard'
import { createNotification } from '@/lib/notifications'
import {
  ALERT_DEDUP_DAYS,
  buildLowStockAlerts,
  hasRecentAlert,
  stockAlertMessage,
  type ExistingAlert,
} from '@/lib/stock/alerts'
import { overdueAlertMessage, overdueOpenInvoices } from '@/lib/clients/reminders'

// Scan des alertes opérationnelles : stock bas + factures en retard.
// Crée des notifications in-app (sans email pour éviter le spam) en évitant
// les doublons sur une fenêtre glissante.
//
// Appelable :
//   • par un utilisateur connecté de rôle ceo/manager/admin (bouton UI) ;
//   • par une tâche planifiée avec `Authorization: Bearer $CRON_SECRET`.

export async function POST(req: NextRequest) {
  try {
    const auth = await authorizeManager(req)
    if ('error' in auth) return auth.error
    const { client } = auth

    let dryRun = false
    try {
      const body = await req.json()
      dryRun = !!body?.dryRun
    } catch { /* corps vide accepté */ }

    const now = new Date()
    const cutoff = new Date(now.getTime() - ALERT_DEDUP_DAYS * 24 * 60 * 60 * 1000).toISOString()

    const [productsRes, invoicesRes, paymentsRes, existingRes] = await Promise.all([
      client.from('products').select('id, name, quantity, unit, threshold_alert'),
      client.from('invoices').select('id, invoice_number, client_id, due_date, total, status'),
      client.from('invoice_payments').select('invoice_id, amount'),
      client.from('notifications')
        .select('type, reference_id, reference_type, created_at')
        .in('type', ['stock_low', 'invoice_overdue'])
        .gte('created_at', cutoff),
    ])

    const firstError = productsRes.error || invoicesRes.error || paymentsRes.error
    if (firstError) {
      return NextResponse.json({ error: firstError.message }, { status: 500 })
    }

    const existing: ExistingAlert[] = existingRes.error ? [] : (existingRes.data || [])
    const lowStock = buildLowStockAlerts(productsRes.data || [])
    const overdue = overdueOpenInvoices(invoicesRes.data || [], paymentsRes.data || [], now)

    let stockCreated = 0
    let overdueCreated = 0
    let skipped = 0

    for (const alert of lowStock) {
      if (hasRecentAlert(existing, { type: 'stock_low', referenceId: alert.product.id }, now)) { skipped++; continue }
      stockCreated++
      if (dryRun) continue
      await createNotification({
        type: 'stock_low',
        title: `Stock bas — ${alert.product.name}`,
        message: stockAlertMessage(alert),
        referenceId: alert.product.id,
        referenceType: 'product',
        link: '/stock',
        sendEmail: false,
        client,
      })
    }

    for (const row of overdue) {
      if (hasRecentAlert(existing, { type: 'invoice_overdue', referenceId: row.invoice.id }, now)) { skipped++; continue }
      overdueCreated++
      if (dryRun) continue
      await createNotification({
        type: 'invoice_overdue',
        title: `Facture en retard — ${row.invoice.invoice_number}`,
        message: overdueAlertMessage(row),
        referenceId: row.invoice.id,
        referenceType: 'invoice',
        link: `/invoices/${row.invoice.id}`,
        sendEmail: false,
        client,
      })
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      stockLow: stockCreated,
      overdue: overdueCreated,
      skipped,
      total: stockCreated + overdueCreated,
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erreur serveur' }, { status: 500 })
  }
}
