<?php
declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('log_errors', '1');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('Cache-Control: no-store');

$config = require __DIR__ . '/config.php';
$dataDir = __DIR__ . '/data';
if (!is_dir($dataDir)) mkdir($dataDir, 0750, true);
$denyFile = $dataDir . '/.htaccess';
if (!file_exists($denyFile)) file_put_contents($denyFile, "Options -Indexes\nRequire all denied\n");

session_name('cg_admin');
session_set_cookie_params([
    'lifetime' => 28800,
    'path' => '/',
    'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
    'httponly' => true,
    'samesite' => 'Strict',
]);
session_start();

$db = new PDO('sqlite:' . $dataDir . '/catalog.sqlite');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
$db->exec('PRAGMA foreign_keys = ON');
$db->exec('PRAGMA journal_mode = WAL');

function jsonResponse(int $status, array $payload): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if (!$config['configured'] && !in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true)) {
    jsonResponse(503, ['error' => 'Completá config.local.php antes de publicar el sitio.']);
}

function bodyJson(): array {
    $raw = file_get_contents('php://input');
    if (strlen($raw) > 8 * 1024 * 1024) jsonResponse(413, ['error' => 'Payload demasiado grande']);
    if ($raw === '') return [];
    $data = json_decode($raw, true);
    if (!is_array($data)) jsonResponse(400, ['error' => 'JSON inválido']);
    return $data;
}

function requireAdmin(): void {
    if (empty($_SESSION['admin_email'])) jsonResponse(401, ['error' => 'No autorizado']);
}

function mapProduct(array $row): array {
    return [
        'id' => (int) $row['id'],
        'name' => $row['name'],
        'category' => $row['category'],
        'application' => $row['application'],
        'models' => json_decode($row['models'] ?: '[]', true) ?: [],
        'description' => $row['description'],
        'price' => (int) $row['price'],
        'stock' => (int) $row['stock'],
        'badge' => $row['badge'],
        'image' => $row['image'],
        'status' => $row['status'],
        'sold' => (bool) $row['sold'],
        'createdAt' => $row['created_at'],
        'updatedAt' => $row['updated_at'],
    ];
}

function normalizeText(mixed $value): string {
    $text = trim((string) $value);
    $ascii = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $text);
    return strtolower($ascii === false ? $text : $ascii);
}

function cleanProduct(array $payload): array {
    $groups = ['Camiones' => ['Accelo','Atego','Actros','Arocs','Axor'], 'Vans' => ['Sprinter','Vito']];
    $models = array_values(array_unique(array_filter(array_map(fn($v) => trim((string) $v), is_array($payload['models'] ?? null) ? $payload['models'] : []))));
    $product = [
        'name' => trim((string) ($payload['name'] ?? '')),
        'category' => trim((string) ($payload['category'] ?? '')),
        'application' => trim((string) ($payload['application'] ?? '')),
        'models' => $models,
        'description' => trim((string) ($payload['description'] ?? '')),
        'price' => filter_var($payload['price'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]),
        'stock' => filter_var($payload['stock'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]),
        'badge' => trim((string) ($payload['badge'] ?? '')),
        'image' => trim((string) ($payload['image'] ?? '')),
        'status' => ($payload['status'] ?? '') === 'inactive' ? 'inactive' : 'active',
        'sold' => !empty($payload['sold']) ? 1 : 0,
    ];
    if ($product['name'] === '') throw new InvalidArgumentException('El nombre es obligatorio');
    if (!in_array($product['category'], ['Repuestos','Accesorios','Lubricantes'], true)) throw new InvalidArgumentException('La categoría no es válida');
    if (!in_array($product['application'], ['Camiones','Vans','Ambos'], true)) throw new InvalidArgumentException('La aplicación no es válida');
    if (!$models) throw new InvalidArgumentException('Seleccioná al menos un modelo');
    $allowed = $product['application'] === 'Ambos' ? array_merge($groups['Camiones'], $groups['Vans']) : $groups[$product['application']];
    if (array_diff($models, $allowed)) throw new InvalidArgumentException('Hay modelos que no corresponden a la aplicación');
    if ($product['description'] === '') throw new InvalidArgumentException('La descripción es obligatoria');
    if ($product['price'] === false) throw new InvalidArgumentException('El precio debe ser un entero igual o mayor a cero');
    if ($product['stock'] === false) throw new InvalidArgumentException('El stock debe ser un entero igual o mayor a cero');
    if (!in_array($product['badge'], ['', 'Oferta','Nuevo','Destacado'], true)) throw new InvalidArgumentException('La etiqueta no es válida');
    return $product;
}

function initDb(PDO $db, array $config): void {
    $db->exec("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin', created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT NOT NULL, application TEXT NOT NULL, models TEXT NOT NULL DEFAULT '[]', description TEXT NOT NULL, price INTEGER NOT NULL DEFAULT 0, stock INTEGER NOT NULL DEFAULT 0, badge TEXT NOT NULL DEFAULT '', image TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', sold INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);");
    if ((int) $db->query('SELECT COUNT(*) FROM users')->fetchColumn() === 0) {
        $stmt = $db->prepare("INSERT INTO users (email,password_hash,role,created_at) VALUES (?,?,'admin',?)");
        $stmt->execute([$config['admin_email'], password_hash($config['admin_password'], PASSWORD_DEFAULT), gmdate('c')]);
    }
    if ((int) $db->query('SELECT COUNT(*) FROM products')->fetchColumn() === 0) {
        $seedFile = __DIR__ . '/products.json';
        $items = file_exists($seedFile) ? json_decode(file_get_contents($seedFile), true) : [];
        $stmt = $db->prepare("INSERT INTO products (name,category,application,models,description,price,stock,badge,image,status,sold,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'active',0,?,?)");
        $now = gmdate('c');
        foreach ($items ?: [] as $item) $stmt->execute([$item['name'] ?? '',$item['category'] ?? '',$item['application'] ?? '',json_encode($item['models'] ?? []),$item['description'] ?? '',(int)($item['price'] ?? 0),(int)($item['stock'] ?? 0),$item['badge'] ?? '',$item['image'] ?? '',$now,$now]);
    }
}

function saveProduct(PDO $db, array $product, ?int $id = null): array {
    $now = gmdate('c');
    $values = [$product['name'],$product['category'],$product['application'],json_encode($product['models'], JSON_UNESCAPED_UNICODE),$product['description'],$product['price'],$product['stock'],$product['badge'],$product['image'],$product['status'],$product['sold'],$now];
    if ($id) {
        $stmt = $db->prepare('UPDATE products SET name=?,category=?,application=?,models=?,description=?,price=?,stock=?,badge=?,image=?,status=?,sold=?,updated_at=? WHERE id=?');
        $stmt->execute([...$values, $id]);
        if ($stmt->rowCount() === 0 && !$db->query('SELECT 1 FROM products WHERE id=' . $id)->fetchColumn()) jsonResponse(404, ['error' => 'Producto no encontrado']);
    } else {
        $stmt = $db->prepare('INSERT INTO products (name,category,application,models,description,price,stock,badge,image,status,sold,updated_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
        $stmt->execute([...$values, $now]);
        $id = (int) $db->lastInsertId();
    }
    $stmt = $db->prepare('SELECT * FROM products WHERE id=?');
    $stmt->execute([$id]);
    return mapProduct($stmt->fetch());
}

function xlsxRows(string $bytes): array {
    if (strlen($bytes) > 5 * 1024 * 1024) throw new InvalidArgumentException('El archivo no puede superar los 5 MB.');
    $tmp = tempnam(sys_get_temp_dir(), 'cg-xlsx-');
    file_put_contents($tmp, $bytes);
    $zip = new ZipArchive();
    if ($zip->open($tmp) !== true) { @unlink($tmp); throw new InvalidArgumentException('Subí un archivo .xlsx válido y sin contraseña.'); }
    $shared = [];
    $sharedXml = $zip->getFromName('xl/sharedStrings.xml');
    if ($sharedXml !== false && strlen($sharedXml) < 20 * 1024 * 1024) {
        $xml = simplexml_load_string($sharedXml);
        foreach ($xml->si ?? [] as $item) {
            $text = (string) ($item->t ?? '');
            foreach ($item->r ?? [] as $run) $text .= (string) ($run->t ?? '');
            $shared[] = $text;
        }
    }
    $sheetXml = $zip->getFromName('xl/worksheets/sheet1.xml');
    $zip->close(); @unlink($tmp);
    if ($sheetXml === false || strlen($sheetXml) > 30 * 1024 * 1024) throw new InvalidArgumentException('No se encontró una hoja Productos válida.');
    $xml = simplexml_load_string($sheetXml);
    $rows = [];
    foreach ($xml->sheetData->row ?? [] as $row) {
        $cells = [];
        foreach ($row->c as $cell) {
            if (isset($cell->f)) throw new InvalidArgumentException('El Excel contiene fórmulas. Pegá sólo valores.');
            preg_match('/^([A-Z]+)/', (string) $cell['r'], $match);
            $letters = $match[1] ?? 'A'; $column = 0;
            foreach (str_split($letters) as $letter) $column = $column * 26 + ord($letter) - 64;
            $type = (string) $cell['t'];
            if ($type === 's') $value = $shared[(int) $cell->v] ?? '';
            elseif ($type === 'inlineStr') $value = (string) ($cell->is->t ?? '');
            elseif ($type === 'b') $value = ((string) $cell->v === '1') ? 'Sí' : 'No';
            else $value = (string) ($cell->v ?? '');
            $cells[$column] = trim($value);
        }
        $rows[] = $cells;
        if (count($rows) > 2001) throw new InvalidArgumentException('El archivo supera las 2000 filas.');
    }
    return $rows;
}

function importExcel(PDO $db, string $bytes): array {
    $rows = xlsxRows($bytes);
    if (!$rows) throw new InvalidArgumentException('El Excel no contiene productos.');
    $labels = ['ID','Nombre','Categoría','Aplicación','Modelos','Descripción','Precio','Stock','Etiqueta','Imagen','Estado','Vendido'];
    $headers = [];
    foreach ($rows[0] as $col => $value) $headers[normalizeText($value)] = $col;
    foreach ($labels as $label) if (!isset($headers[normalizeText($label)])) throw new InvalidArgumentException("Falta la columna $label.");
    $valid = []; $errors = []; $seen = [];
    foreach (array_slice($rows, 1, null, true) as $index => $row) {
        $line = $index + 1;
        $values = [];
        foreach ($labels as $label) $values[$label] = $row[$headers[normalizeText($label)]] ?? '';
        if (!array_filter($values, fn($v) => trim((string)$v) !== '')) continue;
        try {
            $id = $values['ID'] === '' ? null : filter_var($values['ID'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            if ($id === false) throw new InvalidArgumentException('ID inválido.');
            if ($id && isset($seen[$id])) throw new InvalidArgumentException("ID $id repetido.");
            if ($id) { $seen[$id] = true; $stmt=$db->prepare('SELECT image FROM products WHERE id=?');$stmt->execute([$id]);$existing=$stmt->fetch();if(!$existing) throw new InvalidArgumentException("El producto con ID $id no existe."); } else $existing=null;
            $category = ['repuestos'=>'Repuestos','accesorios'=>'Accesorios','lubricantes'=>'Lubricantes'][normalizeText($values['Categoría'])] ?? '';
            $application = ['camiones'=>'Camiones','vans'=>'Vans','ambos'=>'Ambos'][normalizeText($values['Aplicación'])] ?? '';
            $badgeMap = [''=>'','oferta'=>'Oferta','nuevo'=>'Nuevo','destacado'=>'Destacado'];
            $modelMap = array_combine(array_map('strtolower', ['Accelo','Atego','Actros','Arocs','Axor','Sprinter','Vito']), ['Accelo','Atego','Actros','Arocs','Axor','Sprinter','Vito']);
            $models = array_map(fn($v) => $modelMap[normalizeText($v)] ?? trim($v), preg_split('/[,;]/', $values['Modelos'], -1, PREG_SPLIT_NO_EMPTY));
            $image = trim($values['Imagen']);
            if ($image !== '' && !preg_match('#^(https?://|assets/products/)#i', $image)) throw new InvalidArgumentException('Imagen: usá una URL http/https o assets/products/.');
            $payload = ['name'=>$values['Nombre'],'category'=>$category,'application'=>$application,'models'=>$models,'description'=>$values['Descripción'],'price'=>$values['Precio'],'stock'=>$values['Stock'],'badge'=>$badgeMap[normalizeText($values['Etiqueta'])] ?? '__invalid__','image'=>$image ?: ($existing['image'] ?? ''),'status'=>normalizeText($values['Estado'])==='inactivo'?'inactive':'active','sold'=>normalizeText($values['Vendido'])==='si'];
            if (!in_array(normalizeText($values['Estado']), ['', 'activo','inactivo'], true)) throw new InvalidArgumentException('Estado: usá Activo o Inactivo.');
            if (!in_array(normalizeText($values['Vendido']), ['', 'si','no'], true)) throw new InvalidArgumentException('Vendido: usá Sí o No.');
            $valid[] = ['id'=>$id,'product'=>cleanProduct($payload)];
        } catch (Throwable $e) { $errors[] = ['row'=>$line,'message'=>$e->getMessage()]; }
    }
    if ($errors) return ['errors'=>$errors];
    if (!$valid) throw new InvalidArgumentException('El Excel no contiene productos.');
    $created=0;$updated=0;$db->beginTransaction();
    try { foreach($valid as $item){saveProduct($db,$item['product'],$item['id']);$item['id']?$updated++:$created++;}$db->commit(); }
    catch(Throwable $e){$db->rollBack();throw $e;}
    return ['created'=>$created,'updated'=>$updated,'errors'=>[]];
}

initDb($db, $config);
$route = trim((string) ($_GET['route'] ?? ''), '/');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    if ($method === 'GET' && $route === 'health') jsonResponse(200, ['ok' => true]);
    if ($method === 'GET' && $route === 'config') jsonResponse(200, ['email'=>$config['contact_email'],'whatsappNumber'=>$config['whatsapp_number'],'whatsappLabel'=>$config['whatsapp_label']]);
    if ($method === 'GET' && $route === 'products') jsonResponse(200, ['products'=>array_map('mapProduct', $db->query("SELECT * FROM products WHERE status='active' ORDER BY sold ASC,updated_at DESC,id DESC")->fetchAll())]);
    if ($method === 'POST' && $route === 'admin/login') {
        $now=time();$_SESSION['login_attempts']=array_values(array_filter($_SESSION['login_attempts']??[],fn($t)=>$now-(int)$t<900));
        if(count($_SESSION['login_attempts'])>=10)jsonResponse(429,['error'=>'Demasiados intentos. Esperá 15 minutos.']);
        $body=bodyJson();$stmt=$db->prepare('SELECT * FROM users WHERE email=?');$stmt->execute([trim((string)($body['email']??''))]);$user=$stmt->fetch();
        if(!$user||!password_verify((string)($body['password']??''),$user['password_hash'])){$_SESSION['login_attempts'][]=$now;jsonResponse(401,['error'=>'Credenciales inválidas']);}
        session_regenerate_id(true);$_SESSION['login_attempts']=[];$_SESSION['admin_email']=$user['email'];jsonResponse(200,['user'=>['email'=>$user['email'],'role'=>$user['role']]]);
    }
    if ($method === 'POST' && $route === 'admin/logout') { $_SESSION=[];session_destroy();jsonResponse(200,['ok'=>true]); }
    if ($method === 'GET' && $route === 'admin/me') jsonResponse(200,['user'=>empty($_SESSION['admin_email'])?null:['email'=>$_SESSION['admin_email'],'role'=>'admin']]);
    if ($method === 'GET' && $route === 'admin/products') { requireAdmin();jsonResponse(200,['products'=>array_map('mapProduct',$db->query('SELECT * FROM products ORDER BY updated_at DESC,id DESC')->fetchAll())]); }
    if ($method === 'POST' && $route === 'admin/products') { requireAdmin();jsonResponse(201,['product'=>saveProduct($db,cleanProduct(bodyJson()))]); }
    if ($method === 'POST' && $route === 'admin/excel/import') { requireAdmin();$result=importExcel($db,file_get_contents('php://input'));if($result['errors'])jsonResponse(400,['error'=>'Corregí las filas indicadas. No se guardó ningún cambio.','errors'=>$result['errors']]);jsonResponse(200,$result); }
    if (preg_match('#^admin/products/(\d+)$#',$route,$match) && $method==='PUT') { requireAdmin();jsonResponse(200,['product'=>saveProduct($db,cleanProduct(bodyJson()),(int)$match[1])]); }
    if (preg_match('#^admin/products/(\d+)/status$#',$route,$match) && $method==='PATCH') {
        requireAdmin();$body=bodyJson();$sets=[];$values=[];
        if(array_key_exists('sold',$body)){$sets[]='sold=?';$values[]=!empty($body['sold'])?1:0;}
        if(in_array($body['status']??'', ['active','inactive'],true)){$sets[]='status=?';$values[]=$body['status'];}
        if(!$sets)jsonResponse(400,['error'=>'No hay cambios válidos']);$sets[]='updated_at=?';$values[]=gmdate('c');$values[]=(int)$match[1];
        $stmt=$db->prepare('UPDATE products SET '.implode(',',$sets).' WHERE id=?');$stmt->execute($values);$stmt=$db->prepare('SELECT * FROM products WHERE id=?');$stmt->execute([(int)$match[1]]);$row=$stmt->fetch();if(!$row)jsonResponse(404,['error'=>'Producto no encontrado']);jsonResponse(200,['product'=>mapProduct($row)]);
    }
    jsonResponse(404, ['error'=>'Endpoint no encontrado']);
} catch (InvalidArgumentException $e) { jsonResponse(400,['error'=>$e->getMessage()]); }
catch (Throwable $e) { error_log($e->__toString());jsonResponse(500,['error'=>'Error interno']); }
