-- =====================================================
-- HUB Distribution CRM — Migration v2
-- Nouveaux modules : lots, péremption, factures,
-- workflow validation, RH, rôles étendus
-- À exécuter dans l'éditeur SQL de Supabase
-- =====================================================

-- Mise à jour des rôles
alter table profiles 
  drop constraint if exists profiles_role_check;

alter table profiles 
  add column if not exists department text,
  add column if not exists phone text,
  add column if not exists avatar_url text,
  add column if not exists hire_date date,
  add column if not exists status text default 'active' check (status in ('active', 'inactive', 'leave'));

alter table profiles 
  add constraint profiles_role_check 
  check (role in ('ceo', 'manager', 'admin', 'employee', 'partner'));

-- =====================================================
-- TABLE: product_lots (gestion par lots)
-- =====================================================
create table if not exists product_lots (
  id uuid default uuid_generate_v4() primary key,
  product_id uuid references products(id) on delete cascade,
  lot_number text not null,
  quantity numeric not null,
  expiry_date date,
  production_date date,
  supplier text,
  notes text,
  created_at timestamptz default now()
);

alter table product_lots enable row level security;
create policy "Lots: tous les authentifiés" on product_lots for all using (auth.role() = 'authenticated');

-- Ajouter colonnes lot/péremption aux mouvements
alter table stock_movements 
  add column if not exists lot_id uuid references product_lots(id),
  add column if not exists notes text;

-- =====================================================
-- TABLE: invoice_items (lignes de facture)
-- =====================================================
create table if not exists invoice_items (
  id uuid default uuid_generate_v4() primary key,
  document_id uuid references documents(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  description text not null,
  quantity numeric not null default 1,
  unit_price numeric not null default 0,
  tax_rate numeric default 18,
  total numeric generated always as (quantity * unit_price) stored,
  created_at timestamptz default now()
);

alter table invoice_items enable row level security;
create policy "Invoice items: tous les authentifiés" on invoice_items for all using (auth.role() = 'authenticated');

-- Mise à jour de documents pour le workflow
alter table documents
  add column if not exists validated_by uuid references profiles(id),
  add column if not exists validated_at timestamptz,
  add column if not exists rejection_reason text,
  add column if not exists invoice_number text,
  add column if not exists total_amount numeric default 0,
  add column if not exists due_date date,
  add column if not exists reference text;

-- Mise à jour status documents pour workflow complet
alter table documents drop constraint if exists documents_status_check;
alter table documents add constraint documents_status_check
  check (status in ('draft', 'pending', 'approved', 'rejected', 'sent'));

-- Trigger: générer numéro de facture auto
create or replace function generate_invoice_number()
returns trigger language plpgsql as $$
declare
  next_num integer;
  year_str text;
begin
  if NEW.type = 'facture' and NEW.invoice_number is null then
    year_str := to_char(now(), 'YYYY');
    select coalesce(max(cast(split_part(invoice_number, '-', 3) as integer)), 0) + 1
    into next_num
    from documents
    where type = 'facture' 
      and invoice_number like 'HUB-' || year_str || '-%';
    NEW.invoice_number := 'HUB-' || year_str || '-' || lpad(next_num::text, 4, '0');
  end if;
  return NEW;
end;
$$;

drop trigger if exists before_document_insert on documents;
create trigger before_document_insert
  before insert on documents
  for each row execute function generate_invoice_number();

-- =====================================================
-- TABLE: sales (ventes — lien facture + stock auto)
-- =====================================================
create table if not exists sales (
  id uuid default uuid_generate_v4() primary key,
  document_id uuid references documents(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  total_amount numeric not null default 0,
  paid_amount numeric default 0,
  payment_status text default 'unpaid' check (payment_status in ('unpaid', 'partial', 'paid')),
  payment_date date,
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

alter table sales enable row level security;
create policy "Sales: tous les authentifiés" on sales for all using (auth.role() = 'authenticated');

-- =====================================================
-- TABLE: hr_records (documents RH employés)
-- =====================================================
create table if not exists hr_records (
  id uuid default uuid_generate_v4() primary key,
  employee_id uuid references profiles(id) on delete cascade,
  type text not null check (type in (
    'contrat', 'bulletin_salaire', 'conge', 
    'avertissement', 'attestation_travail', 'autre'
  )),
  title text not null,
  file_url text,
  notes text,
  month_year text,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

alter table hr_records enable row level security;
create policy "HR records: authentifiés" on hr_records for all using (auth.role() = 'authenticated');

-- =====================================================
-- TABLE: attendance (présences simple)
-- =====================================================
create table if not exists attendance (
  id uuid default uuid_generate_v4() primary key,
  employee_id uuid references profiles(id) on delete cascade,
  date date not null default current_date,
  status text default 'present' check (status in ('present', 'absent', 'late', 'leave', 'holiday')),
  notes text,
  created_at timestamptz default now(),
  unique(employee_id, date)
);

alter table attendance enable row level security;
create policy "Attendance: authentifiés" on attendance for all using (auth.role() = 'authenticated');

-- =====================================================
-- DONNÉES DE DÉMO supplémentaires
-- =====================================================

-- Mettre à jour le trigger handle_new_user pour les nouveaux rôles
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, full_name, role)
  values (
    new.id, 
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'employee')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Lots de démonstration (à lancer après avoir des produits)
-- insert into product_lots (product_id, lot_number, quantity, expiry_date, production_date)
-- select id, 'LOT-2025-001', quantity, current_date + interval '6 months', current_date - interval '7 days'
-- from products limit 3;
