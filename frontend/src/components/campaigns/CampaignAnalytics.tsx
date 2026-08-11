import React from "react";
import { useQuery } from "react-query";
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    LineElement,
    PointElement,
    Title,
    Tooltip,
    Legend,
    ArcElement,
} from "chart.js";
import { Bar, Line, Doughnut } from "react-chartjs-2";
import { campaignAPI } from "../../services/api";
import {
    ChartBarIcon,
    EnvelopeIcon,
    EyeIcon,
    CursorArrowRippleIcon,
    ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { format } from "date-fns";

ChartJS.register(
    CategoryScale,
    LinearScale,
    BarElement,
    LineElement,
    PointElement,
    Title,
    Tooltip,
    Legend,
    ArcElement
);

interface CampaignAnalyticsProps {
    campaignId?: string;
    period?: number; // days
}

const CampaignAnalytics: React.FC<CampaignAnalyticsProps> = ({
    campaignId,
    period = 30,
}) => {
    // Fetch campaign-specific analytics or overall performance summary
    const { data: analytics, isLoading } = useQuery(
        ["campaign-analytics", campaignId, period],
        () =>
            campaignId
                ? campaignAPI.getAnalytics(campaignId).then((res) => res.data)
                : campaignAPI
                      .getPerformanceSummary(period)
                      .then((res) => res.data),
        { refetchInterval: 300000 } // Refetch every 5 minutes
    );

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
        );
    }

    const stats = [
        {
            name: "Total Sent",
            value: analytics?.total_sent?.toLocaleString() || "0",
            icon: EnvelopeIcon,
            color: "text-primary-600",
            bgColor: "bg-primary-100",
        },
        {
            name: "Open Rate",
            value: `${analytics?.open_rate || 0}%`,
            icon: EyeIcon,
            color: "text-success-600",
            bgColor: "bg-success-100",
        },
        {
            name: "Click Rate",
            value: `${analytics?.click_rate || 0}%`,
            icon: CursorArrowRippleIcon,
            color: "text-purple-600",
            bgColor: "bg-purple-100",
        },
        {
            name: "Bounce Rate",
            value: `${analytics?.bounce_rate || 0}%`,
            icon: ExclamationTriangleIcon,
            color: "text-danger-600",
            bgColor: "bg-danger-100",
        },
    ];

    // Performance over time chart data
    const performanceData = {
        labels:
            analytics?.daily_stats?.map((stat: any) =>
                format(new Date(stat.date), "MMM dd")
            ) || [],
        datasets: [
            {
                label: "Sent",
                data:
                    analytics?.daily_stats?.map((stat: any) => stat.sent) || [],
                borderColor: "rgb(59, 130, 246)",
                backgroundColor: "rgba(59, 130, 246, 0.1)",
                tension: 0.4,
            },
            {
                label: "Opens",
                data:
                    analytics?.daily_stats?.map((stat: any) => stat.opens) ||
                    [],
                borderColor: "rgb(16, 185, 129)",
                backgroundColor: "rgba(16, 185, 129, 0.1)",
                tension: 0.4,
            },
            {
                label: "Clicks",
                data:
                    analytics?.daily_stats?.map((stat: any) => stat.clicks) ||
                    [],
                borderColor: "rgb(139, 92, 246)",
                backgroundColor: "rgba(139, 92, 246, 0.1)",
                tension: 0.4,
            },
        ],
    };

    // Engagement breakdown (Doughnut chart)
    const engagementData = {
        labels: ["Opened", "Clicked", "No Engagement"],
        datasets: [
            {
                data: [
                    (analytics?.total_opens || 0) -
                        (analytics?.total_clicks || 0),
                    analytics?.total_clicks || 0,
                    (analytics?.total_sent || 0) -
                        (analytics?.total_opens || 0),
                ],
                backgroundColor: [
                    "rgba(16, 185, 129, 0.8)",
                    "rgba(139, 92, 246, 0.8)",
                    "rgba(156, 163, 175, 0.8)",
                ],
                borderColor: [
                    "rgb(16, 185, 129)",
                    "rgb(139, 92, 246)",
                    "rgb(156, 163, 175)",
                ],
                borderWidth: 2,
            },
        ],
    };

    // Top performing campaigns (for overall analytics)
    const topCampaignsData = {
        labels:
            analytics?.top_campaigns?.map((campaign: any) => campaign.name) ||
            [],
        datasets: [
            {
                label: "Open Rate (%)",
                data:
                    analytics?.top_campaigns?.map(
                        (campaign: any) => campaign.open_rate
                    ) || [],
                backgroundColor: "rgba(16, 185, 129, 0.8)",
                borderColor: "rgb(16, 185, 129)",
                borderWidth: 1,
            },
            {
                label: "Click Rate (%)",
                data:
                    analytics?.top_campaigns?.map(
                        (campaign: any) => campaign.click_rate
                    ) || [],
                backgroundColor: "rgba(139, 92, 246, 0.8)",
                borderColor: "rgb(139, 92, 246)",
                borderWidth: 1,
            },
        ],
    };

    const chartOptions = {
        responsive: true,
        plugins: {
            legend: {
                position: "top" as const,
            },
        },
        scales: {
            y: {
                beginAtZero: true,
            },
        },
    };

    return (
        <div className="space-y-6">
            {/* Stats Overview */}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {stats.map((stat) => (
                    <div
                        key={stat.name}
                        className="bg-surface overflow-hidden shadow rounded-lg"
                    >
                        <div className="p-5">
                            <div className="flex items-center">
                                <div className="flex-shrink-0">
                                    <div
                                        className={`flex items-center justify-center h-10 w-10 rounded-md ${stat.bgColor}`}
                                    >
                                        <stat.icon
                                            className={`h-6 w-6 ${stat.color}`}
                                        />
                                    </div>
                                </div>
                                <div className="ml-5 w-0 flex-1">
                                    <dl>
                                        <dt className="text-sm font-medium text-content-subtle truncate">
                                            {stat.name}
                                        </dt>
                                        <dd className="text-lg font-medium text-content">
                                            {stat.value}
                                        </dd>
                                    </dl>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Performance Over Time */}
                <div className="bg-surface p-6 rounded-lg shadow">
                    <h3 className="text-lg font-medium text-content mb-4">
                        Performance Over Time
                    </h3>
                    {analytics?.daily_stats?.length > 0 ? (
                        <div className="h-64">
                            <Line
                                data={performanceData}
                                options={chartOptions}
                            />
                        </div>
                    ) : (
                        <div className="h-64 flex items-center justify-center text-content-subtle">
                            No performance data available
                        </div>
                    )}
                </div>

                {/* Engagement Breakdown */}
                <div className="bg-surface p-6 rounded-lg shadow">
                    <h3 className="text-lg font-medium text-content mb-4">
                        Engagement Breakdown
                    </h3>
                    {analytics?.total_sent > 0 ? (
                        <div className="h-64 flex items-center justify-center">
                            <Doughnut
                                data={engagementData}
                                options={{
                                    responsive: true,
                                    maintainAspectRatio: false,
                                    plugins: {
                                        legend: {
                                            position: "bottom",
                                        },
                                    },
                                }}
                            />
                        </div>
                    ) : (
                        <div className="h-64 flex items-center justify-center text-content-subtle">
                            No engagement data available
                        </div>
                    )}
                </div>
            </div>

            {/* Top Performing Campaigns (for overall analytics) */}
            {!campaignId && analytics?.top_campaigns?.length > 0 && (
                <div className="bg-surface p-6 rounded-lg shadow">
                    <h3 className="text-lg font-medium text-content mb-4">
                        Top Performing Campaigns
                    </h3>
                    <div className="h-64">
                        <Bar data={topCampaignsData} options={chartOptions} />
                    </div>
                </div>
            )}

            {/* Detailed Metrics Table */}
            {campaignId && analytics?.recipient_stats && (
                <div className="bg-surface shadow rounded-lg overflow-hidden">
                    <div className="px-6 py-4 border-b border-line">
                        <h3 className="text-lg font-medium text-content">
                            Recipient Details
                        </h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-line">
                            <thead className="bg-surface-sunken">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-content-subtle uppercase tracking-wider">
                                        Email
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-content-subtle uppercase tracking-wider">
                                        Status
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-content-subtle uppercase tracking-wider">
                                        Opens
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-content-subtle uppercase tracking-wider">
                                        Clicks
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-content-subtle uppercase tracking-wider">
                                        Last Activity
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-surface divide-y divide-line">
                                {analytics.recipient_stats.map(
                                    (recipient: any, index: number) => (
                                        <tr
                                            key={index}
                                            className="hover:bg-surface-hover"
                                        >
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-content">
                                                {recipient.email}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span
                                                    className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                                        recipient.status ===
                                                        "delivered"
                                                            ? "bg-success-100 text-success-800"
                                                            : recipient.status ===
                                                                "bounced"
                                                              ? "bg-danger-100 text-danger-800"
                                                              : "bg-warning-100 text-warning-800"
                                                    }`}
                                                >
                                                    {recipient.status}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-content">
                                                {recipient.opens || 0}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-content">
                                                {recipient.clicks || 0}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-content-subtle">
                                                {recipient.last_activity
                                                    ? format(
                                                          new Date(
                                                              recipient.last_activity
                                                          ),
                                                          "MMM dd, yyyy HH:mm"
                                                      )
                                                    : "—"}
                                            </td>
                                        </tr>
                                    )
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Best Practices Recommendations */}
            {analytics?.recommendations && (
                <div className="bg-primary-50 border border-primary-200 rounded-lg p-6">
                    <h3 className="text-lg font-medium text-primary-900 mb-4">
                        <ChartBarIcon className="h-5 w-5 inline mr-2" />
                        Recommendations
                    </h3>
                    <ul className="space-y-2">
                        {analytics.recommendations.map(
                            (recommendation: string, index: number) => (
                                <li
                                    key={index}
                                    className="text-sm text-primary-800 flex items-start"
                                >
                                    <span className="flex-shrink-0 h-1.5 w-1.5 bg-primary-400 rounded-full mt-2 mr-3"></span>
                                    {recommendation}
                                </li>
                            )
                        )}
                    </ul>
                </div>
            )}
        </div>
    );
};

export default CampaignAnalytics;
