-- ============================================================
--  MIGRACIÓN 002 — Salsas incluidas por producto
--  Fecha: mayo 2026
--  Cómo correr:
--    1. Supabase → SQL Editor → New query
--    2. Pega TODO este archivo
--    3. Run
--  Es seguro correrla varias veces.
-- ============================================================

-- 1. Agrega la columna que define cuántas salsas vienen incluidas
alter table public.products
  add column if not exists free_sauces int not null default 1;

-- 2. Productos sin salsas → free_sauces = 0
update public.products
   set free_sauces = 0
 where allows_extras = false;

-- 3. Productos con salsas → 1 salsa incluida por defecto
update public.products
   set free_sauces = 1
 where allows_extras = true
   and name <> 'Combo Full';

-- 4. Combo Full → 3 salsas incluidas
update public.products
   set free_sauces = 3
 where name = 'Combo Full';

-- 5. Verificación
select name, category, price, allows_extras, free_sauces, display_order
from public.products
order by display_order, name;
