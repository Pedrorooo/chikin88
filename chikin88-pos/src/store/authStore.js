import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const useAuthStore = create((set, get) => ({
  session: null,
  user: null,
  profile: null,
  loading: true,

  init: async () => {
    set({ loading: true })
    const { data: { session } } = await supabase.auth.getSession()
    set({ session, user: session?.user || null })
    if (session?.user) {
      await get().loadProfile(session.user.id)
    }
    set({ loading: false })

    supabase.auth.onAuthStateChange(async (_evt, newSession) => {
      set({ session: newSession, user: newSession?.user || null })
      if (newSession?.user) {
        await get().loadProfile(newSession.user.id)
      } else {
        set({ profile: null })
      }
    })
  },

  loadProfile: async (userId) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    if (!error) set({ profile: data })
  },

  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ session: null, user: null, profile: null })
  },

  hasRole: (...roles) => {
    const role = get().profile?.role
    return role && roles.includes(role)
  },

  // ---------- Helpers de rol (con compat para sesiones viejas) ----------
  // Si un cliente tenía sesión activa con rol 'mesero' o 'cocina',
  // la base ya migró el perfil a 'empleado', pero el cliente puede tener
  // datos cacheados. Tratamos los roles antiguos como 'empleado' para
  // que la UI no quede bloqueada hasta el próximo refresh.
  isAdmin: () => get().profile?.role === 'admin',

  isEmployee: () => {
    const r = get().profile?.role
    return r === 'empleado' || r === 'mesero' || r === 'cocina'
  },

  // ¿Puede operar el punto de venta? (admin O empleado)
  canOperate: () => {
    const r = get().profile?.role
    return r === 'admin' || r === 'empleado' || r === 'mesero' || r === 'cocina'
  },
}))
