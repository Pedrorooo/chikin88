import { createClient } from '@supabase/supabase-js'

const url  = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anon) {
  console.error(
    '[Chikin88] Faltan variables VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. ' +
    'Crea un archivo .env con esos valores (ver .env.example).'
  )
}

export const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    // ⚠️ AUTO-REFRESH MANUAL.
    // El auto-refresh interno del SDK corre con setInterval, que Chrome
    // estrangula en tabs en background. Cuando el timer eventualmente
    // dispara, el fetch interno puede colgarse y dejar el lock de auth
    // tomado para siempre — eso bloquea getSession() y refreshSession()
    // en cualquier futura llamada. Apagándolo, nosotros controlamos el
    // refresh desde appHealth con warmup proactivo, heartbeat visible y
    // AbortController real.
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
    // El websocket de realtime tiene su propio reconnect interno, pero
    // también lo respaldamos con polling ligero desde Kitchen.
    timeout: 30_000,
  },
})
