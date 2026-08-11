import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { format, formatDistanceToNow } from "date-fns";
import toast from "react-hot-toast";
import {
    CalendarIcon,
    ClockIcon,
    EyeIcon,
    XCircleIcon,
} from "@heroicons/react/24/outline";
import { automationAPI } from "../../services/api";
import type { FollowUp, Task } from "../../types";
import Badge from "../common/Badge";
import Button from "../common/Button";
import Card from "../common/Card";
import EmptyState from "../common/EmptyState";
import ErrorState, { errorMessage } from "../common/ErrorState";
import Modal from "../common/Modal";
import Select from "../common/Select";
import Tabs, { type TabItem } from "../common/Tabs";
import { SkeletonList } from "../common/Skeleton";

type Pane = "follow-ups" | "tasks";

const PANES: TabItem<Pane>[] = [
    { id: "follow-ups", label: "Follow-ups", icon: ClockIcon },
    { id: "tasks", label: "Tasks", icon: CalendarIcon },
];

const FOLLOW_UP_STATUS = [
    { value: "all", label: "All statuses" },
    { value: "pending", label: "Pending" },
    { value: "sent", label: "Sent" },
    { value: "failed", label: "Failed" },
    { value: "cancelled", label: "Cancelled" },
];

const TASK_STATUS = [
    { value: "all", label: "All statuses" },
    { value: "pending", label: "Pending" },
    { value: "in_progress", label: "In progress" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
];

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";

const STATUS_VARIANT: Record<string, BadgeVariant> = {
    pending: "warning",
    in_progress: "info",
    sent: "success",
    completed: "success",
    failed: "danger",
    cancelled: "default",
};

const statusLabel = (status: string) =>
    status.replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase());

const isFollowUp = (item: FollowUp | Task): item is FollowUp =>
    "recipient_email" in item;

const FollowUpManager: React.FC = () => {
    const queryClient = useQueryClient();
    const [pane, setPane] = useState<Pane>("follow-ups");
    const [status, setStatus] = useState("all");
    const [selected, setSelected] = useState<FollowUp | Task | null>(null);

    const statusParam = status !== "all" ? status : undefined;

    const followUpsQuery = useQuery(
        ["follow-ups", statusParam],
        () =>
            automationAPI
                .getFollowUps({ status: statusParam })
                .then((response) => response.data),
        { refetchInterval: 30_000, enabled: pane === "follow-ups" }
    );

    const tasksQuery = useQuery(
        ["tasks", statusParam],
        () =>
            automationAPI
                .getTasks({ status: statusParam })
                .then((response) => response.data),
        { refetchInterval: 30_000, enabled: pane === "tasks" }
    );

    const followUps: FollowUp[] =
        followUpsQuery.data?.follow_ups ?? followUpsQuery.data?.data ?? [];
    const tasks: Task[] = tasksQuery.data?.tasks ?? tasksQuery.data?.data ?? [];

    const cancelFollowUp = useMutation(
        (id: string) => automationAPI.cancelFollowUp(id),
        {
            onSuccess: () => {
                toast.success("Follow-up cancelled");
                queryClient.invalidateQueries("follow-ups");
            },
            onError: (error) => {
                toast.error(errorMessage(error, "Could not cancel follow-up"));
            },
        }
    );

    const completeTask = useMutation(
        (id: string) => automationAPI.updateTask(id, "completed"),
        {
            onSuccess: () => {
                toast.success("Task completed");
                queryClient.invalidateQueries("tasks");
            },
            onError: (error) => {
                toast.error(errorMessage(error, "Could not update the task"));
            },
        }
    );

    const activeQuery = pane === "follow-ups" ? followUpsQuery : tasksQuery;

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Tabs
                    tabs={PANES}
                    value={pane}
                    onChange={setPane}
                    variant="pills"
                />
                <div className="w-48">
                    <Select
                        aria-label="Filter by status"
                        value={status}
                        onChange={(event) => setStatus(event.target.value)}
                        options={
                            pane === "follow-ups"
                                ? FOLLOW_UP_STATUS
                                : TASK_STATUS
                        }
                    />
                </div>
            </div>

            <Card padded={false} className="overflow-hidden">
                {activeQuery.isError ? (
                    <ErrorState
                        error={activeQuery.error}
                        onRetry={() => activeQuery.refetch()}
                    />
                ) : activeQuery.isLoading ? (
                    <SkeletonList rows={5} className="p-5" />
                ) : pane === "follow-ups" ? (
                    followUps.length === 0 ? (
                        <EmptyState
                            icon={ClockIcon}
                            title="No follow-ups scheduled"
                            description="Automation rules that schedule follow-ups will populate this list."
                            compact
                        />
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-line text-sm">
                                <thead>
                                    <tr className="text-left text-xs uppercase tracking-wide text-content-subtle">
                                        <th className="px-6 py-3 font-semibold">
                                            Follow-up
                                        </th>
                                        <th className="px-6 py-3 font-semibold">
                                            Recipient
                                        </th>
                                        <th className="px-6 py-3 font-semibold">
                                            Status
                                        </th>
                                        <th className="px-6 py-3 font-semibold">
                                            Scheduled
                                        </th>
                                        <th className="px-6 py-3" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-line">
                                    {followUps.map((followUp) => (
                                        <tr
                                            key={followUp.id}
                                            className="transition-colors hover:bg-surface-hover"
                                        >
                                            <td className="px-6 py-3">
                                                <span className="block font-medium text-content">
                                                    {followUp.subject}
                                                </span>
                                                <span className="block text-xs text-content-subtle">
                                                    {followUp.purpose ||
                                                        followUp.follow_up_type}
                                                </span>
                                                {followUp.use_llm && (
                                                    <Badge
                                                        variant="info"
                                                        size="xs"
                                                        className="mt-1"
                                                    >
                                                        AI generated
                                                    </Badge>
                                                )}
                                            </td>
                                            <td className="px-6 py-3 text-content-muted">
                                                {followUp.recipient_email}
                                            </td>
                                            <td className="px-6 py-3">
                                                <Badge
                                                    variant={
                                                        STATUS_VARIANT[
                                                            followUp.status
                                                        ] || "default"
                                                    }
                                                >
                                                    {statusLabel(
                                                        followUp.status
                                                    )}
                                                </Badge>
                                                {followUp.error_message && (
                                                    <span className="mt-1 block text-xs text-danger-600">
                                                        {followUp.error_message}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-6 py-3 text-content-muted">
                                                <span className="block">
                                                    {format(
                                                        new Date(
                                                            followUp.scheduled_at
                                                        ),
                                                        "d MMM yyyy HH:mm"
                                                    )}
                                                </span>
                                                <span className="block text-xs text-content-subtle">
                                                    {formatDistanceToNow(
                                                        new Date(
                                                            followUp.scheduled_at
                                                        ),
                                                        { addSuffix: true }
                                                    )}
                                                </span>
                                            </td>
                                            <td className="px-6 py-3">
                                                <div className="flex items-center justify-end gap-2">
                                                    <Button
                                                        variant="outline"
                                                        size="xs"
                                                        aria-label="View follow-up"
                                                        onClick={() =>
                                                            setSelected(
                                                                followUp
                                                            )
                                                        }
                                                        icon={
                                                            <EyeIcon className="h-3.5 w-3.5" />
                                                        }
                                                    />
                                                    {followUp.status ===
                                                        "pending" && (
                                                        <Button
                                                            variant="danger"
                                                            size="xs"
                                                            aria-label="Cancel follow-up"
                                                            loading={
                                                                cancelFollowUp.isLoading
                                                            }
                                                            onClick={() =>
                                                                cancelFollowUp.mutate(
                                                                    followUp.id
                                                                )
                                                            }
                                                            icon={
                                                                <XCircleIcon className="h-3.5 w-3.5" />
                                                            }
                                                        />
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )
                ) : tasks.length === 0 ? (
                    <EmptyState
                        icon={CalendarIcon}
                        title="No tasks"
                        description="Tasks created by your automation rules appear here."
                        compact
                    />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-line text-sm">
                            <thead>
                                <tr className="text-left text-xs uppercase tracking-wide text-content-subtle">
                                    <th className="px-6 py-3 font-semibold">
                                        Task
                                    </th>
                                    <th className="px-6 py-3 font-semibold">
                                        Status
                                    </th>
                                    <th className="px-6 py-3 font-semibold">
                                        Due
                                    </th>
                                    <th className="px-6 py-3 font-semibold">
                                        Created
                                    </th>
                                    <th className="px-6 py-3" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                                {tasks.map((task) => (
                                    <tr
                                        key={task.id}
                                        className="transition-colors hover:bg-surface-hover"
                                    >
                                        <td className="px-6 py-3">
                                            <span className="block font-medium text-content">
                                                {task.title}
                                            </span>
                                            <span className="block max-w-md truncate text-xs text-content-subtle">
                                                {task.description}
                                            </span>
                                        </td>
                                        <td className="px-6 py-3">
                                            <Badge
                                                variant={
                                                    STATUS_VARIANT[
                                                        task.status
                                                    ] || "default"
                                                }
                                            >
                                                {statusLabel(task.status)}
                                            </Badge>
                                        </td>
                                        <td className="px-6 py-3 text-content-muted">
                                            {task.due_date
                                                ? format(
                                                      new Date(task.due_date),
                                                      "d MMM yyyy"
                                                  )
                                                : "—"}
                                        </td>
                                        <td className="px-6 py-3 text-content-muted">
                                            {formatDistanceToNow(
                                                new Date(task.created_at),
                                                { addSuffix: true }
                                            )}
                                        </td>
                                        <td className="px-6 py-3">
                                            <div className="flex items-center justify-end gap-2">
                                                <Button
                                                    variant="outline"
                                                    size="xs"
                                                    aria-label="View task"
                                                    onClick={() =>
                                                        setSelected(task)
                                                    }
                                                    icon={
                                                        <EyeIcon className="h-3.5 w-3.5" />
                                                    }
                                                />
                                                {task.status !== "completed" &&
                                                    task.status !==
                                                        "cancelled" && (
                                                        <Button
                                                            variant="success"
                                                            size="xs"
                                                            loading={
                                                                completeTask.isLoading
                                                            }
                                                            onClick={() =>
                                                                completeTask.mutate(
                                                                    task.id
                                                                )
                                                            }
                                                        >
                                                            Complete
                                                        </Button>
                                                    )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            <Modal
                isOpen={Boolean(selected)}
                onClose={() => setSelected(null)}
                size="lg"
                title={
                    selected
                        ? isFollowUp(selected)
                            ? `Follow-up: ${selected.subject}`
                            : `Task: ${selected.title}`
                        : ""
                }
                actions={
                    <Button variant="outline" onClick={() => setSelected(null)}>
                        Close
                    </Button>
                }
            >
                {selected && (
                    <dl className="space-y-4 text-sm">
                        {isFollowUp(selected) ? (
                            <>
                                <div>
                                    <dt className="font-medium text-content">
                                        Recipient
                                    </dt>
                                    <dd className="mt-0.5 text-content-muted">
                                        {selected.recipient_email}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="font-medium text-content">
                                        Scheduled for
                                    </dt>
                                    <dd className="mt-0.5 text-content-muted">
                                        {format(
                                            new Date(selected.scheduled_at),
                                            "EEE, d MMM yyyy 'at' HH:mm"
                                        )}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="font-medium text-content">
                                        Message
                                    </dt>
                                    <dd className="mt-1 whitespace-pre-wrap rounded-lg bg-surface-sunken p-3 text-content-muted">
                                        {selected.content ||
                                            "Generated at send time."}
                                    </dd>
                                </div>
                            </>
                        ) : (
                            <>
                                <div>
                                    <dt className="font-medium text-content">
                                        Description
                                    </dt>
                                    <dd className="mt-0.5 text-content-muted">
                                        {selected.description}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="font-medium text-content">
                                        Priority
                                    </dt>
                                    <dd className="mt-0.5 text-content-muted">
                                        {statusLabel(selected.priority)}
                                    </dd>
                                </div>
                                {selected.notes && (
                                    <div>
                                        <dt className="font-medium text-content">
                                            Notes
                                        </dt>
                                        <dd className="mt-1 whitespace-pre-wrap rounded-lg bg-surface-sunken p-3 text-content-muted">
                                            {selected.notes}
                                        </dd>
                                    </div>
                                )}
                            </>
                        )}
                    </dl>
                )}
            </Modal>
        </div>
    );
};

export default FollowUpManager;
