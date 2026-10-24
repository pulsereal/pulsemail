import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import toast from "react-hot-toast";
import { CpuChipIcon, PlusIcon } from "@heroicons/react/24/outline";
import Badge from "../components/common/Badge";
import Button from "../components/common/Button";
import Card from "../components/common/Card";
import EmptyState from "../components/common/EmptyState";
import ErrorState from "../components/common/ErrorState";
import Modal from "../components/common/Modal";
import { SkeletonList } from "../components/common/Skeleton";
import AgentDetailDrawer from "../components/admin/AgentDetailDrawer";
import AgentFormModal from "../components/admin/AgentFormModal";
import AgentSecretsModal from "../components/admin/AgentSecretsModal";
import {
    AGENT_EVENTS,
    AGENT_PERMISSIONS,
    DELIVERY_VARIANT,
    scopeDetail,
    scopeSummary,
} from "../components/admin/agentMeta";
import { agentsAPI } from "../services/api";
import type { Agent, AgentSecrets, AgentWatcherStatus } from "../types";

interface AgentsResponse {
    agents: Agent[];
    canGrantAll: boolean;
    watcher: AgentWatcherStatus;
}

const eventLabel = (id: string) =>
    AGENT_EVENTS.find((entry) => entry.id === id)?.label ?? id;

const permissionLabel = (id: string) =>
    AGENT_PERMISSIONS.find((entry) => entry.id === id)?.label ?? id;

const DeliveryHealth: React.FC<{ agent: Agent }> = ({ agent }) => {
    if (!agent.webhookUrl) {
        return <span className="text-xs text-content-subtle">API only</span>;
    }
    if (agent.failedDeliveries) {
        return (
            <Badge variant="danger" size="xs">
                {agent.failedDeliveries} failed
            </Badge>
        );
    }
    if (!agent.lastDelivery) {
        return (
            <span className="text-xs text-content-subtle">
                No deliveries yet
            </span>
        );
    }
    return (
        <Badge variant={DELIVERY_VARIANT[agent.lastDelivery.status]} size="xs">
            Last {agent.lastDelivery.status}
            {agent.lastDelivery.statusCode
                ? ` (${agent.lastDelivery.statusCode})`
                : ""}
        </Badge>
    );
};

const AgentsPage: React.FC = () => {
    const queryClient = useQueryClient();

    const [formAgent, setFormAgent] = useState<Agent | null>(null);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [detailId, setDetailId] = useState<number | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);
    const [revealed, setRevealed] = useState<{
        agent: Agent;
        secrets: AgentSecrets;
    } | null>(null);

    const agentsQuery = useQuery(["agents"], () =>
        agentsAPI.list().then((response) => response.data as AgentsResponse)
    );

    const agents = agentsQuery.data?.agents ?? [];
    const canGrantAll = agentsQuery.data?.canGrantAll ?? false;
    const watcher = agentsQuery.data?.watcher;
    const detailAgent = agents.find((agent) => agent.id === detailId) ?? null;

    const deleteMutation = useMutation(
        (agent: Agent) => agentsAPI.remove(agent.id),
        {
            onSuccess: (_data, agent) => {
                void queryClient.invalidateQueries("agents");
                toast.success(`${agent.name} deleted`);
                setDeleteTarget(null);
                if (detailId === agent.id) setDetailId(null);
            },
        }
    );

    const openForm = (agent: Agent | null) => {
        setFormAgent(agent);
        setIsFormOpen(true);
    };

    return (
        <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold text-content">
                        Agents
                    </h1>
                    <p className="mt-1 max-w-2xl text-sm text-content-muted">
                        External agents receive mail from chosen domains and
                        mailboxes by signed webhook, and read, reply or file
                        mail through the agent API with their own key.
                        {watcher
                            ? ` New mail is checked every ${Math.round(watcher.intervalMs / 1000)}s.`
                            : ""}
                    </p>
                </div>
                <Button
                    onClick={() => openForm(null)}
                    icon={<PlusIcon className="h-4 w-4" />}
                    className="shrink-0"
                >
                    Add agent
                </Button>
            </div>

            <Card padded={false} className="overflow-hidden">
                {agentsQuery.isLoading && (
                    <SkeletonList rows={4} className="p-6" />
                )}

                {agentsQuery.isError && (
                    <ErrorState
                        error={agentsQuery.error}
                        onRetry={() => agentsQuery.refetch()}
                    />
                )}

                {agentsQuery.isSuccess && agents.length === 0 && (
                    <EmptyState
                        icon={CpuChipIcon}
                        title="No agents yet"
                        description="Connect an AI agent or automation tool to the mailboxes and domains you manage."
                        action={
                            <Button
                                onClick={() => openForm(null)}
                                icon={<PlusIcon className="h-4 w-4" />}
                            >
                                Add agent
                            </Button>
                        }
                    />
                )}

                {agents.length > 0 && (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-line text-sm">
                            <thead>
                                <tr className="text-left text-xs uppercase tracking-wide text-content-subtle">
                                    <th className="px-6 py-3 font-semibold">
                                        Agent
                                    </th>
                                    <th className="px-6 py-3 font-semibold">
                                        Scope
                                    </th>
                                    <th className="px-6 py-3 font-semibold">
                                        Access
                                    </th>
                                    <th className="px-6 py-3 font-semibold">
                                        Webhook
                                    </th>
                                    <th className="px-6 py-3" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                                {agents.map((agent) => (
                                    <tr
                                        key={agent.id}
                                        className="cursor-pointer transition-colors hover:bg-surface-hover"
                                        onClick={() => setDetailId(agent.id)}
                                    >
                                        <td className="px-6 py-3">
                                            <span className="flex items-center gap-2 font-medium text-content">
                                                {agent.name}
                                                {!agent.active && (
                                                    <Badge
                                                        variant="danger"
                                                        size="xs"
                                                    >
                                                        Disabled
                                                    </Badge>
                                                )}
                                            </span>
                                            {agent.description && (
                                                <span className="block max-w-xs truncate text-xs text-content-subtle">
                                                    {agent.description}
                                                </span>
                                            )}
                                        </td>
                                        <td className="max-w-xs px-6 py-3">
                                            <span className="block text-content-muted">
                                                {scopeSummary(agent)}
                                            </span>
                                            <span className="block truncate text-xs text-content-subtle">
                                                {scopeDetail(agent)}
                                            </span>
                                        </td>
                                        <td className="px-6 py-3">
                                            <div className="flex flex-wrap gap-1">
                                                {agent.events.map((id) => (
                                                    <Badge
                                                        key={id}
                                                        variant="info"
                                                        size="xs"
                                                    >
                                                        {eventLabel(id)}
                                                    </Badge>
                                                ))}
                                                {agent.permissions.map((id) => (
                                                    <Badge
                                                        key={id}
                                                        variant="outline"
                                                        size="xs"
                                                    >
                                                        {permissionLabel(id)}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="px-6 py-3">
                                            <DeliveryHealth agent={agent} />
                                        </td>
                                        <td className="px-6 py-3 text-right">
                                            <div
                                                className="flex items-center justify-end gap-2"
                                                onClick={(event) =>
                                                    event.stopPropagation()
                                                }
                                            >
                                                <Button
                                                    size="xs"
                                                    variant="outline"
                                                    onClick={() =>
                                                        openForm(agent)
                                                    }
                                                >
                                                    Edit
                                                </Button>
                                                <Button
                                                    size="xs"
                                                    variant="ghost"
                                                    className="text-danger-600 hover:bg-danger-50"
                                                    onClick={() =>
                                                        setDeleteTarget(agent)
                                                    }
                                                >
                                                    Delete
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            <AgentFormModal
                isOpen={isFormOpen}
                onClose={() => setIsFormOpen(false)}
                agent={formAgent}
                canGrantAll={canGrantAll}
                onCreated={(agent, secrets) => setRevealed({ agent, secrets })}
            />

            <AgentDetailDrawer
                isOpen={detailAgent !== null}
                onClose={() => setDetailId(null)}
                agent={detailAgent}
                onEdit={(agent) => {
                    setDetailId(null);
                    openForm(agent);
                }}
                onSecrets={(agent, secrets) => {
                    setDetailId(null);
                    setRevealed({ agent, secrets });
                }}
            />

            <AgentSecretsModal
                isOpen={revealed !== null}
                onClose={() => setRevealed(null)}
                agentName={revealed?.agent.name ?? ""}
                secrets={revealed?.secrets ?? null}
            />

            <Modal
                isOpen={Boolean(deleteTarget)}
                onClose={() => setDeleteTarget(null)}
                title={`Delete ${deleteTarget?.name}`}
                description="Its API key stops working immediately and queued webhooks are discarded."
                size="sm"
                actions={
                    <>
                        <Button
                            variant="outline"
                            onClick={() => setDeleteTarget(null)}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="danger"
                            loading={deleteMutation.isLoading}
                            onClick={() =>
                                deleteTarget &&
                                deleteMutation.mutate(deleteTarget)
                            }
                        >
                            Delete agent
                        </Button>
                    </>
                }
            >
                <p className="text-sm text-content-muted">
                    Mail in its mailboxes is not affected.
                </p>
            </Modal>
        </div>
    );
};

export default AgentsPage;
