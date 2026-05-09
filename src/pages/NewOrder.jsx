import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Minus, Trash2, ShoppingBag, User, Phone, Bike,
  Banknote, ArrowRightLeft, MessageSquare, Check, Loader2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useOrderStore } from '../store/orderStore'
import { useAuthStore } from '../store/authStore'
import { supabase } from '../lib/supabase'
import { PRODUCTS, CATEGORIES } from '../data/products'
import {
  SAUCES, money, cx,
  SAUCE_EXTRA_PRICE, PALILLOS_EXTRA_PRICE,
  itemExtrasTotal, itemSubtotal, itemExtraSauceCount,
} from '../lib/utils'

export default function NewOrder() {
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const createOrder = useOrderStore(s => s.createOrder)

  const [catalog, setCatalog] = useState(PRODUCTS)
  const [activeCat, setActiveCat] = useState('Principales')
  const [items, setItems] = useState([])  // {key, product_id, product_name, product_category, unit_price, quantity, sauces, allows_extras}
  const [submitting, setSubmitting] = useState(false)

  // Datos del pedido
  const [customerName, setCustomerName]   = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [orderType, setOrderType]         = useState('para_llevar')   // abierto | para_llevar
  const [isDelivery, setIsDelivery]       = useState(false)
  const [deliveryFee, setDeliveryFee]     = useState('')
  const [withMayo, setWithMayo]           = useState(true)
  const [utensil, setUtensil]             = useState('tenedor')        // tenedor | palillos
  const [paymentMethod, setPaymentMethod] = useState('efectivo')
  const [notes, setNotes]                 = useState('')

  // Cargar productos desde Supabase
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('products')
        .select('*')
        .eq('active', true)
        .order('display_order')
      if (data && data.length) setCatalog(data)
    })()
  }, [])

  const filtered = useMemo(
    () => catalog.filter(p => p.category === activeCat),
    [catalog, activeCat]
  )

  // ---------- gestión de items ----------
  const addItem = (product) => {
    const key = `${product.id || product.name}-${Date.now()}-${Math.random()}`
    setItems(prev => [...prev, {
      key,
      product_id: product.id || null,
      product_name: product.name,
      product_category: product.category,
      unit_price: Number(product.price),
      allows_extras: product.allows_extras,
      free_sauces: product.free_sauces ?? 1,
      quantity: 1,
      sauces: [],
    }])
    toast.success(product.name, { duration: 1000 })
  }

  const updateQty = (key, delta) => {
    setItems(prev => prev
      .map(it => it.key === key ? { ...it, quantity: Math.max(1, it.quantity + delta) } : it)
    )
  }

  const removeItem = (key) => {
    setItems(prev => prev.filter(it => it.key !== key))
  }

  const toggleSauce = (key, sauce) => {
    setItems(prev => prev.map(it => {
      if (it.key !== key) return it
      const has = it.sauces.includes(sauce)
      return { ...it, sauces: has ? it.sauces.filter(s => s !== sauce) : [...it.sauces, sauce] }
    }))
  }

  // ---------- totales ----------
  // Subtotal de cada producto incluye su precio + sus salsas extra
  const productsSubtotal = items.reduce((s, it) => s + itemSubtotal(it), 0)
  // Total de salsas extra (para mostrar en el desglose)
  const extrasTotal = items.reduce((s, it) => s + itemExtrasTotal(it), 0)
  // Conteo de salsas extra (para etiqueta)
  const extrasCount = items.reduce((s, it) => s + itemExtraSauceCount(it) * it.quantity, 0)
  // Recargo de palillos (una sola vez por pedido)
  const palillosExtra = utensil === 'palillos' ? PALILLOS_EXTRA_PRICE : 0
  const deliveryAmount = isDelivery ? Number(deliveryFee || 0) : 0
  const total = productsSubtotal + palillosExtra + deliveryAmount

  // ---------- enviar ----------
  const submit = async () => {
    if (!customerName.trim()) return toast.error('Falta nombre del cliente')
    if (items.length === 0)    return toast.error('Agrega al menos un producto')
    setSubmitting(true)
    try {
      // Marcamos cada item con su subtotal calculado (precio + salsas extra)
      const itemsWithSubtotal = items.map(it => ({
        ...it,
        subtotal: itemSubtotal(it),
      }))
      await createOrder({
        customer_name:  customerName.trim(),
        customer_phone: customerPhone.trim() || null,
        order_type:     orderType,
        is_delivery:    isDelivery,
        delivery_fee:   deliveryAmount,
        with_mayo:      withMayo,
        utensil,
        payment_method: paymentMethod,
        notes:          notes.trim() || null,
        created_by:     profile?.id || null,
        status:         'pendiente',
        subtotal:       productsSubtotal,    // incluye salsas extra
        total,                                // incluye palillos + delivery
      }, itemsWithSubtotal)
      toast.success('¡Pedido enviado a cocina!', { icon: '🔥' })
      navigate('/pedidos')
    } catch (err) {
      console.error(err)
      toast.error('No se pudo crear el pedido')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto pb-32 lg:pb-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-1.5 h-10 bg-chikin-red rounded-full" />
        <div>
          <h1 className="font-display text-3xl md:text-4xl">Nuevo Pedido</h1>
          <p className="text-sm text-zinc-500">Selecciona productos y completa los datos</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_420px] gap-6">
        {/* ============================================ IZQUIERDA: catálogo ============================================ */}
        <div>
          {/* Tabs categorías */}
          <div className="flex gap-2 overflow-x-auto pb-2 mb-4 -mx-4 px-4 md:mx-0 md:px-0 scrollbar-hide">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCat(cat)}
                className={cx(
                  'px-5 py-3 rounded-xl font-bold whitespace-nowrap transition-all',
                  activeCat === cat
                    ? 'bg-chikin-red text-white shadow-lg shadow-chikin-red/30'
                    : 'bg-white dark:bg-chikin-gray-800 text-zinc-600 dark:text-zinc-300'
                )}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {filtered.map(p => (
              <motion.button
                key={p.id || p.name}
                onClick={() => addItem(p)}
                whileTap={{ scale: 0.96 }}
                className="card p-4 text-left hover:border-chikin-red transition-colors group"
              >
                <div className="text-xs uppercase tracking-wider text-zinc-400 mb-1">
                  {p.category}
                </div>
                <div className="font-bold text-base leading-tight mb-3 min-h-[2.5rem]">
                  {p.name}
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-display text-2xl text-chikin-red">
                    {money(p.price)}
                  </span>
                  <span className="w-9 h-9 rounded-full bg-chikin-yellow text-chikin-black
                                   flex items-center justify-center group-hover:scale-110 transition">
                    <Plus size={18} strokeWidth={3}/>
                  </span>
                </div>
              </motion.button>
            ))}
          </div>
        </div>

        {/* ============================================ DERECHA: ticket ============================================ */}
        <div className="space-y-4">
          {/* Items seleccionados */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold flex items-center gap-2">
                <ShoppingBag size={18}/> Productos ({items.length})
              </h3>
              {items.length > 0 && (
                <button
                  onClick={() => setItems([])}
                  className="text-xs text-zinc-500 hover:text-chikin-red"
                >
                  Vaciar
                </button>
              )}
            </div>

            {items.length === 0 && (
              <p className="text-sm text-zinc-400 text-center py-6">
                Toca productos para agregarlos
              </p>
            )}

            <div className="space-y-3 max-h-72 overflow-y-auto">
              <AnimatePresence>
                {items.map(it => (
                  <motion.div
                    key={it.key}
                    layout
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: 50 }}
                    className="border border-zinc-200 dark:border-chikin-gray-700 rounded-xl p-3"
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        <div className="font-bold text-sm">{it.product_name}</div>
                        <div className="text-xs text-zinc-500">{money(it.unit_price)} c/u</div>
                      </div>
                      <button
                        onClick={() => removeItem(it.key)}
                        className="text-zinc-400 hover:text-chikin-red p-1"
                      >
                        <Trash2 size={16}/>
                      </button>
                    </div>

                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-2">
                        <button onClick={() => updateQty(it.key, -1)}
                          className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-chikin-gray-800 flex items-center justify-center">
                          <Minus size={14}/>
                        </button>
                        <span className="font-bold w-8 text-center">{it.quantity}</span>
                        <button onClick={() => updateQty(it.key, 1)}
                          className="w-8 h-8 rounded-lg bg-chikin-red text-white flex items-center justify-center">
                          <Plus size={14}/>
                        </button>
                      </div>
                      <div className="font-bold text-chikin-red">
                        {money(itemSubtotal(it))}
                      </div>
                    </div>

                    {/* Salsas: solo si el producto las admite */}
                    {it.allows_extras && (
                      <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-chikin-gray-700">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs font-bold text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">
                            Salsas {it.sauces.length > 0 && (
                              <span className="ml-1 text-chikin-red">({it.sauces.length})</span>
                            )}
                          </div>
                          {itemExtrasTotal(it) > 0 && (
                            <div className="text-xs font-bold text-chikin-red">
                              +{money(itemExtrasTotal(it))}
                            </div>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          {SAUCES.map((s) => {
                            const sauceIdx = it.sauces.indexOf(s)
                            const free = it.free_sauces ?? 1
                            const on = sauceIdx !== -1
                            // Las primeras `free` salsas son gratis (índices 0..free-1).
                            // Desde el índice `free` en adelante, cada salsa cuesta extra.
                            const isExtra = on && sauceIdx >= free
                            return (
                              <motion.button
                                key={s}
                                type="button"
                                onClick={() => toggleSauce(it.key, s)}
                                whileTap={{ scale: 0.94 }}
                                className={cx(
                                  'relative px-2.5 py-2.5 rounded-xl text-[11px] font-bold border-2 transition-all leading-tight text-left flex items-center justify-between gap-1 min-h-[44px]',
                                  on
                                    ? 'bg-chikin-red text-white border-chikin-red shadow-sm shadow-chikin-red/30'
                                    : 'bg-white dark:bg-chikin-gray-800 border-zinc-200 dark:border-chikin-gray-700 text-zinc-700 dark:text-zinc-200 hover:border-chikin-red/40'
                                )}
                              >
                                <span className="flex-1">{s}</span>
                                {isExtra && (
                                  <span className="text-[9px] font-extrabold bg-white/25 px-1 py-0.5 rounded">
                                    +25¢
                                  </span>
                                )}
                              </motion.button>
                            )
                          })}
                        </div>
                        <div className="text-[10px] text-zinc-400 mt-1.5 italic">
                          {(it.free_sauces ?? 1) === 1
                            ? '1ra salsa incluida'
                            : `${it.free_sauces} salsas incluidas`}
                          {' · cada extra +'}{money(SAUCE_EXTRA_PRICE)}
                        </div>
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          {/* Datos cliente */}
          <div className="card p-4 space-y-3">
            <div>
              <label className="label flex items-center gap-1.5"><User size={14}/> Cliente *</label>
              <input className="input" value={customerName} onChange={e => setCustomerName(e.target.value)}
                     placeholder="Nombre del cliente" />
            </div>
            <div>
              <label className="label flex items-center gap-1.5"><Phone size={14}/> Teléfono (opcional)</label>
              <input className="input" type="tel" value={customerPhone}
                     onChange={e => setCustomerPhone(e.target.value)} placeholder="099 999 9999" />
            </div>

            {/* Tipo */}
            <div>
              <label className="label">Tipo de pedido</label>
              <div className="grid grid-cols-2 gap-2">
                {[['abierto','Abierto'],['para_llevar','Para llevar']].map(([v,l]) => (
                  <button key={v} type="button" onClick={() => setOrderType(v)}
                    className={cx(
                      'py-3 rounded-xl font-semibold border-2 transition',
                      orderType === v
                        ? 'bg-chikin-yellow border-chikin-yellow text-chikin-black'
                        : 'bg-white dark:bg-chikin-gray-800 border-zinc-200 dark:border-chikin-gray-700'
                    )}
                  >{l}</button>
                ))}
              </div>
            </div>

            {/* Mayonesa + Utensilio */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Mayonesa</label>
                <div className="flex gap-2">
                  {[[true,'Con'], [false,'Sin']].map(([v,l]) => (
                    <button key={String(v)} type="button" onClick={() => setWithMayo(v)}
                      className={cx(
                        'flex-1 py-2.5 rounded-lg font-semibold border-2',
                        withMayo === v
                          ? 'bg-chikin-red border-chikin-red text-white'
                          : 'bg-white dark:bg-chikin-gray-800 border-zinc-200 dark:border-chikin-gray-700'
                      )}
                    >{l}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="label">Cubierto</label>
                <div className="flex gap-2">
                  {[['tenedor','Tenedor', null],['palillos','Palillos', '+25¢']].map(([v,l,tag]) => (
                    <button key={v} type="button" onClick={() => setUtensil(v)}
                      className={cx(
                        'flex-1 py-2.5 rounded-lg font-semibold border-2 text-sm flex items-center justify-center gap-1',
                        utensil === v
                          ? 'bg-chikin-red border-chikin-red text-white'
                          : 'bg-white dark:bg-chikin-gray-800 border-zinc-200 dark:border-chikin-gray-700'
                      )}
                    >
                      {l}
                      {tag && (
                        <span className={cx(
                          'text-[10px] font-extrabold px-1 py-0.5 rounded',
                          utensil === v ? 'bg-white/25' : 'bg-chikin-yellow text-chikin-black'
                        )}>{tag}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Delivery */}
            <div>
              <label className="label flex items-center gap-1.5"><Bike size={14}/> Delivery</label>
              <div className="flex gap-2 mb-2">
                {[[false,'No'], [true,'Sí']].map(([v,l]) => (
                  <button key={String(v)} type="button" onClick={() => setIsDelivery(v)}
                    className={cx(
                      'flex-1 py-2.5 rounded-lg font-semibold border-2',
                      isDelivery === v
                        ? 'bg-chikin-yellow border-chikin-yellow text-chikin-black'
                        : 'bg-white dark:bg-chikin-gray-800 border-zinc-200 dark:border-chikin-gray-700'
                    )}
                  >{l}</button>
                ))}
              </div>
              {isDelivery && (
                <input className="input" type="number" step="0.01" inputMode="decimal"
                       value={deliveryFee} onChange={e => setDeliveryFee(e.target.value)}
                       placeholder="Valor delivery $" />
              )}
            </div>

            {/* Pago */}
            <div>
              <label className="label">Método de pago</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setPaymentMethod('efectivo')}
                  className={cx(
                    'py-3 rounded-xl font-semibold border-2 flex items-center justify-center gap-2',
                    paymentMethod === 'efectivo'
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : 'bg-white dark:bg-chikin-gray-800 border-zinc-200 dark:border-chikin-gray-700'
                  )}
                ><Banknote size={18}/> Efectivo</button>
                <button type="button" onClick={() => setPaymentMethod('transferencia')}
                  className={cx(
                    'py-3 rounded-xl font-semibold border-2 flex items-center justify-center gap-2',
                    paymentMethod === 'transferencia'
                      ? 'bg-blue-500 border-blue-500 text-white'
                      : 'bg-white dark:bg-chikin-gray-800 border-zinc-200 dark:border-chikin-gray-700'
                  )}
                ><ArrowRightLeft size={18}/> Transfer</button>
              </div>
            </div>

            {/* Observaciones */}
            <div>
              <label className="label flex items-center gap-1.5"><MessageSquare size={14}/> Observaciones</label>
              <textarea className="input min-h-[60px]" rows={2}
                        value={notes} onChange={e => setNotes(e.target.value)}
                        placeholder="Sin cebolla, extra crocante..." />
            </div>
          </div>

          {/* Total */}
          <div className="card p-4 bg-chikin-black text-white border-chikin-black">
            <div className="space-y-1.5 text-sm text-zinc-400">
              <div className="flex justify-between">
                <span>Productos</span>
                <span>{money(productsSubtotal - extrasTotal)}</span>
              </div>
              {extrasTotal > 0 && (
                <div className="flex justify-between text-chikin-yellow/90">
                  <span>Salsas extra ({extrasCount})</span>
                  <span>+{money(extrasTotal)}</span>
                </div>
              )}
              {palillosExtra > 0 && (
                <div className="flex justify-between text-chikin-yellow/90">
                  <span>Palillos</span>
                  <span>+{money(palillosExtra)}</span>
                </div>
              )}
              {isDelivery && (
                <div className="flex justify-between">
                  <span>Delivery</span>
                  <span>+{money(deliveryAmount)}</span>
                </div>
              )}
            </div>
            <div className="flex justify-between items-baseline mt-3 pt-3 border-t border-chikin-gray-700">
              <span className="font-bold">TOTAL</span>
              <span className="font-display text-4xl text-chikin-yellow">{money(total)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Botón fijo en móvil */}
      <div className="fixed lg:static bottom-0 left-0 right-0 p-4 bg-white dark:bg-chikin-black
                      border-t lg:border-t-0 border-zinc-200 dark:border-chikin-gray-700
                      lg:mt-6 lg:p-0 z-30">
        <button onClick={submit} disabled={submitting || items.length === 0}
                className="w-full btn-xl bg-chikin-red text-white shadow-2xl shadow-chikin-red/40
                           hover:bg-chikin-red-dark uppercase tracking-wider">
          {submitting ? <Loader2 className="animate-spin"/> : (
            <>
              <Check size={24}/> Enviar a cocina · {money(total)}
            </>
          )}
        </button>
      </div>
    </div>
  )
}
