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

// ---------- Sabores/salsas más pedidos en combos (cuenta selecciones) ----------
//
// Recorre order_items.sauces (array de strings) en pedidos válidos. Cada
// salsa seleccionada cuenta `quantity` veces (si el pedido tenía 2 combos,
// cuenta 2). Solo cuentan items con sauces no vacíos (no cuentan bebidas
// ni extras sin salsa). Devuelve `[{ name, count, percent }]` ordenado
// desc por count, con `percent` sobre el total de selecciones de salsa
// en el rango.
//
// IMPORTANTE: usa solo datos guardados en order_items.sauces. No mezcla
// con item_flavor (que es para bebidas y "Salsa extra" — esos no son
// "salsas dentro de un combo de pollo"). Las salsas elegidas como item
// "Salsa extra" sí cuentan también, porque su sabor se guarda en
// item_flavor y representa una salsa elegida explícitamente.
export const topSauces = (orders, limit = 15) => {
  const map = new Map()
  let total = 0

  const bump = (name, by) => {
    if (!name) return
    const n = String(name).trim()
    if (!n) return
    map.set(n, (map.get(n) || 0) + by)
    total += by
  }

  for (const o of validOrders(orders)) {
    for (const it of (o.order_items || [])) {
      const qty = Number(it.quantity) || 0
      if (qty <= 0) continue
      // Salsas seleccionadas del combo
      if (Array.isArray(it.sauces)) {
        for (const s of it.sauces) bump(s, qty)
      }
      // "Salsa extra" como item independiente: el sabor está en item_flavor
      const pname = (it.product_name || '').toLowerCase().trim()
      if (pname === 'salsa extra' && it.item_flavor) {
        bump(it.item_flavor, qty)
      }
    }
  }

  const arr = [...map.entries()]
    .map(([name, count]) => ({
      name,
      count,
      percent: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)

  return { items: arr, totalSelections: total }
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
// Cambios mayo 2026:
//   * Se agrega `deliveryPaid`: suma de delivery_fee de pedidos con delivery.
//     Es dinero del pedido que se paga al repartidor, no es ganancia del local.
//   * Se agrega `netRevenue`: ingresos brutos - delivery pagado.
//   * `profit` ahora descuenta delivery además de gastos (ganancia real
//     del negocio). Fórmula: revenue - deliveryPaid - expenses.
//   * `revenue` (bruto) se mantiene para compatibilidad con código que ya
//     lo usaba (gráficos, comparativas).
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
  // Pago por método. Pedidos antiguos solo tienen payment_method = 'efectivo' o
  // 'transferencia' y los totales se asignan completos a esa columna. La fase B
  // agregará 'mixto' con desglose; esta función ya queda preparada para usar
  // los campos cash_amount/transfer_amount si vienen seteados.
  const cash = rev.reduce((s, o) => {
    if (o.payment_method === 'efectivo') return s + Number(o.total || 0)
    if (o.payment_method === 'mixto')    return s + Number(o.cash_amount || 0)
    return s
  }, 0)
  const transfer = rev.reduce((s, o) => {
    if (o.payment_method === 'transferencia') return s + Number(o.total || 0)
    if (o.payment_method === 'mixto')         return s + Number(o.transfer_amount || 0)
    return s
  }, 0)
  // Delivery pagado: solo cuenta el delivery_fee de los pedidos delivery
  // válidos. Se ignoran cancelados/anulados (ya filtrados en validOrders).
  const deliveryPaid = valid
    .filter(o => o.is_delivery)
    .reduce((s, o) => s + Number(o.delivery_fee || 0), 0)
  // Desglose del delivery por método de pago (migración 013).
  // delivery_payment_method puede ser null en pedidos antiguos: ahí
  // no se cuenta en ninguno de los dos (queda en "sin asignar").
  const deliveryPaidCash = valid
    .filter(o => o.is_delivery && o.delivery_payment_method === 'efectivo')
    .reduce((s, o) => s + Number(o.delivery_fee || 0), 0)
  const deliveryPaidTransfer = valid
    .filter(o => o.is_delivery && o.delivery_payment_method === 'transferencia')
    .reduce((s, o) => s + Number(o.delivery_fee || 0), 0)
  // Promo estudiante: cuántos pedidos y cuánto descuento total se aplicó.
  const studentOrders = valid.filter(o => o.discount_type === 'student')
  const studentCount  = studentOrders.length
  const studentDiscount = valid.reduce(
    (s, o) => s + (o.discount_type === 'student' ? Number(o.discount_amount || 0) : 0),
    0
  )
  const netRevenue = revenue - deliveryPaid
  return {
    orderCount: valid.length,
    revenue,                       // bruto (lo que cobró el local incluyendo delivery)
    netRevenue,                    // bruto - delivery (lo que se queda el local antes de gastos)
    expenses: expSum,
    deliveryPaid,
    deliveryPaidCash,
    deliveryPaidTransfer,
    profit: netRevenue - expSum,   // ganancia neta real: bruto - delivery - gastos
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

// ---------- Beneficios de empleados/dueños usados en un rango ----------
// Construye dos listas:
//   * employeesView: para empleados normales, muestra estado de la semana
//     (descuento usado HOY y cortesía usada esta SEMANA, con día/hora del uso).
//   * ownersView: para dueños, totales sin límite (cuántos descuentos y
//     cortesías esta semana, últimos usos).
//
// Args:
//   employees: rows de public.employees con { username, role }
//   usages:    rows de public.employee_benefit_usage con { employee_username,
//              benefit_type, used_date, used_iso_week, order_id, created_at }
//   orders:    pedidos (para mostrar #order_number en los últimos usos)
//   today:     YYYY-MM-DD en zona Ecuador (decidido por el caller)
//   isoWeek:   string "YYYY-Www" en zona Ecuador (decidido por el caller)
export const buildBenefitsView = ({ employees, usages, orders, today, isoWeek }) => {
  const usList = Array.isArray(usages) ? usages : []
  const empList = Array.isArray(employees) ? employees : []
  const orderById = new Map()
  for (const o of orders || []) orderById.set(o.id, o)

  const findOrderNumber = (orderId) => {
    if (!orderId) return null
    const o = orderById.get(orderId)
    if (!o) return null
    // Preferir el número diario si existe (pedidos creados tras la migración
    // 012). Para pedidos viejos cae al número global, que es lo que estaba.
    if (o.daily_order_number != null && o.daily_order_number !== '') {
      return o.daily_order_number
    }
    return o.order_number || null
  }

  // Lista oficial de dueños (defensa extra: aunque la columna `role` de la BD
  // ya marca a estos 3 como 'dueño', preferimos ser explícitos en la UI por
  // si llegara un row con role nulo o incorrecto. La fuente de verdad para
  // limitar beneficios sigue siendo el trigger handle_benefit_order.)
  const OWNER_USERNAMES = new Set(['Cindy88', 'Daivid88', 'Stephano88'])
  const isOwner = (e) =>
    e.role === 'dueño' ||
    e.role === 'dueno' ||
    OWNER_USERNAMES.has(e.username)

  // Para cada uso, decidimos si entra en "hoy" (descuento diario) o "esta
  // semana" (cortesía semanal). Las comparaciones se hacen con strings de
  // fecha generados por el caller en zona Ecuador.
  const empGroups = new Map()  // username -> {discountsToday, discountsWeek, courtesyWeek, courtesyAt, courtesyOrderId}
  const ownerGroups = new Map() // username -> {discountsWeek, courtesiesWeek, lastUses[]}

  for (const u of usList) {
    const usr = u.employee_username
    if (!usr) continue
    const isDiscount = u.benefit_type === 'discount'
    const isCourtesy = u.benefit_type === 'courtesy'
    const sameDay  = u.used_date    === today
    const sameWeek = u.used_iso_week === isoWeek

    const empMeta = empList.find(e => e.username === usr)
    const owner = empMeta && isOwner(empMeta)

    if (owner) {
      if (!ownerGroups.has(usr)) ownerGroups.set(usr, {
        username: usr, discountsWeek: 0, courtesiesWeek: 0, lastUses: [],
      })
      const g = ownerGroups.get(usr)
      if (sameWeek) {
        if (isDiscount) g.discountsWeek += 1
        if (isCourtesy) g.courtesiesWeek += 1
      }
      g.lastUses.push({
        type: u.benefit_type,
        at: u.created_at,
        orderId: u.order_id,
        orderNumber: findOrderNumber(u.order_id),
      })
    } else {
      if (!empGroups.has(usr)) empGroups.set(usr, {
        username: usr,
        discountsToday: 0,
        discountsWeek: 0,
        courtesyWeek: false,
        courtesyAt: null,
        courtesyOrderId: null,
        courtesyOrderNumber: null,
      })
      const g = empGroups.get(usr)
      if (isDiscount && sameDay)  g.discountsToday += 1
      if (isDiscount && sameWeek) g.discountsWeek += 1
      if (isCourtesy && sameWeek && !g.courtesyWeek) {
        g.courtesyWeek = true
        g.courtesyAt = u.created_at
        g.courtesyOrderId = u.order_id
        g.courtesyOrderNumber = findOrderNumber(u.order_id)
      }
    }
  }

  // Salidas con TODOS los empleados/dueños conocidos, no solo los que tienen usos
  const employeesView = empList
    .filter(e => !isOwner(e))
    .map(e => {
      const g = empGroups.get(e.username) || {
        username: e.username,
        discountsToday: 0,
        discountsWeek: 0,
        courtesyWeek: false,
        courtesyAt: null,
        courtesyOrderId: null,
        courtesyOrderNumber: null,
      }
      return { ...g, displayName: e.full_name || e.username }
    })
    .sort((a, b) => a.username.localeCompare(b.username))

  const ownersView = empList
    .filter(e => isOwner(e))
    .map(e => {
      const g = ownerGroups.get(e.username) || {
        username: e.username, discountsWeek: 0, courtesiesWeek: 0, lastUses: [],
      }
      // Últimos 5 usos por fecha desc
      const lastUses = [...g.lastUses]
        .sort((a, b) => new Date(b.at) - new Date(a.at))
        .slice(0, 5)
      return { ...g, lastUses, displayName: e.full_name || e.username }
    })
    .sort((a, b) => a.username.localeCompare(b.username))

  return { employeesView, ownersView }
}
