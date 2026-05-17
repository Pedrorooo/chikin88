import { useState, useEffect, useMemo, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Filter, Edit, Trash2, Bike, ShoppingBag, Clock,
  Banknote, ArrowRightLeft, X, Check, ChevronDown, ChevronUp,
  FileText, Utensils, Wallet,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useOrderStore } from '../store/orderStore'
import { useAuthStore } from '../store/authStore'
import {
  ageBucket, minutesSince, money, cx,
  STATUS_LABEL, fmtTime,
  itemFreeSauces, itemExtraSauceCount, SAUCE_EXTRA_PRICE, PALILLOS_EXTRA_PRICE,
  MAYO_EXTRA_PRICE, displayOrderNumber,
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
    if (!window.confirm(`¿Cancelar pedido ${displayOrderNumber(o)}?`)) return
    const reason = window.prompt('Motivo (opcional):') || null
    try {
      await cancelOrder(o.id, reason)
      toast.success('Pedido cancelado')
    } catch { toast.error('No se pudo cancelar') }
  }

  const handleAnular = async (o) => {
    const msg = `¿Anular pedido ${displayOrderNumber(o)} del reporte?\n\n` +
                `Cliente: ${o.customer_name}\n` +
                `Total: $${Number(o.total).toFixed(2)}\n\n` +
                `El pedido NO se elimina (queda en historial de anulaciones), ` +
                `pero deja de contar en ventas y reportes financieros.`
    if (!window.confirm(msg)) return
    const reason = window.prompt('Motivo de la anulación (opcional):') || null
    try {
      await softDeleteOrder(o.id, reason, profile?.id)
      toast.success(`Pedido ${displayOrderNumber(o)} anulado`)
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

  // Detalle expandible. Por defecto cerrado para mantener la tarjeta compacta;
  // el usuario abre con "Ver detalles". El estado se mantiene por tarjeta
  // mientras la lista esté montada (cambiar de filtro re-monta y se cierra).
  const [expanded, setExpanded] = useState(false)

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
        <div className="font-display text-2xl">{displayOrderNumber(order)}</div>
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
          {order.payment_method === 'efectivo' && <Banknote size={10}/>}
          {order.payment_method === 'transferencia' && <ArrowRightLeft size={10}/>}
          {order.payment_method === 'mixto' && <Wallet size={10}/>}
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
          <button
            onClick={() => setExpanded(e => !e)}
            className="btn bg-zinc-100 dark:bg-chikin-gray-800 px-3 py-2 text-xs"
            aria-expanded={expanded}
            title={expanded ? 'Ocultar detalles' : 'Ver detalles'}
          >
            {expanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
            <span className="hidden sm:inline ml-1">{expanded ? 'Ocultar' : 'Detalles'}</span>
          </button>
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

      {/* Panel expandible con detalle completo del pedido. Renderizado defensivo:
          si un campo no existe en el pedido, simplemente no se muestra esa línea. */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="details"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <OrderDetails order={order}/>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
})

// ============================================================
//  OrderDetails — panel expandible con TODA la información del pedido
//
//  Renderizado defensivo: cada bloque/línea verifica que el dato
//  exista en el pedido. Si un campo es null/undefined o vacío, esa
//  línea no se muestra; el panel no se rompe. Esto cubre pedidos
//  anteriores a algunas migraciones (mayo_extra, discount_*, etc.)
//  sin necesidad de recalcular ni modificar registros existentes.
// ============================================================
function OrderDetails({ order }) {
  const items = Array.isArray(order.order_items) ? order.order_items : []
  const hasMayo = typeof order.with_mayo === 'boolean'
  const mayoExtra = Number(order.mayo_extra || 0)
  const palillosExtra = order.utensil === 'palillos' ? PALILLOS_EXTRA_PRICE : 0
  const mayoExtraTotal = Math.round(mayoExtra * MAYO_EXTRA_PRICE * 100) / 100
  const deliveryFee = Number(order.delivery_fee || 0)
  const subtotal = Number(order.subtotal || 0)
  const discountAmount = Number(order.discount_amount || 0)
  const total = Number(order.total || 0)

  return (
    <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-chikin-gray-700 space-y-4 text-sm">
      {/* ---------- Productos ---------- */}
      {items.length > 0 && (
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-500 mb-2 flex items-center gap-1">
            <ShoppingBag size={12}/> Productos ({items.length})
          </div>
          <div className="space-y-2">
            {items.map((it, idx) => (
              <ItemDetail key={it.id || idx} item={it}/>
            ))}
          </div>
        </div>
      )}

      {/* ---------- Preferencias generales ---------- */}
      <div>
        <div className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-500 mb-2 flex items-center gap-1">
          <Utensils size={12}/> Preferencias
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
          {hasMayo && (
            <DetailRow label="Mayonesa">
              {order.with_mayo ? 'Con' : 'Sin'}
            </DetailRow>
          )}
          {hasMayo && order.with_mayo && mayoExtra > 0 && (
            <DetailRow label="Mayo extra">
              <span className="font-bold">×{mayoExtra}</span>
              <span className="ml-1 text-amber-600">+{money(mayoExtraTotal)}</span>
            </DetailRow>
          )}
          {order.utensil && (
            <DetailRow label="Cubierto">
              {order.utensil === 'tenedor' ? 'Tenedor'
                : order.utensil === 'palillos' ? 'Palillos'
                : order.utensil === 'ninguno' ? 'Ninguno'
                : order.utensil}
              {palillosExtra > 0 && (
                <span className="ml-1 text-amber-600">+{money(palillosExtra)}</span>
              )}
            </DetailRow>
          )}
          {order.is_delivery && (
            <DetailRow label="Delivery">
              Sí {deliveryFee > 0 && <span className="ml-1 text-blue-600">+{money(deliveryFee)}</span>}
            </DetailRow>
          )}
          {order.is_delivery && order.delivery_payment_method && (
            <DetailRow label="Delivery pago">
              {order.delivery_payment_method === 'efectivo' ? '💵 Efectivo' : '💳 Transferencia'}
            </DetailRow>
          )}
          {order.order_type && !order.is_delivery && (
            <DetailRow label="Tipo">
              {order.order_type === 'abierto' ? 'Abierto' : 'Para llevar'}
            </DetailRow>
          )}
          {order.payment_method && (
            <DetailRow label="Pago">
              {order.payment_method === 'efectivo' && 'Efectivo'}
              {order.payment_method === 'transferencia' && 'Transferencia'}
              {order.payment_method === 'mixto' && (
                <span>
                  Mixto
                  {Number(order.cash_amount) > 0 && (
                    <span className="ml-1 text-emerald-700">· efectivo {money(order.cash_amount)}</span>
                  )}
                  {Number(order.transfer_amount) > 0 && (
                    <span className="ml-1 text-blue-700">· transfer {money(order.transfer_amount)}</span>
                  )}
                </span>
              )}
            </DetailRow>
          )}
          {order.customer_phone && (
            <DetailRow label="Teléfono">{order.customer_phone}</DetailRow>
          )}
        </div>
      </div>

      {/* ---------- Beneficios / promos ---------- */}
      {(order.benefit_type || order.discount_type === 'student') && (
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-500 mb-2">
            Beneficios
          </div>
          <div className="space-y-1">
            {order.benefit_type && (
              <div className="text-xs flex items-center gap-2 bg-chikin-yellow/20 px-2 py-1.5 rounded">
                <span className="font-extrabold">
                  {order.benefit_type === 'discount' ? '⭐ Descuento empleado' : '🎁 Cortesía empleado'}
                </span>
                {order.benefit_employee && (
                  <span className="text-zinc-700 dark:text-zinc-300">· {order.benefit_employee}</span>
                )}
              </div>
            )}
            {order.discount_type === 'student' && (
              <div className="text-xs flex items-center gap-2 bg-emerald-100 dark:bg-emerald-950/30 px-2 py-1.5 rounded">
                <span className="font-extrabold text-emerald-800 dark:text-emerald-300">
                  🎓 {order.discount_label || 'Promo estudiante 10%'}
                </span>
                {discountAmount > 0 && (
                  <span className="text-emerald-700 dark:text-emerald-400 font-bold">
                    −{money(discountAmount)}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------- Observaciones ---------- */}
      {order.notes && order.notes.trim().length > 0 && (
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-500 mb-1 flex items-center gap-1">
            <FileText size={12}/> Observaciones
          </div>
          <div className="text-xs bg-zinc-50 dark:bg-chikin-gray-800 p-2 rounded border border-zinc-200 dark:border-chikin-gray-700 whitespace-pre-wrap">
            {order.notes}
          </div>
        </div>
      )}

      {/* ---------- Totales ---------- */}
      <div>
        <div className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-500 mb-2">
          Totales
        </div>
        <div className="space-y-1 text-xs">
          {subtotal > 0 && (
            <div className="flex justify-between">
              <span className="text-zinc-500">Subtotal</span>
              <span>{money(subtotal)}</span>
            </div>
          )}
          {palillosExtra > 0 && (
            <div className="flex justify-between text-amber-600">
              <span>Palillos</span>
              <span>+{money(palillosExtra)}</span>
            </div>
          )}
          {mayoExtraTotal > 0 && (
            <div className="flex justify-between text-amber-600">
              <span>Mayonesa extra ×{mayoExtra}</span>
              <span>+{money(mayoExtraTotal)}</span>
            </div>
          )}
          {deliveryFee > 0 && (
            <div className="flex justify-between text-blue-600">
              <span>Delivery</span>
              <span>+{money(deliveryFee)}</span>
            </div>
          )}
          {discountAmount > 0 && (
            <div className="flex justify-between text-emerald-600">
              <span>{order.discount_type === 'student' ? 'Promo estudiante' : 'Descuento'}</span>
              <span>−{money(discountAmount)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold pt-1 border-t border-zinc-200 dark:border-chikin-gray-700">
            <span>Total</span>
            <span className="text-chikin-red font-display text-base">{money(total)}</span>
          </div>
        </div>
      </div>

      {/* ---------- Tiempos extra (si aplica) ---------- */}
      {(order.ready_at || order.delivered_at || order.cancelled_at) && (
        <div className="text-[10px] text-zinc-400 space-y-0.5 pt-2 border-t border-zinc-100 dark:border-chikin-gray-800">
          <div>Creado: <span className="text-zinc-600 dark:text-zinc-300">{fmtTime(order.created_at)}</span></div>
          {order.ready_at && (
            <div>Listo: <span className="text-zinc-600 dark:text-zinc-300">{fmtTime(order.ready_at)}</span></div>
          )}
          {order.delivered_at && (
            <div>Entregado: <span className="text-emerald-600">{fmtTime(order.delivered_at)}</span></div>
          )}
          {order.cancelled_at && (
            <div>Cancelado: <span className="text-rose-600">{fmtTime(order.cancelled_at)}</span></div>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================
//  ItemDetail — detalle de un order_item: cantidades, salsas,
//  modo de salsa, tipo de ramen, recargos por salsas extra,
//  descuento por promo estudiante.
//
//  Defensivo: si un campo no existe en el item, no se muestra.
// ============================================================
function ItemDetail({ item }) {
  const qty = Number(item.quantity || 0)
  const unitPrice = Number(item.unit_price || 0)
  const subtotal = Number(item.subtotal || 0)
  const originalUnit = item.original_unit_price != null ? Number(item.original_unit_price) : null
  const itemDiscount = Number(item.discount_amount || 0)
  const sauces = Array.isArray(item.sauces) ? item.sauces : []
  const mode = item.sauce_mode || 'normal'
  const free = itemFreeSauces(item)
  const extras = itemExtraSauceCount(item)
  const extrasCost = mode === 'sin' ? 0 : Math.round(extras * SAUCE_EXTRA_PRICE * qty * 100) / 100
  const modeLabel =
    mode === 'sin'    ? 'Sin salsa'
    : mode === 'aparte' ? 'Aparte'
    : mode === 'extra'  ? 'Extra (legacy)'
    : 'Con salsa'

  return (
    <div className="bg-zinc-50 dark:bg-chikin-gray-800 p-2.5 rounded-lg border border-zinc-200 dark:border-chikin-gray-700">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm leading-tight">
            <span className="text-chikin-red">{qty}×</span> {item.product_name || 'Producto'}
          </div>
          {(unitPrice > 0 || originalUnit != null) && (
            <div className="text-[11px] text-zinc-500 mt-0.5">
              {originalUnit != null && originalUnit !== unitPrice && (
                <span className="line-through mr-1">{money(originalUnit)}</span>
              )}
              {money(unitPrice)} c/u
              {itemDiscount > 0 && (
                <span className="ml-1.5 text-emerald-600 font-bold">
                  −{money(itemDiscount)}
                  {item.discount_type === 'student' && ' (estudiante)'}
                </span>
              )}
            </div>
          )}
        </div>
        {subtotal > 0 && (
          <div className="text-sm font-bold text-chikin-red whitespace-nowrap">
            {money(subtotal)}
          </div>
        )}
      </div>

      {/* Tipo de ramen si aplica */}
      {item.ramen_type && (
        <div className="text-[11px] text-zinc-600 dark:text-zinc-300 mt-1.5">
          <span className="font-semibold">Ramen:</span>{' '}
          {item.ramen_type === 'picante' ? 'Picante'
            : item.ramen_type === 'carbonara' ? 'Carbonara'
            : item.ramen_type === 'carne' ? 'Carne'
            : item.ramen_type}
        </div>
      )}

      {/* Sabor de bebida / salsa extra */}
      {item.item_flavor && (
        <div className="text-[11px] text-zinc-600 dark:text-zinc-300 mt-1.5">
          <span className="font-semibold">Sabor:</span>{' '}
          <span className="text-blue-700 dark:text-blue-400 font-bold">{item.item_flavor}</span>
        </div>
      )}

      {/* Modo de salsa + salsas */}
      {(item.sauce_mode || sauces.length > 0) && (
        <div className="text-[11px] text-zinc-600 dark:text-zinc-300 mt-1.5">
          <span className="font-semibold">Salsa:</span> {modeLabel}
          {mode !== 'sin' && sauces.length > 0 && (
            <span className="ml-1 text-zinc-500">
              · {sauces.join(', ')} ({sauces.length}/{free} incl.)
            </span>
          )}
          {extras > 0 && (
            <div className="text-amber-600 font-bold mt-0.5">
              {extras} salsa{extras === 1 ? '' : 's'} extra × {money(SAUCE_EXTRA_PRICE)} × {qty} = +{money(extrasCost)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Línea label/valor compacta para el bloque de preferencias.
function DetailRow({ label, children }) {
  return (
    <div className="flex items-baseline gap-1.5 text-xs">
      <span className="text-zinc-500 min-w-[80px] font-semibold">{label}:</span>
      <span className="text-zinc-700 dark:text-zinc-200">{children}</span>
    </div>
  )
}

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
          <h3 className="font-bold text-lg">Editar pedido {displayOrderNumber(order)}</h3>
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
            <option value="mixto">Mixto</option>
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
