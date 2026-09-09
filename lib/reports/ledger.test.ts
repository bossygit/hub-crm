import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error — extension .ts obligatoire sous node --experimental-strip-types.
import { LEDGER_CSV_HEADERS, buildClientLedger, buildSupplierLedger, grandLivreCsvFilename, ledgerCsv, ledgerTotals, withRunningBalance, type LedgerClientInvoice, type LedgerPurchase } from './ledger.ts'

function invoice(overrides: Partial<LedgerClientInvoice> = {}): LedgerClientInvoice {
  return {
    id: 'inv-1',
    invoice_number: 'FAC-2026-0001',
    date: '2026-09-10',
    status: 'approved',
    client_id: 'c1',
    total: 1180,
    client: { id: 'c1', name: 'Coopérative du Pool' },
    ...overrides,
  }
}

function purchase(overrides: Partial<LedgerPurchase> = {}): LedgerPurchase {
  return {
    id: 'ach-1',
    purchase_number: 'ACH-2026-0001',
    date: '2026-09-08',
    status: 'approved',
    supplier_id: 's1',
    subtotal: 250000,
    client: { id: 's1', name: 'Agri-Supply Congo' },
    ...overrides,
  }
}

describe('buildClientLedger', () => {
  it('posts a DEBIT for each billed invoice (approved/partial/paid) at invoice date', () => {
    const lines = buildClientLedger(
      [
        invoice(),
        invoice({ id: 'inv-2', invoice_number: 'FAC-2026-0002', date: '2026-08-01', status: 'partial', total: 500, client: { id: 'c2', name: 'Marché Central' } }),
        invoice({ id: 'inv-3', invoice_number: 'FAC-2026-0003', status: 'paid' }),
      ],
      [],
    )
    assert.equal(lines.length, 3)
    const first = lines[0]
    assert.equal(first.date, '2026-08-01')
    assert.equal(first.debit, 500)
    assert.equal(first.credit, 0)
    assert.equal(first.accountId, 'c2')
    assert.equal(first.accountName, 'Marché Central')
    assert.equal(first.accountType, 'client')
    assert.equal(first.docNumber, 'FAC-2026-0002')
    assert.equal(first.label, 'Facture N° FAC-2026-0002')
  })

  it('excludes draft, pending and cancelled invoices', () => {
    const lines = buildClientLedger(
      [
        invoice({ id: 'd', status: 'draft' }),
        invoice({ id: 'p', status: 'pending' }),
        invoice({ id: 'x', status: 'cancelled' }),
        invoice({ id: 'ok', invoice_number: 'FAC-OK' }),
      ],
      [],
    )
    assert.equal(lines.length, 1)
    assert.equal(lines[0].docNumber, 'FAC-OK')
  })

  it('credits a payment at its payment date regardless of the invoice status', () => {
    const lines = buildClientLedger(
      [invoice({ status: 'partial' }), invoice({ id: 'draft', invoice_number: 'FAC-D', status: 'draft', client_id: 'c3', client: { id: 'c3', name: 'X' } })],
      [
        { invoice_id: 'inv-1', amount: 400, payment_date: '2026-09-20' },
        { invoice_id: 'draft', amount: 100, payment_date: '2026-09-21' },
      ],
    )
    const credit = lines.filter(l => l.credit > 0)
    assert.equal(credit.length, 2)
    assert.equal(credit[0].date, '2026-09-20')
    assert.equal(credit[0].credit, 400)
    assert.equal(credit[0].debit, 0)
    assert.equal(credit[0].label, 'Encaissement FAC-2026-0001')
    assert.equal(credit[0].docNumber, 'FAC-2026-0001')
    assert.equal(credit[0].accountName, 'Coopérative du Pool')
  })

  it('skips payments whose invoice is not in the provided set', () => {
    const lines = buildClientLedger([invoice()], [
      { invoice_id: 'missing', amount: 50, payment_date: '2026-09-25' },
    ])
    assert.equal(lines.length, 1)
    assert.equal(lines[0].credit, 0)
  })

  it('keeps only the filtered client account', () => {
    const lines = buildClientLedger(
      [
        invoice(),
        invoice({ id: 'inv-2', invoice_number: 'FAC-2', client_id: 'c2', client: { id: 'c2', name: 'Autre' } }),
      ],
      [{ invoice_id: 'inv-1', amount: 200, payment_date: '2026-09-15' }],
      'c1',
    )
    assert.ok(lines.length > 0)
    for (const line of lines) assert.equal(line.accountId, 'c1')
    assert.equal(lines.filter(l => l.credit > 0).length, 1)
  })

  it('drops invoices that have no account at all', () => {
    const lines = buildClientLedger([invoice({ client_id: null, client: null })], [])
    assert.equal(lines.length, 0)
  })

  it('sorts by date then label', () => {
    const lines = buildClientLedger(
      [
        invoice({ id: 'b', invoice_number: 'FAC-B', date: '2026-09-05' }),
        invoice({ id: 'a', invoice_number: 'FAC-A', date: '2026-09-01' }),
        invoice({ id: 'c', invoice_number: 'FAC-C', date: '2026-09-05', client_id: 'c2', client: { id: 'c2', name: 'Z' } }),
      ],
      [],
    )
    assert.deepEqual(lines.map(l => l.docNumber), ['FAC-A', 'FAC-B', 'FAC-C'])
  })
})

describe('buildSupplierLedger', () => {
  it('credits a fournisseur for each ordered/received purchase (pending and approved)', () => {
    const lines = buildSupplierLedger(
      [
        purchase(),
        purchase({ id: 'ach-2', purchase_number: 'ACH-2', status: 'pending', subtotal: 75000 }),
      ],
      [],
    )
    assert.equal(lines.length, 2)
    assert.deepEqual(lines.map(l => l.credit).sort((a, b) => a - b), [75000, 250000])
    const first = lines.find(l => l.credit === 250000)!
    assert.equal(first.debit, 0)
    assert.equal(first.accountType, 'fournisseur')
    assert.equal(first.accountName, 'Agri-Supply Congo')
    assert.equal(first.label, 'Achat N° ACH-2026-0001')
  })

  it('excludes draft and cancelled purchases', () => {
    const lines = buildSupplierLedger(
      [
        purchase({ id: 'd', status: 'draft' }),
        purchase({ id: 'x', status: 'cancelled' }),
        purchase({ id: 'ok', purchase_number: 'ACH-OK' }),
      ],
      [],
    )
    assert.equal(lines.length, 1)
    assert.equal(lines[0].docNumber, 'ACH-OK')
  })

  it('debits a payment and ignores payments of draft/cancelled purchases', () => {
    const lines = buildSupplierLedger(
      [purchase(), purchase({ id: 'd', status: 'draft' })],
      [
        { purchase_id: 'ach-1', amount: 100000, payment_date: '2026-09-12' },
        { purchase_id: 'd', amount: 999, payment_date: '2026-09-13' },
        { purchase_id: 'missing', amount: 1, payment_date: '2026-09-14' },
      ],
    )
    const debit = lines.filter(l => l.debit > 0)
    assert.equal(debit.length, 1)
    assert.equal(debit[0].debit, 100000)
    assert.equal(debit[0].label, 'Règlement ACH-2026-0001')
    assert.equal(debit[0].date, '2026-09-12')
  })

  it('keeps only the filtered fournisseur account', () => {
    const lines = buildSupplierLedger(
      [
        purchase(),
        purchase({ id: 'ach-2', purchase_number: 'ACH-2', supplier_id: 's2', client: { id: 's2', name: 'Autre fournisseur' } }),
      ],
      [],
      's1',
    )
    assert.equal(lines.length, 1)
    assert.equal(lines[0].accountId, 's1')
  })
})

describe('withRunningBalance / ledgerTotals', () => {
  it('computes the balance sequentially as debit minus credit', () => {
    const withBalance = withRunningBalance(
      buildClientLedger(
        [invoice({ date: '2026-09-01' })],
        [{ invoice_id: 'inv-1', amount: 400, payment_date: '2026-09-10' }],
        'c1',
      ),
    )
    assert.equal(withBalance.length, 2)
    assert.equal(withBalance[0].debit, 1180)
    assert.equal(withBalance[0].balance, 1180)
    assert.equal(withBalance[1].credit, 400)
    assert.equal(withBalance[1].balance, 780)
  })

  it('totals debits and credits', () => {
    const entries = buildClientLedger(
      [invoice(), invoice({ id: 'inv-2', invoice_number: 'FAC-2', total: 500 })],
      [{ invoice_id: 'inv-1', amount: 300, payment_date: '2026-09-11' }],
    )
    const totals = ledgerTotals(entries)
    assert.equal(totals.debit, 1680)
    assert.equal(totals.credit, 300)
  })
})

describe('ledger CSV helpers', () => {
  it('uses the French headers and filenames', () => {
    assert.deepEqual([...LEDGER_CSV_HEADERS], ['Date', 'N° pièce', 'Compte', 'Libellé', 'Débit', 'Crédit', 'Solde'])
    assert.equal(grandLivreCsvFilename('clients'), 'hub-grand-livre-clients.csv')
    assert.equal(grandLivreCsvFilename('fournisseurs'), 'hub-grand-livre-fournisseurs.csv')
    assert.equal(grandLivreCsvFilename('tout'), 'hub-grand-livre-tout.csv')
    assert.equal(grandLivreCsvFilename('clients', '2026-09'), 'hub-grand-livre-clients-2026-09.csv')
    assert.equal(grandLivreCsvFilename('nimporte', 'pas-un-mois'), 'hub-grand-livre-tout.csv')
  })

  it('serializes balanced lines with a French date and single-side amounts', () => {
    const entries = withRunningBalance(
      buildClientLedger([invoice({ date: '2026-09-01' })], [{ invoice_id: 'inv-1', amount: 400, payment_date: '2026-09-10' }], 'c1'),
    )
    const csv = ledgerCsv(entries)
    assert.equal(csv.startsWith('\uFEFFDate;N° pièce;Compte;Libellé;Débit;Crédit;Solde\r\n'), true)
    assert.equal(csv.includes('01/09/2026;FAC-2026-0001;Coopérative du Pool;Facture N° FAC-2026-0001;1180;0;1180\r\n'), true)
    assert.equal(csv.includes('10/09/2026;FAC-2026-0001;Coopérative du Pool;Encaissement FAC-2026-0001;0;400;780\r\n'), true)
  })

  it('writes headers only when empty', () => {
    assert.equal(ledgerCsv([]), '\uFEFFDate;N° pièce;Compte;Libellé;Débit;Crédit;Solde\r\n')
  })
})
