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
  'Acevichada',
]

// ----- Modos de salsa (solo aplican a productos que admiten salsa) -----
// Nota: el valor 'extra' se mantiene como aceptado en BD por compat con
// datos antiguos, pero la UI ya no lo ofrece. Las salsas extra se cobran
// automáticamente cuando se eligen más salsas que las incluidas.
export const SAUCE_MODES = [
  { v: 'normal', l: 'Con salsa',  hint: 'Sobre el pollo' },
  { v: 'sin',    l: 'Sin salsa',  hint: 'Sin salsa' },
  { v: 'aparte', l: 'Aparte',     hint: 'Salsa por separado' },
]
// Recargo histórico del modo "Extra" (sigue calculándose si llega en
// datos antiguos; el frontend ya no lo aplica a pedidos nuevos).
export const SAUCE_EXTRA_MODE_PRICE = 0.25

// ----- Tipos de ramen -----
export const RAMEN_TYPES = [
  { v: 'picante',   l: 'Picante'   },
  { v: 'carbonara', l: 'Carbonara' },
  { v: 'carne',     l: 'Carne'     },
]

// ============================================================
//  Sabores variables (bebidas, salsa extra)
//
//  Estos sabores se guardan en order_items.item_flavor (columna
//  text agregada en migración 013). No se mezclan con ramen_type
//  para evitar confusión en reportes.
// ============================================================

// Bebida grande: sabores disponibles
export const DRINK_LARGE_FLAVORS = [
  'Fuze tea',
  'Coca cola',
  'Guitig',
]

// Bebida pequeña: sabores disponibles
export const DRINK_SMALL_FLAVORS = [
  'Fanta',
  'Fanta uva',
  'Sprite',
  'Squizz',
  'Fiora fresa',
  'Fiora manzana',
]

// Devuelve los sabores aplicables a un producto, o null si no aplica.
// Para "Salsa extra" se usan las salsas normales (SAUCES) — mismo set
// que los combos de pollo, según pidió el negocio.
export const flavorsForProduct = (product) => {
  if (!product) return null
  const name = (product.name || product.product_name || '').toLowerCase().trim()
  if (name === 'bebida grande') return DRINK_LARGE_FLAVORS
  if (name === 'bebida pequeña' || name === 'bebida pequena') return DRINK_SMALL_FLAVORS
  if (name === 'salsa extra') return SAUCES
  return null
}

// ¿Este item requiere que se elija un sabor antes de poder enviar el pedido?
export const itemRequiresFlavor = (item) => flavorsForProduct(item) !== null

// ----- Tarifas de extras -----
// La primera salsa va incluida; cada salsa adicional cuesta este valor (por unidad × cantidad)
export const SAUCE_EXTRA_PRICE = 0.25
// Si el pedido lleva palillos como cubierto, se suma este recargo (una vez por pedido)
export const PALILLOS_EXTRA_PRICE = 0.25
// Mayonesa extra: cada unidad cuesta este valor. Solo se cobra si with_mayo = true.
export const MAYO_EXTRA_PRICE = 0.25

// Helpers de cálculo
// Cada item lleva su propio `free_sauces` (heredado del producto al agregarlo).
// Si no viene, asumimos 1 por compatibilidad.
export const itemFreeSauces = (item) => item.free_sauces ?? 1

// Si el item está en modo "sin", no se cobran salsas extra.
// Si está en modo "extra", siempre se suma SAUCE_EXTRA_MODE_PRICE por unidad además
// de las salsas extra normales.
export const itemExtraSauceCount = (item) => {
  if (item.sauce_mode === 'sin') return 0
  return Math.max(0, (item.sauces?.length || 0) - itemFreeSauces(item))
}

export const itemExtrasTotal = (item) => {
  if (item.sauce_mode === 'sin') return 0
  const extras = itemExtraSauceCount(item) * SAUCE_EXTRA_PRICE * item.quantity
  const modeExtra = item.sauce_mode === 'extra' ? SAUCE_EXTRA_MODE_PRICE * item.quantity : 0
  return extras + modeExtra
}

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

// ============================================================
//  Empleados — beneficios diarios y cortesías semanales
// ============================================================

// Lista oficial de empleados con sufijo 88 (sincronizada con tabla `employees`)
export const EMPLOYEES = [
  'Nicolas88', 'Cesar88', 'David88', 'Melany88', 'Nahomi88',
  'Jhon88', 'Jhosep88', 'Victor88', 'Valeria88', 'Valentin88',
  'Francisco88', 'Cindy88', 'Daivid88', 'Stephano88',
]

// Subconjunto: dueños. No tienen límite diario ni semanal.
// IMPORTANTE: mantener sincronizado con la columna `employees.role` en BD.
export const OWNERS = ['Cindy88', 'Daivid88', 'Stephano88']

export const isOwner = (name) => !!name && OWNERS.includes(name)

// Etiqueta de badge según tipo de beneficio y si la persona es dueño.
// format: 'long' (DESCUENTO EMPLEADO) | 'short' (EMP) | 'medium' (Empleado)
export const benefitBadge = (type, employee, format = 'long') => {
  const owner = isOwner(employee)
  if (format === 'short') {
    if (owner) return '👑 DUEÑO'
    return type === 'discount' ? '⭐ EMP' : '🎁 CORT'
  }
  if (format === 'medium') {
    if (owner) return '👑 Dueño'
    return type === 'discount' ? '⭐ Empleado' : '🎁 Cortesía'
  }
  // long
  if (owner) {
    return type === 'discount' ? '👑 DESCUENTO DUEÑO' : '👑 CORTESÍA DUEÑO'
  }
  return type === 'discount' ? '⭐ DESCUENTO EMPLEADO' : '🎁 CORTESÍA EMPLEADO'
}

// Detecta empleado por nombre de cliente (case-insensitive).
// Devuelve el nombre canónico (con mayúsculas correctas) o null.
export const detectEmployee = (name) => {
  if (!name) return null
  const norm = name.trim().toLowerCase()
  return EMPLOYEES.find(e => e.toLowerCase() === norm) || null
}

// Precios especiales para combos (descuento de empleado)
export const EMPLOYEE_DISCOUNT_PRICES = {
  'Combo Económico': 2.50,
  'Combo Especial':  4.00,
  'Combo XXL':       7.00,
  'Combo Full':     15.50,
}

// Nombres de combos elegibles para descuento
export const DISCOUNT_ELIGIBLE_COMBOS = Object.keys(EMPLOYEE_DISCOUNT_PRICES)

// El único combo elegible para la cortesía semanal
export const COURTESY_COMBO = 'Combo Especial'

// ¿Es un combo aplicable al descuento?
export const isDiscountEligibleCombo = (productName) =>
  DISCOUNT_ELIGIBLE_COMBOS.includes(productName)

// Devuelve el precio especial; si no hay descuento, retorna el regular
export const employeeDiscountPrice = (productName) =>
  EMPLOYEE_DISCOUNT_PRICES[productName] ?? null

// Mensajes de error según código de PostgreSQL del trigger
export const parseBenefitError = (msg) => {
  if (!msg) return 'No se pudo crear el pedido'
  // Mensajes del trigger handle_benefit_order
  if (msg.includes('EMPLOYEE_NOT_FOUND')) return 'Empleado no encontrado'
  if (msg.includes('ya usó su descuento')) return msg.split('ERROR:').pop().trim()
  if (msg.includes('ya usó su Combo Especial gratis')) return msg.split('ERROR:').pop().trim()
  return msg
}

// ============================================================
//  Promo Estudiante — 10% en combos de pollo (mayo 2026)
//
//  Detección por sufijo del nombre del cliente: si trim().toLowerCase()
//  termina en "estudiante", se considera promo activa. El descuento
//  aplica SOLO a combos de pollo (categoría 'Principales'); jamás a
//  Combo Ramen, ramen, bebidas, extras, palillos, salsas extra ni
//  delivery.
//
//  Convención: nombres terminados en "88" son empleados/dueños y NO
//  pueden activar la promo estudiante (los casos son mutuamente
//  excluyentes — el sufijo "88" gana al final de la cadena).
// ============================================================

export const STUDENT_SUFFIX = 'estudiante'
export const STUDENT_DISCOUNT_RATE = 0.10
export const STUDENT_DISCOUNT_LABEL = 'Promo estudiante 10%'

// Redondeo a 2 decimales sin sesgos por floats
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

// ¿Este pedido lleva promo estudiante?
export const detectStudentPromo = (customerName) => {
  if (!customerName) return false
  return customerName.trim().toLowerCase().endsWith(STUDENT_SUFFIX)
}

// ¿Este item es elegible para la promo estudiante?
// Regla: categoría 'Principales' y product_name NO empieza con 'combo ramen'.
// Esto incluye automáticamente combos futuros de pollo (Combo Económico/
// Especial/XXL/Full y cualquier otro de Principales).
export const isStudentDiscountEligibleItem = (item) => {
  if (!item) return false
  const cat  = item.product_category || item.category
  const name = (item.product_name || item.name || '').toString().toLowerCase()
  if (cat !== 'Principales') return false
  if (name.startsWith('combo ramen')) return false
  return true
}

// Descuento que aplicaría a UN item del carrito si la promo estudiante
// estuviera activa. Se calcula sobre unit_price * quantity (base);
// las salsas extra y el modo "extra" NO se descuentan.
export const itemStudentDiscount = (item) => {
  if (!isStudentDiscountEligibleItem(item)) return 0
  const base = Number(item.unit_price || 0) * Number(item.quantity || 0)
  return round2(base * STUDENT_DISCOUNT_RATE)
}

// Total de descuento estudiante sobre un arreglo de items, solo si
// `isStudent` es true. Si no, devuelve 0.
export const studentDiscountTotal = (items, isStudent) => {
  if (!isStudent || !Array.isArray(items)) return 0
  return round2(items.reduce((s, it) => s + itemStudentDiscount(it), 0))
}

// ============================================================
//  Numeración de pedidos
//
//  La BD guarda dos números por pedido:
//    * order_number       → serial global (interno, único, nunca cambia)
//    * daily_order_number → contador por business_date (#1, #2... cada día)
//
//  displayOrderNumber prefiere el daily si existe, y cae al global como
//  fallback para pedidos creados antes de la migración 012 (no tenían
//  daily_order_number asignado). De esa manera no se rompe NADA visual
//  para pedidos viejos.
// ============================================================
export const displayOrderNumber = (order) => {
  if (!order) return ''
  if (order.daily_order_number != null && order.daily_order_number !== '') {
    return `#${order.daily_order_number}`
  }
  if (order.order_number != null) {
    return `#${order.order_number}`
  }
  return ''
}

// ============================================================
//  Helpers de semana ISO (zona Ecuador implícita)
//
//  Los strings tienen formato "YYYY-Www" (p.ej. "2026-W20").
//  El backend ya devuelve la semana actual calculada en zona
//  América/Guayaquil; estos helpers solo navegan a anterior/siguiente
//  preservando reglas ISO 8601 (semana inicia en lunes; semana 1
//  contiene el primer jueves del año).
// ============================================================

// Convierte una fecha JS en string ISO week "YYYY-Www"
const dateToIsoWeek = (date) => {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

// Toma "YYYY-Www" y devuelve la fecha JS del lunes (00:00 UTC) de esa
// semana ISO. Usado solo para hacer ± 7 días y volver a serializar.
const isoWeekToMonday = (isoWeek) => {
  const m = /^(\d{4})-W(\d{2})$/.exec(isoWeek)
  if (!m) return null
  const year = Number(m[1])
  const week = Number(m[2])
  // Algoritmo: 4 de enero siempre está en la semana 1 ISO.
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Day = jan4.getUTCDay() || 7
  const week1Monday = new Date(jan4)
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1)
  const target = new Date(week1Monday)
  target.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7)
  return target
}

// Devuelve la semana ISO anterior. Si la entrada es inválida devuelve null.
export const prevIsoWeek = (isoWeek) => {
  const monday = isoWeekToMonday(isoWeek)
  if (!monday) return null
  monday.setUTCDate(monday.getUTCDate() - 7)
  return dateToIsoWeek(monday)
}

// Devuelve la semana ISO siguiente.
export const nextIsoWeek = (isoWeek) => {
  const monday = isoWeekToMonday(isoWeek)
  if (!monday) return null
  monday.setUTCDate(monday.getUTCDate() + 7)
  return dateToIsoWeek(monday)
}

// Devuelve el rango fmt "lun N mes – dom N mes" para mostrar al usuario
// debajo del badge "YYYY-Www". Idioma es-EC.
export const isoWeekHumanRange = (isoWeek) => {
  const monday = isoWeekToMonday(isoWeek)
  if (!monday) return ''
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  const fmt = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short' })
  return `${fmt.format(monday)} – ${fmt.format(sunday)}`
}
