import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { FileText, Download } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { money, fmtDate, todayRange, weekRange, monthRange, cx, STATUS_LABEL, fmtTime } from '../lib/utils'

const RANGES = [
  { v: 'today', l: 'Hoy',     fn: todayRange  },
  { v: 'week',  l: 'Semana',  fn: weekRange   },
  { v: 'month', l: 'Mes',     fn: monthRange  },
]

export default function Reports() {
  const [range, setRange] = useState('today')
  const [orders, setOrders] = useState([])
  const [expenses, setExpenses] = useState([])

  useEffect(() => {
    (async () => {
      const { start, end } = RANGES.find(r => r.v === range).fn()
      const [oRes, eRes] = await Promise.all([
        supabase.from('orders')
          .select('*, order_items(*)')
          .gte('created_at', start).lte('created_at', end)
          .order('created_at', { ascending: false }),
        supabase.from('expenses').select('*')
          .gte('expense_date', start.slice(0,10)).lte('expense_date', end.slice(0,10))
          .order('expense_date', { ascending: false }),
      ])
      setOrders(oRes.data || [])
      setExpenses(eRes.data || [])
    })()
  }, [range])

  const valid = orders.filter(o => o.status !== 'cancelado')
  const revenue = valid.reduce((s, o) => s + Number(o.total), 0)
  const expSum  = expenses.reduce((s, e) => s + Number(e.amount), 0)

  const downloadCSV = () => {
    const rows = [
      ['Pedido', 'Fecha', 'Cliente', 'Estado', 'Tipo', 'Pago', 'Total'].join(','),
      ...orders.map(o => [
        o.order_number, fmtDate(o.created_at), `"${o.customer_name}"`,
        o.status, o.is_delivery ? 'delivery' : o.order_type, o.payment_method, o.total,
      ].join(',')),
    ].join('\n')
    const blob = new Blob([rows], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `chikin88-${range}-${new Date().toISOString().slice(0,10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-10 bg-chikin-red rounded-full"/>
          <div>
            <h1 className="font-display text-3xl md:text-4xl">Reportes</h1>
            <p className="text-sm text-zinc-500">Histórico de ventas y gastos</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-white dark:bg-chikin-gray-800 rounded-xl p-1">
            {RANGES.map(r => (
              <button key={r.v} onClick={() => setRange(r.v)}
                className={cx('px-3 py-2 rounded-lg text-sm font-bold',
                  range === r.v ? 'bg-chikin-red text-white' : 'text-zinc-500')}>
                {r.l}
              </button>
            ))}
          </div>
          <button onClick={downloadCSV} className="btn bg-chikin-yellow text-chikin-black">
            <Download size={16}/> CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Pedidos"    value={valid.length}/>
        <Stat label="Ingresos"   value={money(revenue)}/>
        <Stat label="Gastos"     value={money(expSum)} color="rose"/>
        <Stat label="Ganancia"   value={money(revenue - expSum)} color="emerald"/>
      </div>

      <motion.div className="card overflow-hidden"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <div className="p-4 border-b border-zinc-200 dark:border-chikin-gray-700 flex items-center gap-2">
          <FileText size={18}/> <h2 className="font-bold">Detalle de pedidos</h2>
        </div>
        {orders.length === 0 ? (
          <div className="p-8 text-center text-zinc-400">Sin pedidos en este rango.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-chikin-gray-800 text-xs uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-4 py-3 text-left">#</th>
                  <th className="px-4 py-3 text-left">Hora</th>
                  <th className="px-4 py-3 text-left">Cliente</th>
                  <th className="px-4 py-3 text-left">Estado</th>
                  <th className="px-4 py-3 text-left">Pago</th>
                  <th className="px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id} className="border-t border-zinc-100 dark:border-chikin-gray-700">
                    <td className="px-4 py-2 font-bold">#{o.order_number}</td>
                    <td className="px-4 py-2 text-xs">{fmtTime(o.created_at)}</td>
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

function Stat({ label, value, color }) {
  const colors = { rose: 'text-rose-600', emerald: 'text-emerald-600' }
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wider text-zinc-500 font-bold">{label}</div>
      <div className={cx('font-display text-2xl mt-0.5', colors[color])}>{value}</div>
    </div>
  )
}
