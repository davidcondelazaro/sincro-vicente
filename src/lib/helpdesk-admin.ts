import { timingSafeEqual } from "node:crypto";

// Contrato de administración para Aligeria Helpdesk (rutas /api/admin/v1/*, «Authorization: Bearer $HELPDESK_ADMIN_SECRET»),
// el mismo que publica el chatbot: el helpdesk enseña y gestiona desde su consola lo que no es técnico de utils
// (helpdesk › docs/api.md › «Contrato de administración» y docs/integracion-elvi.md § 3.8). Hoy, los contratos de Garantía3.

/** null si la petición trae el secreto del helpdesk; si no, la respuesta 401. */
export function denied(req: Request): Response | null {
  const secret = process.env.HELPDESK_ADMIN_SECRET;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (secret && given.length === expected.length && timingSafeEqual(given, expected)) return null;
  return Response.json({ error: "No autorizado" }, { status: 401 });
}

export function failed(caught: unknown) {
  console.error("Administración (helpdesk):", caught);
  const message = caught && typeof caught === "object" && "message" in caught ? String(caught.message) : "Error interno";
  return Response.json({ error: message }, { status: 500 });
}
