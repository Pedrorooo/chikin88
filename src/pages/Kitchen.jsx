import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Clock, Bike, ShoppingBag, Banknote, ArrowRightLeft, ChevronRight,
  CheckCircle2, XCircle, ChefHat, Flame,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useOrderStore } from '../store/orderStore'
import { ageBucket, minutesSince, money, cx, NEXT_STATUS, STATUS_LABEL, fmtTime, SAUCES } from '../lib/utils'

export default function Kitchen() {
  const orders     = useOrderStore(s => s.orders)
  const updateStatus = useOrderStore(s => s.updateStatus)
  const cancelOrder  = useOrderStore(s => s.cancelOrder)

  // re-renderiza cada 30s para refrescar el color/tiempo
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  // Pedidos visibles para cocina: pendiente, en preparación, listo
  const visible = [...orders]
    .filter(o => ['pendiente','en_preparacion','listo'].includes(o.status))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

  const buckets = {
    pendiente:      visible.filter(o => o.status === 'pendiente'),
    en_preparacion: visible.filter(o => o.status === 'en_preparacion'),
    listo:          visible.filter(o => o.status === 'listo'),
  }

  return (
    <div className="p-4 md:p-6 min-h-full bg-zinc-100 dark:bg-chikin-black">
      {/* Header cocina */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-chikin-red flex items-center justify-center">
            <ChefHat className="text-chikin-yellow" size={24}/>
          </div>
          <div>
            <h1 className="font-display text-3xl md:text-4xl">COCINA</h1>
            <p className="text-sm text-zinc-500">{visible.length} pedidos activos</p>
          </div>
        </div>
        <div className="flex gap-2 text-xs font-semibold">
          <span className="chip bg-emerald-100 text-emerald-700">0–10 min</span>
          <span className="chip bg-yellow-100 text-yellow-800">11–20</span>
          <span className="chip bg-orange-100 text-orange-800">21–30</span>
          <span className="chip bg-rose-100 text-rose-800 animate-pulse">+30</span>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="text-center py-20">
          <Flame size={64} className="mx-auto text-zinc-300 mb-4"/>
          <p className="text-xl font-bold text-zinc-400">No hay pedidos activos</p>
          <p className="text-sm text-zinc-400">Cuando lleguen, aparecerán aquí en tiempo real.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <Column title="Pendientes"      orders={buckets.pendiente}      onAdvance={updateStatus} onCancel={cancelOrder}/>
          <Column title="En preparación"  orders={buckets.en_preparacion} onAdvance={updateStatus} onCancel={cancelOrder}/>
          <Column title="Listos"          orders={buckets.listo}          onAdvance={updateStatus} onCancel={cancelOrder}/>
        </div>
      )}
    </div>
  )
}

function Column({ title, orders, onAdvance, onCancel }) {
  return (
    <div>
      <div className="sticky top-0 z-10 bg-zinc-100 dark:bg-chikin-black py-2 mb-2 flex items-center justify-between">
        <h2 className="font-display text-xl uppercase tracking-wider">{title}</h2>
        <span className="chip bg-chikin-black text-white">{orders.length}</span>
      </div>
      <div className="space-y-3">
        <AnimatePresence>
          {orders.map(o => (
            <OrderCard key={o.id} order={o} onAdvance={onAdvance} onCancel={onCancel}/>
          ))}
        </AnimatePresence>
        {orders.length === 0 && (
          <div className="text-center text-zinc-400 text-sm py-6 border-2 border-dashed border-zinc-200 dark:border-chikin-gray-700 rounded-2xl">
            —
          </div>
        )}
      </div>
    </div>
  )
}

function OrderCard({ order, onAdvance, onCancel }) {
  const mins = minutesSince(order.created_at)
  const bucket = ageBucket(mins)
  const next = NEXT_STATUS[order.status]
  const items = order.order_items || []

  const advance = async () => {
    try {
      await onAdvance(order.id, next)
      toast.success(`Pedido #${order.order_number}: ${STATUS_LABEL[next]}`)
    } catch (e) { toast.error('No se pudo actualizar') }
  }
  const cancel = async () => {
    if (!window.confirm(`¿Cancelar pedido #${order.order_number}?`)) return
    try {
      const reason = window.prompt('Motivo (opcional):') || null
      await onCancel(order.id, reason)
      toast.success(`Pedido #${order.order_number} cancelado`)
    } catch (e) { toast.error('No se pudo cancelar') }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, x: 50 }}
      transition={{ type: 'spring', stiffness: 220, damping: 24 }}
      className={cx(
        'rounded-2xl border-l-8 border-t border-r border-b shadow-sm overflow-hidden',
        bucket === 'fresh'  && 'order-fresh',
        bucket === 'warn'   && 'order-warn',
        bucket === 'late'   && 'order-late',
        bucket === 'urgent' && 'order-urgent',
      )}
    >
      <div className="p-4">
        {/* Top */}
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="font-display text-4xl leading-none">#{order.order_number}</div>
            <div className="font-bold text-base mt-1">{order.customer_name}</div>
            {order.customer_phone && (
              <div className="text-xs text-zinc-500">{order.customer_phone}</div>
            )}
          </div>
          <div className="text-right">
            <div className={cx(
              'inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-bold',
              bucket === 'fresh'  && 'bg-emerald-600 text-white',
              bucket === 'warn'   && 'bg-yellow-500 text-chikin-black',
              bucket === 'late'   && 'bg-orange-600 text-white',
              bucket === 'urgent' && 'bg-rose-600 text-white',
            )}>
              <Clock size={14}/>
              {mins} min
            </div>
            <div className="text-[10px] text-zinc-500 mt-1 uppercase tracking-wider">
              {fmtTime(order.created_at)}
            </div>
          </div>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {order.is_delivery
            ? <span className="chip bg-blue-600 text-white"><Bike size={12}/> Delivery</span>
            : <span className="chip bg-zinc-700 text-white"><ShoppingBag size={12}/> {order.order_type === 'abierto' ? 'Abierto' : 'Para llevar'}</span>}
          <span className="chip bg-white text-chikin-black border border-zinc-300">
            {order.payment_method === 'efectivo'
              ? <><Banknote size={12}/> Efectivo</>
              : <><ArrowRightLeft size={12}/> Transfer</>}
          </span>
          {!order.with_mayo && <span className="chip bg-rose-500 text-white">SIN mayo</span>}
          <span className="chip bg-chikin-yellow text-chikin-black uppercase">{order.utensil}</span>
        </div>

        {/* Items */}
        <ul className="space-y-1 mb-3 bg-white/60 dark:bg-black/30 rounded-xl p-3 text-sm">
          {items.map(it => (
            <li key={it.id} className="flex flex-col">
              <div className="flex items-baseline justify-between">
                <span className="font-bold">
                  {it.quantity}× {it.product_name}
                </span>
                <span className="text-xs text-zinc-500">{money(it.subtotal)}</span>
              </div>
              {it.sauces && it.sauces.length > 0 && (
                <div className="text-xs text-zinc-600 dark:text-zinc-300">
                  Salsas: {it.sauces.join(', ')}
                </div>
              )}
            </li>
          ))}
        </ul>

        {order.notes && (
          <div className="text-xs bg-yellow-100 dark:bg-yellow-900/40 border-l-4 border-yellow-500 px-3 py-2 rounded mb-3">
            📝 {order.notes}
          </div>
        )}

        {/* Total */}
        <div className="flex items-baseline justify-between mb-3">
          <span className="text-xs uppercase font-bold text-zinc-500">Total</span>
          <span className="font-display text-2xl">{money(order.total)}</span>
        </div>

        {/* Acciones */}
        <div className="flex gap-2">
          {next && (
            <button onClick={advance}
              className="flex-1 btn-lg bg-chikin-red text-white hover:bg-chikin-red-dark
                         shadow-lg shadow-chikin-red/30">
              {order.status === 'pendiente'      && <>Empezar <ChevronRight size={18}/></>}
              {order.status === 'en_preparacion' && <><CheckCircle2 size={18}/> Listo</>}
              {order.status === 'listo'          && <><CheckCircle2 size={18}/> Entregar</>}
            </button>
          )}
          <button onClick={cancel}
            className="btn-lg bg-white dark:bg-chikin-gray-800 text-rose-600 border-2 border-rose-200 dark:border-chikin-gray-700">
            <XCircle size={18}/>
          </button>
        </div>
      </div>
    </motion.div>
  )
}
