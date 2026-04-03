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
│   ├── Commandes / Ventes ..... Historique des ventes
│   ├── Gestion de Stock ....... Produits, entrees/sorties, alertes
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

**Notification :** quand une facture passe en `En attente`, les validateurs recoivent une notification in-app + email.

---

## 4. Bons de Livraison (`/delivery-notes`)

Accompagnent les marchandises livrees au client.

**Fonctionnalites :**
- Creation manuelle ou **depuis une facture** (pre-remplissage automatique des lignes)
- Workflow : `Brouillon` → `En attente` → `Livre` / `Annule`
- La validation (passage a `Livre`) **decremente le stock** via un trigger SQL
- Lien avec la facture d'origine
- Generation PDF avec zone de signature client

**Notification :** quand un BL passe en `En attente`, notification aux admins/managers.

---

## 5. Gestion de Stock (`/stock`)

Suivi des produits et de leurs mouvements.

**Fonctionnalites :**
- Liste des produits avec quantite actuelle, seuil d'alerte, prix unitaire
- Enregistrement des mouvements (entree/sortie) avec motif et reference
- Les mouvements lies aux factures et BL sont **automatiques** (via triggers SQL)
- Alerte visuelle quand un produit passe sous le seuil
- Impression de bons d'entree/sortie stock

---

## 6. Clients & Partenaires (`/clients`)

Fichier client complet.

**Fonctionnalites :**
- Types : client, fournisseur, institution, partenaire
- Fiche detaillee : nom, email, telephone, adresse, type
- Historique financier (factures, montants payes, solde du)

---

## 7. Contrats de travail (`/hr/contracts`)

**Fonctionnalites :**
- Liste des contrats filtrables par employe et type (CDI, CDD, stage, freelance)
- Modale de generation avec champs structures : employe, poste, salaire, dates, clauses
- Les donnees sont stockees en JSON dans `employee_documents.content`
- Generation PDF avec en-tete HUB Distribution, articles, signatures

---

## 8. Attestations de travail (`/hr/certificates`)

**Fonctionnalites :**
- Selection d'un employe, contenu pre-rempli automatiquement
- Formule officielle : "Je soussigne, Directeur General de HUB Distribution, certifie que..."
- Generation PDF officielle

---

## 9. Fiches de paie (`/hr/payslips`)

**Fonctionnalites :**
- Selection employe + mois/annee
- Rubriques detaillees : salaire de base, primes (transport, logement, performance), deductions (CNSS, ITS)
- Calculs automatiques en temps reel
- Generation PDF bulletin de paie structure

---

## 10. Conges (`/hr/leaves`)

**Fonctionnalites :**
- KPIs : demandes en attente, approuvees ce mois, soldes faibles
- Soumission de demande : employe, type (annuel, maladie, sans solde, exceptionnel, maternite), dates, motif
- Calcul automatique des jours ouvres
- Workflow : `En attente` → `Approuve` / `Refuse`
- L'approbation met a jour automatiquement le **solde de conges** de l'employe (via trigger SQL)
- Onglet "Soldes conges" : vue par employe du total/utilise/restant

**Notification :** quand une demande est soumise, les admins/managers recoivent une notification.

---

## 11. Systeme de Notifications

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

## 12. Autres modules

| Module | Description |
|--------|-------------|
| **Commandes / Ventes** (`/sales`) | Historique des commandes et ventes |
| **Documents** (`/documents`) | Documents generaux de l'entreprise |
| **Demandes Externes** (`/requests`) | Demandes de documents par des tiers (DGI, assurances, banques) |
| **Recrutement** (`/recruitment`) | Offres d'emploi et suivi des candidatures |
| **Rapports** (`/reports`) | Rapports et statistiques |
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
| `stock_movements` | Entrees/sorties de stock |
| `invoices` | Factures |
| `invoice_items` | Lignes de facture |
| `invoice_payments` | Paiements recus |
| `documents` | Devis, BL, documents generaux |
| `document_items` | Lignes de devis/BL |
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

---

## Roles et permissions

| Role | Acces |
|------|-------|
| `admin` | Acces complet a tous les modules |
| `ceo` | Acces complet + validation |
| `manager` | Gestion equipe + validation documents |
| `employee` | Acces dashboard interne |
| `partner` | Portail externe uniquement |

**Permission speciale** : `can_validate_invoices` (booleen sur `profiles`) donne le droit de valider les factures independamment du role.

---

## Prochaines etapes

### Court terme (prioritaire)

- [ ] **Executer les migrations SQL** dans Supabase (SQL Editor) dans l'ordre indique ci-dessus
- [ ] **Configurer le domaine Resend** : verifier un domaine d'envoi (ex: `hubdistribution.com`) dans le dashboard Resend pour que les emails partent correctement
- [ ] **Creer le premier compte admin** : s'inscrire via `/register`, puis changer le `role` a `admin` dans la table `profiles` via Supabase
- [ ] **Tester le workflow complet** : creer une facture brouillon → soumettre → verifier la notification → valider → enregistrer un paiement

### Moyen terme (ameliorations)

- [ ] **Bon de commande** : ajouter un module commandes fournisseurs (achat de matieres premieres)
- [ ] **Facture proforma** : variante non officielle de la facture, utilisee avant paiement
- [ ] **Rapports avances** : chiffre d'affaires par mois, par client, par produit ; marge beneficiaire
- [ ] **Tableau de bord financier** : tresorerie, encaissements/decaissements, previsions
- [ ] **Module production** : ordres de production, fiches de transformation (matiere premiere → produit fini)
- [ ] **Rapport d'inventaire** : etat reel du stock vs theorique

### Long terme (vision produit)

- [ ] **Application mobile** (React Native ou PWA) pour les agents terrain
- [ ] **Multi-entreprise** : gerer plusieurs societes depuis une seule instance
- [ ] **Comptabilite** : journal des ventes, grand livre, bilan simplifie
- [ ] **Integration bancaire** : rapprochement automatique des paiements
- [ ] **Module fournisseurs** : gestion complete du cycle d'achat
- [ ] **Export comptable** : export CSV/Excel compatible avec les logiciels comptables locaux

---

*Developpe par **Bienvenu KITUTU** — Brazzaville, Congo 🇨🇬*
