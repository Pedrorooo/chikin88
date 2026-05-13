// PATCH /api/order-status
// Body: { id, status, cancel_reason? }
// status: pendiente | en_preparacion | listo | entregado | cancelado
import { withAuth } from './_lib/auth.js'

const VALID_STATUSES = ['pendiente', 'en_preparacion', 'listo', 'entregado', 'cancelado']

export default withAuth(async (req, res, { supaSrv }) => {
  if (req.method !== 'PATCH' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const { id, status, cancel_reason } = req.body || {}
  if (!id) {
    return res.status(400).json({ success: false, error: 'Falta id del pedido' })
  }
  if (!status || !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ success: false, error: 'Estado inválido' })
  }

  const patch = { status }
  if (status === 'cancelado' && cancel_reason) patch.cancel_reason = cancel_reason
  // Auto-fill timestamps
  if (status === 'listo')      patch.ready_at = new Date().toISOString()
  if (status === 'entregado')  patch.delivered_at = new Date().toISOString()
  if (status === 'cancelado')  patch.cancelled_at = new Date().toISOString()

  const { data, error } = await supaSrv
    .from('orders')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) return res.status(500).json({ success: false, error: error.message })

  return res.status(200).json({ success: true, order: data })
})
