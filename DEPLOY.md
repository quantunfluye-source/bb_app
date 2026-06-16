# 🚀 Guía de Despliegue - Menú Express

## PASO 1 — SUPABASE

1. Ve a [supabase.com](https://supabase.com) → nuevo proyecto
2. En el editor SQL ejecuta el contenido de `supabase/schema.sql`
3. En **Storage** → crear bucket llamado `"menu-imagenes"`, marcar como público
4. Copia: **Project URL** y **service_role key** (Settings → API)
5. En **Authentication** → desactivar email confirmations (no se usan aquí)

## PASO 2 — VARIABLES DE ENTORNO

Crea tu `.env` local copiando `.env.example`:

```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
WHATSAPP_NUMBER=521XXXXXXXXXX   ← sin + ni espacios
ADMIN_PASSWORD=elige-una-clave-segura
PORT=3000
```

## PASO 3 — PRUEBA LOCAL

```bash
npm install
node server.js
```

Abre http://localhost:3000

## PASO 4 — GITHUB

1. Sube el proyecto a un repositorio GitHub
2. Verifica que `.env` y `uploads/` NO estén subidos (revisa `.gitignore`)

## PASO 5 — RENDER

1. Ve a [render.com](https://render.com) → **New** → **Web Service** → conecta el repo
2. **Build command**: `npm install`
3. **Start command**: `node server.js`
4. Agrega las 4 variables de entorno en el dashboard de Render:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `WHATSAPP_NUMBER`
   - `ADMIN_PASSWORD`
5. **Deploy**

## PASO 6 — CONFIGURACIÓN INICIAL DEL PANEL

1. Abre `https://tu-app.onrender.com/admin.html`
2. Pon tu `ADMIN_PASSWORD`
3. Configura:
   - Nombre de la tienda
   - Número de WhatsApp
   - Color primario
4. Agrega las categorías y platillos con sus fotos
5. Guarda el pie de página

## PASO 7 — INSTALAR COMO APP (Android)

1. Abre la app en Chrome
2. Toca el menú (3 puntos)
3. Selecciona **"Agregar a pantalla de inicio"**
4. El cliente verá un ícono igual que una app nativa ✅

---

## ⚠️ NOTAS IMPORTANTES

- **Render en plan gratuito** duerme el servidor después de 15 minutos sin tráfico
- Para producción real considera el **plan Starter ($7/mes)** o usa un pinger
- Las imágenes se guardan en **Supabase Storage** (no en Render), así que NO se pierden entre deploys
- El `.env` debe estar en el directorio raíz del servidor

