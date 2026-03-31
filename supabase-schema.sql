-- =====================================================
-- HUB Distribution CRM v2 — Schéma Supabase complet
-- =====================================================
create extension if not exists "uuid-ossp";

-- PROFILES + RÔLES
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  role text not null default 'employee'
    check (role in ('ceo','manager','admin','employee','client')),
  department text,
  phone text,
  created_at timestamptz default now()
);
alter table profiles enable row level security;
create policy "profiles_select" on profiles for select using (auth.role()='authenticated');
create policy "profiles_update" on profiles for update using (auth.uid()=id);
create policy "profiles_insert" on profiles for insert with check (auth.uid()=id);

create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, full_name, role)
  values (new.id, new.raw_user_meta_data->>'full_name', 'employee')
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- CLIENTS
create table if not exists clients (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  type text not null default 'client' check (type in ('client','fournisseur','institution')),
  email text, phone text, address text, tax_id text, notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table clients enable row level security;
create policy "clients_all" on clients for all using (auth.role()='authenticated');

-- PRODUITS
create table if not exists products (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  category text not null default 'Général',
  quantity numeric not null default 0,
  unit text not null default 'kg',
  threshold_alert numeric not null default 10,
  price_per_unit numeric default 0,
  description text,
  created_at timestamptz default now()
);
alter table products enable row level security;
create policy "products_all" on products for all using (auth.role()='authenticated');

-- LOTS DE PRODUITS
create table if not exists product_batches (
  id uuid default uuid_generate_v4() primary key,
  product_id uuid references products(id) on delete cascade,
  batch_number text not null,
  quantity numeric not null default 0,
  expiry_date date,
  production_date date,
  supplier text,
  cost_per_unit numeric default 0,
  notes text,
  created_at timestamptz default now()
);
alter table product_batches enable row level security;
create policy "batches_all" on product_batches for all using (auth.role()='authenticated');

-- MOUVEMENTS DE STOCK
create table if not exists stock_movements (
  id uuid default uuid_generate_v4() primary key,
  product_id uuid references products(id) on delete cascade,
  batch_id uuid references product_batches(id) on delete set null,
  type text not null check (type in ('IN','OUT','ADJUST')),
  quantity numeric not null,
  reason text,
  reference_id uuid,
  reference_type text,
  user_id uuid references profiles(id),
  date date default current_date,
  created_at timestamptz default now()
);
alter table stock_movements enable row level security;
create policy "movements_all" on stock_movements for all using (auth.role()='authenticated');

create or replace function update_product_quantity()
returns trigger language plpgsql as $$
begin
  if NEW.type='IN' then
    update products set quantity=quantity+NEW.quantity where id=NEW.product_id;
    if NEW.batch_id is not null then
      update product_batches set quantity=quantity+NEW.quantity where id=NEW.batch_id;
    end if;
  elsif NEW.type='OUT' then
    update products set quantity=quantity-NEW.quantity where id=NEW.product_id;
    if NEW.batch_id is not null then
      update product_batches set quantity=quantity-NEW.quantity where id=NEW.batch_id;
    end if;
  end if;
  return NEW;
end;
$$;
drop trigger if exists after_stock_movement on stock_movements;
create trigger after_stock_movement
  after insert on stock_movements
  for each row execute function update_product_quantity();

-- VENTES
create table if not exists sales (
  id uuid default uuid_generate_v4() primary key,
  reference text unique not null
    default ('VTE-'||to_char(now(),'YYYY')||'-'||lpad(floor(random()*99999)::text,5,'0')),
  client_id uuid references clients(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft','pending','approved','rejected','cancelled')),
  total_amount numeric default 0,
  tax_rate numeric default 18,
  tax_amount numeric default 0,
  discount numeric default 0,
  notes text,
  due_date date,
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table sales enable row level security;
create policy "sales_all" on sales for all using (auth.role()='authenticated');

-- LIGNES DE VENTE
create table if not exists sale_items (
  id uuid default uuid_generate_v4() primary key,
  sale_id uuid references sales(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  batch_id uuid references product_batches(id) on delete set null,
  description text not null,
  quantity numeric not null,
  unit_price numeric not null,
  subtotal numeric generated always as (quantity * unit_price) stored,
  created_at timestamptz default now()
);
alter table sale_items enable row level security;
create policy "sale_items_all" on sale_items for all using (auth.role()='authenticated');

create or replace function process_sale_approval()
returns trigger language plpgsql as $$
declare
  item record;
  sale_total numeric;
begin
  if OLD.status != 'approved' and NEW.status = 'approved' then
    for item in select * from sale_items where sale_id = NEW.id loop
      insert into stock_movements (product_id, batch_id, type, quantity, reason, reference_id, reference_type)
      values (item.product_id, item.batch_id, 'OUT', item.quantity, 'Vente '||NEW.reference, NEW.id, 'sale');
    end loop;
    select sum(subtotal) into sale_total from sale_items where sale_id = NEW.id;
    NEW.total_amount := coalesce(sale_total, 0) - coalesce(NEW.discount, 0);
    NEW.tax_amount := NEW.total_amount * NEW.tax_rate / 100;
    NEW.approved_at := now();
  end if;
  return NEW;
end;
$$;
drop trigger if exists on_sale_status_change on sales;
create trigger on_sale_status_change
  before update on sales
  for each row execute function process_sale_approval();

-- DOCUMENTS
create table if not exists documents (
  id uuid default uuid_generate_v4() primary key,
  reference text unique not null
    default ('DOC-'||to_char(now(),'YYYY')||'-'||lpad(floor(random()*99999)::text,5,'0')),
  title text not null,
  type text not null
    check (type in ('facture','bon_de_livraison','attestation','contrat','document_rh','document_administratif','autre')),
  status text not null default 'draft'
    check (status in ('draft','pending','approved','rejected')),
  client_id uuid references clients(id) on delete set null,
  sale_id uuid references sales(id) on delete set null,
  employee_id uuid references profiles(id) on delete set null,
  content jsonb default '{}',
  file_url text,
  rejection_reason text,
  created_by uuid references profiles(id),
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table documents enable row level security;
create policy "documents_all" on documents for all using (auth.role()='authenticated');

-- EMPLOYÉS
create table if not exists employees (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) on delete set null,
  employee_number text unique,
  full_name text not null,
  position text not null,
  department text not null,
  email text,
  phone text,
  hire_date date not null,
  contract_type text not null default 'cdi'
    check (contract_type in ('cdi','cdd','stage','freelance')),
  salary numeric,
  status text not null default 'actif'
    check (status in ('actif','conge','suspendu','sorti')),
  address text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table employees enable row level security;
create policy "employees_all" on employees for all using (auth.role()='authenticated');

-- DOCUMENTS RH
create table if not exists employee_documents (
  id uuid default uuid_generate_v4() primary key,
  employee_id uuid references employees(id) on delete cascade,
  type text not null
    check (type in ('contrat','avenant','attestation_travail','fiche_paie','conge','discipline','autre')),
  title text not null,
  file_url text,
  document_id uuid references documents(id) on delete set null,
  issued_date date default current_date,
  created_at timestamptz default now()
);
alter table employee_documents enable row level security;
create policy "emp_docs_all" on employee_documents for all using (auth.role()='authenticated');

-- OFFRES D'EMPLOI + CANDIDATS
create table if not exists jobs (
  id uuid default uuid_generate_v4() primary key,
  title text not null,
  department text not null,
  description text not null,
  requirements text,
  location text default 'Brazzaville',
  type text not null check (type in ('cdi','cdd','stage','freelance')),
  status text not null default 'open' check (status in ('open','closed','archived')),
  deadline date,
  created_at timestamptz default now()
);
alter table jobs enable row level security;
create policy "jobs_select" on jobs for select using (true);
create policy "jobs_write" on jobs for all using (auth.role()='authenticated');

create table if not exists candidates (
  id uuid default uuid_generate_v4() primary key,
  job_id uuid references jobs(id) on delete cascade,
  name text not null, email text not null, phone text,
  cv_url text, cover_letter text,
  status text not null default 'nouveau'
    check (status in ('nouveau','en_cours','entretien','accepte','refuse')),
  notes text,
  created_at timestamptz default now()
);
alter table candidates enable row level security;
create policy "candidates_select" on candidates for select using (true);
create policy "candidates_insert" on candidates for insert with check (true);
create policy "candidates_update" on candidates for update using (auth.role()='authenticated');

-- DEMANDES EXTERNES
create table if not exists document_requests (
  id uuid default uuid_generate_v4() primary key,
  requester_name text not null,
  organization text not null,
  email text not null,
  phone text,
  document_type text not null,
  description text,
  status text not null default 'pending'
    check (status in ('pending','processing','approved','rejected')),
  response_notes text,
  document_url text,
  handled_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table document_requests enable row level security;
create policy "doc_req_insert" on document_requests for insert with check (true);
create policy "doc_req_select" on document_requests for select using (auth.role()='authenticated');
create policy "doc_req_update" on document_requests for update using (auth.role()='authenticated');

-- DONNÉES DE DÉMO
insert into clients (name, type, email, phone, address, tax_id) values
  ('Coopérative Agricole du Pool','fournisseur','coop.pool@gmail.com','+242 06 700 0001','Kinkala, Congo','NIF-001234'),
  ('Supermarché Géant Vert','client','geantvert@business.cg','+242 06 700 0002','Brazzaville','NIF-005678'),
  ('Direction Générale des Impôts','institution','dgi@finances.gov.cg','+242 06 700 0003','Brazzaville',NULL),
  ('Assurances AXA Congo','institution','axa@assurances.cg','+242 06 700 0004','Brazzaville',NULL),
  ('Restaurant Le Palmier','client','palmier@resto.cg','+242 06 700 0005','Pointe-Noire','NIF-009012')
on conflict do nothing;

insert into products (name, category, quantity, unit, threshold_alert, price_per_unit) values
  ('Farine de manioc','Céréales transformées',450,'kg',50,850),
  ('Huile de palme raffinée','Huiles & graisses',120,'L',30,1200),
  ('Arachides décortiquées','Légumineuses',85,'kg',100,950),
  ('Jus de fruit tropical','Boissons',24,'carton',20,3500),
  ('Feuilles de manioc séchées','Légumes transformés',8,'kg',15,600),
  ('Riz local étuvé','Céréales transformées',200,'kg',50,700)
on conflict do nothing;

insert into jobs (title, department, description, requirements, type, deadline) values
  ('Responsable Commercial','Commercial','Développer le portefeuille clients.','BAC+3 en commerce, 2 ans exp.','cdi','2025-06-30'),
  ('Technicien Qualité','Production','Contrôler la qualité des produits transformés.','BTS en agroalimentaire','cdi','2025-05-31')
on conflict do nothing;
