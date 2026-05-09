import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  FileText, Download, Calendar, BarChart3, TrendingUp, ChevronDown,
  FileSpreadsheet, FileDown, ShoppingBag, DollarSign, Wallet, Target,
} from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, AreaChart, Area, Cell,
} from 'recharts'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
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
  if (mode === 'today')      return 'hoy'
  if (mode === 'week')       return 'semana'
  if (mode === 'month')      return 'mes'
  if (mode === 'year')       return `año-${year}`
  if (mode === 'custom')     return `${from}_a_${to}`
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

// ===== Página =====
export default function Reports() {
  const [mode, setMode] = useState('month')                            // today/week/month/year/custom
  const [year, setYear] = useState(new Date().getFullYear())
  const [customFrom, setCustomFrom] = useState(() => new Date(Date.now() - 6*86400000).toISOString().slice(0,10))
  const [customTo,   setCustomTo]   = useState(() => new Date().toISOString().slice(0,10))

  const [orders, setOrders] = useState([])
  const [expenses, setExpenses] = useState([])
  const [prevYearOrders, setPrevYearOrders] = useState([])
  const [yearExpenses, setYearExpenses] = useState([])
  const [loading, setLoading] = useState(false)

  const yearsAvailable = useMemo(() => {
    const cy = new Date().getFullYear()
    return [cy, cy - 1, cy - 2, cy - 3, cy - 4]
  }, [])

  // ----- Calcular el rango actual -----
  const currentRange = useMemo(() => {
    if (mode === 'today') return todayRange()
    if (mode === 'week')  return weekRange()
    if (mode === 'month') return monthRange()
    if (mode === 'year')  return yearRange(year)
    if (mode === 'custom' && customFrom && customTo) return customRange(customFrom, customTo)
    return todayRange()
  }, [mode, year, customFrom, customTo])

  const rangeLabel = fmtRangeLabel(mode, year, customFrom, customTo)

  // ----- Cargar datos del rango principal -----
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { start, end } = currentRange
      try {
        const [oRes, eRes] = await Promise.all([
          supabase.from('orders')
            .select('*, order_items(*)')
            .gte('created_at', start).lte('created_at', end)
            .order('created_at', { ascending: false }),
          supabase.from('expenses').select('*')
            .gte('expense_date', start.slice(0, 10)).lte('expense_date', end.slice(0, 10))
            .order('expense_date', { ascending: false }),
        ])
        if (cancelled) return
        if (oRes.error) toast.error('Error cargando pedidos')
        if (eRes.error) toast.error('Error cargando gastos')
        setOrders(oRes.data || [])
        setExpenses(eRes.data || [])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [currentRange])

  // ----- Cargar datos extra para comparativas anuales -----
  // Si estamos en modo "año", también traemos el año anterior y los gastos completos del año
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
            .select('id, order_number, total, created_at, status')
            .gte('created_at', prev.start).lte('created_at', prev.end),
          supabase.from('expenses').select('*')
            .gte('expense_date', cur.start.slice(0,10)).lte('expense_date', cur.end.slice(0,10)),
        ])
        if (cancelled) return
        setPrevYearOrders(prevRes.data || [])
        setYearExpenses(expRes.data || [])
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [mode, year])

  // ----- Cálculos -----
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

  // ----- Exports -----
  const handleExport = async (kind) => {
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

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto pb-12">
      {/* ===== Header ===== */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-10 bg-chikin-red rounded-full"/>
          <div>
            <h1 className="font-display text-3xl md:text-4xl">Reportes</h1>
            <p className="text-sm text-zinc-500">Histórico, gráficos y exportación</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => handleExport('pdf')}
                  className="btn bg-chikin-red text-white shadow-md shadow-chikin-red/30 hover:bg-chikin-red-dark">
            <FileDown size={16}/> PDF
          </button>
          <button onClick={() => handleExport('excel')}
                  className="btn bg-emerald-600 text-white hover:bg-emerald-700">
            <FileSpreadsheet size={16}/> Excel
          </button>
          <button onClick={() => handleExport('csv')}
                  className="btn bg-chikin-yellow text-chikin-black hover:brightness-95">
            <Download size={16}/> CSV
          </button>
        </div>
      </div>

      {/* ===== Filtros ===== */}
      <RangeFilters
        mode={mode} onMode={setMode}
        year={year} onYear={setYear} years={yearsAvailable}
        from={customFrom} to={customTo}
        onFrom={setCustomFrom} onTo={setCustomTo}
      />

      {/* ===== KPIs ===== */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 mb-6">
        <Stat icon={ShoppingBag} label="Pedidos"        value={kpis.orderCount} />
        <Stat icon={DollarSign}  label="Ingresos"       value={money(kpis.revenue)} accent="red"/>
        <Stat icon={Wallet}      label="Gastos"         value={money(kpis.expenses)} accent="rose"/>
        <Stat icon={TrendingUp}  label="Ganancia neta"  value={money(kpis.profit)}
              accent={kpis.profit >= 0 ? 'emerald' : 'rose'}/>
        <Stat icon={Target}      label="Ticket prom."   value={money(kpis.avgTicket)} accent="yellow"/>
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
                  <stop offset="0%"  stopColor={C_RED}    stopOpacity={0.6}/>
                  <stop offset="100%" stopColor={C_RED}   stopOpacity={0}/>
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

          {/* ===== Ganancias netas por mes ===== */}
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

      {/* ===== Tabla de pedidos ===== */}
      <motion.div className="card overflow-hidden mt-4"
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="p-4 border-b border-zinc-200 dark:border-chikin-gray-700 flex items-center gap-2">
          <FileText size={18}/>
          <h2 className="font-bold">Detalle de pedidos</h2>
          <span className="ml-auto text-xs text-zinc-500">{orders.length} registros</span>
        </div>
        {loading ? (
          <div className="p-8 text-center text-zinc-400">Cargando…</div>
        ) : orders.length === 0 ? (
          <div className="p-8 text-center text-zinc-400">Sin pedidos en este rango.</div>
        ) : (
          <div className="overflow-x-auto max-h-[480px]">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-chikin-gray-800 text-xs uppercase tracking-wider text-zinc-500 sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-left">#</th>
                  <th className="px-4 py-3 text-left">Fecha</th>
                  <th className="px-4 py-3 text-left">Cliente</th>
                  <th className="px-4 py-3 text-left">Estado</th>
                  <th className="px-4 py-3 text-left">Pago</th>
                  <th className="px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id} className="border-t border-zinc-100 dark:border-chikin-gray-700 hover:bg-zinc-50 dark:hover:bg-chikin-gray-800/40">
                    <td className="px-4 py-2 font-bold">#{o.order_number}</td>
                    <td className="px-4 py-2 text-xs whitespace-nowrap">{fmtDate(o.created_at)} {fmtTime(o.created_at)}</td>
                    <td className="px-4 py-2">{o.customer_name}</td>
                    <td className="px-4 py-2"><span className={`chip pill-${o.status}`}>{STATUS_LABEL[o.status]}</span></td>
                    <td className="px-4 py-2 capitalize">{o.payment_method}</td>
                    <td className="px-4 py-2 text-right font-bold">{money(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
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

        {/* Selector de año (visible siempre que mode === 'year') */}
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

        {/* Selector de rango personalizado */}
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
