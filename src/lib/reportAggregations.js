// Helpers para agregar y procesar datos de pedidos para los reportes.
// Todo el cálculo se hace en cliente sobre los pedidos ya cargados.

const MONTH_LABELS = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
]

// Pedidos válidos = no cancelados y no anulados del reporte
export const validOrders = (orders) =>
  (orders || []).filter(o =>
    o.status !== 'cancelado' &&
    o.deleted_from_reports !== true
  )

// Solo pedidos que generan ingresos reales (no cortesías)
export const revenueOrders = (orders) =>
  validOrders(orders).filter(o => o.benefit_type !== 'courtesy')

// ---------- Agrupar pedidos por bucket de tiempo ----------
// granularity: 'hour' | 'day' | 'month'
export const groupOrdersByTime = (orders, granularity) => {
  const buckets = new Map()

  for (const o of validOrders(orders)) {
    const d = new Date(o.created_at)
    let key, label
    if (granularity === 'hour') {
      key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`
      label = `${String(d.getHours()).padStart(2, '0')}:00`
    } else if (granularity === 'month') {
      key = `${d.getFullYear()}-${d.getMonth()}`
      label = `${MONTH_LABELS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`
    } else { // day
      key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      label = `${d.getDate()}/${d.getMonth() + 1}`
    }

    if (!buckets.has(key)) {
      buckets.set(key, { key, label, total: 0, count: 0, ts: d.getTime() })
    }
    const b = buckets.get(key)
    b.total += Number(o.total) || 0
    b.count += 1
    if (d.getTime() < b.ts) b.ts = d.getTime()
  }

  return [...buckets.values()].sort((a, b) => a.ts - b.ts)
}

// Decide el granularity adecuado según el rango (en días)
export const granularityForRange = (startISO, endISO) => {
  const days = Math.ceil((new Date(endISO) - new Date(startISO)) / 86400000)
  if (days <= 1) return 'hour'
  if (days <= 92) return 'day'
  return 'month'
}

// ---------- Productos más vendidos ----------
export const topProducts = (orders, limit = 10) => {
  const map = new Map()
  for (const o of validOrders(orders)) {
    for (const it of (o.order_items || [])) {
      const key = it.product_name
      if (!map.has(key)) {
        map.set(key, {
          name: it.product_name,
          category: it.product_category,
          qty: 0,
          revenue: 0,
        })
      }
      const r = map.get(key)
      r.qty += Number(it.quantity) || 0
      r.revenue += Number(it.subtotal) || (Number(it.unit_price) * Number(it.quantity)) || 0
    }
  }
  return [...map.values()]
    .sort((a, b) => b.qty - a.qty)
    .slice(0, limit)
}

// ---------- Ventas mensuales de un año dado ----------
export const monthlySalesForYear = (orders, year) => {
  const totals = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    label: MONTH_LABELS[i],
    total: 0,
    count: 0,
  }))
  for (const o of validOrders(orders)) {
    const d = new Date(o.created_at)
    if (d.getFullYear() !== year) continue
    totals[d.getMonth()].total += Number(o.total) || 0
    totals[d.getMonth()].count += 1
  }
  return totals
}

// ---------- Comparativa anual: año actual vs anterior, por mes ----------
export const annualComparison = (currentYearOrders, prevYearOrders, currentYear) => {
  const cur = monthlySalesForYear(currentYearOrders, currentYear)
  const prev = monthlySalesForYear(prevYearOrders, currentYear - 1)
  return cur.map((m, i) => ({
    label: m.label,
    actual: m.total,
    anterior: prev[i].total,
  }))
}

// ---------- Ganancia neta por mes ----------
// expenses: filas con expense_date (YYYY-MM-DD) y amount
export const monthlyProfit = (orders, expenses, year) => {
  const sales = monthlySalesForYear(orders, year)
  const exp = Array(12).fill(0)
  for (const e of (expenses || [])) {
    const d = new Date(e.expense_date)
    if (d.getFullYear() !== year) continue
    exp[d.getMonth()] += Number(e.amount) || 0
  }
  return sales.map((m, i) => ({
    label: m.label,
    ingresos: m.total,
    gastos: exp[i],
    ganancia: m.total - exp[i],
  }))
}

// ---------- KPIs del rango ----------
export const computeKpis = (orders, expenses) => {
  const valid = validOrders(orders)
  const rev   = revenueOrders(orders)
  const revenue = rev.reduce((s, o) => s + Number(o.total || 0), 0)
  const expSum  = (expenses || []).reduce((s, e) => s + Number(e.amount || 0), 0)
  const cancelled = (orders || []).filter(o => o.status === 'cancelado').length
  const anulled = (orders || []).filter(o => o.deleted_from_reports === true).length
  const courtesies = valid.filter(o => o.benefit_type === 'courtesy').length
  const discounts  = valid.filter(o => o.benefit_type === 'discount').length
  const avgTicket = rev.length ? revenue / rev.length : 0
  const cash     = rev.filter(o => o.payment_method === 'efectivo').reduce((s, o) => s + Number(o.total || 0), 0)
  const transfer = rev.filter(o => o.payment_method === 'transferencia').reduce((s, o) => s + Number(o.total || 0), 0)
  // Promo estudiante: cuántos pedidos y cuánto descuento total se aplicó.
  // Solo cuenta pedidos válidos (no cancelados ni anulados).
  const studentOrders = valid.filter(o => o.discount_type === 'student')
  const studentCount  = studentOrders.length
  const studentDiscount = valid.reduce(
    (s, o) => s + (o.discount_type === 'student' ? Number(o.discount_amount || 0) : 0),
    0
  )
  return {
    orderCount: valid.length,
    revenue,
    expenses: expSum,
    profit: revenue - expSum,
    avgTicket,
    cancelled,
    anulled,
    courtesies,
    discounts,
    studentCount,
    studentDiscount,
    cash,
    transfer,
  }
}
