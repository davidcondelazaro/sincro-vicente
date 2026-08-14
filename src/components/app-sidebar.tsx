"use client";

import Image from "next/image";
import { useState } from "react";

type Section = "customer" | "customers" | "catalog" | "icecat" | "supabase";

export function AppSidebar({ active, userEmail }: { active: Section; userEmail: string | null }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const item = (section: Section) => `shrink-0 rounded-lg px-3 py-2 text-sm ${active === section ? "bg-emerald-50 font-semibold text-emerald-900" : "text-zinc-600 hover:bg-zinc-50"}`;

  return <>
    <header className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-zinc-200 bg-white px-5 py-3 shadow-sm lg:hidden"><div><Image src="/electronica-vicente.webp" alt="Electrónica Vicente" width={600} height={152} priority className="h-auto w-40" /><p className="mt-1 text-xs font-semibold tracking-[0.16em] text-emerald-700 uppercase">Sincro Vicente</p></div><div className="flex items-center gap-2"><form action="/auth/logout" method="post"><button type="submit" className="grid h-10 w-10 place-items-center rounded-lg border border-zinc-300 text-zinc-700 hover:bg-zinc-50" aria-label="Cerrar sesión"><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M21 19V5a2 2 0 0 0-2-2h-6" /></svg></button></form><button type="button" onClick={() => setOpen(true)} className="grid h-10 w-10 place-items-center rounded-lg border border-zinc-300 text-zinc-700 hover:bg-zinc-50" aria-label="Abrir menú"><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg></button></div></header>
    {open && <button type="button" onClick={close} className="fixed inset-0 z-40 bg-zinc-950/30 lg:hidden" aria-label="Cerrar menú" />}
    <aside className={`fixed inset-y-0 left-0 z-50 w-72 border-r border-zinc-200 bg-white px-5 py-5 shadow-xl transition-transform lg:static lg:w-auto lg:min-h-screen lg:translate-x-0 lg:border-b-0 lg:shadow-none ${open ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="hidden lg:block"><div><Image src="/electronica-vicente.webp" alt="Electrónica Vicente" width={600} height={152} priority className="h-auto w-full max-w-[13rem]" /><p className="mt-3 text-sm font-semibold tracking-[0.18em] text-emerald-700 uppercase">Sincro Vicente</p><p className="mt-5 text-xs text-zinc-500">Sesión iniciada</p><p className="mt-1 truncate text-sm font-medium text-zinc-800">{userEmail ?? "comprobando…"}</p></div><form action="/auth/logout" method="post"><button className="mt-3 w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50">Cerrar sesión</button></form></div>
      <div className="flex items-center justify-between lg:hidden"><p className="text-sm font-semibold text-zinc-900">Menú</p><button type="button" onClick={close} className="grid h-11 w-11 place-items-center rounded-lg text-3xl leading-none text-zinc-600 hover:bg-zinc-100" aria-label="Cerrar menú">×</button></div>
      <nav className="mt-5 flex flex-col gap-2 lg:mt-6" aria-label="Módulos de la aplicación"><a onClick={close} href="/importar-datos-sql-server" className={item("supabase")}>Importar a Supabase</a><a onClick={close} href="/importacion-clientes" className={item("customers")}>Importación de clientes</a><a onClick={close} href="/importacion-catalogo" className={item("catalog")}>Importación catálogo</a><a onClick={close} href="/importacion-icecat" className={item("icecat")}>Importación Icecat</a><span className="shrink-0 rounded-lg px-3 py-2 text-sm text-zinc-400">Exportar pedidos a MHD <span className="ml-1 text-xs">Próximamente</span></span></nav>
    </aside>
  </>;
}
