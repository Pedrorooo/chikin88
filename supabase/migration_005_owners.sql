-- ============================================================
--  MIGRACIÓN 005 — Excepción de "dueños" (mayo 2026)
--
--  Cindy88, Daivid88 y Stephano88 son dueños:
--    • Pueden usar descuento ilimitadas veces al día.
--    • Pueden usar cortesía ilimitadas veces a la semana.
--    • Cada uso queda registrado en employee_benefit_usage.
--    • Los demás empleados mantienen sus límites diario/semanal.
--
--  GARANTÍAS DE SEGURIDAD:
--    ✅ NO usa DROP TABLE
--    ✅ NO usa DROP SCHEMA
--    ✅ NO borra pedidos, gastos, usuarios ni usos previos
--    ✅ Sólo agrega 1 columna y reconstruye 2 índices únicos
--    ✅ Idempotente (puede correrse varias veces)
--    ✅ Recrear índices NO borra datos, solo cambia las reglas a futuro
-- ============================================================


-- ============================================================
--  1. Columna "role" en employees
-- ============================================================
alter table public.employees
  add column if not exists role text not null default 'empleado'
    check (role in ('empleado', 'dueño'));


-- ============================================================
--  2. Marcar a los 3 dueños
-- ============================================================
update public.employees
   set role = 'dueño'
 where username in ('Cindy88', 'Daivid88', 'Stephano88');

-- (Si alguno todavía no estuviera en la tabla, lo inserta como dueño)
insert into public.employees (username, role)
values ('Cindy88', 'dueño'), ('Daivid88', 'dueño'), ('Stephano88', 'dueño')
on conflict (username) do update set role = 'dueño';


-- ============================================================
--  3. Reemplazar índices únicos para que excluyan a los dueños
--  Esto NO borra datos: un índice es solo una estructura auxiliar.
-- ============================================================
drop index if exists public.uniq_employee_discount_per_day;
drop index if exists public.uniq_employee_courtesy_per_week;

-- Empleados normales: 1 descuento por día (los dueños quedan fuera del índice)
create unique index if not exists uniq_employee_discount_per_day
  on public.employee_benefit_usage (employee_username, used_date)
  where benefit_type = 'discount'
    and employee_username not in ('Cindy88', 'Daivid88', 'Stephano88');

-- Empleados normales: 1 cortesía por semana ISO
create unique index if not exists uniq_employee_courtesy_per_week
  on public.employee_benefit_usage (employee_username, used_iso_week)
  where benefit_type = 'courtesy'
    and employee_username not in ('Cindy88', 'Daivid88', 'Stephano88');


-- ============================================================
--  4. Trigger actualizado: dueños saltan la validación de duplicado
-- ============================================================
create or replace function public.handle_benefit_order()
returns trigger language plpgsql as $$
declare
  v_date date;
  v_week text;
  v_role text;
begin
  if new.benefit_type is null or new.benefit_employee is null then
    return new;
  end if;

  -- Trae el role del empleado/dueño. Falla si no existe o está inactivo.
  select role into v_role
  from public.employees
  where username = new.benefit_employee and active = true;

  if v_role is null then
    raise exception 'EMPLOYEE_NOT_FOUND: % no es un empleado válido', new.benefit_employee
      using errcode = 'P0001';
  end if;

  -- Día y semana ISO en zona horaria Ecuador
  v_date := (new.created_at at time zone 'America/Guayaquil')::date;
  v_week := to_char(v_date, 'IYYY-"W"IW');

  -- Dueños: no se aplican límites diarios/semanales.
  -- Igual registramos el uso para tener historial.
  if v_role = 'dueño' then
    insert into public.employee_benefit_usage
      (employee_username, benefit_type, order_id, used_date, used_iso_week)
    values
      (new.benefit_employee, new.benefit_type, new.id, v_date, v_week);
    return new;
  end if;

  -- Empleados normales: validar duplicado por día/semana
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

-- El trigger en sí (trg_order_benefit) ya existe de la migración 004 y NO
-- necesita recrearse: apunta a la función handle_benefit_order que acabamos
-- de reemplazar con CREATE OR REPLACE.


-- ============================================================
--  5. Verificación
-- ============================================================
-- Roles asignados
select username, role from public.employees order by role desc, username;

-- Índices recreados (deben aparecer ambos)
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'employee_benefit_usage'
  and indexname like 'uniq_employee_%';
