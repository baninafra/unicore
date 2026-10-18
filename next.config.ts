import type { NextConfig } from "next";

// La app se exporta como archivos estáticos (carpeta out/) que Tauri empaqueta en el .exe.
const nextConfig: NextConfig = {
  output: "export",
  // Otra carpeta permite correr un segundo `next dev` en paralelo sin pisar al primero.
  // Sólo en desarrollo: al compilar, la exportación tiene que quedar en out/ (la que empaqueta Tauri).
  ...(process.env.NEXT_DIST_DIR && process.env.NODE_ENV !== "production" ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  trailingSlash: true,
  images: { unoptimized: true },
  webpack: (config) => {
    // El traductor (transformers.js) corre en el navegador: sus variantes para Node no se empaquetan.
    config.resolve.alias = { ...config.resolve.alias, sharp$: false, "onnxruntime-node$": false };
    return config;
  },
};

export default nextConfig;
