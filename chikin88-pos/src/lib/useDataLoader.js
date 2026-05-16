import { useState, useEffect, useRef, useCallback } from 'react'

// ============================================================
//  useDataLoader — el hook estándar para cargar datos en pantallas
//
//  Garantías:
//    • NUNCA queda en loading infinito (timeout duro).
//    • Si hay datos viejos, se muestran mientras refresca
//      (stale-while-revalidate). No flashea pantalla blanca.
//    • Manejo de error con botón "Reintentar".
//    • Cancela peticiones obsoletas si el usuario cambia el rango.
//    • Refresh manual (botón Actualizar).
//    • Re-fetch automático al volver de visibilitychange (opcional).
//
//  Uso:
//    const { data, loading, error, refresh, ready } = useDataLoader(
//      async ({ signal }) => {
//        const { data, error } = await supabase.from('orders')...
//          .abortSignal(signal)
//        if (error) throw error
//        return data
//      },
//      [deps],          // dependencias que disparan recarga
//      { timeoutMs: 12000, refetchOnFocus: true }
//    )
// ============================================================

const DEFAULT_TIMEOUT_MS = 12_000

export function useDataLoader(loader, deps = [], opts = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    refetchOnFocus = false,
    timeoutMessage = 'La consulta tardó demasiado. Intenta de nuevo.',
  } = opts

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Para cancelar fetches obsoletos
  const inFlightRef = useRef(null)

  const refresh = useCallback(() => {
    setRefreshKey(k => k + 1)
  }, [])

  // Ejecuta el loader con timeout y AbortController
  useEffect(() => {
    let cancelled = false
    const ctrl = new AbortController()

    // Si había un fetch anterior en vuelo, lo cancelamos
    if (inFlightRef.current) {
      try { inFlightRef.current.abort() } catch {}
    }
    inFlightRef.current = ctrl

    setLoading(true)
    setError(null)

    // Timeout duro: si el loader no termina, abortamos y mostramos error.
    const timeoutId = setTimeout(() => {
      ctrl.abort()
    }, timeoutMs)

    Promise.race([
      loader({ signal: ctrl.signal }),
      new Promise((_, reject) => {
        // Si el AbortController dispara, traducimos a error legible
        ctrl.signal.addEventListener('abort', () => {
          reject(new Error(timeoutMessage))
        })
      }),
    ])
      .then(result => {
        if (cancelled) return
        setData(result)
        setReady(true)
      })
      .catch(err => {
        if (cancelled) return
        // Errores de AbortError silenciosos si fue cancelado por nuevo fetch
        if (err?.name === 'AbortError' && !ctrl.signal.aborted) return
        console.error('[useDataLoader] error:', err?.message || err)
        setError(err?.message || 'Error al cargar datos')
      })
      .finally(() => {
        clearTimeout(timeoutId)
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
      try { ctrl.abort() } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, refreshKey])

  // Refetch al volver visible
  useEffect(() => {
    if (!refetchOnFocus) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refetchOnFocus, refresh])

  return { data, loading, ready, error, refresh, setData }
}
