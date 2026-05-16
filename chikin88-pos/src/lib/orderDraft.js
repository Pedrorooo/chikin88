// ============================================================
//  orderDraft.js — autosave del pedido en curso
//
//  Guarda el pedido que el camarero está armando en localStorage.
//  Se restaura al cargar la página si quedó algo pendiente, y se
//  limpia cuando:
//    * Supabase confirma la creación exitosa, o
//    * el usuario vacía el carrito explícitamente, o
//    * el carrito queda sin productos (incluso si el nombre sigue
//      escrito) — antes el draft persistía con nombre y sin items,
//      lo que confundía al volver a Nuevo. Ahora un pedido sin
//      productos no se considera borrador válido.
// ============================================================

const DRAFT_KEY = 'chikin88:newOrderDraft:v2'
const DRAFT_MAX_AGE_MS = 8 * 60 * 60 * 1000  // 8 horas (descarta borradores viejos)

export function saveDraft(draft) {
  try {
    const payload = { savedAt: Date.now(), draft }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(payload))
  } catch (e) {
    // localStorage lleno o no disponible (modo incógnito), ignoramos
  }
}

export function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const { savedAt, draft } = JSON.parse(raw) || {}
    if (!draft) return null
    if (Date.now() - (savedAt || 0) > DRAFT_MAX_AGE_MS) {
      localStorage.removeItem(DRAFT_KEY)
      return null
    }
    // Defensa adicional: si el draft viejo se quedó sin items,
    // se descarta. Esto cubre cualquier draft persistido por
    // versiones anteriores del código.
    if (!Array.isArray(draft.items) || draft.items.length === 0) {
      localStorage.removeItem(DRAFT_KEY)
      return null
    }
    return draft
  } catch {
    return null
  }
}

export function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY) } catch {}
}

// ============================================================
//  isDraftMeaningful — ¿vale la pena guardar este borrador?
//
//  Regla actualizada (mayo 2026): un pedido SIN productos no es
//  un borrador útil. Tener solo el nombre o las observaciones
//  escritas confunde al usuario que ya vació el carrito a
//  propósito. Si después agrega productos, el draft se vuelve a
//  guardar automáticamente con todo el contexto.
// ============================================================
export function isDraftMeaningful(draft) {
  if (!draft) return false
  return Array.isArray(draft.items) && draft.items.length > 0
}
