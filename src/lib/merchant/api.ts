import { createSign } from "node:crypto";

// Cliente mínimo de la Merchant API de Google (v1), sin librerías: la cuenta de servicio firma un JWT y lo cambia por un
// token de una hora. Credenciales: MERCHANT_SA_KEY_B64 (la clave JSON de la cuenta de servicio en base64) y
// MERCHANT_ACCOUNT_ID. La clave vive en ~/.config/merchant-api/clave.json y en Vercel; nunca en el repo.

type Clave = { client_email: string; private_key: string };
export type MerchantConfig = { cuenta: string; clave: Clave };
export type Respuesta<T = unknown> = { ok: boolean; status: number; body: T & { error?: { message?: string; status?: string } } };

const BASE = "https://merchantapi.googleapis.com/";
let token: { valor: string; caduca: number } | null = null;

export function merchantConfig(env: Record<string, string | undefined> = process.env): MerchantConfig {
  if (!env.MERCHANT_SA_KEY_B64 || !env.MERCHANT_ACCOUNT_ID) throw new Error("Faltan MERCHANT_SA_KEY_B64 o MERCHANT_ACCOUNT_ID.");
  return { cuenta: env.MERCHANT_ACCOUNT_ID, clave: JSON.parse(Buffer.from(env.MERCHANT_SA_KEY_B64, "base64").toString("utf8")) };
}

async function accessToken(config: MerchantConfig) {
  if (token && token.caduca > Date.now() + 60_000) return token.valor;
  const b64 = (valor: object) => Buffer.from(JSON.stringify(valor)).toString("base64url");
  const ahora = Math.floor(Date.now() / 1000);
  const sinFirma = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: config.clave.client_email, scope: "https://www.googleapis.com/auth/content", aud: "https://oauth2.googleapis.com/token", iat: ahora, exp: ahora + 3600 })}`;
  const firma = createSign("RSA-SHA256").update(sinFirma).sign(config.clave.private_key).toString("base64url");
  const respuesta = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${sinFirma}.${firma}` }) });
  const datos = await respuesta.json() as { access_token?: string; expires_in?: number; error_description?: string };
  if (!datos.access_token) throw new Error(`Google no dio token: ${datos.error_description ?? respuesta.status}`);
  token = { valor: datos.access_token, caduca: Date.now() + (datos.expires_in ?? 3600) * 1000 };
  return token.valor;
}

// Reintenta solo lo pasajero (429 y 5xx) con esperas cortas; el resto lo decide quien llama.
export async function merchant<T = unknown>(config: MerchantConfig, metodo: string, ruta: string, cuerpo?: unknown): Promise<Respuesta<T>> {
  const url = BASE + ruta.replaceAll("{cuenta}", config.cuenta);
  for (let intento = 0; ; intento++) {
    let status = 0; let body: unknown = null;
    try {
      const respuesta = await fetch(url, { method: metodo, headers: { authorization: `Bearer ${await accessToken(config)}`, "content-type": "application/json" }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo), signal: AbortSignal.timeout(30_000) });
      status = respuesta.status;
      const texto = await respuesta.text();
      body = texto ? JSON.parse(texto) : {};
    } catch (error) {
      body = { error: { message: error instanceof Error ? error.message : String(error) } };
    }
    const pasajero = status === 0 || status === 429 || status >= 500;
    if (!pasajero || intento >= 3) return { ok: status >= 200 && status < 300, status, body: body as Respuesta<T>["body"] };
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** intento));
  }
}

export const mensaje = (respuesta: Respuesta) => `HTTP ${respuesta.status}: ${respuesta.body?.error?.message ?? JSON.stringify(respuesta.body).slice(0, 200)}`;
