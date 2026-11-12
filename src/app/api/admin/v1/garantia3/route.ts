import { COLUMNAS, ESTADOS, contratoParaHelpdesk, type Contrato } from "@/lib/garantia3-contratos";
import { denied, failed } from "@/lib/helpdesk-admin";
import { workerClient } from "@/lib/mhd-importer/jobs";

// Contratos de Garantía3 para el helpdesk.
// GET ?estado&search&page → todos (apartado del helpdesk), con las cifras de la pantalla de utils.
// GET ?email=…&email=… → los de un cliente (ficha). GET ?pedido=#1234&pedido=… → los de esos pedidos (ticket).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = 50;
const term = (value: string | null) => (value ?? "").replace(/[,()*%\\]/g, " ").trim();
const likeExact = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);
const fechaHora = (value: string) => new Date(value).toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" });

export async function GET(req: Request) {
  const no = denied(req);
  if (no) return no;
  const params = new URL(req.url).searchParams;
  try {
    const db = workerClient(process.env);
    const emails = params.getAll("email").map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")).slice(0, 20);
    const pedidos = params.getAll("pedido").map((p) => p.trim()).filter(Boolean).slice(0, 20);
    if (emails.length || pedidos.length) {
      const results = await Promise.all([
        ...emails.map((e) => db.from("garantia3_contratos").select(COLUMNAS).ilike("email", likeExact(e)).order("created_at", { ascending: false }).limit(50)),
        ...(pedidos.length ? [db.from("garantia3_contratos").select(COLUMNAS).in("shopify_order_name", pedidos.map((p) => (p.startsWith("#") ? p : `#${p}`))).limit(100)] : []),
      ]);
      const error = results.find((r) => r.error)?.error;
      if (error) throw error;
      const byId = new Map(results.flatMap((r) => (r.data ?? []) as Contrato[]).map((f) => [f.id, f]));
      const filas = [...byId.values()].sort((a, b) => (b.order_created_at ?? "").localeCompare(a.order_created_at ?? ""));
      return Response.json({ items: filas.map(contratoParaHelpdesk) });
    }

    const estado = params.get("estado");
    const search = term(params.get("search"));
    const page = Math.max(0, Number(params.get("page") ?? 0) || 0);
    let query = db.from("garantia3_contratos").select(COLUMNAS, { count: "exact" });
    if (estado && estado in ESTADOS) query = query.eq("estado", estado);
    if (search) {
      const pedido = search.replace(/^#/, "");
      query = query.or(`shopify_order_name.ilike.*${pedido}*,email.ilike.*${search}*,nombre.ilike.*${search}*,apellidos.ilike.*${search}*`);
    }
    const [list, estados, modo, vuelta] = await Promise.all([
      query.order("created_at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1),
      db.from("garantia3_contratos").select("estado").limit(10000),
      db.from("store_settings").select("value").eq("key", "garantia3_modo").maybeSingle(),
      db.from("garantia3_vueltas").select("origen, inicio, fin").order("inicio", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const error = list.error ?? estados.error ?? modo.error ?? vuelta.error;
    if (error) throw error;
    const cuantos = (lista: string[]) => (estados.data ?? []).filter((f) => lista.includes(f.estado)).length.toLocaleString("es-ES", { useGrouping: "always" });
    const notes: { text: string; tone?: "warn" }[] = [];
    if (modo.data?.value === "test") notes.push({ text: "Modo test: se hace todo el recorrido, pero no se llama a Garantía3 y los contratos son simulados.", tone: "warn" });
    if (vuelta.data) notes.push({ text: `Última vuelta: ${fechaHora(vuelta.data.fin ?? vuelta.data.inicio)} (${vuelta.data.origen}).` });
    return Response.json({
      help: "Utils pide a Garantía3 el contrato de cada ampliación vendida, pasados los días de espera desde que MHD envía el pedido. Al cliente le escribe Garantía3. La conexión y los ajustes siguen en utils.",
      notes,
      totals: [
        { label: "En espera", value: cuantos(["espera", "lista"]) },
        { label: "Creados", value: cuantos(["creado"]) },
        { label: "Necesitan revisión", value: cuantos(["error", "dudoso", "bloqueado"]), tone: cuantos(["error", "dudoso"]) !== "0" ? "warn" : undefined },
        { label: "Por anular", value: cuantos(["anulacion_pendiente"]), tone: cuantos(["anulacion_pendiente"]) !== "0" ? "warn" : undefined },
      ],
      filters: [{ key: "estado", label: "Estado", options: Object.entries(ESTADOS).map(([value, label]) => ({ value, label })) }],
      total: list.count ?? 0,
      page_size: PAGE,
      items: ((list.data ?? []) as Contrato[]).map(contratoParaHelpdesk),
    });
  } catch (caught) {
    return failed(caught);
  }
}
