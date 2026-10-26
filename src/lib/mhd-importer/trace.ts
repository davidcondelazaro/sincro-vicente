// Registro de lo que hace el procesador con cada producto (2026-10-26): cada paso con su duración y los hechos que
// interesan (decisiones, anomalías, errores). El procesado en producción lo guarda en mhd_importer_events para verlo en
// directo en la pantalla «Procesos»; en las pruebas sueltas no se guarda nada (noTrace).

export type TraceLevel = "info" | "decision" | "aviso" | "error" | "revision";
export type TraceEvent = { level: TraceLevel; step: string; message: string; durationMs?: number; data?: Record<string, unknown> };
export type Trace = {
  step<T>(name: string, run: () => T | Promise<T>, describe?: (result: T) => string | null): Promise<T>;
  event(level: TraceLevel, step: string, message: string, data?: Record<string, unknown>): void;
};

// Crea un registro que entrega cada hecho a `sink` (la base, la consola…) y avisa a `onStart` al empezar cada paso, para
// ver en directo el que está en marcha. Un paso que falla se registra como error con lo que tardó y el error sigue hacia
// arriba.
export function createTrace(sink: (event: TraceEvent) => void, onStart?: (step: string) => void): Trace {
  return {
    async step(name, run, describe) {
      const started = Date.now(); onStart?.(name);
      try {
        const result = await run();
        sink({ level: "info", step: name, message: describe?.(result) ?? "Hecho", durationMs: Date.now() - started });
        return result;
      } catch (caught) {
        sink({ level: "error", step: name, message: caught instanceof Error ? caught.message : String(caught), durationMs: Date.now() - started });
        throw caught;
      }
    },
    event(level, step, message, data) { sink({ level, step, message, data }); },
  };
}

export const noTrace: Trace = createTrace(() => {});
