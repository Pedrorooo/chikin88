// PATCH /api/order-restore
// Body: { id }
// Admin only.
import { withAuth } from '../server/auth.js'

export default withAuth(async (req, res, { supaSrv }) => {
  if (req.method !== 'PATCH' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const { id } = req.body || {}
  if (!id) {
    return res.status(400).json({ success: false, error: 'Falta id del pedido' })
  }

  const { error } = await supaSrv
    .from('orders')
    .update({
      deleted_from_reports: false,
      deleted_at: null,
      deleted_by: null,
      delete_reason: null,
    })
    .eq('id', id)

  if (error) return res.status(500).json({ success: false, error: error.message })

  return res.status(200).json({ success: true })
}, { allowedRoles: ['admin'] })
