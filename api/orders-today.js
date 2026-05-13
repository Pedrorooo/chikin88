// GET /api/orders-today
// Todos los pedidos del día (excluye anulados)
import { withAuth } from './_lib/auth.js'

export default withAuth(async (req, res, { supaSrv }) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const start = new Date()
  start.setHours(0, 0, 0, 0)

  const { data, error } = await supaSrv
    .from('orders')
    .select('*, order_items(*)')
    .gte('created_at', start.toISOString())
    .eq('deleted_from_reports', false)
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) {
    return res.status(500).json({ success: false, error: error.message })
  }

  return res.status(200).json({ success: true, orders: data || [] })
})
