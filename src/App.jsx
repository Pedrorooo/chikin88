import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import { useOrderStore } from './store/orderStore'
import {
  installVisibilityHandlers, warmUpSystem, markActivity,
  startHeartbeat, stopHeartbeat,
} from './lib/appHealth'

import Layout from './components/layout/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import Orders from './pages/Orders'
import NewOrder from './pages/NewOrder'
import Kitchen from './pages/Kitchen'
import Dashboard from './pages/Dashboard'
import Expenses from './pages/Expenses'
import Reports from './pages/Reports'
import AnulledOrders from './pages/AnulledOrders'

export default function App() {
  const { init, loading, session } = useAuthStore()
  const subscribe = useOrderStore(s => s.subscribe)
  const unsubscribe = useOrderStore(s => s.unsubscribe)
  const fetchActive = useOrderStore(s => s.fetchActive)
  const fetchToday = useOrderStore(s => s.fetchToday)

  useEffect(() => { init() }, [init])

  // ===== Realtime + warmup inicial =====
  // Cuando hay sesión: hacemos warmup inicial, suscribimos realtime, traemos
  // datos. Cuando no hay sesión: limpiamos todo.
  useEffect(() => {
    if (session) {
      // Warmup inicial: refresca sesión si hace falta + ping de salud
      warmUpSystem()
        .then(() => {
          fetchActive()
          fetchToday()
          subscribe()
        })
        .catch(() => {
          // Warmup falló — los stores ya marcaron health a 'auth_expired' o
          // 'offline'. La UI lo refleja. El usuario verá el indicador.
          // Igual intentamos suscribir y cargar; el polling se encargará.
          fetchActive()
          fetchToday()
          subscribe()
        })
      startHeartbeat()
    } else {
      unsubscribe()
      stopHeartbeat()
    }
    return () => {
      if (!session) {
        unsubscribe()
        stopHeartbeat()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  // ===== Despertar de idle / sleep / background =====
  useEffect(() => {
    if (!session) return
    const cleanup = installVisibilityHandlers({
      onWake: () => {
        // appHealth ya hizo warmup; aquí refrescamos data y realtime
        subscribe()      // recrea canal si murió
        fetchActive()
        fetchToday()
      },
    })
    return cleanup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  // ===== Marcar actividad del usuario =====
  useEffect(() => {
    const onActivity = () => markActivity()
    window.addEventListener('pointerdown', onActivity, { passive: true })
    window.addEventListener('keydown', onActivity, { passive: true })
    window.addEventListener('touchstart', onActivity, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', onActivity)
      window.removeEventListener('keydown', onActivity)
      window.removeEventListener('touchstart', onActivity)
    }
  }, [])

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-chikin-black text-white">
        <div className="font-display text-5xl text-chikin-yellow animate-pulse">CHIKIN88</div>
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={!session ? <Login /> : <Navigate to="/pedidos" />} />

      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/"          element={<Navigate to="/pedidos" />} />
        <Route path="/pedidos"   element={<Orders />} />
        <Route path="/nuevo"     element={<ProtectedRoute roles={['admin','empleado']}><NewOrder /></ProtectedRoute>} />
        <Route path="/cocina"    element={<ProtectedRoute roles={['admin','empleado']}><Kitchen /></ProtectedRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute roles={['admin']}><Dashboard /></ProtectedRoute>} />
        <Route path="/gastos"    element={<ProtectedRoute roles={['admin']}><Expenses /></ProtectedRoute>} />
        <Route path="/reportes"  element={<ProtectedRoute roles={['admin']}><Reports /></ProtectedRoute>} />
        <Route path="/anulados"  element={<ProtectedRoute roles={['admin']}><AnulledOrders /></ProtectedRoute>} />
      </Route>

      <Route path="*" element={<Navigate to="/pedidos" />} />
    </Routes>
  )
}
