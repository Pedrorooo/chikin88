import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { withTimeout as withTimeoutShared, markSuccess } from '../lib/appHealth'
import { useHealthStore } from './healthStore'

// ============================================================
//  Logs sólo en desarrollo
// ============================================================
const isDev = import.meta.env?.DEV === true
const log = (...args) => { if (isDev) console.log('[orderStore]', ...args) }
const warn = (...args) => { if (isDev) console.warn('[orderStore]', ...args) }

// ============================================================
//  Constantes
// ============================================================
const CREATE_ORDER_TIMEOUT_MS = 10_000        // Timeout duro para crear pedido
const FETCH_TIMEOUT_MS        = 15_000        // Timeout duro para fetch
const RECONNECT_BASE_MS       = 1_000         // Backoff exponencial: 1s → 2s → 4s …
const RECONNECT_MAX_MS        = 30_000
const TODAY_REFRESH_THROTTLE  = 2_000         // Refetch de "hoy" como mucho cada 2s
const CHANNEL_NAME            = 'chikin88-orders-realtime'

// Estado del canal de realtime (no reactivo, sólo info auxiliar a nivel módulo)
let channel = null
let reconnectAttempt = 0
let reconnectTimer = null
let lastTodayRefresh = 0
// Polling de respaldo para cocina
let kitchenPollTimer = null
let kitchenLastPoll = 0

// ============================================================
//  Helper: envolver una promesa con timeout (usa el compartido
//  de appHealth para evitar duplicación)
// ============================================================
const withTimeout = withTimeoutShared

// ============================================================
//  STORE
// ============================================================
export const useOrderStore = create((set, get) => ({
  orders: [],          // pedidos activos para Cocina/Pedidos
  todayOrders: [],     // pedidos del día (excluye anulados)
  loading: false,
  ready: false,
  // 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  realtimeStatus: 'idle',
  lastSyncAt: null,    // timestamp del último fetch/refetch exitoso

  // ============================================================
  //  Carga inicial / refetch manual
  // ============================================================
  fetchActive: async () => {
    set({ loading: true })
    try {
      const { data, error } = await withTimeout(
        supabase
          .from('orders')
          .select('*, order_items(*)')
          .in('status', ['pendiente', 'en_preparacion', 'listo'])
          .eq('deleted_from_reports', false)
          .order('created_at', { ascending: true })
          .limit(200),
        FETCH_TIMEOUT_MS,
        'Tiempo de espera al cargar pedidos'
      )
      if (error) throw error
      set({ orders: data || [], lastSyncAt: Date.now() })
      log('fetchActive OK', data?.length)
    } catch (err) {
      console.error('fetchActive error:', err)
      toast.error('No se pudieron cargar los pedidos')
    } finally {
      set({ loading: false, ready: true })
    }
  },

  // Pedidos del día (Orders → "Todos del día"). Excluye anulados.
  fetchToday: async (force = false) => {
    const now = Date.now()
    if (!force && now - lastTodayRefresh < TODAY_REFRESH_THROTTLE) return
    lastTodayRefresh = now

    try {
      const start = new Date(); start.setHours(0, 0, 0, 0)
      const { data, error } = await withTimeout(
        supabase
          .from('orders')
          .select('*, order_items(*)')
          .gte('created_at', start.toISOString())
          .eq('deleted_from_reports', false)
          .order('created_at', { ascending: false })
          .limit(500),
        FETCH_TIMEOUT_MS,
        'Tiempo de espera al cargar pedidos del día'
      )
      if (error) throw error
      set({ todayOrders: data || [], lastSyncAt: Date.now() })
    } catch (err) {
      console.error('fetchToday error:', err)
      // no toast aquí; es refresco secundario, mejor no molestar
    }
  },

  // Refetch manual completo (botón "Actualizar" en Cocina/Pedidos)
  manualRefresh: async () => {
    log('manualRefresh')
    await Promise.all([get().fetchActive(), get().fetchToday(true)])
  },

  // ============================================================
  //  Polling de respaldo para Cocina (15-30s mientras visible)
  // ============================================================
  //
  //  El realtime websocket es la fuente primaria. El polling es
  //  un respaldo por si el websocket muere silenciosamente o
  //  se pierden eventos cuando la tablet duerme. Es lightweight:
  //  sólo trae los pedidos activos, no reportes ni historial.
  // ============================================================
  startKitchenPolling: () => {
    if (kitchenPollTimer) return  // ya activo
    log('kitchen polling: start')
    const tick = () => {
      // Sólo si visible y conectado (o intentando reconectar)
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      get().fetchActive().catch(() => {})
    }
    // Cadencia adaptativa: más rápido si el realtime no está conectado
    kitchenPollTimer = setInterval(() => {
      const rt = get().realtimeStatus
      // Si realtime conectado, 30s. Si reconectando/desconectado, 10s.
      const desired = rt === 'connected' ? 30_000 : 10_000
      if (Date.now() - kitchenLastPoll < desired) return
      kitchenLastPoll = Date.now()
      tick()
    }, 5_000)  // chequeo cada 5s, decide internamente
  },

  stopKitchenPolling: () => {
    if (kitchenPollTimer) {
      clearInterval(kitchenPollTimer)
      kitchenPollTimer = null
      log('kitchen polling: stop')
    }
  },

  // ============================================================
  //  Realtime — suscripción robusta con reconexión
  // ============================================================
  subscribe: () => {
    // Si ya hay un canal vivo y conectado, no rehacemos.
    const status = get().realtimeStatus
    if (channel && (status === 'connected' || status === 'connecting')) {
      log('subscribe: skip, ya en', status)
      return
    }

    // Si había un canal previo en estado raro, lo limpiamos primero.
    if (channel) {
      try { supabase.removeChannel(channel) } catch {}
      channel = null
    }

    set({ realtimeStatus: 'connecting' })
    useHealthStore.getState().setRealtimeStatus('connecting')
    log('subscribe: creando canal', CHANNEL_NAME)

    channel = supabase
      .channel(CHANNEL_NAME)
      // -------- INSERT/UPDATE/DELETE en orders --------
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload) => handleOrderChange(payload, set, get)
      )
      // -------- UPDATE en order_items (por si editan productos) --------
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_items' },
        (payload) => handleItemChange(payload, set, get)
      )
      .subscribe((subStatus, err) => {
        log('realtime status:', subStatus, err || '')
        const health = useHealthStore.getState()
        if (subStatus === 'SUBSCRIBED') {
          reconnectAttempt = 0
          set({ realtimeStatus: 'connected' })
          health.setRealtimeStatus('connected')
          // Al (re)conectar, sincronizamos por si nos perdimos eventos.
          get().fetchActive()
          get().fetchToday(true)
        } else if (subStatus === 'CHANNEL_ERROR' || subStatus === 'TIMED_OUT') {
          warn('realtime falló:', subStatus, err)
          health.setRealtimeStatus('reconnecting')
          scheduleReconnect(set, get)
        } else if (subStatus === 'CLOSED') {
          set({ realtimeStatus: 'disconnected' })
          health.setRealtimeStatus('disconnected')
        }
      })
  },

  unsubscribe: () => {
    log('unsubscribe')
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    reconnectAttempt = 0
    if (channel) {
      try { supabase.removeChannel(channel) } catch {}
      channel = null
    }
    set({ realtimeStatus: 'idle' })
    useHealthStore.getState().setRealtimeStatus('idle')
  },

  // ============================================================
  //  createOrder — usa RPC transaccional
  // ============================================================
  //
  //  Una sola llamada al backend que en UNA transacción:
  //    • verifica idempotency (client_request_id)
  //    • inserta order
  //    • inserta order_items
  //    • aplica trigger de beneficios
  //    • devuelve pedido completo con items
  //
  //  Si algo falla, PostgreSQL hace rollback. Cero pedidos parciales.
  //  Cero awaits encadenados en el frontend = cero puntos de cuelgue.
  //
  //  Defensa en profundidad:
  //    1. ensureSystemReady ANTES (no descubrimos problema al hacer insert)
  //    2. AbortController real con timeout duro
  //    3. Compensación: si Postgres tira error de beneficio, lo formateamos
  // ============================================================
  // ============================================================
  //  createOrder — POST a /api/create-order (serverless)
  // ============================================================
  //
  //  ARQUITECTURA:
  //    Frontend → fetch('/api/create-order') → Vercel function →
  //    cliente Supabase FRESCO en el servidor → RPC transaccional →
  //    respuesta JSON al frontend.
  //
  //  POR QUÉ NO ATACAR SUPABASE DIRECTO DESDE EL NAVEGADOR:
  //    El cliente Supabase del navegador puede quedar stale después
  //    de horas abiertas (locks zombi, websocket muerto, token vencido).
  //    Una function serverless crea un cliente Supabase nuevo en cada
  //    request y muere al terminar — imposible que esté stale.
  //
  //  SEGURIDAD:
  //    El JWT del usuario va en Authorization Bearer. El endpoint lo
  //    valida contra Supabase Auth antes de tocar la BD. created_by
  //    se deriva del JWT, no del body.
  //
  //  TIMEOUTS:
  //    AbortController duro de 12s en el cliente. Si el endpoint tarda
  //    más, el frontend libera el botón y muestra "Reintentar".
  //    El endpoint a su vez tiene timeout interno de 9s contra Postgres.
  // ============================================================
  createOrder: async (orderData, items) => {
    log('createOrder: starting')

    // Obtener el token actual del usuario (sin pedir refresh — leemos
    // directo de storage para no tocar el lock de auth)
    let accessToken = null
    try {
      const { data } = await supabase.auth.getSession()
      accessToken = data?.session?.access_token || null
    } catch (e) {
      // Si getSession fallara (lock zombi), intentamos leer del storage
      log('createOrder: getSession falló, leyendo storage', e?.message)
    }

    if (!accessToken) {
      // Fallback: leer la sesión directo de localStorage
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)
          if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) {
            const raw = localStorage.getItem(k)
            if (raw) {
              const parsed = JSON.parse(raw)
              accessToken = (parsed?.currentSession?.access_token) || parsed?.access_token
              break
            }
          }
        }
      } catch {}
    }

    if (!accessToken) {
      throw new Error('Sesión expirada. Vuelve a iniciar sesión.')
    }

    // Construir payload
    const subtotal = orderData.subtotal ?? items.reduce(
      (s, it) => s + (it.subtotal ?? it.unit_price * it.quantity), 0
    )
    const total = orderData.total ?? (
      subtotal + (orderData.is_delivery ? Number(orderData.delivery_fee || 0) : 0)
    )

    const payload = {
      customer_name:    orderData.customer_name,
      customer_phone:   orderData.customer_phone || null,
      status:           orderData.status || 'pendiente',
      order_type:       orderData.order_type || 'para_llevar',
      is_delivery:      !!orderData.is_delivery,
      delivery_fee:     Number(orderData.delivery_fee || 0),
      with_mayo:        orderData.with_mayo !== false,
      utensil:          orderData.utensil || 'tenedor',
      payment_method:   orderData.payment_method || 'efectivo',
      notes:            orderData.notes || null,
      subtotal,
      total,
      benefit_type:     orderData.benefit_type || null,
      benefit_employee: orderData.benefit_employee || null,
      client_request_id: orderData.client_request_id || null,
      items: items.map(it => ({
        product_id:       it.product_id || null,
        product_name:     it.product_name,
        product_category: it.product_category || null,
        unit_price:       Number(it.unit_price),
        quantity:         Number(it.quantity),
        sauces:           it.sauces || [],
        sauce_mode:       it.sauce_mode || 'normal',
        ramen_type:       it.ramen_type || null,
        subtotal:         Number(it.subtotal ?? (it.unit_price * it.quantity)),
      })),
    }

    // POST con AbortController real
    const t0 = Date.now()
    const controller = new AbortController()
    const abortTimer = setTimeout(() => controller.abort(), CREATE_ORDER_TIMEOUT_MS)

    let response
    try {
      response = await fetch('/api/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(abortTimer)
      if (err?.name === 'AbortError') {
        // Si el cliente abortó por timeout, el pedido pudo haberse creado
        // igual. Al reintentar con el mismo client_request_id, el RPC
        // detectará el duplicado y devolverá el original.
        throw new Error('El servidor tardó demasiado. Pulsa reintentar.')
      }
      // Errores de red (DNS, sin conexión, CORS)
      throw new Error('Sin conexión con el servidor. Verifica internet y reintenta.')
    }
    clearTimeout(abortTimer)

    // Parsear respuesta
    let result
    try {
      result = await response.json()
    } catch {
      throw new Error('Respuesta inválida del servidor. Reintenta.')
    }

    if (!response.ok || !result.success) {
      const msg = result?.error || `Error del servidor (${response.status})`
      // Mensajes amigables ya vienen del endpoint (parseBenefitError aplicado allí)
      throw new Error(msg)
    }

    markSuccess()
    log('createOrder: OK en', Date.now() - t0, 'ms', result.order?.order_number,
        result.order?._idempotent_hit ? '(idempotent hit)' : '')
    return result.order
  },

  updateStatus: async (id, status) => {
    const { error } = await withTimeout(
      supabase.from('orders').update({ status }).eq('id', id),
      FETCH_TIMEOUT_MS,
      'No se pudo actualizar el estado a tiempo'
    )
    if (error) throw error
  },

  cancelOrder: async (id, reason) => {
    const { error } = await withTimeout(
      supabase.from('orders').update({ status: 'cancelado', cancel_reason: reason || null }).eq('id', id),
      FETCH_TIMEOUT_MS,
      ''
    )
    if (error) throw error
  },

  updateOrder: async (id, patch) => {
    const { error } = await withTimeout(
      supabase.from('orders').update(patch).eq('id', id),
      FETCH_TIMEOUT_MS,
      ''
    )
    if (error) throw error
  },

  softDeleteOrder: async (id, reason, userId) => {
    const { error } = await withTimeout(
      supabase.from('orders').update({
        deleted_from_reports: true,
        deleted_at: new Date().toISOString(),
        deleted_by: userId || null,
        delete_reason: reason || null,
      }).eq('id', id),
      FETCH_TIMEOUT_MS,
      ''
    )
    if (error) throw error
    set((s) => ({
      orders:      s.orders.filter(o => o.id !== id),
      todayOrders: s.todayOrders.filter(o => o.id !== id),
    }))
  },

  restoreOrder: async (id) => {
    const { error } = await withTimeout(
      supabase.from('orders').update({
        deleted_from_reports: false,
        deleted_at: null,
        deleted_by: null,
        delete_reason: null,
      }).eq('id', id),
      FETCH_TIMEOUT_MS,
      ''
    )
    if (error) throw error
    get().fetchToday(true)
  },
}))

// ============================================================
//  Manejo de eventos realtime (fuera del create para mantenerlo legible)
// ============================================================
async function handleOrderChange(payload, set, get) {
  const { eventType, new: newRow, old: oldRow } = payload
  log('rt orders:', eventType, newRow?.id || oldRow?.id)

  // -------- INSERT --------
  if (eventType === 'INSERT') {
    if (newRow.deleted_from_reports) return

    // Anti-duplicación: si ya existe en el store, no insertar dos veces
    // (puede pasar si fetchActive y el INSERT realtime llegan en orden raro).
    const existing = get().orders.find(o => o.id === newRow.id)
    if (existing) {
      log('INSERT ya existía en store, ignoro')
      return
    }

    // Necesitamos el order_items, que el INSERT realtime de orders no trae.
    try {
      const { data } = await supabase
        .from('orders')
        .select('*, order_items(*)')
        .eq('id', newRow.id)
        .single()
      if (!data) return

      // Verificar de nuevo (entre el INSERT y este fetch otro evento pudo haberlo agregado)
      const ordersNow = get().orders
      if (ordersNow.some(o => o.id === data.id)) return

      set((s) => ({ orders: [...s.orders, data] }))
      toast.success(`Nuevo pedido #${data.order_number}`, { icon: '🍗' })
      try {
        const audio = new Audio('/ding.mp3')
        audio.volume = 0.6
        audio.play().catch(() => {})  // navegadores requieren interacción previa
      } catch {}
    } catch (err) {
      warn('refetch INSERT falló:', err)
    }
    get().fetchToday()
    return
  }

  // -------- UPDATE --------
  if (eventType === 'UPDATE') {
    // Anulación
    if (newRow.deleted_from_reports) {
      set((s) => ({
        orders:      s.orders.filter(o => o.id !== newRow.id),
        todayOrders: s.todayOrders.filter(o => o.id !== newRow.id),
      }))
      return
    }

    // Refetch con order_items para tener data consistente
    try {
      const { data } = await supabase
        .from('orders')
        .select('*, order_items(*)')
        .eq('id', newRow.id)
        .single()
      if (!data) return

      const stillActive = ['pendiente', 'en_preparacion', 'listo'].includes(data.status)
      set((s) => {
        const without = s.orders.filter(o => o.id !== data.id)
        return { orders: stillActive ? [...without, data] : without }
      })
    } catch (err) {
      warn('refetch UPDATE falló:', err)
    }
    get().fetchToday()
    return
  }

  // -------- DELETE --------
  if (eventType === 'DELETE') {
    set((s) => ({
      orders:      s.orders.filter(o => o.id !== oldRow.id),
      todayOrders: s.todayOrders.filter(o => o.id !== oldRow.id),
    }))
  }
}

// Si un item cambia (ej. editaron productos), refresca el pedido afectado.
async function handleItemChange(payload, set, get) {
  const { new: newRow, old: oldRow } = payload
  const orderId = newRow?.order_id || oldRow?.order_id
  if (!orderId) return
  log('rt items:', payload.eventType, orderId)
  try {
    const { data } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', orderId)
      .single()
    if (!data) return
    set((s) => {
      const stillActive = ['pendiente', 'en_preparacion', 'listo'].includes(data.status)
      const isAnulled = data.deleted_from_reports === true
      const without = s.orders.filter(o => o.id !== data.id)
      return { orders: (stillActive && !isAnulled) ? [...without, data] : without }
    })
  } catch (err) {
    warn('refetch item falló:', err)
  }
}

// ============================================================
//  Reconexión con backoff exponencial
// ============================================================
function scheduleReconnect(set, get) {
  if (reconnectTimer) return
  set({ realtimeStatus: 'reconnecting' })
  const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempt), RECONNECT_MAX_MS)
  reconnectAttempt += 1
  log(`reconnect en ${delay}ms (intento ${reconnectAttempt})`)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (channel) {
      try { supabase.removeChannel(channel) } catch {}
      channel = null
    }
    get().subscribe()
  }, delay)
}
