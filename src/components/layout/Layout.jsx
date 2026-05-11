import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import {
  ListOrdered, PlusCircle, ChefHat, BarChart3,
  Receipt, FileText, LogOut, Moon, Sun, Menu, X, ArchiveX,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuthStore } from '../../store/authStore'
import { cx } from '../../lib/utils'

export default function Layout() {
  const { profile, signOut } = useAuthStore()
  const navigate = useNavigate()
  const [dark, setDark] = useState(() => localStorage.getItem('chikin-dark') === '1')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    document.body.classList.toggle('dark', dark)
    localStorage.setItem('chikin-dark', dark ? '1' : '0')
  }, [dark])

  const role = profile?.role
  const isAdmin = role === 'admin'
  // Cualquiera que no sea admin ni perfil-vacío es operador (incluye roles viejos)
  const isEmployee = role === 'empleado' || role === 'mesero' || role === 'cocina'
  // Etiqueta amistosa para mostrar ("admin" / "empleado")
  const roleLabel = isAdmin ? 'admin' : (isEmployee ? 'empleado' : (role || ''))

  const nav = [
    { to: '/pedidos',   icon: ListOrdered, label: 'Pedidos',   show: true },
    { to: '/nuevo',     icon: PlusCircle,  label: 'Nuevo',     show: isAdmin || isEmployee },
    { to: '/cocina',    icon: ChefHat,     label: 'Cocina',    show: isAdmin || isEmployee },
    { to: '/dashboard', icon: BarChart3,   label: 'Dashboard', show: isAdmin },
    { to: '/gastos',    icon: Receipt,     label: 'Gastos',    show: isAdmin },
    { to: '/reportes',  icon: FileText,    label: 'Reportes',  show: isAdmin },
    { to: '/anulados',  icon: ArchiveX,    label: 'Anulados',  show: isAdmin },
  ].filter(i => i.show)

  const handleLogout = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* ===== Sidebar (desktop) ===== */}
      <aside className="hidden md:flex w-64 flex-col bg-chikin-black text-white">
        <div className="px-6 py-8 border-b border-chikin-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-chikin-red flex items-center justify-center">
              <span className="font-display text-xl text-chikin-yellow">88</span>
            </div>
            <div>
              <div className="brand-mark">CHIKIN<span className="text-chikin-yellow">88</span></div>
              <div className="text-[10px] uppercase tracking-widest text-zinc-500">Point of Sale</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all',
                  isActive
                    ? 'bg-chikin-red text-white shadow-lg shadow-chikin-red/30'
                    : 'text-zinc-300 hover:bg-chikin-gray-800'
                )
              }
            >
              <Icon size={20} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-chikin-gray-700">
          <div className="px-3 py-2 mb-3">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">Conectado como</p>
            <p className="font-bold truncate">{profile?.full_name || profile?.email}</p>
            <p className="text-xs text-chikin-yellow uppercase mt-0.5">{roleLabel}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setDark(d => !d)}
              className="flex-1 btn bg-chikin-gray-800 text-white hover:bg-chikin-gray-700"
              title="Cambiar tema"
            >
              {dark ? <Sun size={18}/> : <Moon size={18}/>}
            </button>
            <button
              onClick={handleLogout}
              className="flex-1 btn bg-chikin-red text-white hover:bg-chikin-red-dark"
            >
              <LogOut size={18}/> Salir
            </button>
          </div>
        </div>
      </aside>

      {/* ===== Topbar móvil ===== */}
      <header className="md:hidden sticky top-0 z-40 bg-chikin-black text-white px-4 py-3 flex items-center justify-between border-b border-chikin-gray-700">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-chikin-red flex items-center justify-center">
            <span className="font-display text-lg text-chikin-yellow">88</span>
          </div>
          <span className="brand-mark">CHIKIN<span className="text-chikin-yellow">88</span></span>
        </div>
        <button onClick={() => setOpen(true)} className="p-2"><Menu size={26}/></button>
      </header>

      {/* ===== Drawer móvil ===== */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/60 z-50 md:hidden"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.aside
              className="fixed top-0 right-0 bottom-0 w-72 z-50 bg-chikin-black text-white flex flex-col md:hidden"
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.25 }}
            >
              <div className="flex items-center justify-between p-4 border-b border-chikin-gray-700">
                <div className="brand-mark">Menú</div>
                <button onClick={() => setOpen(false)} className="p-2"><X size={24}/></button>
              </div>
              <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
                {nav.map(({ to, icon: Icon, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) =>
                      cx(
                        'flex items-center gap-3 px-4 py-3.5 rounded-xl text-base font-semibold',
                        isActive
                          ? 'bg-chikin-red text-white'
                          : 'text-zinc-200 hover:bg-chikin-gray-800'
                      )
                    }
                  >
                    <Icon size={22} /> {label}
                  </NavLink>
                ))}
              </nav>
              <div className="p-4 border-t border-chikin-gray-700">
                <div className="text-sm mb-3">
                  <p className="text-zinc-500 text-xs uppercase">Conectado</p>
                  <p className="font-bold truncate">{profile?.full_name || profile?.email}</p>
                  <p className="text-chikin-yellow text-xs uppercase">{roleLabel}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setDark(d => !d)} className="flex-1 btn bg-chikin-gray-800 text-white">
                    {dark ? <Sun size={18}/> : <Moon size={18}/>}
                  </button>
                  <button onClick={handleLogout} className="flex-1 btn bg-chikin-red text-white">
                    <LogOut size={18}/> Salir
                  </button>
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ===== Contenido ===== */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
