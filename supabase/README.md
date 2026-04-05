# HUB Distribution CRM — Configuration Supabase

## Installation initiale

### 1. Créer un projet Supabase

1. Aller sur [supabase.com](https://supabase.com) et créer un compte
2. Créer un nouveau projet (région recommandée : **EU West / Frankfurt** pour l'Afrique Centrale)
3. Noter les informations suivantes :
   - **Project URL** (`NEXT_PUBLIC_SUPABASE_URL`)
   - **Anon Key** (`NEXT_PUBLIC_SUPABASE_ANON_KEY`)
   - **Service Role Key** (`SUPABASE_SERVICE_ROLE_KEY`) — ne jamais exposer côté client

### 2. Exécuter le schéma SQL

1. Ouvrir le **SQL Editor** dans le dashboard Supabase
2. Copier le contenu intégral de `setup.sql`
3. Exécuter — toutes les tables, fonctions, triggers et policies seront créés

### 3. Configurer le Storage

Dans le dashboard Supabase → **Storage** :

1. Créer le bucket `invoices-pdf` (privé)
2. Créer le bucket `documents` (privé)
3. Pour chaque bucket, ajouter les policies :
   - **SELECT** : `auth.role() = 'authenticated'`
   - **INSERT** : `auth.role() = 'authenticated'`
   - **UPDATE** : `auth.role() = 'authenticated'`

### 4. Variables d'environnement

Créer un fichier `.env.local` à la racine du projet :

```env
NEXT_PUBLIC_SUPABASE_URL=https://votre-projet.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...votre-anon-key
SUPABASE_SERVICE_ROLE_KEY=eyJ...votre-service-role-key
NEXT_PUBLIC_APP_URL=http://localhost:3000
RESEND_API_KEY=re_votre-cle-resend
```

### 5. Créer le premier administrateur

Après inscription du premier utilisateur :

```sql
UPDATE profiles SET role = 'ceo', can_validate_invoices = true
WHERE full_name = 'Nom Du Dirigeant';
```

## Structure des rôles

| Rôle | Accès |
|------|-------|
| `ceo` | Accès complet, validation factures |
| `manager` | RH, rapports, opérations |
| `admin` | RH, rapports, opérations, validation factures |
| `employee` | Opérations courantes uniquement |
| `partner` | Portail externe uniquement |

## Fichiers archivés

Les migrations originales sont conservées dans `supabase/archive/` pour référence.
Le fichier `setup.sql` les consolide et les remplace.
