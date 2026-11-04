<?php
declare(strict_types=1);

$local = __DIR__ . '/config.local.php';
$config = file_exists($local) ? require $local : [];

return [
    'configured' => file_exists($local) || (bool) getenv('ADMIN_PASSWORD'),
    'admin_email' => $config['admin_email'] ?? getenv('ADMIN_EMAIL') ?: 'posventa@cigue.com.ar',
    'admin_password' => $config['admin_password'] ?? getenv('ADMIN_PASSWORD') ?: 'Puente.12',
    'contact_email' => $config['contact_email'] ?? getenv('CONTACT_EMAIL') ?: 'posventa@cigue.com.ar',
    'whatsapp_number' => preg_replace('/\D+/', '', (string) ($config['whatsapp_number'] ?? getenv('WHATSAPP_NUMBER') ?: '')),
    'whatsapp_label' => $config['whatsapp_label'] ?? getenv('WHATSAPP_LABEL') ?: 'WhatsApp no configurado',
];
