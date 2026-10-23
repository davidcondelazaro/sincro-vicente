// Piezas del importador de productos MHD: lectura de las fuentes (MHD e Icecat).
// Sin dependencias de Next ni de Deno: solo `fetch` y la configuración que se les pasa, para poder usarlas
// igual desde la web (rutas de Next) y desde una función de Supabase. Ver docs/IMPORTADOR_PRODUCTOS_MHD.md.

export type MhdConfig = { url: string; version: string; subPath: string; user: string; pass: string };
export type IcecatConfig = { username: string; appKey: string; language: string; proxyUrl?: string; proxyToken?: string };
export type FetchResult<T> = { status: number; payload: T | null };
export type MhdProductDetail = Record<string, unknown> & { codigo: string; caracteristicas?: { nombre: string; valor: string }[]; fotos?: string[] };

type Env = Record<string, string | undefined>;
function required(env: Env, name: string) { const value = env[name]; if (!value) throw new Error(`Falta la variable ${name}.`); return value; }
export function mhdConfigFromEnv(env: Env): MhdConfig { return { url: required(env, "MHD_API_URL"), version: required(env, "MHD_API_VERSION"), subPath: required(env, "MHD_API_SUB_PATH"), user: required(env, "MHD_API_USER"), pass: required(env, "MHD_API_PASS") }; }
export function icecatConfigFromEnv(env: Env): IcecatConfig { return { username: required(env, "ICECAT_USERNAME"), appKey: required(env, "ICECAT_APP_KEY"), language: env.ICECAT_LANGUAGE || "es", proxyUrl: env.ICECAT_PROXY_URL, proxyToken: env.ICECAT_PROXY_TOKEN }; }

const trim = (value: string) => value.replace(/^\/+|\/+$/g, "");

// Ficha de detalle `/products/:codigo`: trae `caracteristicas` y `fotos`, que el listado no tiene. Ojo: no trae
// `img_ficha_eficiencia` (solo el listado), así que nunca debe pisar lo que viene del listado.
export async function fetchMhdProductDetail(config: MhdConfig, codigo: string): Promise<FetchResult<MhdProductDetail>> {
  const url = `${config.url.replace(/\/$/, "")}/api/${trim(config.version)}/${trim(config.subPath)}/products/${encodeURIComponent(codigo)}`;
  const response = await fetch(url, { headers: { Accept: "application/json", Authorization: `Basic ${btoa(`${config.user}:${config.pass}`)}` }, signal: AbortSignal.timeout(30_000) });
  const body = await response.json().catch(() => null) as { success?: boolean; data?: MhdProductDetail } | null;
  if (response.status === 404) return { status: 404, payload: null };
  if (!response.ok || !body?.success || !body.data) throw new Error(`MHD no devolvió la ficha ${codigo} (HTTP ${response.status}).`);
  return { status: response.status, payload: body.data };
}

// Icecat por EAN. Full Icecat solo responde a IPs autorizadas: se sale por el proxy de Pladisel (IP fija) si está configurado.
export async function fetchIcecatByEan(config: IcecatConfig, ean: string): Promise<FetchResult<Record<string, unknown>>> {
  const query = new URLSearchParams({ UserName: config.username, Language: config.language, GTIN: ean, app_key: config.appKey });
  const response = await fetch(`${config.proxyUrl || "https://live.icecat.biz/api"}?${query}`, { headers: config.proxyUrl ? { "X-Proxy-Token": config.proxyToken ?? "" } : undefined, signal: AbortSignal.timeout(30_000) });
  if (response.status === 401) throw new Error("Icecat o el proxy de Pladisel rechazaron las credenciales.");
  if (response.status === 403) throw new Error("Icecat rechazó la IP de salida (producto Full Icecat con IP no autorizada).");
  if (response.status === 429 || response.status >= 500) throw new Error(`Icecat no está disponible temporalmente (${response.status}).`);
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  // 400/404 «The GTIN can not be found» es lo normal para un EAN que Icecat no tiene.
  return response.ok ? { status: response.status, payload: body } : { status: response.status, payload: null };
}

// Las fotos de MHD (cdn.mihogardigital.es) y sus etiquetas (S3) devuelven 403 sin cabeceras de navegador y Referer.
export const MHD_MEDIA_HEADERS = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", Accept: "image/avif,image/webp,image/*,*/*;q=0.8", Referer: "https://www.mihogardigital.es/" };
export async function fetchMhdMedia(url: string) {
  const response = await fetch(url, { headers: MHD_MEDIA_HEADERS, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`No se pudo descargar ${url} (HTTP ${response.status}).`);
  return { contentType: response.headers.get("content-type") ?? "application/octet-stream", bytes: new Uint8Array(await response.arrayBuffer()) };
}

// Documentos e imágenes de Icecat (inishop.com, objects.icecat.biz): también exigen IP autorizada, así que se descargan
// por el proxy de Pladisel (`?doc=`) si está configurado.
export async function fetchIcecatDocument(config: IcecatConfig, url: string) {
  const target = config.proxyUrl ? `${config.proxyUrl}?${new URLSearchParams({ doc: url })}` : url;
  const response = await fetch(target, { headers: config.proxyUrl ? { "X-Proxy-Token": config.proxyToken ?? "" } : undefined, signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`No se pudo descargar ${url} de Icecat (HTTP ${response.status}).`);
  return { contentType: response.headers.get("content-type") ?? "application/octet-stream", bytes: new Uint8Array(await response.arrayBuffer()) };
}
