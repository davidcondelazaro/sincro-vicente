import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tipos de letra de las etiquetas energéticas (src/lib/mhd-importer/fonts.ts): tienen que viajar con las funciones
  // que dibujan etiquetas.
  // Fuentes de la base de redirecciones (src/lib/redirects/load.ts).
  outputFileTracingIncludes: { "/api/importador-productos/**": ["./fonts/**/*"], "/api/redirecciones": ["./data/redirecciones/**/*"] },
};

export default nextConfig;
