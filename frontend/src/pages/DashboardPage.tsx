import React from "react";
import { useQuery } from "react-query";
import { Link } from "react-router-dom";
import {
    ArrowPathIcon,
    ChartBarIcon,
    ClockIcon,
    EnvelopeIcon,
    InboxStackIcon,
    UsersIcon,
} from "@heroicons/react/24/outline";
import { adminAPI } from "../services/api";
import type { AdminActivity, AdminDashboardStats } from "../types";
import { formatBytes, formatFullDate } from "../utils/mail";
import Card, { CardHeader } from "../components/common/Card";
import StatCard from "../components/common/StatCard";
import Button from "../components/common/Button";
import EmptyState from "../components/common/EmptyState";
import ErrorState from "../components/common/ErrorState";
import { SkeletonList } from "../components/common/Skeleton";

const DashboardPage: React.FC = () => {
    const dashboardQuery = useQuery(
        "admin-dashboard",
        () => adminAPI.getDashboard().then((response) => response.data),
        { staleTime: 30 * 1000 }
    );

    const stats: AdminDashboardStats | undefined = dashboardQuery.data?.stats;
    const activity: AdminActivity[] = dashboardQuery.data?.recentActivity ?? [];
    const loading = dashboardQuery.isLoading;

    const storagePercent =
        stats && stats.storageLimit > 0
            ? Math.round((stats.storageUsed / stats.storageLimit) * 100)
            : 0;

    if (dashboardQuery.isError) {
        return (
            <div className="p-6">
                <ErrorState
                    title="Unable to load the dashboard"
                    error={dashboardQuery.error}
                    onRetry={() => dashboardQuery.refetch()}
                />
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold text-content">
                        Admin dashboard
                    </h1>
                    <p className="mt-1 text-sm text-content-muted">
                        Mailboxes, volume, and storage across the domains you
                        administer.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        loading={dashboardQuery.isFetching}
                        onClick={() => dashboardQuery.refetch()}
                        icon={<ArrowPathIcon className="h-4 w-4" />}
                    >
                        Refresh
                    </Button>
                    <Link to="/all-inboxes">
                        <Button
                            size="sm"
                            icon={<InboxStackIcon className="h-4 w-4" />}
                        >
                            All inboxes
                        </Button>
                    </Link>
                </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                    label="Mailboxes"
                    value={stats?.totalUsers ?? 0}
                    icon={UsersIcon}
                    tone="primary"
                    loading={loading}
                    hint={`${stats?.activeUsers ?? 0} active · ${stats?.inactiveUsers ?? 0} disabled`}
                />
                <StatCard
                    label="Messages"
                    value={stats?.totalEmails ?? 0}
                    icon={EnvelopeIcon}
                    tone="success"
                    loading={loading}
                    hint={`${stats?.unreadEmails ?? 0} unread · ${stats?.sentEmails ?? 0} sent`}
                />
                <StatCard
                    label="Storage used"
                    value={formatBytes(stats?.storageUsed ?? 0)}
                    icon={ChartBarIcon}
                    tone={
                        storagePercent > 80
                            ? "danger"
                            : storagePercent > 60
                              ? "warning"
                              : "success"
                    }
                    loading={loading}
                    progress={storagePercent}
                    hint={`${storagePercent}% of ${formatBytes(stats?.storageLimit ?? 0)}`}
                />
                <StatCard
                    label="Mail service"
                    value="Online"
                    icon={ClockIcon}
                    tone="success"
                    loading={loading}
                    hint={`Checked ${new Date().toLocaleTimeString()}`}
                />
            </div>

            <Card padded={false} className="overflow-hidden">
                <CardHeader
                    title="Recent activity"
                    description="Cross-mailbox access and other administrative events."
                />

                {loading ? (
                    <SkeletonList rows={4} className="p-5" />
                ) : activity.length === 0 ? (
                    <EmptyState
                        icon={ClockIcon}
                        title="No recent activity"
                        description="Administrative events will appear here as they happen."
                        compact
                    />
                ) : (
                    <ul className="divide-y divide-line">
                        {activity.map((entry) => (
                            <li
                                key={entry.id}
                                className="flex items-start justify-between gap-4 px-5 py-3"
                            >
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-content">
                                        {entry.user} · {entry.action}
                                    </p>
                                    <p className="truncate text-xs text-content-subtle">
                                        {entry.details}
                                    </p>
                                </div>
                                <time className="shrink-0 text-xs text-content-subtle">
                                    {formatFullDate(entry.timestamp)}
                                </time>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>
        </div>
    );
};

export default DashboardPage;
