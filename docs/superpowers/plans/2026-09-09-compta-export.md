# Journal mensuel et export CSV Excel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sur `/reports`, choisir un mois, voir le journal des ventes et des encaissements, et exporter deux CSV Excel.

**Architecture:** Pas de table SQL. `buildMonthJournal` dérive les lignes depuis factures + paiements + clients. `toExcelCsv` sérialise `;` + BOM UTF-8. La page serveur lit `?month=YYYY-MM` et un îlot client télécharge les CSV déjà calculés.

**Tech Stack:** Next.js 14.2.5 App Router, Supabase, Node test runner (`node --experimental-strip-types --test`), TypeScript.

## Global Constraints

- Source unique : `invoices` + `invoice_payments` + `clients` — pas de table d’écritures.
- CSV : séparateur `;`, BOM UTF-8, CRLF, décimale virgule, pas de milliers.
- Période : `YYYY-MM` via `?month=` ; ventes = `invoices.date` ; encaissements = `payment_date`.
- Statuts ventes : `approved` | `partial` | `paid` uniquement.
- Hors périmètre : grand livre, achats, avoirs, Sage, portail commandes.
- Tests : `node --experimental-strip-types --test` ; TDD (rouge puis vert).
- UI française, montants FCFA, TVA 18 % déjà sur les factures.

**Spec:** `docs/superpowers/specs/2026-09-09-compta-export-design.md`

---

## File map

| Fichier | Rôle |
|---|---|
| `lib/reports/journal.ts` | Journaux + totaux du mois |
| `lib/reports/journal.test.ts` | TDD journaux |
| `lib/reports/csv.ts` | Sérialisation Excel CSV |
| `lib/reports/csv.test.ts` | TDD CSV |
| `app/(dashboard)/reports/JournalExports.tsx` | Boutons téléchargement |
| `app/(dashboard)/reports/page.tsx` | Sélecteur mois, KPI, tableaux |
| `app/(dashboard)/clients/page.tsx` | Champ NIF |
| `package.json` | Ajouter les deux fichiers test au script `test` |
| `GUIDE-MODULES.md` | Documenter export |
| canvas `audit-fonctionnel-crm.canvas.tsx` | Marquer P2 compta livré (rapports seulement) |

---

### Task 1: `buildMonthJournal`

**Files:**
- Create: `lib/reports/journal.ts`
- Test: `lib/reports/journal.test.ts`

**Interfaces:**
- Consumes: `REVENUE_STATUSES` from `lib/reports/revenue.ts`
- Produces:

```ts
export function resolveMonth(param?: string | null): string // YYYY-MM, sinon mois UTC courant
export function buildMonthJournal(
  invoices: JournalInvoice[],
  clients: JournalClient[],
  payments: JournalPayment[],
  month: string,
): MonthJournal
```

- [ ] **Step 1: Write the failing tests** in `lib/reports/journal.test.ts` covering: facture hors mois exclue ; draft/pending/cancelled exclus ; paiement du mois inclus si facture hors mois ; paiement hors mois exclu ; encaissé = tous les paiements ; solde plancher 0 ; totaux monthHt/monthVat/monthTtc/monthCollected/monthOutstanding ; cumulativeHt toutes périodes ; pendingCount global.

- [ ] **Step 2: Run** `node --experimental-strip-types --test lib/reports/journal.test.ts` — FAIL (module ou assertions).

- [ ] **Step 3: Implement** `lib/reports/journal.ts` per spec (bornes inclusives `YYYY-MM-DD`, tri date puis n°, labels Validée/Partielle/Payée).

- [ ] **Step 4: Re-run tests** — PASS.

- [ ] **Step 5: Commit** only if the user asked (do not commit otherwise).

---

### Task 2: `toExcelCsv`

**Files:**
- Create: `lib/reports/csv.ts`
- Test: `lib/reports/csv.test.ts`

**Interfaces:**
- Consumes: `SalesJournalLine`, `ReceiptJournalLine` from journal.ts
- Produces:

```ts
export const SALES_CSV_HEADERS = ['Date','N°','Client','NIF','Statut','HT','Remise','TVA','TTC','Encaissé','Solde']
export const RECEIPT_CSV_HEADERS = ['Date','N° facture','Client','NIF','Mode','Référence','Montant']
export function formatCsvDate(iso: string): string // JJ/MM/AAAA
export function toExcelCsv(headers: string[], rows: Array<Array<string | number>>): string
export function salesJournalToCsv(lines: SalesJournalLine[]): string
export function receiptsJournalToCsv(lines: ReceiptJournalLine[]): string
export function salesCsvFilename(month: string): string // hub-ventes-YYYY-MM.csv
export function receiptsCsvFilename(month: string): string
```

- [ ] **Step 1: Failing tests** — BOM `\uFEFF` en tête ; `;` ; CRLF ; `1180` sans décimales ; `1180.5` → `1180,50` ; échappement `"` / `;` ; en-têtes FR ; dates `09/09/2026` ; fichier sans lignes = en-têtes seuls.

- [ ] **Step 2: Run** `node --experimental-strip-types --test lib/reports/csv.test.ts` — FAIL.

- [ ] **Step 3: Implement** `lib/reports/csv.ts`.

- [ ] **Step 4: Re-run** — PASS.

---

### Task 3: `/reports` + NIF + docs

**Files:**
- Create: `app/(dashboard)/reports/JournalExports.tsx`
- Modify: `app/(dashboard)/reports/page.tsx`
- Modify: `app/(dashboard)/clients/page.tsx` (`emptyForm` + champ NIF)
- Modify: `package.json` script `test`
- Modify: `GUIDE-MODULES.md` ligne Rapports
- Modify: canvas rapports + todo `p2-acct` (compta livrée, portail commandes reste pending — scinder le libellé)

**Interfaces:**
- Consumes: `resolveMonth`, `buildMonthJournal`, `salesJournalToCsv`, `receiptsJournalToCsv`, filenames
- Page : `searchParams.month` (Next.js 14 server component)

- [ ] **Step 1:** Étendre le fetch invoices (`id, invoice_number, client_id`) + `invoice_payments` + `clients(id, name, tax_id)`.
- [ ] **Step 2:** En-tête : `<form method="get">` + `<input type="month" name="month">`. KPI mois depuis le journal ; garder cumul HT et pending global. Tableaux ventes / encaissements + totaux. `JournalExports` blob download.
- [ ] **Step 3:** Champ NIF optionnel sur le modal clients.
- [ ] **Step 4:** `npm test` — tous verts. Vérifier `/reports` en navigateur si session dispo.

---
