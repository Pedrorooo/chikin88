import { useEffect, useState, useCallback } from 'react'
import {
  TrendingUp, ShoppingBag, Receipt, DollarSign,
  Trophy, Banknote, ArrowRightLeft, XCircle,
  RefreshCw, AlertTriangle, Loader2, RotateCw,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { money, todayRange, weekRange, monthRange, cx } from '../lib/utils'
import { supabaseWithTimeout } from '../lib/appHealth'

const RANGES = [
  { v: 'today', l: 'Hoy',     fn: todayRange },
  { v: 'week',  l: 'Semana',  fn: weekRange  },
  { v: 'month', l: 'Mes',     fn: monthRange },
]

const EMPTY_STATS = {
  revenue: 0, expenses: 0, orders: 0, cancelled: 0,
  cash: 0, transfer: 0, products: [],
}

export default function Dashboard() {
  const [range, setRange] = useState('today')
  const [stats, setStats] = useState(EMPTY_STATS)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const { start, end } = (RANGES.find(r => r.v === range).fn)()

    ;(async () => {
      try {
        // Timeout duro de 12s en cada query. Si Supabase está stale,
        // el AbortController mata la petición y mostramos error.
        const [oRes, eRes] = await Promise.all([
          supabaseWithTimeout(
            supabase.from('orders')
              .select('id, total, payment_method, status, created_at, deleted_from_reports, benefit_type, order_items(product_name, quantity, subtotal)')
              .gte('created_at', start).lte('created_at', end)
              .eq('deleted_from_reports', false)
              .limit(5000),
            12_000,
            'Tiempo agotado cargando pedidos'
          ),
          supabaseWithTimeout(
            supabase.from('expenses')
              .select('amount').gte('expense_date', start.slice(0,10)).lte('expense_date', end.slice(0,10))
              .limit(2000),
            12_000,
            'Tiempo agotado cargando gastos'
          ),
        ])

        if (cancelled) return
        if (oRes.error) throw oRes.error
        if (eRes.error) throw eRes.error

        const orders = oRes.data || []
        const valid = orders.filter(o => o.status !== 'cancelado')
        const rev   = valid.filter(o => o.benefit_type !== 'courtesy')
        const expenses = eRes.data || []

        const revenue   = rev.reduce((s, o) => s + Number(o.total || 0), 0)
        const cash      = rev.filter(o => o.payment_method === 'efectivo').reduce((s, o) => s + Number(o.total || 0), 0)
        const transfer  = rev.filter(o => o.payment_method === 'transferencia').reduce((s, o) => s + Number(o.total || 0), 0)
        const expSum    = expenses.reduce((s, e) => s + Number(e.amount || 0), 0)

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

        setStats({
          revenue, expenses: expSum, orders: valid.length,
          cancelled: orders.length - valid.length,
          cash, transfer, products,
        })
        setReady(true)
      } catch (err) {
        if (cancelled) return
        console.error('[Dashboard] error:', err?.message || err)
        setError(err?.message || 'No se pudieron cargar los datos')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [range, refreshKey])

  const profit = stats.revenue - stats.expenses

  // Loading inicial sin datos previos: pantalla completa con skeleton
  if (!ready && loading && !error) {
    return (
      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-1.5 h-10 bg-chikin-red rounded-full"/>
          <div>
            <h1 className="font-display text-3xl md:text-4xl">Dashboard</h1>
            <p className="text-sm text-chikin-red flex items-center gap-1.5">
              <Loader2 size={14} className="animate-spin"/> Cargando dashboard…
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="h-2 w-12 bg-zinc-200 dark:bg-chikin-gray-700 rounded mb-3"/>
              <div className="h-6 w-20 bg-zinc-200 dark:bg-chikin-gray-700 rounded"/>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Error sin datos previos: pantalla completa con botón Reintentar
  if (!ready && error) {
    return (
      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-1.5 h-10 bg-chikin-red rounded-full"/>
          <h1 className="font-display text-3xl md:text-4xl">Dashboard</h1>
        </div>
        <div className="card p-8 text-center bg-rose-50 dark:bg-rose-950/30 border-rose-300 dark:border-rose-900">
          <AlertTriangle className="mx-auto mb-3 text-rose-600" size={48}/>
          <h2 className="font-bold text-xl mb-2">No se pudieron cargar los datos</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-5">{error}</p>
          <button onClick={refresh}
            className="btn-lg bg-chikin-red text-white hover:bg-chikin-red-dark">
            <RotateCw size={18}/> Reintentar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-10 bg-chikin-red rounded-full"/>
          <div>
            <h1 className="font-display text-3xl md:text-4xl">Dashboard</h1>
            <p className="text-sm text-zinc-500">
              Resumen ejecutivo
              {loading && ready && (
                <span className="ml-2 inline-flex items-center gap-1 text-chikin-red">
                  <Loader2 size={12} className="animate-spin"/> Actualizando…
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="flex gap-1 bg-white dark:bg-chikin-gray-800 rounded-xl p-1">
            {RANGES.map(r => (
              <button key={r.v} onClick={() => setRange(r.v)}
                className={cx(
                  'px-4 py-2 rounded-lg text-sm font-bold transition',
                  range === r.v ? 'bg-chikin-red text-white' : 'text-zinc-500'
                )}>{r.l}</button>
            ))}
          </div>
          <button onClick={refresh} disabled={loading}
            className="btn bg-zinc-100 dark:bg-chikin-gray-800 hover:bg-zinc-200 dark:hover:bg-chikin-gray-700 disabled:opacity-50">
            <RefreshCw size={16} className={cx(loading && 'animate-spin')}/>
            <span className="hidden sm:inline">Actualizar</span>
          </button>
        </div>
      </div>

      {/* Banner si falló refetch pero hay datos viejos */}
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

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KPI icon={DollarSign}  label="Ingresos"     value={money(stats.revenue)}  color="emerald"/>
        <KPI icon={Receipt}     label="Gastos"       value={money(stats.expenses)} color="rose"/>
        <KPI icon={TrendingUp}  label="Ganancia"     value={money(profit)}         color={profit >= 0 ? 'amber' : 'rose'}/>
        <KPI icon={ShoppingBag} label="Pedidos"      value={stats.orders}          color="blue"/>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Productos top */}
        <motion.div className="card p-5"
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <h2 className="font-bold text-lg mb-4 flex items-center gap-2">
            <Trophy className="text-chikin-yellow" size={20}/> Productos más vendidos
          </h2>
          {stats.products.length === 0
            ? <p className="text-sm text-zinc-400">Sin datos en este rango.</p>
            : (
              <ul className="space-y-2">
                {stats.products.map((p, i) => {
                  const max = stats.products[0].qty
                  const w = Math.max(8, (p.qty / max) * 100)
                  return (
                    <li key={p.name}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 font-semibold text-sm">
                          <span className={cx(
                            'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold',
                            i === 0 ? 'bg-chikin-yellow text-chikin-black' :
                            i === 1 ? 'bg-zinc-300 text-zinc-800' :
                            i === 2 ? 'bg-orange-300 text-orange-900' :
                                      'bg-zinc-100 dark:bg-chikin-gray-700 text-zinc-500'
                          )}>{i + 1}</span>
                          {p.name}
                        </div>
                        <div className="text-sm">
                          <span className="font-bold">{p.qty}</span>
                          <span className="text-zinc-400 text-xs ml-2">{money(p.rev)}</span>
                        </div>
                      </div>
                      <div className="h-1.5 bg-zinc-100 dark:bg-chikin-gray-700 rounded-full overflow-hidden">
                        <motion.div className="h-full bg-chikin-red"
                          initial={{ width: 0 }} animate={{ width: `${w}%` }} transition={{ duration: 0.6 }}/>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
        </motion.div>

        {/* Métodos de pago */}
        <motion.div className="card p-5"
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <h2 className="font-bold text-lg mb-4">Métodos de pago</h2>
          <div className="space-y-3">
            <PayBar icon={Banknote} label="Efectivo"      amount={stats.cash}     total={stats.revenue} color="emerald"/>
            <PayBar icon={ArrowRightLeft} label="Transferencia" amount={stats.transfer} total={stats.revenue} color="blue"/>
          </div>

          <div className="mt-6 pt-6 border-t border-zinc-100 dark:border-chikin-gray-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-zinc-500">
                <XCircle size={18}/> Pedidos cancelados
              </div>
              <span className="font-bold text-rose-600">{stats.cancelled}</span>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}

function KPI({ icon: Icon, label, value, color }) {
  const colors = {
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    rose:    'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
    amber:   'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    blue:    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  }
  return (
    <motion.div className="card p-4"
      initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
      <div className={cx('w-10 h-10 rounded-xl flex items-center justify-center mb-2', colors[color])}>
        <Icon size={20}/>
      </div>
      <div className="text-xs uppercase tracking-wider text-zinc-500 font-bold">{label}</div>
      <div className="font-display text-2xl md:text-3xl mt-0.5">{value}</div>
    </motion.div>
  )
}

function PayBar({ icon: Icon, label, amount, total, color }) {
  const pct = total > 0 ? (amount / total) * 100 : 0
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold text-sm flex items-center gap-2">
          <Icon size={16}/> {label}
        </span>
        <span className="text-sm">
          <span className="font-bold">{money(amount)}</span>
          <span className="text-zinc-400 text-xs ml-2">{pct.toFixed(0)}%</span>
        </span>
      </div>
      <div className="h-2 bg-zinc-100 dark:bg-chikin-gray-700 rounded-full overflow-hidden">
        <motion.div className={cx('h-full', color === 'emerald' ? 'bg-emerald-500' : 'bg-blue-500')}
          initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.5 }}/>
      </div>
    </div>
  )
}
