import type { NextConfig } from "next";

// La app se exporta como archivos estáticos (carpeta out/) que Tauri empaqueta en el .exe.
const nextConfig: NextConfig = {
  output: "export",
  // Otra carpeta de compilación permite correr un segundo `next dev` en paralelo sin pisar al primero.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  trailingSlash: true,
  images: { unoptimized: true },
  webpack: (config) => {
    // El traductor (transformers.js) corre en el navegador: sus variantes para Node no se empaquetan.
    config.resolve.alias = { ...config.resolve.alias, sharp$: false, "onnxruntime-node$": false };
    return config;
  },
};

export default nextConfig;
