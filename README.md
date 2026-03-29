# 🌿 HUB Distribution — CRM / ERP Léger

Système de gestion intégré pour **HUB Distribution**, entreprise de transformation et distribution agricole en République du Congo.

## 📦 Modules

| Module | Description |
|--------|-------------|
| **Dashboard** | Tableau de bord avec stats temps réel + alertes stock |
| **Clients & Partenaires** | Gestion clients, fournisseurs, institutions |
| **Gestion de Stock** | Produits, entrées/sorties, alertes stock bas |
| **Documents** | Génération & gestion de documents (factures, attestations, BL...) |
| **Recrutement** | Offres d'emploi + suivi des candidatures |
| **Demandes Externes** | Traitement des demandes de documents (DGI, assurances, etc.) |
| **Portail Public** | Interface externe pour partenaires et candidats |

## 🚀 Déploiement rapide

### 1. Créer le projet Supabase
1. Aller sur [supabase.com](https://supabase.com) → New Project
2. Copier l'URL et la clé `anon`
3. Ouvrir l'éditeur SQL → Coller et exécuter `supabase-schema.sql`

### 2. Variables d'environnement
Créer `.env.local` à la racine :
```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxxx...
```

### 3. Déployer sur Vercel
1. Importer le repo GitHub sur [vercel.com](https://vercel.com)
2. Ajouter les variables d'environnement dans le dashboard Vercel
3. Déployer ✅

### 4. Créer le premier compte admin
1. Accéder à `/register` sur l'app déployée
2. Créer un compte
3. Dans Supabase > Table Editor > `profiles`, changer `role` de `employee` à `admin`

## 🛠 Stack technique

- **Frontend & Backend** : Next.js 14 (App Router + API Routes)
- **Base de données** : Supabase (PostgreSQL)
- **Auth** : Supabase Auth (JWT)
- **Styling** : Tailwind CSS
- **PDF** : Génération via impression navigateur (HTML → Print)
- **Déploiement** : Vercel (gratuit)

## 📁 Structure du projet

```
hub-crm/
├── app/
│   ├── (auth)/login/          # Page de connexion
│   ├── (dashboard)/           # Interface interne (protégée)
│   │   ├── dashboard/         # Tableau de bord
│   │   ├── clients/           # Clients & Partenaires
│   │   ├── stock/             # Gestion de stock
│   │   ├── documents/         # Documents & génération PDF
│   │   ├── recruitment/       # Offres & candidatures
│   │   └── requests/          # Demandes externes
│   ├── (portal)/portal/       # Portail public partenaires
│   └── register/              # Inscription
├── components/layout/Sidebar.tsx
├── lib/supabase/              # Clients Supabase
├── types/index.ts             # Types TypeScript
└── supabase-schema.sql        # Schéma BD complet
```

## 🔐 Rôles utilisateurs

| Rôle | Accès |
|------|-------|
| `admin` | Accès complet |
| `employee` | Accès dashboard interne |
| `partner` | Portail externe uniquement |

## 🗄 Tables Supabase

- `profiles` — Utilisateurs + rôles
- `clients` — Clients, fournisseurs, institutions  
- `products` — Catalogue produits agricoles
- `stock_movements` — Entrées/sorties de stock (trigger auto)
- `documents` — Documents générés
- `jobs` — Offres d'emploi
- `candidates` — Candidatures reçues
- `document_requests` — Demandes de documents externes

---

Développé par **Bienvenu KITUTU** — Brazzaville, Congo 🇨🇬
