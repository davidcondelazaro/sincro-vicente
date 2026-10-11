"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

type Section = "home" | "customer" | "customers" | "catalog" | "priorities" | "icecat" | "supabase" | "mhdImport" | "mhdCatalog" | "prices" | "stock" | "orders" | "chatbotStats" | "chatbotConversations" | "chatbotImprovements" | "chatbotSupport" | "chatbotErrors" | "chatbotSyncs" | "chatbotDiscounts" | "chatbotSettings";
type IconName = "home" | "database" | "users" | "catalog" | "price" | "stock" | "sort" | "icecat" | "orders" | "spark" | "ticket" | "chart" | "chat" | "support" | "alert" | "sync" | "settings" | "export";

const navigation: { section: Section; href: string; label: string; icon: IconName }[] = [
  { section: "home", href: "/", label: "Inicio", icon: "home" },
  { section: "chatbotStats", href: "/chatbot/estadisticas", label: "Estadísticas", icon: "chart" },
  { section: "chatbotConversations", href: "/chatbot/conversaciones", label: "Conversaciones", icon: "chat" },
  { section: "chatbotImprovements", href: "/chatbot/mejoras", label: "Mejoras", icon: "spark" },
  { section: "chatbotSupport", href: "/chatbot/soporte", label: "Soporte", icon: "support" },
  { section: "chatbotErrors", href: "/chatbot/errores", label: "Errores del widget", icon: "alert" },
  { section: "chatbotDiscounts", href: "/chatbot/cupones", label: "Cupones descuento", icon: "ticket" },
  { section: "chatbotSyncs", href: "/chatbot/sincronizaciones", label: "Sincronizaciones", icon: "sync" },
  { section: "chatbotSettings", href: "/chatbot/configuracion", label: "Configuración", icon: "settings" },
  { section: "mhdImport", href: "/importar-datos-mhd", label: "Importar de MHD", icon: "database" },
  { section: "mhdCatalog", href: "/importacion-catalogo-mhd", label: "Catálogo MHD", icon: "catalog" },
  { section: "orders", href: "/pedidos-mhd", label: "Pedidos MHD", icon: "orders" },
  { section: "supabase", href: "/importar-datos-sql-server", label: "Importar de SQL Server", icon: "database" },
  { section: "customers", href: "/importacion-clientes", label: "Importación de clientes", icon: "users" },
  { section: "catalog", href: "/importacion-catalogo", label: "Importación catálogo", icon: "catalog" },
  { section: "prices", href: "/importacion-precios", label: "Importación de precios", icon: "price" },
  { section: "stock", href: "/importacion-stock", label: "Importación de stock", icon: "stock" },
  { section: "priorities", href: "/ordenacion-productos", label: "Ordenación de productos", icon: "sort" },
  { section: "icecat", href: "/importacion-icecat", label: "Importación Icecat", icon: "icecat" },
];

const groupLabels: Partial<Record<Section, string>> = { mhdImport: "MHD", supabase: "Pladisel", chatbotStats: "Chatbot IA" };

export function AppSidebar({ active, userEmail }: { active: Section; userEmail: string | null }) {
  const [open, setOpen] = useState(false);
  const itemClass = (section: Section) => `flex min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-sm ${active === section ? "bg-emerald-50 font-semibold text-emerald-900" : "text-zinc-600 hover:bg-zinc-50"}`;
  const close = () => setOpen(false);

  return <>
    <title>{pageTitle(active)}</title>
    <header className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-zinc-200 bg-white px-5 py-3 shadow-sm lg:hidden">
      <Link href="/" className="flex items-center gap-2" aria-label="Ir al inicio"><Image src="/electronica-vicente.svg" alt="Electrónica Vicente" width={2124} height={462} priority className="h-auto w-36" /><AppLabels className="hidden sm:flex" /></Link>
      <button type="button" onClick={() => setOpen(true)} className="grid h-10 w-10 cursor-pointer place-items-center rounded-lg border border-zinc-300 text-zinc-700 hover:bg-zinc-50" aria-label="Abrir menú"><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg></button>
    </header>
    <div className="hidden lg:block" aria-hidden="true" />
    {open && <button type="button" onClick={close} className="fixed inset-0 z-40 bg-zinc-950/30 lg:hidden" aria-label="Cerrar menú" />}
    <aside className={`fixed inset-y-0 right-0 z-50 flex w-72 min-w-0 flex-col overflow-hidden border-l border-zinc-200 bg-white px-5 pt-5 shadow-xl transition-transform lg:right-auto lg:left-0 lg:w-60 lg:border-b-0 lg:border-l-0 lg:border-r lg:shadow-none ${open ? "translate-x-0" : "translate-x-full lg:translate-x-0"}`}>
      <div className="hidden min-w-0 px-3 lg:block"><Link href="/" className="block" aria-label="Ir al inicio"><Image src="/electronica-vicente.svg" alt="Electrónica Vicente" width={2124} height={462} priority className="h-auto w-full max-w-[13rem]" /><AppLabels className="mt-3 flex" /></Link></div>
      <div className="flex items-center justify-between lg:hidden"><p className="text-sm font-semibold text-zinc-900">MENÚ</p><button type="button" onClick={close} className="grid h-11 w-11 place-items-center rounded-lg text-3xl leading-none text-zinc-600 hover:bg-zinc-100" aria-label="Cerrar menú">×</button></div>
      <nav className="-mx-1 mt-5 flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto px-1 lg:mt-6" aria-label="Módulos de la aplicación">{navigation.map((entry) => <div key={entry.section}>{(entry.section === "mhdImport" || entry.section === "supabase") && <div className="my-3 border-t border-zinc-200" />}{groupLabels[entry.section] && <p className="mt-4 mb-1 px-3 text-xs font-medium text-zinc-400">{groupLabels[entry.section]}</p>}<a onClick={close} href={entry.href} className={itemClass(entry.section)}><Icon name={entry.icon} /><span className="min-w-0 truncate">{entry.label}</span></a></div>)}</nav>
      <UserMenu email={userEmail} />
    </aside>
  </>;
}

function AppLabels({ className }: { className: string }) {
  const label = "rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-emerald-700 ring-1 ring-emerald-600/15 ring-inset";
  return <span className={`${className} flex-wrap gap-1.5`}><span className={label}>Conector</span><span className={label}>Utilidades</span></span>;
}

// Título de la pestaña: "Apartado · Grupo · Sincro Vicente" (el grupo es la última etiqueta del menú antes del apartado).
function pageTitle(section: Section) {
  const index = navigation.findIndex((entry) => entry.section === section);
  if (index <= 0) return "Sincro Vicente";
  const group = navigation.slice(0, index + 1).map((entry) => groupLabels[entry.section]).filter(Boolean).at(-1);
  return [navigation[index].label, group, "Sincro Vicente"].filter(Boolean).join(" · ");
}

function UserMenu({ email }: { email: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const label = email ?? "Comprobando…";
  const name = email ? email.split("@")[0] : "";

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return <div ref={ref} className="relative -mx-5 mt-4 flex h-14 shrink-0 items-center border-t border-zinc-200 px-6">
    {open && <div role="menu" className="absolute inset-x-4 bottom-full mb-2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg">
      <div className="border-b border-zinc-100 px-3 py-2.5"><p className="truncate text-sm font-medium text-zinc-900">{name || label}</p><p className="truncate text-xs text-zinc-500">{label}</p></div>
      <form action="/auth/logout" method="post" className="p-1"><button type="submit" role="menuitem" className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-zinc-700 hover:bg-zinc-100"><Icon name="export" />Cerrar sesión</button></form>
    </div>}
    <button type="button" onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open} className="flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-zinc-50">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-500 to-lime-400 text-sm font-semibold text-white uppercase" aria-hidden="true">{email ? email[0] : ""}</span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800">{name || label}</span>
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-zinc-200 text-zinc-500" aria-hidden="true"><svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg></span>
    </button>
  </div>;
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
    orders: <><path d="M6 3h12v18H6z" /><path d="M9 3v3h6V3M9 10h6M9 14h6M9 18h3" /></>,
    ticket: <><path d="M3 9a2 2 0 0 0 0 6v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3a2 2 0 0 1 0-6V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v3Z" /><path d="M13 5v2M13 11v2M13 17v2" /></>,
    spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />,
    chart: <><path d="M3 3v18h18" /><path d="M7 16v-4M12 16V8M17 16v-7" /></>,
    chat: <path d="M21 12a8 8 0 0 1-11.8 7L4 20.5l1.4-4.6A8 8 0 1 1 21 12Z" />,
    support: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><path d="m5.6 5.6 3.6 3.6M14.8 14.8l3.6 3.6M14.8 9.2l3.6-3.6M5.6 18.4l3.6-3.6" /></>,
    alert: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>,
    sync: <><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" /><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" /><path d="M21 3v5h-5M3 21v-5h5" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
    export: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>,
  };
  return <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
