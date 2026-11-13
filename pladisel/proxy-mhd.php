<?php
// Proxy de la API de MHD (mihogardigital.es) para la sincronización del catálogo y los pedidos.
// Desde el 10-11-2026 MHD responde 403 a ratos: nuestras llamadas salen de Vercel y de Supabase con IP
// variable y su Apache rechaza unas direcciones sí y otras no, así que media sincronización se cae en la
// comprobación de arranque. Pasando por aquí, todas las llamadas salen con la IP fija de este servidor,
// igual que ya se hizo con Icecat.
//
// Publicado en pladisel.es/utils/proxy-mhd/proxy-mhd.php (con el token real). Compatible con PHP 7.0.
// - ?ip=1 devuelve la IP de salida de este servidor: es la que hay que pedir a MHD que autorice.
// - ?url=<url de la API, urlencoded> reenvía la petición (GET o POST) y devuelve la respuesta tal cual.
//   Solo https y solo rutas /api/... de www.mihogardigital.es, para que esto no sirva de proxy abierto.
// La credencial de MHD no se guarda aquí: llega en cada petición y se reenvía. Viaja en X-MHD-Authorization
// porque Apache se come la cabecera Authorization antes de que PHP la vea salvo que esté puesto CGIPassAuth;
// si llega por Authorization (o por REDIRECT_HTTP_AUTHORIZATION, que es donde la deja mod_rewrite), también vale.
// Las fotos (cdn.mihogardigital.es) no pasan por aquí: esas se filtran por Referer, no por IP, y ya funcionan.

const PROXY_TOKEN = 'sryAfPL6h4xrxg0AMwCJ5FVI';

const API_HOST = 'www.mihogardigital.es';

// MHD (Ayco) tiene autorizado nuestro dominio: se manda siempre, lo pida o no quien llama.
const API_ORIGIN = 'https://utils.electronicavicente.com';

const BROWSER_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

header('Content-Type: application/json; charset=utf-8');

// El token llega en la cabecera X-Proxy-Token o, si el servidor la descarta, en ?token=.
$token = isset($_SERVER['HTTP_X_PROXY_TOKEN']) ? $_SERVER['HTTP_X_PROXY_TOKEN'] : (isset($_GET['token']) ? $_GET['token'] : '');
if (PROXY_TOKEN === '' || !hash_equals(PROXY_TOKEN, (string) $token)) {
    http_response_code(401);
    echo json_encode(['error' => 'No autorizado']);
    exit;
}

function forward($url, $method, $body, $authorization, &$status, $timeout = 60) {
    $headers = [
        'Accept: application/json',
        'Origin: ' . API_ORIGIN,
        'Referer: ' . API_ORIGIN . '/',
    ];
    // El listado de MHD lee HTTP_USER_AGENT sin comprobar que exista y, si falta, escupe un Warning de PHP
    // delante del JSON (comprobado el 13-11-2026: 43 MB de respuesta que ya no parsea). cURL no manda ninguno
    // por su cuenta, así que se pone el mismo de navegador que ya se usa para las fotos.
    $headers[] = 'User-Agent: ' . BROWSER_USER_AGENT;
    if ($authorization !== '') $headers[] = 'Authorization: ' . $authorization;
    if ($method === 'POST') $headers[] = 'Content-Type: application/json';

    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_HEADER => true,
        CURLOPT_HTTPHEADER => $headers,
        // Sin seguir redirecciones: así nunca se sale del host permitido.
        CURLOPT_FOLLOWLOCATION => false,
    ]);
    if ($method === 'POST') {
        curl_setopt($curl, CURLOPT_POST, true);
        curl_setopt($curl, CURLOPT_POSTFIELDS, $body);
    }
    $response = curl_exec($curl);
    if ($response === false) {
        $status = 502;
        return [json_encode(['error' => 'Proxy: ' . curl_error($curl)]), []];
    }
    $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $headerSize = curl_getinfo($curl, CURLINFO_HEADER_SIZE);
    $out = [];
    foreach (explode("\r\n", substr($response, 0, $headerSize)) as $line) {
        // Retry-After importa: el importador espera lo que MHD pida antes de reintentar.
        if (stripos($line, 'Retry-After:') === 0 || stripos($line, 'Content-Type:') === 0) $out[] = $line;
    }
    return [substr($response, $headerSize), $out];
}

if (isset($_GET['ip'])) {
    list($ip) = forward('https://api.ipify.org', 'GET', null, '', $status, 20);
    echo json_encode(['ip' => trim($ip)]);
    exit;
}

$target = isset($_GET['url']) ? (string) $_GET['url'] : '';
$parts = parse_url($target);
$scheme = ($parts && isset($parts['scheme'])) ? $parts['scheme'] : '';
$host = ($parts && isset($parts['host'])) ? strtolower($parts['host']) : '';
$path = ($parts && isset($parts['path'])) ? $parts['path'] : '';
if ($scheme !== 'https' || $host !== API_HOST || strpos($path, '/api/') !== 0) {
    http_response_code(400);
    echo json_encode(['error' => 'Destino no permitido: solo https://' . API_HOST . '/api/...']);
    exit;
}

$method = (isset($_SERVER['REQUEST_METHOD']) && strtoupper($_SERVER['REQUEST_METHOD']) === 'POST') ? 'POST' : 'GET';
$authorization = '';
foreach (['HTTP_X_MHD_AUTHORIZATION', 'HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION'] as $key) {
    if (isset($_SERVER[$key]) && $_SERVER[$key] !== '') { $authorization = $_SERVER[$key]; break; }
}
$body = $method === 'POST' ? file_get_contents('php://input') : null;

list($payload, $headers) = forward($target, $method, $body, $authorization, $status);
http_response_code($status);
foreach ($headers as $line) header($line);
echo $payload;
