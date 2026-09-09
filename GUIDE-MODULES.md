# HUB Distribution — Guide des modules

> CRM / ERP leger pour la transformation et distribution agricole.
> Developpe avec Next.js + Supabase.

---

## Vue d'ensemble

```
HUB Distribution CRM
├── Tableau de bord ............ Vue globale + alertes + validations en attente
├── Operations
│   ├── Devis .................. Propositions commerciales
│   ├── Facturation ............ Cycle de vie complet des factures
│   ├── Bons de Livraison ...... Suivi des livraisons
│   ├── Achats & reception ..... Commande fournisseur, lot, entree stock
│   ├── Production ............. Recettes (BOM) + ordres MP → produit fini
│   ├── Qualité ................ Quarantaine / libération / rebut des lots
│   ├── Gestion de Stock ....... Produits, lots, entrees/sorties, alertes
│   ├── Inventaire ............. Comptage physique par lot + écarts
│   ├── Tracabilite lots ....... Rappel lot → client (factures / BL)
│   └── Clients & Partenaires .. Fichier client complet
├── Documents
│   ├── Documents .............. Documents generaux
│   └── Demandes Externes ...... Demandes de partenaires/institutions
├── Ressources Humaines
│   ├── Employes & RH .......... Fiches employes
│   ├── Contrats ............... Generation de contrats de travail
│   ├── Attestations ........... Attestations de travail
│   ├── Fiches de paie ......... Bulletins de salaire
│   ├── Conges ................. Demandes + approbation + soldes
│   └── Recrutement ............ Offres d'emploi + candidatures
├── Notifications .............. Cloche in-app + emails (Resend)
└── Portail Public ............. Interface partenaires/candidats
```

---

## 1. Tableau de bord (`/dashboard`)

Le point d'entree de l'application.

**Ce qu'il affiche :**
- **Statistiques** : nombre de clients, produits en stock, alertes stock bas, documents generes, postes ouverts, demandes en attente
- **Bloc "Validations en attente"** : visible uniquement par les admins/managers. Compte les factures, BL, devis et conges en statut `pending` avec liens directs
- **Alertes stock bas** : produits dont la quantite est en dessous du seuil
- **Derniers mouvements de stock** : entrees/sorties recentes
- **Demandes externes** : dernieres demandes de documents

---

## 2. Devis (`/quotes`)

Propositions commerciales envoyees aux clients.

**Fonctionnalites :**
- Creation d'un devis avec lignes de produits/services, client, remise, TVA
- Workflow : `Brouillon` → `En attente` → `Accepte` / `Refuse` / `Converti`
- **Conversion en facture** : un devis accepte peut etre converti en facture en un clic (toutes les lignes sont copiees)
- Generation PDF

**Notification :** quand un devis passe en `En attente`, les admins/managers recoivent une notification.

---

## 3. Facturation (`/invoices`)

Le module le plus complet. Gere le cycle de vie entier d'une facture.

**Cycle de vie :**

| Statut | Description | Actions possibles |
|--------|-------------|-------------------|
| Brouillon | Facture en cours de redaction, modifiable | Modifier, supprimer, soumettre |
| En attente | Soumise pour validation | Valider, rejeter |
| Validee | Officielle — stock decremente, PDF genere | Envoyer, enregistrer paiement |
| Partiellement payee | Paiements en cours | Enregistrer paiement |
| Payee | Soldee et archivee | — |
| Annulee | Invalidee — stock restaure | — |

**Points cles :**
- La **validation** est le moment decisif : elle declenche le decrement de stock via un trigger SQL
- Seuls les utilisateurs avec `can_validate_invoices = true` peuvent valider
- Les **paiements** sont enregistres individuellement avec methode (virement, especes, etc.) et reference
- Generation de **recus de paiement** PDF pour chaque paiement
- Auto-sauvegarde toutes les 3 secondes en brouillon
- Possibilite de **generer un bon de livraison** depuis une facture validee
- **Lot (optionnel)** sur chaque ligne produit : suggestion FEFO (date de peremption la plus proche). Le lot est copie sur le BL et sur les mouvements de stock a la validation
- **Source unique du CA** : les rapports lisent `invoices` (statuts validee / partielle / payee). L'ancienne page `/sales` redirige vers `/invoices` ; les tables `sales` restent en base pour l'historique.

**Notification :** quand une facture passe en `En attente`, les validateurs recoivent une notification in-app + email.

---

## 4. Bons de Livraison (`/delivery-notes`)

Accompagnent les marchandises livrees au client.

**Fonctionnalites :**
- Creation manuelle ou **depuis une facture** (pre-remplissage automatique des lignes, y compris le lot)
- Workflow : `Brouillon` → `En attente` → `Livre` / `Annule`
- **Stock** : un BL **autonome** (sans facture) decremente le stock a la validation. Un BL **lie a une facture** ne touche pas le stock — la sortie a deja eu lieu a la validation de la facture
- Lien avec la facture d'origine
- Generation PDF avec zone de signature client (n° de lot affiche sur les lignes)

**Notification :** quand un BL passe en `En attente`, notification aux admins/managers.

---

## 5. Achats & reception (`/purchases`)

Cycle fournisseur : commande → reception de matieres premieres.

**Cycle de vie :**

| Statut | Description |
|--------|-------------|
| Brouillon | Saisie en cours |
| Commande | En attente de livraison fournisseur |
| Receptionne | Lot cree, entree de stock |
| Annule | Sortie de stock inverse (si deja receptionne) |

**Points cles :**
- Fournisseur = fiche `clients` de type `fournisseur`
- Chaque ligne peut porter un n° de lot, une date de production et une peremption. Si le lot est vide, il est genere (`ACH-2026-0001-L1`)
- **Receptionner** cree `product_batches` + mouvement `IN` (le trigger `update_product_quantity` met a jour produit et lot)
- Impression d'un bon de reception

---

## 6. Production (`/production`)

Transformation matiere premiere → produit fini.

**Recettes :**
- Un produit fini, une quantite de sortie, et une liste d'ingredients (quantites pour cette sortie)
- Exemple : 10 kg de farine = 12 kg de manioc + 0,2 L d'huile

**Ordres :**
- Choix d'une recette, quantite a produire (les ingredients sont proportionnels)
- Allocation **FEFO** des lots de MP
- **Produire** : sorties de stock MP + creation d'un lot produit fini + entree stock
- Annulation : restauration inverse

---

## 7. Qualité / libération des lots (`/quality`)

Les lots issus d'une **réception d'achat** ou d'une **production** arrivent en quarantaine. Ils ne sont ni vendables ni consommables tant qu'ils ne sont pas libérés.

| Décision | Effet |
|----------|--------|
| Libérer | Le lot devient utilisable (FEFO, facture, BL, production) |
| Rejeter | Rebut : mouvement `OUT`, quantité du lot à 0 |

Les lots déjà en stock avant ce module restent **libérés**.

---

## 8. Gestion de Stock (`/stock`)

Suivi des produits et de leurs mouvements.

**Fonctionnalites :**
- Liste des produits avec quantite actuelle, seuil d'alerte, prix unitaire
- Lots (`product_batches`) : numero, quantite, dates de production / peremption, fournisseur, **statut qualité**
- Enregistrement des mouvements (entree/sortie) avec motif, reference et `batch_id`
- Les mouvements lies aux factures, aux BL autonomes, aux **receptions d'achat** et aux **ordres de production** sont **automatiques** (via triggers SQL) et portent le lot de la ligne
- Alerte visuelle quand un produit passe sous le seuil, lots expires / a 30 jours
- Impression de bons d'entree/sortie stock
- **Inventaire physique** (`/stock/inventory`) : comptage par lot (et hors-lot). L'ecart valide cree un mouvement `ADJUST`
- **Conditionnements** : sur la fiche produit (ex. 1 sac = 50 kg). Facture, BL et achat convertissent vers l'unite de base

### Tracabilite / rappel (`/stock/recall`)

Repond a « ce lot est parti chez qui ? ».

- Recherche par n° de lot ou produit
- Clients concernes (factures et BL, hors brouillon / rejete / annule)
- Genealogie des documents + historique des mouvements du lot
- Impression d'une fiche de rappel

---

## 9. Clients & Partenaires (`/clients`)

Fichier client complet.

**Fonctionnalites :**
- Types : client, fournisseur, institution, partenaire
- Fiche detaillee : nom, email, telephone, adresse, type
- Historique financier (factures, montants payes, solde du)

---

## 10. Contrats de travail (`/hr/contracts`)

**Fonctionnalites :**
- Liste des contrats filtrables par employe et type (CDI, CDD, stage, freelance)
- Modale de generation avec champs structures : employe, poste, salaire, dates, clauses
- Les donnees sont stockees en JSON dans `employee_documents.content`
- Generation PDF avec en-tete HUB Distribution, articles, signatures

---

## 11. Attestations de travail (`/hr/certificates`)

**Fonctionnalites :**
- Selection d'un employe, contenu pre-rempli automatiquement
- Formule officielle : "Je soussigne, Directeur General de HUB Distribution, certifie que..."
- Generation PDF officielle

---

## 12. Fiches de paie (`/hr/payslips`)

**Fonctionnalites :**
- Selection employe + mois/annee
- Rubriques detaillees : salaire de base, primes (transport, logement, performance), deductions (CNSS, ITS)
- Calculs automatiques en temps reel
- Generation PDF bulletin de paie structure

---

## 13. Conges (`/hr/leaves`)

**Fonctionnalites :**
- KPIs : demandes en attente, approuvees ce mois, soldes faibles
- Soumission de demande : employe, type (annuel, maladie, sans solde, exceptionnel, maternite), dates, motif
- Calcul automatique des jours ouvres
- Workflow : `En attente` → `Approuve` / `Refuse`
- L'approbation met a jour automatiquement le **solde de conges** de l'employe (via trigger SQL)
- Onglet "Soldes conges" : vue par employe du total/utilise/restant

**Notification :** quand une demande est soumise, les admins/managers recoivent une notification.

---

## 14. Systeme de Notifications

Deux canaux complementaires :

### In-app (cloche)
- Icone cloche dans le header avec badge rouge (nombre de non lues)
- Dropdown avec les 15 dernieres notifications
- Clic = marquer comme lu + redirection vers le document
- Rafraichissement automatique toutes les 30 secondes

### Email (Resend)
- Envoi automatique aux validateurs quand un document passe en `pending`
- Email HTML avec bouton "Voir le document"

### Qui recoit quoi ?
| Type de document | Destinataires |
|-----------------|---------------|
| Facture | Utilisateurs avec `can_validate_invoices = true` |
| Devis, BL, Conge | Utilisateurs avec role `admin`, `ceo` ou `manager` |

---

## 15. Autres modules

| Module | Description |
|--------|-------------|
| **Documents** (`/documents`) | Documents generaux de l'entreprise |
| **Demandes Externes** (`/requests`) | Demandes de documents par des tiers (DGI, assurances, banques) |
| **Recrutement** (`/recruitment`) | Offres d'emploi et suivi des candidatures |
| **Rapports** (`/reports`) | KPI du mois, journal des ventes et des encaissements, export CSV Excel |
| **Portail Public** (`/portal`) | Interface externe pour partenaires et candidats |

---

## Architecture technique

| Composant | Technologie |
|-----------|-------------|
| Frontend & Backend | Next.js 14 (App Router) |
| Base de donnees | Supabase (PostgreSQL) |
| Authentification | Supabase Auth (JWT) |
| Emails | Resend API |
| PDF | Generation HTML → impression navigateur |
| Deploiement | Vercel |

### Base de donnees — Tables principales

| Table | Role |
|-------|------|
| `profiles` | Utilisateurs, roles, permissions |
| `clients` | Clients, fournisseurs, partenaires |
| `products` | Catalogue produits |
| `product_batches` | Lots (n°, peremption, quantite, statut qualité) |
| `quality_checks` | Contrôles de libération / rebut |
| `product_units` | Conditionnements (facteur vers unité de base) |
| `inventory_sessions` | Séances d'inventaire physique |
| `inventory_lines` | Comptage par lot / hors-lot |
| `stock_movements` | Entrees/sorties de stock (avec `batch_id`) |
| `invoices` | Factures |
| `invoice_items` | Lignes de facture (avec `batch_id`) |
| `invoice_payments` | Paiements recus |
| `purchases` | Achats / receptions fournisseur |
| `purchase_items` | Lignes d'achat (lot, peremption) |
| `recipes` | Recettes / nomenclatures |
| `recipe_items` | Ingredients d'une recette |
| `production_orders` | Ordres de production |
| `production_order_items` | MP consommees (lots FEFO) |
| `documents` | Devis, BL, documents generaux |
| `document_items` | Lignes de devis/BL (avec `batch_id`) |
| `employees` | Employes |
| `employee_documents` | Contrats, attestations, fiches de paie, conges |
| `leave_balances` | Soldes de conges par employe/annee |
| `notifications` | Notifications in-app |
| `jobs` | Offres d'emploi |
| `candidates` | Candidatures |
| `document_requests` | Demandes de documents externes |

### Migrations SQL a executer (dans l'ordre)

1. `supabase-schema.sql` — Schema de base
2. `supabase-migration-v2.sql` — Evolutions v2
3. `supabase-migration-invoices.sql` — Module facturation
4. `supabase-migration-invoice-workflow.sql` — Workflow validation factures
5. `supabase-migration-documents-ecosystem.sql` — Ecosysteme documents (devis, BL)
6. `supabase-migration-hr-documents.sql` — Documents RH (contrats, conges, etc.)
7. `supabase-migration-notifications.sql` — Systeme de notifications

Patches (bases deja deployees) :

8. `fix-single-stock-exit.sql` — Un BL lie a une facture ne touche plus le stock
9. `fix-first-user-admin.sql` — Premier compte = admin + RPC `profiles_exist` (protege `/register`)
10. `fix-batch-traceability.sql` — `batch_id` sur lignes facture/BL + sorties stock par lot
11. `fix-purchases-receipt.sql` — Tables achats + reception = lot + entree stock
12. `fix-production-bom.sql` — Recettes + ordres de production (MP → PF)
13. `fix-quality-haccp.sql` — Quarantaine / libération / rebut des lots
14. `fix-inventory-units.sql` — Inventaire physique + conditionnements

Patches audit septembre 2026 (apres 1-14, dans l'ordre) :

15. `fix-warehouses.sql` — Multi-entrepot : table warehouses + rattachement lots/mouvements + RPC transfert
16. `fix-inventory-freeze.sql` — Gel stock pendant inventaire + comptage a l'aveugle
17. `fix-quality-coa.sql` — CCP / COA labo (quality_coa, quality_ccp) + bucket quality-coa
18. `fix-production-yield.sql` — Rendement production (quantite reelle obtenue)
19. `fix-purchase-payments.sql` — Paiements fournisseur (purchase_payments) + soldes
20. `fix-clients-file.sql` — Fiche partenaire complete (RCCM, ville, contact, actif...)
21. `fix-quotes-extra.sql` — Devis : conversion atomique, notifications, bucket devis-pdf
22. `fix-delivery-notes-extra.sql` — BL : garde etendue, restauration a l'annulation
23. `fix-documents-register.sql` — Documents generaux : registre + PDF + bucket general-documents
24. `fix-requests-respond.sql` — Demandes externes : renvoi fichier (bucket public request-responses)
25. `fix-portal-orders.sql` — Portail : catalogue (is_catalog) + commandes (portal_orders)
26. `fix-candidates-cv.sql` — Recrutement : bucket cvs pour CV
27. `fix-employee-selfservice.sql` — Conges self-service : policies RLS self_* + user_id employes

---

## Roles et permissions

| Role | Acces |
|------|-------|
| `admin` | Acces complet a tous les modules |
| `ceo` | Acces complet + validation |
| `manager` | Gestion equipe + validation documents |
|   `employee` | Acces dashboard interne |
|   `partner` | Portail externe uniquement (middleware : pas d'acces dashboard) |

**Permission speciale** : `can_validate_invoices` (booleen sur `profiles`) donne le droit de valider les factures independamment du role.

---

## Évolutions septembre 2026 — audit fonctionnel 9/10

Revue complete des 23 modules (audit : scores /10) : les lacunes relevees ont ete
comblees. A deployer : executer les nouveaux patches SQL listes ci-dessous (section
"Migrations a executer"), dans l'ordre, sur la base Supabase.

| Module | Evolution livree |
|--------|------------------|
| Devis | Workflow durci : rejet avec motif, date de validite + badge expire, conversion devis→facture **atomique** (fonction SQL `convert_quote_to_invoice`, anti-doublon), PDF archive (bucket `devis-pdf`), notifications `quote_approved/rejected/converted` |
| Facturation | (deja 9/10 — conserve) |
| Bons de livraison | Garde SQL etendue aux deux types de BL (`bon_livraison` / `bon_de_livraison`), restauration stock a l'annulation d'un BL autonome, motif de rejet, reception signee |
| Achats | Paiements fournisseur (`purchase_payments`) + badges Impayee/Partielle/Payee + soldes fournisseurs |
| Production | Rendement : quantite reellement obtenue, % rendement, notes de pertes, annulation au juste quantite |
| Qualite | CCP (controles points critiques HACCP) + COA labo (`quality_coa`/`quality_ccp`) avec certificat d'analyse PDF archive |
| Stock | **Multi-entrepot** : table `warehouses`, lots rattaches a un entrepot, transfert entre entrepots (RPC `transfer_batch`), vue stock par entrepot |
| Inventaire | **Gel du stock** pendant une seance (trigger garde) + **comptage a l'aveugle** (colonne `blind`, reveil des ecarts par un manager) |
| Clients | Fiche partenaire complete : RCCM, ville, site web, contact, termes de paiement, plafond, actif/inactif + page detail avec historique financier (factures, encaissements, achats, documents) |
| Tableau de bord | Centre de commande : alertes qualite/quarantaine + lots a peremption proche, activite recente, KPIs gated par role (employee = vue operationnelle sans finance) |
| Rapports | **Grand livre simplifie** : auxiliaires 411 clients / 401 fournisseurs (debit, credit, solde courant) + export CSV Excel |
| Documents generaux | Vrai module : categories (lettre, note de service, PV, rapport, convention...), reference `DOC-…`, PDF officiel jsPDF genere et archive (bucket `general-documents`), cycle envoye/archive |
| Demandes externes | Reponse avec fichier + **renvoi au demandeur par email** (lien de telechargement public), trace `email_sent_at` |
| Portail public | **Catalogue produits + commande** (panier, `portal_orders`) + page interne "Commandes portail" pour le suivi |
| Employes | Correction types TS + liaison employe ↔ compte utilisateur (endpoint admin `link-employee`, invite si cle service) |
| Contrats / Attestations / Fiches de paie | (deja 8/10 — conserves) |
| Conges | **Self-service salarie** : page "Mes congés" (`/me/conges`) — soldes, demande, suivi — policies RLS `self_*` etroites |
| Recrutement | Upload CV branche sur le storage (bucket `cvs`), apercu/telechargement, correction types TS |
| Roles | Gestion statut actif/inactif, garde-fous (pas d'auto-demotion, dernier admin protege), recherche |
| Notifications | Cloche robuste : nouveaux types devis, "Tout marquer comme lu", compteur reel, fallback types inconnus |
| Authentification | **Reset de mot de passe** complet (`/forgot-password` → email → `/reset-password`), routes publiques middleware |

**Deploiement** : projet Supabase lie au CLI (`supabase link` — ref `wckiopvkmcoulcnwbjaw`, fichier `supabase/config.toml`). Les 13 patches
audit (versions `20260909160000`…`20260909160012`) ont ete appliques sur la base distante le 09/09/2026 via `supabase db push --linked`
et sont conserves sous `supabase/migrations/`. La base distante divergeait du setup.sql (colonnes `documents.content`/`updated_at`,
`clients.tax_id`, `employees.user_id`, `document_requests.handled_by` absentes) : les patches ont ete rendus autosuffisants
(`ADD COLUMN IF NOT EXISTS`) pour couvrir les deux cas. Remarque : pour toute nouvelle migration, preferer
`gen_random_uuid()` (natif) a `uuid_generate_v4()` (extension `uuid-ossp` hors search_path du role de migration CLI).


---

## Prochaines etapes

### Court terme (prioritaire)

- [ ] **Executer les migrations SQL** dans Supabase (SQL Editor) dans l'ordre indique ci-dessus, plus les patches `fix-single-stock-exit.sql`, `fix-first-user-admin.sql`, `fix-batch-traceability.sql`, `fix-purchases-receipt.sql`, `fix-production-bom.sql`, `fix-quality-haccp.sql` et `fix-inventory-units.sql`
- [ ] **Configurer le domaine Resend** : verifier un domaine d'envoi (ex: `hubdistribution.com`) dans le dashboard Resend pour que les emails partent correctement
- [ ] **Creer le premier compte admin** : `/register` n'est ouvert que s'il n'existe aucun profil ; le premier compte est admin. Ensuite desactiver « Allow new users to sign up » dans Supabase Auth
- [ ] **Tester le workflow complet** : creer une facture brouillon → soumettre → verifier la notification → valider → enregistrer un paiement

### Moyen terme (ameliorations)

- [ ] **Facture proforma** : variante non officielle de la facture, utilisee avant paiement
- [ ] **Rapports avances** : chiffre d'affaires par mois, par client, par produit ; marge beneficiaire
- [ ] **Tableau de bord financier** : tresorerie, encaissements/decaissements, previsions
- [ ] **Rapport d'inventaire** : etat reel du stock vs theorique

### Long terme (vision produit)

- [ ] **Application mobile** (React Native ou PWA) pour les agents terrain
- [ ] **Multi-entreprise** : gerer plusieurs societes depuis une seule instance
- [x] **Journal des ventes / encaissements** : mois sur `/reports`, export CSV Excel (`;`, UTF-8 BOM)
- [ ] **Comptabilite** : grand livre, bilan simplifie
- [ ] **Integration bancaire** : rapprochement automatique des paiements
- [ ] **Paiements fournisseurs** : factures d'achat, echeances, rapprochement
- [ ] **Export logiciel** : mapping Sage / Ciel / EBP

---

*Developpe par **Bienvenu KITUTU** — Brazzaville, Congo 🇨🇬*
