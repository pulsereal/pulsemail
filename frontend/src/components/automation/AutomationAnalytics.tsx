import React from "react";
import { useQuery } from "react-query";
import { ClockIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import { automationAPI } from "../../services/api";
import type { AutomationLog, AutomationStats } from "../../types";
import { formatFullDate } from "../../utils/mail";
import Card, { CardHeader } from "../common/Card";
import StatCard from "../common/StatCard";
import EmptyState from "../common/EmptyState";
import ErrorState from "../common/ErrorState";
import { SkeletonList } from "../common/Skeleton";

const STATUS_DOT: Record<AutomationLog["status"], string> = {
    success: "bg-success-500",
    error: "bg-danger-500",
    warning: "bg-warning-500",
};

interface AutomationAnalyticsProps {
    stats?: AutomationStats;
    statsLoading?: boolean;
}

const AutomationAnalytics: React.FC<AutomationAnalyticsProps> = ({
    stats,
    statsLoading,
}) => {
    const logsQuery = useQuery(
        "automation-logs",
        () =>
            automationAPI
                .getLogs({ limit: 50 })
                .then((response) => response.data),
        { refetchInterval: 60_000 }
    );

    const logs: AutomationLog[] =
        logsQuery.data?.logs ?? logsQuery.data?.data ?? [];

    return (
        <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
                <StatCard
                    label="Total executions"
                    value={stats?.total_executions ?? 0}
                    tone="primary"
                    loading={statsLoading}
                />
                <StatCard
                    label="Successful"
                    value={stats?.successful_executions ?? 0}
                    tone="success"
                    loading={statsLoading}
                />
                <StatCard
                    label="Failed"
                    value={stats?.failed_executions ?? 0}
                    tone="danger"
                    loading={statsLoading}
                />
            </div>

            <Card padded={false} className="overflow-hidden">
                <CardHeader
                    title="Recent activity"
                    description="The last 50 rule executions."
                />

                {logsQuery.isError ? (
                    <ErrorState
                        error={logsQuery.error}
                        onRetry={() => logsQuery.refetch()}
                        compact
                    />
                ) : logsQuery.isLoading ? (
                    <SkeletonList rows={5} className="p-5" />
                ) : logs.length === 0 ? (
                    <EmptyState
                        icon={ClockIcon}
                        title="No executions yet"
                        description="Rule runs will show up here once your automations trigger."
                        compact
                    />
                ) : (
                    <ul className="max-h-96 divide-y divide-line overflow-y-auto scrollbar-thin">
                        {logs.map((log) => (
                            <li key={log.id} className="px-5 py-3">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex min-w-0 items-start gap-3">
                                        <span
                                            className={clsx(
                                                "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                                                STATUS_DOT[log.status] ||
                                                    "bg-content-subtle"
                                            )}
                                        />
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-medium text-content">
                                                {log.rule_name}
                                            </p>
                                            <p className="truncate text-sm text-content-subtle">
                                                {log.action}
                                            </p>
                                        </div>
                                    </div>
                                    <time className="shrink-0 text-xs text-content-subtle">
                                        {formatFullDate(log.created_at)}
                                    </time>
                                </div>
                                {log.error_message && (
                                    <p className="mt-1.5 pl-5 text-xs text-danger-600">
                                        {log.error_message}
                                    </p>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </Card>
        </div>
    );
};

export default AutomationAnalytics;
