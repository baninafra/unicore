import type { NextConfig } from "next";

// La app se exporta como archivos estáticos (carpeta out/) que Tauri empaqueta en el .exe.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
