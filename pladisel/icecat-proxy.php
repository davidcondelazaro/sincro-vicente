<?php
// Proxy de Icecat para la importación de catálogo.
// Las funciones de Supabase salen a internet con IP dinámica y Icecat sólo sirve
// el contenido Full Icecat a IPs autorizadas: las peticiones pasan por aquí para
// salir con la IP fija de este servidor.
//
// Publicado en pladisel.es/utils/proxy-icecat/proxy-icecat.php (con el token real). Compatible con PHP 7.0.
// - ?ip=1 devuelve la IP de salida de este servidor (la que hay que autorizar en Icecat).
// - El resto de parámetros (UserName, app_key, GTIN, Language...) se reenvían tal cual a live.icecat.biz/api.

const PROXY_TOKEN = ''; // Poner aquí el token real al subirlo al servidor.

header('Content-Type: application/json; charset=utf-8');

// El token llega en la cabecera X-Proxy-Token o, si el servidor la descarta, en ?token=.
$token = $_SERVER['HTTP_X_PROXY_TOKEN'] ?? ($_GET['token'] ?? '');
unset($_GET['token']);
if (PROXY_TOKEN === '' || !hash_equals(PROXY_TOKEN, $token)) {
    http_response_code(401);
    echo json_encode(['error' => 'No autorizado']);
    exit;
}

function forward($url, &$status) {
    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_HEADER => true,
    ]);
    $response = curl_exec($curl);
    if ($response === false) {
        $status = 502;
        $body = json_encode(['error' => 'Proxy: ' . curl_error($curl)]);
        return [$body, []];
    }
    $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $headerSize = curl_getinfo($curl, CURLINFO_HEADER_SIZE);
    $headers = [];
    foreach (explode("\r\n", substr($response, 0, $headerSize)) as $line) {
        if (stripos($line, 'Retry-After:') === 0) $headers[] = $line;
    }
    return [substr($response, $headerSize), $headers];
}

if (isset($_GET['ip'])) {
    list($ip) = forward('https://api.ipify.org', $status);
    echo json_encode(['ip' => trim($ip)]);
    exit;
}

list($body, $headers) = forward('https://live.icecat.biz/api?' . http_build_query($_GET), $status);
http_response_code($status);
foreach ($headers as $line) header($line);
echo $body;
