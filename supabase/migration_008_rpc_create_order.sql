-- ============================================================
--  MIGRACIÓN 008 — Estabilidad: RPC transaccional
--  (mayo 2026)
--
--  Crea una función `create_order_with_items` que hace en UNA
--  sola transacción:
--    1. Idempotency check (si el client_request_id ya existe, lo devuelve)
--    2. INSERT en orders (dispara el trigger de beneficios)
--    3. INSERT en order_items
--    4. Devuelve el pedido completo con sus items
--
--  Si cualquier paso falla, PostgreSQL hace rollback automático.
--  Una sola llamada desde el frontend = menos puntos de fallo,
--  menos awaits, menos riesgo de quedarse a mitad del flujo.
--
--  GARANTÍAS DE SEGURIDAD:
--    ✅ NO usa DROP TABLE
--    ✅ NO usa DROP SCHEMA
--    ✅ NO borra ni modifica pedidos, ventas, gastos ni usuarios
--    ✅ Sólo CREA una función (CREATE OR REPLACE es idempotente)
--    ✅ Mantiene todas las reglas existentes:
--       • beneficios diarios/semanales (vía trigger handle_benefit_order)
--       • dueños ilimitados
--       • RLS y permisos
--    ✅ La firma del INSERT es la misma que el frontend usaba antes
-- ============================================================

create or replace function public.create_order_with_items(payload jsonb)
returns jsonb
language plpgsql
security invoker  -- Corre como el usuario que llama, respeta RLS
as $$
declare
  v_order public.orders%rowtype;
  v_item jsonb;
  v_existing_id uuid;
  v_client_req_id uuid;
begin
  -- ---------- 1. Idempotency check ----------
  v_client_req_id := nullif(payload->>'client_request_id', '')::uuid;

  if v_client_req_id is not null then
    select id into v_existing_id
    from public.orders
    where client_request_id = v_client_req_id
    limit 1;

    if v_existing_id is not null then
      -- Pedido ya existe: devolvemos el original sin crear duplicado
      return (
        select to_jsonb(o.*) || jsonb_build_object(
          'order_items', coalesce(
            (select jsonb_agg(to_jsonb(oi.*) order by oi.created_at)
             from public.order_items oi
             where oi.order_id = o.id),
            '[]'::jsonb
          ),
          '_idempotent_hit', true
        )
        from public.orders o
        where o.id = v_existing_id
      );
    end if;
  end if;

  -- ---------- 2. INSERT order ----------
  -- (esto dispara automáticamente trg_order_benefit si hay benefit_type)
  insert into public.orders (
    customer_name,
    customer_phone,
    status,
    order_type,
    is_delivery,
    delivery_fee,
    with_mayo,
    utensil,
    payment_method,
    notes,
    subtotal,
    total,
    created_by,
    benefit_type,
    benefit_employee,
    client_request_id
  ) values (
    payload->>'customer_name',
    nullif(payload->>'customer_phone', ''),
    coalesce((nullif(payload->>'status', ''))::public.order_status, 'pendiente'),
    coalesce((nullif(payload->>'order_type', ''))::public.order_type, 'para_llevar'),
    coalesce((payload->>'is_delivery')::boolean, false),
    coalesce((payload->>'delivery_fee')::numeric, 0),
    coalesce((payload->>'with_mayo')::boolean, true),
    coalesce(nullif(payload->>'utensil', ''), 'tenedor'),
    coalesce((nullif(payload->>'payment_method', ''))::public.payment_method, 'efectivo'),
    nullif(payload->>'notes', ''),
    coalesce((payload->>'subtotal')::numeric, 0),
    coalesce((payload->>'total')::numeric, 0),
    nullif(payload->>'created_by', '')::uuid,
    nullif(payload->>'benefit_type', ''),
    nullif(payload->>'benefit_employee', ''),
    v_client_req_id
  )
  returning * into v_order;

  -- ---------- 3. INSERT order_items ----------
  if payload ? 'items' and jsonb_typeof(payload->'items') = 'array' then
    for v_item in select * from jsonb_array_elements(payload->'items')
    loop
      insert into public.order_items (
        order_id,
        product_id,
        product_name,
        product_category,
        unit_price,
        quantity,
        sauces,
        sauce_mode,
        ramen_type,
        subtotal
      ) values (
        v_order.id,
        nullif(v_item->>'product_id', '')::uuid,
        v_item->>'product_name',
        nullif(v_item->>'product_category', ''),
        (v_item->>'unit_price')::numeric,
        (v_item->>'quantity')::int,
        coalesce(
          (select array_agg(value::text)
           from jsonb_array_elements_text(coalesce(v_item->'sauces', '[]'::jsonb)) value),
          '{}'::text[]
        ),
        coalesce(nullif(v_item->>'sauce_mode', ''), 'normal'),
        nullif(v_item->>'ramen_type', ''),
        (v_item->>'subtotal')::numeric
      );
    end loop;
  end if;

  -- ---------- 4. Devolver pedido completo con items ----------
  return to_jsonb(v_order) || jsonb_build_object(
    'order_items', coalesce(
      (select jsonb_agg(to_jsonb(oi.*) order by oi.created_at)
       from public.order_items oi
       where oi.order_id = v_order.id),
      '[]'::jsonb
    )
  );
end;
$$;

-- Permitir que usuarios autenticados llamen la función
grant execute on function public.create_order_with_items(jsonb) to authenticated;

-- Verificación
select pg_get_functiondef(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'create_order_with_items';
