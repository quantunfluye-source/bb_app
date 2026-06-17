-- ==========================================================
-- MIGRACIÓN DE CATEGORÍAS (FASE 2)
-- ==========================================================

-- 1. Crear la tabla de categorías
CREATE TABLE IF NOT EXISTS categorias (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre TEXT UNIQUE NOT NULL,
  orden INTEGER DEFAULT 0,
  visible_si_vacia BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Agregar la columna categoria_id a la tabla platillos
ALTER TABLE platillos ADD COLUMN IF NOT EXISTS categoria_id UUID REFERENCES categorias(id);

-- 3. Insertar categorías existentes (MIGRACIÓN DE DATOS)
-- Paso A: Asegurar que 'especial' esté primero con orden 0 y visible_si_vacia = true
INSERT INTO categorias (nombre, orden, visible_si_vacia)
SELECT DISTINCT categoria, 0, true
FROM platillos
WHERE categoria = 'especial'
ON CONFLICT (nombre) DO NOTHING;

-- Paso B: Insertar el resto de categorías con orden incremental empezando en 1
-- Usamos una subconsulta para obtener los nombres distintos que no sean 'especial'
INSERT INTO categorias (nombre, orden, visible_si_vacia)
SELECT 
  categoria, 
  ROW_NUMBER() OVER (ORDER BY MIN(created_at)) as orden, -- Intentamos mantener orden cronológico de aparición
  false
FROM platillos
WHERE categoria != 'especial'
GROUP BY categoria
ON CONFLICT (nombre) DO NOTHING;

-- 4. Vincular los platillos existentes con sus nuevas categorías
UPDATE platillos
SET categoria_id = categorias.id
FROM categorias
WHERE platillos.categoria = categorias.nombre;

-- 5. Opcional: Podrías querer crear un índice para mejorar las búsquedas
CREATE INDEX IF NOT EXISTS idx_platillos_categoria_id ON platillos(categoria_id);
CREATE INDEX IF NOT EXISTS idx_categorias_orden ON categorias(orden);
