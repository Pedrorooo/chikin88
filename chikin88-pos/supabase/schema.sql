-- =====================================================================
-- CHIKIN88 POS - Schema completo de Supabase / PostgreSQL
-- =====================================================================
-- Ejecuta TODO este archivo en: Supabase → SQL Editor → New Query → Run
-- =====================================================================

-- ---------- 1. EXTENSIONES ----------
create extension if not exists "uuid-ossp";

-- ---------- 2. ENUMS ----------
do $$ begin
  create type user_role as enum ('admin', 'empleado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_status as enum ('pendiente', 'en_preparacion', 'listo', 'entregado', 'cancelado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_method as enum ('efectivo', 'transferencia');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_type as enum ('abierto', 'para_llevar');
exception when duplicate_object then null; end $$;

-- ---------- 3. TABLA PROFILES (perfiles de usuarios) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text,
  role user_role not null default 'empleado',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_role on public.profiles(role);
create index if not exists idx_profiles_active on public.profiles(active);

-- ---------- 4. TABLA PRODUCTS (catálogo) ----------
create table if not exists public.products (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  category text not null,
  price numeric(10,2) not null check (price >= 0),
  allows_extras boolean not null default true,
  free_sauces int not null default 1,
  active boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_products_category on public.products(category);
create index if not exists idx_products_active on public.products(active);

-- ---------- 5. TABLA ORDERS (pedidos) ----------
create table if not exists public.orders (
  id uuid primary key default uuid_generate_v4(),
  order_number serial,
  customer_name text not null,
  customer_phone text,
  status order_status not null default 'pendiente',
  order_type order_type not null default 'abierto',
  is_delivery boolean not null default false,
  delivery_fee numeric(10,2) not null default 0,
  with_mayo boolean not null default true,
  utensil text not null default 'tenedor' check (utensil in ('tenedor','palillos','ninguno')),
  payment_method payment_method not null default 'efectivo',
  notes text,
  subtotal numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ready_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  -- Soft delete (anulación para reportes)
  deleted_from_reports boolean not null default false,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  delete_reason text,
  -- Beneficios de empleado
  benefit_type text check (benefit_type in ('discount','courtesy')),
  benefit_employee text
);

create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_orders_created_at on public.orders(created_at desc);
create index if not exists idx_orders_active_status on public.orders(status, created_at)
  where status in ('pendiente','en_preparacion','listo');
create index if not exists idx_orders_date on public.orders((created_at::date));

-- ---------- 6. TABLA ORDER_ITEMS (productos de cada pedido) ----------
create table if not exists public.order_items (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  product_category text,
  unit_price numeric(10,2) not null,
  quantity int not null check (quantity > 0),
  sauces text[] default '{}',
  sauce_mode text default 'normal' check (sauce_mode in ('normal','sin','aparte','extra')),
  ramen_type text check (ramen_type in ('picante','carbonara')),
  subtotal numeric(10,2) not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_order_items_order on public.order_items(order_id);
create index if not exists idx_order_items_product on public.order_items(product_id);

-- ---------- 7. TABLA EXPENSES (gastos) ----------
create table if not exists public.expenses (
  id uuid primary key default uuid_generate_v4(),
  description text not null,
  amount numeric(10,2) not null check (amount >= 0),
  expense_date date not null default current_date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_expenses_date on public.expenses(expense_date desc);

-- ---------- 8. TRIGGER updated_at automático ----------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end; $$ language plpgsql;

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------- 9. TRIGGER timestamps de estado ----------
create or replace function public.set_status_timestamps()
returns trigger as $$
begin
  if new.status = 'listo' and old.status <> 'listo' then
    new.ready_at = now();
  end if;
  if new.status = 'entregado' and old.status <> 'entregado' then
    new.delivered_at = now();
  end if;
  if new.status = 'cancelado' and old.status <> 'cancelado' then
    new.cancelled_at = now();
  end if;
  return new;
end; $$ language plpgsql;

drop trigger if exists trg_orders_status_ts on public.orders;
create trigger trg_orders_status_ts before update on public.orders
  for each row execute function public.set_status_timestamps();

-- ---------- 10. TRIGGER auto-crear perfil al registrar usuario ----------
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'empleado')
  )
  on conflict (id) do nothing;
  return new;
end; $$ language plpgsql security definer;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 11. FUNCIÓN HELPER: rol del usuario actual ----------
create or replace function public.current_role()
returns user_role
language sql security definer stable as $$
  select role from public.profiles where id = auth.uid();
$$;

-- ---------- 12. ROW LEVEL SECURITY ----------
alter table public.profiles    enable row level security;
alter table public.products    enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;
alter table public.expenses    enable row level security;

-- ---- POLÍTICAS PROFILES ----
drop policy if exists "profiles_self_select"  on public.profiles;
drop policy if exists "profiles_admin_select" on public.profiles;
drop policy if exists "profiles_admin_all"    on public.profiles;

create policy "profiles_self_select" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_admin_select" on public.profiles
  for select using (public.current_role() = 'admin');
create policy "profiles_admin_all" on public.profiles
  for all using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- ---- POLÍTICAS PRODUCTS ----
drop policy if exists "products_read_all"    on public.products;
drop policy if exists "products_admin_write" on public.products;

create policy "products_read_all" on public.products
  for select using (auth.role() = 'authenticated');
create policy "products_admin_write" on public.products
  for all using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- ---- POLÍTICAS ORDERS ----
drop policy if exists "orders_read_all"      on public.orders;
drop policy if exists "orders_mesero_write"  on public.orders;
drop policy if exists "orders_mesero_edit"   on public.orders;
drop policy if exists "orders_cocina_status" on public.orders;
drop policy if exists "orders_admin_all"     on public.orders;
drop policy if exists "orders_empleado_write" on public.orders;
drop policy if exists "orders_empleado_edit"  on public.orders;
drop policy if exists "orders_admin_delete"   on public.orders;

create policy "orders_read_all" on public.orders
  for select using (auth.role() = 'authenticated');
create policy "orders_empleado_write" on public.orders
  for insert with check (public.current_role() in ('admin','empleado'));
create policy "orders_empleado_edit" on public.orders
  for update using (public.current_role() in ('admin','empleado'))
  with check (public.current_role() in ('admin','empleado'));
create policy "orders_admin_delete" on public.orders
  for delete using (public.current_role() = 'admin');

-- ---- POLÍTICAS ORDER_ITEMS ----
drop policy if exists "order_items_read"  on public.order_items;
drop policy if exists "order_items_write" on public.order_items;

create policy "order_items_read" on public.order_items
  for select using (auth.role() = 'authenticated');
create policy "order_items_write" on public.order_items
  for all using (public.current_role() in ('admin','empleado'))
  with check (public.current_role() in ('admin','empleado'));

-- ---- POLÍTICAS EXPENSES ----
drop policy if exists "expenses_read"  on public.expenses;
drop policy if exists "expenses_admin" on public.expenses;

create policy "expenses_read" on public.expenses
  for select using (public.current_role() = 'admin');
create policy "expenses_admin" on public.expenses
  for all using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- ---------- 13. REALTIME ----------
-- Habilita la replicación en tiempo real para las tablas clave
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.order_items;
alter publication supabase_realtime add table public.expenses;

-- ---------- 14. SEED: PRODUCTOS INICIALES ----------
insert into public.products (name, category, price, allows_extras, free_sauces, display_order) values
  ('Combo XXL',           'Principales', 8.50, true,  1, -2),
  ('Combo Full',          'Principales',16.50, true,  3, -1),
  ('Combo Económico',     'Principales', 3.50, true,  1,  1),
  ('Combo Especial',      'Principales', 5.50, true,  1,  2),
  ('Ramen solo',          'Ramen',       5.50, false, 0,  3),
  ('Combo ramen',         'Ramen',       7.50, true,  1,  4),
  ('Agua',                'Bebidas',     0.75, false, 0,  4),
  ('Bebida pequeña',      'Bebidas',     0.50, false, 0,  5),
  ('Bebida grande',       'Bebidas',     1.25, false, 0,  6),
  ('Bebida coreana funda','Bebidas',     3.00, false, 0,  7),
  ('Bebida coreana lata', 'Bebidas',     3.50, false, 0,  8),
  ('Palillos',            'Extras',      0.25, false, 0,  9),
  ('Vaso de hielos',      'Extras',      0.50, false, 0, 10),
  ('Pockys',              'Extras',      3.50, false, 0, 11),
  ('Dulces',              'Extras',      1.50, false, 0, 12),
  ('Gomitas Peel',        'Extras',      3.50, false, 0, 13)
on conflict do nothing;

-- ---------- 15. VISTAS PARA REPORTES ----------
create or replace view public.daily_sales as
select
  (created_at at time zone 'America/Guayaquil')::date as sale_date,
  count(*) filter (where status <> 'cancelado') as total_orders,
  count(*) filter (where status = 'cancelado')  as cancelled_orders,
  coalesce(sum(total) filter (where status <> 'cancelado'), 0) as total_revenue,
  coalesce(sum(total) filter (where status <> 'cancelado' and payment_method = 'efectivo'), 0) as cash_revenue,
  coalesce(sum(total) filter (where status <> 'cancelado' and payment_method = 'transferencia'), 0) as transfer_revenue
from public.orders
group by 1;

create or replace view public.product_sales as
select
  oi.product_name,
  oi.product_category,
  sum(oi.quantity) as qty_sold,
  sum(oi.subtotal) as revenue,
  (o.created_at at time zone 'America/Guayaquil')::date as sale_date
from public.order_items oi
join public.orders o on o.id = oi.order_id
where o.status <> 'cancelado'
group by 1, 2, 5;

-- =====================================================================
-- FIN DEL SCHEMA. Si todo se ejecutó sin errores: ¡listo!
-- =====================================================================
