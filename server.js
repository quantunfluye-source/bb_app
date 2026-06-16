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
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// Middleware de autenticación
const requireAdminAuth = (req, res, next) => {
  const adminPassword = req.headers['x-admin-password'];
  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
};

// ============= ENDPOINTS PÚBLICOS =============

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

// GET /api/menu - Devuelve platillos activos agrupados por categoría
app.get('/api/menu', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('platillos')
      .select('*')
      .eq('activo', true)
      .order('orden', { ascending: true });
    
    if (error) throw error;
    
    const menu = {};
    data.forEach(platillo => {
      if (!menu[platillo.categoria]) {
        menu[platillo.categoria] = [];
      }
      menu[platillo.categoria].push(platillo);
    });
    
    res.json(menu);
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

// POST /api/admin/platillo - Crea platillo
app.post('/api/admin/platillo', requireAdminAuth, async (req, res) => {
  try {
    const { categoria, nombre, descripcion, precio, imagen_url, orden } = req.body;
    
    if (!categoria || !nombre || precio === undefined) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }
    
    const { data, error } = await supabase
      .from('platillos')
      .insert({
        categoria,
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
    const { categoria, nombre, descripcion, precio, imagen_url, orden, activo } = req.body;
    
    const updates = {};
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
    
    const fileBuffer = fs.readFileSync(req.file.path);
    const fileName = `${Date.now()}-${req.file.originalname}`;
    
    const { data, error } = await supabase
      .storage
      .from('menu-imagenes')
      .upload(fileName, fileBuffer, {
        contentType: req.file.mimetype
      });
    
    if (error) throw error;
    
    // Obtener URL pública
    const { data: urlData } = supabase
      .storage
      .from('menu-imagenes')
      .getPublicUrl(fileName);
    
    // Limpiar archivo temporal
    fs.unlinkSync(req.file.path);
    
    res.json({ url: urlData.publicUrl });
  } catch (error) {
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {}
    }
    res.status(500).json({ error: error.message });
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
  console.log(`✓ Supabase URL: ${process.env.SUPABASE_URL ? '✓' : '✗'}`);
});
