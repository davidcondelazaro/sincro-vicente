"use client";

import { useCallback, useEffect, useState } from "react";

// Informes de mejora del chatbot: propuestas que salen de la revisión de calidad de las conversaciones.
// Se aprueban o descartan aquí; las aprobadas se aplican en el código del chatbot, con su caso de prueba.
type Report = { id: number; created_at: string; period_from: string; period_to: string; conversations: number; issues: number; status: "running" | "ok" | "error"; error: string | null; requested_by: string | null };
type Proposal = { id: number; report_id: number; title: string; problem: string; suggestion: string; kind: string; severity: "baja" | "media" | "alta"; occurrences: number; evidence: { conversation_id: string; quote: string }[]; status: Status; decided_by: string | null; decided_at: string | null; notes: string | null };
type Approved = { id: number; report_id: number; title: string; severity: string; kind: string; decided_by: string | null; decided_at: string | null };
type Status = "pendiente" | "aprobada" | "descartada" | "aplicada";

const dateFormat = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" });
const dayFormat = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "short" });
const kindLabels: Record<string, string> = { prompt: "Instrucciones", herramienta: "Herramienta", datos: "Catálogo o contenido", otro: "Otro" };
const severityTones: Record<string, string> = { alta: "bg-red-50 text-red-800", media: "bg-amber-50 text-amber-800", baja: "bg-zinc-100 text-zinc-700" };
const statusLabels: Record<Status, string> = { pendiente: "Pendiente", aprobada: "Aprobada", descartada: "Descartada", aplicada: "Aplicada" };
const statusTones: Record<Status, string> = { pendiente: "bg-zinc-100 text-zinc-700", aprobada: "bg-emerald-50 text-emerald-800", descartada: "bg-zinc-100 text-zinc-500 line-through", aplicada: "bg-sky-50 text-sky-800" };

export function ChatbotImprovements() {
  const [data, setData] = useState<{ reports: Report[]; reportId: number | null; proposals: Proposal[]; approved: Approved[] } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [days, setDays] = useState("7");
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (reportId: number | null) => {
    try {
      const response = await fetch(`/api/chatbot/improvements${reportId ? `?report=${reportId}` : ""}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudieron leer los informes.");
      setData(body); setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudieron leer los informes.");
    }
  }, []);

  useEffect(() => { void load(selected); }, [load, selected]);
  // Mientras haya un informe generándose, se refresca cada 10 segundos.
  const running = data?.reports.some((report) => report.status === "running") ?? false;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void load(selected), 10_000);
    return () => clearInterval(timer);
  }, [running, load, selected]);

  async function generate() {
    setLaunching(true); setError(null);
    try {
      const response = await fetch("/api/chatbot/improvements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days: Number(days) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo generar el informe.");
      setSelected(body.reportId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo generar el informe.");
    } finally { setLaunching(false); }
  }

  function replaceProposal(next: Proposal) {
    setData((current) => current && { ...current, proposals: current.proposals.map((item) => (item.id === next.id ? next : item)) });
    void load(selected);
  }

  const report = data?.reports.find((item) => item.id === (selected ?? data.reportId)) ?? null;
  return <div className="flex flex-col gap-6">
    <section className="flex flex-wrap items-end gap-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="mr-auto"><h2 className="text-lg font-semibold text-zinc-900">Generar informe</h2><p className="mt-1 max-w-2xl text-sm text-zinc-500">Agrupa los fallos encontrados en la revisión de las conversaciones en propuestas de mejora. Se genera solo cada lunes con la última semana; aquí puedes lanzarlo cuando quieras. Tarda uno o dos minutos.</p></div>
      <label className="text-sm font-medium text-zinc-700">Periodo<select value={days} onChange={(event) => setDays(event.target.value)} className="mt-1 block h-10 rounded-lg border border-zinc-300 bg-white px-2 font-normal"><option value="7">Últimos 7 días</option><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option></select></label>
      <button type="button" disabled={launching || running} onClick={() => void generate()} className="h-10 cursor-pointer rounded-lg bg-emerald-700 px-4 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">{launching ? "Lanzando…" : running ? "Generando informe…" : "Generar ahora"}</button>
    </section>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {!data ? !error && <p className="text-sm text-zinc-500">Cargando…</p> : <>
      {data.approved.length > 0 && <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
        <h2 className="text-base font-semibold text-emerald-900">Aprobadas, pendientes de aplicar ({data.approved.length})</h2>
        <p className="mt-1 text-sm text-emerald-900/80">Pídeme que las aplique: cambio las instrucciones del chatbot con su caso de prueba y las marco como aplicadas.</p>
        <ul className="mt-3 flex flex-col gap-1 text-sm text-emerald-950">{data.approved.map((item) => <li key={item.id}>· {item.title} <span className="text-emerald-800/70">({kindLabels[item.kind] ?? item.kind}, informe {item.report_id})</span></li>)}</ul>
      </section>}

      {data.reports.length > 0 && <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-zinc-500">Informes:</span>{data.reports.map((item) => <button key={item.id} type="button" onClick={() => setSelected(item.id)} aria-pressed={item.id === report?.id} className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm ${item.id === report?.id ? "bg-emerald-700 font-medium text-white" : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"}`}>{dayFormat.format(new Date(item.created_at))}{item.status === "running" ? " · generando" : item.status === "error" ? " · error" : ""}</button>)}</div>}

      {!report ? <p className="rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-500">Todavía no hay informes. Genera el primero.</p> : <>
        <p className="text-sm text-zinc-600">Del {dateFormat.format(new Date(report.period_from))} al {dateFormat.format(new Date(report.period_to))} · {report.conversations} conversaciones revisadas · {report.issues} fallos · {report.requested_by === "programado" ? "programado" : `pedido por ${report.requested_by}`}</p>
        {report.status === "running" && <p className="rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-500">Generando el informe…</p>}
        {report.status === "error" && <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">El informe falló: {report.error}</p>}
        {report.status === "ok" && (data.proposals.length === 0 ? <p className="rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-500">Sin propuestas: no se encontraron fallos que merezcan un cambio en este periodo.</p>
          : <div className="flex flex-col gap-4">{data.proposals.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} onChange={replaceProposal} />)}</div>)}
      </>}
    </>}
  </div>;
}

function ProposalCard({ proposal, onChange }: { proposal: Proposal; onChange: (next: Proposal) => void }) {
  const [notes, setNotes] = useState(proposal.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(status: Status) {
    setSaving(true); setError(null);
    try {
      const response = await fetch("/api/chatbot/improvements", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: proposal.id, status, notes }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo guardar.");
      onChange(body.proposal);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo guardar.");
    } finally { setSaving(false); }
  }

  const button = "cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";
  return <article className={`rounded-2xl border bg-white p-5 shadow-sm ${proposal.status === "descartada" ? "border-zinc-200 opacity-70" : "border-zinc-200"}`}>
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="mr-auto text-base font-semibold text-zinc-900">{proposal.title}</h3>
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${severityTones[proposal.severity]}`}>Gravedad {proposal.severity}</span>
      <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700">{kindLabels[proposal.kind] ?? proposal.kind}</span>
      <span className="text-xs text-zinc-500">{proposal.occurrences} {proposal.occurrences === 1 ? "conversación" : "conversaciones"}</span>
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusTones[proposal.status]}`}>{statusLabels[proposal.status]}</span>
    </div>
    <p className="mt-3 text-sm text-zinc-700">{proposal.problem}</p>
    <div className="mt-3 rounded-xl bg-zinc-50 p-3"><p className="text-xs font-medium text-zinc-500">Propuesta</p><p className="mt-1 whitespace-pre-wrap text-sm text-zinc-900">{proposal.suggestion}</p></div>
    {proposal.evidence.length > 0 && <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium text-zinc-700">Ejemplos ({proposal.evidence.length})</summary><ul className="mt-2 flex flex-col gap-2">{proposal.evidence.map((item, index) => <li key={index} className="rounded-lg border border-zinc-100 p-2"><p className="text-zinc-800">«{item.quote}»</p><a href={`/chatbot/conversaciones?conversacion=${encodeURIComponent(item.conversation_id)}`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-medium text-emerald-700 hover:underline">Ver la conversación ↗</a></li>)}</ul></details>}
    <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-4">
      <label className="min-w-64 flex-1 text-xs font-medium text-zinc-500">Nota (opcional)<input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Por qué se aprueba o descarta, matices…" className="mt-1 block h-9 w-full rounded-lg border border-zinc-300 bg-white px-2 text-sm font-normal text-zinc-900" /></label>
      {proposal.status !== "aprobada" && proposal.status !== "aplicada" && <button type="button" disabled={saving} onClick={() => void decide("aprobada")} className={`${button} bg-emerald-700 text-white hover:bg-emerald-800`}>Aprobar</button>}
      {proposal.status !== "descartada" && proposal.status !== "aplicada" && <button type="button" disabled={saving} onClick={() => void decide("descartada")} className={`${button} border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50`}>Descartar</button>}
      {proposal.status === "aprobada" && <button type="button" disabled={saving} onClick={() => void decide("aplicada")} className={`${button} border border-sky-300 bg-white text-sky-800 hover:bg-sky-50`}>Marcar aplicada</button>}
      {proposal.status !== "pendiente" && <button type="button" disabled={saving} onClick={() => void decide("pendiente")} className={`${button} text-zinc-500 hover:bg-zinc-100`}>Volver a pendiente</button>}
    </div>
    {proposal.decided_by && proposal.status !== "pendiente" && <p className="mt-2 text-xs text-zinc-500">{statusLabels[proposal.status]} por {proposal.decided_by}{proposal.decided_at ? ` · ${dateFormat.format(new Date(proposal.decided_at))}` : ""}</p>}
    {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
  </article>;
}
