import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = process.cwd();
const output = resolve(root, 'output/donweb');
const site = join(output, 'repuestos');

await rm(output, { recursive: true, force: true });
await mkdir(join(site, 'assets/vendor'), { recursive: true });
await mkdir(join(site, 'data'), { recursive: true });

for (const file of ['index.html', 'admin.html', 'styles.css', 'script.js', 'admin.js', 'products.json', 'mercedes-brand-logo-symbol-white-design-german-car-automobile-illustration-with-black-background-free-vector.jpg']) {
  await cp(join(root, file), join(site, file));
}
await cp(join(root, 'assets'), join(site, 'assets'), { recursive: true });
await cp(join(root, 'node_modules/exceljs/dist/exceljs.min.js'), join(site, 'assets/vendor/exceljs.min.js'));
for (const file of ['api.php', 'config.php', 'config.local.example.php', '.htaccess']) await cp(join(root, 'donweb', file), join(site, file));
await cp(join(root, 'donweb/data.htaccess'), join(site, 'data/.htaccess'));
await cp(join(root, 'donweb/router.php'), join(site, 'router.php'));

const rootRules = `# Repuestos Cigliutti Guerini — agregar antes de las reglas de BYD/Kurasu/Grupo\nRewriteCond %{HTTP_HOST} ^repuestos\\.cigue\\.com\\.ar(?::\\d+)?$ [NC]\nRewriteCond %{REQUEST_URI} !^/repuestos(?:/|$) [NC]\nRewriteRule ^(.*)$ repuestos/$1 [L]\n\n# Activar este bloque recién después de emitir el SSL en Ferozo:\n# RewriteCond %{HTTP_HOST} ^repuestos\\.cigue\\.com\\.ar$ [NC]\n# RewriteCond %{HTTPS} off\n# RewriteCond %{REQUEST_URI} !^/\\.well-known/acme-challenge/\n# RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L,NE]\n`;
await writeFile(join(output, 'AGREGAR-AL-HTACCESS-PRINCIPAL.txt'), rootRules);
await writeFile(join(output, 'LEEME.txt'), `1. Copiar la carpeta repuestos dentro de public_html.\n2. ANTES DE ABRIR EL SITIO: copiar config.local.example.php como config.local.php y completar credenciales/contacto.\n3. Agregar las reglas de AGREGAR-AL-HTACCESS-PRINCIPAL.txt dentro del IfModule mod_rewrite del .htaccess principal, antes de las reglas de los demás dominios.\n4. En Ferozo, emitir el certificado SSL para repuestos.cigue.com.ar.\n5. Después de emitirlo, activar el bloque HTTPS comentado en el archivo de reglas.\n6. Verificar https://repuestos.cigue.com.ar/api/health y luego el panel /admin.html.\n`);
console.log(site);
