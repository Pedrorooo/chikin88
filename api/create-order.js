// =====================================================================
//  POST /api/create-order
//
//  Crea pedidos llamando a la RPC create_order_with_items desde un
//  cliente Supabase FRESCO en el servidor. Esto resuelve definitivamente
//  el problema de "cliente del navegador stale tras horas abiertas":
//  cada request abre conexión nueva con service_role y se cierra al
//  terminar.
//
//  SEGURIDAD:
//    • Valida el JWT del usuario (Authorization: Bearer <token>)
//      contra Supabase Auth — solo usuarios autenticados pueden crear.
//    • Verifica que el perfil exista y tenga rol 'admin' o 'empleado'.
//    • Usa service_role solo del lado del servidor (variable de entorno
//      del proyecto Vercel, nunca expuesta al frontend).
//    • Pasa `created_by` derivado del JWT, no del body, para evitar
//      suplantación.
//
//  IDEMPOTENCIA:
//    • El payload puede traer `client_request_id`. La RPC detecta
//      duplicados y devuelve el pedido original.
//
//  ERRORES:
//    • 400 — payload inválido (sin items, sin cliente, etc.)
//    • 401 — no autenticado / JWT inválido / sesión expirada
//    • 403 — usuario sin rol válido
//    • 408 — timeout interno del servidor al llamar a Postgres
//    • 422 — error de negocio (ej. "Cindy88 ya usó su descuento hoy")
//    • 500 — error inesperado
//
//  La respuesta siempre tiene la forma:
//    { success: boolean, order?: object, error?: string }
// =====================================================================
import { createClient } from '@supabase/supabase-js'
import { setNoCacheHeaders } from './_lib/auth.js'

export const config = { runtime: 'nodejs' }

// Timeout interno: si la RPC tarda más de esto, cortamos y devolvemos 408.
// La idempotencia permite al cliente reintentar sin duplicar.
const RPC_TIMEOUT_MS = 9_000

export default async function handler(req, res) {
  // Headers anti-caché: jamás queremos que un proxy/CDN/navegador
  // cachee la respuesta de crear pedido.
  setNoCacheHeaders(res)

  // ----- CORS preflight (Vercel lo maneja, pero por si acaso) -----
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  // ----- 1. Variables de entorno -----
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SUPABASE_ANON_KEY) {
    console.error('[create-order] Faltan variables de entorno')
    return res.status(500).json({
      success: false,
      error: 'Servidor mal configurado. Contacta al administrador.',
    })
  }

  try {
    // ----- 2. Validar JWT del usuario -----
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) {
      return res.status(401).json({ success: false, error: 'No autenticado' })
    }

    // Cliente con ANON_KEY solo para validar el token del usuario.
    // No persistimos sesión: cada request es independiente.
    const supaAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: userData, error: userErr } = await supaAuth.auth.getUser(token)
    if (userErr || !userData?.user) {
      return res.status(401).json({
        success: false,
        error: 'Sesión expirada. Vuelve a iniciar sesión.',
      })
    }
    const userId = userData.user.id

    // ----- 3. Cliente service_role FRESCO para escribir -----
    // Importante: no caché de cliente entre requests. Cada invocación
    // crea uno nuevo. Esto es lo que mata el problema de "cliente stale".
    const supaSrv = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // ----- 4. Verificar rol del usuario -----
    const { data: profile, error: profErr } = await supaSrv
      .from('profiles')
      .select('id, role')
      .eq('id', userId)
      .single()

    if (profErr || !profile) {
      return res.status(403).json({
        success: false,
        error: 'Tu perfil no está configurado. Contacta al administrador.',
      })
    }

    const allowedRoles = ['admin', 'empleado', 'mesero', 'cocina']
    if (!allowedRoles.includes(profile.role)) {
      return res.status(403).json({
        success: false,
        error: 'No tienes permisos para crear pedidos.',
      })
    }

    // ----- 5. Validar payload -----
    const body = req.body || {}
    if (!body.customer_name || !String(body.customer_name).trim()) {
      return res.status(400).json({
        success: false,
        error: 'Falta nombre del cliente.',
      })
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'El pedido no tiene productos.',
      })
    }
    for (const it of body.items) {
      if (!it.product_name || it.unit_price == null || !it.quantity) {
        return res.status(400).json({
          success: false,
          error: 'Hay un producto con datos incompletos.',
        })
      }
    }

    // ----- 6. Construir payload final -----
    // created_by SIEMPRE viene del JWT, nunca del body.
    const payload = {
      customer_name:    String(body.customer_name).trim(),
      customer_phone:   body.customer_phone || null,
      status:           body.status || 'pendiente',
      order_type:       body.order_type || 'para_llevar',
      is_delivery:      !!body.is_delivery,
      delivery_fee:     Number(body.delivery_fee || 0),
      with_mayo:        body.with_mayo !== false,
      utensil:          body.utensil || 'tenedor',
      payment_method:   body.payment_method || 'efectivo',
      notes:            body.notes || null,
      subtotal:         Number(body.subtotal || 0),
      total:            Number(body.total || 0),
      created_by:       userId,            // ← derivado del JWT
      benefit_type:     body.benefit_type || null,
      benefit_employee: body.benefit_employee || null,
      client_request_id: body.client_request_id || null,
      items: body.items.map(it => ({
        product_id:       it.product_id || null,
        product_name:     String(it.product_name),
        product_category: it.product_category || null,
        unit_price:       Number(it.unit_price),
        quantity:         Number(it.quantity),
        sauces:           Array.isArray(it.sauces) ? it.sauces : [],
        sauce_mode:       it.sauce_mode || 'normal',
        ramen_type:       it.ramen_type || null,
        subtotal:         Number(it.subtotal ?? (it.unit_price * it.quantity)),
      })),
    }

    // ----- 7. Llamar al RPC con timeout duro -----
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS)
    let rpcRes
    try {
      rpcRes = await supaSrv
        .rpc('create_order_with_items', { payload })
        .abortSignal(controller.signal)
    } catch (err) {
      if (err?.name === 'AbortError') {
        return res.status(408).json({
          success: false,
          error: 'El servidor tardó demasiado. Pulsa reintentar.',
        })
      }
      throw err
    } finally {
      clearTimeout(timer)
    }

    if (rpcRes.error) {
      // Errores de negocio del trigger (beneficios duplicados, etc.)
      const msg = rpcRes.error.message || rpcRes.error.details || 'Error del servidor'
      // Códigos P0001-P0003 vienen del trigger handle_benefit_order
      const isBenefitError = /ya usó su|no es un empleado/i.test(msg) ||
                             ['P0001', 'P0002', 'P0003'].includes(rpcRes.error.code)
      return res.status(isBenefitError ? 422 : 500).json({
        success: false,
        error: msg.replace(/^ERROR:\s*/i, '').trim(),
      })
    }

    if (!rpcRes.data) {
      return res.status(500).json({
        success: false,
        error: 'El servidor no devolvió el pedido.',
      })
    }

    return res.status(200).json({ success: true, order: rpcRes.data })
  } catch (err) {
    console.error('[create-order] error inesperado:', err)
    return res.status(500).json({
      success: false,
      error: err?.message || 'Error inesperado del servidor.',
    })
  }
}
