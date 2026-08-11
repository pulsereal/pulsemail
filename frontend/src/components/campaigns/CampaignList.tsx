import React, { useState } from "react";
import { useQuery } from "react-query";
import {
    PlusIcon,
    EyeIcon,
    PencilIcon,
    TrashIcon,
    DocumentDuplicateIcon,
    PlayIcon,
    ClockIcon,
} from "@heroicons/react/24/outline";
import { campaignAPI } from "../../services/api";
import Button from "../common/Button";
import Badge from "../common/Badge";
import CampaignModal from "./CampaignModal";
import { formatDistanceToNow } from "date-fns";
import clsx from "clsx";

interface Campaign {
    id: string;
    name: string;
    subject: string;
    status: "draft" | "scheduled" | "sending" | "sent" | "paused" | "cancelled";
    recipients_count: number;
    sent_count?: number;
    opens_count?: number;
    clicks_count?: number;
    created_at: string;
    scheduled_at?: string;
    sent_at?: string;
    template_name?: string;
}

const CampaignList: React.FC = () => {
    const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(
        null
    );
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState<"create" | "edit" | "view">(
        "create"
    );
    const [statusFilter, setStatusFilter] = useState<string>("all");

    const {
        data: campaigns,
        isLoading,
        refetch,
    } = useQuery(
        ["campaigns", statusFilter],
        () =>
            campaignAPI
                .getCampaigns({
                    status: statusFilter !== "all" ? statusFilter : undefined,
                })
                .then((res) => res.data),
        { refetchInterval: 30000 }
    );

    const handleCreateCampaign = () => {
        setSelectedCampaign(null);
        setModalMode("create");
        setIsModalOpen(true);
    };

    const handleEditCampaign = (campaign: Campaign) => {
        setSelectedCampaign(campaign);
        setModalMode("edit");
        setIsModalOpen(true);
    };

    const handleViewCampaign = (campaign: Campaign) => {
        setSelectedCampaign(campaign);
        setModalMode("view");
        setIsModalOpen(true);
    };

    const handleDeleteCampaign = async (campaignId: string) => {
        if (window.confirm("Are you sure you want to delete this campaign?")) {
            try {
                await campaignAPI.deleteCampaign(campaignId);
                refetch();
            } catch (error) {
                console.error("Error deleting campaign:", error);
            }
        }
    };

    const handleDuplicateCampaign = async (campaignId: string) => {
        try {
            await campaignAPI.duplicateCampaign(campaignId);
            refetch();
        } catch (error) {
            console.error("Error duplicating campaign:", error);
        }
    };

    const handleSendCampaign = async (campaignId: string) => {
        if (
            window.confirm("Are you sure you want to send this campaign now?")
        ) {
            try {
                await campaignAPI.sendCampaign(campaignId);
                refetch();
            } catch (error) {
                console.error("Error sending campaign:", error);
            }
        }
    };

    const getStatusBadge = (status: Campaign["status"]) => {
        const variants = {
            draft: "default",
            scheduled: "info",
            sending: "warning",
            sent: "success",
            paused: "warning",
            cancelled: "danger",
        } as const;

        return (
            <Badge variant={variants[status]}>
                {status.charAt(0).toUpperCase() + status.slice(1)}
            </Badge>
        );
    };

    const calculateOpenRate = (campaign: Campaign) => {
        if (!campaign.sent_count || campaign.sent_count === 0) return 0;
        return Math.round(
            ((campaign.opens_count || 0) / campaign.sent_count) * 100
        );
    };

    const calculateClickRate = (campaign: Campaign) => {
        if (!campaign.sent_count || campaign.sent_count === 0) return 0;
        return Math.round(
            ((campaign.clicks_count || 0) / campaign.sent_count) * 100
        );
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-content">
                        Email Campaigns
                    </h2>
                    <p className="text-content-muted">
                        Create and manage your email marketing campaigns
                    </p>
                </div>
                <Button
                    onClick={handleCreateCampaign}
                    icon={<PlusIcon className="h-4 w-4" />}
                >
                    Create Campaign
                </Button>
            </div>

            {/* Filters */}
            <div className="flex space-x-4 border-b border-line pb-4">
                {["all", "draft", "scheduled", "sending", "sent", "paused"].map(
                    (status) => (
                        <button
                            key={status}
                            onClick={() => setStatusFilter(status)}
                            className={clsx(
                                "px-3 py-2 text-sm font-medium rounded-md transition-colors",
                                statusFilter === status
                                    ? "bg-primary-100 text-primary-700"
                                    : "text-content-subtle hover:text-content hover:bg-surface-hover"
                            )}
                        >
                            {status.charAt(0).toUpperCase() + status.slice(1)}
                        </button>
                    )
                )}
            </div>

            {/* Campaign List */}
            <div className="bg-surface shadow rounded-lg overflow-hidden">
                {campaigns?.data?.length === 0 ? (
                    <div className="text-center py-12">
                        <p className="text-content-subtle">
                            No campaigns found. Create your first campaign to
                            get started.
                        </p>
                        <Button
                            onClick={handleCreateCampaign}
                            className="mt-4"
                            icon={<PlusIcon className="h-4 w-4" />}
                        >
                            Create Your First Campaign
                        </Button>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-line">
                            <thead className="bg-surface-sunken">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-content-subtle uppercase tracking-wider">
                                        Campaign
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-content-subtle uppercase tracking-wider">
                                        Status
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-content-subtle uppercase tracking-wider">
                                        Recipients
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-content-subtle uppercase tracking-wider">
                                        Performance
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-content-subtle uppercase tracking-wider">
                                        Created
                                    </th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-content-subtle uppercase tracking-wider">
                                        Actions
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-surface divide-y divide-line">
                                {campaigns?.data?.map((campaign: Campaign) => (
                                    <tr
                                        key={campaign.id}
                                        className="hover:bg-surface-hover"
                                    >
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div>
                                                <div className="text-sm font-medium text-content">
                                                    {campaign.name}
                                                </div>
                                                <div className="text-sm text-content-subtle">
                                                    {campaign.subject}
                                                </div>
                                                {campaign.template_name && (
                                                    <div className="text-xs text-primary-600">
                                                        Template:{" "}
                                                        {campaign.template_name}
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {getStatusBadge(campaign.status)}
                                            {campaign.scheduled_at &&
                                                campaign.status ===
                                                    "scheduled" && (
                                                    <div className="text-xs text-content-subtle mt-1">
                                                        <ClockIcon className="h-3 w-3 inline mr-1" />
                                                        {formatDistanceToNow(
                                                            new Date(
                                                                campaign.scheduled_at
                                                            ),
                                                            { addSuffix: true }
                                                        )}
                                                    </div>
                                                )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-content">
                                            {campaign.recipients_count.toLocaleString()}
                                            {campaign.sent_count && (
                                                <div className="text-xs text-content-subtle">
                                                    {campaign.sent_count.toLocaleString()}{" "}
                                                    sent
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-content">
                                            {campaign.status === "sent" &&
                                            campaign.sent_count ? (
                                                <div className="space-y-1">
                                                    <div>
                                                        Opens:{" "}
                                                        {calculateOpenRate(
                                                            campaign
                                                        )}
                                                        %
                                                    </div>
                                                    <div>
                                                        Clicks:{" "}
                                                        {calculateClickRate(
                                                            campaign
                                                        )}
                                                        %
                                                    </div>
                                                </div>
                                            ) : (
                                                <span className="text-content-subtle">
                                                    —
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-content-subtle">
                                            {formatDistanceToNow(
                                                new Date(campaign.created_at),
                                                { addSuffix: true }
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() =>
                                                    handleViewCampaign(campaign)
                                                }
                                                icon={
                                                    <EyeIcon className="h-4 w-4" />
                                                }
                                            />
                                            {(campaign.status === "draft" ||
                                                campaign.status ===
                                                    "scheduled") && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() =>
                                                        handleEditCampaign(
                                                            campaign
                                                        )
                                                    }
                                                    icon={
                                                        <PencilIcon className="h-4 w-4" />
                                                    }
                                                />
                                            )}
                                            {campaign.status === "draft" && (
                                                <Button
                                                    variant="success"
                                                    size="sm"
                                                    onClick={() =>
                                                        handleSendCampaign(
                                                            campaign.id
                                                        )
                                                    }
                                                    icon={
                                                        <PlayIcon className="h-4 w-4" />
                                                    }
                                                />
                                            )}
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() =>
                                                    handleDuplicateCampaign(
                                                        campaign.id
                                                    )
                                                }
                                                icon={
                                                    <DocumentDuplicateIcon className="h-4 w-4" />
                                                }
                                            />
                                            {campaign.status === "draft" && (
                                                <Button
                                                    variant="danger"
                                                    size="sm"
                                                    onClick={() =>
                                                        handleDeleteCampaign(
                                                            campaign.id
                                                        )
                                                    }
                                                    icon={
                                                        <TrashIcon className="h-4 w-4" />
                                                    }
                                                />
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Campaign Modal */}
            <CampaignModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                campaign={selectedCampaign}
                mode={modalMode}
                onSuccess={() => {
                    setIsModalOpen(false);
                    refetch();
                }}
            />
        </div>
    );
};

export default CampaignList;
