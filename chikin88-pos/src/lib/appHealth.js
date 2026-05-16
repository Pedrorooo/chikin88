// ============================================================
//  appHealth.js — Salud preventiva del sistema (estilo POS)
//
//  PROBLEMA QUE RESUELVE:
//  ----------------------
//  En supabase-js v2, `auth.getSession()` y `auth.refreshSession()`
//  comparten un lock interno (NavigatorLock o fallback Promise).
//  Si el auto-refresh del SDK arrancó en background y su fetch
//  se quedó colgado (típico tras pasar mucho tiempo con la tab
//  oculta/idle), el lock queda tomado de por vida. CUALQUIER
//  llamada futura a getSession/refreshSession se cuelga hasta
//  que se recargue la página.
//
//  SOLUCIÓN:
//  ---------
//  • Apagamos autoRefreshToken del SDK (ver lib/supabase.js).
//  • Leemos la sesión DIRECTAMENTE de localStorage para chequeos
//    rápidos, sin tocar el lock.
//  • Llamamos refreshSession() solo cuando hace falta, con timeout
//    duro real y AbortController donde sea posible.
//  • Heartbeat cada 60 s mientras la tab es visible, además de
//    visibilitychange/focus/online/pageshow.
//  • warmUpSystem() corre antes de operaciones críticas y al volver
//    de idle. Es coalesced: si lo llaman 5 veces a la vez, hay 1
//    sola operación real en vuelo.
// ============================================================
import { supabase } from './supabase'
import { useHealthStore } from '../store/healthStore'

const isDev = import.meta.env?.DEV === true
const log = (...args) => { if (isDev) console.log('[health]', ...args) }

// ----- Constantes ------------------------------------------------------------
const STEP_TIMEOUT_MS         = 4_000               // timeout duro por paso
const SESSION_REFRESH_MARGIN  = 5 * 60 * 1000       // refrescamos si quedan <5min
const HEARTBEAT_MS            = 60 * 1000           // 1 min mientras visible
const STALE_MS                = 2 * 60 * 1000       // >2 min sin éxito = stale

// ----- Estado a nivel módulo ------------------------------------------------
let lastSuccessAt   = Date.now()
let lastActivityAt  = Date.now()
let inFlightWarmup  = null    // coalescing
let heartbeatTimer  = null

// ============================================================
//  Helpers públicos
// ============================================================
export function markActivity()    { lastActivityAt = Date.now() }
export function markSuccess()     {
  lastSuccessAt = Date.now()
  lastActivityAt = Date.now()
  useHealthStore.getState().setStatus('ready')
}
export function isStale()           { return Date.now() - lastSuccessAt > STALE_MS }
export function timeSinceLastSuccess() { return Date.now() - lastSuccessAt }

// withTimeout robusto que limpia el timer pase lo que pase
export function withTimeout(promise, ms, errorMessage) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(errorMessage || `Tiempo de espera (${ms}ms)`)),
      ms
    )
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// ============================================================
//  supabaseWithTimeout — el helper que usa el resto de la app
// ============================================================
//
//  Envuelve cualquier query/RPC de supabase-js con AbortController
//  REAL (cancela el fetch nativo) + timeout duro. Más robusto que
//  withTimeout solo, porque también cancela la petición HTTP.
//
//  Uso:
//    const { data, error } = await supabaseWithTimeout(
//      supabase.from('orders').select('*').eq(...),
//      10_000,
//      'Tiempo agotado cargando pedidos'
//    )
//
//  IMPORTANTE: pasar el query BUILDER, no `await`. Esto permite
//  encadenar .abortSignal() antes de ejecutarse.
// ============================================================
export function supabaseWithTimeout(queryBuilder, ms = 10_000, errorMessage) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)

  // Si el builder soporta abortSignal (cualquier query/rpc), lo aplicamos.
  // Si no lo soporta (raro), igual cae el timeout por Promise.race.
  const promise = typeof queryBuilder.abortSignal === 'function'
    ? queryBuilder.abortSignal(ctrl.signal)
    : queryBuilder

  return Promise.race([
    promise,
    new Promise((_, reject) => {
      // Si el timer dispara, abortamos Y rechazamos
      // (Promise.race ya estará "ganada" por el reject)
    }),
    new Promise((_, reject) => {
      setTimeout(() => {
        ctrl.abort()
        reject(new Error(errorMessage || `Tiempo de espera (${ms}ms)`))
      }, ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

// ============================================================
//  Lectura DIRECTA de localStorage — sin tocar el lock de auth
// ============================================================
function readStoredSession() {
  try {
    // Supabase guarda la sesión en una key tipo "sb-<projectRef>-auth-token"
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) {
        const raw = localStorage.getItem(k)
        if (!raw) continue
        const parsed = JSON.parse(raw)
        // Estructura: { access_token, refresh_token, expires_at, ... }
        // Antiguas versiones lo envolvían en { currentSession: {...} }
        return parsed?.currentSession || parsed
      }
    }
  } catch (e) {
    log('readStoredSession parse error:', e?.message)
  }
  return null
}

function sessionExpiresInMs(session) {
  if (!session?.expires_at) return Infinity
  return session.expires_at * 1000 - Date.now()
}

// ============================================================
//  warmUpSystem — la pieza central
// ============================================================
//
//  Verifica y prepara la app para la próxima operación crítica.
//  Llamar:
//    • al volver de visibilitychange/focus/pageshow/online
//    • desde el heartbeat (cada 60 s visible)
//    • antes de crear pedido (defensa en profundidad)
//
//  Pasos:
//    1. Está online?
//    2. Hay sesión válida en storage?
//    3. Está por expirar (<5min)? → refreshSession con timeout
//    4. Ping a Supabase (select id from products limit 1)
//
//  Coalescing: si dos llamadas llegan a la vez, comparten promesa.
//  Nunca cuelga: cada paso tiene timeout duro propio.
// ============================================================
export async function warmUpSystem() {
  if (inFlightWarmup) return inFlightWarmup
  inFlightWarmup = doWarmUp().finally(() => { inFlightWarmup = null })
  return inFlightWarmup
}

async function doWarmUp() {
  const health = useHealthStore.getState()
  health.setStatus(health.status === 'ready' ? 'warming_up' : (health.status || 'warming_up'))
  log('warmup start, stale?', isStale(), 'ms desde último éxito:', timeSinceLastSuccess())

  // ----- 1. Online -----
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    log('warmup: offline')
    health.setStatus('offline')
    throw new Error('Sin conexión a internet. Verifica el wifi.')
  }

  // ----- 2. Sesión almacenada -----
  const stored = readStoredSession()
  if (!stored?.access_token) {
    log('warmup: no hay sesión almacenada')
    health.setStatus('auth_expired')
    throw new Error('Sesión expirada. Vuelve a iniciar sesión.')
  }

  // ----- 3. Refrescar si está por expirar -----
  const msLeft = sessionExpiresInMs(stored)
  if (msLeft < SESSION_REFRESH_MARGIN) {
    log('warmup: refrescando sesión (quedan', Math.round(msLeft / 1000), 's)')
    try {
      const res = await withTimeout(
        supabase.auth.refreshSession({ refresh_token: stored.refresh_token }),
        STEP_TIMEOUT_MS * 2,  // 8s para refresh
        'No se pudo refrescar la sesión.'
      )
      if (res?.error) throw res.error
      if (!res?.data?.session) throw new Error('Sesión expirada.')
      log('warmup: sesión refrescada OK')
    } catch (err) {
      log('warmup: refresh falló', err?.message)
      health.setStatus('auth_expired')
      throw new Error('Sesión expirada o inactiva. Vuelve a iniciar sesión.')
    }
  }

  // ----- 4. Ping liviano -----
  // Usa AbortController real para cancelar el fetch si tarda.
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), STEP_TIMEOUT_MS)
    try {
      const { error } = await supabase
        .from('products')
        .select('id')
        .limit(1)
        .abortSignal(ctrl.signal)
      if (error) throw error
    } finally { clearTimeout(t) }
  } catch (err) {
    log('warmup: ping falló', err?.message)
    health.setStatus('degraded')
    throw new Error('La conexión está lenta o inestable. Intenta de nuevo.')
  }

  markSuccess()
  log('warmup OK')
}

// ============================================================
//  Heartbeat — cada 60 s mientras la tab está visible
// ============================================================
export function startHeartbeat() {
  stopHeartbeat()
  log('heartbeat: iniciado')
  heartbeatTimer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    log('heartbeat: tick visible')
    warmUpSystem().catch(() => {
      // Silencioso: si falla, el próximo intento o el próximo evento
      // de visibilidad volverán a intentarlo. La UI ya refleja el estado.
    })
  }, HEARTBEAT_MS)
}

export function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
    log('heartbeat: detenido')
  }
}

// ============================================================
//  installVisibilityHandlers
//  Instala listeners de visibilidad/focus/online/pageshow.
//  onWake se llama tras detectar despertar de idle.
//  Devuelve cleanup.
// ============================================================
export function installVisibilityHandlers({ onWake } = {}) {
  const triggerWake = (reason) => {
    log('wake event:', reason)
    markActivity()
    // Siempre intentamos warmup al volver. Es barato y cae rápido si todo OK.
    warmUpSystem()
      .then(() => onWake && onWake())
      .catch((err) => log('wake warmup falló:', err?.message))
  }

  const onVisibility = () => {
    if (document.visibilityState === 'visible') triggerWake('visibilitychange')
  }
  const onFocus     = () => triggerWake('focus')
  const onPageShow  = (e) => { if (e.persisted) triggerWake('pageshow-bfcache') }
  const onOnline    = () => triggerWake('online')
  const onOffline   = () => {
    log('offline')
    useHealthStore.getState().setStatus('offline')
  }

  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('focus', onFocus)
  window.addEventListener('pageshow', onPageShow)
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)

  return () => {
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('pageshow', onPageShow)
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
  }
}

// ============================================================
//  ensureSystemReady — wrapper conveniente antes de operación crítica
// ============================================================
//
//  Si el sistema ya está ready y no stale, retorna inmediatamente.
//  Si no, hace warmup. Tira excepción con mensaje claro si no puede.
// ============================================================
export async function ensureSystemReady() {
  const health = useHealthStore.getState()
  if (health.status === 'ready' && !isStale()) {
    log('ensureSystemReady: ya listo')
    return
  }
  log('ensureSystemReady: warming up')
  await warmUpSystem()
}
