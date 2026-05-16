# Fix pago mixto payload

Este ZIP corrige el error:

PAYMENT_SPLIT_MISMATCH cash=0.00 transfer=0.00 total=...

Cambios:
- `src/pages/NewOrder.jsx`: parsea montos con coma/punto y envía `cash_amount`, `transfer_amount`, `cashAmount`, `transferAmount`.
- `src/store/orderStore.js`: preserva esos campos al reconstruir el payload antes de llamar `/api/create-order`.
- `api/create-order.js`: acepta esos campos en snake_case/camelCase y los pasa a la RPC.

No requiere SQL.

Pasos:
1. Reemplazar archivos con este ZIP.
2. Ejecutar `npm run build` localmente.
3. `git add -A && git commit -m "fix pago mixto payload" && git push`.
4. Probar pedido mixto.
