import { useEffect, useMemo, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileText, Download, Calendar, BarChart3, TrendingUp, ChevronDown,
  FileSpreadsheet, FileDown, ShoppingBag, DollarSign, Wallet, Target,
  RefreshCw, Trash2, X, AlertTriangle, Loader2, RotateCw,
  Banknote, ArrowRightLeft,
} from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, AreaChart, Area, Cell,
} from 'recharts'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useOrderStore } from '../store/orderStore'
import {
  money, fmtDate, fmtTime, cx, STATUS_LABEL,
  todayRange, weekRange, monthRange,
} from '../lib/utils'
import {
  validOrders, groupOrdersByTime, granularityForRange,
  topProducts, monthlySalesForYear, annualComparison,
  monthlyProfit, computeKpis,
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

  // ----- Cargar datos del rango principal -----
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const { start, end } = currentRange
    ;(async () => {
      try {
        const [oRes, eRes] = await Promise.all([
          supabase.from('orders')
            .select('*, order_items(*)')
            .gte('created_at', start).lte('created_at', end)
            .eq('deleted_from_reports', false)
            .order('created_at', { ascending: false })
            .limit(5000),
          supabase.from('expenses').select('*')
            .gte('expense_date', start.slice(0, 10)).lte('expense_date', end.slice(0, 10))
            .order('expense_date', { ascending: false })
            .limit(2000),
        ])
        if (cancelled) return
        if (oRes.error) throw oRes.error
        if (eRes.error) throw eRes.error
        setOrders(oRes.data || [])
        setExpenses(eRes.data || [])
        setReady(true)
      } catch (err) {
        if (cancelled) return
        console.error('Reports fetch error:', err)
        setError(err.message || 'Error al cargar reportes')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [currentRange])

  // ----- Cargar datos extra para comparativas anuales -----
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
      try {
        const [prevRes, expRes] = await Promise.all([
          supabase.from('orders')
            .select('id, order_number, total, created_at, status, deleted_from_reports, benefit_type')
            .gte('created_at', prev.start).lte('created_at', prev.end)
            .eq('deleted_from_reports', false)
            .limit(5000),
          supabase.from('expenses').select('*')
            .gte('expense_date', cur.start.slice(0,10)).lte('expense_date', cur.end.slice(0,10))
            .limit(2000),
        ])
        if (cancelled) return
        setPrevYearOrders(prevRes.data || [])
        setYearExpenses(expRes.data || [])
      } catch (err) {
        console.error('annual fetch error:', err)
      }
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
      toast.success(`Pedido #${order.order_number} anulado`)
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

      {/* ===== KPIs ===== */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 mb-6">
        <Stat icon={ShoppingBag} label="Pedidos"       value={kpis.orderCount} />
        <Stat icon={DollarSign}  label="Ingresos"      value={money(kpis.revenue)} accent="red"/>
        <Stat icon={Wallet}      label="Gastos"        value={money(kpis.expenses)} accent="rose"/>
        <Stat icon={TrendingUp}  label="Ganancia neta" value={money(kpis.profit)}
              accent={kpis.profit >= 0 ? 'emerald' : 'rose'}/>
        <Stat icon={Target}      label="Ticket prom."  value={money(kpis.avgTicket)} accent="yellow"/>
      </div>

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

      {/* ===== Top productos ===== */}
      <ChartCard title="Productos más vendidos" icon={ShoppingBag} subtitle="Top 10 por cantidad">
        {top.length === 0 ? <Empty/> : (
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
                      <td className="px-4 py-2 font-bold">#{o.order_number}</td>
                      <td className="px-4 py-2 text-xs whitespace-nowrap">{fmtDate(o.created_at)} {fmtTime(o.created_at)}</td>
                      <td className="px-4 py-2">
                        {o.customer_name}
                        {o.benefit_type && (
                          <span className="ml-1.5 text-[9px] font-extrabold bg-chikin-yellow text-chikin-black px-1.5 py-0.5 rounded">
                            {o.benefit_type === 'discount' ? '⭐ EMP' : '🎁 CORT'}
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
                      <div className="font-display text-lg leading-none">#{o.order_number}</div>
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
            <Row label="Pedido"   value={<span className="font-display text-xl">#{order.order_number}</span>}/>
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
