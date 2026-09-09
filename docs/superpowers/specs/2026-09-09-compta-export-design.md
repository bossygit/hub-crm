# Compta / export — journal mensuel et CSV Excel

Date : 2026-09-09  
Statut : validé (design)  
Périmètre : P2 canvas « Compta / export » uniquement. Portail commandes reporté.

## Objectif

Permettre à l’expert-comptable / DGI d’exporter le mois : journal des ventes et journal des encaissements, en CSV ouvrable dans Excel Congo, sans grand livre ni logiciel comptable dédié.

## Décisions figées

- Pas de table d’écritures. Source = `invoices` + `invoice_items` (non requis pour les totaux) + `invoice_payments` + `clients`.
- CSV Excel : séparateur `;`, UTF-8 avec BOM (`U+FEFF`), fin de ligne CRLF, décimale virgule, pas de séparateur de milliers.
- Période = un mois calendaire (`YYYY-MM`) via `?month=` sur `/reports`.
- Ventes datées à `invoices.date`. Encaissements datés à `invoice_payments.payment_date`.
- Statuts ventes : `approved`, `partial`, `paid` uniquement (`REVENUE_STATUSES`). Brouillon, `pending`, `cancelled` exclus.
- Hors périmètre : grand livre, bilan, achats, avoirs (`credit_notes`), Sage/Ciel/EBP, plage de dates libre, portail commandes, rôle comptable dédié.

## Unités

### 1. `lib/reports/journal.ts`

Construit les deux journaux et les totaux du mois.

Entrée :

- factures : `id`, `invoice_number`, `date`, `status`, `subtotal`, `discount`, `tax_amount`, `total`, `client_id`
- clients : `id`, `name`, `tax_id`
- paiements : `invoice_id`, `amount`, `payment_date`, `method`, `reference`

Mois : chaîne `YYYY-MM`. Bornes inclusives : `date >= YYYY-MM-01` et `date <= dernier jour du mois`. Comparaison sur la partie date ISO (`YYYY-MM-DD`), pas l’heure.

**Journal ventes** : factures dont le statut est dans `REVENUE_STATUSES` et dont `date` est dans le mois.

Pour chaque ligne :

| Champ | Règle |
|---|---|
| Date | `invoices.date` |
| N° | `invoice_number` |
| Client | `clients.name` ou chaîne vide |
| NIF | `clients.tax_id` ou chaîne vide |
| Statut | libellé FR : Validée / Partielle / Payée |
| HT | `subtotal - discount` |
| Remise | `discount` |
| TVA | `tax_amount` |
| TTC | `total` |
| Encaissé | somme de **tous** les `invoice_payments.amount` de cette facture (toutes dates) |
| Solde | `max(0, TTC - Encaissé)` |

Tri : date croissante, puis n° de facture.

**Journal encaissements** : paiements dont `payment_date` est dans le mois, **y compris** si la facture est d’un autre mois. Si la facture liée est introuvable, la ligne reste (n° / client / NIF vides).

| Champ | Règle |
|---|---|
| Date | `payment_date` |
| N° facture | `invoice_number` de la facture liée |
| Client | nom du client de la facture |
| NIF | `tax_id` du client |
| Mode | `method` |
| Référence | `reference` ou vide |
| Montant | `amount` |

Tri : date croissante, puis n° de facture.

**Totaux du mois**

- `monthHt` : somme HT des lignes ventes
- `monthTtc` : somme TTC des lignes ventes
- `monthVat` : somme TVA des lignes ventes
- `monthCollected` : somme des montants du journal encaissements
- `monthOutstanding` : somme des soldes du journal ventes
- `cumulativeHt` : HT de **toutes** les factures `REVENUE_STATUSES`, toutes périodes (comportement actuel du KPI cumul)
- `pendingCount` : nombre de factures `pending`, toutes périodes (file de validation, pas le mois)

`computeInvoiceRevenue` existant continue de servir le cumul et le pending. Les totaux mensuels HT/TVA viennent du journal (aujourd’hui HT et TVA sont en cumul, seul le TTC est mensuel). Après ce changement, les cartes CA HT / TVA / TTC du mois sur `/reports` utilisent `monthHt` / `monthVat` / `monthTtc`.

### 2. `lib/reports/csv.ts`

`toExcelCsv(headers: string[], rows: Array<Array<string | number>>): string`

- Préfixe BOM UTF-8
- Première ligne = en-têtes
- Champs séparés par `;`
- Nombre : chaîne FR sans milliers, virgule décimale, 0 décimales si entier, sinon jusqu’à 2
- Texte contenant `;`, `"` ou saut de ligne : entouré de `"` avec `"` doublé
- CRLF entre les lignes, y compris après la dernière
- Fichier vide de données : en-têtes seuls (toujours exportable)

En-têtes ventes : `Date;N°;Client;NIF;Statut;HT;Remise;TVA;TTC;Encaissé;Solde`  
En-têtes encaissements : `Date;N° facture;Client;NIF;Mode;Référence;Montant`

Dates dans le CSV : `JJ/MM/AAAA`.

Noms de fichiers : `hub-ventes-YYYY-MM.csv` et `hub-encaissements-YYYY-MM.csv`.

### 3. `/reports`

Rôles inchangés (`ceo`, `manager`, `admin` via sidebar / `canAccessPath`).

- Query `month=YYYY-MM`. Absent ou invalide → mois de `new Date()` côté serveur (UTC sur Vercel ; en heures ouvrables WAT le calendrier Congo est le même).
- Sélecteur mois + année dans l’en-tête : GET (changement d’URL), pas de persistance.
- Cartes KPI : CA HT du mois, CA TTC du mois, TVA du mois, encaissé du mois, solde ouvert du mois, plus CA cumulé HT toutes périodes. La carte « factures en validation » reste le `pendingCount` global.
- Tableau journal des ventes (colonnes CSV) + ligne totaux. Tableau encaissements en dessous + totaux.
- Boutons « Export ventes CSV » et « Export encaissements CSV » : téléchargent le CSV calculé **sur les mêmes lignes affichées** (pas un second calcul serveur).
- Blocs existants (stock bas, péremptions, mouvements, documents en attente) : inchangés. Les mouvements « ce mois » restent le mois calendaire **courant**, pas le mois comptable choisi.

### 4. Clients — NIF

`clients.tax_id` existe en base, absent du formulaire.

- Champ « NIF » optionnel sur création / édition (`app/(dashboard)/clients/page.tsx`).
- Pas de validation de format (NIF Congo variable).
- Pas de migration SQL.

## Erreurs et cas limites

- Mois sans ventes ni paiements : tableaux vides, KPI à 0, CSV avec en-têtes seulement.
- Facture sans client : Client et NIF vides.
- Paiement orphelin : ligne encaissement avec n° / client / NIF vides.
- Solde négatif (trop-perçu) : affiché 0 sur la ligne vente ; le trop-perçu reste visible dans le journal encaissements.
- Pas de message d’erreur export : le bouton déclenche toujours un téléchargement.

## Tests (`lib/reports/journal.test.ts`, `lib/reports/csv.test.ts`)

- Facture hors mois exclue du journal ventes.
- Facture `draft` / `pending` / `cancelled` exclue même dans le mois.
- Paiement dans le mois inclus si la facture est d’un autre mois.
- Paiement hors mois exclu du journal encaissements même si la facture est du mois.
- Encaissé d’une ligne vente = somme de tous les paiements de la facture ; solde = TTC − encaissé (plancher 0).
- CSV commence par BOM, utilise `;`, virgule décimale, CRLF.
- En-têtes FR exacts.

## Hors spec (ne pas implémenter)

- Portail commandes / catalogue partenaire
- Grand livre, journaux d’achats, lettrage bancaire
- Export Sage / Ciel / EBP
- Avoirs
- Filtre par client ou par produit
- Gel de période / clôture d’exercice
