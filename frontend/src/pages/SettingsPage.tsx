import React, { useState } from "react";
import { useQuery } from "react-query";
import {
    ArrowUturnRightIcon,
    BellIcon,
    CheckCircleIcon,
    FunnelIcon,
    IdentificationIcon,
    KeyIcon,
    LockClosedIcon,
    PaperAirplaneIcon,
    ShieldCheckIcon,
    SunIcon,
    UserIcon,
} from "@heroicons/react/24/outline";
import { authAPI } from "../services/api";
import type { UserQuota } from "../types";
import UserPreferences from "../components/settings/UserPreferences";
import TwoFactorAuth from "../components/settings/TwoFactorAuth";
import AppPasswords from "../components/settings/AppPasswords";
import NotificationSettings from "../components/settings/NotificationSettings";
import SecuritySettings from "../components/settings/SecuritySettings";
import IdentitySettings from "../components/settings/IdentitySettings";
import MailFilters from "../components/settings/MailFilters";
import VacationResponder from "../components/settings/VacationResponder";
import ForwardingSettings from "../components/settings/ForwardingSettings";
import StatCard from "../components/common/StatCard";
import Tabs, { type TabItem } from "../components/common/Tabs";

type SettingsTab =
    | "profile"
    | "identities"
    | "filters"
    | "vacation"
    | "forwarding"
    | "security"
    | "two-factor"
    | "app-passwords"
    | "notifications";

const TABS: TabItem<SettingsTab>[] = [
    { id: "profile", label: "Profile", icon: UserIcon },
    { id: "identities", label: "Identities", icon: IdentificationIcon },
    { id: "filters", label: "Filters", icon: FunnelIcon },
    { id: "vacation", label: "Vacation", icon: SunIcon },
    { id: "forwarding", label: "Forwarding", icon: ArrowUturnRightIcon },
    { id: "security", label: "Security", icon: LockClosedIcon },
    { id: "two-factor", label: "Two-factor", icon: ShieldCheckIcon },
    { id: "app-passwords", label: "App passwords", icon: KeyIcon },
    { id: "notifications", label: "Notifications", icon: BellIcon },
];

const percent = (used?: number, limit?: number) =>
    used && limit ? Math.min(Math.round((used / limit) * 100), 100) : 0;

const SettingsPage: React.FC = () => {
    const [tab, setTab] = useState<SettingsTab>("profile");

    const quotaQuery = useQuery(
        "user-quota",
        () => authAPI.getQuota().then((response) => response.data),
        { refetchInterval: 300_000 }
    );

    const quota: UserQuota | undefined =
        quotaQuery.data?.quota ?? quotaQuery.data;

    return (
        <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
            <div>
                <h1 className="text-xl font-semibold text-content">Settings</h1>
                <p className="mt-1 text-sm text-content-muted">
                    Account preferences, security, and sending limits.
                </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                    label="Sent today"
                    value={`${quota?.emails_sent_today ?? 0} / ${quota?.daily_limit ?? 0}`}
                    icon={PaperAirplaneIcon}
                    tone="primary"
                    loading={quotaQuery.isLoading}
                    progress={percent(
                        quota?.emails_sent_today,
                        quota?.daily_limit
                    )}
                />
                <StatCard
                    label="Sent this month"
                    value={`${quota?.emails_sent_this_month ?? 0} / ${quota?.monthly_limit ?? 0}`}
                    icon={PaperAirplaneIcon}
                    tone="success"
                    loading={quotaQuery.isLoading}
                    progress={percent(
                        quota?.emails_sent_this_month,
                        quota?.monthly_limit
                    )}
                />
                <StatCard
                    label="Storage used"
                    value={`${((quota?.storage_used_mb ?? 0) / 1024).toFixed(2)} GB`}
                    icon={KeyIcon}
                    tone="warning"
                    loading={quotaQuery.isLoading}
                    progress={percent(
                        quota?.storage_used_mb,
                        quota?.storage_limit_mb
                    )}
                    hint={`of ${((quota?.storage_limit_mb ?? 0) / 1024).toFixed(0)} GB`}
                />
                <StatCard
                    label="Account status"
                    value="Active"
                    icon={CheckCircleIcon}
                    tone="success"
                    loading={quotaQuery.isLoading}
                />
            </div>

            <Tabs tabs={TABS} value={tab} onChange={setTab} />

            {tab === "profile" && <UserPreferences />}
            {tab === "identities" && <IdentitySettings />}
            {tab === "filters" && <MailFilters />}
            {tab === "vacation" && <VacationResponder />}
            {tab === "forwarding" && <ForwardingSettings />}
            {tab === "security" && <SecuritySettings />}
            {tab === "two-factor" && <TwoFactorAuth />}
            {tab === "app-passwords" && <AppPasswords />}
            {tab === "notifications" && <NotificationSettings />}
        </div>
    );
};

export default SettingsPage;
