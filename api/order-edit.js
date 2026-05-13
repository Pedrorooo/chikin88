// PATCH /api/order-edit
// Body: { id, patch: { ...fields } }
// Para editar campos de un pedido activo (nombre, notas, mayo, etc.).
import { withAuth } from './_lib/auth.js'

// Whitelist de campos editables (defensa contra mass-assignment)
const EDITABLE_FIELDS = new Set([
  'customer_name', 'customer_phone', 'order_type', 'is_delivery',
  'delivery_fee', 'with_mayo', 'utensil', 'payment_method',
  'notes', 'subtotal', 'total',
])

export default withAuth(async (req, res, { supaSrv }) => {
  if (req.method !== 'PATCH' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const { id, patch } = req.body || {}
  if (!id || !patch || typeof patch !== 'object') {
    return res.status(400).json({ success: false, error: 'Datos inválidos' })
  }

  // Sanitizar: solo permitir campos editables
  const cleanPatch = {}
  for (const k of Object.keys(patch)) {
    if (EDITABLE_FIELDS.has(k)) cleanPatch[k] = patch[k]
  }

  if (Object.keys(cleanPatch).length === 0) {
    return res.status(400).json({ success: false, error: 'No hay campos válidos para actualizar' })
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
