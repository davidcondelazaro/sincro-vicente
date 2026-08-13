"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError("Email o contraseña incorrectos.");
      setLoading(false);
      return;
    }
    router.replace(new URLSearchParams(window.location.search).get("next") || "/");
    router.refresh();
  }

  async function requestPassword() {
    if (!email) { setError("Escribe primero tu email para recibir el enlace de contraseña."); return; }
    setLoading(true);
    setError(null);
    const { error: resetError } = await createClient().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/set-password` });
    if (resetError) setError("No se pudo enviar el email. Prueba de nuevo en unos minutos.");
    else setResetSent(true);
    setLoading(false);
  }

  return <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-6 py-16">
    <form onSubmit={signIn} className="w-full space-y-5 rounded-2xl border border-zinc-200 bg-white p-7 shadow-sm">
      <div><p className="text-sm font-semibold tracking-[0.18em] text-emerald-700 uppercase">Sincro Vicente</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">Acceso privado</h1><p className="mt-2 text-sm text-zinc-600">Introduce tus credenciales para continuar.</p></div>
      <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">Email<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="h-11 rounded-lg border border-zinc-300 px-3 outline-none ring-emerald-600 focus:ring-2" /></label>
      <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">Contraseña<input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 rounded-lg border border-zinc-300 px-3 outline-none ring-emerald-600 focus:ring-2" /></label>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {resetSent && <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">Te hemos enviado un enlace para crear o restablecer la contraseña.</p>}
      <button disabled={loading} className="h-11 w-full rounded-lg bg-emerald-700 font-medium text-white transition hover:bg-emerald-800 disabled:opacity-60">{loading ? "Accediendo…" : "Entrar"}</button>
      <button type="button" onClick={requestPassword} disabled={loading} className="w-full text-sm font-medium text-emerald-800 hover:text-emerald-950">Crear o recuperar contraseña</button>
    </form>
  </main>;
}
