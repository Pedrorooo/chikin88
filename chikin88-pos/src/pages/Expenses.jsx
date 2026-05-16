import { useEffect, useState, useCallback } from 'react'
import { Plus, Trash2, Receipt, Calendar, AlertTriangle, RotateCw } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { money, fmtDate, todayRange, weekRange, monthRange } from '../lib/utils'
import { apiFetch } from '../lib/apiFetch'

export default function Expenses() {
  const [expenses, setExpenses] = useState([])
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0,10))
  const [loading, setLoading] = useState(false)
  const [listError, setListError] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])

  // Cargar gastos
  useEffect(() => {
    let cancelled = false
    setListError(null)
    ;(async () => {
      const { data, error } = await apiFetch('/api/expenses', {}, 12_000)
      if (cancelled) return
      if (error) { setListError(error); return }
      setExpenses(data?.expenses || [])
    })()
    return () => { cancelled = true }
  }, [refreshKey])

  const submit = async (e) => {
    e.preventDefault()
    if (!description.trim() || !amount) return toast.error('Completa los campos')
    setLoading(true)
    try {
      const { error } = await apiFetch('/api/expenses', {
        method: 'POST',
        body: {
          description: description.trim(),
          amount: Number(amount),
          expense_date: date,
          category: 'general',
        },
      }, 10_000)
      if (error) throw new Error(error)
      toast.success('Gasto registrado')
      setDescription(''); setAmount('')
      refresh()
    } catch (e) {
      toast.error(e?.message || 'No se pudo guardar')
    } finally {
      setLoading(false)
    }
  }

  const remove = async (id) => {
    if (!window.confirm('¿Eliminar este gasto?')) return
    const { error } = await apiFetch(`/api/expenses?id=${id}`, { method: 'DELETE' }, 10_000)
    if (error) toast.error(error)
    else { toast.success('Eliminado'); refresh() }
  }

  // Totales por rango
  const sumIn = (start, end) => expenses
    .filter(e => e.expense_date >= start && e.expense_date <= end)
    .reduce((s, e) => s + Number(e.amount), 0)

  const today = todayRange(); const week = weekRange(); const month = monthRange()
  const totals = {
    today: sumIn(today.start.slice(0,10), today.end.slice(0,10)),
    week:  sumIn(week.start.slice(0,10),  week.end.slice(0,10)),
    month: sumIn(month.start.slice(0,10), month.end.slice(0,10)),
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-1.5 h-10 bg-chikin-red rounded-full"/>
        <div>
          <h1 className="font-display text-3xl md:text-4xl">Gastos</h1>
          <p className="text-sm text-zinc-500">Registro y control de gastos</p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-3 mb-6">
        <TotalCard label="Hoy"     value={totals.today}/>
        <TotalCard label="Semana"  value={totals.week}/>
        <TotalCard label="Mes"     value={totals.month}/>
      </div>

      {listError && (
        <div className="card p-3 mb-4 bg-rose-50 dark:bg-rose-950/30 border-rose-300 dark:border-rose-900 flex items-center gap-3">
          <AlertTriangle className="text-rose-600 shrink-0" size={18}/>
          <div className="flex-1 text-sm text-zinc-700 dark:text-zinc-200">
            <b>Error:</b> {listError}
          </div>
          <button onClick={refresh} className="btn bg-rose-600 text-white hover:bg-rose-700">
            <RotateCw size={14}/> Reintentar
          </button>
        </div>
      )}

      <div className="grid md:grid-cols-[1fr_2fr] gap-6">
        {/* Formulario */}
        <form onSubmit={submit} className="card p-5 space-y-3 h-fit">
          <h3 className="font-bold flex items-center gap-2"><Plus size={18}/> Nuevo gasto</h3>
          <div>
            <label className="label">Descripción</label>
            <input className="input" value={description}
                   onChange={e => setDescription(e.target.value)}
                   placeholder="Pollo, salsas, etc." required/>
          </div>
          <div>
            <label className="label">Monto $</label>
            <input className="input" type="number" step="0.01" inputMode="decimal"
                   value={amount} onChange={e => setAmount(e.target.value)} required/>
          </div>
          <div>
            <label className="label flex items-center gap-1.5"><Calendar size={14}/> Fecha</label>
            <input className="input" type="date"
                   value={date} onChange={e => setDate(e.target.value)} required/>
          </div>
          <button disabled={loading}
                  className="w-full btn-lg bg-chikin-red text-white shadow-lg shadow-chikin-red/30">
            {loading ? 'Guardando...' : 'Registrar gasto'}
          </button>
        </form>

        {/* Lista */}
        <div>
          <h3 className="font-bold mb-3 text-sm uppercase tracking-wider text-zinc-500">Historial</h3>
          {expenses.length === 0 ? (
            <div className="card p-8 text-center text-zinc-400">
              <Receipt size={48} className="mx-auto mb-2 text-zinc-300"/>
              No hay gastos registrados
            </div>
          ) : (
            <div className="space-y-2">
              <AnimatePresence>
                {expenses.map(e => (
                  <motion.div
                    key={e.id}
                    layout
                    initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 50 }}
                    className="card p-4 flex items-center justify-between"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-bold truncate">{e.description}</div>
                      <div className="text-xs text-zinc-500">{fmtDate(e.expense_date)}</div>
                    </div>
                    <div className="font-display text-xl text-rose-600 mr-3">−{money(e.amount)}</div>
                    <button onClick={() => remove(e.id)}
                            className="p-2 text-zinc-400 hover:text-rose-600">
                      <Trash2 size={16}/>
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TotalCard({ label, value }) {
  return (
    <div className="card p-5">
      <div className="text-xs uppercase tracking-wider text-zinc-500 font-bold">{label}</div>
      <div className="font-display text-3xl text-rose-600 mt-1">{money(value)}</div>
    </div>
  )
}
