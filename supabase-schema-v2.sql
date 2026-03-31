-- =====================================================
-- HUB Distribution CRM — Migration v2
-- Exécuter dans l'éditeur SQL Supabase (après v1)
-- =====================================================

-- Mettre à jour les rôles autorisés
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('ceo', 'manager', 'admin', 'employee', 'client'));

-- =====================================================
-- MISE À JOUR TABLE: products (lots + péremption)
-- =====================================================
alter table products add column if not exists batch_tracking boolean default false;
alter table products add column if not exists supplier_id uuid references clients(id) on delete set null;

-- =====================================================
-- TABLE: product_lots (gestion par lot)
-- =====================================================
create table if not exists product_lots (
  id uuid default uuid_generate_v4() primary key,
  product_id uuid references products(id) on delete cascade,
  lot_number text not null,
  quantity numeric not null default 0,
  production_date date,
  expiry_date date,
  supplier_id uuid references clients(id) on delete set null,
  notes text,
  created_at timestamptz default now()
);

alter table product_lots enable row level security;
create policy "Lots: tous les authentifiés" on product_lots for all using (auth.role() = 'authenticated');

-- Ajouter lot_id aux mouvements de stock
alter table stock_movements add column if not exists lot_id uuid references product_lots(id) on delete set null;
alter table stock_movements add column if not exists reference text;

-- =====================================================
-- MISE À JOUR TABLE: documents (workflow complet)
-- =====================================================
alter table documents drop constraint if exists documents_status_check;
alter table documents add constraint documents_status_check
  check (status in ('draft', 'pending_validation', 'approved', 'rejected', 'sent'));

alter table documents add column if not exists validated_by uuid references profiles(id);
alter table documents add column if not exists validated_at timestamptz;
alter table documents add column if not exists rejection_reason text;
alter table documents add column if not exists document_number text;
alter table documents add column if not exists amount numeric;
alter table documents add column if not exists due_date date;
alter table documents add column if not exists is_paid boolean default false;
alter table documents add column if not exists paid_at timestamptz;

-- Séquence numérotation automatique des documents
create sequence if not exists document_number_seq start 1000;

create or replace function generate_document_number()
returns trigger language plpgsql as $$
begin
  if NEW.document_number is null then
    NEW.document_number := 'HUB-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('document_number_seq')::text, 4, '0');
  end if;
  return NEW;
end;
$$;

drop trigger if exists before_document_insert on documents;
create trigger before_document_insert
  before insert on documents
  for each row execute function generate_document_number();

-- =====================================================
-- TABLE: employees (module RH)
-- =====================================================
create table if not exists employees (
  id uuid default uuid_generate_v4() primary key,
  full_name text not null,
  email text unique,
  phone text,
  position text not null,
  department text not null,
  contract_type text not null default 'cdi' check (contract_type in ('cdi', 'cdd', 'stage', 'freelance')),
  start_date date not null,
  end_date date,
  salary numeric,
  status text not null default 'active' check (status in ('active', 'on_leave', 'terminated')),
  profile_id uuid references profiles(id) on delete set null,
  notes text,
  created_at timestamptz default now()
);

alter table employees enable row level security;
create policy "Employees: CEO/Manager/Admin" on employees for all
  using (
    exists (
      select 1 from profiles
      where id = auth.uid()
      and role in ('ceo', 'manager', 'admin')
    )
  );

-- =====================================================
-- TABLE: employee_documents (documents RH)
-- =====================================================
create table if not exists employee_documents (
  id uuid default uuid_generate_v4() primary key,
  employee_id uuid references employees(id) on delete cascade,
  type text not null check (type in ('contrat', 'avenant', 'bulletin_paie', 'attestation_travail', 'conge', 'autre')),
  title text not null,
  file_url text,
  issued_date date default current_date,
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

alter table employee_documents enable row level security;
create policy "EmployeeDocs: authentifiés" on employee_documents for all using (auth.role() = 'authenticated');

-- =====================================================
-- TABLE: sales (ventes — lie document + stock)
-- =====================================================
create table if not exists sales (
  id uuid default uuid_generate_v4() primary key,
  document_id uuid references documents(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  total_amount numeric not null default 0,
  status text not null default 'pending' check (status in ('pending', 'validated', 'cancelled')),
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

alter table sales enable row level security;
create policy "Sales: tous les authentifiés" on sales for all using (auth.role() = 'authenticated');

-- =====================================================
-- TABLE: sale_items (lignes de vente)
-- =====================================================
create table if not exists sale_items (
  id uuid default uuid_generate_v4() primary key,
  sale_id uuid references sales(id) on delete cascade,
  product_id uuid references products(id) on delete restrict,
  lot_id uuid references product_lots(id) on delete set null,
  quantity numeric not null,
  unit_price numeric not null,
  total_price numeric generated always as (quantity * unit_price) stored,
  created_at timestamptz default now()
);

alter table sale_items enable row level security;
create policy "SaleItems: tous les authentifiés" on sale_items for all using (auth.role() = 'authenticated');

-- =====================================================
-- DONNÉES DE DÉMO SUPPLÉMENTAIRES
-- =====================================================

-- Lots de produits
insert into product_lots (product_id, lot_number, quantity, production_date, expiry_date, notes)
select
  p.id,
  'LOT-2025-' || lpad(row_number() over ()::text, 3, '0'),
  p.quantity,
  current_date - interval '30 days',
  case
    when p.name like '%jus%' then current_date + interval '6 months'
    when p.name like '%farine%' then current_date + interval '12 months'
    when p.name like '%huile%' then current_date + interval '18 months'
    else current_date + interval '8 months'
  end,
  'Stock initial importé depuis Excel'
from products p
on conflict do nothing;

-- Employés de démo
insert into employees (full_name, email, phone, position, department, contract_type, start_date, salary, status) values
('Jean-Paul MOUKASSA', 'jp.moukassa@hubdistribution.cg', '+242 06 500 0001', 'Directeur Commercial', 'Commercial', 'cdi', '2022-01-15', 850000, 'active'),
('Marie NGUESSO', 'marie.nguesso@hubdistribution.cg', '+242 06 500 0002', 'Responsable Stock', 'Logistique', 'cdi', '2021-03-01', 650000, 'active'),
('Patrick BIYOUDI', 'p.biyoudi@hubdistribution.cg', '+242 06 500 0003', 'Comptable', 'Finance', 'cdi', '2023-06-01', 550000, 'active'),
('Sylvie MAKOSSO', 's.makosso@hubdistribution.cg', '+242 06 500 0004', 'Assistante RH', 'RH', 'cdd', '2024-01-01', 400000, 'active'),
('André KIMPOUNI', 'a.kimpouni@hubdistribution.cg', '+242 06 500 0005', 'Commercial Terrain', 'Commercial', 'cdi', '2022-09-15', 480000, 'active');
