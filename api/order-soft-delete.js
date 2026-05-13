// PATCH /api/order-soft-delete
// Body: { id, reason? }
// Admin only.
import { withAuth } from './_lib/auth.js'

export default withAuth(async (req, res, { supaSrv, userId }) => {
  if (req.method !== 'PATCH' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const { id, reason } = req.body || {}
  if (!id) {
    return res.status(400).json({ success: false, error: 'Falta id del pedido' })
  }

  const { error } = await supaSrv
    .from('orders')
    .update({
      deleted_from_reports: true,
      deleted_at: new Date().toISOString(),
      deleted_by: userId,
      delete_reason: reason || null,
    })
    .eq('id', id)

  if (error) return res.status(500).json({ success: false, error: error.message })

  return res.status(200).json({ success: true })
}, { allowedRoles: ['admin'] })
