// ----- Formato de moneda en USD (Ecuador) -----
export const money = (n) =>
  '$' + Number(n || 0).toFixed(2)

// ----- Cálculo de minutos transcurridos -----
export const minutesSince = (iso) => {
  if (!iso) return 0
  const ms = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.floor(ms / 60000))
}

// ----- Color/categoría según tiempo del pedido -----
export const ageBucket = (mins) => {
  if (mins <= 10) return 'fresh'
  if (mins <= 20) return 'warn'
  if (mins <= 30) return 'late'
  return 'urgent'
}

// ----- Etiquetas humanas para estado -----
export const STATUS_LABEL = {
  pendiente:      'Pendiente',
  en_preparacion: 'En preparación',
  listo:          'Listo',
  entregado:      'Entregado',
  cancelado:      'Cancelado',
}

// ----- Próximo estado en el flujo -----
export const NEXT_STATUS = {
  pendiente:      'en_preparacion',
  en_preparacion: 'listo',
  listo:          'entregado',
}

// ----- Salsas disponibles (mostradas como botones rápidos en pedido) -----
export const SAUCES = [
  'Coreana poco picante',
  'Coreana picante',
  'Maracuyá picante',
  'Maracuyá sin picante',
  'Limón y pimienta',
  'Ajo parmesano',
  'Miel y mostaza',
]

// ----- Tarifas de extras -----
// La primera salsa va incluida; cada salsa adicional cuesta este valor (por unidad × cantidad)
export const SAUCE_EXTRA_PRICE = 0.25
// Si el pedido lleva palillos como cubierto, se suma este recargo (una vez por pedido)
export const PALILLOS_EXTRA_PRICE = 0.25

// Helpers de cálculo
// Cada item lleva su propio `free_sauces` (heredado del producto al agregarlo).
// Si no viene, asumimos 1 por compatibilidad.
export const itemFreeSauces = (item) => item.free_sauces ?? 1

export const itemExtraSauceCount = (item) =>
  Math.max(0, (item.sauces?.length || 0) - itemFreeSauces(item))

export const itemExtrasTotal = (item) =>
  itemExtraSauceCount(item) * SAUCE_EXTRA_PRICE * item.quantity

export const itemSubtotal = (item) =>
  item.unit_price * item.quantity + itemExtrasTotal(item)

// ----- Formato fecha y hora local Ecuador -----
export const fmtTime = (iso) =>
  new Date(iso).toLocaleTimeString('es-EC', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  })

export const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString('es-EC', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })

// ----- Helper para clases condicionales -----
export const cx = (...args) => args.filter(Boolean).join(' ')

// ----- Rangos de fechas -----
export const todayRange = () => {
  const start = new Date(); start.setHours(0,0,0,0)
  const end   = new Date(); end.setHours(23,59,59,999)
  return { start: start.toISOString(), end: end.toISOString() }
}

export const weekRange = () => {
  const now = new Date()
  const day = now.getDay() === 0 ? 7 : now.getDay() // lunes=1
  const start = new Date(now); start.setDate(now.getDate() - (day - 1)); start.setHours(0,0,0,0)
  const end = new Date(); end.setHours(23,59,59,999)
  return { start: start.toISOString(), end: end.toISOString() }
}

export const monthRange = () => {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
  const end   = new Date(); end.setHours(23,59,59,999)
  return { start: start.toISOString(), end: end.toISOString() }
}
