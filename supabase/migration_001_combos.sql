-- ============================================================
--  MIGRACIÓN 001 — Nuevos combos Chikin88
--  Fecha: mayo 2026
--  Cómo correr:
--    1. Supabase → SQL Editor → New query
--    2. Pega TODO este archivo
--    3. Run
--  Es seguro correrla varias veces (no duplica productos).
-- ============================================================

-- Combo XXL ----------------------------------------------------
insert into public.products (name, category, price, allows_extras, display_order)
select 'Combo XXL', 'Principales', 8.50, true, -2
where not exists (select 1 from public.products where name = 'Combo XXL');

-- Si ya existe, asegura precio y extras correctos
update public.products
   set price = 8.50,
       allows_extras = true,
       category = 'Principales',
       display_order = -2,
       active = true
 where name = 'Combo XXL';

-- Combo Full ---------------------------------------------------
insert into public.products (name, category, price, allows_extras, display_order)
select 'Combo Full', 'Principales', 16.50, true, -1
where not exists (select 1 from public.products where name = 'Combo Full');

update public.products
   set price = 16.50,
       allows_extras = true,
       category = 'Principales',
       display_order = -1,
       active = true
 where name = 'Combo Full';

-- Confirma que Palillos sigue en 0.25 -------------------------
update public.products
   set price = 0.25
 where name = 'Palillos';

-- Verificación final ------------------------------------------
select name, category, price, allows_extras, display_order, active
from public.products
where name in ('Combo XXL', 'Combo Full', 'Palillos')
order by display_order;
