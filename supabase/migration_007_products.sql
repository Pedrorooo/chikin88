-- ============================================================
--  MIGRACIÓN 007 — Productos nuevos (mayo 2026)
--
--  Agrega 3 productos sin tocar nada existente:
--    • Ramen sin preparar  $4.50  (Ramen)
--    • Porción de papas    $1.50  (Extras)
--    • Caja extra          $0.25  (Extras)
--
--  GARANTÍAS DE SEGURIDAD:
--    ✅ NO usa DROP TABLE
--    ✅ NO usa DROP SCHEMA
--    ✅ NO borra ni modifica pedidos, ventas, gastos ni usuarios
--    ✅ Idempotente: el WHERE NOT EXISTS evita duplicados
--    ✅ Si ya corriste esto antes, no hace nada
-- ============================================================

insert into public.products (name, category, price, allows_extras, free_sauces, display_order)
select 'Ramen sin preparar', 'Ramen', 4.50, false, 0, 5
where not exists (select 1 from public.products where name = 'Ramen sin preparar');

insert into public.products (name, category, price, allows_extras, free_sauces, display_order)
select 'Porción de papas', 'Extras', 1.50, false, 0, 14
where not exists (select 1 from public.products where name = 'Porción de papas');

insert into public.products (name, category, price, allows_extras, free_sauces, display_order)
select 'Caja extra', 'Extras', 0.25, false, 0, 15
where not exists (select 1 from public.products where name = 'Caja extra');

-- Verificación: deben aparecer las 3 filas
select name, category, price, display_order
from public.products
where name in ('Ramen sin preparar', 'Porción de papas', 'Caja extra')
order by category, display_order;
