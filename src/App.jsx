import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import { useOrderStore } from './store/orderStore'

import Layout from './components/layout/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import Orders from './pages/Orders'
import NewOrder from './pages/NewOrder'
import Kitchen from './pages/Kitchen'
import Dashboard from './pages/Dashboard'
import Expenses from './pages/Expenses'
import Reports from './pages/Reports'

export default function App() {
  const { init, loading, session } = useAuthStore()
  const subscribe = useOrderStore(s => s.subscribe)
  const unsubscribe = useOrderStore(s => s.unsubscribe)
  const fetchActive = useOrderStore(s => s.fetchActive)
  const fetchToday = useOrderStore(s => s.fetchToday)

  useEffect(() => { init() }, [init])

  useEffect(() => {
    if (session) {
      fetchActive()
      fetchToday()
      subscribe()
    } else {
      unsubscribe()
    }
    return () => unsubscribe()
  }, [session, fetchActive, fetchToday, subscribe, unsubscribe])

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
      </Route>

      <Route path="*" element={<Navigate to="/pedidos" />} />
    </Routes>
  )
}
