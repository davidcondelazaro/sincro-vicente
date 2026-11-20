import { workerClient } from "@/lib/mhd-importer/jobs";
import { resendPayoutNotice, runPayoutNotices, testPayoutNotice } from "@/lib/shopify-payouts";

// Avisos de pagos de Shopify Payments (src/lib/shopify-payouts.ts). Lo llama pg_cron sin sesión pero con la cabecera
// `x-mhd-import-token`, a las 8:00 y 9:00 UTC con `?programada=1`: solo actúa la llamada que cae a las 10 de Madrid
// (en invierno la de las 9:00 UTC, en verano la de las 8:00). `?prueba=1&para=correo[&pago=id]` manda el pago indicado
// (o el último) solo a ese correo, con «[Prueba]» en el asunto y sin tocar el estado. `?avisar=id` en la primera
// ejecución avisa ese pago en lugar de darlo por avisado. `?reenviar=id` vuelve a mandar ese pago a los destinatarios
// definitivos.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const madridHour = () => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hourCycle: "h23" }).format(new Date()));

export async function POST(request: Request) {
  const db = workerClient(process.env);
  const token = request.headers.get("x-mhd-import-token");
  const { data: valid } = token ? await db.rpc("mhd_import_token_valid", { p_token: token }) : { data: false };
  if (valid !== true) return Response.json({ error: "No autorizado" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  try {
    if (params.get("prueba") === "1") {
      const to = (params.get("para") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
      if (!to.length) return Response.json({ error: "Falta ?para=correo" }, { status: 400 });
      const result = await testPayoutNotice(db, process.env, to, params.get("pago") ?? undefined);
      return Response.json(result, { status: result.ok ? 200 : 502 });
    }
    const reenviar = params.get("reenviar");
    if (reenviar) {
      const result = await resendPayoutNotice(db, process.env, reenviar);
      return Response.json(result, { status: result.ok ? 200 : 502 });
    }
    if (params.get("programada") === "1" && madridHour() !== 10) return Response.json({ ok: true, skipped: "No son las 10 en Madrid" });
    const result = await runPayoutNotices(db, process.env, { avisarAlEmpezar: params.getAll("avisar") });
    return Response.json(result, { status: result.ok ? 200 : 502 });
  } catch (caught) {
    const error = caught instanceof Error ? caught.message : String(caught);
    await db.from("mhd_sync_events").insert({ sync: "pagos-shopify", kind: "error", detail: { error } });
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
