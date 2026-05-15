import { useState, useEffect, useMemo, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Filter, Edit, Trash2, Bike, ShoppingBag, Clock,
  Banknote, ArrowRightLeft, X, Check,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useOrderStore } from '../store/orderStore'
import { useAuthStore } from '../store/authStore'
import {
  ageBucket, minutesSince, money, cx,
  STATUS_LABEL, fmtTime,
} from '../lib/utils'

const FILTERS = [
  { v: 'activos',        l: 'Activos'        },
  { v: 'pendiente',      l: 'Pendientes'     },
  { v: 'en_preparacion', l: 'En cocina'      },
  { v: 'listo',          l: 'Listos'         },
  { v: 'todos',          l: 'Todos del día'  },
]

export default function Orders() {
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const { orders, todayOrders, fetchToday, cancelOrder, softDeleteOrder } = useOrderStore()
  const [filter, setFilter] = useState('activos')
  const [editing, setEditing] = useState(null)

  useEffect(() => { fetchToday() }, [fetchToday])

  // re-render cada 30s para refrescar tiempos
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const list = useMemo(() => {
    let l = []
    if (filter === 'todos') l = todayOrders
    else if (filter === 'activos') l = orders
    else if (['pendiente','en_preparacion','listo'].includes(filter))
      l = orders.filter(o => o.status === filter)
    return [...l].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  }, [filter, orders, todayOrders])

  // canEdit: admin o empleado (también acepta sesiones viejas con roles antiguos)
  const role = profile?.role
  const canEdit = role === 'admin' || role === 'empleado' || role === 'mesero' || role === 'cocina'
  const isAdmin = role === 'admin'

  const handleCancel = async (o) => {
    if (!window.confirm(`¿Cancelar pedido #${o.order_number}?`)) return
    const reason = window.prompt('Motivo (opcional):') || null
    try {
      await cancelOrder(o.id, reason)
      toast.success('Pedido cancelado')
    } catch { toast.error('No se pudo cancelar') }
  }

  const handleAnular = async (o) => {
    const msg = `¿Anular pedido #${o.order_number} del reporte?\n\n` +
                `Cliente: ${o.customer_name}\n` +
                `Total: $${Number(o.total).toFixed(2)}\n\n` +
                `El pedido NO se elimina (queda en historial de anulaciones), ` +
                `pero deja de contar en ventas y reportes financieros.`
    if (!window.confirm(msg)) return
    const reason = window.prompt('Motivo de la anulación (opcional):') || null
    try {
      await softDeleteOrder(o.id, reason, profile?.id)
      toast.success(`Pedido #${o.order_number} anulado`)
    } catch (err) {
      console.error(err)
      toast.error('No se pudo anular el pedido')
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-10 bg-chikin-red rounded-full"/>
          <div>
            <h1 className="font-display text-3xl md:text-4xl">Pedidos</h1>
            <p className="text-sm text-zinc-500">{list.length} {filter === 'todos' ? 'totales hoy' : 'visibles'}</p>
          </div>
        </div>
        {canEdit && (
          <button onClick={() => navigate('/nuevo')}
                  className="btn-lg bg-chikin-red text-white shadow-lg shadow-chikin-red/30">
            <Plus size={20}/> <span className="hidden sm:inline">Nuevo</span>
          </button>
        )}
      </div>

      {/* Filtros */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-4 -mx-4 px-4 md:mx-0 md:px-0">
        {FILTERS.map(f => (
          <button
            key={f.v}
            onClick={() => setFilter(f.v)}
            className={cx(
              'px-4 py-2.5 rounded-xl font-semibold text-sm whitespace-nowrap transition',
              filter === f.v
                ? 'bg-chikin-black text-white'
                : 'bg-white dark:bg-chikin-gray-800 text-zinc-600 dark:text-zinc-300'
            )}
          >
            {f.l}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="text-center py-16">
          <Filter className="mx-auto text-zinc-300 mb-3" size={48}/>
          <p className="text-zinc-400 font-semibold">No hay pedidos en esta vista</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <AnimatePresence>
            {list.map(o => (
              <OrderRow key={o.id} order={o}
                        canEdit={canEdit} isAdmin={isAdmin}
                        onEdit={() => setEditing(o)}
                        onCancel={() => handleCancel(o)}
                        onAnular={() => handleAnular(o)} />
            ))}
          </AnimatePresence>
        </div>
      )}

      <EditModal order={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

const OrderRow = memo(function OrderRow({ order, canEdit, isAdmin, onEdit, onCancel, onAnular }) {
  const mins = minutesSince(order.created_at)
  const bucket = ageBucket(mins)
  const isActive = ['pendiente','en_preparacion','listo'].includes(order.status)
  const isClosed = order.status === 'entregado' || order.status === 'cancelado'
  const isDelivered = order.status === 'entregado'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
      className={cx(
        'card p-4 border-l-8',
        isActive && bucket === 'fresh'  && 'order-fresh',
        isActive && bucket === 'warn'   && 'order-warn',
        isActive && bucket === 'late'   && 'order-late',
        isActive && bucket === 'urgent' && 'order-urgent',
        !isActive && 'border-l-zinc-300 dark:border-l-chikin-gray-700',
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="font-display text-2xl">#{order.order_number}</div>
        <span className={`chip pill-${order.status}`}>{STATUS_LABEL[order.status]}</span>
      </div>

      <div className="font-bold mb-1">{order.customer_name}</div>

      {/* Tiempos: en entregado, mostrar creado + entregado. Si activo, mostrar minutos. */}
      {isDelivered ? (
        <div className="text-xs text-zinc-500 mb-2 space-y-0.5">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-zinc-400 w-16">Creado:</span>
            <span className="font-bold text-zinc-700 dark:text-zinc-200">{fmtTime(order.created_at)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-zinc-400 w-16">Entregado:</span>
            <span className="font-bold text-emerald-600">
              {order.delivered_at ? fmtTime(order.delivered_at) : '—'}
            </span>
          </div>
        </div>
      ) : (
        <div className="text-xs text-zinc-500 mb-2">
          {fmtTime(order.created_at)} · {isActive ? `${mins} min` : 'cerrado'}
        </div>
      )}

      {/* Indicador de beneficio empleado */}
      {order.benefit_type && (
        <div className="mb-2 text-[10px] font-extrabold inline-block px-2 py-0.5 rounded bg-chikin-yellow text-chikin-black">
          {order.benefit_type === 'discount' ? '⭐ DESCUENTO EMPLEADO' : '🎁 CORTESÍA EMPLEADO'} · {order.benefit_employee}
        </div>
      )}

      {/* Indicador de promo estudiante */}
      {order.discount_type === 'student' && (
        <div className="mb-2 text-[10px] font-extrabold inline-block px-2 py-0.5 rounded bg-emerald-600 text-white mr-1">
          🎓 PROMO ESTUDIANTE
          {Number(order.discount_amount) > 0 && <span className="ml-1">-{money(order.discount_amount)}</span>}
        </div>
      )}

      <div className="flex flex-wrap gap-1 mb-2 text-[10px]">
        {order.is_delivery
          ? <span className="chip bg-blue-100 text-blue-700"><Bike size={10}/> Delivery</span>
          : <span className="chip bg-zinc-100 text-zinc-700"><ShoppingBag size={10}/> {order.order_type === 'abierto' ? 'Abierto' : 'Llevar'}</span>}
        <span className="chip bg-zinc-100 text-zinc-700">
          {order.payment_method === 'efectivo' ? <Banknote size={10}/> : <ArrowRightLeft size={10}/>}
          {order.payment_method}
        </span>
        {!order.with_mayo && <span className="chip bg-rose-100 text-rose-700">SIN mayo</span>}
        {order.with_mayo && Number(order.mayo_extra) > 0 && (
          <span className="chip bg-amber-100 text-amber-800 font-extrabold">
            Mayo extra ×{order.mayo_extra}
          </span>
        )}
      </div>

      <div className="text-xs text-zinc-600 dark:text-zinc-300 mb-3">
        {(order.order_items || []).slice(0,3).map(i => `${i.quantity}× ${i.product_name}`).join(', ')}
        {(order.order_items || []).length > 3 && '...'}
      </div>

      <div className="flex items-center justify-between">
        <span className="font-display text-xl text-chikin-red">{money(order.total)}</span>
        <div className="flex gap-1">
          {canEdit && isActive && (
            <>
              <button onClick={onEdit}
                      className="btn bg-zinc-100 dark:bg-chikin-gray-800 px-3 py-2"
                      title="Editar">
                <Edit size={14}/>
              </button>
              <button onClick={onCancel}
                      className="btn bg-rose-50 dark:bg-rose-950/30 text-rose-600 px-3 py-2"
                      title="Cancelar">
                <Trash2 size={14}/>
              </button>
            </>
          )}
          {isAdmin && isClosed && (
            <button onClick={onAnular}
                    className="btn bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 px-3 py-2 hover:bg-rose-200 dark:hover:bg-rose-900/50 transition"
                    title="Anular pedido del reporte (no borra)">
              <Trash2 size={14}/>
              <span className="text-[10px] font-bold ml-1">ANULAR</span>
            </button>
          )}
        </div>
      </div>
    </motion.div>
  )
})

function EditModal({ order, onClose }) {
  const updateOrder = useOrderStore(s => s.updateOrder)
  const [data, setData] = useState(null)

  useEffect(() => { setData(order ? { ...order } : null) }, [order])

  if (!order || !data) return null

  const save = async () => {
    try {
      await updateOrder(order.id, {
        customer_name:  data.customer_name,
        customer_phone: data.customer_phone,
        is_delivery:    data.is_delivery,
        delivery_fee:   data.is_delivery ? Number(data.delivery_fee || 0) : 0,
        with_mayo:      data.with_mayo,
        utensil:        data.utensil,
        payment_method: data.payment_method,
        notes:          data.notes,
        order_type:     data.order_type,
      })
      toast.success('Pedido actualizado')
      onClose()
    } catch { toast.error('No se pudo guardar') }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <motion.div
        initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        className="bg-white dark:bg-chikin-gray-900 w-full md:max-w-lg rounded-t-3xl md:rounded-3xl p-6 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg">Editar pedido #{order.order_number}</h3>
          <button onClick={onClose} className="p-2"><X size={20}/></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">Cliente</label>
            <input className="input" value={data.customer_name}
                   onChange={e => setData({ ...data, customer_name: e.target.value })}/>
          </div>
          <div>
            <label className="label">Teléfono</label>
            <input className="input" value={data.customer_phone || ''}
                   onChange={e => setData({ ...data, customer_phone: e.target.value })}/>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setData({ ...data, is_delivery: !data.is_delivery })}
                    className={cx('btn py-3', data.is_delivery ? 'bg-chikin-yellow text-chikin-black' : 'bg-zinc-100 dark:bg-chikin-gray-800')}>
              {data.is_delivery ? '✓ Delivery' : 'Sin delivery'}
            </button>
            <input className="input" type="number" step="0.01" disabled={!data.is_delivery}
                   value={data.delivery_fee || ''}
                   onChange={e => setData({ ...data, delivery_fee: e.target.value })}
                   placeholder="Valor delivery"/>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setData({ ...data, with_mayo: !data.with_mayo })}
                    className={cx('btn py-3', data.with_mayo ? 'bg-chikin-red text-white' : 'bg-zinc-100 dark:bg-chikin-gray-800')}>
              {data.with_mayo ? 'Con mayonesa' : 'Sin mayonesa'}
            </button>
            <select className="input" value={data.utensil}
                    onChange={e => setData({ ...data, utensil: e.target.value })}>
              <option value="tenedor">Tenedor</option>
              <option value="palillos">Palillos</option>
              <option value="ninguno">Ninguno</option>
            </select>
          </div>
          <select className="input" value={data.payment_method}
                  onChange={e => setData({ ...data, payment_method: e.target.value })}>
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
          </select>
          <select className="input" value={data.order_type}
                  onChange={e => setData({ ...data, order_type: e.target.value })}>
            <option value="abierto">Abierto</option>
            <option value="para_llevar">Para llevar</option>
          </select>
          <textarea className="input" rows={2} value={data.notes || ''}
                    onChange={e => setData({ ...data, notes: e.target.value })}
                    placeholder="Observaciones"/>

          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="flex-1 btn-lg bg-zinc-100 dark:bg-chikin-gray-800">Cancelar</button>
            <button onClick={save} className="flex-1 btn-lg bg-chikin-red text-white"><Check size={18}/> Guardar</button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
