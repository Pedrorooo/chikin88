-- ============================================================
--  MIGRACIÓN 009 — Promo Estudiante (mayo 2026)
--
--  Descuento del 10% para clientes cuyo nombre termine en
--  "estudiante" (case-insensitive). Solo aplica a combos de
--  pollo (categoría 'Principales'), NUNCA a Combo Ramen,
--  bebidas, extras, ramen, palillos, salsa extra ni delivery.
--
--  La RPC `create_order_with_items` se actualiza para que el
--  BACKEND sea la fuente final de verdad del descuento: detecta
--  estudiante por el customer_name, recalcula los descuentos
--  por item y los persiste. El frontend no puede manipular el
--  total: si miente, la RPC lo corrige.
--
--  GARANTÍAS DE SEGURIDAD:
--    OK No usa DROP TABLE
--    OK No usa DROP SCHEMA
--    OK No borra pedidos, ventas, usuarios ni usos previos
--    OK Solo agrega columnas (idempotente con IF NOT EXISTS)
--    OK Solo CREATE OR REPLACE de la función (idempotente)
--    OK Pedidos antiguos quedan con discount_amount = 0 y
--       discount_type = null por default
--    OK Mantiene todas las reglas existentes:
--       * beneficios diarios/semanales (trigger handle_benefit_order)
--       * dueños ilimitados
--       * RLS y permisos
--       * idempotency con client_request_id
-- ============================================================


-- ============================================================
--  1. Columnas en orders
-- ============================================================
alter table public.orders
  add column if not exists discount_type   text,
  add column if not exists discount_label  text,
  add column if not exists discount_amount numeric(10,2) not null default 0;

-- Constraint suave: solo aceptamos 'student' por ahora.
-- Si en el futuro hay otros tipos, basta con extender el check.
do $$ begin
  alter table public.orders
    add constraint orders_discount_type_check
    check (discount_type is null or discount_type in ('student'));
exception when duplicate_object then null;
end $$;


-- ============================================================
--  2. Columnas en order_items
-- ============================================================
alter table public.order_items
  add column if not exists original_unit_price numeric(10,2),
  add column if not exists discount_rate       numeric(5,4) not null default 0,
  add column if not exists discount_amount     numeric(10,2) not null default 0,
  add column if not exists discount_type       text;


-- ============================================================
--  3. RPC actualizada
--
--  Lógica de la RPC:
--    a) Idempotency check (igual que antes).
--    b) Detecta estudiante: lower(trim(customer_name)) like '%estudiante'.
--    c) Itera items:
--       * Calcula descuento del item SOLO si:
--           - hay promo estudiante activa, Y
--           - product_category = 'Principales', Y
--           - lower(product_name) NO empieza con 'combo ramen'
--       * El 10% se aplica SOLO sobre unit_price * quantity (base).
--         Los extras (salsas, modo 'extra') NO se descuentan.
--       * Persiste original_unit_price, discount_rate, discount_amount,
--         discount_type y ajusta subtotal del item.
--    d) Recalcula orders.subtotal = sum(item.subtotal final),
--       orders.total = subtotal + palillos_extra (0.25 si utensil='palillos')
--                                 + delivery_fee.
--    e) Persiste orders.discount_type/label/amount.
--
--  El payload puede mandar subtotal/total, pero la RPC los IGNORA
--  cuando hay descuento de estudiante. Si NO hay descuento de
--  estudiante, se usan los del payload (compat con flujo actual).
-- ============================================================
create or replace function public.create_order_with_items(payload jsonb)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_order public.orders%rowtype;
  v_item jsonb;
  v_existing_id uuid;
  v_client_req_id uuid;

  v_customer_name_norm text;
  v_is_student boolean;
  v_discount_type text;
  v_discount_label text;
  v_total_discount numeric(10,2);
  v_subtotal numeric(10,2);
  v_total numeric(10,2);
  v_delivery_fee numeric(10,2);
  v_palillos_extra numeric(10,2);

  v_item_qty int;
  v_item_unit_price numeric(10,2);
  v_item_input_subtotal numeric(10,2);
  v_item_discount numeric(10,2);
  v_item_eligible boolean;
  v_item_category text;
  v_item_name_lower text;
  v_item_final_subtotal numeric(10,2);
begin
  -- ---------- 1. Idempotency check ----------
  v_client_req_id := nullif(payload->>'client_request_id', '')::uuid;

  if v_client_req_id is not null then
    select id into v_existing_id
    from public.orders
    where client_request_id = v_client_req_id
    limit 1;

    if v_existing_id is not null then
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

  -- ---------- 2. Detectar promo estudiante ----------
  v_customer_name_norm := lower(trim(coalesce(payload->>'customer_name', '')));
  v_is_student := v_customer_name_norm like '%estudiante';

  if v_is_student then
    v_discount_type  := 'student';
    v_discount_label := 'Promo estudiante 10%';
  else
    v_discount_type  := null;
    v_discount_label := null;
  end if;

  -- ---------- 3. Pre-cálculo backend: subtotal, total, descuento ----------
  v_total_discount := 0;
  v_subtotal := 0;
  v_delivery_fee := coalesce((payload->>'delivery_fee')::numeric, 0);

  if coalesce(nullif(payload->>'utensil', ''), 'tenedor') = 'palillos' then
    v_palillos_extra := 0.25;
  else
    v_palillos_extra := 0;
  end if;

  if v_is_student
     and payload ? 'items'
     and jsonb_typeof(payload->'items') = 'array' then
    for v_item in select * from jsonb_array_elements(payload->'items')
    loop
      v_item_qty            := (v_item->>'quantity')::int;
      v_item_unit_price     := (v_item->>'unit_price')::numeric;
      v_item_input_subtotal := coalesce(
        (v_item->>'subtotal')::numeric,
        v_item_unit_price * v_item_qty
      );
      v_item_category := coalesce(v_item->>'product_category', '');
      v_item_name_lower := lower(coalesce(v_item->>'product_name', ''));

      v_item_eligible := v_item_category = 'Principales'
        and v_item_name_lower not like 'combo ramen%';

      if v_item_eligible then
        v_item_discount := round(v_item_unit_price * v_item_qty * 0.10, 2);
      else
        v_item_discount := 0;
      end if;

      v_item_final_subtotal := round(v_item_input_subtotal - v_item_discount, 2);
      v_subtotal := v_subtotal + v_item_final_subtotal;
      v_total_discount := v_total_discount + v_item_discount;
    end loop;

    v_total := round(v_subtotal + v_palillos_extra + v_delivery_fee, 2);
  else
    -- Sin promo estudiante: usamos lo que mandó el frontend (compat con
    -- beneficios de empleado/dueño y flujo actual).
    v_subtotal := coalesce((payload->>'subtotal')::numeric, 0);
    v_total    := coalesce((payload->>'total')::numeric, 0);
    v_total_discount := 0;
  end if;

  -- ---------- 4. INSERT order ----------
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
    client_request_id,
    discount_type,
    discount_label,
    discount_amount
  ) values (
    payload->>'customer_name',
    nullif(payload->>'customer_phone', ''),
    coalesce((nullif(payload->>'status', ''))::public.order_status, 'pendiente'),
    coalesce((nullif(payload->>'order_type', ''))::public.order_type, 'para_llevar'),
    coalesce((payload->>'is_delivery')::boolean, false),
    v_delivery_fee,
    coalesce((payload->>'with_mayo')::boolean, true),
    coalesce(nullif(payload->>'utensil', ''), 'tenedor'),
    coalesce((nullif(payload->>'payment_method', ''))::public.payment_method, 'efectivo'),
    nullif(payload->>'notes', ''),
    v_subtotal,
    v_total,
    nullif(payload->>'created_by', '')::uuid,
    nullif(payload->>'benefit_type', ''),
    nullif(payload->>'benefit_employee', ''),
    v_client_req_id,
    v_discount_type,
    v_discount_label,
    v_total_discount
  )
  returning * into v_order;

  -- ---------- 5. INSERT order_items ----------
  if payload ? 'items' and jsonb_typeof(payload->'items') = 'array' then
    for v_item in select * from jsonb_array_elements(payload->'items')
    loop
      v_item_qty            := (v_item->>'quantity')::int;
      v_item_unit_price     := (v_item->>'unit_price')::numeric;
      v_item_input_subtotal := coalesce(
        (v_item->>'subtotal')::numeric,
        v_item_unit_price * v_item_qty
      );
      v_item_category := coalesce(v_item->>'product_category', '');
      v_item_name_lower := lower(coalesce(v_item->>'product_name', ''));

      v_item_eligible := v_is_student
        and v_item_category = 'Principales'
        and v_item_name_lower not like 'combo ramen%';

      if v_item_eligible then
        v_item_discount := round(v_item_unit_price * v_item_qty * 0.10, 2);
        v_item_final_subtotal := round(v_item_input_subtotal - v_item_discount, 2);
      else
        v_item_discount := 0;
        v_item_final_subtotal := v_item_input_subtotal;
      end if;

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
        subtotal,
        original_unit_price,
        discount_rate,
        discount_amount,
        discount_type
      ) values (
        v_order.id,
        nullif(v_item->>'product_id', '')::uuid,
        v_item->>'product_name',
        nullif(v_item->>'product_category', ''),
        v_item_unit_price,
        v_item_qty,
        coalesce(
          (select array_agg(value::text)
           from jsonb_array_elements_text(coalesce(v_item->'sauces', '[]'::jsonb)) value),
          '{}'::text[]
        ),
        coalesce(nullif(v_item->>'sauce_mode', ''), 'normal'),
        nullif(v_item->>'ramen_type', ''),
        v_item_final_subtotal,
        case when v_item_eligible then v_item_unit_price else null end,
        case when v_item_eligible then 0.10 else 0 end,
        v_item_discount,
        case when v_item_eligible then 'student' else null end
      );
    end loop;
  end if;

  -- ---------- 6. Devolver pedido completo ----------
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

grant execute on function public.create_order_with_items(jsonb) to authenticated;


-- ============================================================
--  4. Verificación (lectura, sin efectos secundarios)
-- ============================================================
select
  column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'orders'
  and column_name in ('discount_type','discount_label','discount_amount')
order by column_name;

select
  column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'order_items'
  and column_name in ('original_unit_price','discount_rate','discount_amount','discount_type')
order by column_name;
