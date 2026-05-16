// ============================================================
//  apiFetch.js
//
//  Helper central para llamar a endpoints /api/* en Vercel.
//
//  Responsabilidades:
//    • Lee el access_token SÍNCRONO de localStorage (sin tocar
//      el SDK de Supabase para evitar lock zombi).
//    • Agrega header Authorization: Bearer <token>.
//    • AbortController real con timeout configurable.
//    • Parseo de JSON y manejo de errores 401/403/422/500.
//    • Devuelve { data, error } siempre, jamás cuelga.
//
//  Esto es lo que usa el resto del frontend para datos críticos.
//  El cliente Supabase del navegador queda solo para auth y
//  realtime opcional como señal.
// ============================================================

const DEFAULT_TIMEOUT_MS = 12_000

// Leer token de forma síncrona, sin tocar el SDK
export function readAccessTokenSync() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) {
        const raw = localStorage.getItem(k)
        if (!raw) continue
        const parsed = JSON.parse(raw)
        return parsed?.access_token || parsed?.currentSession?.access_token || null
      }
    }
  } catch {}
  return null
}

// ============================================================
//  apiFetch(path, options, timeoutMs?)
//
//  - path: '/api/orders-active' (relativo)
//  - options: { method, body, signal? }
//  - timeoutMs: timeout duro (default 12s)
//
//  Returns: { data, error, status }
//    data: payload JSON si OK
//    error: string user-friendly si falló (o null)
//    status: HTTP status code (o 0 si abortó)
// ============================================================
export async function apiFetch(path, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const token = readAccessTokenSync()
  if (!token) {
    return { data: null, error: 'Sesión expirada. Vuelve a iniciar sesión.', status: 401 }
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { data: null, error: 'Sin conexión a internet.', status: 0 }
  }

  // AbortController propio + permitir cancelación externa
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)

  // Si el caller pasó su propia signal, propagamos cancel
  if (options.signal) {
    options.signal.addEventListener('abort', () => ctrl.abort())
  }

  const headers = {
    'Authorization': `Bearer ${token}`,
    ...(options.headers || {}),
  }
  // Solo agregar Content-Type si hay body JSON
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(options.body)
  } else if (options.body && typeof options.body !== 'string') {
    options.body = JSON.stringify(options.body)
    headers['Content-Type'] = 'application/json'
  }

  let response
  try {
    response = await fetch(path, {
      method: options.method || 'GET',
      headers,
      body: options.body,
      signal: ctrl.signal,
      // Forzar petición fresca al servidor en cada llamada.
      // Crítico para POS: jamás queremos servir un 304/cache de
      // pedidos, estados o reportes.
      cache: 'no-store',
    })
  } catch (err) {
    clearTimeout(timer)
    if (err?.name === 'AbortError') {
      return {
        data: null,
        error: `La consulta tardó más de ${Math.round(timeoutMs / 1000)}s. Reintenta.`,
        status: 0,
      }
    }
    return { data: null, error: 'Sin conexión con el servidor.', status: 0 }
  }
  clearTimeout(timer)

  let body
  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (!response.ok) {
    // Mensajes específicos para cada status
    let errMsg = body?.error || `Error del servidor (${response.status})`
    if (response.status === 401) errMsg = body?.error || 'Sesión expirada. Vuelve a iniciar sesión.'
    if (response.status === 403) errMsg = body?.error || 'No tienes permisos para esta acción.'
    return { data: null, error: errMsg, status: response.status }
  }

  // Convención: endpoints devuelven { success, data, ...campos } o { success, ...campos }
  if (body && body.success === false) {
    return { data: null, error: body.error || 'Error desconocido', status: response.status }
  }

  return { data: body, error: null, status: response.status }
}
