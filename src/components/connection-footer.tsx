"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

type ConnectionKey = "mysql" | "shopify" | "sqlServer" | "mhd" | "icecat";
type Health = Record<ConnectionKey, boolean> & {
  errors: Partial<Record<ConnectionKey, string>>;
  checkedAt?: string;
};

const CONNECTIONS: { key: ConnectionKey; label: string }[] = [
  { key: "mysql", label: "MySQL Prestashop" },
  { key: "shopify", label: "API Shopify" },
  { key: "sqlServer", label: "SQL Pladisel" },
  { key: "mhd", label: "API MHD" },
  { key: "icecat", label: "Icecat API" },
];

const REFRESH_INTERVAL_MS = 5 * 60 * 1_000;
const FOCUS_COOLDOWN_MS = 60 * 1_000;
const CONNECTION_ERROR = "No se pudo consultar el estado de las conexiones.";

export function ConnectionFooter() {
  const pathname = usePathname();
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(false);
  const lastCheckAt = useRef(0);
  const requestInFlight = useRef(false);

  const loadHealth = useCallback(async (force = false) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setChecking(true);
    setHealth(null);
    try {
      const response = await fetch(`/api/health${force ? "?refresh=1" : ""}`, { cache: "no-store" });
      const body = await response.json();
      setHealth({
        mysql: Boolean(body.mysql),
        shopify: Boolean(body.shopify),
        sqlServer: Boolean(body.sqlServer),
        mhd: Boolean(body.mhd),
        icecat: Boolean(body.icecat),
        errors: body.errors ?? {},
        checkedAt: body.checkedAt,
      });
      lastCheckAt.current = Date.now();
    } catch {
      setHealth({
        mysql: false,
        shopify: false,
        sqlServer: false,
        mhd: false,
        icecat: false,
        errors: Object.fromEntries(CONNECTIONS.map(({ key }) => [key, CONNECTION_ERROR])),
      });
      lastCheckAt.current = Date.now();
    } finally {
      requestInFlight.current = false;
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (pathname === "/login" || pathname === "/set-password" || pathname.startsWith("/auth/")) return;
    void loadHealth();
    const interval = window.setInterval(() => void loadHealth(), REFRESH_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && Date.now() - lastCheckAt.current >= FOCUS_COOLDOWN_MS) {
        void loadHealth();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadHealth, pathname]);

  if (pathname === "/login" || pathname === "/set-password" || pathname.startsWith("/auth/")) return null;
  const hasSidebar = pathname.startsWith("/importacion-") || pathname.startsWith("/importar-datos-") || pathname.startsWith("/importaciones-");

  return <footer className={`fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white/95 px-5 py-3 shadow-[0_-3px_14px_rgb(0,0,0,0.05)] backdrop-blur ${hasSidebar ? "lg:left-60" : ""}`}>
    <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-2 px-2 text-xs text-zinc-700 sm:text-sm">
      {CONNECTIONS.map(({ key, label }) => <ConnectionStatus key={key} label={label} ok={health?.[key]} error={health?.errors[key]} />)}
      <button type="button" onClick={() => void loadHealth(true)} disabled={checking} title="Comprobar conexiones ahora" aria-label="Comprobar conexiones ahora" className="rounded-md p-1.5 text-emerald-700 hover:bg-emerald-50 disabled:cursor-wait disabled:text-zinc-400">
        <svg viewBox="0 0 24 24" aria-hidden="true" className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" /><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" /><path d="M21 3v5h-5" /><path d="M3 21v-5h5" /></svg>
      </button>
    </div>
  </footer>;
}

function ConnectionStatus({ label, ok, error }: { label: string; ok: boolean | undefined; error?: string }) {
  const message = error ?? "La conexión no está disponible.";
  return <span className={`group relative flex items-center gap-2 ${ok === false ? "cursor-help" : ""}`}>
    <span className={`h-2.5 w-2.5 rounded-full ${ok === undefined ? "bg-amber-400" : ok ? "bg-emerald-500" : "bg-red-500"}`} />
    {label}
    {ok === false && <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-max max-w-80 -translate-x-1/2 rounded-lg bg-zinc-900 px-3 py-2 text-xs leading-5 text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">{message}<span className="absolute left-1/2 top-full -translate-x-1/2 border-x-4 border-t-4 border-x-transparent border-t-zinc-900" /></span>}
  </span>;
}
