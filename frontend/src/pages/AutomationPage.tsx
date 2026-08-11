import React, { useState } from "react";
import { useQuery } from "react-query";
import {
    ChartBarIcon,
    CheckCircleIcon,
    ClockIcon,
    CogIcon,
} from "@heroicons/react/24/outline";
import { automationAPI } from "../services/api";
import type { AutomationStats } from "../types";
import AutomationRuleList from "../components/automation/AutomationRuleList";
import AutomationAnalytics from "../components/automation/AutomationAnalytics";
import FollowUpManager from "../components/automation/FollowUpManager";
import StatCard from "../components/common/StatCard";
import Tabs, { type TabItem } from "../components/common/Tabs";

type AutomationTab = "rules" | "followups" | "analytics";

const TABS: TabItem<AutomationTab>[] = [
    { id: "rules", label: "Rules", icon: CogIcon },
    { id: "followups", label: "Follow-ups & tasks", icon: ClockIcon },
    { id: "analytics", label: "Analytics", icon: ChartBarIcon },
];

const AutomationPage: React.FC = () => {
    const [tab, setTab] = useState<AutomationTab>("rules");

    const statsQuery = useQuery(
        "automation-stats",
        () => automationAPI.getStats().then((response) => response.data),
        { refetchInterval: 300_000 }
    );

    const stats: AutomationStats | undefined =
        statsQuery.data?.stats ?? statsQuery.data;

    return (
        <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
            <div>
                <h1 className="text-xl font-semibold text-content">
                    Automation
                </h1>
                <p className="mt-1 text-sm text-content-muted">
                    Rules, scheduled follow-ups, and the tasks they generate.
                </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                    label="Active rules"
                    value={stats?.active_rules ?? 0}
                    icon={CogIcon}
                    tone="primary"
                    loading={statsQuery.isLoading}
                    hint={`${stats?.total_rules ?? 0} total`}
                />
                <StatCard
                    label="Pending follow-ups"
                    value={stats?.pending_follow_ups ?? 0}
                    icon={ClockIcon}
                    tone="warning"
                    loading={statsQuery.isLoading}
                    hint={`${stats?.pending_tasks ?? 0} open tasks`}
                />
                <StatCard
                    label="Executions today"
                    value={stats?.executions_today ?? 0}
                    icon={ChartBarIcon}
                    tone="neutral"
                    loading={statsQuery.isLoading}
                    hint={`${stats?.executions_this_week ?? 0} this week`}
                />
                <StatCard
                    label="Success rate"
                    value={`${stats?.success_rate ?? 0}%`}
                    icon={CheckCircleIcon}
                    tone="success"
                    loading={statsQuery.isLoading}
                    progress={stats?.success_rate}
                />
            </div>

            <Tabs tabs={TABS} value={tab} onChange={setTab} />

            {tab === "rules" && <AutomationRuleList />}
            {tab === "followups" && <FollowUpManager />}
            {tab === "analytics" && (
                <AutomationAnalytics
                    stats={stats}
                    statsLoading={statsQuery.isLoading}
                />
            )}
        </div>
    );
};

export default AutomationPage;
