// ============================================================
//  orderDraft.js — autosave del pedido en curso
//
//  Guarda el pedido que el camarero está armando en localStorage.
//  Se restaura al cargar la página si quedó algo pendiente, y se
//  limpia SOLO cuando Supabase confirma la creación exitosa.
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
    return draft
  } catch {
    return null
  }
}

export function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY) } catch {}
}

// ============================================================
//  hasMeaningfulContent — ¿vale la pena guardar este borrador?
//  Evitamos guardar un borrador vacío que después confunde al usuario.
// ============================================================
export function isDraftMeaningful(draft) {
  if (!draft) return false
  const hasItems = Array.isArray(draft.items) && draft.items.length > 0
  const hasName  = draft.customerName && draft.customerName.trim().length > 0
  return hasItems || hasName
}
