# Publicación del catálogo

El proyecto está preparado para ejecutarse como contenedor Docker con almacenamiento persistente. La base SQLite y las imágenes adjuntadas desde el panel quedan dentro de `DATA_DIR`, por lo que esa carpeta debe montarse en un disco persistente.

## Variables obligatorias

Copiá `.env.example` como referencia y configurá en el proveedor:

- `NODE_ENV=production`
- `ADMIN_EMAIL`: usuario del panel.
- `ADMIN_PASSWORD`: contraseña larga y única. El servidor no inicia en producción con la contraseña de demostración.
- `CONTACT_EMAIL`: email público de Posventa.
- `WHATSAPP_NUMBER`: formato internacional, sólo números.
- `WHATSAPP_LABEL`: número como debe mostrarse en pantalla.
- `DATA_DIR`: carpeta montada en disco, por ejemplo `/var/data/catalog`.

## Requisitos del hosting

1. Ejecutar el `Dockerfile` incluido y publicar el puerto indicado por `PORT`.
2. Montar un volumen persistente en el mismo valor de `DATA_DIR`.
3. Configurar HTTPS y un dominio propio.
4. Usar `/api/health` como health check.
5. Programar una copia diaria con `npm run backup` y copiar la carpeta `DATA_DIR/backups` a almacenamiento externo.

## Verificación posterior

1. Abrir `/` y confirmar productos, filtros, búsquedas y enlaces de contacto.
2. Abrir `/admin.html`, iniciar sesión y cambiar un producto de prueba.
3. Descargar la plantilla, importar una fila y exportar el catálogo.
4. Reiniciar el servicio y confirmar que productos y sesiones se conservan.
5. Probar el dominio en celular y verificar que WhatsApp abra el número real.

## Alternativa de base administrada

SQLite es suficiente para un catálogo con un solo administrador si el hosting ofrece disco persistente y una sola instancia. Si se necesitan varias instancias, múltiples administradores simultáneos o alta disponibilidad, conviene migrar los datos a PostgreSQL/Supabase antes de publicar.

## DonWeb / Ferozo compartido

Para el hosting Apache de `repuestos.cigue.com.ar`, ejecutá `npm run build:donweb`. El paquete listo queda en `output/donweb/` e incluye:

- `repuestos/`: carpeta que se copia dentro de `public_html`.
- `AGREGAR-AL-HTACCESS-PRINCIPAL.txt`: regla de host para sumar antes de las reglas de BYD, Kurasu y Grupo Cigliutti Guerini.
- `LEEME.txt`: orden de publicación y activación de HTTPS.

Antes de abrir el sitio, copiá `config.local.example.php` como `config.local.php` y completá la contraseña y los datos reales. La API pública devuelve 503 fuera de localhost si ese archivo no existe, para impedir una publicación accidental con la clave de demostración.
