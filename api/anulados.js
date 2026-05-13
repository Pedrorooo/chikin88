// GET /api/anulados?range=today|week|month|all
// Pedidos anulados (admin only). Incluye nombre del admin que anuló.
import { withAuth } from './_lib/auth.js'

export default withAuth(async (req, res, { supaSrv }) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const range = req.query?.range || 'today'

  let query = supaSrv
    .from('orders')
    .select('*, order_items(product_name, quantity, subtotal)')
    .eq('deleted_from_reports', true)
    .order('deleted_at', { ascending: false })
    .limit(1000)

  if (range !== 'all') {
    const now = new Date()
    const start = new Date(now)
    if (range === 'today') {
      start.setHours(0, 0, 0, 0)
    } else if (range === 'week') {
      const day = now.getDay() === 0 ? 7 : now.getDay()
      start.setDate(now.getDate() - (day - 1))
      start.setHours(0, 0, 0, 0)
    } else if (range === 'month') {
      start.setDate(1)
      start.setHours(0, 0, 0, 0)
    }
    query = query.gte('deleted_at', start.toISOString())
  }

  const { data: orders, error } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })

  // Cargar perfiles de quienes anularon
  const userIds = [...new Set((orders || []).map(o => o.deleted_by).filter(Boolean))]
  let profiles = {}
  if (userIds.length > 0) {
    const { data: profs } = await supaSrv
      .from('profiles')
      .select('id, full_name, email')
      .in('id', userIds)
    if (profs) {
      profs.forEach(p => { profiles[p.id] = p })
    }
  }

  return res.status(200).json({
    success: true,
    orders: orders || [],
    profiles,
  })
}, { allowedRoles: ['admin'] })
