# Fase B — Pago mixto + Numeración diaria (mayo 2026)

## Resumen

Dos cambios mayores que tocan la RPC. Migración SQL `migration_012_phase_b.sql`
**idempotente**, sin DROP TABLE/SCHEMA, sin destruir datos.

**Opción A elegida:** los pedidos del día de aplicar la migración **NO se
renumeran**. La numeración diaria arranca con el próximo pedido creado tras
correr la migración. Pedidos de fechas anteriores SÍ reciben `daily_order_number`
en orden cronológico (sin tocar `order_number` global).

## Cómo aplicar (orden importante)

1. **Supabase → SQL Editor → New query** → pegar `supabase/migration_012_phase_b.sql` → **Run**.
   - El SELECT final mostrará la cuenta de pedidos con `business_date` y `daily_order_number`.
   - Si el script tarda algunos segundos, es normal (backfill cronológico por fecha).
2. Descomprimir el ZIP, reemplazar carpeta local, mantener `.env.local`.
3. `npm install` (no cambió `package.json`) → `npm run build`.
4. `git add . && git commit -m "feat: fase B pago mixto + numeración diaria" && git push`.
5. Vercel deploya solo. 12 functions.

## 1) Pago mixto

### Esquema BD

- Enum `payment_method` extendido con valor `'mixto'` (`ADD VALUE IF NOT EXISTS`).
- `orders.cash_amount numeric(10,2) NOT NULL DEFAULT 0` con check `>= 0`.
- `orders.transfer_amount numeric(10,2) NOT NULL DEFAULT 0` con check `>= 0`.
- **Backfill seguro** de pedidos existentes:
  - `payment_method='efectivo'` → `cash_amount = total` (solo si `cash_amount = 0`).
  - `payment_method='transferencia'` → `transfer_amount = total` (solo si `transfer_amount = 0`).
  - Los pedidos con cantidades ya seteadas NO se sobrescriben.

### RPC `create_order_with_items`

- Acepta `cash_amount` y `transfer_amount` en el payload.
- Si `payment_method = 'efectivo'`: ignora los inputs y pone `cash_amount = total`.
- Si `payment_method = 'transferencia'`: ignora los inputs y pone `transfer_amount = total`.
- Si `payment_method = 'mixto'`: valida `abs((cash + transfer) - total) <= 0.01` y
  que no sean ambos cero. Si no cuadra, lanza error `PAYMENT_SPLIT_MISMATCH`.

### UI NewOrder

- 3 botones: Efectivo / Transfer / Mixto.
- Si se elige **Mixto**, aparece un panel ámbar con:
  - Input "Efectivo $" + Input "Transferencia $"
  - Banner en vivo: "Suma: $X.XX / $X.XX" + "Falta $X.XX" / "Sobra $X.XX" / "✓ Cuadra"
  - 3 botones helper: "Todo efectivo" / "Mitad y mitad" / "Todo transfer"
- **Botón Enviar bloqueado** mientras `splitOk` sea false. Muestra "El pago mixto no cuadra".
- Si se cambia de Mixto a Efectivo/Transfer, los inputs no se borran (se pueden recuperar al volver).

### Visualización

- **Kitchen** y **Orders**: chip "Mixto" con icono Wallet cuando aplica.
- **Orders detalle expandido**: línea "Pago: Mixto · efectivo $X.XX · transfer $X.XX".
- **AnulledOrders**: chip Mixto.
- **Edit pedido**: dropdown incluye opción "Mixto".
- **API order-edit**: whitelist incluye `cash_amount` y `transfer_amount`.

### Reports / KPIs

- `kpis.cash` y `kpis.transfer` ya leían `cash_amount` / `transfer_amount` desde Fase A.
- Para pedidos `'mixto'` se suma el `cash_amount` al total cash y el `transfer_amount` al total transfer.
- Vista `daily_sales` actualizada para considerar pedidos mixto en `cash_revenue` y `transfer_revenue`.

### Exports

- **CSV/Excel**: nuevas columnas "Efectivo" y "Transfer" en la tabla de pedidos.
- **Excel resumen**: nuevo KPI "Pedidos con pago mixto".
- **PDF detalle**: la columna "Pago" muestra `"mixto ($X.XX ef + $X.XX tr)"` cuando aplica.

## 2) Numeración diaria

### Esquema BD

- `orders.business_date date` — fecha del pedido en zona Ecuador.
- `orders.daily_order_number int` — contador #1, #2... por día.
- Índice único parcial `(business_date, daily_order_number)` (solo cuando ambos NOT NULL).
- Tabla nueva `daily_order_counters(business_date, last_number)` para concurrency-safe.

### Concurrencia segura

El counter usa:

```sql
INSERT INTO daily_order_counters (business_date, last_number) VALUES (HOY, 1)
ON CONFLICT (business_date)
  DO UPDATE SET last_number = daily_order_counters.last_number + 1
RETURNING last_number INTO v_daily_number;
```

Esta operación es **atómica en PostgreSQL**. Dos pedidos creados al mismo
tiempo reciben números distintos sin race conditions. No necesita locks
explícitos.

### Backfill (Opción A)

- TODOS los pedidos reciben `business_date` calculada desde `created_at` en zona Ecuador.
- Pedidos de **fechas anteriores a HOY** reciben `daily_order_number` en orden cronológico
  (con `ROW_NUMBER() OVER (PARTITION BY business_date ORDER BY created_at, id)`).
- Pedidos de **HOY** NO reciben `daily_order_number` (quedan en null).
- El próximo pedido creado tras la migración será **#1** del día.
- Los counters quedan sembrados con el último número de cada fecha histórica.

### Visualización

- Nuevo helper `displayOrderNumber(order)` en `utils.js`:
  - Si `daily_order_number` existe → muestra `#N` (diario).
  - Si no → fallback a `#order_number` (global, para pedidos viejos).
- Reemplazado en: Orders.jsx, Kitchen.jsx, AnulledOrders.jsx, Reports.jsx (tabla detalle, modal de detalle, modal de edición, toasts, confirmaciones).
- En el cuadro de beneficios de dueños, "Últimos usos" también muestra el #diario si existe.

### Exports

- CSV y Excel tienen columnas **#Diario** y **#Global** lado a lado.
- PDF detalle muestra `daily_order_number` (con fallback al global si no existe).

## Archivos tocados

| Archivo | Tipo |
|---------|------|
| `supabase/migration_012_phase_b.sql` | Nuevo (migración) |
| `api/order-edit.js` | Whitelist + cash_amount/transfer_amount |
| `src/lib/utils.js` | Helper `displayOrderNumber` |
| `src/lib/reportAggregations.js` | findOrderNumber prefiere daily |
| `src/lib/exports.js` | CSV/Excel/PDF con cash/transfer/daily |
| `src/pages/NewOrder.jsx` | UI pago mixto + validación split |
| `src/pages/Kitchen.jsx` | Chip Mixto + displayOrderNumber |
| `src/pages/Orders.jsx` | Chip + detalle + dropdown + displayOrderNumber |
| `src/pages/AnulledOrders.jsx` | Chip + displayOrderNumber |
| `src/pages/Reports.jsx` | displayOrderNumber en tabla + toasts |
| `INSTRUCCIONES_FASE_B.md` | Este README |

**Sin tocar:** `/api/create-order.js` (la línea de import del helper sigue
igual desde Fase A), arquitectura serverless, 12 functions, sin endpoints nuevos.

## Reglas respetadas

- ✅ Migración SQL idempotente (`ADD COLUMN IF NOT EXISTS`, `ADD VALUE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `CREATE TABLE IF NOT EXISTS`).
- ✅ Sin `DROP TABLE` / `DROP SCHEMA`.
- ✅ Sin borrar pedidos, ventas, usuarios, gastos.
- ✅ Sin recálculo destructivo de pedidos antiguos (solo asignación a campos NULL).
- ✅ Pedidos de HOY conservan `order_number` global, `daily_order_number = null` (opción A).
- ✅ Sin comentarios `--` SQL en archivos JS/JSX (verificado por grep).
- ✅ Sin secretos en frontend.
- ✅ Sintaxis individual de los 9 archivos modificados → 0 errores con esbuild.
- ✅ Bundle completo frontend → compila limpio (~293 KB).
- ✅ Bundle de cada uno de los 12 endpoints serverless → compila limpio.
- ✅ 12 Serverless Functions exactas en `/api/`.
- ✅ `/api/create-order.js` lógica byte-idéntica al original (solo el import path es el mismo de Fase A).
- ⚠️ `npm run build` literal no se pudo correr (registro npmjs bloquea un paquete en el sandbox); el bundle de esbuild valida sintaxis + JSX + imports cruzados (equivalente a lo que verifica `vite build`).

## Checklist de pruebas en producción

### Pago mixto

1. Crear pedido con total $12 → método **Efectivo** → BD guarda `cash_amount=12, transfer_amount=0`.
2. Crear pedido con total $12 → método **Transferencia** → BD guarda `cash_amount=0, transfer_amount=12`.
3. Crear pedido con total $12 → método **Mixto** → input efectivo $5, transfer $7 → banner verde "✓ Cuadra" → botón Enviar habilitado → pedido se crea con `cash_amount=5, transfer_amount=7`.
4. Mismo pedido con efectivo $5, transfer $6 → banner rojo "Falta $1.00" → botón **bloqueado**, dice "El pago mixto no cuadra".
5. Mismo pedido con efectivo $7, transfer $7 → banner rojo "Sobra $2.00" → botón bloqueado.
6. Click "Mitad y mitad" → efectivo $6, transfer $6 → cuadra.
7. Click "Todo efectivo" → efectivo $12, transfer $0 → cuadra (es un caso degenerado pero válido).
8. Reports → filtrar Hoy → KPI Efectivo y Transferencia reflejan los pedidos mixtos.
9. Exportar Excel → hoja Pedidos tiene columnas Efectivo y Transfer correctas para cada pedido.
10. Exportar PDF → pedidos mixtos muestran `"mixto ($X.XX ef + $X.XX tr)"`.
11. Editar pedido existente → dropdown ahora incluye "Mixto".

### Numeración diaria

12. Antes de aplicar la migración: anotar el último `order_number` global de hoy (ej: #47).
13. Aplicar la migración. Verificar que los pedidos de hoy quedan con `daily_order_number = null` y `business_date = hoy_ecuador`.
14. Crear un pedido nuevo → debe verse como **#1** en Kitchen, Pedidos, Reports.
15. Crear otro pedido → **#2**.
16. Cambiar la hora a mañana (test manual): nuevo pedido es **#1** (nuevo día).
17. Pedidos de hoy creados ANTES de la migración: siguen viéndose con su número global `#47, #46, #45...` porque `displayOrderNumber()` cae al fallback.
18. Reports tabla detalle del rango "Hoy" muestra mezcla: los nuevos #1, #2... + los antiguos #47, #46... (en orden cronológico).
19. Exportar CSV/Excel → columnas #Diario y #Global ambas presentes.
20. Anular pedido nuevo y restaurarlo → su `daily_order_number` se preserva.
21. Pedidos de días anteriores: deben tener `daily_order_number` asignado por el backfill (ej: ayer #1, #2, #3 según orden cronológico de ese día).

### No-regresión

22. Promo estudiante 10% sigue funcionando.
23. Beneficios empleado / dueño siguen funcionando.
24. Mayo extra sigue funcionando.
25. Cancelar / anular / restaurar pedido funciona.
26. Borrador autosave funciona.
27. Cocina realtime funciona.
28. Email diario sale a las 22:15 (próxima ejecución incluye `cash_amount`/`transfer_amount` indirectamente vía `total`).

## Si algo falla

- Si un pedido mixto pasa al servidor sin cuadrar, la RPC lanza `PAYMENT_SPLIT_MISMATCH`. El frontend muestra el mensaje crudo, no es bonito pero la operación está protegida. El UI ya bloquea el botón Enviar antes de eso.
- Si el counter de un día tuviera datos corruptos, basta con resetearlo manualmente:
  ```sql
  UPDATE daily_order_counters
  SET last_number = (
    SELECT COALESCE(MAX(daily_order_number), 0)
    FROM orders
    WHERE business_date = '2026-05-16'
  )
  WHERE business_date = '2026-05-16';
  ```
- Si te das cuenta más tarde que SÍ querés renumerar los pedidos de hoy también, puedes correr:
  ```sql
  -- OJO: este UPDATE renumera lo de hoy. Solo correr si estás segura.
  WITH numbered AS (
    SELECT id, row_number() OVER (PARTITION BY business_date ORDER BY created_at, id) AS rn
    FROM orders
    WHERE business_date = (now() at time zone 'America/Guayaquil')::date
      AND daily_order_number IS NULL
  )
  UPDATE orders o SET daily_order_number = numbered.rn
    FROM numbered WHERE o.id = numbered.id;
  -- Y actualizar el counter:
  INSERT INTO daily_order_counters (business_date, last_number)
  SELECT business_date, COALESCE(MAX(daily_order_number), 0)
    FROM orders WHERE business_date = (now() at time zone 'America/Guayaquil')::date
    GROUP BY business_date
  ON CONFLICT (business_date) DO UPDATE SET last_number = EXCLUDED.last_number;
  ```
