import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'image/heic',
  'image/heif',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);

const sanitizeFileName = (name) =>
  name
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

// Inicializar Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'uploads')));

// Configurar multer
const upload = multer({
  dest: path.join(__dirname, 'uploads'),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const mimetype = (file.mimetype || '').toLowerCase();
    const isImageMime = mimetype.startsWith('image/');
    const isKnownImageMime = IMAGE_MIME_TYPES.has(mimetype);
    const hasImageExtension = /\.(jpe?g|png|gif|webp|avif|bmp|tiff?|heic|heif|svg|ico)$/i.test(file.originalname || '');

    if (isImageMime || isKnownImageMime || hasImageExtension) {
      cb(null, true);
      return;
    }

    cb(null, false);
  }
});

// Middleware de autenticación
const requireAdminAuth = (req, res, next) => {
  const adminPassword = req.headers['x-admin-password'];
  
  // LOGS DE DEPURACIÓN (Temporal)
  console.log('--- DEBUG AUTH ---');
  console.log('Password recibida (longitud):', adminPassword ? adminPassword.length : 'null');
  console.log('Password esperada (longitud):', process.env.ADMIN_PASSWORD ? process.env.ADMIN_PASSWORD.length : 'null');
  
  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    console.log('❌ Autenticación fallida');
    return res.status(401).json({ error: 'No autorizado' });
  }
  console.log('✅ Autenticación exitosa');
  next();
};

// Función genérica para subir a Supabase Storage
async function uploadToSupabase(file, folder = '') {
  if (!file) throw new Error('No se subió ningún archivo');
  
  const fileBuffer = fs.readFileSync(file.path);
  const originalExt = path.extname(file.originalname || '').toLowerCase();
  const safeBaseName = sanitizeFileName(path.basename(file.originalname || 'imagen', originalExt)) || 'imagen';
  const safeExt = originalExt && originalExt.length <= 8 ? originalExt : '';
  const fileName = `${folder}${Date.now()}-${safeBaseName}${safeExt}`;
  
  const { data, error } = await supabase
    .storage
    .from('menu-imagenes')
    .upload(fileName, fileBuffer, {
      contentType: file.mimetype,
      upsert: false
    });
  
  if (error) {
    console.error('❌ Error Supabase Storage:', error);
    throw new Error(`Supabase Storage error: ${error.message}`);
  }
  
  const { data: urlData } = supabase
    .storage
    .from('menu-imagenes')
    .getPublicUrl(fileName);
    
  return { fileName, publicUrl: urlData.publicUrl };
}

// ============= ENDPOINTS PÚBLICOS =============

// POST /api/upload/cliente-foto - Sube foto de cliente (Público, 3MB limit)
const uploadCliente = multer({
  dest: path.join(__dirname, 'uploads'),
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB
  fileFilter: (req, file, cb) => {
    const mimetype = (file.mimetype || '').toLowerCase();
    if (mimetype.startsWith('image/') || IMAGE_MIME_TYPES.has(mimetype)) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  }
});

app.post('/api/upload/cliente-foto', uploadCliente.single('imagen'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ningún archivo' });
    }
    
    console.log(`👤 Subiendo foto de cliente: ${req.file.originalname}`);
    
    const result = await uploadToSupabase(req.file, 'clientes/');
    
    // Limpiar archivo temporal
    fs.unlinkSync(req.file.path);
    
    console.log('✅ Foto de cliente subida:', result.fileName);
    console.log('🔗 URL pública:', result.publicUrl);
    
    res.json({ url: result.publicUrl });
  } catch (error) {
    console.error('Client upload error:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    res.status(500).json({ error: `Upload failed: ${error.message}` });
  }
});

// GET /api/config - Devuelve config como objeto clave-valor
app.get('/api/config', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('config')
      .select('*');
    
    if (error) throw error;
    
    const config = {};
    data.forEach(row => {
      config[row.key] = row.value;
    });
    
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/categorias - Devuelve lista de categorías ordenadas
app.get('/api/categorias', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('categorias')
      .select('*')
      .order('orden', { ascending: true });
    
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/menu - Devuelve platillos activos agrupados por categoría (respeta orden de categorías)
app.get('/api/menu', async (req, res) => {
  try {
    // 1. Obtener categorías ordenadas
    const { data: categorias, error: catError } = await supabase
      .from('categorias')
      .select('*')
      .order('orden', { ascending: true });
    
    if (catError) throw catError;

    // 2. Obtener todos los platillos activos
    const { data: platillos, error: platError } = await supabase
      .from('platillos')
      .select('*')
      .eq('activo', true)
      .order('orden', { ascending: true });
    
    if (platError) throw platError;
    
    // 3. Agrupar platillos por su nombre de categoría (para mantener compatibilidad con el frontend)
    const menu = {};
    
    // Inicializar el objeto con todas las categorías en orden
    categorias.forEach(cat => {
      menu[cat.nombre] = [];
    });

    // Repartir platillos
    platillos.forEach(p => {
      // Intentar encontrar el nombre de la categoría por ID
      const cat = categorias.find(c => c.id === p.categoria_id);
      const catNombre = cat ? cat.nombre : (p.categoria || 'Sin Categoría');
      
      if (!menu[catNombre]) menu[catNombre] = [];
      menu[catNombre].push(p);
    });

    // 4. Filtrar categorías vacías que NO tengan visible_si_vacia = true
    const menuFiltrado = {};
    categorias.forEach(cat => {
      const tienePlatillos = menu[cat.nombre].length > 0;
      if (tienePlatillos || cat.visible_si_vacia) {
        menuFiltrado[cat.nombre] = menu[cat.nombre];
      }
    });
    
    res.json(menuFiltrado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/clientes - Crea o actualiza cliente (upsert)
app.post('/api/clientes', async (req, res) => {
  try {
    const { session_id, nombre, direccion, telefono, foto_url } = req.body;
    
    if (!session_id || !nombre || !direccion) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }
    
    const { data, error } = await supabase
      .from('clientes')
      .upsert({
        session_id,
        nombre,
        direccion,
        telefono: telefono || null,
        foto_url: foto_url || null,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'session_id'
      })
      .select();
    
    if (error) throw error;
    
    res.json(data[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/clientes - Devuelve todos los clientes (público)
app.get('/api/clientes', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('clientes')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/clientes/:session_id - Devuelve datos del cliente
app.get('/api/clientes/:session_id', async (req, res) => {
  try {
    const { session_id } = req.params;
    
    const { data, error } = await supabase
      .from('clientes')
      .select('*')
      .eq('session_id', session_id)
      .single();
    
    if (error && error.code === 'PGRST116') {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    
    if (error) throw error;
    
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============= ENDPOINTS CON AUTENTICACIÓN =============

// POST /api/admin/verificar - Verifica si la contraseña es correcta
app.post('/api/admin/verificar', requireAdminAuth, async (req, res) => {
  res.json({ ok: true });
});

// POST /api/admin/config - Guarda clave-valor en config
app.post('/api/admin/config', requireAdminAuth, async (req, res) => {
  try {
    const { key, value } = req.body;
    
    if (!key || value === undefined) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }
    
    const { data, error } = await supabase
      .from('config')
      .upsert({ key, value }, { onConflict: 'key' })
      .select();
    
    if (error) throw error;
    
    res.json(data[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Endpoints de Clientes (Admin) ---

// DELETE /api/admin/clientes/:id - Eliminar cliente
app.delete('/api/admin/clientes/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const { error } = await supabase
      .from('clientes')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ message: 'Cliente eliminado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Endpoints de Categorías (Admin) ---

// POST /api/admin/categorias - Crear categoría
app.post('/api/admin/categorias', requireAdminAuth, async (req, res) => {
  try {
    const { nombre, orden, visible_si_vacia } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });

    const { data, error } = await supabase
      .from('categorias')
      .insert({ nombre, orden: orden || 0, visible_si_vacia: !!visible_si_vacia })
      .select();

    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/categorias/:id - Editar categoría
app.put('/api/admin/categorias/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, orden, visible_si_vacia } = req.body;

    const { data, error } = await supabase
      .from('categorias')
      .update({ nombre, orden, visible_si_vacia })
      .eq('id', id)
      .select();

    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/categorias/reordenar - Reordenar múltiples categorías en una sola petición
app.put('/api/admin/categorias/reordenar', requireAdminAuth, async (req, res) => {
  try {
    const { cambios } = req.body; // Array de { id, orden }
    if (!Array.isArray(cambios)) return res.status(400).json({ error: 'Cambios requeridos' });

    const promises = cambios.map(c => 
      supabase.from('categorias').update({ orden: c.orden }).eq('id', c.id)
    );

    const results = await Promise.all(promises);
    const errors = results.filter(r => r.error);
    if (errors.length > 0) throw errors[0].error;

    res.json({ message: 'Categorías reordenadas' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/categorias/:id - Eliminar categoría
app.delete('/api/admin/categorias/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Opcional: Verificar si hay platillos vinculados antes de borrar
    const { count, error: countError } = await supabase
      .from('platillos')
      .select('*', { count: 'exact', head: true })
      .eq('categoria_id', id)
      .eq('activo', true);

    if (countError) throw countError;
    if (count > 0) {
      return res.status(400).json({ error: 'No se puede borrar una categoría con platillos activos' });
    }

    const { error } = await supabase
      .from('categorias')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ message: 'Categoría eliminada' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Endpoints de Platillos (Admin) ---

// POST /api/admin/platillo - Crea platillo
app.post('/api/admin/platillo', requireAdminAuth, async (req, res) => {
  try {
    const { categoria_id, categoria, nombre, descripcion, precio, imagen_url, orden } = req.body;
    
    if (!nombre || precio === undefined) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }
    
    const { data, error } = await supabase
      .from('platillos')
      .insert({
        categoria_id: categoria_id || null,
        categoria: categoria || null, // Mantener texto por ahora
        nombre,
        descripcion: descripcion || null,
        precio: parseFloat(precio),
        imagen_url: imagen_url || null,
        orden: orden || 0,
        activo: true
      })
      .select();
    
    if (error) throw error;
    
    res.json(data[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/platillo/:id - Edita platillo
app.put('/api/admin/platillo/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { categoria_id, categoria, nombre, descripcion, precio, imagen_url, orden, activo } = req.body;
    
    const updates = {};
    if (categoria_id !== undefined) updates.categoria_id = categoria_id;
    if (categoria !== undefined) updates.categoria = categoria;
    if (nombre !== undefined) updates.nombre = nombre;
    if (descripcion !== undefined) updates.descripcion = descripcion;
    if (precio !== undefined) updates.precio = parseFloat(precio);
    if (imagen_url !== undefined) updates.imagen_url = imagen_url;
    if (orden !== undefined) updates.orden = orden;
    if (activo !== undefined) updates.activo = activo;
    
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }
    
    const { data, error } = await supabase
      .from('platillos')
      .update(updates)
      .eq('id', id)
      .select();
    
    if (error) throw error;
    if (data.length === 0) {
      return res.status(404).json({ error: 'Platillo no encontrado' });
    }
    
    res.json(data[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/platillos/reordenar - Reordenar múltiples platillos en una sola petición
app.put('/api/admin/platillos/reordenar', requireAdminAuth, async (req, res) => {
  try {
    const { cambios } = req.body; // Array de { id, orden, categoria_id }
    if (!Array.isArray(cambios)) return res.status(400).json({ error: 'Cambios requeridos' });

    const promises = cambios.map(c => {
      const updates = { orden: c.orden };
      if (c.categoria_id) updates.categoria_id = c.categoria_id;
      return supabase.from('platillos').update(updates).eq('id', c.id);
    });

    const results = await Promise.all(promises);
    const errors = results.filter(r => r.error);
    if (errors.length > 0) throw errors[0].error;

    res.json({ message: 'Platillos reordenados' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/platillo/:id - Marca platillo como inactivo
app.delete('/api/admin/platillo/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('platillos')
      .update({ activo: false })
      .eq('id', id)
      .select();
    
    if (error) throw error;
    if (data.length === 0) {
      return res.status(404).json({ error: 'Platillo no encontrado' });
    }
    
    res.json({ message: 'Platillo eliminado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/upload/imagen - Sube imagen a Supabase Storage
app.post('/api/upload/imagen', requireAdminAuth, upload.single('imagen'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ningún archivo' });
    }
    
    console.log(`📸 Subiendo imagen: ${req.file.originalname}`);
    
    const fileBuffer = fs.readFileSync(req.file.path);
    const originalExt = path.extname(req.file.originalname || '').toLowerCase();
    const safeBaseName = sanitizeFileName(path.basename(req.file.originalname || 'imagen', originalExt)) || 'imagen';
    const safeExt = originalExt && originalExt.length <= 8 ? originalExt : '';
    const fileName = `${Date.now()}-${safeBaseName}${safeExt}`;
    
    const { data, error } = await supabase
      .storage
      .from('menu-imagenes')
      .upload(fileName, fileBuffer, {
        contentType: req.file.mimetype,
        upsert: false
      });
    
    if (error) {
      console.error('❌ Error Supabase Storage:', error);
      throw new Error(`Supabase Storage error: ${error.message}`);
    }
    
    console.log('✅ Imagen subida:', fileName);
    
    // Obtener URL pública
    const { data: urlData } = supabase
      .storage
      .from('menu-imagenes')
      .getPublicUrl(fileName);
    
    // Limpiar archivo temporal
    fs.unlinkSync(req.file.path);
    
    console.log('🔗 URL pública:', urlData.publicUrl);
    res.json({ url: urlData.publicUrl });
  } catch (error) {
    console.error('Upload error:', error);
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {}
    }
    res.status(500).json({ error: `Upload failed: ${error.message}` });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK' });
});

// Error handler para rutas no encontradas
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`✓ Servidor corriendo en http://localhost:${PORT}`);
  console.log(`✓ Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`✓ Supabase URL: ${process.env.SUPABASE_URL ? '✓ Conectado' : '✗ NO configurado'}`);
  console.log(`✓ Service Key: ${process.env.SUPABASE_SERVICE_KEY ? '✓ Configurada' : '✗ NO configurada'}`);
});
