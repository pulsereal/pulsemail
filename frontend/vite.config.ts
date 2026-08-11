import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

const API_TARGET = process.env.VITE_API_PROXY_TARGET || "http://localhost:3001";

export default defineConfig(({ mode }) => ({
    plugins: [react()],
    resolve: {
        alias: {
            "@": resolve(__dirname, "./src"),
        },
    },
    server: {
        port: 3000,
        proxy: {
            // apiClient uses a relative baseURL of "/api", so dev requests
            // need forwarding to the Express server.
            "/api": {
                target: API_TARGET,
                changeOrigin: true,
                secure: false,
            },
        },
    },
    build: {
        outDir: "dist",
        // nginx serves dist/ publicly, so shipping maps would publish the source
        sourcemap: mode !== "production",
        rollupOptions: {
            output: {
                manualChunks: {
                    react: ["react", "react-dom", "react-router-dom"],
                    editor: ["react-quill", "quill"],
                    charts: ["chart.js", "react-chartjs-2"],
                },
            },
        },
    },
}));
