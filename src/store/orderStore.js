import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { parseBenefitError } from '../lib/utils'

// Canal de realtime — referencia a nivel de módulo para evitar duplicados
let channel = null
let lastTodayRefresh = 0

export const useOrderStore = create((set, get) => ({
  orders: [],         // pedidos activos
  todayOrders: [],    // pedidos del día (excluye anulados)
  loading: false,
  ready: false,

  // ---------- Carga inicial ----------
  fetchActive: async () => {
    set({ loading: true })
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .in('status', ['pendiente', 'en_preparacion', 'listo'])
      .eq('deleted_from_reports', false)
      .order('created_at', { ascending: true })
      .limit(200)

    if (error) {
      console.error('fetchActive:', error)
      toast.error('Error al cargar pedidos')
    } else {
      set({ orders: data || [] })
    }
    set({ loading: false, ready: true })
  },

  // Pedidos del día (visible en lista "Todos del día"). Excluye anulados.
  fetchToday: async () => {
    // Throttle: máximo una llamada cada 2s
    const now = Date.now()
    if (now - lastTodayRefresh < 2000) return
    lastTodayRefresh = now

    const start = new Date(); start.setHours(0, 0, 0, 0)
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .gte('created_at', start.toISOString())
      .eq('deleted_from_reports', false)
      .order('created_at', { ascending: false })
      .limit(500)

    if (!error) set({ todayOrders: data || [] })
  },

  // ---------- Realtime ----------
  subscribe: () => {
    if (channel) return  // ya hay un canal activo
    channel = supabase
      .channel('orders-realtime')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        async (payload) => {
          const { eventType, new: newRow, old: oldRow } = payload

          if (eventType === 'INSERT') {
            // Si nace anulado (no debería) lo ignoramos
            if (newRow.deleted_from_reports) return
            const { data } = await supabase
              .from('orders')
              .select('*, order_items(*)')
              .eq('id', newRow.id)
              .single()
            if (data) {
              set((s) => ({ orders: [...s.orders, data] }))
              toast.success(`Nuevo pedido #${data.order_number}`, { icon: '🍗' })
              try { new Audio('/ding.mp3').play().catch(() => {}) } catch {}
            }
          }

          if (eventType === 'UPDATE') {
            // Si fue anulado por admin, quitarlo de las listas
            if (newRow.deleted_from_reports) {
              set((s) => ({
                orders: s.orders.filter(o => o.id !== newRow.id),
                todayOrders: s.todayOrders.filter(o => o.id !== newRow.id),
              }))
              return
            }
            const { data } = await supabase
              .from('orders')
              .select('*, order_items(*)')
              .eq('id', newRow.id)
              .single()
            if (!data) return
            set((s) => {
              const stillActive = ['pendiente', 'en_preparacion', 'listo'].includes(data.status)
              const without = s.orders.filter(o => o.id !== data.id)
              return { orders: stillActive ? [...without, data] : without }
            })
          }

          if (eventType === 'DELETE') {
            set((s) => ({ orders: s.orders.filter(o => o.id !== oldRow.id) }))
          }

          // Refrescamos también la lista del día (con throttle)
          get().fetchToday()
        }
      )
      .subscribe()
  },

  unsubscribe: () => {
    if (channel) {
      supabase.removeChannel(channel)
      channel = null
    }
  },

  // ---------- CRUD ----------
  // Crea un pedido con sus items. Si trae beneficio de empleado,
  // el trigger en la BD valida y registra el uso atómicamente.
  createOrder: async (orderData, items) => {
    const subtotal = orderData.subtotal ?? items.reduce(
      (s, it) => s + (it.subtotal ?? it.unit_price * it.quantity), 0
    )
    const total = orderData.total ?? (subtotal + (orderData.is_delivery ? Number(orderData.delivery_fee || 0) : 0))

    const { data: order, error } = await supabase
      .from('orders')
      .insert([{ ...orderData, subtotal, total }])
      .select()
      .single()

    if (error) {
      // Errores específicos del trigger de beneficios
      const friendly = parseBenefitError(error.message || error.details || '')
      throw new Error(friendly)
    }

    const itemsToInsert = items.map(it => ({
      order_id: order.id,
      product_id: it.product_id || null,
      product_name: it.product_name,
      product_category: it.product_category,
      unit_price: it.unit_price,
      quantity: it.quantity,
      sauces: it.sauces || [],
      sauce_mode: it.sauce_mode || 'normal',
      ramen_type: it.ramen_type || null,
      subtotal: it.subtotal ?? (it.unit_price * it.quantity),
    }))

    const { error: errItems } = await supabase.from('order_items').insert(itemsToInsert)
    if (errItems) {
      console.error('order_items insert error:', errItems)
      // El pedido ya existe; el rollback automático del beneficio no aplica.
      // Intentamos borrar el pedido huérfano si fue creado.
      await supabase.from('orders').delete().eq('id', order.id)
      throw new Error('No se pudieron guardar los productos del pedido')
    }

    return order
  },

  updateStatus: async (id, status) => {
    const { error } = await supabase
      .from('orders')
      .update({ status })
      .eq('id', id)
    if (error) throw error
  },

  cancelOrder: async (id, reason) => {
    const { error } = await supabase
      .from('orders')
      .update({ status: 'cancelado', cancel_reason: reason || null })
      .eq('id', id)
    if (error) throw error
  },

  updateOrder: async (id, patch) => {
    const { error } = await supabase
      .from('orders')
      .update(patch)
      .eq('id', id)
    if (error) throw error
  },

  // Anular pedido para reportes (soft delete).
  // El pedido queda en la base, pero deja de sumar en ventas/reportes.
  // Solo admin puede hacerlo (protegido por RLS).
  softDeleteOrder: async (id, reason, userId) => {
    const { error } = await supabase
      .from('orders')
      .update({
        deleted_from_reports: true,
        deleted_at: new Date().toISOString(),
        deleted_by: userId || null,
        delete_reason: reason || null,
      })
      .eq('id', id)
    if (error) throw error
    set((s) => ({
      orders:      s.orders.filter(o => o.id !== id),
      todayOrders: s.todayOrders.filter(o => o.id !== id),
    }))
  },

  // Revertir anulación (sólo admin)
  restoreOrder: async (id) => {
    const { error } = await supabase
      .from('orders')
      .update({
        deleted_from_reports: false,
        deleted_at: null,
        deleted_by: null,
        delete_reason: null,
      })
      .eq('id', id)
    if (error) throw error
    // El realtime se encarga de recargarlo en las listas
    get().fetchToday()
  },
}))
