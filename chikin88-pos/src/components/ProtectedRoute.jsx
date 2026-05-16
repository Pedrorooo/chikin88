import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'

// Normaliza roles antiguos a los nuevos.
// Esto evita que un usuario con sesión vieja quede bloqueado
// mientras se propaga la migración.
const normalize = (role) => {
  if (role === 'mesero' || role === 'cocina') return 'empleado'
  return role
}

export default function ProtectedRoute({ children, roles }) {
  const { session, profile, loading } = useAuthStore()

  if (loading) return null
  if (!session) return <Navigate to="/login" replace />

  if (roles && roles.length > 0) {
    if (!profile) {
      return (
        <div className="p-8 text-center">
          <p className="text-zinc-500">Cargando perfil...</p>
        </div>
      )
    }

    // Aceptamos tanto roles nuevos como la normalización de los viejos
    const userRole = normalize(profile.role)
    const allowed = roles.map(normalize)

    if (!allowed.includes(userRole)) {
      return (
        <div className="p-8 text-center">
          <h2 className="text-2xl font-bold text-chikin-red">Acceso denegado</h2>
          <p className="text-zinc-500 mt-2">No tienes permiso para ver esta sección.</p>
        </div>
      )
    }
  }

  return children
}
