# Vista de Pedidos con detalle completo (mayo 2026)

## Resumen

Cambio quirúrgico, **solo frontend**. Sin SQL, sin tocar endpoints, sin tocar arquitectura.

Los pedidos entregados (y todos los demás) en **Pedidos → Todos del día** ahora
muestran un botón **"Detalles"** que despliega TODA la información guardada del
pedido: productos individuales con salsas/modo/ramen/descuentos, preferencias
(mayonesa, mayo extra, cubierto, delivery, pago, teléfono), beneficios y promos,
observaciones, totales desglosados, y tiempos (creado/listo/entregado/cancelado).

## Por qué solo frontend

Los endpoints `/api/orders-today` y `/api/orders-active` ya hacían
`select('*, order_items(*)')` desde la migración 008 — devuelven todos los
campos necesarios. El problema era solo que el componente **`OrderRow`** en
`Orders.jsx` mostraba un resumen compacto y nunca renderizaba los detalles.

## Qué cambia

Un solo archivo: **`src/pages/Orders.jsx`**.

- **`OrderRow`**: nuevo estado `expanded` (cerrado por defecto). Botón
  "Detalles" / "Ocultar" con `ChevronDown` / `ChevronUp`. Cuando se expande,
  renderiza `<OrderDetails order={order}/>` con animación de altura.
- **`OrderDetails`** (componente nuevo): panel con 5 secciones:
  1. **Productos** → lista `<ItemDetail>` por cada `order_item`.
  2. **Preferencias** → mayonesa, mayo extra, cubierto, delivery, tipo de
     pedido, método de pago, teléfono.
  3. **Beneficios** → chip de empleado/dueño y/o promo estudiante con monto.
  4. **Observaciones** → solo si `notes` no está vacío.
  5. **Totales** → subtotal, palillos, mayo extra, delivery, descuento, total.
  6. **Tiempos** → creado/listo/entregado/cancelado (solo los que existen).
- **`ItemDetail`** (componente nuevo): detalle de cada producto: cantidad,
  precio unitario, subtotal, precio original tachado (si hubo descuento),
  tipo de ramen, modo de salsa, salsas seleccionadas con conteo
  "(N/M incl.)", y línea de salsas extra con cálculo
  `N × $0.25 × qty = +$X.XX` si aplica.
- **`DetailRow`** (componente helper): label/valor compacto para preferencias.

## Renderizado defensivo

Cada bloque/línea verifica que el dato exista antes de renderizar:

- `with_mayo` → solo se muestra si es `boolean` (cubre pedidos viejos donde
  pudiera venir `null`).
- `mayo_extra` → solo se muestra si `> 0` y `with_mayo === true`.
- `utensil` → solo si está definido.
- `is_delivery` / `delivery_fee` → línea de delivery solo si es delivery.
- `discount_type === 'student'` → bloque de promo estudiante solo si aplica.
- `benefit_type` → bloque de beneficios empleado solo si aplica.
- `notes` → solo si el string trim no está vacío.
- `original_unit_price` → tachado solo si difiere del `unit_price`.
- `sauces` / `sauce_mode` → solo si el item los tiene; si `sauce_mode = 'extra'`
  llega de un pedido viejo, se muestra como "Extra (legacy)" sin romper.
- `ready_at`, `delivered_at`, `cancelled_at` → cada tiempo solo si existe.

Si un campo no existe en un pedido viejo, la línea simplemente no aparece. El
panel nunca se rompe.

## Pedidos viejos vs nuevos

No se modifica ni se recalcula NINGÚN pedido. Solo se muestra lo que ya está
guardado en la BD:

- Pedido creado tras la migración 010 → muestra todo (mayo_extra incluido).
- Pedido creado tras la migración 009 pero antes de la 010 → muestra todo
  excepto mayo extra (que en ese pedido = 0 o null).
- Pedido más antiguo aún → muestra lo que tenga; cualquier campo nuevo
  simplemente no aparece como línea.

## Reglas respetadas

- ✅ `/api/create-order.js` byte-idéntico al original.
- ✅ Sin SQL nuevo (la migración 010 ya cubría todos los campos).
- ✅ Sin endpoint nuevo (orders-today/orders-active ya devuelven todo).
- ✅ Sin comentarios `--` SQL en archivos JS/JSX.
- ✅ Sin secretos.
- ✅ Sintaxis y bundle validados con esbuild → 0 errores.

## Checklist de pruebas

1. **Pedido entregado con salsa seleccionada** → expandir → ver "Salsa: Con salsa · {salsas} (N/M incl.)".
2. **Pedido con "sin salsa"** → expandir → ver "Salsa: Sin salsa", sin listado.
3. **Pedido con salsa aparte** → expandir → ver "Salsa: Aparte · {salsas}".
4. **Pedido con mayonesa extra** → expandir → ver chip y línea "Mayo extra ×N +$X.XX".
5. **Pedido con palillos** → expandir → ver "Cubierto: Palillos +$0.25" en preferencias y línea en totales.
6. **Pedido con observaciones** → expandir → ver bloque "Observaciones" con el texto.
7. **Pedido con promo estudiante** → expandir → ver chip 🎓 y línea de descuento en totales.
8. **Pedido viejo sin algún dato** → expandir → tarjeta NO se rompe; ese campo simplemente no aparece.
9. **Pedido con beneficio empleado** → expandir → ver chip "⭐ Descuento empleado · Nicolas88".
10. **Pedido con cortesía** → expandir → ver "🎁 Cortesía empleado · Nicolas88" + total $0.
11. **Pedido delivery** → expandir → ver "Delivery: Sí +$X.XX" en preferencias y línea en totales.
12. **Pedido cancelado** → expandir → ver tiempos incluyendo "Cancelado: HH:MM".
13. **Móvil**: tarjeta sigue compacta, panel se despliega ordenado, grid de preferencias colapsa a 1 columna.

## Workflow de despliegue

1. Descomprimir ZIP, reemplazar carpeta local, mantener `.env.local`.
2. `npm run build` (no cambió `package.json`).
3. `git add . && git commit -m "feat: detalle expandible en tarjeta de Pedidos" && git push`.
4. Vercel deploya solo.

**No hay migración SQL para esta entrega.**
