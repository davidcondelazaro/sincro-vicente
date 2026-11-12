import { denied } from "@/lib/helpdesk-admin";

// Qué partes de utils administra el helpdesk.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const no = denied(req);
  if (no) return no;
  return Response.json({ version: 1, name: "utils", features: ["garantia3"] });
}
