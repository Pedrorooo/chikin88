# Chikin88 POS — Actualización mayo 2026

Esta actualización agrega features grandes al sistema en producción **sin perder datos existentes**.

---

## 🔴 Importante antes de empezar

- No hay `DROP TABLE`, no hay `DROP SCHEMA`, no se reinicia nada.
- La migración solo agrega columnas, tablas e índices.
- Los pedidos, ventas, gastos y usuarios actuales se quedan intactos.
- Es seguro correr la migración 2 veces (idempotente).

---

## Paso 1 — Migración SQL (correr una vez)

1. Abre Supabase → tu proyecto → **SQL Editor** → **New query**.
2. Abre el archivo `supabase/migration_004_features_v2.sql` y copia su contenido completo.
3. Pégalo en el editor y presiona **Run**.
4. Al final verás 3 `SELECT` de verificación:
   - Columnas nuevas en `orders` (deben aparecer 6 filas).
   - Total de empleados (debe decir `14`).
   - Productos clave (debe listar Combo Económico, Combo Especial, Combo XXL, Combo Full y Agua).

Si la migración falla a la mitad, no hay problema: corrige el error y vuelve a correrla. Las
operaciones son `IF NOT EXISTS` o `ON CONFLICT DO NOTHING`.

---

## Paso 2 — Frontend (Vercel)

1. Descarga el ZIP nuevo y reemplaza la carpeta local de tu proyecto.
2. Mantén tu archivo `.env.local` con las claves de Supabase.
3. Subir a GitHub:
   ```bash
   git add .
   git commit -m "feat: soft delete, empleados, ramen/salsa, perf"
   git push
   ```
4. Vercel desplegará automáticamente.

---

## Qué cambió en esta versión

### Pedidos y operación
- **Soft delete (anular).** Admin ya no borra pedidos físicamente. El botón rojo "ANULAR"
  reemplaza al de "BORRAR". El pedido sale de ventas y reportes pero queda en historial.
- **Página "Anulados"** (sólo admin) — sección nueva en el sidebar con icono de archivo.
  Filtros por hoy/semana/mes/todo, muestra quién anuló, cuándo y motivo, y permite restaurar.
- **Hora creado + hora entregado** visibles en las tarjetas de pedidos entregados.

### Catálogo
- Renombrados: "Chikin 3.50" → **Combo Económico**, "Chikin 5.50" → **Combo Especial**.
  Los `order_items` antiguos conservan el nombre histórico, así que los reportes pasados
  no se rompen.
- Producto nuevo: **Agua $0.75** en la categoría Bebidas.

### Salsas y customización
- Salsa nueva: **Acevichada**.
- En productos de pollo aparece el selector "Modo de salsa":
  - **Con salsa** (normal)
  - **Sin salsa** (oculta el selector de salsas, no cobra extras)
  - **Aparte** (muestra el selector, marca en cocina como "salsa aparte")
  - **Extra** (suma +$0.25 por unidad además de las salsas extra normales)
- En Ramen solo y Combo ramen aparece selector obligatorio: **Picante** o **Carbonara**.

### Empleados (sistema nuevo)
- 14 empleados pre-cargados en la tabla `employees` (Cindy88, Nicolas88, etc.).
- Cuando se escribe el nombre de un empleado en "Cliente", aparece un banner amarillo
  con dos botones:
  - **💵 Descuento diario** — aplica precios especiales a 1 combo: Económico $2.50,
    Especial $4.00, XXL $7.00, Full $15.50. Máximo 1 por empleado por día.
  - **🎁 Cortesía semanal** — 1 Combo Especial gratis ($0.00) por empleado por semana.
- Las restricciones están **en la base de datos** (índice único + trigger). Si el empleado
  intenta usar el beneficio dos veces, el pedido no se crea y aparece el mensaje:
  *"Cindy88 ya usó su descuento de empleado hoy."* o *"...su Combo Especial gratis esta semana."*
- Timezone Ecuador (`America/Guayaquil`). El día y la semana cuentan respecto a Ecuador.

### Reportes y dashboard
- Los anulados se excluyen automáticamente de:
  - Ventas, ganancia neta, efectivo, transferencia, ticket promedio.
  - Productos más vendidos.
  - Exportaciones PDF / Excel / CSV.
  - Email diario automático.
- Las cortesías de empleado **no suman ingreso** (total = $0) pero se cuentan como
  cortesías separadas en el resumen.
- Los descuentos de empleado sí cuentan al precio especial cobrado.

### Performance
- Throttle de 2 segundos en `fetchToday` para evitar consultas repetidas en cadena.
- `.limit()` en todas las queries grandes (500–5000 según el caso).
- Anti-doble-envío con `useRef` + botón deshabilitado mientras se envía.
- `useMemo` y `useCallback` en cálculos de carrito y handlers.
- `memo()` en filas de pedidos.
- Índices nuevos en BD: `created_at DESC`, `status`, `deleted_from_reports`,
  `benefit_type`, `order_items.order_id`, `expenses.expense_date`.
- Cleanup correcto del canal de realtime al desmontar la sesión.
- Limpieza de huérfanos: si los items fallan al guardar, se borra el pedido.

### Seguridad
- Empleados **no ven** anulados, ni dashboard, ni gastos, ni reportes.
- Solo admin puede anular (RLS + chequeo en UI).
- Trigger `handle_benefit_order` valida que el empleado exista antes de aplicar beneficio.

---

## Checklist de pruebas antes de usar

Con usuario admin:

- [ ] Crear un pedido normal. Verifica que aparece en cocina en tiempo real.
- [ ] Crear un pedido con cliente "Cindy88" → debe aparecer banner amarillo.
  - [ ] Activar descuento → agregar Combo Económico → precio debe ser $2.50.
  - [ ] Enviar → debe crearse OK.
  - [ ] Intentar crear otro pedido para "Cindy88" con descuento → debe fallar con el mensaje
    *"Cindy88 ya usó su descuento de empleado hoy."*
- [ ] Crear pedido para "Nicolas88" con cortesía semanal → Combo Especial a $0.00.
  - [ ] Verificar que el total es $0.00 + extras si aplica.
  - [ ] Intentar usar la cortesía la misma semana → debe fallar.
- [ ] En productos de pollo: probar los 4 modos (Con salsa, Sin salsa, Aparte, Extra).
  - [ ] "Sin salsa" oculta el selector de salsas.
  - [ ] "Extra" suma +$0.25 al total.
- [ ] Agregar un Ramen solo → debe pedir tipo (picante/carbonara).
- [ ] Marcar un pedido como entregado → en la tarjeta debe verse "Creado: HH:MM" y "Entregado: HH:MM".
- [ ] Anular un pedido entregado (botón rojo ANULAR) → desaparece de la lista de pedidos.
  - [ ] Ir a "Anulados" en sidebar → debe estar ahí con motivo y quién anuló.
  - [ ] Ir a Reportes → el total ya no incluye ese pedido.
  - [ ] Restaurar el pedido desde "Anulados" → vuelve a la lista y a los reportes.
- [ ] Agregar Agua $0.75 al pedido → debe estar en Bebidas.
- [ ] Probar la salsa Acevichada → aparece en el selector.

Con usuario empleado:

- [ ] No debe ver "Dashboard", "Gastos", "Reportes" ni "Anulados" en el sidebar.
- [ ] Sí puede crear pedidos, ver cocina, marcar listo/entregado.
- [ ] No tiene botón ANULAR en pedidos cerrados.

Móvil:

- [ ] Probar todo el flujo de Nuevo Pedido desde un celular.
- [ ] Los 4 botones de "Modo de salsa" deben caber cómodamente.
- [ ] El banner de empleado debe ser claro.
- [ ] Botón "Enviar a cocina" se deshabilita correctamente mientras procesa.

---

## Si algo sale mal

- **El pedido no se crea con beneficio**: revisa la consola del navegador. El mensaje del
  trigger viene como "Cindy88 ya usó...". Es esperado si ya se usó.
- **No aparecen los empleados**: corre la migración de nuevo, debe insertar los 14.
- **El catálogo no muestra los productos nuevos**: refresca con Ctrl+Shift+R para limpiar caché.
- **Los reportes incluyen anulados**: verifica que cargaste la última versión del frontend.
