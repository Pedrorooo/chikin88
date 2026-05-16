// GET /api/orders-range?from=ISO&to=ISO[&light=1][&includeBenefits=1]
//
// Pedidos en rango con order_items (Reports). Admin only.
//
// Variantes por query param:
//   light=1           → solo campos básicos (comparativas anuales)
//   includeBenefits=1 → agrega { today, isoWeek, employees, usages } al
//                       payload para el cuadro semanal de beneficios.
//                       Reemplaza al endpoint /api/benefits-week eliminado
//                       por el límite de 12 Serverless Functions en Vercel
//                       Hobby. La lógica es la misma; solo viaja en el
//                       mismo round-trip que el reporte principal.
import { withAuth } from '../server/auth.js'

// "Hoy" en zona América/Guayaquil (YYYY-MM-DD)
function todayInEcuador() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Guayaquil',
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  return fmt.format(new Date())
}

// Semana ISO en zona Guayaquil: "YYYY-Www"
function isoWeekInEcuador() {
  const today = todayInEcuador()
  const [y, m, d] = today.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil((((date - yearStart) / 86400000) + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

export default withAuth(async (req, res, { supaSrv }) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const { from, to, light, includeBenefits } = req.query || {}
  if (!from || !to) {
    return res.status(400).json({ success: false, error: 'Faltan parámetros from/to' })
  }

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

  // Bloque opcional de beneficios. Solo se calcula si el cliente lo pide
  // explícitamente con includeBenefits=1, para no encarecer cada llamada al
  // endpoint cuando Reports solo necesita los pedidos.
  let benefitsBlock = null
  if (includeBenefits === '1') {
    const isoWeek = isoWeekInEcuador()
    const today = todayInEcuador()

    const [empRes, usRes] = await Promise.all([
      supaSrv.from('employees').select('*').order('username', { ascending: true }),
      supaSrv.from('employee_benefit_usage')
        .select('*')
        .eq('used_iso_week', isoWeek)
        .order('created_at', { ascending: false })
        .limit(500),
    ])

    if (!empRes.error && !usRes.error) {
      benefitsBlock = {
        today,
        isoWeek,
        employees: empRes.data || [],
        usages: usRes.data || [],
      }
    }
    // Si falla, devolvemos null. Reports degrada elegantemente
    // (simplemente no muestra el cuadro de beneficios).
  }

  return res.status(200).json({
    success: true,
    orders: data || [],
    benefits: benefitsBlock,
  })
}, { allowedRoles: ['admin'] })
