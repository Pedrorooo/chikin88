# Fase C — Sabores + Delivery payment + Ramen Carne + Edición segura

Cambios mayo 2026, post Fase B.

## Cómo aplicar

1. **Supabase → SQL Editor → New query** → pegar `supabase/migration_013_flavors_and_delivery_payment.sql` → **Run**.
   Verificar los 3 SELECTs del final:
   - `item_flavor` aparece en `order_items` con type `text`.
   - `delivery_payment_method` aparece en `orders` con type `text`.
   - `salsa_extra_count` = 1.
2. Descomprimir el ZIP, reemplazar carpeta local, mantener `.env.local`.
3. `npm install` (sin cambios en `package.json`) → `npm run build`.
4. `git add . && git commit -m "feat: fase C sabores + delivery payment + carne" && git push`.
5. Vercel deploya solo. 12 functions.

## Cambios

### 1. Sabor para Bebida grande / Bebida pequeña

Cuando el item es **Bebida grande**, el carrito muestra un selector de sabor:
**Fuze tea**, **Coca cola**, **Guitig**.

Cuando es **Bebida pequeña**: **Fanta**, **Fanta uva**, **Sprite**, **Squizz**,
**Fiora fresa**, **Fiora manzana**.

El selector aparece con un chip rojo "ELIGE UNO" hasta que el usuario
selecciona. El botón **Enviar a cocina queda bloqueado** mientras un item
de bebida con variante no tenga sabor.

Persistencia: nueva columna `order_items.item_flavor text` (migración 013).
Pedidos antiguos quedan con `item_flavor = NULL` (compatibilidad total).

### 2. Salsa extra $0.25 como producto independiente

Nuevo producto en categoría **Extras**: "Salsa extra" $0.25, insertado por
migración con `ON CONFLICT DO NOTHING` (idempotente). El catálogo local
`src/data/products.js` también lo incluye como respaldo.

Cuando se agrega al carrito, aparece selector con las mismas salsas que los
combos (`SAUCES`): Coreana poco picante, Coreana picante, Maracuyá picante,
Maracuyá sin picante, Limón y pimienta, Ajo parmesano, Miel y mostaza,
Acevichada. Misma validación que las bebidas: sin sabor, no se puede enviar.

**Importante:** esto es **independiente** de la lógica automática de "salsa
extra por exceder las salsas incluidas" (`SAUCE_EXTRA_PRICE`). Esa sigue
funcionando exactamente igual. Aquí se agrega un item nuevo deliberadamente.

### 3. Ramen sabor Carne

`RAMEN_TYPES` ahora incluye `{ v: 'carne', l: 'Carne' }`. Aplica a Ramen
solo, Combo ramen y Ramen sin preparar (cualquier item de la categoría
Ramen). Visualmente: chip color `bg-orange-700` con emoji 🥩.

La migración extiende el check constraint de `order_items.ramen_type`:
busca el nombre auto-generado del check anónimo original (creado por la
migración 004), lo dropea (DROP CONSTRAINT, NO DROP TABLE), y crea uno
nombrado que acepta `'picante'`, `'carbonara'`, `'carne'` o NULL.

### 4. Edición de pedidos antes de entregado

Frontend (Orders.jsx) ya permitía editar en estados `pendiente`,
`en_preparacion`, `listo`. Eso queda igual.

**Backend reforzado:** `/api/order-edit` ahora **lee el estado actual
antes de aplicar el PATCH** y rechaza con HTTP 409 si:
- El pedido está `entregado` o `cancelado`.
- El pedido está anulado (`deleted_from_reports = true`).

Esto es defensa en profundidad: si un cliente desactualizado o malicioso
intenta mandar un PATCH a un pedido entregado, el backend lo bloquea.

También se agregó `delivery_payment_method` al whitelist editable.

### 5. Método de pago del delivery

Cuando se marca **Delivery = Sí** en NewOrder, debajo del input de valor
aparece un selector con 2 botones:
- **💵 Efectivo** (default)
- **💳 Transferencia**

Es **independiente** del método de pago del pedido. Un pedido puede ser
"transferencia" para la comida y "efectivo" para el delivery, o cualquier
combinación.

Persistencia: nueva columna `orders.delivery_payment_method text` con
check `IN ('efectivo','transferencia')` o NULL. La RPC fuerza NULL si
`is_delivery = false`, para no guardar dato basura.

Visible en:
- **Orders detalle expandido**: fila "Delivery pago: 💵 Efectivo" o "💳 Transferencia".
- **Reports**: KPIs nuevos en la tarjeta de ganancia neta (ver punto 6).
- **CSV/Excel**: columna "Delivery pago".

### 6. Reports: delivery desglosado por método

En la tarjeta "Cálculo de ganancia neta", debajo de "− Delivery pagado"
aparece un sub-bloque indentado con:
- "💵 en efectivo: $X.XX"
- "💳 en transferencia: $X.XX"

Solo se muestran las líneas que tienen valor > 0. Pedidos antiguos sin
`delivery_payment_method` no se cuentan en ninguno de los dos (quedan
solo en el total `Delivery pagado`).

`computeKpis` devuelve 2 campos nuevos: `deliveryPaidCash`, `deliveryPaidTransfer`.

Excel resumen ahora muestra esas dos líneas como sub-items.
PDF resumen también.

### 7. Reports: sabores de combos más pedidos

Cuadro nuevo "Sabores más pedidos" debajo de Productos más vendidos.
- Cuenta cada salsa de `order_items.sauces` × `quantity` del item.
- Suma también el `item_flavor` de items "Salsa extra" (× quantity).
- Ignora items sin salsas (bebidas, extras varios).
- Solo cuenta pedidos válidos (no cancelados, no anulados).
- Respeta el filtro de rango (Hoy/Semana/Mes/Año/Personalizado).
- Muestra hasta 15 sabores ordenados desc por cantidad.
- Cada sabor con cantidad y porcentaje sobre el total de selecciones.
- Barra de progreso relativa al sabor más pedido.

Se agrega como hoja "Sabores" en Excel.

### 8. RPC `create_order_with_items` actualizada

Mantiene **todo** lo de Fase B (idempotencia, promo estudiante, mayo
extra, pago mixto con validación de split, numeración diaria atómica).

Agrega:
- Persiste `item_flavor` de cada item (`NULLIF` para tratar string vacío
  como null).
- Persiste `delivery_payment_method` del pedido, forzando NULL si
  `is_delivery = false` y validando el valor permitido.

## Archivos tocados

| Archivo | Tipo |
|---------|------|
| `supabase/migration_013_flavors_and_delivery_payment.sql` | **Nuevo** (migración SQL) |
| `INSTRUCCIONES_FASE_C.md` | **Nuevo** (este README) |
| `api/create-order.js` | Pasa `delivery_payment_method` e `item_flavor` |
| `api/order-edit.js` | Validación de estado + whitelist `delivery_payment_method` |
| `src/data/products.js` | Catálogo local con "Salsa extra" |
| `src/lib/utils.js` | RAMEN_TYPES con Carne + DRINK_*_FLAVORS + helpers |
| `src/lib/reportAggregations.js` | `deliveryPaidCash`/`deliveryPaidTransfer` + `topSauces` |
| `src/lib/exports.js` | CSV/Excel/PDF con sabor, delivery pago, hoja Sabores |
| `src/pages/NewOrder.jsx` | UI sabor + UI delivery payment + validación |
| `src/pages/Kitchen.jsx` | Chip Carne + chip sabor |
| `src/pages/Orders.jsx` | Detalle ramen Carne + detalle sabor + delivery pago |
| `src/pages/Reports.jsx` | KPIs delivery breakdown + cuadro sabores |
| `src/store/orderStore.js` | Normaliza `item_flavor`, `delivery_payment_method` |

## Reglas respetadas

- ✅ 12 Serverless Functions exactas (sin agregar endpoints, sin tocar `_lib`).
- ✅ `/api/create-order.js`: la lógica de pago mixto, numeración diaria,
  parseMoney/parseCount y manejo de `PAYMENT_SPLIT_MISMATCH` quedaron
  **byte-idénticas** a la versión que tú habías ajustado. Solo se le
  agregó la línea para pasar `delivery_payment_method` y `item_flavor`
  al payload.
- ✅ Pago mixto NO se tocó. Numeración diaria NO se tocó.
- ✅ Migración SQL idempotente (`ADD COLUMN IF NOT EXISTS`, `ON CONFLICT
  DO NOTHING`, búsqueda + reemplazo del check de `ramen_type` por nombre).
- ✅ Sin `DROP TABLE` / `DROP SCHEMA`. El único DROP es `DROP CONSTRAINT`
  para reemplazar el check anónimo de `ramen_type` (operación segura).
- ✅ Sin borrar pedidos / ventas / usuarios / gastos.
- ✅ Pedidos antiguos sin `item_flavor` o `delivery_payment_method` no
  se rompen: defensa con `it.item_flavor && (...)` en JSX, y los
  KPIs los ignoran (no entran en ningún breakdown).
- ✅ Sin comentarios `--` SQL en JS/JSX (verificado por grep).
- ✅ Sin secretos en frontend.
- ✅ Sintaxis individual de los 11 archivos modificados → 0 errores con esbuild.
- ✅ Bundle frontend completo → compila limpio (~293 KB).
- ✅ Bundle de los 12 endpoints serverless → todos compilan limpio.
- ⚠️ `npm run build` literal no se pudo correr en este sandbox (registro
  npm bloquea un paquete); el bundle de esbuild valida lo mismo que
  `vite build` (sintaxis + JSX + imports cruzados).

## Checklist de pruebas en producción

### Sabores
1. Crear pedido con **Bebida grande** → carrito muestra "ELIGE UNO" rojo + 3 botones (Fuze tea, Coca cola, Guitig).
2. Botón Enviar deshabilitado mientras no se elija sabor. Mensaje: "Elige sabor para Bebida grande".
3. Elegir "Fuze tea" → el chip se ilumina rojo + se desbloquea Enviar.
4. Mismo flujo para **Bebida pequeña** con sus 6 sabores.
5. Agregar **Salsa extra** → aparecen las 8 salsas SAUCES como opciones.
6. Enviar pedido → verificar en Pedidos / Cocina que aparece "Sabor: Fuze tea" o "🥤 Fuze tea".
7. En BD: `order_items.item_flavor` tiene el valor seleccionado.

### Ramen Carne
8. Agregar Ramen solo / Combo ramen / Ramen sin preparar → ver 3 botones: Picante, Carbonara, **Carne** (🥩).
9. Elegir "Carne" → enviar → en Cocina aparece chip 🥩 Carne (color naranja oscuro).
10. En Orders detalle → "Ramen: Carne".

### Edición de pedidos
11. Pedido en estado `pendiente`: botón Editar visible → click → modal abre → guardar funciona.
12. Pedido en `en_preparacion` o `listo`: igual, editable.
13. Pasar pedido a `entregado` → el botón Editar **desaparece** de la fila.
14. Intentar enviar PATCH manualmente a `/api/order-edit` con un pedido entregado → HTTP 409 con mensaje "No se puede editar un pedido entregado".
15. Lo mismo para un pedido anulado.

### Delivery payment
16. NewOrder → marcar **Delivery = Sí** → aparece input valor + 2 botones (Efectivo, Transfer).
17. Default Efectivo → se puede cambiar a Transferencia → el draft se guarda.
18. Enviar pedido → en Orders detalle: "Delivery pago: 💵 Efectivo".
19. BD: `orders.delivery_payment_method = 'efectivo'`. Para pedidos NO delivery: NULL.
20. Reports → tarjeta Cálculo de ganancia neta → sub-bloque "en efectivo $X / en transferencia $X" coherente.

### Sabores más pedidos
21. Reports → cuadro "Sabores más pedidos" con barra de progreso.
22. Crear pedido con Combo XXL + 2 salsas Acevichada → cuenta sube en 2 (porque qty del item = 1, pero ahí hay 2 salsas; verás 1 selección por salsa elegida — son 2 selecciones).
23. Crear pedido con Salsa extra "Acevichada" → otra selección suma.
24. Exportar Excel → hoja "Sabores" con posición / sabor / cantidad / porcentaje.

### No-regresión
25. Pago mixto sigue funcionando (Efectivo + Transferencia + total).
26. Numeración diaria sigue funcionando (#1, #2 hoy; reinicia mañana).
27. Promo estudiante, mayo extra, beneficios empleado/dueño funcionan.
28. Pedidos antiguos sin sabor/delivery_payment_method se muestran correctamente.
29. CSV/Excel/PDF exportan sin errores.

## Si algo falla

- Si la migración 013 falla en la búsqueda del check anónimo de `ramen_type`
  (porque ya tenías uno nombrado), el `DO $$ ... $$` simplemente no
  encuentra nada y sigue. El `ADD CONSTRAINT order_items_ramen_type_check`
  posterior tiene `EXCEPTION WHEN duplicate_object THEN NULL` — idempotente.
- Si un pedido nuevo no aparece con `item_flavor` siendo no-null, verificar
  con Network tab del navegador que el payload incluya `items[].item_flavor`.
  La RPC usa `nullif(v_item->>'item_flavor', '')`, así que string vacío
  se guarda como NULL.
- Si `delivery_payment_method` aparece como NULL para un pedido delivery,
  verificar que `is_delivery = true` esté siendo enviado. La RPC fuerza
  NULL si `is_delivery = false`.
