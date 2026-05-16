-- ============================================================
--  MIGRACIÓN 003 — Simplificar roles: admin + empleado
--  Fecha: mayo 2026
--
--  ANTES:  admin / cocina / mesero
--  AHORA:  admin / empleado
--
--  - Los usuarios con rol 'cocina' o 'mesero' pasan a 'empleado'
--  - Empleado puede crear/editar pedidos, ver cocina, cambiar estados
--  - Empleado NO ve ventas, gastos, reportes ni dashboard
--  - Solo admin puede borrar pedidos históricos
--
--  Cómo correr:
--    1. Supabase → SQL Editor → New query
--    2. Pega TODO este archivo
--    3. Run
--  Es idempotente (puedes correrla varias veces).
-- ============================================================

-- ============================================================
--  PASO 1 — Reconstruir el enum user_role
-- ============================================================
-- Postgres no permite eliminar valores de un enum existente,
-- así que creamos un enum nuevo y migramos la columna.
-- Esto se ejecuta solo si todavía existen los valores antiguos.

do $$
declare
  has_old_values boolean;
begin
  select exists (
    select 1 from pg_enum e
    join pg_type t on e.enumtypid = t.oid
    where t.typname = 'user_role'
      and e.enumlabel in ('cocina', 'mesero')
  ) into has_old_values;

  if has_old_values then
    raise notice 'Reconstruyendo enum user_role…';

    -- Crea el enum nuevo (solo admin/empleado)
    drop type if exists user_role_new;
    create type user_role_new as enum ('admin', 'empleado');

    -- Quita el default temporalmente
    alter table public.profiles alter column role drop default;

    -- Convierte la columna mapeando los roles antiguos
    alter table public.profiles
      alter column role type user_role_new
      using (
        case role::text
          when 'admin' then 'admin'::user_role_new
          else 'empleado'::user_role_new
        end
      );

    -- La función current_role() retorna user_role; hay que recrearla
    -- después porque depende del tipo viejo. La eliminamos primero.
    drop function if exists public.current_role();

    -- Reemplaza el tipo
    drop type user_role;
    alter type user_role_new rename to user_role;

    -- Restaura el default
    alter table public.profiles
      alter column role set default 'empleado'::user_role;

    raise notice 'Enum user_role reconstruido correctamente.';
  else
    raise notice 'El enum user_role ya está actualizado, no se hace nada.';
  end if;
end $$;

-- ============================================================
--  PASO 2 — Recrear la función current_role() con el nuevo tipo
-- ============================================================
create or replace function public.current_role()
returns user_role
language sql security definer stable as $$
  select role from public.profiles where id = auth.uid();
$$;

-- ============================================================
--  PASO 3 — Actualizar metadata en auth.users
--  Esto hace que los usuarios viejos tengan el rol nuevo
--  cuando vuelvan a iniciar sesión.
-- ============================================================
update auth.users
   set raw_user_meta_data = jsonb_set(
     coalesce(raw_user_meta_data, '{}'::jsonb),
     '{role}',
     '"empleado"'::jsonb
   )
 where raw_user_meta_data->>'role' in ('cocina', 'mesero');

-- ============================================================
--  PASO 4 — Recrear el trigger handle_new_user con default 'empleado'
-- ============================================================
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

-- ============================================================
--  PASO 5 — Recrear todas las políticas RLS con los roles nuevos
-- ============================================================

-- ---- PROFILES ----
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

-- ---- PRODUCTS ----
drop policy if exists "products_read_all"    on public.products;
drop policy if exists "products_admin_write" on public.products;

create policy "products_read_all" on public.products
  for select using (auth.role() = 'authenticated');
create policy "products_admin_write" on public.products
  for all using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- ---- ORDERS ----
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

-- ---- ORDER_ITEMS ----
drop policy if exists "order_items_read"  on public.order_items;
drop policy if exists "order_items_write" on public.order_items;

create policy "order_items_read" on public.order_items
  for select using (auth.role() = 'authenticated');
create policy "order_items_write" on public.order_items
  for all using (public.current_role() in ('admin','empleado'))
  with check (public.current_role() in ('admin','empleado'));

-- ---- EXPENSES (solo admin: empleado NO ve gastos) ----
drop policy if exists "expenses_read"  on public.expenses;
drop policy if exists "expenses_admin" on public.expenses;

create policy "expenses_read" on public.expenses
  for select using (public.current_role() = 'admin');
create policy "expenses_admin" on public.expenses
  for all using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- ============================================================
--  VERIFICACIÓN FINAL
-- ============================================================

-- Lista los valores válidos del enum user_role
select unnest(enum_range(null::user_role)) as roles_validos;

-- Cuenta usuarios por rol después de la migración
select role, count(*) as total
from public.profiles
group by role
order by role;
