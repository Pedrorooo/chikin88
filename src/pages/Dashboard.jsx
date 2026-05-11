import { useEffect, useState } from 'react'
import {
  TrendingUp, ShoppingBag, Receipt, DollarSign,
  Trophy, Banknote, ArrowRightLeft, XCircle,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { money, todayRange, weekRange, monthRange, cx } from '../lib/utils'

const RANGES = [
  { v: 'today', l: 'Hoy',     fn: todayRange },
  { v: 'week',  l: 'Semana',  fn: weekRange  },
  { v: 'month', l: 'Mes',     fn: monthRange },
]

export default function Dashboard() {
  const [range, setRange] = useState('today')
  const [stats, setStats] = useState({
    revenue: 0, expenses: 0, orders: 0, cancelled: 0,
    cash: 0, transfer: 0, products: [],
  })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    (async () => {
      setLoading(true)
      const { start, end } = (RANGES.find(r => r.v === range).fn)()

      const [oRes, eRes] = await Promise.all([
        supabase.from('orders')
          .select('id, total, payment_method, status, created_at, deleted_from_reports, benefit_type, order_items(product_name, quantity, subtotal)')
          .gte('created_at', start).lte('created_at', end)
          .eq('deleted_from_reports', false)
          .limit(5000),
        supabase.from('expenses')
          .select('amount').gte('expense_date', start.slice(0,10)).lte('expense_date', end.slice(0,10))
          .limit(2000),
      ])

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
      setLoading(false)
    })()
  }, [range])

  const profit = stats.revenue - stats.expenses

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-10 bg-chikin-red rounded-full"/>
          <div>
            <h1 className="font-display text-3xl md:text-4xl">Dashboard</h1>
            <p className="text-sm text-zinc-500">Resumen ejecutivo</p>
          </div>
        </div>
        <div className="flex gap-1 bg-white dark:bg-chikin-gray-800 rounded-xl p-1">
          {RANGES.map(r => (
            <button key={r.v} onClick={() => setRange(r.v)}
              className={cx(
                'px-4 py-2 rounded-lg text-sm font-bold transition',
                range === r.v ? 'bg-chikin-red text-white' : 'text-zinc-500'
              )}>{r.l}</button>
          ))}
        </div>
      </div>

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
