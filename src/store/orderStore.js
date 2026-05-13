import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/apiFetch'
import { useHealthStore } from './healthStore'
import { markSuccess } from '../lib/appHealth'

// ============================================================
//  orderStore — fuente de verdad para pedidos
//
//  ARQUITECTURA NUEVA:
//    • TODAS las lecturas/escrituras pasan por /api/* (Vercel).
//    • supabase del navegador queda SOLO para:
//        - escuchar realtime como "señal" (notifica que algo cambió,
//          y entonces nosotros refrescamos vía API)
//        - login/auth
//    • Si el cliente del navegador queda stale, no importa: el API
//      tiene conexión fresca en cada llamada.
//
//  POLLING GLOBAL:
//    • Cada 5s si Cocina/Pedidos visibles
//    • Cada 30s si tab visible pero no en esas pantallas
//    • No corre con tab oculta
// ============================================================

const isDev = import.meta.env?.DEV === true
const log = (...args) => { if (isDev) console.log('[orderStore]', ...args) }
const warn = (...args) => { if (isDev) console.warn('[orderStore]', ...args) }

const CHANNEL_NAME = 'chikin88-orders-realtime'
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS  = 30_000

const FETCH_TIMEOUT_MS = 12_000

// Estado a nivel módulo (no reactivo)
let channel = null
let reconnectAttempt = 0
let reconnectTimer = null
let pollTimer = null
let lastPollAt = 0
let lastTodayRefresh = 0
const TODAY_THROTTLE_MS = 2_000

export const useOrderStore = create((set, get) => ({
  orders: [],          // pedidos activos
  todayOrders: [],     // pedidos del día
  loading: false,
  ready: false,
  realtimeStatus: 'idle',
  lastSyncAt: null,

  // ============================================================
  //  Lecturas — todas vía API serverless
  // ============================================================
  fetchActive: async () => {
    set({ loading: true })
    const { data, error } = await apiFetch('/api/orders-active', {}, FETCH_TIMEOUT_MS)
    if (error) {
      warn('fetchActive:', error)
      set({ loading: false, ready: true })
      return
    }
    set({ orders: data?.orders || [], lastSyncAt: Date.now(), loading: false, ready: true })
    markSuccess()
    log('fetchActive OK', data?.orders?.length)
  },

  fetchToday: async (force = false) => {
    const now = Date.now()
    if (!force && now - lastTodayRefresh < TODAY_THROTTLE_MS) return
    lastTodayRefresh = now

    const { data, error } = await apiFetch('/api/orders-today', {}, FETCH_TIMEOUT_MS)
    if (error) {
      warn('fetchToday:', error)
      return
    }
    set({ todayOrders: data?.orders || [], lastSyncAt: Date.now() })
    markSuccess()
  },

  manualRefresh: async () => {
    log('manualRefresh')
    await Promise.all([get().fetchActive(), get().fetchToday(true)])
  },

  // ============================================================
  //  Escrituras — todas vía API serverless
  // ============================================================
  createOrder: async (orderData, items) => {
    // POST /api/create-order con AbortController duro
    const ctrl = new AbortController()
    const abortTimer = setTimeout(() => ctrl.abort(), 10_000)

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

    const { data, error } = await apiFetch(
      '/api/create-order',
      { method: 'POST', body: payload, signal: ctrl.signal },
      10_000
    )
    clearTimeout(abortTimer)

    if (error) throw new Error(error)
    if (!data?.order) throw new Error('El servidor no devolvió el pedido.')

    markSuccess()
    log('createOrder OK', data.order.order_number)

    // Insertar en estado local inmediatamente (no esperar a refetch)
    const newOrder = data.order
    if (Array.isArray(newOrder.order_items) || newOrder.id) {
      set((s) => {
        const isActive = ['pendiente', 'en_preparacion', 'listo'].includes(newOrder.status)
        const without = s.orders.filter(o => o.id !== newOrder.id)
        return {
          orders: isActive ? [...without, newOrder] : without,
          todayOrders: [newOrder, ...s.todayOrders.filter(o => o.id !== newOrder.id)],
        }
      })
    }

    // Refresh en background sin await
    setTimeout(() => {
      get().fetchActive().catch(() => {})
      get().fetchToday(true).catch(() => {})
    }, 0)

    return newOrder
  },

  updateStatus: async (id, status) => {
    const body = { id, status }
    const { error } = await apiFetch(
      '/api/order-status',
      { method: 'PATCH', body },
      FETCH_TIMEOUT_MS
    )
    if (error) throw new Error(error)
    // Refresh en background
    setTimeout(() => {
      get().fetchActive().catch(() => {})
      get().fetchToday(true).catch(() => {})
    }, 0)
  },

  cancelOrder: async (id, reason) => {
    const { error } = await apiFetch(
      '/api/order-status',
      { method: 'PATCH', body: { id, status: 'cancelado', cancel_reason: reason || null } },
      FETCH_TIMEOUT_MS
    )
    if (error) throw new Error(error)
    setTimeout(() => {
      get().fetchActive().catch(() => {})
      get().fetchToday(true).catch(() => {})
    }, 0)
  },

  updateOrder: async (id, patch) => {
    const { error } = await apiFetch(
      '/api/order-edit',
      { method: 'PATCH', body: { id, patch } },
      FETCH_TIMEOUT_MS
    )
    if (error) throw new Error(error)
    setTimeout(() => {
      get().fetchActive().catch(() => {})
      get().fetchToday(true).catch(() => {})
    }, 0)
  },

  softDeleteOrder: async (id, reason) => {
    const { error } = await apiFetch(
      '/api/order-soft-delete',
      { method: 'PATCH', body: { id, reason: reason || null } },
      FETCH_TIMEOUT_MS
    )
    if (error) throw new Error(error)
    // Quitar de listas inmediato
    set((s) => ({
      orders:      s.orders.filter(o => o.id !== id),
      todayOrders: s.todayOrders.filter(o => o.id !== id),
    }))
  },

  restoreOrder: async (id) => {
    const { error } = await apiFetch(
      '/api/order-restore',
      { method: 'PATCH', body: { id } },
      FETCH_TIMEOUT_MS
    )
    if (error) throw new Error(error)
    setTimeout(() => {
      get().fetchActive().catch(() => {})
      get().fetchToday(true).catch(() => {})
    }, 0)
  },

  // ============================================================
  //  Realtime — usado solo como SEÑAL.
  //  Cuando llega un evento, refrescamos vía API serverless.
  //  Si el realtime muere, el polling toma el relevo.
  // ============================================================
  subscribe: () => {
    const status = get().realtimeStatus
    if (channel && (status === 'connected' || status === 'connecting')) {
      log('subscribe: skip, ya en', status)
      return
    }
    if (channel) {
      try { supabase.removeChannel(channel) } catch {}
      channel = null
    }

    set({ realtimeStatus: 'connecting' })
    useHealthStore.getState().setRealtimeStatus('connecting')
    log('subscribe: creando canal', CHANNEL_NAME)

    channel = supabase
      .channel(CHANNEL_NAME)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload) => {
          log('rt orders event:', payload.eventType)
          // SEÑAL: cualquier cambio dispara refresh vía API
          get().fetchActive().catch(() => {})
          get().fetchToday().catch(() => {})
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_items' },
        (payload) => {
          log('rt items event:', payload.eventType)
          get().fetchActive().catch(() => {})
          get().fetchToday().catch(() => {})
        }
      )
      .subscribe((subStatus, err) => {
        log('realtime status:', subStatus, err || '')
        const health = useHealthStore.getState()
        if (subStatus === 'SUBSCRIBED') {
          reconnectAttempt = 0
          set({ realtimeStatus: 'connected' })
          health.setRealtimeStatus('connected')
          // Al (re)conectar, refrescamos
          get().fetchActive().catch(() => {})
          get().fetchToday(true).catch(() => {})
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
  //  Polling global de respaldo
  //  Usa /api/* (no Supabase directo). Si el realtime muere,
  //  el polling sigue trayendo datos.
  // ============================================================
  startGlobalPolling: () => {
    if (pollTimer) return
    log('global polling: start')
    pollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      const rt = get().realtimeStatus
      const inKitchenOrOrders = typeof location !== 'undefined' &&
        (location.pathname.startsWith('/cocina') || location.pathname.startsWith('/pedidos'))

      // Cadencia:
      //  - Cocina/Pedidos visible + realtime caído: 5s
      //  - Cocina/Pedidos visible + realtime OK:    15s
      //  - Otras páginas + realtime OK:             60s
      //  - Otras páginas + realtime caído:          20s
      let desired
      if (inKitchenOrOrders) {
        desired = rt === 'connected' ? 15_000 : 5_000
      } else {
        desired = rt === 'connected' ? 60_000 : 20_000
      }

      if (Date.now() - lastPollAt < desired) return
      lastPollAt = Date.now()

      get().fetchActive().catch(() => {})
      get().fetchToday(true).catch(() => {})
    }, 2_500)  // chequea cada 2.5s, decide internamente
  },

  stopGlobalPolling: () => {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
      log('global polling: stop')
    }
  },

  // Compat con Kitchen.jsx (los métodos viejos delegan al polling global)
  startKitchenPolling: () => get().startGlobalPolling(),
  stopKitchenPolling:  () => { /* el polling sigue global */ },
}))

// ============================================================
//  Reconexión exponencial del canal de realtime
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
