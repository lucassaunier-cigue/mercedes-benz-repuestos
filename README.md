# Catálogo de Posventa

Demo funcional para Cigliutti Guerini | Mercedes-Benz Camiones y Vans.

Incluye:

- Catálogo público sin inicio de sesión.
- Panel de administración protegido por login.
- Base de datos SQLite local.
- Alta, edición, marcado como vendido y baja/reactivación de productos.
- Importación y exportación masiva mediante Excel.
- Configuración por variables de entorno, health check y respaldo de SQLite.

## Cómo verlo localmente

Desde esta carpeta:

```bash
npm start
```

Luego abrir:

```text
http://localhost:8080
```

Panel de administración:

```text
http://localhost:8080/admin.html
```

Para publicar, seguí [DEPLOYMENT.md](DEPLOYMENT.md). El proyecto incluye `Dockerfile`, health check en `/api/health` y el comando `npm run backup`.

Credenciales iniciales de demo:

```text
Email: posventa@cigue.com.ar
Contraseña: Puente.12
```

También se pueden cambiar al iniciar el servidor:

```bash
ADMIN_EMAIL="admin@empresa.com" ADMIN_PASSWORD="otra-clave" npm start
```

Las credenciales por variable de entorno solo se usan para crear el primer admin si la base está vacía.

## Base de datos

La base SQLite se crea automáticamente en:

```text
data/catalog.sqlite
```

La primera vez que se inicia el servidor, los productos existentes de `products.json` se importan a la base.

## Cómo editar productos desde el panel

Desde `/admin.html`, el usuario administrador puede:

- Crear productos.
- Editar productos existentes.
- Marcar o desmarcar como vendido.
- Dar de baja o reactivar productos.

Valores recomendados:

- `category`: `Repuestos`, `Accesorios` o `Lubricantes`.
- `application`: `Camiones`, `Vans` o `Ambos`.
- `models`: uno o varios modelos compatibles. El panel cambia las opciones según la aplicación:
  - Camiones: `Accelo`, `Atego`, `Actros`, `Arocs`, `Axor`.
  - Vans: `Sprinter`, `Vito`.
  - Ambos: muestra todos los modelos anteriores.
- `badge`: `Oferta`, `Nuevo`, `Destacado` o vacío (`""`).
- `price`: número sin puntos ni símbolo de moneda.
- `stock`: cantidad disponible, número entero igual o mayor a 0.
- `image`: ruta a una imagen dentro de `assets/products/` o una imagen adjuntada desde el panel.

El panel permite adjuntar imágenes PNG, JPG, WebP o SVG de hasta 4 MB. Al adjuntarlas, se guardan en la base SQLite como datos embebidos para que la demo no dependa de subir archivos manualmente.

## Carga masiva desde Excel

En el panel de administración, usá **Productos desde Excel**:

1. Descargá la plantilla `.xlsx` para altas o exportá el catálogo para editar productos existentes.
2. Completá la hoja `Productos`. La hoja `Instrucciones` detalla columnas y valores permitidos.
3. Seleccioná el archivo y presioná **Importar Excel**. El sistema valida y guarda directamente, sin revisión ni confirmación manual.
Si hay errores, se indican las filas para corregir y no se guarda ningún cambio.

El ID identifica productos existentes. Una fila sin ID crea un producto nuevo, incluso si su nombre coincide con otro. Después de importar altas, exportá el catálogo para obtener sus IDs antes de editar y volver a subir. Los productos ausentes en el archivo se conservan.

Se admiten hasta 2000 filas y 5 MB, números enteros para precio/stock y modelos separados por comas. No se aceptan fórmulas. Las imágenes se indican mediante URL o ruta `assets/products/`; una celda vacía conserva la imagen actual. Las imágenes embebidas del panel no se incluyen en la exportación. El resto de los campos se reemplaza por los valores del Excel; Estado vacío equivale a Activo y Vendido vacío a No.

La carga usa un único `POST /api/admin/excel/import` con el archivo como cuerpo. Los errores no producen importaciones parciales.

Instalación de dependencias: `npm install`. Para pruebas aisladas se puede configurar `DATA_DIR` con una carpeta temporal.

## Contacto público

El email y WhatsApp se configuran con `CONTACT_EMAIL`, `WHATSAPP_NUMBER` y `WHATSAPP_LABEL`. El número debe escribirse en formato internacional, sin `+`, espacios ni guiones. Si no se configura, los botones de WhatsApp permanecen ocultos.
