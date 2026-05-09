# 🍗 CHIKIN88 — Manual de instalación completo

Este manual está pensado para que **cualquier persona, sin experiencia técnica**, pueda dejar el sistema funcionando en internet en aproximadamente **1 a 2 horas**.

Sigue los pasos **en orden, sin saltarte ninguno**. Si algo no funciona, revisa la sección **"Problemas comunes"** al final.

---

## 📋 Lo que vas a lograr al terminar

- ✅ El sistema corriendo en internet con un dominio que puedes compartir
- ✅ Base de datos profesional en la nube (gratis)
- ✅ Pedidos sincronizados en tiempo real entre todos los celulares y tablets
- ✅ Correo automático todos los días a las 22:15 con el resumen del día
- ✅ Roles configurados: Admin, Cocina, Mesero

---

## 🧰 PARTE 1 — Lo que necesitas tener antes de empezar

### 1.1 Cuentas gratuitas (crea las tres antes de continuar)

1. **GitHub** → https://github.com/signup
2. **Supabase** → https://supabase.com/dashboard/sign-up
3. **Vercel** → https://vercel.com/signup (entra **con tu cuenta de GitHub**, es lo más fácil)
4. **Resend** → https://resend.com/signup

> 💡 Usa el mismo correo en las cuatro para no confundirte.

### 1.2 Programas que tienes que instalar en tu computadora

#### **Node.js** (obligatorio)
- Ve a https://nodejs.org
- Descarga la versión **LTS** (la del lado izquierdo, el botón verde)
- Instálalo con todas las opciones por defecto (siguiente, siguiente, siguiente)
- Para confirmar que se instaló: abre la **Terminal** (Mac) o **PowerShell** (Windows) y escribe:
  ```
  node --version
  ```
  Debe aparecer algo como `v20.11.0`. Si aparece eso, está listo.

#### **Git** (obligatorio)
- **Windows**: descarga desde https://git-scm.com/download/win, instala con opciones por defecto
- **Mac**: abre Terminal y escribe `git --version`. Si te pide instalar las "Command Line Tools", acepta.

#### **Visual Studio Code** (recomendado, no obligatorio)
- Descarga desde https://code.visualstudio.com
- Te servirá para ver y editar los archivos del proyecto cómodamente

---

## 📦 PARTE 2 — Preparar el proyecto en tu computadora

### 2.1 Descomprimir el proyecto

1. Descomprime el archivo `chikin88-pos` que recibiste
2. Mueve la carpeta a un lugar fácil de encontrar, por ejemplo: `Documentos/chikin88-pos`

### 2.2 Abrir la terminal dentro de la carpeta

- **Windows**: entra a la carpeta `chikin88-pos`, mantén presionada la tecla **Shift** y haz clic derecho → "Abrir ventana de PowerShell aquí"
- **Mac**: entra a la carpeta, clic derecho → "Nueva Terminal en la carpeta"
- **VS Code**: abre VS Code, arrastra la carpeta dentro, y presiona `Ctrl + ñ` (Windows) o `Cmd + J` (Mac) para abrir la terminal

### 2.3 Instalar las dependencias

Dentro de la terminal, escribe:

```bash
npm install
```

Esto puede tardar **2 a 5 minutos**. Verás mucho texto pasando, es normal. Cuando termine sin errores rojos, listo.

---

## 🗄️ PARTE 3 — Crear la base de datos en Supabase

### 3.1 Crear el proyecto

1. Entra a https://supabase.com/dashboard
2. Clic en **"New project"**
3. Llena los datos:
   - **Name**: `chikin88`
   - **Database Password**: inventa una contraseña fuerte y **guárdala en un lugar seguro** (la vas a necesitar después si quieres acceder directo a la base)
   - **Region**: elige `South America (São Paulo)` (es la más cercana a Ecuador)
   - **Pricing Plan**: Free
4. Clic en **"Create new project"**
5. Espera 2-3 minutos a que termine de crearse (verás un cargando)

### 3.2 Cargar las tablas (el SQL del proyecto)

1. En el menú izquierdo de Supabase, busca el ícono **SQL Editor** (parece un papelito con `< >`)
2. Clic en **"+ New query"**
3. En tu computadora, abre el archivo `supabase/schema.sql` que está dentro del proyecto
4. **Copia TODO el contenido** del archivo (Ctrl+A, Ctrl+C)
5. Pégalo en el SQL Editor de Supabase
6. Clic en el botón verde **"Run"** (abajo a la derecha)
7. Debe aparecer abajo: **"Success. No rows returned"**

✅ Si ves ese mensaje, tu base de datos quedó lista con todas las tablas, productos cargados y reglas de seguridad.

### 3.3 Copiar las claves de Supabase (las vas a necesitar)

1. En el menú izquierdo, abajo, clic en **"Project Settings"** (ícono engranaje)
2. Submenú **"API"**
3. Verás dos cosas que necesitas anotar en un block de notas (los siguientes pasos te las pedirán):

| Lo que copias | Cómo se ve | Para qué sirve |
|---|---|---|
| **Project URL** | `https://xxxxxxxx.supabase.co` | Para conectar la app |
| **anon public key** | una llave larga que empieza con `eyJ...` | Clave pública (segura mostrarla) |
| **service_role key** | otra llave larga que empieza con `eyJ...` | 🔒 **SECRETA** — solo para el correo automático |

> ⚠️ La `service_role` es **secreta**. **Nunca la subas a GitHub ni la compartas**. Sólo se usa en Vercel.

### 3.4 Crear los usuarios (Admin, Cocina, Meseros)

1. En el menú izquierdo, clic en **"Authentication"** → **"Users"**
2. Botón **"Add user"** → **"Create new user"**
3. Ingresa:
   - **Email**: el correo del empleado (ej: `cindy@chikin88.com` o el que quieras)
   - **Password**: contraseña inicial (mínimo 6 caracteres)
   - **Auto Confirm User**: ✅ **márcalo activo** (importante)
4. **ANTES de hacer clic en "Create user"**, expande la sección **"User Metadata"** (puede que tengas que buscarla, según versión de Supabase)
5. En el campo **Raw user metadata**, escribe uno de estos textos según el rol:

   **Para administrador (tú):**
   ```json
   { "role": "admin", "full_name": "Cindy" }
   ```

   **Para empleados (cocineros, meseros, todo el personal operativo):**
   ```json
   { "role": "empleado", "full_name": "Nombre del empleado" }
   ```

6. Clic en **"Create user"**
7. Repite para cada empleado.

> 💡 **Si no aparece la opción de User Metadata en Supabase**: créalo primero, luego ve a la lista de usuarios → clic en los tres puntos `...` del usuario → "Edit user" → ahí encontrarás el campo de metadata.

> 🔑 **Roles y qué pueden ver:**
> - **admin**: ve y controla todo (pedidos, cocina, dashboard, gastos, reportes, puede borrar pedidos históricos, administra usuarios)
> - **empleado**: ve pedidos, crea pedidos, edita pedidos, ve cocina, cambia estados, marca pedidos como listos/entregados. NO ve ventas, ganancias, gastos ni reportes.

---

## 💻 PARTE 4 — Probar el sistema localmente

### 4.1 Crear el archivo de configuración

1. En la carpeta del proyecto, busca el archivo `.env.example`
2. **Cópialo** y renombra la copia como `.env` (sin punto al final, sin extensión)
3. Ábrelo con un editor de texto y reemplaza:

```
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...la-llave-larga-anon
```

> 📝 **Solo llena estas dos líneas por ahora**. Las otras (RESEND, SERVICE_ROLE) se llenan en Vercel, no en tu computadora.

### 4.2 Levantar el sistema

En la terminal (dentro de la carpeta del proyecto):

```bash
npm run dev
```

Verás algo como:

```
  ➜  Local:   http://localhost:5173/
```

Abre ese link en tu navegador. Debe aparecer la pantalla de login con el logo CHIKIN88.

### 4.3 Probar

1. Inicia sesión con el usuario admin que creaste
2. Crea un pedido de prueba en **"Nuevo pedido"**
3. Verifica que aparezca en **"Pedidos"** y en **"Cocina"**
4. Prueba cambiar el estado en cocina

✅ Si todo funciona, ¡felicidades! El sistema ya corre en tu computadora.

> Para detener: en la terminal presiona `Ctrl + C`

---

## 📤 PARTE 5 — Subir el proyecto a GitHub

### 5.1 Crear el repositorio

1. Entra a https://github.com/new
2. **Repository name**: `chikin88-pos`
3. **Privacy**: **Private** (importante, porque tiene tus configuraciones)
4. NO marques "Add a README"
5. Clic en **"Create repository"**

### 5.2 Subir el código

GitHub te mostrará una pantalla con varios comandos. Ignora eso y desde la **terminal en la carpeta de tu proyecto** ejecuta uno por uno:

```bash
git init
```
```bash
git add .
```
```bash
git commit -m "Primera version Chikin88"
```
```bash
git branch -M main
```
```bash
git remote add origin https://github.com/TU-USUARIO/chikin88-pos.git
```
> ⚠️ Cambia `TU-USUARIO` por tu nombre de usuario real de GitHub.

```bash
git push -u origin main
```

La primera vez te pedirá iniciar sesión en GitHub. Sigue las instrucciones en pantalla.

✅ Listo, refresca la página de tu repositorio y verás todos los archivos subidos.

> 🔒 **Importante**: el archivo `.env` **NO se sube** (está protegido por `.gitignore`). Las claves quedan solo en tu computadora y en Vercel.

---

## 📧 PARTE 6 — Configurar Resend para correos automáticos

### 6.1 Crear la API Key

1. Entra a https://resend.com/api-keys
2. Clic en **"Create API Key"**
3. **Name**: `chikin88-vercel`
4. **Permission**: `Sending access`
5. Clic en **"Add"**
6. **Copia la clave** (empieza con `re_...`) y guárdala. **No podrás verla otra vez.**

### 6.2 Verificar el dominio (opcional pero recomendado)

**Opción A — Sin dominio propio (más fácil, para empezar):**
- Resend te permite enviar usando `onboarding@resend.dev` como remitente
- Funciona inmediatamente, ya está configurado en el código por defecto
- Limitación: solo puede enviar a los correos que pongas en `REPORT_TO_EMAILS`, lo cual es perfecto para tu caso

**Opción B — Con dominio propio (chikin88.com por ejemplo):**
1. En Resend, ve a **"Domains"** → **"Add Domain"**
2. Escribe tu dominio (ej: `chikin88.com`)
3. Resend te dará varios registros DNS (TXT, MX, etc.)
4. Tienes que ir al lugar donde compraste el dominio (GoDaddy, Namecheap, etc.) y pegar esos registros en la zona DNS
5. Espera unos minutos y clic en **"Verify"**
6. Cuando esté verde, podrás usar `reportes@chikin88.com` como remitente

> 💡 **Recomendación**: empieza con Opción A. Cambia a B después si quieres.

---

## 🚀 PARTE 7 — Subir a Vercel (deploy a internet)

### 7.1 Importar el proyecto

1. Entra a https://vercel.com/new
2. Verás tus repositorios de GitHub. Busca `chikin88-pos`
3. Clic en **"Import"**
4. Te mostrará la pantalla de configuración

### 7.2 Configurar las variables de entorno

Antes de hacer clic en "Deploy", expande **"Environment Variables"** y agrega **todas estas, una por una**:

| Nombre | Valor | De dónde sale |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://xxxx.supabase.co` | Supabase → Settings → API |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbG...` | Supabase → Settings → API (anon) |
| `SUPABASE_URL` | `https://xxxx.supabase.co` | Igual que arriba |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbG...` | Supabase → Settings → API (service_role) ⚠️ secreta |
| `RESEND_API_KEY` | `re_...` | Resend → API Keys |
| `REPORT_FROM_EMAIL` | `Chikin88 <onboarding@resend.dev>` | (o tu dominio si lo verificaste) |
| `REPORT_TO_EMAILS` | `mbcesarisaac@gmail.com,titocindy22@gmail.com` | Sin espacios, separados por coma |
| `CRON_SECRET` | inventa una palabra secreta larga | Para proteger el envío del correo |

### 7.3 Deploy

1. Clic en el botón **"Deploy"** abajo
2. Espera 1-3 minutos
3. Cuando termine, te mostrará una pantalla de **"Congratulations 🎉"** con el link de tu sistema
4. La URL será algo como: `https://chikin88-pos.vercel.app`

✅ **¡Tu sistema ya está en internet!** Comparte ese link con tus empleados.

### 7.4 Verificar que el cron está activo

1. En tu proyecto en Vercel, ve a la pestaña **"Settings"** → **"Cron Jobs"**
2. Debe aparecer una línea: `/api/daily-report` cada día a las `03:15 UTC`
3. **¿Por qué 03:15 UTC?** Porque Ecuador está en `UTC-5`. Las **03:15 UTC = 22:15 hora Ecuador**. ✅

---

## 🌐 PARTE 8 — Conectar tu dominio propio (opcional, cuando quieras)

Si más adelante compras un dominio (`chikin88.com`, `chikin88.ec`, etc.):

1. En tu proyecto en Vercel → **Settings** → **Domains**
2. Clic en **"Add"**
3. Escribe tu dominio: `chikin88.com`
4. Vercel te dará dos opciones:
   - **Si compraste el dominio en otro lado** (GoDaddy, Namecheap, NIC.ec): te mostrará un registro **A** o **CNAME** que tienes que pegar en tu proveedor del dominio
   - Sigue las instrucciones que te muestra Vercel — son específicas según tu caso
5. Espera entre 5 minutos y 24 horas a que el DNS se propague
6. Cuando aparezca un check verde ✅, tu sistema funcionará en `chikin88.com`

> 💡 **Tip**: agrega también `www.chikin88.com` por si alguien lo escribe con el `www.`

---

## 📨 PARTE 9 — Probar el correo automático

### 9.1 Esperar a las 22:15 hora Ecuador
El correo llegará automáticamente todos los días a esa hora a:
- mbcesarisaac@gmail.com
- titocindy22@gmail.com

### 9.2 Probarlo manualmente sin esperar

Si quieres comprobar que el correo funciona ahora mismo (sin esperar a las 10:15 PM):

1. Abre la terminal de tu computadora
2. Ejecuta este comando reemplazando los valores tuyos:

```bash
curl -X POST https://TU-PROYECTO.vercel.app/api/daily-report -H "Authorization: Bearer TU_CRON_SECRET"
```

> Reemplaza `TU-PROYECTO` por tu URL real y `TU_CRON_SECRET` por el valor exacto que pusiste en Vercel.

3. Si responde algo como `{"ok":true}`, revisa los correos. Debe llegar el reporte.

---

## 👥 PARTE 10 — Cómo se usa el sistema (para tus empleados)

### Para el dueño/admin (tú):
- **Pedidos**: ver todos los pedidos activos del día
- **Cocina**: pantalla a colores para preparación
- **Nuevo pedido**: crear un pedido (si lo necesitas)
- **Dashboard**: ventas, gastos, ganancias del día/semana/mes
- **Gastos**: registrar gastos diarios
- **Reportes**: descargar CSV con todos los pedidos
- Borrar pedidos históricos (en estado entregado o cancelado)

### Para los empleados:
- **Pedidos**: ven todos los pedidos del día y pueden editarlos
- **Nuevo pedido**: crean pedidos desde el celular en segundos
- **Cocina**: pantalla a colores con tarjetas que cambian según los minutos:
  - 🟢 **Verde** = 0 a 10 min (recién hecho)
  - 🟡 **Amarillo** = 11 a 20 min (atento)
  - 🟠 **Tomato** = 21 a 30 min (apurarse)
  - 🔴 **Rojo pulsante** = +31 min (¡urgente!)
- Botones grandes para mover el estado: Pendiente → En preparación → Listo → Entregado
- NO pueden ver dashboard, ventas, ganancias, gastos ni reportes

---

## 🩹 Problemas comunes

### "No puedo iniciar sesión"
- Verifica que el usuario esté creado en Supabase → Authentication → Users
- Que tenga **"Email Confirmed"** en verde
- Que la metadata tenga el `role` correcto

### "Los pedidos no se actualizan en tiempo real"
- Ve a Supabase → Database → Replication
- Verifica que `orders`, `order_items` y `expenses` tengan el toggle activo
- (El SQL ya lo activa, pero revísalo si dudas)

### "No me llega el correo"
- Revisa la carpeta de spam
- En Resend → **Emails** verás un log de todos los envíos. Si dice "delivered", el correo salió bien
- En Vercel → **Logs** verás si la función `daily-report` se ejecutó

### "Aparece error 'Permission denied' al crear un pedido"
- El usuario que está usando el sistema no tiene rol válido. Edita su metadata en Supabase y agrega `{"role":"mesero"}` o `{"role":"admin"}`

### "La página dice 'Application error'"
- Probablemente falta una variable de entorno en Vercel
- Vercel → tu proyecto → Settings → Environment Variables
- Revisa que estén las 8 variables de la tabla en la Parte 7.2
- Después de agregarlas: pestaña **Deployments** → tres puntos del último deploy → **Redeploy**

### "Cambié algo y quiero subirlo"
Desde la terminal del proyecto:
```bash
git add .
git commit -m "lo que cambiaste"
git push
```
Vercel detecta el push automáticamente y vuelve a publicar en 1-2 minutos.

---

## 📞 Resumen rápido para mañana cuando lo abras de nuevo

1. **Para correr local**: `npm run dev` en la terminal del proyecto
2. **Para ver el sistema en internet**: la URL de Vercel (chikin88-pos.vercel.app)
3. **Para ver/editar la base de datos**: https://supabase.com/dashboard
4. **Para crear nuevos empleados**: Supabase → Authentication → Users → Add user (con metadata)
5. **Para ver correos enviados**: https://resend.com/emails

---

## 💰 Costos esperados

| Servicio | Plan | Costo mensual |
|---|---|---|
| Supabase | Free | $0 (sube a $25 si tienes mucho tráfico) |
| Vercel | Hobby | $0 (suficiente para un restaurante) |
| Resend | Free | $0 (3000 correos/mes — más que suficiente) |
| Dominio propio (opcional) | — | $10-15 al año |

**Total: $0/mes** mientras seas un restaurante normal. 🎉

---

¡Éxitos con Chikin88! 🍗🔥
