-- =====================================================
-- HUB Distribution CRM — Schéma Supabase
-- À exécuter dans l'éditeur SQL de Supabase
-- =====================================================

-- Activer UUID
create extension if not exists "uuid-ossp";

-- =====================================================
-- TABLE: profiles (liée à auth.users)
-- =====================================================
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  role text not null default 'employee' check (role in ('admin', 'employee', 'partner')),
  department text,
  created_at timestamptz default now()
);

alter table profiles enable row level security;

create policy "Profiles: lecture par tous les authentifiés"
  on profiles for select using (auth.role() = 'authenticated');

create policy "Profiles: mise à jour par le propriétaire"
  on profiles for update using (auth.uid() = id);

-- Trigger: créer profil automatiquement à l'inscription
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, full_name, role)
  values (new.id, new.raw_user_meta_data->>'full_name', 'employee');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- =====================================================
-- TABLE: clients
-- =====================================================
create table clients (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  type text not null default 'client' check (type in ('client', 'fournisseur', 'institution')),
  email text,
  phone text,
  address text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table clients enable row level security;
create policy "Clients: tous les authentifiés" on clients for all using (auth.role() = 'authenticated');

-- =====================================================
-- TABLE: products
-- =====================================================
create table products (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  category text not null default 'Général',
  quantity numeric not null default 0,
  unit text not null default 'kg',
  threshold_alert numeric not null default 10,
  price_per_unit numeric,
  description text,
  created_at timestamptz default now()
);

alter table products enable row level security;
create policy "Products: tous les authentifiés" on products for all using (auth.role() = 'authenticated');

-- =====================================================
-- TABLE: stock_movements
-- =====================================================
create table stock_movements (
  id uuid default uuid_generate_v4() primary key,
  product_id uuid references products(id) on delete cascade,
  type text not null check (type in ('IN', 'OUT')),
  quantity numeric not null,
  reason text,
  user_id uuid references profiles(id),
  date date default current_date,
  created_at timestamptz default now()
);

alter table stock_movements enable row level security;
create policy "Movements: tous les authentifiés" on stock_movements for all using (auth.role() = 'authenticated');

-- Trigger: mettre à jour la quantité du produit
create or replace function update_product_quantity()
returns trigger language plpgsql as $$
begin
  if NEW.type = 'IN' then
    update products set quantity = quantity + NEW.quantity where id = NEW.product_id;
  elsif NEW.type = 'OUT' then
    update products set quantity = quantity - NEW.quantity where id = NEW.product_id;
  end if;
  return NEW;
end;
$$;

create trigger after_stock_movement
  after insert on stock_movements
  for each row execute function update_product_quantity();

-- =====================================================
-- TABLE: documents
-- =====================================================
create table documents (
  id uuid default uuid_generate_v4() primary key,
  title text not null,
  type text not null check (type in ('facture', 'bon_de_livraison', 'attestation', 'contrat', 'document_administratif', 'autre')),
  client_id uuid references clients(id) on delete set null,
  file_url text,
  status text not null default 'draft' check (status in ('draft', 'generated', 'sent')),
  created_by uuid references profiles(id),
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

alter table documents enable row level security;
create policy "Documents: tous les authentifiés" on documents for all using (auth.role() = 'authenticated');

-- =====================================================
-- TABLE: jobs (offres d'emploi)
-- =====================================================
create table jobs (
  id uuid default uuid_generate_v4() primary key,
  title text not null,
  department text not null,
  description text not null,
  requirements text,
  location text default 'Brazzaville',
  type text not null check (type in ('cdi', 'cdd', 'stage', 'freelance')),
  status text not null default 'open' check (status in ('open', 'closed', 'archived')),
  deadline date,
  created_at timestamptz default now()
);

alter table jobs enable row level security;
create policy "Jobs: lecture publique" on jobs for select using (true);
create policy "Jobs: modification par authentifiés" on jobs for all using (auth.role() = 'authenticated');

-- =====================================================
-- TABLE: candidates
-- =====================================================
create table candidates (
  id uuid default uuid_generate_v4() primary key,
  job_id uuid references jobs(id) on delete cascade,
  name text not null,
  email text not null,
  phone text,
  cv_url text,
  cover_letter text,
  status text not null default 'nouveau' check (status in ('nouveau', 'en_cours', 'entretien', 'accepte', 'refuse')),
  notes text,
  created_at timestamptz default now()
);

alter table candidates enable row level security;
create policy "Candidates: lecture/création publique" on candidates for select using (true);
create policy "Candidates: insertion publique" on candidates for insert with check (true);
create policy "Candidates: update par authentifiés" on candidates for update using (auth.role() = 'authenticated');

-- =====================================================
-- TABLE: document_requests (portail partenaires)
-- =====================================================
create table document_requests (
  id uuid default uuid_generate_v4() primary key,
  requester_name text not null,
  organization text not null,
  email text not null,
  phone text,
  document_type text not null,
  description text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'approved', 'rejected')),
  response_notes text,
  document_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table document_requests enable row level security;
create policy "Requests: insertion publique" on document_requests for insert with check (true);
create policy "Requests: lecture par authentifiés" on document_requests for select using (auth.role() = 'authenticated');
create policy "Requests: update par authentifiés" on document_requests for update using (auth.role() = 'authenticated');

-- =====================================================
-- DONNÉES DE DÉMONSTRATION
-- =====================================================

insert into clients (name, type, email, phone, address) values
('Coopérative Agricole du Pool', 'fournisseur', 'coop.pool@gmail.com', '+242 06 700 0001', 'Kinkala, Congo'),
('Supermarché Géant Vert', 'client', 'geantvert@business.cg', '+242 06 700 0002', 'Brazzaville'),
('Direction Générale des Impôts', 'institution', 'dgi@finances.gov.cg', '+242 06 700 0003', 'Brazzaville'),
('Assurances AXA Congo', 'institution', 'axa@assurances.cg', '+242 06 700 0004', 'Brazzaville'),
('Restaurant Le Palmier', 'client', 'palmier@resto.cg', '+242 06 700 0005', 'Pointe-Noire');

insert into products (name, category, quantity, unit, threshold_alert, price_per_unit) values
('Farine de manioc', 'Céréales transformées', 450, 'kg', 50, 850),
('Huile de palme raffinée', 'Huiles & graisses', 120, 'L', 30, 1200),
('Arachides décortiquées', 'Légumineuses', 85, 'kg', 100, 950),
('Jus de fruit tropical', 'Boissons', 24, 'carton', 20, 3500),
('Feuilles de manioc séchées', 'Légumes transformés', 8, 'kg', 15, 600),
('Riz local étuvé', 'Céréales transformées', 200, 'kg', 50, 700);

insert into jobs (title, department, description, requirements, type, deadline) values
('Responsable Commercial', 'Commercial', 'Développer le portefeuille clients et gérer les relations commerciales.', 'BAC+3 en commerce, 2 ans exp.', 'cdi', '2024-12-31'),
('Technicien Qualité', 'Production', 'Contrôler la qualité des produits transformés selon les normes.', 'BTS en agroalimentaire', 'cdi', '2024-12-15'),
('Stagiaire Marketing', 'Marketing', 'Assister l équipe marketing dans les campagnes digitales.', 'Étudiant en marketing', 'stage', '2024-11-30');
