import { create } from 'zustand'

// ============================================================
//  healthStore — estado global de salud del sistema
//
//  Estados:
//    'ready'         — todo bien, listo para crear pedidos
//    'warming_up'    — calentando conexión (al iniciar o tras idle)
//    'degraded'      — Supabase responde lento o algún paso falló
//    'offline'       — sin internet
//    'auth_expired'  — sesión expirada
//    'reconnecting'  — realtime perdido, intentando reconectar
//
//  Lo consume:
//    • SystemReadyBadge (indicador discreto en el header)
//    • NewOrder (deshabilita "Enviar" si no está ready)
//    • Kitchen (badge de "en vivo" / "reconectando")
// ============================================================

export const useHealthStore = create((set, get) => ({
  // estado principal
  status: 'warming_up',
  lastChangeAt: Date.now(),

  // realtime aparte para cocina
  realtimeStatus: 'idle',  // 'idle'|'connecting'|'connected'|'reconnecting'|'disconnected'

  setStatus: (status) => {
    if (get().status === status) return
    set({ status, lastChangeAt: Date.now() })
  },

  setRealtimeStatus: (rt) => {
    if (get().realtimeStatus === rt) return
    set({ realtimeStatus: rt })
    // Si el realtime se cae, el sistema sigue "ready" para crear pedidos,
    // pero la badge de cocina lo refleja aparte.
  },
}))
