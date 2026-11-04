import ExcelJS from 'exceljs';

const columns = [
  ['id', 'ID', 10], ['name', 'Nombre', 35], ['category', 'Categoría', 18],
  ['application', 'Aplicación', 18], ['models', 'Modelos', 30],
  ['description', 'Descripción', 50], ['price', 'Precio', 16], ['stock', 'Stock', 12],
  ['badge', 'Etiqueta', 18], ['image', 'Imagen', 40], ['status', 'Estado', 16], ['sold', 'Vendido', 12],
];
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const normalize = (value) => String(value).trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function createExcelHandler({ db, requireAdmin, sendJson, cleanProductPayload, listAdminProducts }) {
  return async function handleExcel(req, res, pathname) {
    if (!pathname.startsWith('/api/admin/excel/')) return false;
    const user = requireAdmin(req, res);
    if (!user) return true;

    if (req.method === 'GET' && ['/api/admin/excel/template', '/api/admin/excel/export'].includes(pathname)) {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Productos', { views: [{ state: 'frozen', ySplit: 1 }] });
      sheet.columns = columns.map(([key, header, width]) => ({ key, header, width }));
      if (pathname.endsWith('/export')) {
        for (const product of listAdminProducts()) sheet.addRow({ ...product,
          models: product.models.join(', '), image: product.image.startsWith('data:') ? '' : product.image,
          status: product.status === 'active' ? 'Activo' : 'Inactivo', sold: product.sold ? 'Sí' : 'No' });
      }
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF172C3E' } };
      sheet.getRow(1).height = 28;
      sheet.autoFilter = 'A1:L1';
      sheet.getColumn('price').numFmt = '#,##0';
      const instructions = workbook.addWorksheet('Instrucciones');
      instructions.getColumn(1).width = 115;
      [
        'CARGA DE PRODUCTOS — Cigliutti Guerini',
        'Completá la hoja Productos. No cambies los encabezados. Máximo 2000 productos por archivo y 5 MB.',
        'ID: vacío para crear. Para editar, exportá el catálogo y conservá sus IDs. No se identifica por nombre.',
        'Volver a subir filas sin ID crea nuevos productos. Después de importar, descargá el catálogo actualizado.',
        'Obligatorios: Nombre, Categoría, Aplicación, Modelos, Descripción, Precio y Stock.',
        'Categoría: Repuestos, Accesorios o Lubricantes. Aplicación: Camiones, Vans o Ambos.',
        'Modelos separados por coma: Accelo, Atego, Actros, Arocs, Axor (Camiones); Sprinter, Vito (Vans).',
        'Precio y Stock: números enteros iguales o mayores a cero. Usá celdas numéricas, sin símbolos de moneda.',
        'Etiqueta: Oferta, Nuevo, Destacado o vacío. Estado: Activo o Inactivo. Vendido: Sí o No.',
        'Estado vacío significa Activo; Vendido vacío significa No. En actualizaciones completá todos los datos.',
        'Imagen: URL http/https o ruta assets/products/. Vacío conserva la imagen existente; en altas queda sin imagen.',
        'Las imágenes adjuntadas desde el panel se omiten del Excel y se conservan al actualizar con Imagen vacía.',
        'No uses fórmulas ni fotos pegadas en celdas. Pegá los valores y la URL o ruta de la imagen.',
        'Se revisan todas las filas antes de guardar. Si hay errores, no se importa ningún producto.',
        'Los productos que no están en el archivo se conservan. La carga no elimina productos.',
      ].forEach((line) => instructions.addRow([line]));
      instructions.getRow(1).font = { bold: true, size: 16 };
      const buffer = await workbook.xlsx.writeBuffer();
      res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${pathname.endsWith('/export') ? 'catalogo' : 'plantilla-productos'}.xlsx"`, 'Cache-Control': 'no-store' });
      res.end(Buffer.from(buffer));
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/admin/excel/import') {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 5 * 1024 * 1024) throw fail('El archivo no puede superar los 5 MB.', 413);
        chunks.push(chunk);
      }
      const workbook = new ExcelJS.Workbook();
      try { await workbook.xlsx.load(Buffer.concat(chunks)); }
      catch { throw fail('No se pudo leer el Excel. Subí un archivo .xlsx válido y sin contraseña.'); }
      const sheet = workbook.getWorksheet('Productos');
      if (!sheet) throw fail('Falta la hoja Productos. Usá la plantilla descargable.');
      if (sheet.rowCount > 2001) throw fail('El archivo supera las 2000 filas.');
      const headers = new Map();
      sheet.getRow(1).eachCell((cell, index) => {
        const header = normalize(cell.text);
        if (headers.has(header)) throw fail(`Encabezado repetido: ${cell.text}`);
        headers.set(header, index);
      });
      for (const [, label] of columns) if (!headers.has(normalize(label))) throw fail(`Falta la columna ${label}.`);
      const rows = [], errors = [], ids = new Set();
      sheet.eachRow((row, number) => {
        if (number === 1) return;
        if (columns.every(([, label]) => !row.getCell(headers.get(normalize(label))).text.trim())) return;
        try {
          const payload = {};
          for (const [key, label] of columns) {
            const cell = row.getCell(headers.get(normalize(label)));
            if (cell.value !== null && typeof cell.value === 'object') throw fail(`${label}: usá texto o números simples, sin fórmulas.`);
            payload[key] = cell.value == null ? '' : String(cell.value).trim();
          }
          const id = payload.id === '' ? null : Number(payload.id);
          if (id !== null && (!Number.isSafeInteger(id) || id <= 0)) throw fail('ID inválido.');
          if (id && ids.has(id)) throw fail(`ID ${id} repetido.`);
          if (id) ids.add(id);
          const existing = id ? db.prepare('SELECT * FROM products WHERE id = ?').get(id) : null;
          if (id && !existing) throw fail(`El producto con ID ${id} no existe.`);
          for (const key of ['price', 'stock']) {
            if (!/^\d+$/.test(payload[key]) || !Number.isSafeInteger(Number(payload[key]))) throw fail(`${key === 'price' ? 'Precio' : 'Stock'}: ingresá un entero igual o mayor a cero.`);
          }
          for (const [key, allowed] of [['category', ['Repuestos', 'Accesorios', 'Lubricantes']], ['application', ['Camiones', 'Vans', 'Ambos']], ['badge', ['', 'Oferta', 'Nuevo', 'Destacado']]]) {
            const match = allowed.find((value) => normalize(value) === normalize(payload[key]));
            if (match === undefined) throw fail(`Valor inválido en ${columns.find(([k]) => k === key)[1]}.`);
            payload[key] = match;
          }
          const allModels = ['Accelo', 'Atego', 'Actros', 'Arocs', 'Axor', 'Sprinter', 'Vito'];
          payload.models = payload.models.split(/[,;]/).filter(Boolean).map((value) => allModels.find((model) => normalize(model) === normalize(value)) || value.trim());
          if (!['', 'activo', 'inactivo'].includes(normalize(payload.status))) throw fail('Estado: usá Activo o Inactivo.');
          if (!['', 'si', 'no'].includes(normalize(payload.sold))) throw fail('Vendido: usá Sí o No.');
          payload.status = normalize(payload.status) === 'inactivo' ? 'inactive' : 'active';
          payload.sold = normalize(payload.sold) === 'si';
          if (payload.image && !/^(https?:\/\/|assets\/products\/)/i.test(payload.image)) throw fail('Imagen: usá una URL http/https o una ruta assets/products/.');
          if (!payload.image) payload.image = existing?.image || '';
          const product = cleanProductPayload(payload);
          rows.push({ row: number, id, product });
        } catch (error) { errors.push({ row: number, message: error.message }); }
      });
      if (!rows.length && !errors.length) throw fail('El Excel no contiene productos.');
      if (errors.length) {
        sendJson(res, 400, { error: 'Corregí las filas indicadas. No se guardó ningún cambio.', errors });
        return true;
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const { id, product } of rows) {
          const values = [product.name, product.category, product.application, JSON.stringify(product.models), product.description,
            product.price, product.stock, product.badge, product.image, product.status, product.sold, new Date().toISOString()];
          if (id) db.prepare('UPDATE products SET name=?, category=?, application=?, models=?, description=?, price=?, stock=?, badge=?, image=?, status=?, sold=?, updated_at=? WHERE id=?').run(...values, id);
          else db.prepare('INSERT INTO products (name,category,application,models,description,price,stock,badge,image,status,sold,updated_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...values, values.at(-1));
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      sendJson(res, 200, { created: rows.filter((r) => !r.id).length, updated: rows.filter((r) => r.id).length });
      return true;
    }
    return false;
  };
}
