import React, { useState } from "react";
import { useQuery } from "react-query";
import {
    PlusIcon,
    EyeIcon,
    PencilIcon,
    TrashIcon,
    PlayIcon,
    PauseIcon,
    BoltIcon,
} from "@heroicons/react/24/outline";
import { automationAPI } from "../../services/api";
import Button from "../common/Button";
import Badge from "../common/Badge";
import AutomationRuleModal from "./AutomationRuleModal";
import { formatDistanceToNow } from "date-fns";
import clsx from "clsx";

interface AutomationRule {
    id: string;
    name: string;
    trigger_type:
        | "email_received"
        | "email_sent"
        | "keyword_match"
        | "sender_domain"
        | "schedule"
        | "follow_up_due";
    trigger_conditions: any;
    actions: any[];
    active: boolean;
    created_at: string;
    last_triggered?: string;
    execution_count: number;
    success_count: number;
    error_count: number;
}

const AutomationRuleList: React.FC = () => {
    const [selectedRule, setSelectedRule] = useState<AutomationRule | null>(
        null
    );
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState<"create" | "edit" | "view">(
        "create"
    );
    const [activeFilter, setActiveFilter] = useState<string>("all");

    const {
        data: rules,
        isLoading,
        refetch,
    } = useQuery(
        ["automation-rules", activeFilter],
        () =>
            automationAPI
                .getRules({
                    active_only: activeFilter === "active" ? true : undefined,
                })
                .then((res) => res.data),
        { refetchInterval: 30000 }
    );

    const handleCreateRule = () => {
        setSelectedRule(null);
        setModalMode("create");
        setIsModalOpen(true);
    };

    const handleEditRule = (rule: AutomationRule) => {
        setSelectedRule(rule);
        setModalMode("edit");
        setIsModalOpen(true);
    };

    const handleViewRule = (rule: AutomationRule) => {
        setSelectedRule(rule);
        setModalMode("view");
        setIsModalOpen(true);
    };

    const handleDeleteRule = async (ruleId: string) => {
        if (
            window.confirm(
                "Are you sure you want to delete this automation rule?"
            )
        ) {
            try {
                await automationAPI.deleteRule(ruleId);
                refetch();
            } catch (error) {
                console.error("Error deleting rule:", error);
            }
        }
    };

    const handleToggleRule = async (ruleId: string, active: boolean) => {
        try {
            await automationAPI.toggleRule(ruleId, !active);
            refetch();
        } catch (error) {
            console.error("Error toggling rule:", error);
        }
    };

    const getTriggerTypeLabel = (triggerType: string) => {
        const labels = {
            email_received: "Email Received",
            email_sent: "Email Sent",
            keyword_match: "Keyword Match",
            sender_domain: "Sender Domain",
            schedule: "Schedule",
            follow_up_due: "Follow-up Due",
        };
        return labels[triggerType as keyof typeof labels] || triggerType;
    };

    const getActionTypeLabel = (actionType: string) => {
        const labels = {
            auto_reply: "Auto Reply",
            forward_email: "Forward Email",
            categorize: "Categorize",
            schedule_follow_up: "Schedule Follow-up",
            create_task: "Create Task",
            llm_generate_reply: "AI Generate Reply",
            send_notification: "Send Notification",
            move_to_folder: "Move to Folder",
        };
        return labels[actionType as keyof typeof labels] || actionType;
    };

    const getSuccessRate = (rule: AutomationRule) => {
        if (rule.execution_count === 0) return 0;
        return Math.round((rule.success_count / rule.execution_count) * 100);
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
                        Automation Rules
                    </h2>
                    <p className="text-content-muted">
                        Create intelligent automation rules for your email
                        workflow
                    </p>
                </div>
                <Button
                    onClick={handleCreateRule}
                    icon={<PlusIcon className="h-4 w-4" />}
                >
                    Create Rule
                </Button>
            </div>

            {/* Filters */}
            <div className="flex space-x-4 border-b border-line pb-4">
                {["all", "active", "inactive"].map((filter) => (
                    <button
                        key={filter}
                        onClick={() => setActiveFilter(filter)}
                        className={clsx(
                            "px-3 py-2 text-sm font-medium rounded-md transition-colors",
                            activeFilter === filter
                                ? "bg-primary-100 text-primary-700"
                                : "text-content-subtle hover:text-content hover:bg-surface-hover"
                        )}
                    >
                        {filter.charAt(0).toUpperCase() + filter.slice(1)}
                    </button>
                ))}
            </div>

            {/* Rules List */}
            <div className="bg-surface shadow rounded-lg overflow-hidden">
                {rules?.data?.length === 0 ? (
                    <div className="text-center py-12">
                        <BoltIcon className="mx-auto h-12 w-12 text-content-subtle" />
                        <p className="mt-4 text-content-subtle">
                            No automation rules found. Create your first rule to
                            get started.
                        </p>
                        <Button
                            onClick={handleCreateRule}
                            className="mt-4"
                            icon={<PlusIcon className="h-4 w-4" />}
                        >
                            Create Your First Rule
                        </Button>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-line">
                            <thead className="bg-surface-sunken">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-content-subtle uppercase tracking-wider">
                                        Rule
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-content-subtle uppercase tracking-wider">
                                        Trigger
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-content-subtle uppercase tracking-wider">
                                        Actions
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-content-subtle uppercase tracking-wider">
                                        Status
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-content-subtle uppercase tracking-wider">
                                        Performance
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-content-subtle uppercase tracking-wider">
                                        Last Triggered
                                    </th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-content-subtle uppercase tracking-wider">
                                        Actions
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-surface divide-y divide-line">
                                {rules?.data?.map((rule: AutomationRule) => (
                                    <tr
                                        key={rule.id}
                                        className="hover:bg-surface-hover"
                                    >
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center">
                                                <div
                                                    className={`flex-shrink-0 h-2 w-2 rounded-full mr-3 ${
                                                        rule.active
                                                            ? "bg-success-400"
                                                            : "bg-content-subtle"
                                                    }`}
                                                />
                                                <div>
                                                    <div className="text-sm font-medium text-content">
                                                        {rule.name}
                                                    </div>
                                                    <div className="text-sm text-content-subtle">
                                                        Created{" "}
                                                        {formatDistanceToNow(
                                                            new Date(
                                                                rule.created_at
                                                            ),
                                                            { addSuffix: true }
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <Badge variant="info">
                                                {getTriggerTypeLabel(
                                                    rule.trigger_type
                                                )}
                                            </Badge>
                                            {rule.trigger_conditions
                                                ?.keywords && (
                                                <div className="text-xs text-content-subtle mt-1">
                                                    Keywords:{" "}
                                                    {rule.trigger_conditions.keywords
                                                        .slice(0, 2)
                                                        .join(", ")}
                                                    {rule.trigger_conditions
                                                        .keywords.length > 2 &&
                                                        "..."}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="space-y-1">
                                                {rule.actions
                                                    .slice(0, 2)
                                                    .map(
                                                        (
                                                            action: any,
                                                            index: number
                                                        ) => (
                                                            <Badge
                                                                key={index}
                                                                variant="default"
                                                                size="sm"
                                                            >
                                                                {getActionTypeLabel(
                                                                    action.type
                                                                )}
                                                            </Badge>
                                                        )
                                                    )}
                                                {rule.actions.length > 2 && (
                                                    <Badge
                                                        variant="default"
                                                        size="sm"
                                                    >
                                                        +
                                                        {rule.actions.length -
                                                            2}{" "}
                                                        more
                                                    </Badge>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <Badge
                                                variant={
                                                    rule.active
                                                        ? "success"
                                                        : "default"
                                                }
                                            >
                                                {rule.active
                                                    ? "Active"
                                                    : "Inactive"}
                                            </Badge>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-content">
                                            <div className="space-y-1">
                                                <div>
                                                    Executions:{" "}
                                                    {rule.execution_count}
                                                </div>
                                                <div className="text-xs text-content-subtle">
                                                    Success Rate:{" "}
                                                    {getSuccessRate(rule)}%
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-content-subtle">
                                            {rule.last_triggered
                                                ? formatDistanceToNow(
                                                      new Date(
                                                          rule.last_triggered
                                                      ),
                                                      { addSuffix: true }
                                                  )
                                                : "Never"}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() =>
                                                    handleViewRule(rule)
                                                }
                                                icon={
                                                    <EyeIcon className="h-4 w-4" />
                                                }
                                            />
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() =>
                                                    handleEditRule(rule)
                                                }
                                                icon={
                                                    <PencilIcon className="h-4 w-4" />
                                                }
                                            />
                                            <Button
                                                variant={
                                                    rule.active
                                                        ? "outline"
                                                        : "success"
                                                }
                                                size="sm"
                                                onClick={() =>
                                                    handleToggleRule(
                                                        rule.id,
                                                        rule.active
                                                    )
                                                }
                                                icon={
                                                    rule.active ? (
                                                        <PauseIcon className="h-4 w-4" />
                                                    ) : (
                                                        <PlayIcon className="h-4 w-4" />
                                                    )
                                                }
                                            />
                                            <Button
                                                variant="danger"
                                                size="sm"
                                                onClick={() =>
                                                    handleDeleteRule(rule.id)
                                                }
                                                icon={
                                                    <TrashIcon className="h-4 w-4" />
                                                }
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Automation Rule Modal */}
            <AutomationRuleModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                rule={selectedRule}
                mode={modalMode}
                onSuccess={() => {
                    setIsModalOpen(false);
                    refetch();
                }}
            />
        </div>
    );
};

export default AutomationRuleList;
