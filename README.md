# 🍗 Chikin88 POS

Sistema POS profesional para Chikin88 (Ibarra, Ecuador).
Funciona en celulares, tablets y computadoras con sincronización en tiempo real.

## Stack
- **React + Vite** · interfaz rápida y moderna
- **TailwindCSS** · diseño responsivo
- **Supabase** · base de datos PostgreSQL + Auth + Realtime
- **Resend** · envío automático de correos
- **Vercel** · hosting + cron jobs
- **Zustand** · estado global
- **Framer Motion** · animaciones
- **Lucide React** · iconos

## Roles
- **Admin** · acceso total + dashboard, gastos, reportes
- **Mesero** · crear/editar/cancelar pedidos
- **Cocina** · cambiar estados de los pedidos

## Funciones
- Pedidos en tiempo real (15+ pantallas simultáneas)
- Tarjetas que cambian de color según tiempo (verde → amarillo → tomate → rojo)
- Catálogo: Chikin, Ramen, Bebidas, Extras
- Salsas, mayonesa, palillos/tenedor, delivery, etc.
- Dashboard con ventas, gastos y ganancias
- Reporte diario automático por correo a las 22:15

## Instalación rápida (resumen)
1. `npm install`
2. Copia `.env.example` a `.env` y rellena con tus claves de Supabase
3. Ejecuta `supabase/schema.sql` en el SQL Editor de Supabase
4. `npm run dev`

> **Para instrucciones paso a paso desde cero, lee** [`INSTRUCCIONES.md`](./INSTRUCCIONES.md).
