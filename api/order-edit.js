// PATCH /api/order-edit
// Body: { id, patch: { ...fields } }
// Para editar campos de un pedido. Bloqueado para pedidos entregados
// o anulados (defensa en profundidad; el frontend ya oculta el botón).
import { withAuth } from '../server/auth.js'

// Whitelist de campos editables (defensa contra mass-assignment)
const EDITABLE_FIELDS = new Set([
  'customer_name', 'customer_phone', 'order_type', 'is_delivery',
  'delivery_fee', 'delivery_payment_method',
  'with_mayo', 'mayo_extra', 'utensil', 'payment_method',
  'cash_amount', 'transfer_amount',
  'notes', 'subtotal', 'total',
])

// Estados que permiten edición. Coincide con el frontend:
// pendiente / en_preparacion / listo => editables.
// entregado  => BLOQUEADO (pedido cerrado).
// cancelado  => BLOQUEADO (no tiene sentido editar un cancelado).
const EDITABLE_STATUSES = new Set(['pendiente', 'en_preparacion', 'listo'])

export default withAuth(async (req, res, { supaSrv }) => {
  if (req.method !== 'PATCH' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const { id, patch } = req.body || {}
  if (!id || !patch || typeof patch !== 'object') {
    return res.status(400).json({ success: false, error: 'Datos invalidos' })
  }

  // Defensa en profundidad: verificar estado actual antes de permitir editar.
  // Esto bloquea pedidos entregados aunque el frontend (por error o por
  // cliente desactualizado) intente mandar el PATCH.
  const { data: current, error: readErr } = await supaSrv
    .from('orders')
    .select('id, status, deleted_from_reports')
    .eq('id', id)
    .single()

  if (readErr || !current) {
    return res.status(404).json({ success: false, error: 'Pedido no encontrado' })
  }

  if (current.deleted_from_reports) {
    return res.status(409).json({
      success: false,
      error: 'No se puede editar un pedido anulado. Restauralo primero.',
    })
  }

  if (!EDITABLE_STATUSES.has(current.status)) {
    const label = current.status === 'entregado' ? 'entregado' : current.status
    return res.status(409).json({
      success: false,
      error: 'No se puede editar un pedido ' + label + '.',
    })
  }

  // Sanitizar: solo permitir campos editables
  const cleanPatch = {}
  for (const k of Object.keys(patch)) {
    if (EDITABLE_FIELDS.has(k)) cleanPatch[k] = patch[k]
  }

  if (Object.keys(cleanPatch).length === 0) {
    return res.status(400).json({ success: false, error: 'No hay campos validos para actualizar' })
  }

  const { data, error } = await supaSrv
    .from('orders')
    .update(cleanPatch)
    .eq('id', id)
    .select()
    .single()

  if (error) return res.status(500).json({ success: false, error: error.message })

  return res.status(200).json({ success: true, order: data })
})
