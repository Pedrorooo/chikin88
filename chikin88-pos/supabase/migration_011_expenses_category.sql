-- ============================================================
--  MIGRACIÓN 011 — Fase A (mayo 2026)
--
--  Cambio mínimo de BD para arreglar el bug de gastos.
--
--  El frontend y `/api/expenses` ya enviaban una propiedad
--  `category` al insertar gastos, pero la tabla `expenses` no
--  tenía esa columna y Supabase devolvía:
--    "Could not find the 'category' column of 'expenses' in
--     the schema cache"
--
--  Solución: agregar la columna con default seguro. Idempotente.
--
--  GARANTÍAS:
--    OK No usa DROP TABLE
--    OK No usa DROP SCHEMA
--    OK No borra gastos existentes
--    OK Gastos previos quedan con category = 'general' por default
-- ============================================================

alter table public.expenses
  add column if not exists category text not null default 'general';

create index if not exists idx_expenses_category on public.expenses(category);

-- Verificación (solo SELECT)
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'expenses'
  and column_name = 'category';
