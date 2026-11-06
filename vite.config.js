import { defineConfig } from "vite";

function createProxyErrorHandler(name) {
  return (proxy) => {
    proxy.on("error", (err, _req, res) => {
      console.warn(`[vite-proxy] ${name} error:`, err.message);

      if (res && !res.headersSent && typeof res.writeHead === "function") {
        res.writeHead(504, { "Content-Type": "text/plain" });
        res.end("Gateway Timeout");
      }
    });
  };
}

export default defineConfig({
  assetsInclude: ["**/*.kml", "**/*.kmz", "**/*.glb", "**/*.gltf", "**/*.dae"],

  server: {
    host: true,
    port: 5174,
    strictPort: false,

    // Allow your ngrok hostname
    allowedHosts: [
      "ardell-reusable-steven.ngrok-free.dev",
    ],

    watch: {
      // Large / locked data assets under src/data trip Windows EBUSY on fs.watch.
      ignored: [
        "**/*.kml",
        "**/*.tif",
        "**/*.geojson",
        "**/*.glb",
        "**/*.gltf",
        "**/scratch/**",
        "**/src/data/**",
      ],
    },

    proxy: {
      "/rivereye-api": {
        target: "https://rivereye-production.up.railway.app",
        changeOrigin: true,
        secure: true,
        timeout: 15000,
        rewrite: (path) =>
          path.replace(/^\/rivereye-api/, "/api"),
        configure: createProxyErrorHandler("rivereye-api"),
      },

      "/jalnetra-api": {
        target: "https://jalnetra-software-production.up.railway.app",
        changeOrigin: true,
        secure: true,
        timeout: 30000,
        rewrite: (path) =>
          path.replace(/^\/jalnetra-api/, "/api"),
        configure: createProxyErrorHandler("jalnetra-api"),
      },

      "/osm-overpass": {
        target: "https://overpass-api.de",
        changeOrigin: true,
        secure: true,
        timeout: 10000,
        rewrite: (path) =>
          path.replace(/^\/osm-overpass/, "/api/interpreter"),
        configure: createProxyErrorHandler("osm-overpass-1"),
      },

      "/osm-overpass-2": {
        target: "https://overpass.kumi.systems",
        changeOrigin: true,
        secure: true,
        timeout: 10000,
        rewrite: (path) =>
          path.replace(/^\/osm-overpass-2/, "/api/interpreter"),
        configure: createProxyErrorHandler("osm-overpass-2"),
      },

      "/osm-overpass-3": {
        target: "https://overpass.openstreetmap.fr",
        changeOrigin: true,
        secure: true,
        timeout: 10000,
        rewrite: (path) =>
          path.replace(/^\/osm-overpass-3/, "/api/interpreter"),
        configure: createProxyErrorHandler("osm-overpass-3"),
      },
    },
  },

  build: {
    target: "es2020",
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          const ext = assetInfo.name.split('.').pop();
          if (['glb', 'gltf', 'dae', 'bin'].includes(ext)) {
            return 'assets/models/[name]-[hash][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        }
      }
    }
  },

  preview: {
    host: true,
    port: 5174,
    strictPort: false,

    proxy: {
      "/osm-overpass": {
        target: "https://overpass-api.de",
        changeOrigin: true,
        secure: true,
        timeout: 10000,
        rewrite: (path) =>
          path.replace(/^\/osm-overpass/, "/api/interpreter"),
        configure: createProxyErrorHandler("osm-overpass-1"),
      },

      "/osm-overpass-2": {
        target: "https://overpass.kumi.systems",
        changeOrigin: true,
        secure: true,
        timeout: 10000,
        rewrite: (path) =>
          path.replace(/^\/osm-overpass-2/, "/api/interpreter"),
        configure: createProxyErrorHandler("osm-overpass-2"),
      },

      "/osm-overpass-3": {
        target: "https://overpass.openstreetmap.fr",
        changeOrigin: true,
        secure: true,
        timeout: 10000,
        rewrite: (path) =>
          path.replace(/^\/osm-overpass-3/, "/api/interpreter"),
        configure: createProxyErrorHandler("osm-overpass-3"),
      },
    },
  },
});
