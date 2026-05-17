-- ============================================================
--  MIGRACIÓN 013 — Sabores + delivery payment + ramen Carne
--                  (mayo 2026, post-Fase B)
--
--  Cambios:
--   1) order_items.item_flavor (text, nullable) — sabor para bebidas
--      con variantes y para "Salsa extra". No mezcla con ramen_type.
--   2) orders.delivery_payment_method (text con check) — solo aplica
--      si is_delivery = true; indica si los $X de delivery se pagaron
--      en efectivo o transferencia, INDEPENDIENTE del payment_method
--      del pedido en sí.
--   3) Extender check de order_items.ramen_type para aceptar 'carne'.
--   4) Insertar producto "Salsa extra" en Extras a $0.25.
--   5) Actualizar la RPC create_order_with_items para persistir
--      item_flavor y delivery_payment_method.
--
--  GARANTÍAS:
--    OK Idempotente: ADD COLUMN IF NOT EXISTS, ON CONFLICT DO NOTHING.
--    OK No usa DROP TABLE / DROP SCHEMA.
--    OK No borra ni modifica destructivamente ningún pedido real.
--    OK El check de ramen_type se reemplaza con DROP CONSTRAINT IF EXISTS
--       (drop de CONSTRAINT, NO de tabla) — totalmente seguro.
--    OK Datos antiguos quedan con item_flavor=NULL (compat completa).
--    OK La RPC mantiene TODO lo de Fase B (pago mixto, numeración diaria,
--       promo estudiante, mayo extra, idempotencia, etc.).
-- ============================================================


-- ============================================================
--  1. item_flavor en order_items
-- ============================================================
alter table public.order_items
  add column if not exists item_flavor text;


-- ============================================================
--  2. delivery_payment_method en orders
--     Valores aceptados: 'efectivo', 'transferencia' o NULL.
-- ============================================================
alter table public.orders
  add column if not exists delivery_payment_method text;

do $$ begin
  alter table public.orders
    add constraint orders_delivery_payment_method_check
    check (
      delivery_payment_method is null
      or delivery_payment_method in ('efectivo','transferencia')
    );
exception when duplicate_object then null;
end $$;


-- ============================================================
--  3. Extender check de ramen_type para aceptar 'carne'.
--
--  El check original (migración 004) era anónimo:
--    check (ramen_type in ('picante','carbonara'))
--  Buscamos el nombre real generado por PostgreSQL para ese check
--  y lo reemplazamos con uno nombrado que incluye 'carne'.
-- ============================================================
do $$
declare
  v_constraint_name text;
begin
  -- Buscar el check anónimo existente sobre ramen_type
  select con.conname into v_constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
  where rel.relname = 'order_items'
    and att.attname = 'ramen_type'
    and con.contype = 'c'
  limit 1;

  if v_constraint_name is not null then
    execute format('alter table public.order_items drop constraint %I', v_constraint_name);
  end if;
end $$;

do $$ begin
  alter table public.order_items
    add constraint order_items_ramen_type_check
    check (
      ramen_type is null
      or ramen_type in ('picante','carbonara','carne')
    );
exception when duplicate_object then null;
end $$;


-- ============================================================
--  4. Producto "Salsa extra" en Extras
--
--  $0.25, sin extras, sin salsas incluidas.
--  Se inserta con ON CONFLICT DO NOTHING. Si ya existe (porque
--  alguien lo agregó manualmente), no pasa nada.
-- ============================================================
insert into public.products (name, category, price, allows_extras, free_sauces, display_order)
select
  'Salsa extra',
  'Extras',
  0.25,
  false,
  0,
  99
where not exists (
  select 1
  from public.products
  where lower(name) = lower('Salsa extra')
);


-- ============================================================
--  5. RPC create_order_with_items
--
--  Mantiene TODO lo de migración 012 (Fase B):
--    - Idempotencia con client_request_id
--    - Detección de promo estudiante (10% en combos elegibles)
--    - Mayonesa extra ($0.25/unidad, fuerza 0 si Sin mayo)
--    - Pago mixto (valida cash + transfer = total con tolerancia 1¢)
--    - Numeración diaria atómica con daily_order_counters
--
--  Cambios respecto a Fase B:
--    - Persiste item_flavor de cada item.
--    - Persiste delivery_payment_method del pedido.
--    - Si is_delivery=false, fuerza delivery_payment_method=NULL.
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
  v_with_mayo boolean;
  v_mayo_extra int;
  v_mayo_extra_total numeric(10,2);
  v_mayo_unit numeric(10,2) := 0.25;

  v_payment_method public.payment_method;
  v_cash_amount numeric(10,2);
  v_transfer_amount numeric(10,2);

  v_is_delivery boolean;
  v_delivery_pay text;

  v_business_date date;
  v_daily_number int;

  v_item_qty int;
  v_item_unit_price numeric(10,2);
  v_item_input_subtotal numeric(10,2);
  v_item_discount numeric(10,2);
  v_item_eligible boolean;
  v_item_category text;
  v_item_name_lower text;
  v_item_final_subtotal numeric(10,2);
begin
  -- 1. Idempotency
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

  -- 2. Detectar promo estudiante
  v_customer_name_norm := lower(trim(coalesce(payload->>'customer_name', '')));
  v_is_student := v_customer_name_norm like '%estudiante';
  if v_is_student then
    v_discount_type  := 'student';
    v_discount_label := 'Promo estudiante 10%';
  else
    v_discount_type  := null;
    v_discount_label := null;
  end if;

  -- 3. Mayo extra
  v_with_mayo := coalesce((payload->>'with_mayo')::boolean, true);
  v_mayo_extra := coalesce((payload->>'mayo_extra')::int, 0);
  if v_mayo_extra < 0 then v_mayo_extra := 0; end if;
  if not v_with_mayo then v_mayo_extra := 0; end if;
  v_mayo_extra_total := round(v_mayo_extra * v_mayo_unit, 2);

  -- 4. Subtotal / total / descuento
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

    v_total := round(v_subtotal + v_palillos_extra + v_delivery_fee + v_mayo_extra_total, 2);
  else
    v_subtotal := coalesce((payload->>'subtotal')::numeric, 0);
    v_total    := coalesce((payload->>'total')::numeric, 0);
    v_total_discount := 0;
  end if;

  -- 5. Pago
  v_payment_method := coalesce(
    nullif(payload->>'payment_method', '')::public.payment_method,
    'efectivo'
  );
  v_cash_amount := coalesce((payload->>'cash_amount')::numeric, 0);
  v_transfer_amount := coalesce((payload->>'transfer_amount')::numeric, 0);
  if v_cash_amount < 0 then v_cash_amount := 0; end if;
  if v_transfer_amount < 0 then v_transfer_amount := 0; end if;

  if v_payment_method = 'efectivo' then
    v_cash_amount := v_total;
    v_transfer_amount := 0;
  elsif v_payment_method = 'transferencia' then
    v_cash_amount := 0;
    v_transfer_amount := v_total;
  elsif v_payment_method = 'mixto' then
    if abs((v_cash_amount + v_transfer_amount) - v_total) > 0.01 then
      raise exception 'PAYMENT_SPLIT_MISMATCH cash=% transfer=% total=%',
        v_cash_amount, v_transfer_amount, v_total
        using errcode = 'P0001';
    end if;
    if v_cash_amount = 0 and v_transfer_amount = 0 then
      raise exception 'PAYMENT_SPLIT_EMPTY ambos montos son cero'
        using errcode = 'P0001';
    end if;
  end if;

  -- 6. Delivery payment method (solo si is_delivery)
  v_is_delivery := coalesce((payload->>'is_delivery')::boolean, false);
  v_delivery_pay := nullif(payload->>'delivery_payment_method', '');
  if not v_is_delivery then
    v_delivery_pay := null;
  elsif v_delivery_pay is not null
        and v_delivery_pay not in ('efectivo','transferencia') then
    v_delivery_pay := null;
  end if;

  -- 7. Número diario atómico
  v_business_date := (now() at time zone 'America/Guayaquil')::date;
  insert into public.daily_order_counters (business_date, last_number)
  values (v_business_date, 1)
  on conflict (business_date)
    do update set last_number = public.daily_order_counters.last_number + 1
  returning last_number into v_daily_number;

  -- 8. INSERT order
  insert into public.orders (
    customer_name, customer_phone, status, order_type, is_delivery,
    delivery_fee, delivery_payment_method,
    with_mayo, mayo_extra, utensil,
    payment_method, cash_amount, transfer_amount,
    notes, subtotal, total, created_by,
    benefit_type, benefit_employee, client_request_id,
    discount_type, discount_label, discount_amount,
    business_date, daily_order_number
  ) values (
    payload->>'customer_name',
    nullif(payload->>'customer_phone', ''),
    coalesce((nullif(payload->>'status', ''))::public.order_status, 'pendiente'),
    coalesce((nullif(payload->>'order_type', ''))::public.order_type, 'para_llevar'),
    v_is_delivery,
    v_delivery_fee,
    v_delivery_pay,
    v_with_mayo,
    v_mayo_extra,
    coalesce(nullif(payload->>'utensil', ''), 'tenedor'),
    v_payment_method,
    v_cash_amount,
    v_transfer_amount,
    nullif(payload->>'notes', ''),
    v_subtotal,
    v_total,
    nullif(payload->>'created_by', '')::uuid,
    nullif(payload->>'benefit_type', ''),
    nullif(payload->>'benefit_employee', ''),
    v_client_req_id,
    v_discount_type,
    v_discount_label,
    v_total_discount,
    v_business_date,
    v_daily_number
  )
  returning * into v_order;

  -- 9. INSERT order_items (con item_flavor)
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
        order_id, product_id, product_name, product_category,
        unit_price, quantity, sauces, sauce_mode, ramen_type, subtotal,
        original_unit_price, discount_rate, discount_amount, discount_type,
        item_flavor
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
        case when v_item_eligible then 'student' else null end,
        nullif(v_item->>'item_flavor', '')
      );
    end loop;
  end if;

  -- 10. Devolver pedido completo
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
--  6. Verificación (lectura, sin efectos)
-- ============================================================
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'order_items'
  and column_name = 'item_flavor';

select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'orders'
  and column_name = 'delivery_payment_method';

select count(*) as salsa_extra_count
from public.products
where name = 'Salsa extra';
