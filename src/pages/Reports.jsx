import { useEffect, useMemo, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileText, Download, Calendar, BarChart3, TrendingUp, ChevronDown,
  FileSpreadsheet, FileDown, ShoppingBag, DollarSign, Wallet, Target,
  RefreshCw, Trash2, X, AlertTriangle, Loader2, RotateCw,
  Banknote, ArrowRightLeft, GraduationCap,
  Bike, Users, Crown, Check, Clock as Clock4,
  ChevronLeft, ChevronRight, CalendarDays,
} from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, AreaChart, Area, Cell,
} from 'recharts'
import toast from 'react-hot-toast'
import { apiFetch } from '../lib/apiFetch'
import { useAuthStore } from '../store/authStore'
import { useOrderStore } from '../store/orderStore'
import {
  money, fmtDate, fmtTime, cx, STATUS_LABEL,
  todayRange, weekRange, monthRange,
  prevIsoWeek, nextIsoWeek, isoWeekHumanRange,
  displayOrderNumber,
} from '../lib/utils'
import {
  validOrders, groupOrdersByTime, granularityForRange,
  topProducts, monthlySalesForYear, annualComparison,
  monthlyProfit, computeKpis, buildBenefitsView,
} from '../lib/reportAggregations'
import { exportCSV, exportExcel, exportPDF } from '../lib/exports'

// ===== Rango de fechas =====
const yearRange = (year) => ({
  start: new Date(year, 0, 1, 0, 0, 0).toISOString(),
  end:   new Date(year, 11, 31, 23, 59, 59, 999).toISOString(),
})

const customRange = (from, to) => ({
  start: new Date(from + 'T00:00:00').toISOString(),
  end:   new Date(to   + 'T23:59:59').toISOString(),
})

const fmtRangeLabel = (mode, year, from, to) => {
  if (mode === 'today')  return 'hoy'
  if (mode === 'week')   return 'semana'
  if (mode === 'month')  return 'mes'
  if (mode === 'year')   return `año-${year}`
  if (mode === 'custom') return `${from}_a_${to}`
  return mode
}

// ===== Colores chart =====
const C_RED      = '#D62828'
const C_YELLOW   = '#F4D35E'
const C_DARK     = '#1F1F1F'
const C_EMERALD  = '#10b981'
const C_ROSE     = '#f43f5e'
const C_BLUE     = '#3b82f6'
const C_GRAY     = '#9ca3af'

// ============================================================
//  Página
// ============================================================
export default function Reports() {
  const { profile } = useAuthStore()
  const softDeleteOrder = useOrderStore(s => s.softDeleteOrder)
  const isAdmin = profile?.role === 'admin'

  const [mode, setMode] = useState('month')
  const [year, setYear] = useState(new Date().getFullYear())
  const [customFrom, setCustomFrom] = useState(() => new Date(Date.now() - 6*86400000).toISOString().slice(0,10))
  const [customTo,   setCustomTo]   = useState(() => new Date().toISOString().slice(0,10))

  // Datos
  const [orders, setOrders] = useState([])
  const [expenses, setExpenses] = useState([])
  const [prevYearOrders, setPrevYearOrders] = useState([])
  const [yearExpenses, setYearExpenses] = useState([])
  // Beneficios semanales (cuadro de empleados y dueños). Vienen en el mismo
  // payload de /api/orders-range cuando se pasa includeBenefits=1.
  const [benefits, setBenefits] = useState(null)  // { today, isoWeek, employees, usages }
  // Semana seleccionada para el cuadro de beneficios. null = semana actual
  // (se calcula en el servidor en zona Ecuador). El usuario puede navegar a
  // semanas anteriores/siguientes con los botones del cuadro.
  const [benefitsWeek, setBenefitsWeek] = useState(null)

  // Estados de carga (inicia loading=true para no mostrar 0s falsos)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Modal de anulación
  const [anulling, setAnulling] = useState(null)  // { order } o null

  const yearsAvailable = useMemo(() => {
    const cy = new Date().getFullYear()
    return [cy, cy - 1, cy - 2, cy - 3, cy - 4]
  }, [])

  // ----- Calcular el rango actual -----
  // refreshKey se incluye para recomputar el rango si el usuario fuerza un refresh
  // (importante si la página queda abierta y cambia el día).
  const currentRange = useMemo(() => {
    if (mode === 'today') return todayRange()
    if (mode === 'week')  return weekRange()
    if (mode === 'month') return monthRange()
    if (mode === 'year')  return yearRange(year)
    if (mode === 'custom' && customFrom && customTo) return customRange(customFrom, customTo)
    return todayRange()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, year, customFrom, customTo, refreshKey])

  const rangeLabel = fmtRangeLabel(mode, year, customFrom, customTo)

  // ----- Cargar datos del rango principal (pedidos + gastos) -----
  // En la carga inicial pedimos también el bloque benefits para mostrar la
  // semana actual sin un round-trip extra. Cuando el usuario navega a otra
  // semana, el segundo useEffect (más abajo) refetcha solo benefits con la
  // semana elegida sin recargar los pedidos.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const { start, end } = currentRange
    // Solo pedimos benefits inline si todavía no hemos elegido una semana
    // distinta. Si benefitsWeek tiene valor, esa carga la hace el otro effect.
    const inlineBenefits = benefitsWeek === null
    ;(async () => {
      const [oRes, eRes] = await Promise.all([
        apiFetch(
          `/api/orders-range?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}${inlineBenefits ? '&includeBenefits=1' : ''}`,
          {},
          15_000
        ),
        apiFetch(
          `/api/expenses?from=${start.slice(0,10)}&to=${end.slice(0,10)}`,
          {},
          12_000
        ),
      ])
      if (cancelled) return
      if (oRes.error) { setError(oRes.error); setLoading(false); return }
      if (eRes.error) { setError(eRes.error); setLoading(false); return }
      setOrders(oRes.data?.orders || [])
      setExpenses(eRes.data?.expenses || [])
      if (inlineBenefits) {
        setBenefits(oRes.data?.benefits || null)
      }
      setReady(true)
      setLoading(false)
    })()
    return () => { cancelled = true }
    // benefitsWeek intencionalmente excluido: cuando cambia, el otro effect
    // se encarga; no queremos recargar pedidos al navegar de semana.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRange, refreshKey])

  // ----- Cargar SOLO beneficios cuando el usuario cambia de semana -----
  // No depende del rango ni recarga pedidos. Hace una llamada ligera al
  // mismo endpoint (orders-range con un rango de 0 minutos no devuelve
  // pedidos pero sí el bloque benefits).
  useEffect(() => {
    if (benefitsWeek === null) return  // carga inicial ya trajo la semana actual
    let cancelled = false
    ;(async () => {
      // Rango mínimo (un instante) — el endpoint requiere from/to pero solo
      // nos interesa el bloque benefits con la semana específica.
      const now = new Date().toISOString()
      const url = `/api/orders-range?from=${encodeURIComponent(now)}&to=${encodeURIComponent(now)}&includeBenefits=1&week=${encodeURIComponent(benefitsWeek)}`
      const { data, error } = await apiFetch(url, {}, 10_000)
      if (cancelled) return
      if (!error && data?.benefits) {
        setBenefits(data.benefits)
      }
    })()
    return () => { cancelled = true }
  }, [benefitsWeek])

  // Vista derivada de los beneficios. orders se pasa para resolver order_number
  // a partir del order_id guardado en employee_benefit_usage.
  const benefitsView = useMemo(() => {
    if (!benefits) return null
    return buildBenefitsView({
      employees: benefits.employees,
      usages:    benefits.usages,
      orders:    orders,
      today:     benefits.today,
      isoWeek:   benefits.isoWeek,
    })
  }, [benefits, orders])

  useEffect(() => {
    if (mode !== 'year') {
      setPrevYearOrders([])
      setYearExpenses([])
      return
    }
    let cancelled = false
    ;(async () => {
      const prev = yearRange(year - 1)
      const cur  = yearRange(year)
      const [prevRes, expRes] = await Promise.all([
        apiFetch(
          `/api/orders-range?from=${encodeURIComponent(prev.start)}&to=${encodeURIComponent(prev.end)}&light=1`,
          {},
          15_000
        ),
        apiFetch(
          `/api/expenses?from=${cur.start.slice(0,10)}&to=${cur.end.slice(0,10)}`,
          {},
          12_000
        ),
      ])
      if (cancelled) return
      // Datos de comparativa anual no son críticos; si fallan, simplemente
      // no mostramos la comparativa. El reporte principal sigue funcionando.
      if (!prevRes.error) setPrevYearOrders(prevRes.data?.orders || [])
      if (!expRes.error)  setYearExpenses(expRes.data?.expenses || [])
    })()
    return () => { cancelled = true }
  }, [mode, year, refreshKey])

  // ----- Cálculos (memos derivados; solo se ejecutan si los datos cambian) -----
  const kpis = useMemo(() => computeKpis(orders, expenses), [orders, expenses])

  const granularity = useMemo(
    () => granularityForRange(currentRange.start, currentRange.end),
    [currentRange]
  )

  const timeSeries = useMemo(
    () => groupOrdersByTime(orders, granularity),
    [orders, granularity]
  )

  const top = useMemo(() => topProducts(orders, 10), [orders])

  const monthlySeries = useMemo(
    () => mode === 'year' ? monthlySalesForYear(orders, year) : null,
    [orders, mode, year]
  )

  const annualSeries = useMemo(() => {
    if (mode !== 'year') return null
    return annualComparison(orders, prevYearOrders, year)
  }, [orders, prevYearOrders, mode, year])

  const profitSeries = useMemo(() => {
    if (mode !== 'year') return null
    return monthlyProfit(orders, yearExpenses, year)
  }, [orders, yearExpenses, mode, year])

  // ----- Acciones -----
  const refresh = useCallback(() => {
    setRefreshKey(k => k + 1)
  }, [])

  const handleExport = async (kind) => {
    if (!ready) return toast.error('Espera a que los datos terminen de cargar')
    try {
      const payload = {
        orders: validOrders(orders),
        expenses,
        kpis,
        top,
        monthly: monthlySeries,
        profit: profitSeries,
        rangeLabel,
      }
      if (kind === 'pdf') await exportPDF(payload)
      else if (kind === 'excel') await exportExcel(payload)
      else if (kind === 'csv') exportCSV({ orders: validOrders(orders), rangeLabel })
      toast.success(`Reporte ${kind.toUpperCase()} listo`)
    } catch (err) {
      console.error(err)
      toast.error(`No se pudo exportar ${kind.toUpperCase()}`)
    }
  }

  const handleAnularConfirm = async (order, reason) => {
    try {
      await softDeleteOrder(order.id, reason, profile?.id)
      // Quitar del estado local de Reportes inmediatamente para que KPIs/charts se actualicen
      setOrders(prev => prev.filter(o => o.id !== order.id))
      toast.success(`Pedido ${displayOrderNumber(order)} anulado`)
      setAnulling(null)
    } catch (err) {
      console.error(err)
      toast.error('No se pudo anular el pedido')
    }
  }

  // ============================================================
  //  Estados de carga: pantalla completa de "Cargando" si aún no
  //  tenemos datos por primera vez. Si ya tuvimos datos, no
  //  reemplazamos la pantalla — mostramos un indicador discreto.
  // ============================================================
  if (!ready && loading) {
    return <FullPageLoading />
  }

  if (!ready && error) {
    return <FullPageError message={error} onRetry={refresh} />
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto pb-12">
      {/* ===== Header ===== */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-10 bg-chikin-red rounded-full"/>
          <div>
            <h1 className="font-display text-3xl md:text-4xl">Reportes</h1>
            <p className="text-sm text-zinc-500">
              Histórico, gráficos y exportación
              {loading && ready && (
                <span className="ml-2 inline-flex items-center gap-1 text-chikin-red">
                  <Loader2 size={12} className="animate-spin"/> Actualizando…
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={refresh} disabled={loading}
                  className="btn bg-zinc-100 dark:bg-chikin-gray-800 hover:bg-zinc-200 dark:hover:bg-chikin-gray-700 disabled:opacity-50">
            <RefreshCw size={16} className={cx(loading && 'animate-spin')}/>
            <span className="hidden sm:inline">Actualizar</span>
          </button>
          <button onClick={() => handleExport('pdf')} disabled={loading}
                  className="btn bg-chikin-red text-white shadow-md shadow-chikin-red/30 hover:bg-chikin-red-dark disabled:opacity-50">
            <FileDown size={16}/> PDF
          </button>
          <button onClick={() => handleExport('excel')} disabled={loading}
                  className="btn bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
            <FileSpreadsheet size={16}/> Excel
          </button>
          <button onClick={() => handleExport('csv')} disabled={loading}
                  className="btn bg-chikin-yellow text-chikin-black hover:brightness-95 disabled:opacity-50">
            <Download size={16}/> CSV
          </button>
        </div>
      </div>

      {/* ===== Banner de error si hubo un fallo al re-cargar pero tenemos datos viejos ===== */}
      {error && ready && (
        <div className="card p-3 mb-4 bg-rose-50 dark:bg-rose-950/30 border-rose-300 dark:border-rose-900 flex items-center gap-3">
          <AlertTriangle className="text-rose-600 shrink-0" size={18}/>
          <div className="flex-1 text-sm text-zinc-700 dark:text-zinc-200">
            <b>Error al actualizar:</b> {error}. Mostrando datos anteriores.
          </div>
          <button onClick={refresh} className="btn bg-rose-600 text-white hover:bg-rose-700">
            <RotateCw size={14}/> Reintentar
          </button>
        </div>
      )}

      {/* ===== Filtros ===== */}
      <RangeFilters
        mode={mode} onMode={setMode}
        year={year} onYear={setYear} years={yearsAvailable}
        from={customFrom} to={customTo}
        onFrom={setCustomFrom} onTo={setCustomTo}
      />

      {/* ===== KPIs principales ===== */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-3">
        <Stat icon={ShoppingBag} label="Pedidos"       value={kpis.orderCount} />
        <Stat icon={DollarSign}  label="Ingresos brutos" value={money(kpis.revenue)} accent="red"/>
        <Stat icon={Bike}        label="Delivery pagado" value={money(kpis.deliveryPaid)} accent="blue"/>
        <Stat icon={Wallet}      label="Gastos"        value={money(kpis.expenses)} accent="rose"/>
        <Stat icon={TrendingUp}  label="Ganancia neta" value={money(kpis.profit)}
              accent={kpis.profit >= 0 ? 'emerald' : 'rose'}/>
        <Stat icon={Target}      label="Ticket prom."  value={money(kpis.avgTicket)} accent="yellow"/>
      </div>

      {/* ===== Detalle de pagos + fórmula de ganancia ===== */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <div className="card p-4">
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-500 mb-2">
            Pagos recibidos
          </div>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="flex items-center gap-1.5 text-zinc-700 dark:text-zinc-200">
                <Banknote size={14}/> Efectivo
              </span>
              <span className="font-bold">{money(kpis.cash)}</span>
            </div>
            <div className="flex justify-between">
              <span className="flex items-center gap-1.5 text-zinc-700 dark:text-zinc-200">
                <ArrowRightLeft size={14}/> Transferencia
              </span>
              <span className="font-bold">{money(kpis.transfer)}</span>
            </div>
            <div className="flex justify-between pt-1.5 mt-1 border-t border-zinc-200 dark:border-chikin-gray-700">
              <span className="font-bold">Total ingresos</span>
              <span className="font-display text-base text-chikin-red">{money(kpis.revenue)}</span>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-500 mb-2">
            Cálculo de ganancia neta
          </div>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-700 dark:text-zinc-200">Ingresos brutos</span>
              <span>{money(kpis.revenue)}</span>
            </div>
            <div className="flex justify-between text-blue-600">
              <span>− Delivery pagado</span>
              <span>−{money(kpis.deliveryPaid)}</span>
            </div>
            <div className="flex justify-between text-zinc-600 dark:text-zinc-300">
              <span>= Ingresos netos de venta</span>
              <span>{money(kpis.netRevenue)}</span>
            </div>
            <div className="flex justify-between text-rose-600">
              <span>− Gastos</span>
              <span>−{money(kpis.expenses)}</span>
            </div>
            <div className="flex justify-between pt-1.5 mt-1 border-t border-zinc-200 dark:border-chikin-gray-700">
              <span className="font-bold">= Ganancia neta</span>
              <span className={cx(
                'font-display text-base',
                kpis.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'
              )}>{money(kpis.profit)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ===== Tarjeta info: Promo estudiante (solo si hubo) ===== */}
      {(kpis.studentCount > 0 || kpis.studentDiscount > 0) && (
        <div className="card p-4 mb-6 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-900">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
              <GraduationCap size={20}/>
            </div>
            <div className="flex-1">
              <div className="text-xs uppercase tracking-wider text-emerald-700 dark:text-emerald-400 font-bold">
                Promo estudiante
              </div>
              <div className="text-sm text-zinc-700 dark:text-zinc-200">
                <span className="font-bold">{kpis.studentCount}</span> pedido{kpis.studentCount === 1 ? '' : 's'} con la promo ·
                Descuento total aplicado: <span className="font-bold text-emerald-700 dark:text-emerald-400">{money(kpis.studentDiscount)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== Sección de beneficios semanales =====
            Lectura desde el bloque benefits del payload de /api/orders-range
            (includeBenefits=1). Si falla o todavía está cargando, simplemente
            no se renderiza nada. El header de navegación de semana permite
            ver semanas anteriores sin perder el contexto del rango principal. */}
      {benefitsView && (
        <div className="mb-6">
          <BenefitsWeekHeader
            isoWeek={benefits.isoWeek}
            isCurrent={benefitsWeek === null}
            onPrev={() => {
              const current = benefitsWeek || benefits.isoWeek
              const prev = prevIsoWeek(current)
              if (prev) setBenefitsWeek(prev)
            }}
            onNext={() => {
              const current = benefitsWeek || benefits.isoWeek
              const next = nextIsoWeek(current)
              if (next) setBenefitsWeek(next)
            }}
            onToday={() => setBenefitsWeek(null)}
          />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <BenefitsEmployeeCard view={benefitsView.employeesView} isoWeek={benefits.isoWeek}/>
            <BenefitsOwnerCard view={benefitsView.ownersView} isoWeek={benefits.isoWeek}/>
          </div>
        </div>
      )}

      {/* ===== Gráfico principal de ventas ===== */}
      <ChartCard
        title="Ventas en el rango"
        icon={BarChart3}
        subtitle={
          granularity === 'hour'  ? 'Por hora' :
          granularity === 'month' ? 'Por mes'  : 'Por día'
        }
      >
        {timeSeries.length === 0 ? (
          <Empty />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={timeSeries} margin={{ top: 10, right: 16, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="grdRed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"  stopColor={C_RED} stopOpacity={0.6}/>
                  <stop offset="100%" stopColor={C_RED} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)"/>
              <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke={C_GRAY}/>
              <YAxis tick={{ fontSize: 11 }} stroke={C_GRAY} width={50}/>
              <Tooltip content={<CustomTooltip moneyFields={['total']} />} />
              <Area type="monotone" dataKey="total" name="Ingresos"
                    stroke={C_RED} strokeWidth={2.5} fill="url(#grdRed)"/>
            </AreaChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* ===== Comparativas anuales (solo en modo año) ===== */}
      {mode === 'year' && (
        <>
          <div className="grid lg:grid-cols-2 gap-4 mt-4">
            <ChartCard title={`Ventas mensuales ${year}`} icon={BarChart3} subtitle="Comparativa mensual">
              {monthlySeries && monthlySeries.some(m => m.total > 0) ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={monthlySeries} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)"/>
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke={C_GRAY}/>
                    <YAxis tick={{ fontSize: 11 }} stroke={C_GRAY} width={50}/>
                    <Tooltip content={<CustomTooltip moneyFields={['total']} />} />
                    <Bar dataKey="total" name="Ingresos" radius={[6, 6, 0, 0]}>
                      {monthlySeries.map((_, i) => (
                        <Cell key={i} fill={i === new Date().getMonth() && year === new Date().getFullYear() ? C_RED : C_DARK}/>
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <Empty/>}
            </ChartCard>

            <ChartCard title={`${year} vs ${year - 1}`} icon={TrendingUp} subtitle="Comparativa anual">
              {annualSeries && annualSeries.some(d => d.actual || d.anterior) ? (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={annualSeries} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)"/>
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke={C_GRAY}/>
                    <YAxis tick={{ fontSize: 11 }} stroke={C_GRAY} width={50}/>
                    <Tooltip content={<CustomTooltip moneyFields={['actual','anterior']} />} />
                    <Legend wrapperStyle={{ fontSize: '12px' }}/>
                    <Line type="monotone" dataKey="actual" name={String(year)}
                          stroke={C_RED} strokeWidth={3} dot={{ r: 3 }}/>
                    <Line type="monotone" dataKey="anterior" name={String(year - 1)}
                          stroke={C_GRAY} strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }}/>
                  </LineChart>
                </ResponsiveContainer>
              ) : <Empty/>}
            </ChartCard>
          </div>

          <ChartCard title={`Ganancia neta por mes (${year})`} icon={TrendingUp} subtitle="Ingresos · Gastos · Ganancia">
            {profitSeries && profitSeries.some(p => p.ingresos || p.gastos) ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={profitSeries} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)"/>
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke={C_GRAY}/>
                  <YAxis tick={{ fontSize: 11 }} stroke={C_GRAY} width={50}/>
                  <Tooltip content={<CustomTooltip moneyFields={['ingresos','gastos','ganancia']} />} />
                  <Legend wrapperStyle={{ fontSize: '12px' }}/>
                  <Bar dataKey="ingresos" name="Ingresos" fill={C_BLUE}    radius={[4, 4, 0, 0]}/>
                  <Bar dataKey="gastos"   name="Gastos"   fill={C_ROSE}    radius={[4, 4, 0, 0]}/>
                  <Bar dataKey="ganancia" name="Ganancia" fill={C_EMERALD} radius={[4, 4, 0, 0]}/>
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty/>}
          </ChartCard>
        </>
      )}

      {/* ===== Top productos: gráfico + tabla con cantidad y monto ===== */}
      <ChartCard title="Productos más vendidos" icon={ShoppingBag} subtitle="Top 10 por cantidad e ingresos">
        {top.length === 0 ? <Empty/> : (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4">
            <ResponsiveContainer width="100%" height={Math.max(280, top.length * 38)}>
              <BarChart data={top} layout="vertical" margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)"/>
                <XAxis type="number" tick={{ fontSize: 11 }} stroke={C_GRAY}/>
                <YAxis type="category" dataKey="name" width={130}
                       tick={{ fontSize: 11 }} stroke={C_GRAY} interval={0}/>
                <Tooltip content={<CustomTooltip moneyFields={['revenue']} />}/>
                <Bar dataKey="qty" name="Cantidad" fill={C_YELLOW} radius={[0, 6, 6, 0]}/>
              </BarChart>
            </ResponsiveContainer>
            <div className="overflow-x-auto lg:min-w-[280px]">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-zinc-500">
                    <th className="text-left py-1.5 pr-3">Producto</th>
                    <th className="text-right py-1.5 px-2">Cant.</th>
                    <th className="text-right py-1.5 pl-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map(p => (
                    <tr key={p.name} className="border-t border-zinc-100 dark:border-chikin-gray-700">
                      <td className="py-1.5 pr-3 truncate max-w-[180px]">{p.name}</td>
                      <td className="py-1.5 px-2 text-right font-bold">{p.qty}</td>
                      <td className="py-1.5 pl-2 text-right font-bold text-chikin-red">{money(p.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </ChartCard>

      {/* ===== Detalle de pedidos (con botón Anular para admin) ===== */}
      <motion.div className="card overflow-hidden mt-4"
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="p-4 border-b border-zinc-200 dark:border-chikin-gray-700 flex items-center gap-2 flex-wrap">
          <FileText size={18}/>
          <h2 className="font-bold">Detalle de pedidos</h2>
          <span className="ml-auto text-xs text-zinc-500">{orders.length} registros</span>
          {isAdmin && orders.length > 0 && (
            <span className="text-[10px] text-zinc-400 italic w-full md:w-auto md:ml-2">
              Toca el botón rojo para anular un pedido del reporte
            </span>
          )}
        </div>

        {orders.length === 0 ? (
          <div className="p-8 text-center text-zinc-400">Sin pedidos en este rango.</div>
        ) : (
          <>
            {/* Vista desktop: tabla */}
            <div className="hidden md:block overflow-x-auto max-h-[480px]">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 dark:bg-chikin-gray-800 text-xs uppercase tracking-wider text-zinc-500 sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left">#</th>
                    <th className="px-4 py-3 text-left">Fecha</th>
                    <th className="px-4 py-3 text-left">Cliente</th>
                    <th className="px-4 py-3 text-left">Estado</th>
                    <th className="px-4 py-3 text-left">Pago</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    {isAdmin && <th className="px-4 py-3 text-center w-20">Acción</th>}
                  </tr>
                </thead>
                <tbody>
                  {orders.map(o => (
                    <tr key={o.id} className="border-t border-zinc-100 dark:border-chikin-gray-700 hover:bg-zinc-50 dark:hover:bg-chikin-gray-800/40">
                      <td className="px-4 py-2 font-bold">{displayOrderNumber(o)}</td>
                      <td className="px-4 py-2 text-xs whitespace-nowrap">{fmtDate(o.created_at)} {fmtTime(o.created_at)}</td>
                      <td className="px-4 py-2">
                        {o.customer_name}
                        {o.benefit_type && (
                          <span className="ml-1.5 text-[9px] font-extrabold bg-chikin-yellow text-chikin-black px-1.5 py-0.5 rounded">
                            {o.benefit_type === 'discount' ? '⭐ EMP' : '🎁 CORT'}
                          </span>
                        )}
                        {o.discount_type === 'student' && (
                          <span className="ml-1.5 text-[9px] font-extrabold bg-emerald-600 text-white px-1.5 py-0.5 rounded">
                            🎓 EST
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2"><span className={`chip pill-${o.status}`}>{STATUS_LABEL[o.status]}</span></td>
                      <td className="px-4 py-2 capitalize">{o.payment_method}</td>
                      <td className="px-4 py-2 text-right font-bold">{money(o.total)}</td>
                      {isAdmin && (
                        <td className="px-4 py-2 text-center">
                          <button
                            onClick={() => setAnulling({ order: o })}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-200 dark:hover:bg-rose-900/50 transition text-xs font-bold"
                            title="Anular pedido del reporte"
                          >
                            <Trash2 size={12}/> Anular
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Vista móvil: tarjetas */}
            <div className="md:hidden divide-y divide-zinc-100 dark:divide-chikin-gray-700 max-h-[600px] overflow-y-auto">
              {orders.map(o => (
                <div key={o.id} className="p-3 hover:bg-zinc-50 dark:hover:bg-chikin-gray-800/40">
                  <div className="flex items-start justify-between mb-1">
                    <div>
                      <div className="font-display text-lg leading-none">{displayOrderNumber(o)}</div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">{fmtDate(o.created_at)} · {fmtTime(o.created_at)}</div>
                    </div>
                    <span className={`chip pill-${o.status} text-[10px]`}>{STATUS_LABEL[o.status]}</span>
                  </div>
                  <div className="text-sm font-semibold">
                    {o.customer_name}
                    {o.benefit_type && (
                      <span className="ml-1.5 text-[9px] font-extrabold bg-chikin-yellow text-chikin-black px-1.5 py-0.5 rounded">
                        {o.benefit_type === 'discount' ? '⭐ EMP' : '🎁 CORT'}
                      </span>
                    )}
                    {o.discount_type === 'student' && (
                      <span className="ml-1.5 text-[9px] font-extrabold bg-emerald-600 text-white px-1.5 py-0.5 rounded">
                        🎓 EST
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[11px] capitalize text-zinc-500 flex items-center gap-1">
                      {o.payment_method === 'efectivo' ? <Banknote size={11}/> : <ArrowRightLeft size={11}/>}
                      {o.payment_method}
                    </span>
                    <span className="font-display text-lg text-chikin-red">{money(o.total)}</span>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() => setAnulling({ order: o })}
                      className="w-full mt-2.5 py-2 rounded-lg bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-200 transition text-xs font-bold flex items-center justify-center gap-1.5"
                    >
                      <Trash2 size={13}/> Anular pedido
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </motion.div>

      {/* ===== Modal de anulación ===== */}
      <AnimatePresence>
        {anulling && (
          <AnularModal
            order={anulling.order}
            onClose={() => setAnulling(null)}
            onConfirm={(reason) => handleAnularConfirm(anulling.order, reason)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ============================================================
//  Pantalla completa de carga
// ============================================================
function FullPageLoading() {
  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto pb-12">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-1.5 h-10 bg-chikin-red rounded-full"/>
        <div>
          <h1 className="font-display text-3xl md:text-4xl">Reportes</h1>
          <p className="text-sm text-chikin-red flex items-center gap-1.5">
            <Loader2 size={14} className="animate-spin"/> Cargando reportes…
          </p>
        </div>
      </div>

      <div className="card p-12 text-center">
        <Loader2 className="mx-auto mb-3 text-chikin-red animate-spin" size={36}/>
        <p className="font-bold text-zinc-700 dark:text-zinc-200">Cargando reportes…</p>
        <p className="text-xs text-zinc-500 mt-1">Consultando pedidos y gastos en Supabase</p>
      </div>

      {/* Skeleton de KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 mt-6">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="card p-4 animate-pulse">
            <div className="h-2 w-12 bg-zinc-200 dark:bg-chikin-gray-700 rounded mb-3"/>
            <div className="h-6 w-20 bg-zinc-200 dark:bg-chikin-gray-700 rounded"/>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================================
//  Pantalla completa de error con botón "Reintentar"
// ============================================================
function FullPageError({ message, onRetry }) {
  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto pb-12">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-1.5 h-10 bg-chikin-red rounded-full"/>
        <div>
          <h1 className="font-display text-3xl md:text-4xl">Reportes</h1>
        </div>
      </div>
      <div className="card p-8 text-center bg-rose-50 dark:bg-rose-950/30 border-rose-300 dark:border-rose-900">
        <AlertTriangle className="mx-auto mb-3 text-rose-600" size={48}/>
        <h2 className="font-bold text-xl mb-2">No se pudieron cargar los reportes</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-5">{message}</p>
        <button onClick={onRetry}
          className="btn-lg bg-chikin-red text-white hover:bg-chikin-red-dark">
          <RotateCw size={18}/> Reintentar
        </button>
      </div>
    </div>
  )
}

// ============================================================
//  Modal de confirmación de anulación
// ============================================================
function AnularModal({ order, onClose, onConfirm }) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleConfirm = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      await onConfirm(reason.trim())
    } finally {
      setSubmitting(false)
    }
  }

  const items = order.order_items || []

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        className="bg-white dark:bg-chikin-gray-900 w-full md:max-w-md rounded-t-3xl md:rounded-3xl max-h-[90vh] overflow-y-auto"
      >
        {/* Header rojo */}
        <div className="bg-rose-600 text-white p-4 sticky top-0">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-lg flex items-center gap-2">
              <AlertTriangle size={20}/> Anular pedido
            </h3>
            <button onClick={onClose} disabled={submitting} className="p-1 hover:bg-white/20 rounded disabled:opacity-50">
              <X size={22}/>
            </button>
          </div>
        </div>

        {/* Detalles del pedido */}
        <div className="p-4 space-y-3">
          <div className="bg-zinc-50 dark:bg-chikin-gray-800 rounded-xl p-3 space-y-1.5 text-sm">
            <Row label="Pedido"   value={<span className="font-display text-xl">{displayOrderNumber(order)}</span>}/>
            <Row label="Fecha"    value={`${fmtDate(order.created_at)} · ${fmtTime(order.created_at)}`}/>
            <Row label="Cliente"  value={order.customer_name}/>
            <Row label="Estado"   value={STATUS_LABEL[order.status]}/>
            <Row label="Pago"     value={<span className="capitalize">{order.payment_method}</span>}/>
            <Row label="Entrega"  value={order.is_delivery ? 'Delivery' : (order.order_type === 'abierto' ? 'Abierto' : 'Para llevar')}/>
            <Row label="Total"    value={<span className="font-bold text-chikin-red">{money(order.total)}</span>}/>
            {order.benefit_type && (
              <Row label="Beneficio" value={
                <span className="text-xs font-bold">
                  {order.benefit_type === 'discount' ? '⭐ Descuento empleado' : '🎁 Cortesía'}
                  {order.benefit_employee && ` · ${order.benefit_employee}`}
                </span>
              }/>
            )}
          </div>

          {/* Productos */}
          {items.length > 0 && (
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1.5">
                Productos ({items.length})
              </div>
              <ul className="bg-zinc-50 dark:bg-chikin-gray-800 rounded-xl p-3 space-y-1 text-xs max-h-32 overflow-y-auto">
                {items.map(it => (
                  <li key={it.id} className="flex justify-between">
                    <span><b>{it.quantity}×</b> {it.product_name}</span>
                    <span className="text-zinc-500">{money(it.subtotal)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Advertencia */}
          <div className="bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-300 dark:border-yellow-900 rounded-xl p-3 text-xs text-zinc-700 dark:text-zinc-200 flex items-start gap-2">
            <AlertTriangle className="text-yellow-600 shrink-0 mt-0.5" size={14}/>
            <span>
              Este pedido <b>no se borrará físicamente</b>, solo dejará de contar en reportes
              y ventas. Podrás verlo y restaurarlo desde la pestaña <b>Anulados</b>.
            </span>
          </div>

          {/* Razón */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1.5 block">
              Razón de anulación <span className="font-normal italic">(opcional)</span>
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Ej: Pedido duplicado, cliente canceló después del registro…"
              rows={2}
              className="input min-h-[60px] text-sm"
              disabled={submitting}
            />
          </div>

          {/* Botones */}
          <div className="flex gap-2 pt-2">
            <button onClick={onClose} disabled={submitting}
              className="flex-1 btn-lg bg-zinc-100 dark:bg-chikin-gray-800 disabled:opacity-50">
              Cancelar
            </button>
            <button onClick={handleConfirm} disabled={submitting}
              className="flex-1 btn-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">
              {submitting
                ? <><Loader2 size={18} className="animate-spin"/> Anulando…</>
                : <><Trash2 size={18}/> Confirmar anulación</>}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs uppercase tracking-wider text-zinc-500 font-bold">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )
}

// ============================================================
//  Componentes auxiliares
// ============================================================
function RangeFilters({ mode, onMode, year, onYear, years, from, to, onFrom, onTo }) {
  const TABS = [
    { v: 'today',  l: 'Hoy'    },
    { v: 'week',   l: 'Semana' },
    { v: 'month',  l: 'Mes'    },
    { v: 'year',   l: 'Año'    },
    { v: 'custom', l: 'Personalizado' },
  ]
  return (
    <div className="card p-3 md:p-4 mb-5">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex flex-wrap gap-1 bg-zinc-100 dark:bg-chikin-gray-800 rounded-xl p-1">
          {TABS.map(t => (
            <button key={t.v} onClick={() => onMode(t.v)}
              className={cx(
                'px-3 md:px-4 py-2 rounded-lg text-sm font-bold transition',
                mode === t.v
                  ? 'bg-chikin-red text-white shadow shadow-chikin-red/25'
                  : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
              )}>
              {t.l}
            </button>
          ))}
        </div>

        {mode === 'year' && (
          <div className="relative">
            <select
              value={year}
              onChange={e => onYear(Number(e.target.value))}
              className="appearance-none input pr-9 font-bold cursor-pointer"
            >
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <ChevronDown size={16} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400"/>
          </div>
        )}

        {mode === 'custom' && (
          <div className="flex items-center gap-2 flex-wrap">
            <Calendar size={16} className="text-zinc-400"/>
            <input type="date" value={from} onChange={e => onFrom(e.target.value)} className="input py-1.5 text-sm"/>
            <span className="text-zinc-400 text-sm">→</span>
            <input type="date" value={to}   onChange={e => onTo(e.target.value)}   className="input py-1.5 text-sm"/>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ icon: Icon, label, value, accent }) {
  const accentColors = {
    red:     'text-chikin-red',
    yellow:  'text-amber-600 dark:text-chikin-yellow',
    rose:    'text-rose-600',
    emerald: 'text-emerald-600',
    blue:    'text-blue-600',
  }
  return (
    <motion.div className="card p-4 hover:shadow-md transition"
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">{label}</span>
        {Icon && <Icon size={14} className="text-zinc-400"/>}
      </div>
      <div className={cx('font-display text-xl md:text-2xl', accentColors[accent] || '')}>
        {value}
      </div>
    </motion.div>
  )
}

function ChartCard({ title, subtitle, icon: Icon, children }) {
  return (
    <motion.div className="card p-4 mt-4"
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {Icon && <Icon size={18} className="text-chikin-red"/>}
          <h2 className="font-bold">{title}</h2>
        </div>
        {subtitle && <span className="text-xs text-zinc-500">{subtitle}</span>}
      </div>
      {children}
    </motion.div>
  )
}

function Empty() {
  return (
    <div className="h-48 flex items-center justify-center text-sm text-zinc-400">
      Sin datos en este rango.
    </div>
  )
}

function CustomTooltip({ active, payload, label, moneyFields = [] }) {
  if (!active || !payload || !payload.length) return null
  return (
    <div className="bg-chikin-black text-white rounded-xl shadow-2xl p-3 text-xs">
      <div className="font-bold mb-1">{label}</div>
      {payload.map(p => {
        const isMoney = moneyFields.includes(p.dataKey)
        return (
          <div key={p.dataKey} className="flex items-center justify-between gap-3 py-0.5">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: p.color || p.fill }}/>
              {p.name}
            </span>
            <span className="font-bold">
              {isMoney ? '$' + Number(p.value || 0).toFixed(2) : p.value}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ============================================================
//  BenefitsEmployeeCard — empleados normales y su semana
//
//  Para cada empleado muestra:
//    * si usó descuento diario HOY (chip "Usado hoy" / "Disponible hoy")
//    * cuántos descuentos lleva en la semana (informativo)
//    * si usó cortesía semanal (chip "Cortesía usada" con día/hora y #pedido,
//      o "Cortesía disponible")
// ============================================================
// ============================================================
//  BenefitsWeekHeader — encabezado con navegación de semanas
//
//  Botones: « semana anterior · semana actual (botón "Hoy" si no
//  estamos viendo la actual) · siguiente ».
//  Muestra "YYYY-Www" prominente + el rango de fechas (lun – dom)
//  abajo en gris.
// ============================================================
function BenefitsWeekHeader({ isoWeek, isCurrent, onPrev, onNext, onToday }) {
  const range = isoWeekHumanRange(isoWeek)
  return (
    <motion.div className="card p-4 mb-4 flex items-center gap-3 flex-wrap"
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-chikin-red text-white flex items-center justify-center shrink-0">
          <CalendarDays size={20}/>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">
            Beneficios de la semana
          </div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-display text-xl md:text-2xl">{isoWeek}</span>
            <span className="text-sm text-zinc-500">{range}</span>
            {isCurrent && (
              <span className="chip bg-emerald-100 text-emerald-700 text-[10px] font-extrabold uppercase">
                Actual
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={onPrev}
          className="btn bg-zinc-100 dark:bg-chikin-gray-800 hover:bg-zinc-200 dark:hover:bg-chikin-gray-700 px-3 py-2"
          aria-label="Semana anterior"
          title="Semana anterior"
        >
          <ChevronLeft size={16}/>
          <span className="hidden sm:inline ml-0.5 text-xs font-bold">Anterior</span>
        </button>
        {!isCurrent && (
          <button
            onClick={onToday}
            className="btn bg-chikin-red text-white hover:bg-chikin-red-dark px-3 py-2 text-xs font-bold"
            title="Volver a la semana actual"
          >
            Hoy
          </button>
        )}
        <button
          onClick={onNext}
          className="btn bg-zinc-100 dark:bg-chikin-gray-800 hover:bg-zinc-200 dark:hover:bg-chikin-gray-700 px-3 py-2"
          aria-label="Semana siguiente"
          title="Semana siguiente"
        >
          <span className="hidden sm:inline mr-0.5 text-xs font-bold">Siguiente</span>
          <ChevronRight size={16}/>
        </button>
      </div>
    </motion.div>
  )
}

// ============================================================
//  BenefitsEmployeeCard — empleados normales (NO incluye dueños)
//
//  Diseño en filas espaciadas. Cada empleado se ve como una tarjeta
//  mini con nombre destacado y dos estados claramente etiquetados:
//
//    Descuento diario (lunes-domingo)  → "Usado hoy" o "Disponible"
//    Cortesía semanal                  → "Usada · 14:35 · #42" o "Pendiente"
//
//  Los chips están claramente coloreados:
//    - amarillo = beneficio activo/usado
//    - gris suave = pendiente/disponible
// ============================================================
function BenefitsEmployeeCard({ view, isoWeek }) {
  return (
    <motion.div className="card overflow-hidden"
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="px-5 py-4 border-b border-zinc-100 dark:border-chikin-gray-700 bg-zinc-50/50 dark:bg-chikin-gray-900/40">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-chikin-red/10 text-chikin-red flex items-center justify-center">
            <Users size={16}/>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-base leading-tight">Empleados</h3>
            <p className="text-[11px] text-zinc-500">
              {view.length} empleado{view.length === 1 ? '' : 's'} · descuento diario + cortesía semanal
            </p>
          </div>
        </div>
      </div>
      {view.length === 0 ? (
        <div className="p-6 text-center text-sm text-zinc-400">
          Sin empleados registrados.
        </div>
      ) : (
        <div className="divide-y divide-zinc-100 dark:divide-chikin-gray-800 max-h-[420px] overflow-y-auto">
          {view.map(e => (
            <div key={e.username} className="p-4 hover:bg-zinc-50 dark:hover:bg-chikin-gray-900/40 transition">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="font-bold text-sm">{e.displayName}</div>
                {e.discountsWeek > 0 && (
                  <span className="text-[10px] text-zinc-500">
                    {e.discountsWeek} descuento{e.discountsWeek === 1 ? '' : 's'} esta semana
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {/* Descuento diario */}
                <BenefitChip
                  label="Descuento hoy"
                  used={e.discountsToday > 0}
                  usedText="Usado hoy"
                  pendingText="Disponible"
                  color="yellow"
                />
                {/* Cortesía semanal */}
                <BenefitChip
                  label="Cortesía semanal"
                  used={e.courtesyWeek}
                  usedText={
                    <>
                      Usada{e.courtesyAt ? ` · ${fmtTime(e.courtesyAt)}` : ''}
                      {e.courtesyOrderNumber ? ` · #${e.courtesyOrderNumber}` : ''}
                    </>
                  }
                  pendingText="Pendiente"
                  color="emerald"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  )
}

// Sub-componente reutilizable para chip de beneficio.
// "color" decide la tonalidad cuando el chip está en estado USADO.
// Cuando está pendiente siempre es gris suave.
function BenefitChip({ label, used, usedText, pendingText, color }) {
  const usedClasses = color === 'yellow'
    ? 'bg-chikin-yellow/90 text-chikin-black border-chikin-yellow'
    : 'bg-emerald-600 text-white border-emerald-600'
  const icon = color === 'yellow' ? '⭐' : '🎁'
  return (
    <div className={cx(
      'flex items-center gap-2 px-2.5 py-1.5 rounded-lg border',
      used
        ? usedClasses
        : 'bg-zinc-100 dark:bg-chikin-gray-800 text-zinc-500 border-zinc-200 dark:border-chikin-gray-700'
    )}>
      <span className="text-base leading-none">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[9px] uppercase tracking-wider font-extrabold opacity-80 leading-tight">
          {label}
        </div>
        <div className="text-[11px] font-bold truncate leading-tight">
          {used ? usedText : pendingText}
        </div>
      </div>
    </div>
  )
}

// ============================================================
//  BenefitsOwnerCard — dueños (Cindy88, Daivid88, Stephano88)
//
//  Sin límites. Muestra contadores grandes de la semana y los
//  últimos 5 usos con hora + #pedido. Layout más vertical/espacioso
//  para que se lea cómodo.
// ============================================================
function BenefitsOwnerCard({ view, isoWeek }) {
  return (
    <motion.div className="card overflow-hidden border-amber-300/40 dark:border-amber-900/40"
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="px-5 py-4 border-b border-amber-200/40 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-700 dark:text-amber-400 flex items-center justify-center">
            <Crown size={16}/>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-base leading-tight">Dueños</h3>
            <p className="text-[11px] text-zinc-500">
              Sin límite · solo seguimiento
            </p>
          </div>
        </div>
      </div>
      {view.length === 0 ? (
        <div className="p-6 text-center text-sm text-zinc-400">
          Sin dueños registrados.
        </div>
      ) : (
        <div className="divide-y divide-amber-100/60 dark:divide-amber-900/30 max-h-[420px] overflow-y-auto">
          {view.map(o => (
            <div key={o.username} className="p-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="font-bold text-sm">{o.displayName}</div>
                <div className="flex gap-1.5">
                  <span className="chip bg-chikin-yellow text-chikin-black text-[10px] font-extrabold">
                    ⭐ {o.discountsWeek}
                  </span>
                  <span className="chip bg-emerald-600 text-white text-[10px] font-extrabold">
                    🎁 {o.courtesiesWeek}
                  </span>
                </div>
              </div>
              {o.lastUses.length > 0 ? (
                <div className="space-y-1">
                  <div className="text-[9px] uppercase tracking-wider text-zinc-400 font-bold">
                    Últimos usos
                  </div>
                  {o.lastUses.map((u, i) => (
                    <div key={i} className="text-[11px] text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5 pl-1">
                      <Clock4 size={11} className="text-zinc-400"/>
                      <span className="text-sm leading-none">
                        {u.type === 'discount' ? '⭐' : '🎁'}
                      </span>
                      <span className="font-semibold">{fmtTime(u.at) || '—'}</span>
                      {u.orderNumber && (
                        <span className="text-zinc-400">· pedido #{u.orderNumber}</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-zinc-400 italic">
                  Sin usos esta semana
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </motion.div>
  )
}
