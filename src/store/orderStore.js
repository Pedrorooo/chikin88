import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

let channel = null

export const useOrderStore = create((set, get) => ({
  orders: [],         // pedidos activos (no entregados ni cancelados de hace mucho)
  todayOrders: [],    // todos los pedidos del día
  loading: false,
  ready: false,

  // ---------- Carga inicial ----------
  fetchActive: async () => {
    set({ loading: true })
    // Pedidos activos: pendiente, en_preparacion, listo. También los del día completos para dashboard.
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .in('status', ['pendiente','en_preparacion','listo'])
      .order('created_at', { ascending: true })

    if (error) {
      toast.error('Error al cargar pedidos')
      console.error(error)
    } else {
      set({ orders: data || [] })
    }
    set({ loading: false, ready: true })
  },

  fetchToday: async () => {
    const start = new Date(); start.setHours(0,0,0,0)
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .gte('created_at', start.toISOString())
      .order('created_at', { ascending: false })
    if (!error) set({ todayOrders: data || [] })
  },

  // ---------- Realtime ----------
  subscribe: () => {
    if (channel) return
    channel = supabase
      .channel('orders-realtime')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        async (payload) => {
          const { eventType, new: newRow, old: oldRow } = payload

          if (eventType === 'INSERT') {
            // Cargamos el pedido completo con items
            const { data } = await supabase
              .from('orders')
              .select('*, order_items(*)')
              .eq('id', newRow.id)
              .single()
            if (data) {
              set((s) => ({ orders: [...s.orders, data] }))
              toast.success(`Nuevo pedido #${data.order_number}`, { icon: '🍗' })
              try { new Audio('/ding.mp3').play().catch(()=>{}) } catch {}
            }
          }

          if (eventType === 'UPDATE') {
            // Actualizamos el pedido en la lista. Si ya no está activo, lo quitamos.
            const { data } = await supabase
              .from('orders')
              .select('*, order_items(*)')
              .eq('id', newRow.id)
              .single()
            if (!data) return
            set((s) => {
              const stillActive = ['pendiente','en_preparacion','listo'].includes(data.status)
              const without = s.orders.filter(o => o.id !== data.id)
              return { orders: stillActive ? [...without, data] : without }
            })
          }

          if (eventType === 'DELETE') {
            set((s) => ({ orders: s.orders.filter(o => o.id !== oldRow.id) }))
          }

          // Refrescamos también la lista del día (para dashboard)
          get().fetchToday()
        }
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'order_items' },
        () => { get().fetchToday() }
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
  createOrder: async (orderData, items) => {
    // Si la UI ya envió subtotal y total (incluyendo salsas extra y palillos), los respetamos.
    // Si no, calculamos un fallback simple para no romper compatibilidad.
    const subtotal = orderData.subtotal ?? items.reduce((s, it) => s + (it.subtotal ?? it.unit_price * it.quantity), 0)
    const total = orderData.total ?? (subtotal + (orderData.is_delivery ? Number(orderData.delivery_fee || 0) : 0))

    const { data: order, error } = await supabase
      .from('orders')
      .insert([{ ...orderData, subtotal, total }])
      .select()
      .single()

    if (error) throw error

    const itemsToInsert = items.map(it => ({
      order_id: order.id,
      product_id: it.product_id || null,
      product_name: it.product_name,
      product_category: it.product_category,
      unit_price: it.unit_price,
      quantity: it.quantity,
      sauces: it.sauces || [],
      subtotal: it.subtotal ?? (it.unit_price * it.quantity),
    }))

    const { error: errItems } = await supabase.from('order_items').insert(itemsToInsert)
    if (errItems) throw errItems

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

  // Borra un pedido permanentemente (solo admin por RLS).
  // Los order_items se eliminan automáticamente por FK on delete cascade.
  deleteOrder: async (id) => {
    const { error } = await supabase
      .from('orders')
      .delete()
      .eq('id', id)
    if (error) throw error
    // Limpiamos las listas locales por si el realtime tarda
    set((s) => ({
      orders:      s.orders.filter(o => o.id !== id),
      todayOrders: s.todayOrders.filter(o => o.id !== id),
    }))
  },
}))
