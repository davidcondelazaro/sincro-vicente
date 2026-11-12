import { AccionNoValida, accionContrato, contratoParaHelpdesk } from "@/lib/garantia3-contratos";
import { denied, failed } from "@/lib/helpdesk-admin";
import { workerClient } from "@/lib/mhd-importer/jobs";

// Acción sobre un contrato desde el helpdesk, con las mismas reglas que la pantalla de utils:
// PATCH { accion: reintentar|pedir_ya|dudoso_creado|dudoso_no_creado|anular|anulado, contrato?, by } → el contrato.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const no = denied(req);
  if (no) return no;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "Contrato no válido." }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { accion?: unknown; contrato?: unknown; by?: unknown } | null;
  try {
    const fila = await accionContrato(workerClient(process.env), id, String(body?.accion ?? ""), typeof body?.contrato === "string" ? body.contrato : null);
    if (!fila) return Response.json({ error: "Ese contrato ya no está en ese estado." }, { status: 409 });
    console.info(`Garantía3: ${String(body?.accion)} en ${fila.shopify_order_name} desde el helpdesk por ${typeof body?.by === "string" ? body.by.slice(0, 200) : "helpdesk"}`);
    return Response.json(contratoParaHelpdesk(fila));
  } catch (caught) {
    if (caught instanceof AccionNoValida) return Response.json({ error: caught.message }, { status: 400 });
    return failed(caught);
  }
}
