// /api/expenses
// GET           → lista gastos (admin)
// POST          → crea gasto (admin)
// DELETE ?id=X  → borra gasto (admin)
import { withAuth } from '../server/auth.js'

export default withAuth(async (req, res, { supaSrv, userId }) => {
  // ===== GET =====
  if (req.method === 'GET') {
    const { from, to } = req.query || {}
    let q = supaSrv.from('expenses').select('*').order('expense_date', { ascending: false }).limit(2000)
    if (from) q = q.gte('expense_date', from)
    if (to)   q = q.lte('expense_date', to)
    const { data, error } = await q
    if (error) return res.status(500).json({ success: false, error: error.message })
    return res.status(200).json({ success: true, expenses: data || [] })
  }

  // ===== POST =====
  if (req.method === 'POST') {
    const { amount, category, description, expense_date } = req.body || {}
    if (amount == null || !category) {
      return res.status(400).json({ success: false, error: 'Datos incompletos' })
    }
    const { data, error } = await supaSrv
      .from('expenses')
      .insert([{
        amount: Number(amount),
        category,
        description: description || null,
        expense_date: expense_date || new Date().toISOString().slice(0, 10),
        created_by: userId,
      }])
      .select()
      .single()
    if (error) return res.status(500).json({ success: false, error: error.message })
    return res.status(200).json({ success: true, expense: data })
  }

  // ===== DELETE =====
  if (req.method === 'DELETE') {
    const id = req.query?.id
    if (!id) return res.status(400).json({ success: false, error: 'Falta id' })
    const { error } = await supaSrv.from('expenses').delete().eq('id', id)
    if (error) return res.status(500).json({ success: false, error: error.message })
    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' })
}, { allowedRoles: ['admin'] })
