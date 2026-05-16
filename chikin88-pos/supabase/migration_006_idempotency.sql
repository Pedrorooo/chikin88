-- ============================================================
--  MIGRACIÓN 006 — Estabilidad: idempotency + índices realtime
--  (mayo 2026)
--
--  Esta migración es CHICA y SEGURA. Soluciona dos cosas:
--
--   1. Evitar pedidos duplicados cuando el camarero reintenta
--      por mala conexión. Cada pedido lleva un client_request_id
--      único generado en el navegador. Si la BD ya tiene uno
--      con ese ID, el frontend lo detecta y NO crea otro.
--
--   2. Acelerar las consultas que dependen del realtime
--      (cocina, pedidos del día) con índices que faltaban.
--
--  GARANTÍAS DE SEGURIDAD:
--    ✅ NO usa DROP TABLE
--    ✅ NO usa DROP SCHEMA
--    ✅ NO borra pedidos, ventas, gastos ni usuarios
--    ✅ Solo agrega 1 columna nueva (nullable) + índices
--    ✅ Idempotente (puede correrse varias veces)
-- ============================================================

-- 1. Columna nueva para idempotency
alter table public.orders
  add column if not exists client_request_id uuid;

-- 2. Índice único parcial (sólo cuando hay valor)
-- Pedidos antiguos sin client_request_id NO bloquean nada.
create unique index if not exists uniq_orders_client_request_id
  on public.orders (client_request_id)
  where client_request_id is not null;

-- 3. Índices de performance para realtime (si faltaban)
create index if not exists idx_orders_status_active
  on public.orders (status, created_at desc)
  where deleted_from_reports = false
    and status in ('pendiente', 'en_preparacion', 'listo');

create index if not exists idx_orders_today
  on public.orders (created_at desc)
  where deleted_from_reports = false;

-- 4. Asegurar realtime en publication (idempotente)
do $$
begin
  begin
    alter publication supabase_realtime add table public.orders;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.order_items;
  exception when duplicate_object then null;
  end;
end $$;

-- 5. Verificación
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'orders'
  and column_name = 'client_request_id';

select indexname from pg_indexes
where schemaname = 'public'
  and indexname in ('uniq_orders_client_request_id', 'idx_orders_status_active', 'idx_orders_today');
