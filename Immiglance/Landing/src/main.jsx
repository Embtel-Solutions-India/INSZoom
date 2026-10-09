import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import { API_BASE_URL } from "./services/api";
import { startBranding } from "./utils/branding";

startBranding(API_BASE_URL);
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { SocketProvider } from "./context/SocketContext.jsx";
import { ThemeProvider } from "./context/ThemeContext.jsx";
import ThemeSync from "./context/ThemeSync.jsx";

// Identical to the pre-split Immiglance/Frontend/src/main.jsx. The provider
// stack (and therefore the session/token/socket behaviour) is deliberately
// unchanged: Landing and Client each mount their own copy of the same
// AuthProvider, which bootstraps from the same httpOnly refresh cookie via
// GET /auth/me exactly as before.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <ThemeSync />
          <SocketProvider>
            <App />
          </SocketProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
