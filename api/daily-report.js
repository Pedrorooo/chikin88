// =====================================================================
// CRON DIARIO – Resumen del día por correo (Resend)
// Se ejecuta automáticamente a las 22:15 hora Ecuador (03:15 UTC)
// gracias a la configuración en vercel.json → "crons"
// =====================================================================
import { createClient } from '@supabase/supabase-js'

export const config = { runtime: 'nodejs' }

export default async function handler(req, res) {
  // Seguridad: Vercel envía un header authorization en cron jobs
  // y permitimos también un CRON_SECRET propio si quieres llamarlo manualmente.
  const auth = req.headers.authorization || ''
  const expected = `Bearer ${process.env.CRON_SECRET}`
  const isVercelCron = auth.startsWith('Bearer ') && auth === `Bearer ${process.env.CRON_SECRET}`
  const isVercelAuto = req.headers['user-agent']?.includes('vercel-cron')
  if (!isVercelAuto && !isVercelCron) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const supa = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    )

    // Rango: día actual 00:00 a 23:59 hora Ecuador (UTC-5)
    const now = new Date()
    const ecOffsetMs = 5 * 60 * 60 * 1000 // UTC-5
    const ec = new Date(now.getTime() - ecOffsetMs)
    const y = ec.getUTCFullYear(), m = ec.getUTCMonth(), d = ec.getUTCDate()
    // 00:00 EC == 05:00 UTC
    const startUTC = new Date(Date.UTC(y, m, d, 5, 0, 0)).toISOString()
    // 23:59:59 EC == +1d 04:59:59 UTC
    const endUTC   = new Date(Date.UTC(y, m, d + 1, 4, 59, 59)).toISOString()
    const dayStr   = ec.toISOString().slice(0, 10) // YYYY-MM-DD

    // Pedidos del día (excluye anulados)
    const { data: orders } = await supa.from('orders')
      .select('*, order_items(product_name, product_category, quantity, subtotal)')
      .gte('created_at', startUTC).lte('created_at', endUTC)
      .eq('deleted_from_reports', false)

    // Gastos del día
    const { data: expenses } = await supa.from('expenses')
      .select('*').eq('expense_date', dayStr)

    const valid = (orders || []).filter(o => o.status !== 'cancelado')
    const rev = valid.filter(o => o.benefit_type !== 'courtesy')
    const cancelled = (orders || []).filter(o => o.status === 'cancelado')
    const courtesies = valid.filter(o => o.benefit_type === 'courtesy')
    const revenue = rev.reduce((s, o) => s + Number(o.total || 0), 0)
    const expenseTotal = (expenses || []).reduce((s, e) => s + Number(e.amount || 0), 0)
    const cash = rev.filter(o => o.payment_method === 'efectivo').reduce((s, o) => s + Number(o.total || 0), 0)
    const tx   = rev.filter(o => o.payment_method === 'transferencia').reduce((s, o) => s + Number(o.total || 0), 0)
    // Promo estudiante: solo pedidos válidos cuentan
    const studentOrders = valid.filter(o => o.discount_type === 'student')
    const studentDiscountTotal = studentOrders.reduce((s, o) => s + Number(o.discount_amount || 0), 0)

    // Productos top
    const map = new Map()
    valid.forEach(o => (o.order_items || []).forEach(it => {
      const cur = map.get(it.product_name) || { qty: 0, rev: 0 }
      map.set(it.product_name, {
        qty: cur.qty + Number(it.quantity || 0),
        rev: cur.rev + Number(it.subtotal || 0),
      })
    }))
    const topProducts = [...map.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10)

    const profit = revenue - expenseTotal
    const titleDate = ec.toLocaleDateString('es-EC', {
      day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC',
    })

    const html = buildEmail({
      titleDate, valid, cancelled, revenue, expenseTotal, profit,
      cash, tx, topProducts, expenses: expenses || [],
      studentCount: studentOrders.length,
      studentDiscount: studentDiscountTotal,
    })

    const toEmails = (process.env.REPORT_TO_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean)
    const from = process.env.REPORT_FROM_EMAIL || 'Chikin88 <onboarding@resend.dev>'

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: toEmails,
        subject: `🍗 Chikin88 · Resumen del ${titleDate}`,
        html,
      }),
    })

    if (!r.ok) {
      const txt = await r.text()
      console.error('Resend error:', txt)
      return res.status(500).json({ ok: false, error: txt })
    }

    return res.status(200).json({
      ok: true,
      sent_to: toEmails,
      orders: valid.length,
      revenue, expenseTotal, profit,
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ ok: false, error: err.message })
  }
}

// ---------------- HTML del correo ----------------
function buildEmail({
  titleDate, valid, cancelled, revenue, expenseTotal, profit,
  cash, tx, topProducts, expenses,
  studentCount = 0, studentDiscount = 0,
}) {
  const $ = (n) => '$' + Number(n || 0).toFixed(2)
  const row = (label, value, color = '#0A0A0A') =>
    `<tr><td style="padding:10px 14px;border-bottom:1px solid #eee;color:#555;">${label}</td>
         <td style="padding:10px 14px;border-bottom:1px solid #eee;text-align:right;font-weight:700;color:${color};">${value}</td></tr>`

  const productsRows = topProducts.length
    ? topProducts.map((p, i) =>
        `<tr><td style="padding:8px 14px;border-bottom:1px solid #f1f1f1;">${i+1}. ${p.name}</td>
             <td style="padding:8px 14px;border-bottom:1px solid #f1f1f1;text-align:center;">${p.qty}</td>
             <td style="padding:8px 14px;border-bottom:1px solid #f1f1f1;text-align:right;color:#D62828;font-weight:700;">${$(p.rev)}</td></tr>`
      ).join('')
    : `<tr><td colspan="3" style="padding:12px;text-align:center;color:#999;">Sin productos vendidos.</td></tr>`

  const cancelledRows = cancelled.length
    ? cancelled.slice(0, 20).map(o =>
        `<tr><td style="padding:6px 14px;color:#666;">#${o.order_number} · ${o.customer_name}</td>
             <td style="padding:6px 14px;text-align:right;color:#999;text-decoration:line-through;">${$(o.total)}</td></tr>`
      ).join('')
    : `<tr><td colspan="2" style="padding:12px;text-align:center;color:#999;">Sin cancelaciones 🙌</td></tr>`

  const expRows = expenses.length
    ? expenses.map(e =>
        `<tr><td style="padding:6px 14px;color:#666;">${escapeHtml(e.description)}</td>
             <td style="padding:6px 14px;text-align:right;color:#D62828;font-weight:700;">−${$(e.amount)}</td></tr>`
      ).join('')
    : `<tr><td colspan="2" style="padding:12px;text-align:center;color:#999;">Sin gastos registrados.</td></tr>`

  return `
<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0A0A0A;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 0;">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.06);">

        <!-- Header -->
        <tr><td style="background:#D62828;padding:32px 28px;text-align:center;color:#fff;">
          <div style="font-size:36px;font-weight:900;letter-spacing:1px;">CHIKIN<span style="color:#F4D35E;">88</span></div>
          <div style="font-size:13px;letter-spacing:3px;text-transform:uppercase;opacity:0.85;margin-top:4px;">Resumen del día</div>
          <div style="margin-top:14px;display:inline-block;background:#F4D35E;color:#0A0A0A;padding:6px 14px;border-radius:999px;font-weight:700;font-size:13px;">
            ${titleDate}
          </div>
        </td></tr>

        <!-- KPIs principales -->
        <tr><td style="padding:24px 28px 8px 28px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:12px;border:2px solid #16A34A;border-radius:14px;background:#DCFCE7;text-align:center;">
                <div style="font-size:11px;color:#15803D;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Ingresos</div>
                <div style="font-size:26px;font-weight:900;color:#15803D;">${$(revenue)}</div>
              </td>
              <td width="12"></td>
              <td style="padding:12px;border:2px solid #DC2626;border-radius:14px;background:#FECACA;text-align:center;">
                <div style="font-size:11px;color:#7F1D1D;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Gastos</div>
                <div style="font-size:26px;font-weight:900;color:#7F1D1D;">${$(expenseTotal)}</div>
              </td>
              <td width="12"></td>
              <td style="padding:12px;border:2px solid #0A0A0A;border-radius:14px;background:#F4D35E;text-align:center;">
                <div style="font-size:11px;color:#0A0A0A;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Ganancia</div>
                <div style="font-size:26px;font-weight:900;color:#0A0A0A;">${$(profit)}</div>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Resumen general -->
        <tr><td style="padding:0 28px;">
          <h3 style="font-size:14px;letter-spacing:2px;text-transform:uppercase;color:#999;margin:24px 0 8px;">Resumen general</h3>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:12px;overflow:hidden;">
            ${row('Pedidos atendidos', valid.length)}
            ${row('Pedidos cancelados', cancelled.length, '#DC2626')}
            ${row('Pago en efectivo', $(cash))}
            ${row('Pago por transferencia', $(tx))}
            ${studentCount > 0 ? row(`🎓 Promo estudiante (${studentCount} pedido${studentCount === 1 ? '' : 's'})`, `−${$(studentDiscount)}`, '#15803D') : ''}
          </table>
        </td></tr>

        <!-- Top productos -->
        <tr><td style="padding:0 28px;">
          <h3 style="font-size:14px;letter-spacing:2px;text-transform:uppercase;color:#999;margin:24px 0 8px;">Productos más vendidos</h3>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:12px;overflow:hidden;">
            <thead><tr style="background:#0A0A0A;color:#fff;">
              <th style="padding:10px 14px;text-align:left;font-size:12px;text-transform:uppercase;">Producto</th>
              <th style="padding:10px 14px;text-align:center;font-size:12px;text-transform:uppercase;">Cantidad</th>
              <th style="padding:10px 14px;text-align:right;font-size:12px;text-transform:uppercase;">Ingreso</th>
            </tr></thead>
            <tbody>${productsRows}</tbody>
          </table>
        </td></tr>

        <!-- Cancelados -->
        <tr><td style="padding:0 28px;">
          <h3 style="font-size:14px;letter-spacing:2px;text-transform:uppercase;color:#999;margin:24px 0 8px;">Pedidos cancelados</h3>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:12px;overflow:hidden;">
            ${cancelledRows}
          </table>
        </td></tr>

        <!-- Gastos -->
        <tr><td style="padding:0 28px 24px;">
          <h3 style="font-size:14px;letter-spacing:2px;text-transform:uppercase;color:#999;margin:24px 0 8px;">Gastos del día</h3>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:12px;overflow:hidden;">
            ${expRows}
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#0A0A0A;padding:18px 28px;text-align:center;color:#888;font-size:12px;">
          Reporte automático de Chikin88 · Generado a las 22:15
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;',
  }[c]))
}
