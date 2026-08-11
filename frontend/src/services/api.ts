import axios from "axios";
import toast from "react-hot-toast";

/**
 * The auth store owns the token and the mailbox the user is acting as, but it
 * also imports this module. The bridge keeps the dependency one-directional.
 */
interface AuthBridge {
    getToken: () => string | null;
    getActiveMailbox: () => string | null;
    getOwnEmail: () => string | null;
    onUnauthorized: () => void;
}

let bridge: AuthBridge | null = null;

export const setAuthBridge = (next: AuthBridge) => {
    bridge = next;
};

const MAILBOX_HEADER = "X-Mailbox";

/** Pin a single request to a mailbox, bypassing the active switcher selection. */
export const asMailbox = (mailbox?: string | null) =>
    mailbox ? { headers: { [MAILBOX_HEADER]: mailbox } } : {};

export const apiClient = axios.create({
    baseURL: import.meta.env.VITE_API_URL || "/api",
    timeout: 30000,
    headers: {
        "Content-Type": "application/json",
    },
});

apiClient.interceptors.request.use(
    (config) => {
        const token = bridge?.getToken() ?? null;
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }

        // Admins acting on another mailbox announce it per request; the server
        // re-validates the permission every time. A caller-supplied header wins,
        // which lets one-off cross-mailbox reads skip the global switcher.
        if (!config.headers[MAILBOX_HEADER]) {
            const activeMailbox = bridge?.getActiveMailbox();
            const ownEmail = bridge?.getOwnEmail();
            if (activeMailbox && activeMailbox !== ownEmail) {
                config.headers[MAILBOX_HEADER] = activeMailbox;
            }
        }

        return config;
    },
    (error) => Promise.reject(error)
);

apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        const { response, config } = error;
        const silent = config?.headers?.["X-Silent-Errors"] === "true";

        if (response?.status === 401) {
            bridge?.onUnauthorized();
            toast.error("Session expired. Please sign in again.");
        } else if (silent) {
            return Promise.reject(error);
        } else if (response?.status === 403) {
            toast.error(response.data?.error || "Access denied");
        } else if (response?.status === 429) {
            toast.error("Too many requests. Please try again shortly.");
        } else if (response?.status >= 500) {
            toast.error("Server error. Please try again later.");
        } else if (response?.data?.error) {
            toast.error(response.data.error);
        } else if (error.message === "Network Error") {
            toast.error("Network error. Please check your connection.");
        } else if (error.code !== "ERR_CANCELED") {
            toast.error("An unexpected error occurred");
        }

        return Promise.reject(error);
    }
);

export const authAPI = {
    login: (email: string, password: string, twoFactorCode?: string) =>
        apiClient.post("/auth/login", { email, password, twoFactorCode }),

    logout: () => apiClient.post("/auth/logout"),

    refreshToken: () => apiClient.post("/auth/refresh"),

    getMe: () => apiClient.get("/auth/me"),

    updatePreferences: (payload: {
        name?: string;
        preferences?: Record<string, unknown>;
    }) => apiClient.put("/auth/preferences", payload),

    setup2FA: () => apiClient.post("/auth/2fa/setup"),

    verify2FA: (token: string) => apiClient.post("/auth/2fa/verify", { token }),

    disable2FA: (token: string, password: string) =>
        apiClient.post("/auth/2fa/disable", { token, password }),

    getAppPasswords: () => apiClient.get("/auth/app-passwords"),

    createAppPassword: (name: string) =>
        apiClient.post("/auth/app-passwords", { name }),

    deleteAppPassword: (id: string) =>
        apiClient.delete(`/auth/app-passwords/${id}`),

    getQuota: () => apiClient.get("/auth/quota"),

    changePassword: (data: { currentPassword: string; newPassword: string }) =>
        apiClient.post("/auth/change-password", data),
};

/** Provisioning against the iRedMail `vmail` schema. Admin only. */
export const provisioningAPI = {
    getDomains: (params?: { search?: string }) =>
        apiClient.get("/admin/domains", { params }),

    getDomain: (domain: string) =>
        apiClient.get(`/admin/domains/${encodeURIComponent(domain)}`),

    createDomain: (data: {
        domain: string;
        description?: string;
        maxMailboxes?: number;
        maxAliases?: number;
        maxQuotaMb?: number;
        defaultUserQuotaMb?: number;
        active?: boolean;
    }) => apiClient.post("/admin/domains", data),

    updateDomain: (domain: string, data: Record<string, unknown>) =>
        apiClient.put(`/admin/domains/${encodeURIComponent(domain)}`, data),

    deleteDomain: (domain: string) =>
        apiClient.delete(`/admin/domains/${encodeURIComponent(domain)}`),

    addDomainAdmin: (domain: string, email: string) =>
        apiClient.post(`/admin/domains/${encodeURIComponent(domain)}/admins`, {
            email,
        }),

    removeDomainAdmin: (domain: string, email: string) =>
        apiClient.delete(
            `/admin/domains/${encodeURIComponent(domain)}/admins/${encodeURIComponent(email)}`
        ),

    addAliasDomain: (domain: string, aliasDomain: string) =>
        apiClient.post(
            `/admin/domains/${encodeURIComponent(domain)}/alias-domains`,
            { aliasDomain }
        ),

    removeAliasDomain: (domain: string, aliasDomain: string) =>
        apiClient.delete(
            `/admin/domains/${encodeURIComponent(domain)}/alias-domains/${encodeURIComponent(aliasDomain)}`
        ),

    setCatchAll: (domain: string, destinations: string[]) =>
        apiClient.put(
            `/admin/domains/${encodeURIComponent(domain)}/catch-all`,
            { destinations }
        ),

    getMailboxes: (params?: {
        search?: string;
        limit?: number;
        offset?: number;
    }) => apiClient.get("/admin/mailboxes", { params }),

    getMailbox: (email: string) =>
        apiClient.get(`/admin/mailboxes/${encodeURIComponent(email)}`),

    createMailbox: (data: {
        email: string;
        password: string;
        name?: string;
        quotaMb?: number;
        firstName?: string;
        lastName?: string;
        department?: string;
        active?: boolean;
        isGlobalAdmin?: boolean;
    }) => apiClient.post("/admin/mailboxes", data),

    updateMailbox: (email: string, data: Record<string, unknown>) =>
        apiClient.put(`/admin/mailboxes/${encodeURIComponent(email)}`, data),

    deleteMailbox: (email: string) =>
        apiClient.delete(`/admin/mailboxes/${encodeURIComponent(email)}`),

    setMailboxPassword: (email: string, password: string) =>
        apiClient.put(
            `/admin/mailboxes/${encodeURIComponent(email)}/password`,
            { password }
        ),

    setMailboxForwardings: (
        email: string,
        destinations: string[],
        keepCopy: boolean
    ) =>
        apiClient.put(
            `/admin/mailboxes/${encodeURIComponent(email)}/forwardings`,
            { destinations, keepCopy }
        ),

    setMailboxAliases: (email: string, addresses: string[]) =>
        apiClient.put(`/admin/mailboxes/${encodeURIComponent(email)}/aliases`, {
            addresses,
        }),

    getAliases: (params?: { search?: string }) =>
        apiClient.get("/admin/aliases", { params }),

    getAlias: (address: string) =>
        apiClient.get(`/admin/aliases/${encodeURIComponent(address)}`),

    createAlias: (data: {
        address: string;
        name?: string;
        members?: string[];
        accessPolicy?: string;
        active?: boolean;
    }) => apiClient.post("/admin/aliases", data),

    updateAlias: (address: string, data: Record<string, unknown>) =>
        apiClient.put(`/admin/aliases/${encodeURIComponent(address)}`, data),

    deleteAlias: (address: string) =>
        apiClient.delete(`/admin/aliases/${encodeURIComponent(address)}`),
};

/** Per-mailbox settings that follow the impersonated mailbox. */
export const mailboxAPI = {
    getFilters: () => apiClient.get("/mailbox/filters"),

    getFilterScript: () => apiClient.get("/mailbox/filters/script"),

    createFilter: (data: Record<string, unknown>) =>
        apiClient.post("/mailbox/filters", data),

    updateFilter: (id: number, data: Record<string, unknown>) =>
        apiClient.put(`/mailbox/filters/${id}`, data),

    deleteFilter: (id: number) => apiClient.delete(`/mailbox/filters/${id}`),

    getVacation: () => apiClient.get("/mailbox/vacation"),

    setVacation: (data: {
        enabled: boolean;
        subject?: string;
        body?: string;
        startDate?: string | null;
        endDate?: string | null;
        intervalDays?: number;
    }) => apiClient.put("/mailbox/vacation", data),

    getForwarding: () => apiClient.get("/mailbox/forwarding"),

    setForwarding: (destinations: string[], keepCopy: boolean) =>
        apiClient.put("/mailbox/forwarding", { destinations, keepCopy }),

    getIdentities: () => apiClient.get("/mailbox/identities"),

    saveIdentity: (data: {
        fromAddress: string;
        displayName?: string;
        signature?: string;
        isDefault?: boolean;
    }) => apiClient.put("/mailbox/identities", data),

    deleteIdentity: (id: number) =>
        apiClient.delete(`/mailbox/identities/${id}`),
};

export const adminAPI = {
    getAccessibleMailboxes: (params?: {
        search?: string;
        domain?: string;
        limit?: number;
        offset?: number;
    }) => apiClient.get("/auth/admin/mailboxes", { params }),

    getDashboard: () => apiClient.get("/admin/dashboard"),

    getUsers: (params?: { limit?: number; offset?: number; search?: string }) =>
        apiClient.get("/admin/users", { params }),

    getUser: (email: string) =>
        apiClient.get(`/admin/users/${encodeURIComponent(email)}`),

    getUnifiedEmails: (params?: {
        folder?: string;
        limit?: number;
        unread_only?: boolean;
        mailboxes?: string;
    }) => apiClient.get("/admin/unified/emails", { params }),

    getUnifiedStats: (params?: { folder?: string }) =>
        apiClient.get("/admin/unified/stats", { params }),

    getAccessLog: (params?: { limit?: number }) =>
        apiClient.get("/admin/access-log", { params }),
};

export const aiAPI = {
    getSettings: () => apiClient.get("/admin/ai/settings"),

    // apiKey is omitted to keep the stored key, or sent empty to clear it.
    saveSettings: (data: {
        enabled?: boolean;
        baseUrl?: string;
        apiKey?: string;
        model?: string;
        classifyEnabled?: boolean;
        summariesEnabled?: boolean;
        repliesEnabled?: boolean;
        importanceThreshold?: number;
        snippetChars?: number;
        batchSize?: number;
        dailyLimit?: number;
        lookbackDays?: number;
        customInstructions?: string | null;
    }) => apiClient.put("/admin/ai/settings", data),

    testConnection: (data?: {
        baseUrl?: string;
        apiKey?: string;
        model?: string;
    }) => apiClient.post("/admin/ai/settings/test", data ?? {}),

    getUsage: (days?: number) =>
        apiClient.get("/admin/ai/usage", { params: { days } }),

    runClassification: (mailboxes?: string[]) =>
        apiClient.post("/admin/ai/classify/run", { mailboxes }),
};

export const emailAPI = {
    getEmails: (params: {
        folder?: string;
        limit?: number;
        offset?: number;
        category?: string;
        unread_only?: boolean;
        priority?: boolean;
    }) => apiClient.get("/emails", { params }),

    getEmail: (uid: string, folder?: string, mailbox?: string | null) =>
        apiClient.get(`/emails/${uid}`, {
            params: { folder },
            ...asMailbox(mailbox),
        }),

    sendEmail: (data: {
        to: string | string[];
        cc?: string | string[];
        bcc?: string | string[];
        subject: string;
        content: string;
        test_spam?: boolean;
        attachments?: File[];
    }) => {
        const formData = new FormData();

        Object.entries(data).forEach(([key, value]) => {
            if (key === "attachments" || value === undefined) return;
            if (Array.isArray(value)) {
                formData.append(key, value.join(","));
            } else {
                formData.append(key, String(value));
            }
        });

        data.attachments?.forEach((file) => {
            formData.append("attachments", file);
        });

        return apiClient.post("/emails/send", formData, {
            headers: { "Content-Type": "multipart/form-data" },
        });
    },

    generateReply: (
        uid: string,
        options: {
            folder?: string;
            tone?: string;
            language?: string;
            custom_instructions?: string;
        }
    ) => apiClient.post(`/emails/${uid}/reply`, options),

    markEmail: (
        uid: string,
        action: "read" | "unread" | "flagged" | "unflagged" | "answered",
        folder?: string,
        mailbox?: string | null
    ) =>
        apiClient.patch(
            `/emails/${uid}/mark`,
            { action, folder },
            asMailbox(mailbox)
        ),

    deleteEmail: (
        uid: string,
        folder?: string,
        mailbox?: string | null,
        permanent?: boolean
    ) =>
        apiClient.delete(`/emails/${uid}`, {
            params: { folder, permanent: permanent ? "true" : undefined },
            ...asMailbox(mailbox),
        }),

    moveEmail: (
        uid: string,
        target_folder: string,
        source_folder?: string,
        mailbox?: string | null
    ) =>
        apiClient.patch(
            `/emails/${uid}/move`,
            { target_folder, source_folder },
            asMailbox(mailbox)
        ),

    setSpam: (
        uid: string,
        spam: boolean,
        folder?: string,
        mailbox?: string | null
    ) =>
        apiClient.patch(
            `/emails/${uid}/spam`,
            { spam, folder },
            asMailbox(mailbox)
        ),

    downloadAttachment: (uid: string, index: number, folder = "INBOX") =>
        apiClient.get(`/emails/${uid}/attachments/${index}`, {
            params: { folder },
            responseType: "blob",
        }),

    getSource: (uid: string, folder = "INBOX", download = false) =>
        apiClient.get(`/emails/${uid}/source`, {
            params: { folder, download: download ? "true" : undefined },
            responseType: download ? "blob" : "text",
        }),

    saveDraft: (data: {
        to?: string;
        cc?: string;
        bcc?: string;
        subject?: string;
        content?: string;
        inReplyTo?: string;
        references?: string;
        replaceUid?: string;
        attachments?: File[];
    }) => {
        const formData = new FormData();

        Object.entries(data).forEach(([key, value]) => {
            if (key === "attachments" || value === undefined || value === null)
                return;
            formData.append(key, String(value));
        });

        data.attachments?.forEach((file) =>
            formData.append("attachments", file)
        );

        return apiClient.post("/emails/drafts", formData, {
            headers: { "Content-Type": "multipart/form-data" },
        });
    },

    getFolders: () => apiClient.get("/emails/folders/list"),

    createFolder: (name: string) => apiClient.post("/emails/folders", { name }),

    renameFolder: (name: string, newName: string) =>
        apiClient.put(`/emails/folders/${encodeURIComponent(name)}`, {
            newName,
        }),

    deleteFolder: (name: string) =>
        apiClient.delete(`/emails/folders/${encodeURIComponent(name)}`),

    testSpam: (content: string, subject?: string, recipient?: string) =>
        apiClient.post("/emails/test-spam", { content, subject, recipient }),

    getStats: () => apiClient.get("/emails/stats/dashboard"),

    searchEmails: (data: {
        query?: string;
        folder?: string;
        sender?: string;
        subject?: string;
        date_from?: string;
        date_to?: string;
        has_attachments?: boolean;
        category?: string;
    }) => apiClient.post("/emails/search", data),

    categorizeEmail: (uid: string, category: string) =>
        apiClient.patch(`/emails/${uid}/categorize`, { category }),

    provideLLMFeedback: (log_id: string, rating: number, feedback?: string) =>
        apiClient.post("/emails/llm-feedback", { log_id, rating, feedback }),
};

export const campaignAPI = {
    getCampaigns: (params: {
        limit?: number;
        offset?: number;
        status?: string;
    }) => apiClient.get("/campaigns", { params }),

    getCampaign: (id: string) => apiClient.get(`/campaigns/${id}`),

    createCampaign: (data: {
        name: string;
        subject: string;
        content: string;
        recipients: Array<{ email: string; name?: string }>;
        scheduled_at?: string;
        template_id?: number;
    }) => apiClient.post("/campaigns", data),

    updateCampaign: (id: string, data: any) =>
        apiClient.put(`/campaigns/${id}`, data),

    deleteCampaign: (id: string) => apiClient.delete(`/campaigns/${id}`),

    sendCampaign: (id: string) => apiClient.post(`/campaigns/${id}/send`),

    scheduleCampaign: (id: string, scheduled_at: string) =>
        apiClient.post(`/campaigns/${id}/schedule`, { scheduled_at }),

    getAnalytics: (id: string) => apiClient.get(`/campaigns/${id}/analytics`),

    duplicateCampaign: (id: string, name?: string) =>
        apiClient.post(`/campaigns/${id}/duplicate`, { name }),

    getTemplates: () => apiClient.get("/campaigns/templates/list"),

    createTemplate: (data: {
        name: string;
        content: string;
        thumbnail?: string;
    }) => apiClient.post("/campaigns/templates", data),

    testCampaign: (id: string, test_emails: string[]) =>
        apiClient.post(`/campaigns/${id}/test`, { test_emails }),

    importRecipients: (csv_data: string) =>
        apiClient.post("/campaigns/recipients/import", { csv_data }),

    getPerformanceSummary: (period?: number) =>
        apiClient.get("/campaigns/performance/summary", { params: { period } }),

    cancelCampaign: (id: string) => apiClient.post(`/campaigns/${id}/cancel`),
};

export const automationAPI = {
    getRules: (params: {
        limit?: number;
        offset?: number;
        active_only?: boolean;
    }) => apiClient.get("/automation/rules", { params }),

    createRule: (data: {
        name: string;
        trigger_type: string;
        trigger_conditions: any;
        actions: any[];
        active?: boolean;
    }) => apiClient.post("/automation/rules", data),

    updateRule: (id: string, data: any) =>
        apiClient.put(`/automation/rules/${id}`, data),

    deleteRule: (id: string) => apiClient.delete(`/automation/rules/${id}`),

    toggleRule: (id: string, active: boolean) =>
        apiClient.patch(`/automation/rules/${id}/toggle`, { active }),

    testRule: (id: string, test_email_data: any) =>
        apiClient.post(`/automation/rules/${id}/test`, { test_email_data }),

    getStats: () => apiClient.get("/automation/stats"),

    getLogs: (params: { limit?: number; offset?: number; action?: string }) =>
        apiClient.get("/automation/logs", { params }),

    getFollowUps: (params: {
        status?: string;
        limit?: number;
        offset?: number;
    }) => apiClient.get("/automation/follow-ups", { params }),

    scheduleFollowUp: (data: {
        recipient_email: string;
        subject: string;
        content?: string;
        scheduled_at: string;
        follow_up_type?: string;
        original_email_data?: any;
        use_llm?: boolean;
        purpose?: string;
    }) => apiClient.post("/automation/follow-ups", data),

    updateFollowUp: (id: string, data: any) =>
        apiClient.put(`/automation/follow-ups/${id}`, data),

    cancelFollowUp: (id: string) =>
        apiClient.delete(`/automation/follow-ups/${id}`),

    getTasks: (params: { status?: string; limit?: number; offset?: number }) =>
        apiClient.get("/automation/tasks", { params }),

    updateTask: (id: string, status: string, notes?: string) =>
        apiClient.patch(`/automation/tasks/${id}`, { status, notes }),

    getTemplates: () => apiClient.get("/automation/templates"),

    createRuleFromTemplate: (data: {
        template_id: string;
        name: string;
        customizations?: any;
    }) => apiClient.post("/automation/rules/from-template", data),
};

export default apiClient;
