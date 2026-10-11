import { createClient } from "@supabase/supabase-js";

// Supabase del proyecto chatbot-vicente. Usa la clave secreta: solo en el servidor, nunca en el navegador.
export function createChatbotClient() {
  const url = process.env.CHATBOT_SUPABASE_URL;
  const key = process.env.CHATBOT_SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Faltan las variables CHATBOT_SUPABASE_URL y CHATBOT_SUPABASE_SECRET_KEY.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
