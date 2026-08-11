import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { adminAPI, apiClient, setAuthBridge } from "../services/api";
import type { AccessibleMailbox, User } from "../types";

interface AuthState {
    user: User | null;
    token: string | null;
    isAuthenticated: boolean;
    isLoading: boolean;

    /** Mailbox the UI is currently acting on; equals user.email unless an admin switched. */
    activeMailbox: string | null;
    accessibleMailboxes: AccessibleMailbox[];
    mailboxesLoading: boolean;

    login: (
        email: string,
        password: string,
        twoFactorCode?: string
    ) => Promise<void>;
    logout: () => void;
    refreshToken: () => Promise<void>;
    updateUser: (userData: Partial<User>) => void;
    setLoading: (loading: boolean) => void;

    setActiveMailbox: (mailbox: string) => void;
    resetActiveMailbox: () => void;
    loadAccessibleMailboxes: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set, get) => ({
            user: null,
            token: null,
            isAuthenticated: false,
            isLoading: false,
            activeMailbox: null,
            accessibleMailboxes: [],
            mailboxesLoading: false,

            login: async (email, password, twoFactorCode) => {
                set({ isLoading: true });

                try {
                    const response = await apiClient.post("/auth/login", {
                        email,
                        password,
                        twoFactorCode,
                    });

                    const { token, user } = response.data;

                    set({
                        user,
                        token,
                        isAuthenticated: true,
                        isLoading: false,
                        activeMailbox: user.email,
                        accessibleMailboxes: [],
                    });

                    if (user.isAdmin) {
                        void get().loadAccessibleMailboxes();
                    }
                } catch (error) {
                    set({ isLoading: false });
                    throw error;
                }
            },

            logout: () => {
                set({
                    user: null,
                    token: null,
                    isAuthenticated: false,
                    isLoading: false,
                    activeMailbox: null,
                    accessibleMailboxes: [],
                });
            },

            refreshToken: async () => {
                try {
                    const response = await apiClient.post("/auth/refresh");
                    set({ token: response.data.token });
                } catch (error) {
                    get().logout();
                    throw error;
                }
            },

            updateUser: (userData) => {
                set((state) => ({
                    user: state.user ? { ...state.user, ...userData } : null,
                }));
            },

            setLoading: (isLoading) => set({ isLoading }),

            setActiveMailbox: (mailbox) => set({ activeMailbox: mailbox }),

            resetActiveMailbox: () =>
                set((state) => ({ activeMailbox: state.user?.email ?? null })),

            loadAccessibleMailboxes: async () => {
                const { user } = get();
                if (!user?.isAdmin) return;

                set({ mailboxesLoading: true });
                try {
                    const response = await adminAPI.getAccessibleMailboxes({
                        limit: 500,
                    });
                    set({
                        accessibleMailboxes: response.data.mailboxes || [],
                        mailboxesLoading: false,
                    });
                } catch (error) {
                    set({ mailboxesLoading: false });
                }
            },
        }),
        {
            name: "auth-storage",
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                user: state.user,
                token: state.token,
                isAuthenticated: state.isAuthenticated,
                activeMailbox: state.activeMailbox,
            }),
            onRehydrateStorage: () => (state) => {
                if (state?.user && !state.activeMailbox) {
                    state.activeMailbox = state.user.email;
                }
            },
        }
    )
);

setAuthBridge({
    getToken: () => useAuthStore.getState().token,
    getActiveMailbox: () => useAuthStore.getState().activeMailbox,
    getOwnEmail: () => useAuthStore.getState().user?.email ?? null,
    onUnauthorized: () => useAuthStore.getState().logout(),
});

/** True when an admin is reading or acting inside somebody else's mailbox. */
export const useIsImpersonating = () =>
    useAuthStore(
        (state) =>
            Boolean(state.activeMailbox) &&
            state.activeMailbox !== state.user?.email
    );

export const useIsAdmin = () =>
    useAuthStore((state) => Boolean(state.user?.isAdmin));

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/** Refresh the JWT five minutes before it expires, or sign out if it already has. */
const scheduleTokenRefresh = (token: string | null) => {
    if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
    }
    if (!token) return;

    try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        const msUntilRefresh = payload.exp * 1000 - Date.now() - 5 * 60 * 1000;

        if (msUntilRefresh <= 0) {
            useAuthStore.getState().logout();
            return;
        }

        refreshTimer = setTimeout(() => {
            useAuthStore
                .getState()
                .refreshToken()
                .catch(() => useAuthStore.getState().logout());
        }, msUntilRefresh);
    } catch {
        useAuthStore.getState().logout();
    }
};

if (typeof window !== "undefined") {
    scheduleTokenRefresh(useAuthStore.getState().token);
    useAuthStore.subscribe((state, previous) => {
        if (state.token !== previous.token) {
            scheduleTokenRefresh(state.token);
        }
    });
}
