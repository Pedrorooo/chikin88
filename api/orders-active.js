// GET /api/orders-active
// Pedidos activos: pendiente, en_preparacion, listo (excluye anulados)
import { withAuth } from '../server/auth.js'

export default withAuth(async (req, res, { supaSrv }) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const { data, error } = await supaSrv
    .from('orders')
    .select('*, order_items(*)')
    .in('status', ['pendiente', 'en_preparacion', 'listo'])
    .eq('deleted_from_reports', false)
    .order('created_at', { ascending: true })
    .limit(200)

  if (error) {
    return res.status(500).json({ success: false, error: error.message })
  }

  return res.status(200).json({ success: true, orders: data || [] })
})
