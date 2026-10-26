import { after } from "next/server";
import { runWorkerTurn } from "@/lib/mhd-importer/jobs";
import { sourcesConfig } from "@/lib/mhd-importer/server";

// Trabajador de los procesos del importador (src/lib/mhd-importer/jobs.ts). Contesta enseguida y trabaja después de
// contestar (after): un turno de ~2,5 min y, si queda trabajo, se vuelve a llamar. Varios trabajadores a la vez, cada
// uno en su puesto (mhd_importer_worker_slots). No pide sesión ni clave: solo
// procesa lo que ya está en la cola (lo encola alguien con sesión) y un turno único en la base impide que trabajen dos
// llamadas a la vez. Lo despiertan la pantalla al crear o reanudar una tanda y el vigilante de pg_cron cada minuto
// mientras haya tandas activas.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const self = new URL(request.url);
  after(async () => {
    try {
      // `spawn`: si quedan puestos libres, se llama a sí misma para que arranque otro trabajador a la vez.
      const spawn = () => { void fetch(self, { method: "POST", signal: AbortSignal.timeout(10_000) }).catch(() => undefined); };
      const turn = await runWorkerTurn(process.env, sourcesConfig(), spawn);
      console.log(JSON.stringify({ productImporterWorker: "turno", ...turn }));
      if (turn.more) await fetch(self, { method: "POST", signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
    } catch (caught) {
      console.error(JSON.stringify({ productImporterWorker: "error", error: caught instanceof Error ? caught.message : String(caught) }));
    }
  });
  return Response.json({ ok: true }, { status: 202 });
}

export const GET = POST;
