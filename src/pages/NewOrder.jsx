import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Minus, Trash2, ShoppingBag, User, Phone, Bike,
  Banknote, ArrowRightLeft, MessageSquare, Check, Loader2,
  Star, Flame, Soup,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useOrderStore } from '../store/orderStore'
import { useAuthStore } from '../store/authStore'
import { supabase } from '../lib/supabase'
import { PRODUCTS, CATEGORIES, isRamenProduct, isChickenProduct } from '../data/products'
import {
  SAUCES, SAUCE_MODES, RAMEN_TYPES,
  money, cx,
  SAUCE_EXTRA_PRICE, PALILLOS_EXTRA_PRICE,
  itemExtrasTotal, itemSubtotal, itemExtraSauceCount,
  detectEmployee, isDiscountEligibleCombo,
  COURTESY_COMBO, employeeDiscountPrice,
} from '../lib/utils'

export default function NewOrder() {
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const createOrder = useOrderStore(s => s.createOrder)

  const [catalog, setCatalog] = useState(PRODUCTS)
  const [activeCat, setActiveCat] = useState('Principales')
  const [items, setItems] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)  // Anti-doble-click hard

  // Datos del pedido
  const [customerName, setCustomerName]   = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [orderType, setOrderType]         = useState('para_llevar')
  const [isDelivery, setIsDelivery]       = useState(false)
  const [deliveryFee, setDeliveryFee]     = useState('')
  const [withMayo, setWithMayo]           = useState(true)
  const [utensil, setUtensil]             = useState('tenedor')
  const [paymentMethod, setPaymentMethod] = useState('efectivo')
  const [notes, setNotes]                 = useState('')

  // Beneficios de empleado
  const [benefitMode, setBenefitMode]     = useState(null)  // null | 'discount' | 'courtesy'

  // ---------- Empleado detectado ----------
  const employee = useMemo(() => detectEmployee(customerName), [customerName])

  // Si el cliente deja de ser empleado, desactivar beneficio
  useEffect(() => {
    if (!employee && benefitMode) setBenefitMode(null)
  }, [employee, benefitMode])

  // ---------- Cargar catálogo desde Supabase ----------
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('active', true)
          .order('display_order')
        if (!cancelled && !error && data && data.length) setCatalog(data)
      } catch (err) {
        console.error('products fetch:', err)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // ---------- Productos filtrados (memo) ----------
  const filtered = useMemo(() => {
    let list = catalog.filter(p => p.category === activeCat)
    // En modo cortesía solo se muestra el Combo Especial (única opción gratis)
    if (benefitMode === 'courtesy') {
      list = list.filter(p => p.name === COURTESY_COMBO || p.category !== 'Principales')
    }
    return list
  }, [catalog, activeCat, benefitMode])

  // ---------- Gestión de items ----------
  const addItem = useCallback((product) => {
    if (submittingRef.current) return
    const isRamen = isRamenProduct(product)
    const isChicken = isChickenProduct(product)

    // Si hay descuento activo, marcamos como precio especial para el primer combo elegible
    let unitPrice = Number(product.price)
    let isBenefitItem = false

    if (benefitMode === 'discount' && isDiscountEligibleCombo(product.name)) {
      // ¿Ya hay un combo con descuento aplicado? Solo permitimos uno
      const alreadyDiscounted = items.some(it => it.is_benefit_item)
      if (!alreadyDiscounted) {
        unitPrice = employeeDiscountPrice(product.name) ?? unitPrice
        isBenefitItem = true
      }
    }

    if (benefitMode === 'courtesy' && product.name === COURTESY_COMBO) {
      const alreadyCourtesy = items.some(it => it.is_benefit_item)
      if (alreadyCourtesy) {
        toast.error('Solo se puede aplicar 1 cortesía por pedido')
        return
      }
      unitPrice = 0
      isBenefitItem = true
    }

    const key = `${product.id || product.name}-${Date.now()}-${Math.random()}`
    setItems(prev => [...prev, {
      key,
      product_id: product.id || null,
      product_name: product.name,
      product_category: product.category,
      unit_price: unitPrice,
      regular_price: Number(product.price),
      allows_extras: product.allows_extras,
      free_sauces: product.free_sauces ?? 1,
      quantity: 1,
      sauces: [],
      sauce_mode: isChicken ? 'normal' : null,
      ramen_type: isRamen ? 'picante' : null,
      is_benefit_item: isBenefitItem,
    }])
    if (isBenefitItem) {
      toast.success(`${product.name} (precio empleado)`, { icon: '⭐', duration: 1500 })
    } else {
      toast.success(product.name, { duration: 800 })
    }
  }, [benefitMode, items])

  const updateQty = useCallback((key, delta) => {
    setItems(prev => prev.map(it =>
      it.key === key ? { ...it, quantity: Math.max(1, it.quantity + delta) } : it
    ))
  }, [])

  const removeItem = useCallback((key) => {
    setItems(prev => prev.filter(it => it.key !== key))
  }, [])

  const toggleSauce = useCallback((key, sauce) => {
    setItems(prev => prev.map(it => {
      if (it.key !== key) return it
      const has = it.sauces.includes(sauce)
      return { ...it, sauces: has ? it.sauces.filter(s => s !== sauce) : [...it.sauces, sauce] }
    }))
  }, [])

  const setSauceMode = useCallback((key, mode) => {
    setItems(prev => prev.map(it => {
      if (it.key !== key) return it
      // Si pasa a "sin", limpiamos las salsas
      return { ...it, sauce_mode: mode, sauces: mode === 'sin' ? [] : it.sauces }
    }))
  }, [])

  const setRamenType = useCallback((key, type) => {
    setItems(prev => prev.map(it =>
      it.key === key ? { ...it, ramen_type: type } : it
    ))
  }, [])

  // ---------- Totales ----------
  const productsSubtotal = useMemo(
    () => items.reduce((s, it) => s + itemSubtotal(it), 0),
    [items]
  )
  const extrasTotal = useMemo(
    () => items.reduce((s, it) => s + itemExtrasTotal(it), 0),
    [items]
  )
  const extrasCount = useMemo(
    () => items.reduce((s, it) => s + itemExtraSauceCount(it) * it.quantity, 0),
    [items]
  )
  const palillosExtra = utensil === 'palillos' ? PALILLOS_EXTRA_PRICE : 0
  const deliveryAmount = isDelivery ? Number(deliveryFee || 0) : 0
  const total = productsSubtotal + palillosExtra + deliveryAmount

  // Cálculo del ahorro por descuento (solo informativo)
  const discountSavings = useMemo(() => {
    if (benefitMode !== 'discount' && benefitMode !== 'courtesy') return 0
    return items.reduce((s, it) => {
      if (!it.is_benefit_item) return s
      return s + (it.regular_price - it.unit_price) * it.quantity
    }, 0)
  }, [items, benefitMode])

  // ---------- Validación previa al envío ----------
  const validate = () => {
    if (!customerName.trim()) return 'Falta nombre del cliente'
    if (items.length === 0) return 'Agrega al menos un producto'

    if (benefitMode === 'discount') {
      if (!items.some(it => it.is_benefit_item)) {
        return 'Selecciona un combo para aplicar el descuento empleado'
      }
    }
    if (benefitMode === 'courtesy') {
      const hasCourtesy = items.some(it => it.is_benefit_item && it.product_name === COURTESY_COMBO)
      if (!hasCourtesy) {
        return 'Agrega un Combo Especial para usar la cortesía'
      }
    }

    // Validar tipo de ramen
    const ramenSinTipo = items.find(it =>
      it.product_category === 'Ramen' && !it.ramen_type
    )
    if (ramenSinTipo) return `Elige tipo (picante/carbonara) para ${ramenSinTipo.product_name}`
    return null
  }

  // ---------- Enviar ----------
  const submit = async () => {
    if (submittingRef.current) return
    const err = validate()
    if (err) return toast.error(err)

    submittingRef.current = true
    setSubmitting(true)

    try {
      const itemsWithSubtotal = items.map(it => ({
        ...it,
        subtotal: itemSubtotal(it),
      }))

      await createOrder({
        customer_name:    customerName.trim(),
        customer_phone:   customerPhone.trim() || null,
        order_type:       orderType,
        is_delivery:      isDelivery,
        delivery_fee:     deliveryAmount,
        with_mayo:        withMayo,
        utensil,
        payment_method:   paymentMethod,
        notes:            notes.trim() || null,
        created_by:       profile?.id || null,
        status:           'pendiente',
        subtotal:         productsSubtotal,
        total,
        benefit_type:     benefitMode,
        benefit_employee: benefitMode ? employee : null,
      }, itemsWithSubtotal)

      toast.success('¡Pedido enviado a cocina!', { icon: '🔥' })
      navigate('/pedidos')
    } catch (err) {
      console.error(err)
      // El error ya viene formateado por orderStore (parseBenefitError)
      toast.error(err.message || 'No se pudo crear el pedido')
    } finally {
      submittingRef.current = false
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
        {/* ========== IZQUIERDA: catálogo ========== */}
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

          {/* Grid de productos */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {filtered.map(p => {
              const specialPrice =
                benefitMode === 'discount' && isDiscountEligibleCombo(p.name)
                  ? employeeDiscountPrice(p.name)
                  : null
              const courtesyFree =
                benefitMode === 'courtesy' && p.name === COURTESY_COMBO
              return (
                <motion.button
                  key={p.id || p.name}
                  onClick={() => addItem(p)}
                  whileTap={{ scale: 0.96 }}
                  className={cx(
                    'card p-4 text-left hover:border-chikin-red transition-colors group relative',
                    (specialPrice !== null || courtesyFree) && 'ring-2 ring-chikin-yellow'
                  )}
                >
                  {(specialPrice !== null || courtesyFree) && (
                    <span className="absolute -top-2 -right-2 bg-chikin-yellow text-chikin-black text-[9px] font-extrabold px-2 py-1 rounded-full shadow-md">
                      {courtesyFree ? '🎁 GRATIS' : '⭐ EMPLEADO'}
                    </span>
                  )}
                  <div className="text-xs uppercase tracking-wider text-zinc-400 mb-1">
                    {p.category}
                  </div>
                  <div className="font-bold text-base leading-tight mb-3 min-h-[2.5rem]">
                    {p.name}
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      {courtesyFree ? (
                        <>
                          <span className="line-through text-xs text-zinc-400">{money(p.price)}</span>
                          <div className="font-display text-2xl text-emerald-600">$0.00</div>
                        </>
                      ) : specialPrice !== null ? (
                        <>
                          <span className="line-through text-xs text-zinc-400">{money(p.price)}</span>
                          <div className="font-display text-2xl text-chikin-red">{money(specialPrice)}</div>
                        </>
                      ) : (
                        <span className="font-display text-2xl text-chikin-red">{money(p.price)}</span>
                      )}
                    </div>
                    <span className="w-9 h-9 rounded-full bg-chikin-yellow text-chikin-black flex items-center justify-center group-hover:scale-110 transition">
                      <Plus size={18} strokeWidth={3}/>
                    </span>
                  </div>
                </motion.button>
              )
            })}
          </div>
        </div>

        {/* ========== DERECHA: ticket ========== */}
        <div className="space-y-4">
          {/* Banner empleado detectado */}
          {employee && (
            <EmployeeBanner
              name={employee}
              benefitMode={benefitMode}
              onSetMode={setBenefitMode}
              savings={discountSavings}
            />
          )}

          {/* Items */}
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

            <div className="space-y-3 max-h-96 overflow-y-auto">
              <AnimatePresence>
                {items.map(it => (
                  <CartItem
                    key={it.key}
                    it={it}
                    onUpdateQty={updateQty}
                    onRemove={removeItem}
                    onToggleSauce={toggleSauce}
                    onSetSauceMode={setSauceMode}
                    onSetRamenType={setRamenType}
                  />
                ))}
              </AnimatePresence>
            </div>
          </div>

          {/* Datos cliente */}
          <div className="card p-4 space-y-3">
            <div>
              <label className="label flex items-center gap-1.5"><User size={14}/> Cliente *</label>
              <input className="input" value={customerName} onChange={e => setCustomerName(e.target.value)}
                     placeholder="Nombre del cliente o EmpleadoNN88" />
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
              {discountSavings > 0 && (
                <div className="flex justify-between text-emerald-400">
                  <span>Beneficio empleado</span>
                  <span>-{money(discountSavings)}</span>
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

      {/* Botón fijo móvil */}
      <div className="fixed lg:static bottom-0 left-0 right-0 p-4 bg-white dark:bg-chikin-black
                      border-t lg:border-t-0 border-zinc-200 dark:border-chikin-gray-700
                      lg:mt-6 lg:p-0 z-30">
        <button
          onClick={submit}
          disabled={submitting || items.length === 0}
          className="w-full btn-xl bg-chikin-red text-white shadow-2xl shadow-chikin-red/40
                     hover:bg-chikin-red-dark uppercase tracking-wider disabled:opacity-60 disabled:cursor-not-allowed">
          {submitting
            ? <><Loader2 className="animate-spin"/> Enviando...</>
            : <><Check size={24}/> Enviar a cocina · {money(total)}</>
          }
        </button>
      </div>
    </div>
  )
}

// ============================================================
//  Banner de empleado detectado
// ============================================================
function EmployeeBanner({ name, benefitMode, onSetMode, savings }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="card p-3 bg-gradient-to-br from-chikin-yellow/20 to-chikin-red/10 border-chikin-yellow"
    >
      <div className="flex items-center gap-2 mb-2">
        <Star className="text-chikin-yellow fill-chikin-yellow" size={18}/>
        <div className="font-bold text-sm">Empleado detectado: <span className="text-chikin-red">{name}</span></div>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <button
          onClick={() => onSetMode(benefitMode === 'discount' ? null : 'discount')}
          className={cx(
            'py-2.5 rounded-xl font-bold text-sm border-2 transition flex items-center justify-center gap-1.5',
            benefitMode === 'discount'
              ? 'bg-chikin-red text-white border-chikin-red shadow-md shadow-chikin-red/30'
              : 'bg-white dark:bg-chikin-gray-800 border-zinc-200 dark:border-chikin-gray-700 text-zinc-700 dark:text-zinc-200'
          )}
        >
          💵 Descuento diario
        </button>
        <button
          onClick={() => onSetMode(benefitMode === 'courtesy' ? null : 'courtesy')}
          className={cx(
            'py-2.5 rounded-xl font-bold text-sm border-2 transition flex items-center justify-center gap-1.5',
            benefitMode === 'courtesy'
              ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-600/30'
              : 'bg-white dark:bg-chikin-gray-800 border-zinc-200 dark:border-chikin-gray-700 text-zinc-700 dark:text-zinc-200'
          )}
        >
          🎁 Cortesía semanal
        </button>
      </div>
      {benefitMode === 'discount' && (
        <div className="text-[11px] text-zinc-600 dark:text-zinc-300 italic">
          Selecciona 1 combo para precio especial · El sistema validará que no lo hayas usado hoy.
          {savings > 0 && <span className="block text-emerald-600 font-bold mt-0.5">Ahorro: {money(savings)}</span>}
        </div>
      )}
      {benefitMode === 'courtesy' && (
        <div className="text-[11px] text-zinc-600 dark:text-zinc-300 italic">
          1 Combo Especial gratis a la semana · Solo se permite Combo Especial en este modo.
        </div>
      )}
    </motion.div>
  )
}

// ============================================================
//  Item del carrito (memo para evitar re-renders)
// ============================================================
function CartItem({ it, onUpdateQty, onRemove, onToggleSauce, onSetSauceMode, onSetRamenType }) {
  const isChicken = it.product_category === 'Principales'
  const isRamen = it.product_category === 'Ramen'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 50 }}
      className={cx(
        'border-2 rounded-xl p-3',
        it.is_benefit_item
          ? 'border-chikin-yellow bg-chikin-yellow/5'
          : 'border-zinc-200 dark:border-chikin-gray-700'
      )}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="font-bold text-sm flex items-center gap-1.5">
            {it.product_name}
            {it.is_benefit_item && (
              <span className="text-[9px] font-extrabold bg-chikin-yellow text-chikin-black px-1.5 py-0.5 rounded">
                {it.unit_price === 0 ? '🎁 CORTESÍA' : '⭐ EMPLEADO'}
              </span>
            )}
          </div>
          <div className="text-xs text-zinc-500">
            {money(it.unit_price)} c/u
            {it.is_benefit_item && it.regular_price > it.unit_price && (
              <span className="line-through ml-1.5 text-zinc-400">{money(it.regular_price)}</span>
            )}
          </div>
        </div>
        <button onClick={() => onRemove(it.key)}
                className="text-zinc-400 hover:text-chikin-red p-1">
          <Trash2 size={16}/>
        </button>
      </div>

      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-2">
          <button onClick={() => onUpdateQty(it.key, -1)}
            className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-chikin-gray-800 flex items-center justify-center">
            <Minus size={14}/>
          </button>
          <span className="font-bold w-8 text-center">{it.quantity}</span>
          <button onClick={() => onUpdateQty(it.key, 1)}
            className="w-8 h-8 rounded-lg bg-chikin-red text-white flex items-center justify-center">
            <Plus size={14}/>
          </button>
        </div>
        <div className="font-bold text-chikin-red">{money(itemSubtotal(it))}</div>
      </div>

      {/* RAMEN: tipo (picante/carbonara) */}
      {isRamen && (
        <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-chikin-gray-700">
          <div className="text-xs font-bold text-zinc-600 dark:text-zinc-300 uppercase tracking-wider mb-2 flex items-center gap-1">
            <Soup size={12}/> Tipo de ramen
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {RAMEN_TYPES.map(rt => (
              <motion.button
                key={rt.v}
                type="button"
                onClick={() => onSetRamenType(it.key, rt.v)}
                whileTap={{ scale: 0.95 }}
                className={cx(
                  'px-3 py-3 rounded-xl text-sm font-bold border-2 min-h-[44px] flex items-center justify-center gap-1',
                  it.ramen_type === rt.v
                    ? rt.v === 'picante'
                      ? 'bg-chikin-red text-white border-chikin-red'
                      : 'bg-amber-500 text-white border-amber-500'
                    : 'bg-white dark:bg-chikin-gray-800 border-zinc-200 dark:border-chikin-gray-700'
                )}
              >
                {rt.v === 'picante' ? <Flame size={14}/> : '🥛'} {rt.l}
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {/* POLLO: modo de salsa */}
      {isChicken && it.allows_extras && (
        <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-chikin-gray-700">
          <div className="text-xs font-bold text-zinc-600 dark:text-zinc-300 uppercase tracking-wider mb-2">
            Modo de salsa
          </div>
          <div className="grid grid-cols-4 gap-1">
            {SAUCE_MODES.map(sm => (
              <motion.button
                key={sm.v}
                type="button"
                onClick={() => onSetSauceMode(it.key, sm.v)}
                whileTap={{ scale: 0.94 }}
                className={cx(
                  'relative px-1 py-2 rounded-lg text-[10.5px] font-bold border-2 leading-tight min-h-[42px] flex flex-col items-center justify-center',
                  it.sauce_mode === sm.v
                    ? 'bg-chikin-red text-white border-chikin-red shadow-sm shadow-chikin-red/30'
                    : 'bg-white dark:bg-chikin-gray-800 border-zinc-200 dark:border-chikin-gray-700 text-zinc-700 dark:text-zinc-200'
                )}
              >
                <span>{sm.l}</span>
                {sm.v === 'extra' && (
                  <span className={cx(
                    'text-[8px] font-extrabold mt-0.5 px-1 rounded',
                    it.sauce_mode === sm.v ? 'bg-white/25' : 'bg-chikin-yellow text-chikin-black'
                  )}>+25¢</span>
                )}
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {/* Selector de salsas: visible si admite extras Y no está en modo "sin" */}
      {it.allows_extras && it.sauce_mode !== 'sin' && (
        <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-chikin-gray-700">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-bold text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">
              Salsas {it.sauces.length > 0 && (
                <span className="ml-1 text-chikin-red">({it.sauces.length})</span>
              )}
              {it.sauce_mode === 'aparte' && (
                <span className="ml-1.5 text-[10px] font-normal italic text-zinc-500">aparte</span>
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
              const isExtra = on && sauceIdx >= free
              return (
                <motion.button
                  key={s}
                  type="button"
                  onClick={() => onToggleSauce(it.key, s)}
                  whileTap={{ scale: 0.94 }}
                  className={cx(
                    'relative px-2.5 py-2.5 rounded-xl text-[11px] font-bold border-2 transition-all leading-tight text-left flex items-center justify-between gap-1 min-h-[44px]',
                    on
                      ? 'bg-chikin-red text-white border-chikin-red shadow-sm shadow-chikin-red/30'
                      : 'bg-white dark:bg-chikin-gray-800 border-zinc-200 dark:border-chikin-gray-700 text-zinc-700 dark:text-zinc-200'
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
  )
}
