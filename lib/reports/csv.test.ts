import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatCsvDate,
  receiptsCsvFilename,
  RECEIPT_CSV_HEADERS,
  SALES_CSV_HEADERS,
  salesCsvFilename,
  toExcelCsv,
} from './csv.ts'
import { salesJournalToCsv, receiptsJournalToCsv } from './csv.ts'
import type { ReceiptJournalLine, SalesJournalLine } from './journal.ts'

describe('toExcelCsv', () => {
  it('starts with a UTF-8 BOM, uses semicolons and CRLF', () => {
    const csv = toExcelCsv(['A', 'B'], [['x', 1]])
    assert.equal(csv.startsWith('\uFEFF'), true)
    assert.equal(csv.includes(','), false)
    assert.match(csv, /\r\n/)
    assert.equal(csv, '\uFEFFA;B\r\nx;1\r\n')
  })

  it('formats integers without decimals and fractions with a comma', () => {
    const csv = toExcelCsv(['N'], [[1180], [1180.5]])
    assert.equal(csv, '\uFEFFN\r\n1180\r\n1180,50\r\n')
  })

  it('quotes fields that contain semicolons or quotes', () => {
    const csv = toExcelCsv(['N'], [['a;b'], ['dit "ok"']])
    assert.equal(csv, '\uFEFFN\r\n"a;b"\r\n"dit ""ok"""\r\n')
  })

  it('still writes headers when there are no rows', () => {
    const csv = toExcelCsv(['Date', 'Montant'], [])
    assert.equal(csv, '\uFEFFDate;Montant\r\n')
  })
})

describe('formatCsvDate', () => {
  it('formats an ISO date as JJ/MM/AAAA', () => {
    assert.equal(formatCsvDate('2026-09-09'), '09/09/2026')
    assert.equal(formatCsvDate('2026-09-09T12:00:00.000Z'), '09/09/2026')
  })
})

describe('journal csv helpers', () => {
  it('uses the French sales headers and filenames', () => {
    assert.deepEqual([...SALES_CSV_HEADERS], ['Date', 'N°', 'Client', 'NIF', 'Statut', 'HT', 'Remise', 'TVA', 'TTC', 'Encaissé', 'Solde'])
    assert.deepEqual([...RECEIPT_CSV_HEADERS], ['Date', 'N° facture', 'Client', 'NIF', 'Mode', 'Référence', 'Montant'])
    assert.equal(salesCsvFilename('2026-09'), 'hub-ventes-2026-09.csv')
    assert.equal(receiptsCsvFilename('2026-09'), 'hub-encaissements-2026-09.csv')
  })

  it('serializes a sales line with a French date', () => {
    const line: SalesJournalLine = {
      date: '2026-09-10',
      invoiceNumber: 'FAC-2026-0001',
      clientName: 'Coopérative du Pool',
      nif: 'CG-123',
      statusLabel: 'Validée',
      ht: 1000,
      discount: 0,
      vat: 180,
      ttc: 1180,
      collected: 180,
      balance: 1000,
    }
    const csv = salesJournalToCsv([line])
    assert.equal(csv.startsWith('\uFEFFDate;N°;'), true)
    assert.equal(csv.includes('10/09/2026;FAC-2026-0001;Coopérative du Pool;CG-123;Validée;1000;0;180;1180;180;1000\r\n'), true)
  })

  it('serializes a receipt line', () => {
    const line: ReceiptJournalLine = {
      date: '2026-09-05',
      invoiceNumber: 'FAC-2026-0001',
      clientName: 'Coopérative du Pool',
      nif: 'CG-123',
      method: 'virement',
      reference: 'VIR-1',
      amount: 200,
    }
    const csv = receiptsJournalToCsv([line])
    assert.equal(csv.includes('05/09/2026;FAC-2026-0001;Coopérative du Pool;CG-123;virement;VIR-1;200\r\n'), true)
  })
})
