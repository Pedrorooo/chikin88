// ============================================================
//  server/auth.js  (ESM)
//
//  Helper compartido para endpoints /api/*. Antes vivía en
//  api/_lib/auth.js pero Vercel Hobby contaba ese archivo dentro
//  del límite de 12 Serverless Functions. Moverlo fuera de /api
//  resuelve el límite sin cambiar la lógica.
//
//  Los endpoints lo importan como:
//    import { withAuth, setNoCacheHeaders } from '../server/auth.js'
//
//  validateRequest(req):
//    • Lee Authorization Bearer
//    • Valida JWT contra Supabase Auth (cliente con anon, fresco)
//    • Obtiene profile + role del usuario (cliente service_role, fresco)
//    • Devuelve { userId, profile, supaSrv } o { error, status }
//
//  IMPORTANTE: cada llamada crea clientes Supabase NUEVOS.
//  Sin caché entre requests. Sin estado compartido. Sin locks zombi.
// ============================================================
import { createClient } from '@supabase/supabase-js'

function getEnv() {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  return { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY }
}

export async function validateRequest(req) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY } = getEnv()

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) {
    return {
      error: 'Servidor mal configurado. Contacta al administrador.',
      status: 500,
    }
  }

  const authHeader = req.headers.authorization || req.headers.Authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) {
    return { error: 'No autenticado', status: 401 }
  }

  const supaAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userErr } = await supaAuth.auth.getUser(token)
  if (userErr || !userData?.user) {
    return {
      error: 'Sesión expirada. Vuelve a iniciar sesión.',
      status: 401,
    }
  }

  const userId = userData.user.id

  const supaSrv = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: profile, error: profErr } = await supaSrv
    .from('profiles')
    .select('id, role, full_name, email')
    .eq('id', userId)
    .single()

  if (profErr || !profile) {
    return {
      error: 'Tu perfil no está configurado.',
      status: 403,
    }
  }

  return { userId, profile, supaSrv }
}

export function withAuth(handler, opts = {}) {
  const { allowedRoles = ['admin', 'empleado', 'mesero', 'cocina'] } = opts

  return async (req, res) => {
    // Headers anti-caché en TODA respuesta de endpoints críticos.
    // Crítico para POS: jamás queremos que un proxy/CDN/navegador
    // sirva un 304 o cachee pedidos, estados o reportes.
    setNoCacheHeaders(res)

    try {
      const ctx = await validateRequest(req)
      if (ctx.error) {
        return res.status(ctx.status).json({ success: false, error: ctx.error })
      }
      if (!allowedRoles.includes(ctx.profile.role)) {
        return res.status(403).json({
          success: false,
          error: 'No tienes permisos para esta acción.',
        })
      }
      return await handler(req, res, ctx)
    } catch (err) {
      console.error('[api] unexpected error:', err)
      return res.status(500).json({
        success: false,
        error: err?.message || 'Error inesperado del servidor.',
      })
    }
  }
}

// ============================================================
//  setNoCacheHeaders — aplica headers anti-caché a la respuesta.
//  Exportado por separado para que /api/create-order (que no usa
//  withAuth) también pueda llamarlo.
// ============================================================
export function setNoCacheHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  res.setHeader('Surrogate-Control', 'no-store')
}
