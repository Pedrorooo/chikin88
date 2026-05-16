-- ============================================================
--  MIGRACIÓN 004 — Chikin88 v2 (mayo 2026)
--  Actualización mayor en producción.
--
--  GARANTÍAS DE SEGURIDAD:
--    ✅ NO usa DROP TABLE
--    ✅ NO usa DROP SCHEMA
--    ✅ NO borra pedidos existentes
--    ✅ NO borra usuarios existentes
--    ✅ Todas las columnas se agregan con IF NOT EXISTS
--    ✅ Todos los INSERT usan ON CONFLICT DO NOTHING
--    ✅ Los UPDATE solo modifican lo necesario
--    ✅ Las políticas RLS se recrean idempotentemente
--
--  Cómo correr:
--    1. Supabase → SQL Editor → New query
--    2. Pega TODO este archivo
--    3. Run
--    4. Verifica los SELECT del final
--  Es seguro correrla varias veces.
-- ============================================================


-- ============================================================
--  1. SOFT DELETE — columnas nuevas en orders
-- ============================================================
alter table public.orders
  add column if not exists deleted_from_reports boolean not null default false,
  add column if not exists deleted_at  timestamptz,
  add column if not exists deleted_by  uuid references public.profiles(id),
  add column if not exists delete_reason text;

-- ============================================================
--  2. MODO DE SALSA Y TIPO DE RAMEN en order_items
-- ============================================================
alter table public.order_items
  add column if not exists sauce_mode text default 'normal'
    check (sauce_mode in ('normal','sin','aparte','extra')),
  add column if not exists ramen_type text
    check (ramen_type in ('picante','carbonara'));


-- ============================================================
--  3. INFO DE BENEFICIO DE EMPLEADO en orders
-- ============================================================
alter table public.orders
  add column if not exists benefit_type text
    check (benefit_type in ('discount','courtesy')),
  add column if not exists benefit_employee text;


-- ============================================================
--  4. RENOMBRAR PRODUCTOS (UPDATE seguro)
--  Solo afecta el catálogo. Los order_items YA guardaron
--  product_name histórico, así que los reportes pasados no cambian.
-- ============================================================
update public.products
   set name = 'Combo Económico'
 where name in ('Chikin 3.50', 'Combo 3.50')
   and not exists (select 1 from public.products where name = 'Combo Económico');

update public.products
   set name = 'Combo Especial'
 where name in ('Chikin 5.50', 'Combo 5.50')
   and not exists (select 1 from public.products where name = 'Combo Especial');


-- ============================================================
--  5. AGREGAR PRODUCTO NUEVO: Agua $0.75
-- ============================================================
insert into public.products (name, category, price, allows_extras, free_sauces, display_order)
select 'Agua', 'Bebidas', 0.75, false, 0, 4
where not exists (select 1 from public.products where name = 'Agua');


-- ============================================================
--  6. TABLA DE EMPLEADOS (lista oficial con sufijo 88)
-- ============================================================
create table if not exists public.employees (
  id uuid primary key default uuid_generate_v4(),
  username text unique not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Seed (idempotente)
insert into public.employees (username) values
  ('Nicolas88'), ('Cesar88'), ('David88'), ('Melany88'), ('Nahomi88'),
  ('Jhon88'), ('Jhosep88'), ('Victor88'), ('Valeria88'), ('Valentin88'),
  ('Francisco88'), ('Cindy88'), ('Daivid88'), ('Stephano88')
on conflict (username) do nothing;


-- ============================================================
--  7. TABLA DE USO DE BENEFICIOS (con restricciones únicas)
-- ============================================================
create table if not exists public.employee_benefit_usage (
  id uuid primary key default uuid_generate_v4(),
  employee_username text not null references public.employees(username),
  benefit_type text not null check (benefit_type in ('discount','courtesy')),
  order_id uuid references public.orders(id) on delete cascade,
  used_date date not null,
  used_iso_week text not null,
  created_at timestamptz not null default now()
);

-- Una sola "discount" por empleado por día (timezone Ecuador)
create unique index if not exists uniq_employee_discount_per_day
  on public.employee_benefit_usage (employee_username, used_date)
  where benefit_type = 'discount';

-- Una sola "courtesy" por empleado por semana (timezone Ecuador, ISO week)
create unique index if not exists uniq_employee_courtesy_per_week
  on public.employee_benefit_usage (employee_username, used_iso_week)
  where benefit_type = 'courtesy';

-- Índice general para consultas
create index if not exists idx_benefit_usage_employee
  on public.employee_benefit_usage (employee_username, created_at desc);


-- ============================================================
--  8. TRIGGER: registrar el uso del beneficio al crear el pedido
--  Se ejecuta DENTRO de la transacción del INSERT, así que si
--  el empleado ya usó su beneficio, el pedido NO se crea.
-- ============================================================
create or replace function public.handle_benefit_order()
returns trigger language plpgsql as $$
declare
  v_date date;
  v_week text;
begin
  if new.benefit_type is null or new.benefit_employee is null then
    return new;
  end if;

  -- Verifica que el empleado exista y esté activo
  if not exists (
    select 1 from public.employees
    where username = new.benefit_employee and active = true
  ) then
    raise exception 'EMPLOYEE_NOT_FOUND: % no es un empleado válido', new.benefit_employee
      using errcode = 'P0001';
  end if;

  -- Día y semana ISO en zona horaria Ecuador
  v_date := (new.created_at at time zone 'America/Guayaquil')::date;
  v_week := to_char(v_date, 'IYYY-"W"IW');

  if new.benefit_type = 'discount' then
    if exists (
      select 1 from public.employee_benefit_usage
      where employee_username = new.benefit_employee
        and benefit_type = 'discount'
        and used_date = v_date
    ) then
      raise exception '% ya usó su descuento de empleado hoy.', new.benefit_employee
        using errcode = 'P0002';
    end if;
  elsif new.benefit_type = 'courtesy' then
    if exists (
      select 1 from public.employee_benefit_usage
      where employee_username = new.benefit_employee
        and benefit_type = 'courtesy'
        and used_iso_week = v_week
    ) then
      raise exception '% ya usó su Combo Especial gratis esta semana.', new.benefit_employee
        using errcode = 'P0003';
    end if;
  end if;

  -- Registra el uso
  insert into public.employee_benefit_usage
    (employee_username, benefit_type, order_id, used_date, used_iso_week)
  values
    (new.benefit_employee, new.benefit_type, new.id, v_date, v_week);

  return new;
end $$;

drop trigger if exists trg_order_benefit on public.orders;
create trigger trg_order_benefit
  after insert on public.orders
  for each row execute function public.handle_benefit_order();


-- ============================================================
--  9. ÍNDICES DE PERFORMANCE
-- ============================================================
-- Estos aceleran muchísimo los reportes y las consultas diarias.
create index if not exists idx_orders_created_at_desc on public.orders (created_at desc);
create index if not exists idx_orders_status on public.orders (status);
create index if not exists idx_orders_deleted_from_reports on public.orders (deleted_from_reports);
create index if not exists idx_orders_benefit on public.orders (benefit_type) where benefit_type is not null;

create index if not exists idx_order_items_order_id on public.order_items (order_id);
create index if not exists idx_order_items_product_name on public.order_items (product_name);

create index if not exists idx_expenses_date_desc on public.expenses (expense_date desc);


-- ============================================================
--  10. ACTUALIZAR VISTAS — excluir pedidos anulados
-- ============================================================
create or replace view public.daily_sales as
select
  (created_at at time zone 'America/Guayaquil')::date as sale_date,
  count(*) filter (where status <> 'cancelado' and deleted_from_reports = false) as total_orders,
  count(*) filter (where status = 'cancelado') as cancelled_orders,
  count(*) filter (where deleted_from_reports = true) as anulled_orders,
  coalesce(sum(total) filter (where status <> 'cancelado' and deleted_from_reports = false and benefit_type is null), 0) as total_revenue,
  coalesce(sum(total) filter (where status <> 'cancelado' and deleted_from_reports = false and payment_method = 'efectivo' and benefit_type is null), 0) as cash_revenue,
  coalesce(sum(total) filter (where status <> 'cancelado' and deleted_from_reports = false and payment_method = 'transferencia' and benefit_type is null), 0) as transfer_revenue
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
  and o.deleted_from_reports = false
group by 1, 2, 5;


-- ============================================================
--  11. RLS — políticas para las tablas nuevas
-- ============================================================
alter table public.employees enable row level security;
alter table public.employee_benefit_usage enable row level security;

-- Lectura libre para usuarios autenticados (necesaria para el frontend)
drop policy if exists "employees_read" on public.employees;
create policy "employees_read" on public.employees
  for select using (auth.role() = 'authenticated');

drop policy if exists "employees_admin_write" on public.employees;
create policy "employees_admin_write" on public.employees
  for all using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- Lectura del historial: admin y empleado pueden ver
drop policy if exists "benefit_usage_read" on public.employee_benefit_usage;
create policy "benefit_usage_read" on public.employee_benefit_usage
  for select using (auth.role() = 'authenticated');

-- Inserción se hace por el trigger; ningún cliente debería insertar directo.
-- Pero permitimos UPDATE para link de order_id si hace falta (no usado activamente).
drop policy if exists "benefit_usage_admin_only" on public.employee_benefit_usage;
create policy "benefit_usage_admin_only" on public.employee_benefit_usage
  for all using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');


-- ============================================================
--  12. REALTIME — añadir las tablas nuevas
-- ============================================================
do $$
begin
  begin
    alter publication supabase_realtime add table public.employee_benefit_usage;
  exception when duplicate_object then null;
  end;
end $$;


-- ============================================================
--  13. VERIFICACIÓN
-- ============================================================
-- Columnas nuevas en orders
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'orders'
  and column_name in ('deleted_from_reports','deleted_at','deleted_by','delete_reason','benefit_type','benefit_employee')
order by column_name;

-- Empleados registrados
select count(*) as total_empleados from public.employees where active = true;

-- Productos clave
select name, category, price
from public.products
where name in ('Combo Económico','Combo Especial','Combo XXL','Combo Full','Agua')
order by display_order;
