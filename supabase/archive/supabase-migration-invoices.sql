-- =====================================================
-- HUB Distribution — Module Facturation v1
-- À exécuter dans Supabase SQL Editor
-- =====================================================

-- TABLE PRINCIPALE : factures
create table if not exists invoices (
  id uuid default uuid_generate_v4() primary key,
  invoice_number text unique not null,
  client_id uuid references clients(id) on delete set null,
  date date not null default current_date,
  due_date date,
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'paid', 'cancelled')),

  -- Montants (snapshots comptables — ne dépendent pas des prix produits)
  subtotal numeric not null default 0,
  discount numeric not null default 0,
  tax_rate numeric not null default 18,
  tax_amount numeric not null default 0,
  total numeric not null default 0,

  -- Métadonnées
  notes text,
  payment_terms text default '30 jours',
  payment_method text,

  -- Traçabilité
  created_by uuid references profiles(id) on delete set null,
  validated_by uuid references profiles(id) on delete set null,
  validated_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- LIGNES DE FACTURE (snapshots des prix au moment de la création)
create table if not exists invoice_items (
  id uuid default uuid_generate_v4() primary key,
  invoice_id uuid references invoices(id) on delete cascade not null,
  product_id uuid references products(id) on delete set null,

  -- SNAPSHOTS — Ces données sont fixes au moment de la facturation
  -- Ne doivent PAS dépendre des prix produits actuels
  name text not null,
  description text,
  quantity numeric not null default 1,
  unit text default 'unité',
  unit_price numeric not null,
  tax_rate numeric not null default 18,
  subtotal numeric generated always as (quantity * unit_price) stored,

  sort_order integer default 0,
  created_at timestamptz default now()
);

-- HISTORIQUE DES PAIEMENTS
create table if not exists invoice_payments (
  id uuid default uuid_generate_v4() primary key,
  invoice_id uuid references invoices(id) on delete cascade not null,
  amount numeric not null,
  payment_date date not null default current_date,
  method text not null default 'virement',
  reference text,
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- AVOIRS (Credit Notes)
create table if not exists credit_notes (
  id uuid default uuid_generate_v4() primary key,
  reference text unique not null,
  invoice_id uuid references invoices(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  reason text not null,
  amount numeric not null,
  status text not null default 'pending'
    check (status in ('pending', 'applied', 'cancelled')),
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- RLS
alter table invoices enable row level security;
alter table invoice_items enable row level security;
alter table invoice_payments enable row level security;
alter table credit_notes enable row level security;

create policy "invoices_all" on invoices for all using (auth.role() = 'authenticated');
create policy "invoice_items_all" on invoice_items for all using (auth.role() = 'authenticated');
create policy "invoice_payments_all" on invoice_payments for all using (auth.role() = 'authenticated');
create policy "credit_notes_all" on credit_notes for all using (auth.role() = 'authenticated');

-- FONCTION : générer numéro de facture
-- Format: FAC-2026-0001 (reset par an)
create or replace function generate_invoice_number()
returns text language plpgsql as $$
declare
  current_year text;
  count_this_year integer;
  new_number text;
begin
  current_year := to_char(now(), 'YYYY');
  select count(*) into count_this_year
  from invoices
  where invoice_number like 'FAC-' || current_year || '-%';
  new_number := 'FAC-' || current_year || '-' || lpad((count_this_year + 1)::text, 4, '0');
  return new_number;
end;
$$;

-- FONCTION : recalculer totaux facture
create or replace function recalculate_invoice_totals(p_invoice_id uuid)
returns void language plpgsql as $$
declare
  v_subtotal numeric;
  v_discount numeric;
  v_tax_rate numeric;
  v_tax_amount numeric;
  v_total numeric;
begin
  select
    coalesce(sum(quantity * unit_price), 0),
    coalesce(i.discount, 0),
    coalesce(i.tax_rate, 18)
  into v_subtotal, v_discount, v_tax_rate
  from invoice_items ii
  join invoices i on i.id = ii.invoice_id
  where ii.invoice_id = p_invoice_id
  group by i.discount, i.tax_rate;

  if v_subtotal is null then v_subtotal := 0; end if;

  v_tax_amount := (v_subtotal - v_discount) * v_tax_rate / 100;
  v_total := v_subtotal - v_discount + v_tax_amount;

  update invoices set
    subtotal = v_subtotal,
    tax_amount = v_tax_amount,
    total = v_total,
    updated_at = now()
  where id = p_invoice_id;
end;
$$;

-- TRIGGER : recalculer totaux après modification des lignes
create or replace function trigger_recalc_invoice()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'DELETE' then
    perform recalculate_invoice_totals(OLD.invoice_id);
  else
    perform recalculate_invoice_totals(NEW.invoice_id);
  end if;
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists recalc_on_item_change on invoice_items;
create trigger recalc_on_item_change
  after insert or update or delete on invoice_items
  for each row execute function trigger_recalc_invoice();

-- TRIGGER : validation facture → décrémentation stock (atomique)
create or replace function process_invoice_validation()
returns trigger language plpgsql as $$
declare
  item record;
  available_stock numeric;
begin
  if OLD.status != 'paid' and NEW.status = 'paid' then
    -- Vérification stock pour chaque ligne avec product_id
    for item in
      select ii.*, p.name as product_name, p.quantity as stock_qty
      from invoice_items ii
      join products p on p.id = ii.product_id
      where ii.invoice_id = NEW.id and ii.product_id is not null
    loop
      if item.stock_qty < item.quantity then
        raise exception 'Stock insuffisant pour "%": disponible=%, demandé=%',
          item.product_name, item.stock_qty, item.quantity;
      end if;
    end loop;

    -- Décrémentation stock
    for item in
      select * from invoice_items
      where invoice_id = NEW.id and product_id is not null
    loop
      insert into stock_movements (product_id, type, quantity, reason, reference_id, reference_type, user_id)
      values (item.product_id, 'OUT', item.quantity,
        'Facture ' || NEW.invoice_number, NEW.id, 'invoice', NEW.validated_by);
    end loop;

    NEW.validated_at := now();
  end if;
  return NEW;
end;
$$;

drop trigger if exists on_invoice_validation on invoices;
create trigger on_invoice_validation
  before update on invoices
  for each row execute function process_invoice_validation();

-- VUE : résumé financier par client
create or replace view client_financial_summary as
select
  c.id as client_id,
  c.name as client_name,
  c.email,
  count(i.id) as total_invoices,
  coalesce(sum(case when i.status != 'cancelled' then i.total else 0 end), 0) as total_ordered,
  coalesce(sum(case when i.status = 'paid' then i.total else 0 end), 0) as total_paid,
  coalesce(sum(case when i.status in ('pending', 'draft') then i.total else 0 end), 0) as balance_due,
  max(i.created_at) as last_invoice_date
from clients c
left join invoices i on i.client_id = c.id
group by c.id, c.name, c.email;

-- INDEX pour performance
create index if not exists idx_invoices_client on invoices(client_id);
create index if not exists idx_invoices_status on invoices(status);
create index if not exists idx_invoices_date on invoices(date desc);
create index if not exists idx_invoice_items_invoice on invoice_items(invoice_id);
create index if not exists idx_invoice_items_product on invoice_items(product_id);
