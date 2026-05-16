// GET /api/dashboard?range=today|week|month
// Métricas agregadas. Admin only.
import { withAuth } from '../server/auth.js'

// Helpers de rango (replica de utils.js del frontend para tenerlos server-side)
function todayRange() {
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const end = new Date();   end.setHours(23, 59, 59, 999)
  return { start: start.toISOString(), end: end.toISOString() }
}
function weekRange() {
  const now = new Date()
  const day = now.getDay() === 0 ? 7 : now.getDay()
  const start = new Date(now); start.setDate(now.getDate() - (day - 1)); start.setHours(0, 0, 0, 0)
  const end = new Date(); end.setHours(23, 59, 59, 999)
  return { start: start.toISOString(), end: end.toISOString() }
}
function monthRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
  const end = new Date(); end.setHours(23, 59, 59, 999)
  return { start: start.toISOString(), end: end.toISOString() }
}

export default withAuth(async (req, res, { supaSrv }) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const range = (req.query?.range) || 'today'
  let r
  if (range === 'week') r = weekRange()
  else if (range === 'month') r = monthRange()
  else r = todayRange()

  const [oRes, eRes] = await Promise.all([
    supaSrv.from('orders')
      .select('id, total, payment_method, status, created_at, deleted_from_reports, benefit_type, order_items(product_name, quantity, subtotal)')
      .gte('created_at', r.start)
      .lte('created_at', r.end)
      .eq('deleted_from_reports', false)
      .limit(5000),
    supaSrv.from('expenses')
      .select('amount')
      .gte('expense_date', r.start.slice(0, 10))
      .lte('expense_date', r.end.slice(0, 10))
      .limit(2000),
  ])

  if (oRes.error) return res.status(500).json({ success: false, error: oRes.error.message })
  if (eRes.error) return res.status(500).json({ success: false, error: eRes.error.message })

  const orders = oRes.data || []
  const valid = orders.filter(o => o.status !== 'cancelado')
  const rev = valid.filter(o => o.benefit_type !== 'courtesy')
  const expenses = eRes.data || []

  const revenue = rev.reduce((s, o) => s + Number(o.total || 0), 0)
  const cash = rev.filter(o => o.payment_method === 'efectivo').reduce((s, o) => s + Number(o.total || 0), 0)
  const transfer = rev.filter(o => o.payment_method === 'transferencia').reduce((s, o) => s + Number(o.total || 0), 0)
  const expSum = expenses.reduce((s, e) => s + Number(e.amount || 0), 0)

  // Top productos
  const map = new Map()
  valid.forEach(o => (o.order_items || []).forEach(it => {
    const cur = map.get(it.product_name) || { qty: 0, rev: 0 }
    map.set(it.product_name, {
      qty: cur.qty + Number(it.quantity || 0),
      rev: cur.rev + Number(it.subtotal || 0),
    })
  }))
  const products = [...map.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 8)

  return res.status(200).json({
    success: true,
    stats: {
      revenue,
      expenses: expSum,
      orders: valid.length,
      cancelled: orders.length - valid.length,
      cash,
      transfer,
      products,
    },
  })
}, { allowedRoles: ['admin'] })
