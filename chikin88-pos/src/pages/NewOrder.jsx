import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Minus, Trash2, ShoppingBag, User, Phone, Bike,
  Banknote, ArrowRightLeft, MessageSquare, Check, Loader2,
  Star, Flame, Soup, AlertTriangle, RotateCw, Wallet,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useOrderStore } from '../store/orderStore'
import { useAuthStore } from '../store/authStore'
import { supabase } from '../lib/supabase'
import { markActivity } from '../lib/appHealth'
import { saveDraft, loadDraft, clearDraft, isDraftMeaningful } from '../lib/orderDraft'
import { PRODUCTS, CATEGORIES, isRamenProduct, isChickenProduct } from '../data/products'
import {
  SAUCES, SAUCE_MODES, RAMEN_TYPES,
  money, cx,
  SAUCE_EXTRA_PRICE, PALILLOS_EXTRA_PRICE, MAYO_EXTRA_PRICE,
  itemExtrasTotal, itemSubtotal, itemExtraSauceCount,
  detectEmployee, isOwner, isDiscountEligibleCombo,
  COURTESY_COMBO, employeeDiscountPrice,
  detectStudentPromo, isStudentDiscountEligibleItem,
  itemStudentDiscount, studentDiscountTotal,
  STUDENT_DISCOUNT_RATE, round2,
} from '../lib/utils'

export default function NewOrder() {
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const createOrder = useOrderStore(s => s.createOrder)

  const [catalog, setCatalog] = useState(PRODUCTS)
  const [activeCat, setActiveCat] = useState('Principales')
  const [items, setItems] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const submittingRef = useRef(false)         // Anti-doble-click hard
  const clientRequestIdRef = useRef(null)     // Idempotency: mismo ID al reintentar

  // Datos del pedido
  const [customerName, setCustomerName]   = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [orderType, setOrderType]         = useState('para_llevar')
  const [isDelivery, setIsDelivery]       = useState(false)
  const [deliveryFee, setDeliveryFee]     = useState('')
  const [withMayo, setWithMayo]           = useState(true)
  const [mayoExtra, setMayoExtra]         = useState(0)
  const [utensil, setUtensil]             = useState('tenedor')
  const [paymentMethod, setPaymentMethod] = useState('efectivo')
  // Pago mixto: si paymentMethod === 'mixto', estos dos campos deben sumar
  // exactamente el total del pedido. Para 'efectivo'/'transferencia' la RPC
  // backend ignora estos y asigna el total al campo que corresponda.
  const [cashAmount, setCashAmount] = useState('')
  const [transferAmount, setTransferAmount] = useState('')
  const [notes, setNotes]                 = useState('')

  // Beneficios de empleado
  const [benefitMode, setBenefitMode]     = useState(null)  // null | 'discount' | 'courtesy'

  // ---------- Restaurar borrador al cargar ----------
  // Si la app se cerró/recargó a mitad de pedido, recuperamos lo que había.
  // Se ejecuta UNA SOLA VEZ al montar el componente.
  //
  // Importante: loadDraft() ya descarta drafts sin items (ver orderDraft.js).
  // Si el usuario presionó "Vaciar" antes de salir, no hay nada que restaurar.
  const [draftRestored, setDraftRestored] = useState(false)
  useEffect(() => {
    if (draftRestored) return
    const d = loadDraft()
    if (d && isDraftMeaningful(d)) {
      if (d.customerName)  setCustomerName(d.customerName)
      if (d.customerPhone) setCustomerPhone(d.customerPhone)
      if (d.orderType)     setOrderType(d.orderType)
      if (typeof d.isDelivery === 'boolean') setIsDelivery(d.isDelivery)
      if (d.deliveryFee)   setDeliveryFee(d.deliveryFee)
      if (typeof d.withMayo === 'boolean') setWithMayo(d.withMayo)
      if (typeof d.mayoExtra === 'number' && d.mayoExtra >= 0) setMayoExtra(d.mayoExtra)
      if (d.utensil)       setUtensil(d.utensil)
      if (d.paymentMethod) setPaymentMethod(d.paymentMethod)
      if (typeof d.cashAmount === 'string') setCashAmount(d.cashAmount)
      if (typeof d.transferAmount === 'string') setTransferAmount(d.transferAmount)
      if (d.notes)         setNotes(d.notes)
      if (d.benefitMode)   setBenefitMode(d.benefitMode)
      if (Array.isArray(d.items)) setItems(d.items)
      if (d.clientRequestId) clientRequestIdRef.current = d.clientRequestId
      toast('Borrador recuperado', { icon: '📋', duration: 2500 })
    }
    setDraftRestored(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- Autosave del borrador (debounced) ----------
  // Si el carrito está vacío, limpiamos el draft activamente para que
  // un nombre escrito no resucite un pedido descartado al volver a Nuevo.
  useEffect(() => {
    if (!draftRestored) return
    const draft = {
      customerName, customerPhone, orderType, isDelivery, deliveryFee,
      withMayo, mayoExtra, utensil, paymentMethod, cashAmount, transferAmount,
      notes, benefitMode, items,
      clientRequestId: clientRequestIdRef.current,
    }
    if (!isDraftMeaningful(draft)) {
      clearDraft()
      return
    }
    const id = setTimeout(() => saveDraft(draft), 600)
    return () => clearTimeout(id)
  }, [
    draftRestored, customerName, customerPhone, orderType, isDelivery, deliveryFee,
    withMayo, mayoExtra, utensil, paymentMethod, cashAmount, transferAmount,
    notes, benefitMode, items,
  ])

  // ---------- Empleado detectado ----------
  const employee = useMemo(() => detectEmployee(customerName), [customerName])

  // ---------- Promo estudiante detectada ----------
  // Mutuamente excluyente con empleado/dueño: los nombres "88" no
  // pueden terminar en "estudiante" al mismo tiempo. Por seguridad
  // anti-conflicto si alguien intentara "Cindy88estudiante", el
  // backend igual decide por sufijo.
  const isStudent = useMemo(
    () => !employee && detectStudentPromo(customerName),
    [employee, customerName]
  )

  // Si el cliente deja de ser empleado, desactivar beneficio
  useEffect(() => {
    if (!employee && benefitMode) setBenefitMode(null)
  }, [employee, benefitMode])

  // Si el cliente cambia a Sin mayonesa, resetear mayonesa extra a 0
  useEffect(() => {
    if (!withMayo && mayoExtra !== 0) setMayoExtra(0)
  }, [withMayo, mayoExtra])

  // ---------- Vaciar el pedido por completo ----------
  // Limpia carrito + draft + reqId. Resetea campos de pedido a su default
  // para que volver a /nuevo o quedarse en la pantalla muestre formulario
  // en blanco. El nombre y teléfono se mantienen porque a veces el cliente
  // pide "lo mismo de antes" y borrarlos sería molesto; pero el draft sí
  // se limpia, así no resucita al navegar fuera y volver.
  const clearCart = useCallback(() => {
    setItems([])
    setBenefitMode(null)
    setMayoExtra(0)
    setNotes('')
    setCashAmount('')
    setTransferAmount('')
    clearDraft()
    clientRequestIdRef.current = null
  }, [])

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
    setItems(prev => {
      const next = prev.filter(it => it.key !== key)
      // Si quitamos el último producto, el pedido ya no existe como
      // borrador útil: borramos draft + reqId para que el siguiente
      // pedido nazca limpio. El autosave de todos modos detectaría
      // un carrito vacío y limpiaría el draft, pero aquí lo hacemos
      // sincrónicamente para evitar carreras con el debounce.
      if (next.length === 0) {
        clearDraft()
        clientRequestIdRef.current = null
      }
      return next
    })
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
  // Mayonesa extra: solo cuenta si la mayonesa está activada.
  // El efecto que escucha withMayo ya fuerza mayoExtra=0 si se elige "Sin",
  // pero blindamos también el cálculo aquí por si acaso.
  const mayoExtraCount = withMayo ? Math.max(0, mayoExtra) : 0
  const mayoExtraTotal = round2(mayoExtraCount * MAYO_EXTRA_PRICE)

  // Descuento promo estudiante (informativo en UI; el backend recalcula).
  // Se aplica solo si el nombre del cliente activa la promo. Si el cliente
  // es empleado/dueño (sufijo 88), `isStudent` ya viene en false.
  const studentDiscount = useMemo(
    () => studentDiscountTotal(items, isStudent),
    [items, isStudent]
  )

  const total = round2(productsSubtotal + palillosExtra + deliveryAmount + mayoExtraTotal - studentDiscount)

  const parsePaymentAmount = (value) => {
    if (value == null || value === '') return 0
    const n = Number(String(value).replace(',', '.').replace(/[^\d.-]/g, ''))
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
  }


  // ---------- Validación de pago mixto ----------
  // Si paymentMethod es 'mixto', cashAmount + transferAmount debe igualar total.
  // Tolerancia de 1 centavo por floats.
  const cashNum     = paymentMethod === 'mixto' ? parsePaymentAmount(cashAmount) : 0
  const transferNum = paymentMethod === 'mixto' ? parsePaymentAmount(transferAmount) : 0
  const splitSum    = round2(cashNum + transferNum)
  const splitDiff   = round2(total - splitSum)
  // OK si: no es mixto, o cuadra dentro de 1 centavo Y ambos no son cero.
  const splitOk = paymentMethod !== 'mixto'
    || (Math.abs(splitDiff) <= 0.01 && !(cashNum === 0 && transferNum === 0))

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
  // Si falla, mantenemos el formulario y mostramos un banner persistente con
  // botón "Reintentar". El client_request_id se reusa al reintentar, así que
  // si el pedido sí se creó en el primer intento (timeout ambiguo), no se duplica.
  //
  // El watchdog de UI es la ÚLTIMA línea de defensa: garantiza que el botón
  // no quede colgado pase lo que pase, incluso si alguna promesa fallara
  // en formas inesperadas.
  const submit = async () => {
    if (submittingRef.current) return
    markActivity()
    const err = validate()
    if (err) {
      setSubmitError(err)
      return toast.error(err)
    }

    // Generar (o reusar) un client_request_id para idempotency.
    let reqId = clientRequestIdRef.current
    if (!reqId) {
      reqId = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      clientRequestIdRef.current = reqId
    }

    submittingRef.current = true
    setSubmitting(true)
    setSubmitError(null)

    // ===== Watchdog UI =====
    // Si en 15s no resolvió ni rechazó (por algún bug imposible), forzamos
    // liberación del botón y mostramos error. Es defensa en profundidad
    // sobre el timeout del fetch a /api/create-order (12s) que ya está
    // en orderStore.
    const WATCHDOG_MS = 15_000
    let watchdogFired = false
    const watchdogTimer = setTimeout(() => {
      watchdogFired = true
      console.warn('[NewOrder] WATCHDOG: liberando botón forzosamente')
      submittingRef.current = false
      setSubmitting(false)
      setSubmitError('La operación tardó demasiado. Tus datos siguen aquí — pulsa Reintentar.')
    }, WATCHDOG_MS)

    try {
      // Nota: ya NO llamamos ensureSystemReady aquí. La creación del
      // pedido va por /api/create-order, que abre conexión fresca a
      // Supabase en el servidor. Esto hace que el botón funcione
      // siempre, incluso si el cliente del navegador está stale.
      //
      // El warmup sigue ocurriendo en background (heartbeat + wake)
      // para mantener Realtime y la sesión activos.

      const itemsWithSubtotal = items.map(it => ({
        ...it,
        subtotal: itemSubtotal(it),
      }))

      await createOrder({
        client_request_id: reqId,
        customer_name:    customerName.trim(),
        customer_phone:   customerPhone.trim() || null,
        order_type:       orderType,
        is_delivery:      isDelivery,
        delivery_fee:     deliveryAmount,
        with_mayo:        withMayo,
        mayo_extra:       mayoExtraCount,
        utensil,
        payment_method:   paymentMethod,
        cash_amount:      paymentMethod === 'mixto' ? cashNum : 0,
        transfer_amount:  paymentMethod === 'mixto' ? transferNum : 0,
        cashAmount:       paymentMethod === 'mixto' ? cashNum : 0,
        transferAmount:   paymentMethod === 'mixto' ? transferNum : 0,
        notes:            notes.trim() || null,
        created_by:       profile?.id || null,
        status:           'pendiente',
        subtotal:         productsSubtotal,
        total,
        benefit_type:     benefitMode,
        benefit_employee: benefitMode ? employee : null,
      }, itemsWithSubtotal)

      // Si el watchdog ya disparó, no anulamos su estado (el pedido
      // pudo haberse creado igual, pero ya mostramos error al usuario).
      if (watchdogFired) return

      // Éxito: limpiar borrador y client_request_id para el siguiente pedido
      clearDraft()
      clientRequestIdRef.current = null

      toast.success('¡Pedido enviado a cocina!', { icon: '🔥' })
      navigate('/pedidos')
    } catch (err) {
      if (watchdogFired) return  // ya manejado por el watchdog
      console.error('createOrder failed:', err)
      const msg = err?.message || 'No se pudo crear el pedido'
      setSubmitError(msg)
      toast.error(msg, { duration: 5000 })
      // NO limpiamos el formulario ni el client_request_id, así el reintento
      // es idempotente y el camarero no pierde el trabajo.
    } finally {
      clearTimeout(watchdogTimer)
      if (!watchdogFired) {
        submittingRef.current = false
        setSubmitting(false)
      }
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
              const studentPrice =
                (isStudent && isStudentDiscountEligibleItem(p) && specialPrice === null && !courtesyFree)
                  ? round2(Number(p.price) * (1 - STUDENT_DISCOUNT_RATE))
                  : null
              return (
                <motion.button
                  key={p.id || p.name}
                  onClick={() => addItem(p)}
                  whileTap={{ scale: 0.96 }}
                  className={cx(
                    'card p-4 text-left hover:border-chikin-red transition-colors group relative',
                    (specialPrice !== null || courtesyFree) && 'ring-2 ring-chikin-yellow',
                    studentPrice !== null && 'ring-2 ring-emerald-400'
                  )}
                >
                  {(specialPrice !== null || courtesyFree) && (
                    <span className={cx(
                      'absolute -top-2 -right-2 text-[9px] font-extrabold px-2 py-1 rounded-full shadow-md',
                      isOwner(employee)
                        ? 'bg-amber-400 text-amber-900'
                        : 'bg-chikin-yellow text-chikin-black'
                    )}>
                      {isOwner(employee)
                        ? (courtesyFree ? '👑 GRATIS' : '👑 DUEÑO')
                        : (courtesyFree ? '🎁 GRATIS' : '⭐ EMPLEADO')}
                    </span>
                  )}
                  {studentPrice !== null && (
                    <span className="absolute -top-2 -right-2 text-[9px] font-extrabold px-2 py-1 rounded-full shadow-md bg-emerald-500 text-white">
                      🎓 -10%
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
                      ) : studentPrice !== null ? (
                        <>
                          <span className="line-through text-xs text-zinc-400">{money(p.price)}</span>
                          <div className="font-display text-2xl text-emerald-600">{money(studentPrice)}</div>
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
          {/* Banner empleado/dueño detectado */}
          {employee && (
            <EmployeeBanner
              name={employee}
              owner={isOwner(employee)}
              benefitMode={benefitMode}
              onSetMode={setBenefitMode}
              savings={discountSavings}
            />
          )}

          {/* Banner promo estudiante detectada (mutuamente excluyente con empleado) */}
          {isStudent && (
            <StudentPromoBanner savings={studentDiscount} />
          )}

          {/* Items */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold flex items-center gap-2">
                <ShoppingBag size={18}/> Productos ({items.length})
              </h3>
              {items.length > 0 && (
                <button
                  onClick={clearCart}
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
                    isStudent={isStudent}
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

            {/* Mayonesa extra: stepper. Solo activo cuando Mayonesa = Con. */}
            <div>
              <label className="label flex items-center justify-between">
                <span>Mayonesa extra</span>
                <span className="text-[10px] font-extrabold bg-chikin-yellow text-chikin-black px-1.5 py-0.5 rounded">
                  +25¢ c/u
                </span>
              </label>
              <div className={cx(
                'flex items-center justify-between gap-3 p-2 rounded-xl border-2',
                withMayo
                  ? 'bg-white dark:bg-chikin-gray-800 border-zinc-200 dark:border-chikin-gray-700'
                  : 'bg-zinc-100 dark:bg-chikin-gray-900 border-zinc-200 dark:border-chikin-gray-800 opacity-60'
              )}>
                <button
                  type="button"
                  onClick={() => setMayoExtra(n => Math.max(0, n - 1))}
                  disabled={!withMayo || mayoExtra <= 0}
                  className="w-10 h-10 rounded-lg bg-zinc-100 dark:bg-chikin-gray-700 flex items-center justify-center disabled:opacity-40"
                  aria-label="Menos mayonesa extra"
                >
                  <Minus size={16}/>
                </button>
                <div className="text-center flex-1">
                  <div className="font-display text-2xl leading-none">{withMayo ? mayoExtra : 0}</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">
                    {withMayo
                      ? (mayoExtra > 0 ? `+${money(mayoExtraTotal)}` : 'unidades')
                      : 'Activa Mayonesa para agregar extra'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMayoExtra(n => n + 1)}
                  disabled={!withMayo}
                  className="w-10 h-10 rounded-lg bg-chikin-red text-white flex items-center justify-center disabled:opacity-40"
                  aria-label="Más mayonesa extra"
                >
                  <Plus size={16}/>
                </button>
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
              <div className="grid grid-cols-3 gap-2">
                <button type="button" onClick={() => setPaymentMethod('efectivo')}
                  className={cx(
                    'py-3 rounded-xl font-semibold border-2 flex items-center justify-center gap-1 text-sm',
                    paymentMethod === 'efectivo'
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : 'bg-white dark:bg-chikin-gray-800 border-zinc-200 dark:border-chikin-gray-700'
                  )}
                ><Banknote size={16}/> Efectivo</button>
                <button type="button" onClick={() => setPaymentMethod('transferencia')}
                  className={cx(
                    'py-3 rounded-xl font-semibold border-2 flex items-center justify-center gap-1 text-sm',
                    paymentMethod === 'transferencia'
                      ? 'bg-blue-500 border-blue-500 text-white'
                      : 'bg-white dark:bg-chikin-gray-800 border-zinc-200 dark:border-chikin-gray-700'
                  )}
                ><ArrowRightLeft size={16}/> Transfer</button>
                <button type="button" onClick={() => setPaymentMethod('mixto')}
                  className={cx(
                    'py-3 rounded-xl font-semibold border-2 flex items-center justify-center gap-1 text-sm',
                    paymentMethod === 'mixto'
                      ? 'bg-amber-500 border-amber-500 text-white'
                      : 'bg-white dark:bg-chikin-gray-800 border-zinc-200 dark:border-chikin-gray-700'
                  )}
                ><Wallet size={16}/> Mixto</button>
              </div>

              {/* Split de pago mixto: aparece solo si paymentMethod === 'mixto'.
                  Validación en vivo: muestra "Falta $X" / "Sobra $X" / "Cuadra".
                  El botón Enviar queda bloqueado mientras splitOk sea false. */}
              {paymentMethod === 'mixto' && (
                <div className="mt-2 p-3 rounded-xl border-2 border-amber-300 dark:border-amber-800/60 bg-amber-50/60 dark:bg-amber-950/20 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-300 flex items-center gap-1 mb-1">
                        <Banknote size={11}/> Efectivo
                      </label>
                      <div className="flex items-center gap-1">
                        <span className="text-zinc-500 text-sm">$</span>
                        <input className="input py-2 flex-1" type="number" step="0.01" inputMode="decimal"
                          value={cashAmount}
                          onChange={e => setCashAmount(e.target.value)}
                          placeholder="0.00" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-300 flex items-center gap-1 mb-1">
                        <ArrowRightLeft size={11}/> Transferencia
                      </label>
                      <div className="flex items-center gap-1">
                        <span className="text-zinc-500 text-sm">$</span>
                        <input className="input py-2 flex-1" type="number" step="0.01" inputMode="decimal"
                          value={transferAmount}
                          onChange={e => setTransferAmount(e.target.value)}
                          placeholder="0.00" />
                      </div>
                    </div>
                  </div>
                  {/* Banner de validación */}
                  <div className={cx(
                    'flex items-center justify-between text-xs font-bold px-2 py-1.5 rounded-lg',
                    splitOk
                      ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                      : 'bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                  )}>
                    <span>
                      Suma: {money(splitSum)} / {money(total)}
                    </span>
                    <span>
                      {splitOk
                        ? '✓ Cuadra'
                        : splitDiff > 0
                          ? `Falta ${money(splitDiff)}`
                          : `Sobra ${money(Math.abs(splitDiff))}`}
                    </span>
                  </div>
                  {/* Botones helper rápidos */}
                  <div className="flex gap-1.5">
                    <button type="button"
                      onClick={() => {
                        setCashAmount(total.toFixed(2))
                        setTransferAmount('0')
                      }}
                      className="btn flex-1 text-[10px] py-1 bg-zinc-100 dark:bg-chikin-gray-800">
                      Todo efectivo
                    </button>
                    <button type="button"
                      onClick={() => {
                        const half = round2(total / 2)
                        setCashAmount(half.toFixed(2))
                        setTransferAmount(round2(total - half).toFixed(2))
                      }}
                      className="btn flex-1 text-[10px] py-1 bg-zinc-100 dark:bg-chikin-gray-800">
                      Mitad y mitad
                    </button>
                    <button type="button"
                      onClick={() => {
                        setCashAmount('0')
                        setTransferAmount(total.toFixed(2))
                      }}
                      className="btn flex-1 text-[10px] py-1 bg-zinc-100 dark:bg-chikin-gray-800">
                      Todo transfer
                    </button>
                  </div>
                </div>
              )}
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
              {mayoExtraTotal > 0 && (
                <div className="flex justify-between text-chikin-yellow/90">
                  <span>Mayonesa extra ×{mayoExtraCount}</span>
                  <span>+{money(mayoExtraTotal)}</span>
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
              {studentDiscount > 0 && (
                <div className="flex justify-between text-emerald-400">
                  <span>Descuento estudiante (10%)</span>
                  <span>-{money(studentDiscount)}</span>
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
        {/* Banner persistente de error: no se borra al cambiar pantalla, sólo al reintentar y tener éxito */}
        {submitError && !submitting && (
          <div className="mb-3 p-3 rounded-xl bg-rose-100 dark:bg-rose-950/40 border-2 border-rose-300 dark:border-rose-900 flex items-start gap-2">
            <AlertTriangle className="text-rose-600 shrink-0 mt-0.5" size={18}/>
            <div className="flex-1 text-sm">
              <div className="font-bold text-rose-700 dark:text-rose-300">No se pudo enviar el pedido</div>
              <div className="text-xs text-rose-600 dark:text-rose-400 mt-0.5">{submitError}</div>
              <div className="text-[10px] text-zinc-500 mt-1 italic">
                Tus datos están guardados. Pulsa "Reintentar" y el sistema evitará duplicados automáticamente.
              </div>
            </div>
            <button
              onClick={submit}
              className="btn bg-rose-600 text-white text-xs hover:bg-rose-700">
              <RotateCw size={12}/> Reintentar
            </button>
          </div>
        )}

        <button
          onClick={submit}
          disabled={submitting || items.length === 0 || !splitOk}
          className="w-full btn-xl bg-chikin-red text-white shadow-2xl shadow-chikin-red/40
                     hover:bg-chikin-red-dark uppercase tracking-wider disabled:opacity-60 disabled:cursor-not-allowed">
          {submitting
            ? <><Loader2 className="animate-spin"/> Enviando…</>
            : !splitOk
              ? <><AlertTriangle size={22}/> El pago mixto no cuadra</>
              : submitError
                ? <><RotateCw size={22}/> Reintentar envío · {money(total)}</>
                : <><Check size={24}/> Enviar a cocina · {money(total)}</>
          }
        </button>
      </div>
    </div>
  )
}

// ============================================================
//  Banner de empleado / dueño detectado
// ============================================================
function EmployeeBanner({ name, owner, benefitMode, onSetMode, savings }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cx(
        'card p-3 bg-gradient-to-br',
        owner
          ? 'from-amber-300/30 to-amber-500/20 border-amber-400'
          : 'from-chikin-yellow/20 to-chikin-red/10 border-chikin-yellow'
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        {owner
          ? <span className="text-lg">👑</span>
          : <Star className="text-chikin-yellow fill-chikin-yellow" size={18}/>}
        <div className="font-bold text-sm">
          {owner ? 'Dueño detectado: ' : 'Empleado detectado: '}
          <span className="text-chikin-red">{name}</span>
        </div>
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
          💵 Descuento{owner ? '' : ' diario'}
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
          🎁 Cortesía{owner ? '' : ' semanal'}
        </button>
      </div>
      {owner ? (
        <div className="text-[11px] text-amber-800 dark:text-amber-300 italic font-semibold flex items-start gap-1">
          <span>👑</span>
          <span>
            Beneficio de dueño · sin límites diarios ni semanales. Cada uso queda registrado en el historial.
            {savings > 0 && <span className="block text-emerald-600 font-bold mt-0.5">Ahorro: {money(savings)}</span>}
          </span>
        </div>
      ) : benefitMode === 'discount' ? (
        <div className="text-[11px] text-zinc-600 dark:text-zinc-300 italic">
          Selecciona 1 combo para precio especial · El sistema validará que no lo hayas usado hoy.
          {savings > 0 && <span className="block text-emerald-600 font-bold mt-0.5">Ahorro: {money(savings)}</span>}
        </div>
      ) : benefitMode === 'courtesy' ? (
        <div className="text-[11px] text-zinc-600 dark:text-zinc-300 italic">
          1 Combo Especial gratis a la semana · Solo se permite Combo Especial en este modo.
        </div>
      ) : null}
    </motion.div>
  )
}

// ============================================================
//  Banner de promo estudiante
//
//  Se muestra cuando el nombre del cliente termina en "estudiante"
//  (case-insensitive). 10% de descuento aplica solo a combos de
//  pollo (categoría 'Principales'), NUNCA a Combo Ramen, ramen,
//  bebidas, extras, palillos, salsas extra ni delivery.
//
//  El backend (RPC create_order_with_items) recalcula y persiste
//  los descuentos por su cuenta. Esta UI solo refleja la promo.
// ============================================================
function StudentPromoBanner({ savings }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="card p-3 bg-gradient-to-br from-emerald-300/30 to-emerald-500/20 border-emerald-400"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">🎓</span>
        <div className="font-bold text-sm">
          Promo estudiante activa:&nbsp;
          <span className="text-emerald-700 dark:text-emerald-400">10% en combos seleccionados</span>
        </div>
      </div>
      <div className="text-[11px] text-zinc-700 dark:text-zinc-300 italic">
        Aplica a Combo Económico, Especial, XXL y Full · NO aplica a Combo Ramen, bebidas, extras ni delivery.
        {savings > 0 && (
          <span className="block text-emerald-600 font-bold mt-0.5 not-italic">
            Ahorro: {money(savings)}
          </span>
        )}
      </div>
    </motion.div>
  )
}

// ============================================================
//  Item del carrito (memo para evitar re-renders)
// ============================================================
function CartItem({ it, isStudent, onUpdateQty, onRemove, onToggleSauce, onSetSauceMode, onSetRamenType }) {
  const isChicken = it.product_category === 'Principales'
  const isRamen = it.product_category === 'Ramen'
  const studentEligible = isStudent && isStudentDiscountEligibleItem(it)
  const studentSaved = studentEligible ? itemStudentDiscount(it) : 0
  const displaySubtotal = round2(itemSubtotal(it) - studentSaved)

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
          : studentEligible
            ? 'border-emerald-400 bg-emerald-50/40 dark:bg-emerald-950/20'
            : 'border-zinc-200 dark:border-chikin-gray-700'
      )}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="font-bold text-sm flex items-center gap-1.5 flex-wrap">
            {it.product_name}
            {it.is_benefit_item && (
              <span className="text-[9px] font-extrabold bg-chikin-yellow text-chikin-black px-1.5 py-0.5 rounded">
                {it.unit_price === 0 ? '🎁 CORTESÍA' : '⭐ EMPLEADO'}
              </span>
            )}
            {studentEligible && (
              <span className="text-[9px] font-extrabold bg-emerald-600 text-white px-1.5 py-0.5 rounded">
                🎓 PROMO ESTUDIANTE -10%
              </span>
            )}
          </div>
          <div className="text-xs text-zinc-500">
            {money(it.unit_price)} c/u
            {it.is_benefit_item && it.regular_price > it.unit_price && (
              <span className="line-through ml-1.5 text-zinc-400">{money(it.regular_price)}</span>
            )}
            {studentEligible && (
              <span className="ml-1.5 text-emerald-600 font-bold">
                -{money(studentSaved)}
              </span>
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
        <div className="text-right">
          {studentEligible && (
            <div className="text-[10px] line-through text-zinc-400">{money(itemSubtotal(it))}</div>
          )}
          <div className="font-bold text-chikin-red">{money(displaySubtotal)}</div>
        </div>
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
          <div className="grid grid-cols-3 gap-1">
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
