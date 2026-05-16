import { useState } from 'react'
import { motion } from 'framer-motion'
import { Lock, Mail, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/authStore'

export default function Login() {
  const { signIn } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handle = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await signIn(email.trim(), password)
      toast.success('¡Bienvenido!')
    } catch (err) {
      toast.error(err.message || 'Error al iniciar sesión')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-chikin-black p-4 relative overflow-hidden">
      {/* fondo decorativo */}
      <div className="absolute inset-0 bg-grid opacity-30" />
      <motion.div
        className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-chikin-red/40 blur-3xl"
        animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 8, repeat: Infinity }}
      />
      <motion.div
        className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-chikin-yellow/20 blur-3xl"
        animate={{ scale: [1.2, 1, 1.2] }} transition={{ duration: 10, repeat: Infinity }}
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative z-10 w-full max-w-md"
      >
        {/* Logo grande */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-24 h-24 bg-chikin-red rounded-3xl shadow-2xl shadow-chikin-red/40 mb-4">
            <span className="font-display text-5xl text-chikin-yellow">88</span>
          </div>
          <h1 className="font-display text-6xl text-white tracking-wide">
            CHIKIN<span className="text-chikin-yellow">88</span>
          </h1>
          <p className="text-zinc-500 uppercase tracking-[0.3em] text-xs mt-2">
            Sistema POS Premium
          </p>
        </div>

        {/* Formulario */}
        <div className="bg-chikin-gray-900 rounded-3xl p-8 border border-chikin-gray-700 shadow-2xl">
          <h2 className="text-white text-xl font-bold mb-6">Iniciar sesión</h2>
          <form onSubmit={handle} className="space-y-4">
            <div>
              <label className="block text-zinc-400 text-xs font-bold uppercase tracking-wider mb-2">
                Correo
              </label>
              <div className="relative">
                <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full pl-12 pr-4 py-4 rounded-xl bg-chikin-gray-800 border-2 border-chikin-gray-700
                             text-white focus:border-chikin-yellow focus:outline-none transition"
                  placeholder="tu@correo.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-zinc-400 text-xs font-bold uppercase tracking-wider mb-2">
                Contraseña
              </label>
              <div className="relative">
                <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full pl-12 pr-4 py-4 rounded-xl bg-chikin-gray-800 border-2 border-chikin-gray-700
                             text-white focus:border-chikin-yellow focus:outline-none transition"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full btn-lg bg-chikin-red text-white font-bold uppercase tracking-wider
                         hover:bg-chikin-red-dark mt-6"
            >
              {loading ? <Loader2 className="animate-spin" size={22}/> : 'Entrar'}
            </button>
          </form>

          <p className="text-center text-zinc-500 text-xs mt-6">
            Sólo personal autorizado · Chikin88 Ibarra
          </p>
        </div>
      </motion.div>
    </div>
  )
}
