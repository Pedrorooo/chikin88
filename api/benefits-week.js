// GET /api/benefits-week
//
// Devuelve los empleados y los usos de beneficios de una semana ISO.
// Por defecto la semana actual en zona Ecuador, o ?week=YYYY-Www para
// una semana específica. Solo admin.
//
// Respuesta:
//   {
//     success: true,
//     today: "YYYY-MM-DD",
//     isoWeek: "YYYY-Www",
//     employees: [...],   // todos los empleados con role
//     usages:    [...],   // employee_benefit_usage filtrado por semana
//   }
//
// Lectura solamente. No modifica nada.
import { withAuth } from './_lib/auth.js'

// Calcula "hoy" e ISO week en zona América/Guayaquil. Lo hacemos en JS
// para no depender de funciones de Postgres con zona horaria.
function todayInEcuador() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Guayaquil',
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  return fmt.format(new Date())  // YYYY-MM-DD
}

function isoWeekInEcuador() {
  // Construimos la fecha desde el "hoy" en Guayaquil y aplicamos algoritmo
  // ISO 8601: el jueves de la misma semana define el año ISO.
  const today = todayInEcuador()
  const [y, m, d] = today.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const dayNum = date.getUTCDay() || 7  // 1..7 (lunes=1, domingo=7)
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil((((date - yearStart) / 86400000) + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

export default withAuth(async (req, res, { supaSrv }) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const week = (req.query?.week && /^\d{4}-W\d{2}$/.test(req.query.week))
    ? req.query.week
    : isoWeekInEcuador()
  const today = todayInEcuador()

  // Empleados (todos)
  const { data: employees, error: empErr } = await supaSrv
    .from('employees')
    .select('*')
    .order('username', { ascending: true })

  if (empErr) {
    return res.status(500).json({ success: false, error: empErr.message })
  }

  // Usos de beneficios de la semana (cualquier año/semana coincidente)
  const { data: usages, error: usErr } = await supaSrv
    .from('employee_benefit_usage')
    .select('*')
    .eq('used_iso_week', week)
    .order('created_at', { ascending: false })
    .limit(500)

  if (usErr) {
    return res.status(500).json({ success: false, error: usErr.message })
  }

  return res.status(200).json({
    success: true,
    today,
    isoWeek: week,
    employees: employees || [],
    usages: usages || [],
  })
}, { allowedRoles: ['admin'] })
