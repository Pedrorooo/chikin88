# Migración 010 — Mayonesa extra + bug del borrador (mayo 2026)

## Resumen

Tres cambios en una sola entrega:

1. **Bug del borrador al vaciar (frontend, sin SQL):** el botón "Vaciar" o eliminar el último item ahora **descartan** el borrador. No vuelve a aparecer al regresar a "Nuevo".
2. **Mayonesa extra (BD + RPC + UI + reportes):** stepper [-] N [+] al lado de "Con/Sin mayo", $0.25 por unidad.
3. **Botón "Extra" de salsas removido (solo UI):** las salsas extra siguen cobrándose automáticamente cuando se eligen más salsas que las incluidas. La BD acepta el valor `'extra'` por compatibilidad con datos antiguos.

## Cómo correr la migración

1. Abre Supabase → tu proyecto → **SQL Editor** → **New query**.
2. Copia el contenido completo de `supabase/migration_010_mayo_extra.sql`.
3. Pega en el editor y presiona **Run**.
4. Al final verás un `SELECT` de verificación: debe listar la columna `mayo_extra` en `orders` con default `0`.

La migración es **idempotente**: se puede correr varias veces sin problema (`ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`).

## Qué cambia

### En la base de datos

**`orders`** — nueva columna:
- `mayo_extra int not null default 0` con check `>= 0`.

Pedidos antiguos quedan con `mayo_extra = 0` por default. Nada se rompe.

### En la RPC `create_order_with_items`

1. Lee `mayo_extra` del payload.
2. Si `with_mayo = false`, fuerza `mayo_extra = 0` antes de guardar.
3. Si `mayo_extra < 0`, lo normaliza a 0.
4. Suma `mayo_extra × $0.25` al total en pedidos con promo estudiante (recálculo backend).
5. En pedidos sin promo estudiante, confía en el total que envía el frontend (que ya suma la mayo extra).

### En el frontend

- **`NewOrder.jsx`**:
  - Stepper `[-] N [+]` justo debajo de Mayonesa/Cubierto.
  - Si Mayonesa = Sin, el stepper queda visualmente deshabilitado y forzado a 0.
  - Total muestra "Mayonesa extra ×N +$0.50" cuando aplica.
  - Botón "Vaciar" ahora descarta items + draft + reqId (genera nuevo ID para el próximo pedido).
  - Eliminar el último item también limpia draft + reqId.
  - Botón "Extra" del modo de salsa eliminado (3 botones: Con / Sin / Aparte).
- **`Kitchen.jsx`** y **`Orders.jsx`**: chip "Mayo extra ×N" cuando hay extras.
- **`Reports.jsx` / `exports.js`** (CSV/Excel/PDF): columnas "Mayo" y "Mayo extra"; KPI "Mayonesa extra (unidades)" y "Mayonesa extra (ingresos)".
- **`orderDraft.js`**: un draft sin items ya no se considera válido — antes el nombre solo bastaba para que el draft persistiera, ahora se descarta.

### En el backend

- **`api/order-edit.js`**: whitelist actualizada para aceptar edición de `mayo_extra`.
- **`api/create-order.js`**: NO se tocó (toda la lógica nueva pasa por la RPC).

## Casos de prueba

| # | Escenario | Esperado |
|---|-----------|----------|
| 1 | Combo Full $16.50, Mayo Con, extra 0 | Total $16.50 |
| 2 | Combo Full $16.50, Mayo Con, extra 2 | Total $17.00 (+$0.50) |
| 3 | Cualquier producto, Mayo Sin | Stepper deshabilitado, mayo extra = 0, sin recargo |
| 4 | Combo con 5 salsas (incluye 3) | Cobra 2 × $0.25 = $0.50 automáticamente, sin botón Extra |
| 5 | Crear pedido, presionar Vaciar, ir a Cocina, volver a Nuevo | Formulario limpio, sin borrador recuperado |
| 6 | Crear pedido, NO vaciar, recargar página | Borrador se recupera |
| 7 | Eliminar el último producto del carrito, ir a Cocina, volver a Nuevo | Sin borrador recuperado |
| 8 | Pedroestudiante + Combo XXL + Mayo extra 1 | (8.50 × 0.9) + 0.25 = $7.90 |
| 9 | Nicolas88 con descuento empleado + Mayo extra 2 | Precio empleado + $0.50 |

## Reglas que se mantienen

- ✅ Idempotencia con `client_request_id`.
- ✅ Trigger `handle_benefit_order` (beneficios empleado/dueño).
- ✅ Dueños sin límite diario/semanal.
- ✅ Promo estudiante 10% en combos elegibles.
- ✅ RLS activo.
- ✅ Anti-cache en endpoints.
- ✅ Datos antiguos con `sauce_mode = 'extra'` siguen siendo válidos en BD (compat).
