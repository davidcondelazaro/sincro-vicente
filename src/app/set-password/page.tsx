"use client";

import { FormEvent, useState } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setReady(Boolean(session)));
    supabase.auth.getSession().then(({ data }) => setReady(Boolean(data.session)));
    return () => subscription.unsubscribe();
  }, []);

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 12) return setError("Usa al menos 12 caracteres.");
    if (password !== confirmation) return setError("Las contraseñas no coinciden.");
    setLoading(true);
    setError(null);
    const { error: updateError } = await createClient().auth.updateUser({ password });
    if (updateError) { setError("No se pudo guardar la contraseña. Vuelve a abrir el enlace de invitación."); setLoading(false); return; }
    router.replace("/");
    router.refresh();
  }

  return <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-6 py-16"><form onSubmit={savePassword} className="w-full space-y-5 rounded-2xl border border-zinc-200 bg-white p-7 shadow-sm">
    <div><p className="text-sm font-semibold tracking-[0.18em] text-emerald-700 uppercase">Sincro Vicente</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">Crea tu contraseña</h1><p className="mt-2 text-sm text-zinc-600">Define la contraseña para tu acceso privado.</p></div>
    {!ready && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Abre esta página desde el enlace que has recibido por email.</p>}
    <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">Contraseña<input type="password" required disabled={!ready} minLength={12} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 rounded-lg border border-zinc-300 px-3 outline-none ring-emerald-600 focus:ring-2 disabled:bg-zinc-100" /></label>
    <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">Repetir contraseña<input type="password" required minLength={12} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="h-11 rounded-lg border border-zinc-300 px-3 outline-none ring-emerald-600 focus:ring-2" /></label>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <button disabled={loading || !ready} className="h-11 w-full rounded-lg bg-emerald-700 font-medium text-white transition hover:bg-emerald-800 disabled:opacity-60">{loading ? "Guardando…" : "Guardar y entrar"}</button>
  </form></main>;
}
