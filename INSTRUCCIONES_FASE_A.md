# Fase A — Bug de gastos + mejoras de Reportes (mayo 2026)

## Resumen

Siete cambios bajo riesgo, sin tocar `/api/create-order` ni la RPC. Una sola
migración SQL idempotente (solo agrega una columna a `expenses`). Sin borrar
ni modificar ningún pedido real existente.

Lo dejado para Fase B (que tocan la RPC y necesitan más cuidado):

- Pago mixto (efectivo + transferencia en un mismo pedido)
- Número de pedido reiniciado por día

## Cómo aplicar

1. **Supabase → SQL Editor → New query** → pegar
   `supabase/migration_011_expenses_category.sql` → **Run**.
2. Verificar el `SELECT` final: debe listar la columna `category` en `expenses`
   con `data_type = text` y `column_default = 'general'::text`.
3. Descomprimir el ZIP, reemplazar carpeta local, mantener `.env.local`.
4. `npm install` (no cambió `package.json`) → `npm run build`.
5. `git add . && git commit -m "feat: fase A reportes + bug gastos" && git push`.
6. Vercel deploya solo.

## Cambios detallados

### 1. Bug "Could not find the 'category' column of 'expenses'"

**Causa raíz:** `/api/expenses` POST insertaba `category: 'general'` que el
frontend mandaba hardcoded, pero la tabla `expenses` nunca tuvo esa columna
(no aparece en el schema original ni en migraciones 001–010).

**Fix:** `migration_011_expenses_category.sql`
- `ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'general';`
- Índice por categoría para futuros reportes.
- Gastos existentes (si los hay) quedan automáticamente con `category = 'general'`.
- Idempotente: se puede correr varias veces sin problema.

Después de aplicar la migración, el botón "Registrar gasto" funciona sin
cambios en el frontend (que ya enviaba `category: 'general'`).

### 2. Dashboard eliminado del menú

**Layout.jsx:** quitado del array `nav` (sidebar + drawer móvil). Import de
`BarChart3` removido (ya no se usa).

**App.jsx:** la ruta `/dashboard` ahora hace `<Navigate to="/reportes" replace />`.
Esto cubre bookmarks o links viejos del usuario sin romper nada. El archivo
`src/pages/Dashboard.jsx` se mantiene en disco por si se quiere reactivar más
adelante (no se importa, no se incluye en el bundle).

### 3. KPIs de pago más visibles en Reportes

Nueva tarjeta **"Pagos recibidos"** con:
- Efectivo · `$X.XX`
- Transferencia · `$X.XX`
- Total ingresos · `$X.XX` (suma de los dos, igual a `kpis.revenue`)

`computeKpis` se actualizó para que, cuando llegue Fase B, el método `'mixto'`
ya sume automáticamente `cash_amount` y `transfer_amount` por separado. Por
ahora, los pedidos existentes con `payment_method` en `'efectivo'` o
`'transferencia'` se suman por completo a la columna correspondiente.

### 4. Delivery resta para ganancia neta

`computeKpis` ahora retorna 4 campos nuevos:

```js
{
  revenue,          // ingresos brutos (lo que cobró el local, delivery incluido)
  deliveryPaid,     // suma de delivery_fee de pedidos delivery válidos
  netRevenue,       // revenue - deliveryPaid (lo que se queda el local)
  profit,           // netRevenue - expenses (ganancia neta real)
  // ... resto igual que antes
}
```

Nueva tarjeta **"Cálculo de ganancia neta"** en Reportes con la fórmula
desglosada línea por línea:

```
Ingresos brutos      $XX.XX
− Delivery pagado    −$X.XX
= Ingresos netos     $XX.XX
− Gastos             −$X.XX
= Ganancia neta      $XX.XX
```

KPI nuevo "Delivery pagado" en el grid principal (color azul).

Excel y PDF actualizados: el resumen ahora incluye "Ingresos brutos",
"Delivery pagado", "Ingresos netos de venta" y "Ganancia neta" como filas
separadas.

**Importante:** no se modifica ningún `orders.total` histórico. Solo cambia
cómo se interpreta `revenue` vs `profit` en los reportes.

### 5. Productos más vendidos con cantidad y total en dólares

Sección rediseñada con grid de 2 columnas (en escritorio):
- **Izquierda:** gráfico de barras horizontales (cantidad), igual que antes.
- **Derecha:** tabla compacta con `Producto | Cant. | Total` por cada uno
  de los top 10. La columna "Total" muestra los ingresos en dólares en rojo
  Chikin.

En móvil colapsa a 1 columna: primero gráfico, después tabla.

El cálculo ya existía en `topProducts()` (`revenue` se calcula desde
`order_items.subtotal`), solo se estaba ocultando.

La hoja "Productos" del Excel también muestra `Posición | Producto | Categoría |
Cantidad | Ingresos`.

### 6. Cuadro semanal de beneficios — Empleados normales

**Endpoint consolidado:** la lógica vive dentro de `GET /api/orders-range`
con query param `?includeBenefits=1`. Se decidió consolidar (en lugar de
crear `/api/benefits-week`) para respetar el límite de **12 Serverless
Functions del plan Hobby de Vercel**. Reports.jsx llama una sola vez al
endpoint y recibe pedidos + beneficios en la misma respuesta — un round-trip
menos por carga.

La respuesta consolidada:
```json
{
  "success": true,
  "orders": [...],
  "benefits": {
    "today": "YYYY-MM-DD",
    "isoWeek": "YYYY-Www",
    "employees": [...],
    "usages": [...]
  }
}
```

- Calcula la semana ISO actual en **zona América/Guayaquil** (en JS, sin
  depender de funciones de Postgres).
- Lee `employees` (todos) y `employee_benefit_usage` filtrado por
  `used_iso_week = semana actual`.
- Es de solo lectura. No modifica nada.
- Si alguna sub-consulta falla, `benefits` viene `null` y el cuadro
  simplemente no se renderiza (el reporte principal sigue funcionando).

**Helper nuevo:** `buildBenefitsView()` en `reportAggregations.js`.
- Agrupa los usos por empleado.
- Distingue dueños (`role = 'dueño'`) de empleados normales.
- Resuelve `order_id → order_number` usando los pedidos ya cargados en
  Reports.

**Componente nuevo:** `BenefitsEmployeeCard` en `Reports.jsx`.
Para cada empleado normal muestra:
- Nombre
- Descuentos en la semana (contador)
- Chip "Hoy" (usado) o "Hoy disp." (pendiente) — descuento diario
- Chip 🎁 con hora + #pedido (usada esta semana) o "🎁 Pendiente" (no usada)

### 7. Cuadro separado de dueños

**Componente nuevo:** `BenefitsOwnerCard` en `Reports.jsx`.
Para Cindy88, Daivid88, Stephano88:
- Nombre
- Chip ⭐ con cantidad de descuentos en la semana
- Chip 🎁 con cantidad de cortesías en la semana
- Lista de los últimos 5 usos con hora y #pedido

Sin límites aplicados. Solo seguimiento informativo.

## Archivos tocados

| Archivo | Tipo |
|---------|------|
| `supabase/migration_011_expenses_category.sql` | Nuevo (migración SQL) |
| `api/orders-range.js` | Modificado (agrega `?includeBenefits=1`) |
| `src/components/layout/Layout.jsx` | Modificado (quita Dashboard) |
| `src/App.jsx` | Modificado (redirect /dashboard → /reportes) |
| `src/lib/reportAggregations.js` | Modificado (computeKpis + buildBenefitsView) |
| `src/pages/Reports.jsx` | Modificado (KPIs, pagos, ganancia, top productos, beneficios) |
| `src/lib/exports.js` | Modificado (resumen Excel/PDF con delivery + ganancia) |
| `INSTRUCCIONES_FASE_A.md` | Nuevo (este README) |

**Conteo de Serverless Functions: 12 / 12** (límite del plan Hobby de Vercel):
1. anulados.js
2. create-order.js
3. daily-report.js
4. dashboard.js
5. expenses.js
6. order-edit.js
7. order-restore.js
8. order-soft-delete.js
9. order-status.js
10. orders-active.js
11. orders-range.js
12. orders-today.js

**No se tocó:**
- `/api/create-order.js` (byte-idéntico al original)
- RPC `create_order_with_items` (no hay nueva migración que la replace)
- Esquema de `orders`, `order_items`, `employees`, `employee_benefit_usage`
- Trigger `handle_benefit_order`
- Frontend de NewOrder/Kitchen/Anulados/Cocina/Pedidos

## Reglas respetadas

- ✅ Sin `DROP TABLE` ni `DROP SCHEMA`.
- ✅ Sin borrar pedidos, ventas, usuarios ni gastos.
- ✅ Sin recálculo destructivo de pedidos antiguos.
- ✅ Sin comentarios `--` SQL en archivos JS/JSX (verificado por grep).
- ✅ Sin secretos en frontend (verificado por grep).
- ✅ `/api/create-order.js` byte-idéntico al original.
- ✅ Migración SQL idempotente (`ADD COLUMN IF NOT EXISTS`).
- ✅ Sintaxis individual de todos los archivos JS/JSX → 0 errores con esbuild.
- ✅ Bundle completo desde `src/main.jsx` → compila limpio (291 KB).
- ⚠️ `npm run build` literal no se pudo correr en este sandbox (red bloquea
  un paquete del registro); el bundle de esbuild valida sintaxis, JSX e
  imports cruzados — equivalente a lo que `vite build` verifica.

## Checklist de pruebas (en producción)

### Bug de gastos
1. Crear un gasto con descripción "Pollo" y monto $20 → **se guarda sin error**.
2. Aparece en la lista con fecha de hoy.
3. Tarjetas de totales (Hoy / Semana / Mes) reflejan el gasto.
4. Eliminar el gasto → desaparece.

### Dashboard removido
5. El sidebar/menú móvil **NO muestra "Dashboard"**.
6. Navegar manualmente a `/dashboard` → te redirige a `/reportes`.

### Reportes: pagos
7. En Reportes → tarjeta "Pagos recibidos" muestra efectivo + transferencia +
   total (deben sumar igual al KPI "Ingresos brutos").
8. Cambiar filtro Hoy / Semana / Mes / Año → los números se actualizan.

### Reportes: delivery y ganancia
9. Crear un pedido con delivery $1.50 y total $11.50 → en Reportes:
   - "Ingresos brutos" sube $11.50
   - "Delivery pagado" sube $1.50
   - "Ganancia neta" sube $10.00 menos gastos del rango
10. Tarjeta "Cálculo de ganancia neta" muestra las 5 líneas con números coherentes.

### Reportes: productos más vendidos
11. Sección "Productos más vendidos" muestra a la derecha una tabla con
    Producto / Cantidad / Total en dólares.
12. Exportar Excel → la hoja "Productos" muestra 5 columnas incluyendo
    "Ingresos".
13. Exportar PDF → la página de productos muestra cantidad e ingresos por
    cada uno.

### Reportes: cuadros de beneficios
14. Cuadro "Beneficios empleados" muestra a los empleados (excepto dueños)
    con sus chips de "Hoy disp./Usado" y "🎁 Pendiente/Usada".
15. Hacer un pedido con `Nicolas88` y descuento empleado → recargar Reports
    → su chip "Hoy" pasa de "disp." a "Usado" (amarillo).
16. Hacer un pedido con `Nicolas88` y cortesía semanal → su chip 🎁 muestra
    la hora y #pedido.
17. Cuadro "Dueños (sin límite)" muestra solo Cindy88, Daivid88, Stephano88.
18. Hacer dos descuentos de dueño en la semana → el chip ⭐ del dueño muestra
    "2" y aparece en la lista de últimos usos.

### Pedidos antiguos
19. Pedidos creados antes de Fase A siguen apareciendo correctamente en
    Reports/Pedidos/Anulados con todos sus datos.
20. Ningún pedido real perdió información ni cambió de total.

## Fase B (siguiente entrega)

Cuando estés lista, en otro mensaje:
- **Pago mixto** con tabla `order_payments` (o columnas `cash_amount` +
  `transfer_amount`), backfill de pedidos existentes, UI en NewOrder con
  validación de que la suma cuadre con el total, actualización de `/api/create-order`
  y RPC para persistir.
- **Numeración diaria** con columnas `business_date` + `daily_order_number`,
  counter concurrency-safe en la RPC, backfill seguro (recomiendo dejar
  pedidos de hoy con su número global y arrancar el contador diario con el
  próximo pedido; renumerar lo de hoy puede desincronizar comprobantes ya
  entregados).
