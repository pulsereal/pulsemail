import { Suspense, lazy } from "react";
import {
    BrowserRouter as Router,
    Routes,
    Route,
    Navigate,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "react-query";
import { Toaster } from "react-hot-toast";
import { useAuthStore } from "./stores/authStore";
import { ThemeProvider } from "./providers/ThemeProvider";

import Layout from "./components/Layout";
import LoadingSpinner from "./components/LoadingSpinner";
import ProtectedRoute from "./components/ProtectedRoute";
import AdminRoute from "./components/AdminRoute";
import LoginPage from "./pages/LoginPage";
import EmailsPage from "./pages/EmailsPage";

const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const CampaignsPage = lazy(() => import("./pages/CampaignsPage"));
const AutomationPage = lazy(() => import("./pages/AutomationPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const UnifiedInboxPage = lazy(() => import("./pages/UnifiedInboxPage"));
const UsersPage = lazy(() => import("./pages/UsersPage"));
const DomainsPage = lazy(() => import("./pages/DomainsPage"));
const AliasesPage = lazy(() => import("./pages/AliasesPage"));
const AISettingsPage = lazy(() => import("./pages/AISettingsPage"));

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 60 * 1000,
        },
    },
});

const RouteFallback = () => (
    <LoadingSpinner fullHeight size="lg" label="Loading…" />
);

function App() {
    const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

    return (
        <QueryClientProvider client={queryClient}>
            <ThemeProvider>
                <Router>
                    <Suspense fallback={<RouteFallback />}>
                        <Routes>
                            <Route
                                path="/login"
                                element={
                                    isAuthenticated ? (
                                        <Navigate to="/emails" replace />
                                    ) : (
                                        <LoginPage />
                                    )
                                }
                            />

                            <Route element={<ProtectedRoute />}>
                                <Route element={<Layout />}>
                                    <Route
                                        index
                                        element={
                                            <Navigate to="/emails" replace />
                                        }
                                    />
                                    <Route
                                        path="emails"
                                        element={<EmailsPage />}
                                    />
                                    <Route
                                        path="campaigns"
                                        element={<CampaignsPage />}
                                    />
                                    <Route
                                        path="automation"
                                        element={<AutomationPage />}
                                    />
                                    <Route
                                        path="settings"
                                        element={<SettingsPage />}
                                    />

                                    <Route element={<AdminRoute />}>
                                        <Route
                                            path="dashboard"
                                            element={<DashboardPage />}
                                        />
                                        <Route
                                            path="all-inboxes"
                                            element={<UnifiedInboxPage />}
                                        />
                                        <Route
                                            path="users"
                                            element={<UsersPage />}
                                        />
                                        <Route
                                            path="domains"
                                            element={<DomainsPage />}
                                        />
                                        <Route
                                            path="aliases"
                                            element={<AliasesPage />}
                                        />
                                        <Route
                                            path="ai"
                                            element={<AISettingsPage />}
                                        />
                                    </Route>
                                </Route>
                            </Route>

                            <Route
                                path="*"
                                element={<Navigate to="/emails" replace />}
                            />
                        </Routes>
                    </Suspense>

                    <Toaster
                        position="top-right"
                        toastOptions={{
                            duration: 4000,
                            className:
                                "!bg-surface-raised !text-content !border !border-line !shadow-hard",
                            success: {
                                iconTheme: {
                                    primary: "#10b981",
                                    secondary: "#fff",
                                },
                            },
                            error: {
                                iconTheme: {
                                    primary: "#ef4444",
                                    secondary: "#fff",
                                },
                            },
                        }}
                    />
                </Router>
            </ThemeProvider>
        </QueryClientProvider>
    );
}

export default App;
