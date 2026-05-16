// Funciones de exportación: PDF (jspdf), Excel (xlsx), CSV.
// Importadas dinámicamente en exportPDF/exportExcel para no inflar el bundle inicial.

const fmtMoney = (n) => '$' + (Number(n) || 0).toFixed(2)
const round2Money = (n) => Math.round((Number(n) || 0) * 100) / 100
const fmtDate  = (iso) => new Date(iso).toLocaleDateString('es-EC', {
  day: '2-digit', month: '2-digit', year: 'numeric',
})
const fmtDateTime = (iso) => new Date(iso).toLocaleString('es-EC', {
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
})

// =================== CSV ===================
export const exportCSV = ({ orders, rangeLabel }) => {
  const rows = [
    ['Pedido', 'Fecha', 'Hora', 'Cliente', 'Estado', 'Tipo', 'Pago', 'Mayo', 'Mayo extra', 'Subtotal', 'Delivery', 'Descuento', 'Promo', 'Total'].join(','),
    ...orders.map(o => {
      const d = new Date(o.created_at)
      return [
        o.order_number,
        fmtDate(o.created_at),
        d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false }),
        `"${(o.customer_name || '').replace(/"/g, '""')}"`,
        o.status,
        o.is_delivery ? 'delivery' : o.order_type,
        o.payment_method,
        o.with_mayo ? 'con' : 'sin',
        Number(o.mayo_extra || 0),
        Number(o.subtotal || 0).toFixed(2),
        Number(o.delivery_fee || 0).toFixed(2),
        Number(o.discount_amount || 0).toFixed(2),
        o.discount_type === 'student' ? 'estudiante' : '',
        Number(o.total || 0).toFixed(2),
      ].join(',')
    }),
  ].join('\n')

  const blob = new Blob([rows], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `chikin88-${rangeLabel}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// =================== Excel ===================
export const exportExcel = async ({ orders, expenses, kpis, top, monthly, profit, rangeLabel }) => {
  const XLSX = await import('xlsx')

  const wb = XLSX.utils.book_new()

  // Cálculos extra para el resumen
  const validForExtras = (orders || []).filter(o =>
    o.status !== 'cancelado' && o.deleted_from_reports !== true
  )
  const mayoExtraUnits = validForExtras.reduce((s, o) => s + Number(o.mayo_extra || 0), 0)
  const mayoExtraIncome = round2Money(mayoExtraUnits * 0.25)

  // Hoja 1: Resumen
  const resumen = [
    ['REPORTE CHIKIN88'],
    ['Rango', rangeLabel],
    ['Generado', new Date().toLocaleString('es-EC')],
    [],
    ['KPI', 'Valor'],
    ['Pedidos válidos', kpis.orderCount],
    ['Ingresos brutos', kpis.revenue],
    ['Delivery pagado', kpis.deliveryPaid || 0],
    ['Ingresos netos de venta', (kpis.netRevenue ?? (kpis.revenue - (kpis.deliveryPaid || 0)))],
    ['Gastos', kpis.expenses],
    ['Ganancia neta', kpis.profit],
    ['Ticket promedio', kpis.avgTicket],
    ['Efectivo', kpis.cash],
    ['Transferencia', kpis.transfer],
    ['Pedidos cancelados', kpis.cancelled],
    ['Pedidos promo estudiante', kpis.studentCount || 0],
    ['Descuento estudiante total', kpis.studentDiscount || 0],
    ['Mayonesa extra (unidades)', mayoExtraUnits],
    ['Mayonesa extra (ingresos)', mayoExtraIncome],
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), 'Resumen')

  // Hoja 2: Pedidos
  const pedidosHeader = ['Pedido', 'Fecha', 'Cliente', 'Teléfono', 'Estado', 'Tipo', 'Pago', 'Mayo', 'Mayo extra', 'Subtotal', 'Delivery', 'Descuento', 'Promo', 'Total']
  const pedidosRows = orders.map(o => [
    o.order_number,
    fmtDateTime(o.created_at),
    o.customer_name || '',
    o.customer_phone || '',
    o.status,
    o.is_delivery ? 'delivery' : o.order_type,
    o.payment_method,
    o.with_mayo ? 'con' : 'sin',
    Number(o.mayo_extra || 0),
    Number(o.subtotal || 0),
    Number(o.delivery_fee || 0),
    Number(o.discount_amount || 0),
    o.discount_type === 'student' ? 'estudiante' : '',
    Number(o.total || 0),
  ])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([pedidosHeader, ...pedidosRows]), 'Pedidos')

  // Hoja 3: Productos más vendidos
  const prodHeader = ['Posición', 'Producto', 'Categoría', 'Cantidad', 'Ingresos']
  const prodRows = top.map((p, i) => [i + 1, p.name, p.category, p.qty, p.revenue])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([prodHeader, ...prodRows]), 'Productos')

  // Hoja 4: Comparativa mensual
  if (monthly && monthly.length) {
    const monthlyHeader = ['Mes', 'Pedidos', 'Ingresos']
    const monthlyRows = monthly.map(m => [m.label, m.count, m.total])
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([monthlyHeader, ...monthlyRows]), 'Mensual')
  }

  // Hoja 5: Ganancia mensual
  if (profit && profit.length) {
    const profitHeader = ['Mes', 'Ingresos', 'Gastos', 'Ganancia']
    const profitRows = profit.map(p => [p.label, p.ingresos, p.gastos, p.ganancia])
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([profitHeader, ...profitRows]), 'Ganancias')
  }

  // Hoja 6: Gastos
  const gastosHeader = ['Fecha', 'Categoría', 'Descripción', 'Monto']
  const gastosRows = (expenses || []).map(e => [
    e.expense_date,
    e.category || 'general',
    e.description,
    Number(e.amount || 0),
  ])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([gastosHeader, ...gastosRows]), 'Gastos')

  XLSX.writeFile(wb, `chikin88-${rangeLabel}-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

// =================== PDF ===================
export const exportPDF = async ({ orders, kpis, top, profit, rangeLabel }) => {
  const { default: jsPDF } = await import('jspdf')
  await import('jspdf-autotable')

  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()

  // Mayonesa extra: agregamos un par de líneas al resumen.
  const validForExtras = (orders || []).filter(o =>
    o.status !== 'cancelado' && o.deleted_from_reports !== true
  )
  const mayoExtraUnits = validForExtras.reduce((s, o) => s + Number(o.mayo_extra || 0), 0)
  const mayoExtraIncome = round2Money(mayoExtraUnits * 0.25)

  // Cabecera con bloque rojo Chikin88
  doc.setFillColor(214, 40, 40) // chikin red
  doc.rect(0, 0, pageWidth, 26, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(22)
  doc.setFont('helvetica', 'bold')
  doc.text('CHIKIN88', 14, 12)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text('Reporte de ventas', 14, 19)
  doc.setTextColor(244, 211, 94) // chikin yellow
  doc.setFont('helvetica', 'bold')
  doc.text(rangeLabel.toUpperCase(), pageWidth - 14, 12, { align: 'right' })
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(`Generado: ${new Date().toLocaleString('es-EC')}`, pageWidth - 14, 19, { align: 'right' })

  doc.setTextColor(20, 20, 20)
  let y = 36

  // KPIs en cuadrícula
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text('Resumen', 14, y)
  y += 5

  const kpiRows = [
    ['Pedidos válidos', kpis.orderCount.toString()],
    ['Ingresos', fmtMoney(kpis.revenue)],
    ['Gastos', fmtMoney(kpis.expenses)],
    ['Ganancia neta', fmtMoney(kpis.profit)],
    ['Ticket promedio', fmtMoney(kpis.avgTicket)],
    ['Pedidos cancelados', kpis.cancelled.toString()],
    ['Pedidos promo estudiante', String(kpis.studentCount || 0)],
    ['Descuento estudiante total', fmtMoney(kpis.studentDiscount || 0)],
    ['Mayonesa extra (unidades)', String(mayoExtraUnits)],
    ['Mayonesa extra (ingresos)', fmtMoney(mayoExtraIncome)],
    ['Cobrado en efectivo', fmtMoney(kpis.cash)],
    ['Cobrado por transferencia', fmtMoney(kpis.transfer)],
  ]
  doc.autoTable({
    startY: y,
    head: [['Indicador', 'Valor']],
    body: kpiRows,
    theme: 'grid',
    headStyles: { fillColor: [40, 40, 40], textColor: [244, 211, 94] },
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
    margin: { left: 14, right: 14 },
  })
  y = doc.lastAutoTable.finalY + 8

  // Productos más vendidos
  if (top && top.length) {
    doc.setFontSize(13)
    doc.setFont('helvetica', 'bold')
    doc.text('Productos más vendidos', 14, y)
    y += 2
    doc.autoTable({
      startY: y + 2,
      head: [['#', 'Producto', 'Categoría', 'Cantidad', 'Ingresos']],
      body: top.map((p, i) => [i + 1, p.name, p.category || '-', p.qty, fmtMoney(p.revenue)]),
      theme: 'striped',
      headStyles: { fillColor: [214, 40, 40], textColor: [255, 255, 255] },
      styles: { fontSize: 9, cellPadding: 2.5 },
      columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right', fontStyle: 'bold' } },
      margin: { left: 14, right: 14 },
    })
    y = doc.lastAutoTable.finalY + 8
  }

  // Ganancia mensual (si aplica)
  if (profit && profit.some(p => p.ingresos || p.gastos)) {
    if (y > 220) { doc.addPage(); y = 20 }
    doc.setFontSize(13)
    doc.setFont('helvetica', 'bold')
    doc.text('Ganancia neta por mes', 14, y)
    doc.autoTable({
      startY: y + 2,
      head: [['Mes', 'Ingresos', 'Gastos', 'Ganancia']],
      body: profit.map(p => [p.label, fmtMoney(p.ingresos), fmtMoney(p.gastos), fmtMoney(p.ganancia)]),
      theme: 'striped',
      headStyles: { fillColor: [40, 40, 40], textColor: [244, 211, 94] },
      styles: { fontSize: 9, cellPadding: 2.5 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right', fontStyle: 'bold' } },
      margin: { left: 14, right: 14 },
    })
    y = doc.lastAutoTable.finalY + 8
  }

  // Detalle de pedidos (en página nueva si quedan muchos)
  if (orders && orders.length) {
    doc.addPage()
    doc.setFontSize(13)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(20, 20, 20)
    doc.text('Detalle de pedidos', 14, 18)
    doc.autoTable({
      startY: 22,
      head: [['#', 'Fecha', 'Cliente', 'Estado', 'Pago', 'Descuento', 'Total']],
      body: orders.map(o => [
        o.order_number,
        fmtDateTime(o.created_at),
        o.customer_name || '',
        o.status,
        o.payment_method,
        Number(o.discount_amount || 0) > 0
          ? `${o.discount_type === 'student' ? '🎓 ' : ''}${fmtMoney(o.discount_amount)}`
          : '-',
        fmtMoney(o.total),
      ]),
      theme: 'grid',
      headStyles: { fillColor: [214, 40, 40], textColor: [255, 255, 255] },
      styles: { fontSize: 8, cellPadding: 1.8 },
      columnStyles: { 5: { halign: 'right' }, 6: { halign: 'right', fontStyle: 'bold' } },
      margin: { left: 14, right: 14 },
    })
  }

  // Pie de página con número de página
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(150, 150, 150)
    doc.text(
      `Chikin88 · página ${i} de ${pageCount}`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 8,
      { align: 'center' },
    )
  }

  doc.save(`chikin88-${rangeLabel}-${new Date().toISOString().slice(0, 10)}.pdf`)
}
