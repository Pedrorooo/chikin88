import { useHealthStore } from '../store/healthStore'
import { Wifi, WifiOff, Loader2, AlertTriangle, ShieldAlert, CheckCircle2 } from 'lucide-react'

// ============================================================
//  Indicador discreto de salud global del sistema.
//  Estados:
//    'ready'        — verde, todo listo
//    'warming_up'   — gris, calentando
//    'degraded'     — amarillo, lento o respondió mal
//    'offline'      — rojo, sin internet
//    'auth_expired' — rojo, sesión vencida
//    'reconnecting' — amarillo, reconectando
// ============================================================
export default function SystemReadyBadge() {
  const status = useHealthStore(s => s.status)

  const config = {
    ready: {
      icon: <CheckCircle2 size={12}/>,
      label: 'Sistema listo',
      cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
      dotCls: 'bg-emerald-500',
    },
    warming_up: {
      icon: <Loader2 size={12} className="animate-spin"/>,
      label: 'Reactivando conexión…',
      cls: 'bg-zinc-200 dark:bg-chikin-gray-800 text-zinc-600 dark:text-zinc-300 border-zinc-300 dark:border-chikin-gray-700',
      dotCls: 'bg-zinc-400',
    },
    degraded: {
      icon: <AlertTriangle size={12}/>,
      label: 'Conexión lenta',
      cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
      dotCls: 'bg-amber-500',
    },
    offline: {
      icon: <WifiOff size={12}/>,
      label: 'Sin conexión',
      cls: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30',
      dotCls: 'bg-rose-500',
    },
    auth_expired: {
      icon: <ShieldAlert size={12}/>,
      label: 'Sesión vencida',
      cls: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30',
      dotCls: 'bg-rose-500',
    },
    reconnecting: {
      icon: <Loader2 size={12} className="animate-spin"/>,
      label: 'Reactivando…',
      cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
      dotCls: 'bg-amber-500',
    },
  }

  const c = config[status] || config.warming_up

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold border ${c.cls}`}
      title={`Estado: ${status}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${c.dotCls} ${status === 'ready' ? 'animate-pulse' : ''}`}/>
      <span className="hidden md:inline">{c.label}</span>
      <span className="md:hidden">{c.icon}</span>
    </span>
  )
}
