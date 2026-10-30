<?php
// Proxy de Garantía3 para las altas de contratos de la web de Vicente.
// Garantía3 solo acepta su token desde la IP autorizada (93.189.94.124) y utils corre en Vercel con IP dinámica:
// las peticiones pasan por aquí para salir con la IP fija de este servidor.
//
// Se publica en pladisel.es/utils/proxy-garantia3/proxy-garantia3.php, con PROXY_TOKEN puesto solo en el servidor.
// Los tokens de Garantía3 viven en utils (GARANTIA3_TOKEN y GARANTIA3_TOKEN_TEST en Vercel) y llegan en cada petición: aquí
// no se guardan. Cada petición dice su entorno, sin valor por defecto, para no crear un contrato real por descuido.
// Compatible con PHP 7.0. No guarda nada: ni registros ni datos del cliente.
//
// - POST con { entorno, token, ean13, name, lastname, email, phone, note? }: crea un contrato. Cada llamada correcta es un contrato que se paga.
// - ?ip=1: devuelve la IP de salida de este servidor.
// - POST ?comprobar=1 con { entorno, token }: prueba el token de Garantía3 con un EAN inexistente, sin crear nada. 404 = token e IP correctos.
//
// Respuestas: el código y el cuerpo de Garantía3 tal cual, salvo cuando no hay respuesta suya:
// - 503 { proxy: "no_enviado" }: la petición no llegó a salir. Se puede repetir.
// - 504 { proxy: "resultado_desconocido" }: salió y no hubo respuesta. NO repetir: el contrato puede existir.

const PROXY_TOKEN = '';     // Poner aquí el token del proxy al subirlo al servidor.
const GARANTIA3_URLS = ['produccion' => 'https://webshop.bcwm.es/api/v_1/contract/new', 'test' => 'https://testwebshop.bcwm.es/api/v_1/contract/new'];

header('Content-Type: application/json; charset=utf-8');

function responder($status, $data) {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

// El token llega en la cabecera X-Proxy-Token o, si el servidor la descarta, en ?token=.
$token = isset($_SERVER['HTTP_X_PROXY_TOKEN']) ? $_SERVER['HTTP_X_PROXY_TOKEN'] : (isset($_GET['token']) ? (string) $_GET['token'] : '');
if (PROXY_TOKEN === '' || !hash_equals(PROXY_TOKEN, $token)) {
    responder(401, ['error' => 'No autorizado']);
}

function llamar($url, $body, &$status, &$sinEnviar) {
    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_CONNECTTIMEOUT => 10,
        // Sin seguir redirecciones: así nunca se sale de la dirección fijada.
        CURLOPT_FOLLOWLOCATION => false,
    ] + ($body === null ? [] : [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    ]));
    $respuesta = curl_exec($curl);
    $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    // No se resolvió el dominio, no conectó o falló el TLS: no se envió nada. Cualquier otro fallo se trata como dudoso.
    $sinEnviar = in_array(curl_errno($curl), [CURLE_COULDNT_RESOLVE_HOST, CURLE_COULDNT_CONNECT, CURLE_SSL_CONNECT_ERROR], true);
    return $respuesta;
}

function contrato($url, $garantia3, $datos, &$status, &$sinEnviar) {
    return llamar($url, json_encode(['token' => $garantia3] + $datos, JSON_UNESCAPED_UNICODE), $status, $sinEnviar);
}

if (isset($_GET['ip'])) {
    $ip = llamar('https://api.ipify.org', null, $status, $sinEnviar);
    responder(200, ['ip' => trim((string) $ip)]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    responder(405, ['error' => 'Solo POST']);
}

$entrada = json_decode(file_get_contents('php://input'), true);
if (!is_array($entrada)) {
    responder(400, ['error' => 'JSON no válido']);
}

$garantia3 = isset($entrada['token']) && is_string($entrada['token']) ? trim($entrada['token']) : '';
if ($garantia3 === '') {
    responder(422, ['error' => 'Falta token']);
}
$entorno = isset($entrada['entorno']) && is_string($entrada['entorno']) ? $entrada['entorno'] : '';
if (!array_key_exists($entorno, GARANTIA3_URLS)) {
    responder(422, ['error' => 'Entorno no válido']);
}
$url = GARANTIA3_URLS[$entorno];

if (isset($_GET['comprobar'])) {
    $datos = ['ean13' => '0000000000000', 'name' => 'Comprobacion', 'lastname' => 'Proxy', 'email' => 'utils@mail.electronicavicente.com', 'phone' => '34000000000'];
    contrato($url, $garantia3, $datos, $status, $sinEnviar);
    responder(200, ['garantia3' => (int) $status, 'correcto' => (int) $status === 404]);
}

$datos = [];
foreach (['ean13', 'name', 'lastname', 'email', 'phone'] as $campo) {
    $valor = isset($entrada[$campo]) && is_string($entrada[$campo]) ? trim($entrada[$campo]) : '';
    if ($valor === '') {
        responder(422, ['error' => "Falta $campo"]);
    }
    $datos[$campo] = $valor;
}
// Qué EAN se venden lo decide utils; aquí solo se comprueba la forma. Los que Garantía3 no autorice devuelven 404.
if (!preg_match('/^\d{13}$/', $datos['ean13'])) {
    responder(422, ['error' => 'EAN no válido']);
}
// Opcional: número de pedido o factura, según la documentación de la API.
if (isset($entrada['note']) && is_string($entrada['note']) && trim($entrada['note']) !== '') {
    $datos['note'] = trim($entrada['note']);
}

$respuesta = contrato($url, $garantia3, $datos, $status, $sinEnviar);
if ($respuesta === false || (int) $status === 0) {
    if ($sinEnviar) {
        responder(503, ['proxy' => 'no_enviado']);
    }
    responder(504, ['proxy' => 'resultado_desconocido']);
}

http_response_code((int) $status);
echo $respuesta;
