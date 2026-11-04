<?php
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (str_starts_with($path, '/api')) {
    $_GET['route'] = trim(substr($path, 4), '/');
    require __DIR__ . '/api.php';
    return true;
}
$file = __DIR__ . ($path === '/' ? '/index.html' : $path);
if (is_file($file)) return false;
http_response_code(404);
echo 'No encontrado';
return true;
