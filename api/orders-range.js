// GET /api/orders-range?from=ISO&to=ISO
// Pedidos en rango con order_items (Reports). Admin only.
import { withAuth } from './_lib/auth.js'

export default withAuth(async (req, res, { supaSrv }) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const { from, to, light } = req.query || {}
  if (!from || !to) {
    return res.status(400).json({ success: false, error: 'Faltan parámetros from/to' })
  }

  // 'light' = solo campos básicos (para comparativas anuales sin items)
  const selectFields = light === '1'
    ? 'id, order_number, total, created_at, status, deleted_from_reports, benefit_type'
    : '*, order_items(*)'

  const { data, error } = await supaSrv
    .from('orders')
    .select(selectFields)
    .gte('created_at', from)
    .lte('created_at', to)
    .eq('deleted_from_reports', false)
    .order('created_at', { ascending: false })
    .limit(5000)

  if (error) {
    return res.status(500).json({ success: false, error: error.message })
  }

  return res.status(200).json({ success: true, orders: data || [] })
}, { allowedRoles: ['admin'] })
