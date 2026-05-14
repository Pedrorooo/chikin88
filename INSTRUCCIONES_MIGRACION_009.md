# Migración 009 — Promo Estudiante (mayo 2026)

## Resumen

Agrega un descuento del **10%** automático a clientes cuyo nombre termine en `estudiante` (case-insensitive).

- ✅ Aplica solo a combos de pollo de categoría **Principales** (Combo Económico, Especial, XXL, Full, y cualquier combo de pollo futuro).
- ❌ **NO** aplica a Combo Ramen, Ramen solo, Ramen sin preparar, bebidas, extras, palillos, salsas extra ni delivery.
- 🔒 El **backend es la fuente final de verdad**: la RPC `create_order_with_items` detecta la promo por el nombre del cliente, recalcula todos los descuentos y persiste los totales. El frontend NO puede manipular el descuento.
- 🚫 Mutuamente excluyente con beneficios de empleado/dueño: nombres con sufijo `88` no activan promo estudiante.

## Cómo correr la migración

1. Abre Supabase → tu proyecto → **SQL Editor** → **New query**.
2. Copia el contenido completo de `supabase/migration_009_student_promo.sql`.
3. Pega en el editor y presiona **Run**.
4. Al final verás 2 `SELECT` de verificación: deben listar las nuevas columnas en `orders` y `order_items`.

La migración es **idempotente**: se puede correr varias veces sin problema (`ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`).

## Qué cambia

### En la base de datos

**`orders`** — nuevas columnas:
- `discount_type text` (null o `'student'`)
- `discount_label text` (ej. `'Promo estudiante 10%'`)
- `discount_amount numeric(10,2) default 0`

**`order_items`** — nuevas columnas:
- `original_unit_price numeric(10,2)` — precio del menú (solo si hubo descuento)
- `discount_rate numeric(5,4) default 0` — `0.10` para estudiante
- `discount_amount numeric(10,2) default 0` — monto descontado en ese item
- `discount_type text` — `'student'` o null

Pedidos antiguos quedan con `discount_amount = 0` y `discount_type = null` por default. Reportes históricos no cambian.

### En la RPC `create_order_with_items`

1. Detecta promo estudiante: `lower(trim(customer_name)) like '%estudiante'`.
2. Si activa: itera items, aplica 10% sobre `unit_price * quantity` solo en items elegibles (categoría `'Principales'` y nombre no empieza con `'combo ramen'`).
3. Recalcula `orders.subtotal`, `orders.total` y `orders.discount_amount` **ignorando** los valores enviados por el frontend.
4. Si no es estudiante: comportamiento idéntico al anterior (compat con beneficios de empleado/dueño).

### En el frontend

- `NewOrder.jsx`: banner verde "🎓 Promo estudiante activa", precios tachados en catálogo, badge "🎓 PROMO ESTUDIANTE -10%" en items del carrito, línea "Descuento estudiante (10%)" en el resumen.
- `Kitchen.jsx`: chip "🎓 Promo estudiante" en la tarjeta del pedido.
- `Orders.jsx`: badge "🎓 PROMO ESTUDIANTE" en la lista de pedidos.
- `Reports.jsx`: tarjeta info con conteo y descuento total, badge "🎓 EST" en tabla de detalle.
- `exports.js` (CSV/Excel/PDF): columnas "Descuento" y "Promo", KPI "Descuento estudiante total".
- `daily-report.js` (email cron): fila "🎓 Promo estudiante (N pedidos)" en el resumen general.

## Casos de prueba

| # | Cliente | Productos | Total esperado |
|---|---------|-----------|----------------|
| 1 | `Pedroestudiante` | Combo Económico $3.50 | $3.15 |
| 2 | `MariaEstudiante` | Combo XXL $8.50 | $7.65 |
| 3 | `Juanestudiante` | Combo Ramen $7.50 | $7.50 (sin descuento) |
| 4 | `Anaestudiante` | Combo Especial $5.50 + Agua $0.75 | $5.70 (5.50×0.9 + 0.75 = 4.95 + 0.75) |
| 5 | `Pedro normal` | Combo Especial $5.50 | $5.50 (sin descuento) |
| 6 | `Pedroestudiante` | 2× Combo XXL $8.50 | $15.30 ((8.50×2)×0.9) |

## Reglas que se mantienen

- ✅ Idempotencia con `client_request_id`.
- ✅ Trigger `handle_benefit_order` para beneficios empleados/dueños.
- ✅ Dueños sin límite diario/semanal.
- ✅ RLS activo.
- ✅ Anti-cache en endpoints.
- ✅ Wake lock en Cocina.
- ✅ Polling adaptativo + realtime.

