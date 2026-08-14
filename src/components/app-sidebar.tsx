"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type ReactNode } from "react";

type Section = "home" | "customer" | "customers" | "catalog" | "priorities" | "icecat" | "supabase" | "prices" | "stock";
type IconName = "home" | "database" | "users" | "catalog" | "price" | "stock" | "sort" | "icecat" | "export";

const navigation: { section: Section; href: string; label: string; icon: IconName }[] = [
  { section: "home", href: "/", label: "Inicio", icon: "home" },
  { section: "supabase", href: "/importar-datos-sql-server", label: "Importar a Supabase", icon: "database" },
  { section: "customers", href: "/importacion-clientes", label: "Importación de clientes", icon: "users" },
  { section: "catalog", href: "/importacion-catalogo", label: "Importación catálogo", icon: "catalog" },
  { section: "prices", href: "/importacion-precios", label: "Importación de precios", icon: "price" },
  { section: "stock", href: "/importacion-stock", label: "Importación de stock", icon: "stock" },
  { section: "priorities", href: "/ordenacion-productos", label: "Ordenación de productos", icon: "sort" },
  { section: "icecat", href: "/importacion-icecat", label: "Importación Icecat", icon: "icecat" },
];

export function AppSidebar({ active, userEmail }: { active: Section; userEmail: string | null }) {
  const [open, setOpen] = useState(false);
  const itemClass = (section: Section) => `flex min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-sm ${active === section ? "bg-emerald-50 font-semibold text-emerald-900" : "text-zinc-600 hover:bg-zinc-50"}`;
  const close = () => setOpen(false);

  return <>
    <header className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-zinc-200 bg-white px-5 py-3 shadow-sm lg:hidden">
      <Link href="/" aria-label="Ir al inicio"><Image src="/electronica-vicente.webp" alt="Electrónica Vicente" width={600} height={152} priority className="h-auto w-40" /><p className="mt-1 text-xs font-semibold tracking-[0.16em] text-emerald-700 uppercase">Sincro Vicente</p></Link>
      <div className="flex items-center gap-2"><form action="/auth/logout" method="post"><button type="submit" className="grid h-10 w-10 cursor-pointer place-items-center rounded-lg border border-zinc-300 text-zinc-700 hover:bg-zinc-50" aria-label="Cerrar sesión"><Icon name="export" /></button></form><button type="button" onClick={() => setOpen(true)} className="grid h-10 w-10 cursor-pointer place-items-center rounded-lg border border-zinc-300 text-zinc-700 hover:bg-zinc-50" aria-label="Abrir menú"><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg></button></div>
    </header>
    {open && <button type="button" onClick={close} className="fixed inset-0 z-40 bg-zinc-950/30 lg:hidden" aria-label="Cerrar menú" />}
    <aside className={`fixed inset-y-0 right-0 z-50 flex w-72 min-w-0 flex-col overflow-hidden border-l border-zinc-200 bg-white px-5 py-5 shadow-xl transition-transform lg:static lg:w-60 lg:border-b-0 lg:border-l-0 lg:shadow-none ${open ? "translate-x-0" : "translate-x-full lg:translate-x-0"}`}>
      <div className="hidden min-w-0 lg:block"><Link href="/" className="block" aria-label="Ir al inicio"><Image src="/electronica-vicente.webp" alt="Electrónica Vicente" width={600} height={152} priority className="h-auto w-full max-w-[13rem]" /><p className="mt-3 text-sm font-semibold tracking-[0.18em] text-emerald-700 uppercase">Sincro Vicente</p></Link><p className="mt-5 text-xs text-zinc-500">Sesión iniciada</p><p className="mt-1 truncate text-sm font-medium text-zinc-800">{userEmail ?? "comprobando…"}</p><form action="/auth/logout" method="post"><button className="mt-3 w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50">Cerrar sesión</button></form></div>
      <div className="flex items-center justify-between lg:hidden"><p className="text-sm font-semibold text-zinc-900">MENÚ</p><button type="button" onClick={close} className="grid h-11 w-11 place-items-center rounded-lg text-3xl leading-none text-zinc-600 hover:bg-zinc-100" aria-label="Cerrar menú">×</button></div>
      <nav className="mt-5 flex min-w-0 flex-col gap-2 lg:mt-6" aria-label="Módulos de la aplicación">{navigation.map((entry) => <a key={entry.section} onClick={close} href={entry.href} className={itemClass(entry.section)}><Icon name={entry.icon} /><span className="min-w-0 truncate">{entry.label}</span></a>)}<span className="flex min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-400"><Icon name="export" /><span className="min-w-0"><span className="block truncate">Exportar pedidos a MHD</span><span className="block text-xs">Próximamente</span></span></span></nav>
    </aside>
  </>;
}

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10Z" /><path d="M9 21v-6h6v6" /></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    catalog: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 4v16" /></>,
    price: <><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" /><circle cx="7.5" cy="7.5" r="1" /></>,
    stock: <><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Z" /><path d="m3.5 7.8 8.5 4.5 8.5-4.5M12 12.5V21" /></>,
    sort: <><path d="M8 6h13M8 12h10M8 18h7M3 6h.01M3 12h.01M3 18h.01" /></>,
    icecat: <><circle cx="12" cy="12" r="9" /><path d="M3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
    export: <><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M21 19V5a2 2 0 0 0-2-2h-6" /></>,
  };
  return <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
