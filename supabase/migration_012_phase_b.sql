-- ============================================================
--  MIGRACIÓN 012 — Fase B (mayo 2026)
--
--  Dos cambios:
--    1) Pago mixto: agregar enum 'mixto' + columnas cash_amount
--       y transfer_amount en orders. Backfill de pedidos existentes.
--    2) Número de pedido diario: agregar columnas business_date y
--       daily_order_number con counter concurrency-safe (tabla
--       daily_order_counters). Backfill de pedidos previos a HOY
--       (los pedidos de HOY no se renumeran — opción A elegida).
--    3) RPC create_order_with_items: actualizada para reservar el
--       número diario y validar/distribuir pago mixto.
--    4) Vista daily_sales: actualizada para sumar cash_amount /
--       transfer_amount de pedidos 'mixto'.
--
--  GARANTÍAS:
--    OK Idempotente: ADD COLUMN IF NOT EXISTS, ADD VALUE IF NOT EXISTS,
--       CREATE OR REPLACE FUNCTION, CREATE TABLE IF NOT EXISTS.
--    OK No usa DROP TABLE / DROP SCHEMA.
--    OK No borra ni modifica destructivamente ningún pedido real.
--    OK Pedidos de HOY conservan su order_number global y NO se
--       renumeran (opción A). El daily_order_number arranca con el
--       PRÓXIMO pedido creado tras aplicar la migración.
--    OK Pedidos de fechas pasadas reciben daily_order_number en
--       orden cronológico (solo asignación a NULL, sin sobrescribir).
--    OK El counter usa INSERT ... ON CONFLICT DO UPDATE atómico que
--       garantiza unicidad por (business_date, daily_order_number)
--       incluso con pedidos concurrentes.
-- ============================================================


-- ============================================================
--  1. PAGO MIXTO
-- ============================================================

-- 1.1 Extender enum payment_method con 'mixto'
do $$ begin
  alter type public.payment_method add value if not exists 'mixto';
exception when others then null;
end $$;

-- 1.2 Columnas de montos
alter table public.orders
  add column if not exists cash_amount     numeric(10,2) not null default 0,
  add column if not exists transfer_amount numeric(10,2) not null default 0;

do $$ begin
  alter table public.orders
    add constraint orders_cash_amount_nonneg check (cash_amount >= 0);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.orders
    add constraint orders_transfer_amount_nonneg check (transfer_amount >= 0);
exception when duplicate_object then null;
end $$;

-- 1.3 Backfill de pedidos existentes
--     'efectivo' o 'transferencia' → asigna total a la columna respectiva
--     solo si el campo está aún en 0 (no sobrescribe si ya tenía algo).
update public.orders
   set cash_amount = total
 where payment_method = 'efectivo'
   and cash_amount = 0
   and total is not null;

update public.orders
   set transfer_amount = total
 where payment_method = 'transferencia'
   and transfer_amount = 0
   and total is not null;


-- ============================================================
--  2. NUMERACIÓN DIARIA
-- ============================================================

-- 2.1 Columnas
alter table public.orders
  add column if not exists business_date       date,
  add column if not exists daily_order_number  int;

-- 2.2 Índice único parcial (solo aplica cuando ambas columnas están seteadas)
create unique index if not exists ux_orders_daily_number
  on public.orders (business_date, daily_order_number)
  where business_date is not null and daily_order_number is not null;

-- 2.3 Tabla counter por fecha (concurrency-safe)
create table if not exists public.daily_order_counters (
  business_date date primary key,
  last_number   int not null default 0
);

-- 2.4 Backfill de fechas PASADAS (no incluye HOY — opción A)
--     Asigna daily_order_number en orden cronológico por business_date.
--     Solo escribe en filas donde aún está null, así es seguro re-ejecutar.
do $$
declare
  v_today date := (now() at time zone 'America/Guayaquil')::date;
begin
  -- Setear business_date donde falte (todos los pedidos)
  update public.orders
     set business_date = (created_at at time zone 'America/Guayaquil')::date
   where business_date is null;

  -- Asignar números diarios SOLO a pedidos de fechas anteriores a HOY
  with numbered as (
    select
      id,
      row_number() over (
        partition by business_date
        order by created_at, id
      ) as rn
    from public.orders
    where business_date < v_today
      and daily_order_number is null
  )
  update public.orders o
     set daily_order_number = numbered.rn
    from numbered
   where o.id = numbered.id;

  -- Sembrar counters con el último número asignado por fecha
  insert into public.daily_order_counters (business_date, last_number)
  select business_date, max(daily_order_number)
    from public.orders
   where business_date is not null
     and daily_order_number is not null
   group by business_date
  on conflict (business_date)
  do update set last_number = greatest(
    public.daily_order_counters.last_number,
    excluded.last_number
  );
end $$;


-- ============================================================
--  3. RPC create_order_with_items actualizada
--
--  Cambios sobre la migración 010:
--    a) Acepta cash_amount / transfer_amount en payload (defaults 0).
--    b) Si payment_method = 'mixto', valida que cash + transfer = total
--       con tolerancia de 1 centavo (acumulación de floats).
--    c) Si payment_method = 'efectivo', asigna total → cash_amount.
--    d) Si payment_method = 'transferencia', asigna total → transfer_amount.
--    e) Reserva número diario con counter atómico (concurrency-safe).
--    f) Mantiene TODO lo anterior: idempotencia, promo estudiante,
--       beneficios empleado/dueño, mayo_extra, etc.
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

  -- ---------- 3. Mayonesa extra: si Sin mayo, forzar 0 ----------
  v_with_mayo := coalesce((payload->>'with_mayo')::boolean, true);
  v_mayo_extra := coalesce((payload->>'mayo_extra')::int, 0);
  if v_mayo_extra < 0 then v_mayo_extra := 0; end if;
  if not v_with_mayo then v_mayo_extra := 0; end if;
  v_mayo_extra_total := round(v_mayo_extra * v_mayo_unit, 2);

  -- ---------- 4. Pre-cálculo: subtotal/total/descuento ----------
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

  -- ---------- 5. PAGO: validar/distribuir cash y transfer ----------
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
    -- Validar que la suma cuadre con tolerancia de 1 centavo
    if abs((v_cash_amount + v_transfer_amount) - v_total) > 0.01 then
      raise exception 'PAYMENT_SPLIT_MISMATCH cash=% transfer=% total=%',
        v_cash_amount, v_transfer_amount, v_total
        using errcode = 'P0001';
    end if;
    -- Permitir 0 en una de las dos pero no en ambas (no tendría sentido 'mixto')
    if v_cash_amount = 0 and v_transfer_amount = 0 then
      raise exception 'PAYMENT_SPLIT_EMPTY ambos montos son cero'
        using errcode = 'P0001';
    end if;
  end if;

  -- ---------- 6. NÚMERO DIARIO: reservar atómicamente ----------
  v_business_date := (now() at time zone 'America/Guayaquil')::date;

  -- INSERT ... ON CONFLICT DO UPDATE es atómico: dos pedidos creados al
  -- mismo tiempo reciben números distintos sin race conditions.
  insert into public.daily_order_counters (business_date, last_number)
  values (v_business_date, 1)
  on conflict (business_date)
    do update set last_number = public.daily_order_counters.last_number + 1
  returning last_number into v_daily_number;

  -- ---------- 7. INSERT order ----------
  insert into public.orders (
    customer_name, customer_phone, status, order_type, is_delivery,
    delivery_fee, with_mayo, mayo_extra, utensil,
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
    coalesce((payload->>'is_delivery')::boolean, false),
    v_delivery_fee,
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

  -- ---------- 8. INSERT order_items ----------
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
        original_unit_price, discount_rate, discount_amount, discount_type
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

  -- ---------- 9. Devolver pedido completo ----------
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
--  4. Vista daily_sales: incluir cash_amount/transfer_amount
--     de pedidos 'mixto'.
-- ============================================================
create or replace view public.daily_sales as
select
  (created_at at time zone 'America/Guayaquil')::date as sale_date,
  count(*) filter (where status <> 'cancelado') as total_orders,
  count(*) filter (where status = 'cancelado')  as cancelled_orders,
  coalesce(sum(total) filter (where status <> 'cancelado'), 0) as total_revenue,
  coalesce(sum(
    case
      when status <> 'cancelado' and payment_method = 'efectivo' then total
      when status <> 'cancelado' and payment_method = 'mixto'    then cash_amount
      else 0
    end
  ), 0) as cash_revenue,
  coalesce(sum(
    case
      when status <> 'cancelado' and payment_method = 'transferencia' then total
      when status <> 'cancelado' and payment_method = 'mixto'         then transfer_amount
      else 0
    end
  ), 0) as transfer_revenue
from public.orders
group by 1;


-- ============================================================
--  5. Verificación
-- ============================================================
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'orders'
  and column_name in ('cash_amount','transfer_amount','business_date','daily_order_number')
order by column_name;

select enumlabel
from pg_enum
where enumtypid = (select oid from pg_type where typname = 'payment_method');

select count(*) as pedidos_con_business_date from public.orders where business_date is not null;
select count(*) as pedidos_con_numero_diario  from public.orders where daily_order_number is not null;
