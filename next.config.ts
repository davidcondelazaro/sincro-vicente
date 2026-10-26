import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tipos de letra de las etiquetas energéticas (src/lib/mhd-importer/fonts.ts): tienen que viajar con las funciones
  // que dibujan etiquetas.
  outputFileTracingIncludes: { "/api/importador-productos/**": ["./fonts/**/*"] },
};

export default nextConfig;
