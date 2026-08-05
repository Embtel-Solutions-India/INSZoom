import react from "@vitejs/plugin-react";

export function viteOptions(root) {
  return {
    root,
    configFile: false,
    plugins: [react()],
    server: {
      port: 3002,
      proxy: {
        "/api": {
          target: "http://localhost:7000",
          changeOrigin: true,
        },
      },
    },
  };
}
