'use client'
import { receiptsCsvFilename, salesCsvFilename } from '@/lib/reports/csv'

export default function JournalExports({
  month,
  salesCsv,
  receiptsCsv,
}: {
  month: string
  salesCsv: string
  receiptsCsv: string
}) {
  function download(filename: string, content: string) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button
        type="button"
        className="btn-primary"
        style={{ padding: '8px 14px', fontSize: '0.8rem' }}
        onClick={() => download(salesCsvFilename(month), salesCsv)}
      >
        Export ventes CSV
      </button>
      <button
        type="button"
        className="btn-ghost"
        style={{ padding: '8px 14px', fontSize: '0.8rem' }}
        onClick={() => download(receiptsCsvFilename(month), receiptsCsv)}
      >
        Export encaissements CSV
      </button>
    </div>
  )
}
