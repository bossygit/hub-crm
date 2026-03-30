'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Document, DocumentType, Client } from '@/types'

const docTypes: { value: DocumentType; label: string; icon: string }[] = [
  { value: 'facture', label: 'Facture', icon: '🧾' },
  { value: 'bon_de_livraison', label: 'Bon de Livraison', icon: '🚚' },
  { value: 'attestation', label: 'Attestation', icon: '📋' },
  { value: 'contrat', label: 'Contrat', icon: '✍️' },
  { value: 'document_administratif', label: 'Document Administratif', icon: '🏛️' },
  { value: 'autre', label: 'Autre', icon: '📄' },
]

const statusBadge = {
  draft: 'badge-gray',
  generated: 'badge-blue',
  sent: 'badge-green',
}

const statusLabels = { draft: 'Brouillon', generated: 'Généré', sent: 'Envoyé' }

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<any[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showPreview, setShowPreview] = useState<any>(null)
  const [form, setForm] = useState({ title: '', type: 'facture' as DocumentType, client_id: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  async function load() {
    setLoading(true)
    const [{ data: docs }, { data: cls }] = await Promise.all([
      supabase.from('documents').select('*, client:clients(name, type)').order('created_at', { ascending: false }),
      supabase.from('clients').select('id, name, type, created_at').order('name')
    ])
    setDocuments(docs || [])
    setClients((cls as Client[]) || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    const { data: user } = await supabase.auth.getUser()
    await supabase.from('documents').insert({
      ...form,
      client_id: form.client_id || null,
      status: 'generated',
      created_by: user.user?.id,
      metadata: { notes: form.notes }
    })
    setSaving(false); setShowModal(false)
    setForm({ title: '', type: 'facture', client_id: '', notes: '' })
    load()
  }

  async function updateStatus(id: string, status: string) {
    await supabase.from('documents').update({ status }).eq('id', id)
    load()
  }

  async function deleteDoc(id: string) {
    if (!confirm('Supprimer ce document ?')) return
    await supabase.from('documents').delete().eq('id', id)
    load()
  }

  function generatePDF(doc: any) {
    const typeInfo = docTypes.find(t => t.value === doc.type)
    const html = `
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <title>${doc.title}</title>
        <style>
          body { font-family: Georgia, serif; margin: 0; padding: 40px; color: #0f1f17; background: white; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 3px solid #2d6a4f; }
          .logo { font-size: 1.8rem; font-weight: 800; color: #1a3d2b; }
          .logo .sub { font-size: 0.75rem; color: #666; letter-spacing: 0.15em; text-transform: uppercase; font-family: sans-serif; }
          .doc-badge { background: #2d6a4f; color: white; padding: 8px 18px; border-radius: 4px; font-size: 0.9rem; font-weight: 600; font-family: sans-serif; }
          .doc-number { color: #666; font-size: 0.8rem; margin-top: 4px; font-family: sans-serif; text-align: right; }
          h1 { color: #1a3d2b; font-size: 1.6rem; margin-bottom: 8px; }
          .meta { background: #f8f5ee; padding: 20px 24px; border-radius: 8px; margin-bottom: 28px; font-family: sans-serif; }
          .meta-row { display: flex; gap: 40px; }
          .meta-item label { font-size: 0.7rem; color: #666; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700; display: block; margin-bottom: 2px; }
          .meta-item value { font-size: 0.9rem; color: #1a3d2b; font-weight: 600; }
          .content { margin: 24px 0; min-height: 200px; border: 1px solid #e8e4db; border-radius: 8px; padding: 20px; font-family: sans-serif; }
          .footer { margin-top: 60px; padding-top: 20px; border-top: 1px solid #ddd; display: flex; justify-content: space-between; font-size: 0.75rem; color: #888; font-family: sans-serif; }
          .stamp-area { text-align: right; }
          .stamp-box { border: 1.5px dashed #ccc; border-radius: 8px; padding: 20px 30px; display: inline-block; color: #aaa; font-size: 0.8rem; margin-top: 8px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="logo">🌿 HUB Distribution</div>
            <div class="logo sub">Transformation & Distribution Agricole</div>
            <div style="margin-top:8px; font-family:sans-serif; font-size:0.8rem; color:#666;">
              Brazzaville, République du Congo<br>
              hub@distribution.cg | +242 06 000 0000
            </div>
          </div>
          <div style="text-align:right">
            <div class="doc-badge">${typeInfo?.icon} ${typeInfo?.label}</div>
            <div class="doc-number">N° HUB-${doc.id.slice(-6).toUpperCase()}</div>
          </div>
        </div>

        <h1>${doc.title}</h1>
        
        <div class="meta">
          <div class="meta-row">
            <div class="meta-item">
              <label>Date d'émission</label>
              <value>${new Date(doc.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}</value>
            </div>
            ${doc.client ? `
            <div class="meta-item">
              <label>Destinataire</label>
              <value>${doc.client.name}</value>
            </div>` : ''}
            <div class="meta-item">
              <label>Statut</label>
              <value>${statusLabels[doc.status as keyof typeof statusLabels]}</value>
            </div>
          </div>
        </div>

        <div class="content">
          <p style="color:#999; font-style:italic;">Contenu du document — à compléter selon le type de document.</p>
          ${doc.metadata?.notes ? `<p>${doc.metadata.notes}</p>` : ''}
        </div>

        <div class="stamp-area" style="margin-top:40px">
          <div style="font-family:sans-serif; font-size:0.8rem; color:#666; margin-bottom:4px">Signature & Cachet autorisé</div>
          <div class="stamp-box">Signature<br>&nbsp;</div>
        </div>

        <div class="footer">
          <div>HUB Distribution — RCCM: BZV-XXXX-XX — NIF: XXXXXXXXXX</div>
          <div>Document généré le ${new Date().toLocaleDateString('fr-FR')}</div>
        </div>
      </body>
      </html>
    `
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500) }
  }

  return (
    <div>
      <div className="page-header">
        <h2>📄 Gestion des Documents</h2>
        <button className="btn-primary" onClick={() => setShowModal(true)}>+ Nouveau document</button>
      </div>

      <div style={{ padding: '24px 32px' }}>
        {/* Type filters */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {docTypes.map(t => (
            <div key={t.value} style={{ background: 'white', padding: '8px 14px', borderRadius: 8, border: '1px solid #e8e4db', fontSize: '0.8rem', fontWeight: 600 }}>
              {t.icon} {t.label}: <strong>{documents.filter(d => d.type === t.value).length}</strong>
            </div>
          ))}
        </div>

        {/* Table */}
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
          {loading ? <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Chargement...</div> : (
            <table className="hub-table">
              <thead>
                <tr><th>Titre</th><th>Type</th><th>Client</th><th>Statut</th><th>Date</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {documents.map(d => {
                  const typeInfo = docTypes.find(t => t.value === d.type)
                  return (
                    <tr key={d.id}>
                      <td><strong>{d.title}</strong><div style={{ fontSize: '0.72rem', color: '#999', fontFamily: 'monospace' }}>#{d.id.slice(-6).toUpperCase()}</div></td>
                      <td><span className="badge badge-gray">{typeInfo?.icon} {typeInfo?.label}</span></td>
                      <td style={{ color: '#666' }}>{d.client?.name || '—'}</td>
                      <td><span className={`badge ${statusBadge[d.status as keyof typeof statusBadge]}`}>{statusLabels[d.status as keyof typeof statusLabels]}</span></td>
                      <td style={{ color: '#666', fontSize: '0.8rem' }}>{new Date(d.created_at).toLocaleDateString('fr-FR')}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn-primary" style={{ padding: '5px 10px', fontSize: '0.75rem' }} onClick={() => generatePDF(d)}>🖨️ PDF</button>
                          {d.status !== 'sent' && (
                            <button className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem' }} onClick={() => updateStatus(d.id, d.status === 'draft' ? 'generated' : 'sent')}>
                              {d.status === 'draft' ? '✓ Générer' : '📤 Envoyé'}
                            </button>
                          )}
                          <button className="btn-danger" onClick={() => deleteDoc(d.id)}>🗑️</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {documents.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: '#999' }}>Aucun document</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal-box">
            <div className="modal-title">➕ Nouveau document</div>
            <form onSubmit={handleSave}>
              <div className="hub-form-group">
                <label>Titre du document *</label>
                <input className="hub-input" value={form.title} onChange={e => setForm({...form, title: e.target.value})} required placeholder="Ex: Facture mars 2025 — Restaurant Le Palmier" />
              </div>
              <div className="hub-form-group">
                <label>Type de document *</label>
                <select className="hub-select" value={form.type} onChange={e => setForm({...form, type: e.target.value as DocumentType})}>
                  {docTypes.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
                </select>
              </div>
              <div className="hub-form-group">
                <label>Client / Partenaire associé</label>
                <select className="hub-select" value={form.client_id} onChange={e => setForm({...form, client_id: e.target.value})}>
                  <option value="">-- Optionnel --</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="hub-form-group">
                <label>Notes / Contenu</label>
                <textarea className="hub-input" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} rows={4} placeholder="Détails du document..." style={{ resize: 'vertical' }} />
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Création...' : 'Créer & Générer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
