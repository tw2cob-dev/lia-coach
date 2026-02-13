import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LIA Coach",
    short_name: "LIA Coach",
    description: "Acompanamiento diario para alimentacion, entrenamiento y salud.",
    start_url: "/chat",
    display: "standalone",
    background_color: "#080a10",
    theme_color: "#080a10",
    lang: "es-ES",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/icon-180.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
