import { useState, useEffect, useMemo, useCallback, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArchiveX, RotateCcw, Filter, Bike, ShoppingBag,
  Banknote, ArrowRightLeft, AlertTriangle, RefreshCw, Loader2, RotateCw,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useOrderStore } from '../store/orderStore'
import { money, cx, fmtTime, fmtDate, STATUS_LABEL } from '../lib/utils'
import { apiFetch } from '../lib/apiFetch'

const RANGE_FILTERS = [
  { v: 'today', l: 'Hoy'        },
  { v: 'week',  l: 'Semana'     },
  { v: 'month', l: 'Mes'        },
  { v: 'all',   l: 'Todo'       },
]

export default function AnulledOrders() {
  const restoreOrder = useOrderStore(s => s.restoreOrder)
  const [orders, setOrders] = useState([])
  const [profiles, setProfiles] = useState({})
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(null)
  const [range, setRange] = useState('today')
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    ;(async () => {
      const { data, error: apiErr } = await apiFetch(
        `/api/anulados?range=${range}`,
        {},
        12_000
      )
      if (cancelled) return
      if (apiErr) {
        console.error('[AnulledOrders] error:', apiErr)
        setError(apiErr)
        setLoading(false)
        return
      }
      setOrders(data?.orders || [])
      setProfiles(data?.profiles || {})
      setReady(true)
      setLoading(false)
    })()

    return () => { cancelled = true }
  }, [range, refreshKey])

  const totalAnulled = useMemo(
    () => orders.reduce((s, o) => s + Number(o.total || 0), 0),
    [orders]
  )

  const handleRestore = async (o) => {
    const msg = `¿Restaurar el pedido #${o.order_number}?\n\n` +
                `Volverá a contar en ventas y reportes.\n` +
                `Cliente: ${o.customer_name}\n` +
                `Total: $${Number(o.total).toFixed(2)}`
    if (!window.confirm(msg)) return
    try {
      await restoreOrder(o.id)
      toast.success(`Pedido #${o.order_number} restaurado`)
      refresh()  // recargar listado
    } catch (err) {
      console.error(err)
      toast.error('No se pudo restaurar el pedido')
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center">
            <ArchiveX className="text-rose-600" size={24}/>
          </div>
          <div>
            <h1 className="font-display text-3xl md:text-4xl">Pedidos Anulados</h1>
            <p className="text-sm text-zinc-500">
              {orders.length} {orders.length === 1 ? 'pedido' : 'pedidos'} · {money(totalAnulled)} fuera de reportes
              {loading && ready && (
                <span className="ml-2 inline-flex items-center gap-1 text-chikin-red">
                  <Loader2 size={12} className="animate-spin"/> Actualizando…
                </span>
              )}
            </p>
          </div>
        </div>
        <button onClick={refresh} disabled={loading}
          className="btn bg-zinc-100 dark:bg-chikin-gray-800 hover:bg-zinc-200 dark:hover:bg-chikin-gray-700 disabled:opacity-50">
          <RefreshCw size={16} className={cx(loading && 'animate-spin')}/>
          <span className="hidden sm:inline">Actualizar</span>
        </button>
      </div>

      {/* Banner si falló refetch con datos previos */}
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

      {/* Info box */}
      <div className="card p-3 mb-4 bg-yellow-50 dark:bg-yellow-950/30 border-yellow-300 dark:border-yellow-900">
        <div className="flex gap-2 items-start text-xs text-zinc-700 dark:text-zinc-200">
          <AlertTriangle className="text-yellow-600 shrink-0" size={16}/>
          <div>
            <b>Estos pedidos no cuentan en ventas, reportes ni dashboard.</b> Quedan en la base de datos
            como historial. Puedes restaurarlos en cualquier momento desde aquí.
          </div>
        </div>
      </div>

      {/* Filtros de rango */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-4 -mx-4 px-4 md:mx-0 md:px-0">
        {RANGE_FILTERS.map(f => (
          <button
            key={f.v}
            onClick={() => setRange(f.v)}
            className={cx(
              'px-4 py-2.5 rounded-xl font-semibold text-sm whitespace-nowrap transition',
              range === f.v
                ? 'bg-chikin-black text-white'
                : 'bg-white dark:bg-chikin-gray-800 text-zinc-600 dark:text-zinc-300'
            )}
          >
            {f.l}
          </button>
        ))}
      </div>

      {!ready && loading ? (
        <div className="text-center py-20 text-zinc-400">
          <Loader2 className="mx-auto mb-3 text-chikin-red animate-spin" size={36}/>
          <div className="font-bold">Cargando pedidos anulados…</div>
        </div>
      ) : !ready && error ? (
        <div className="card p-8 text-center bg-rose-50 dark:bg-rose-950/30 border-rose-300 dark:border-rose-900">
          <AlertTriangle className="mx-auto mb-3 text-rose-600" size={48}/>
          <h2 className="font-bold text-xl mb-2">No se pudieron cargar los pedidos</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-5">{error}</p>
          <button onClick={refresh}
            className="btn-lg bg-chikin-red text-white hover:bg-chikin-red-dark">
            <RotateCw size={18}/> Reintentar
          </button>
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-16">
          <Filter className="mx-auto text-zinc-300 mb-3" size={48}/>
          <p className="text-zinc-400 font-semibold">No hay pedidos anulados en este rango</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <AnimatePresence>
            {orders.map(o => (
              <AnulledRow
                key={o.id}
                order={o}
                profile={profiles[o.deleted_by]}
                onRestore={() => handleRestore(o)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

const AnulledRow = memo(function AnulledRow({ order, profile, onRestore }) {
  const whoName = profile?.full_name || profile?.email || 'Desconocido'
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="card p-4 border-l-8 border-l-rose-500 opacity-90"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="font-display text-2xl line-through text-zinc-400">#{order.order_number}</div>
        <span className="chip bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 uppercase font-bold">
          Anulado
        </span>
      </div>

      <div className="font-bold mb-1">{order.customer_name}</div>
      <div className="text-xs text-zinc-500 space-y-0.5 mb-3">
        <div>Pedido: {fmtDate(order.created_at)} · {fmtTime(order.created_at)}</div>
        {order.deleted_at && (
          <div className="text-rose-600 dark:text-rose-400 font-semibold">
            Anulado: {fmtDate(order.deleted_at)} · {fmtTime(order.deleted_at)}
          </div>
        )}
        <div>Por: <b>{whoName}</b></div>
        <div>Estado original: {STATUS_LABEL[order.status]}</div>
      </div>

      <div className="flex flex-wrap gap-1 mb-2 text-[10px]">
        {order.is_delivery
          ? <span className="chip bg-blue-100 text-blue-700"><Bike size={10}/> Delivery</span>
          : <span className="chip bg-zinc-100 text-zinc-700"><ShoppingBag size={10}/> {order.order_type === 'abierto' ? 'Abierto' : 'Llevar'}</span>}
        <span className="chip bg-zinc-100 text-zinc-700">
          {order.payment_method === 'efectivo' ? <Banknote size={10}/> : <ArrowRightLeft size={10}/>}
          {order.payment_method}
        </span>
        {order.benefit_type && (
          <span className="chip bg-purple-100 text-purple-700 uppercase font-bold text-[9px]">
            {order.benefit_type === 'discount' ? '⭐ Emp.' : '🎁 Cort.'}
          </span>
        )}
      </div>

      {order.delete_reason && (
        <div className="text-xs bg-rose-50 dark:bg-rose-950/30 border-l-4 border-rose-400 px-3 py-2 rounded mb-3">
          <span className="font-bold">Motivo:</span> {order.delete_reason}
        </div>
      )}

      <div className="text-xs text-zinc-600 dark:text-zinc-300 mb-3">
        {(order.order_items || []).slice(0,3).map(i => `${i.quantity}× ${i.product_name}`).join(', ')}
        {(order.order_items || []).length > 3 && '...'}
      </div>

      <div className="flex items-center justify-between">
        <span className="font-display text-xl text-zinc-400 line-through">{money(order.total)}</span>
        <button
          onClick={onRestore}
          className="btn bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 px-3 py-2 hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition"
          title="Restaurar pedido (volverá a contar en reportes)"
        >
          <RotateCcw size={14}/>
          <span className="text-[10px] font-bold ml-1">RESTAURAR</span>
        </button>
      </div>
    </motion.div>
  )
})
