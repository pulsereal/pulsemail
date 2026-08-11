import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import toast from "react-hot-toast";
import {
    ArrowDownIcon,
    ArrowUpIcon,
    ChevronDownIcon,
    ChevronRightIcon,
    ClipboardDocumentIcon,
    FunnelIcon,
    PencilSquareIcon,
    PlusIcon,
    TrashIcon,
} from "@heroicons/react/24/outline";
import { mailboxAPI } from "../../services/api";
import { useAuthStore, useIsImpersonating } from "../../stores/authStore";
import type { FilterAction, MailFilter } from "../../types";
import Badge from "../common/Badge";
import Button from "../common/Button";
import Card, { CardHeader } from "../common/Card";
import Checkbox from "../common/Checkbox";
import EmptyState from "../common/EmptyState";
import ErrorState from "../common/ErrorState";
import { SkeletonList } from "../common/Skeleton";
import FilterRuleModal from "./FilterRuleModal";

const FIELD_LABELS: Record<string, string> = {
    from: "sender",
    to: "recipient",
    subject: "subject",
    body: "body",
    header: "header",
};

const MATCH_LABELS: Record<string, string> = {
    contains: "contains",
    is: "is",
    matches: "matches",
};

const describeAction = (action: FilterAction) => {
    switch (action.type) {
        case "fileinto":
            return `file into "${action.folder || "?"}"`;
        case "copy":
            return `file a copy into "${action.folder || "?"}"`;
        case "redirect":
            return `redirect to ${action.to || "?"}`;
        case "discard":
            return "discard silently";
        case "reject":
            return "reject with a reason";
        case "keep":
            return "keep in the inbox";
        case "flag":
            return `add the ${(action.flag || "\\Flagged").replace(/^\\/, "")} flag`;
        case "markread":
            return "mark as read";
        default:
            return action.type;
    }
};

/** One-line plain-English rendering of a rule, shown under its name. */
const describeRule = (rule: MailFilter) => {
    const conditions = rule.conditions || [];
    let when: string;

    if (conditions.length === 0) {
        when = "For every message";
    } else if (conditions.length === 1) {
        const condition = conditions[0];
        const field =
            condition.field === "header"
                ? `header ${condition.header || "?"}`
                : FIELD_LABELS[condition.field] || condition.field;
        const verb = `${condition.negate ? "does not " : ""}${MATCH_LABELS[condition.match] || condition.match}`;
        when = `If the ${field} ${verb} "${condition.value}"`;
    } else {
        when = `If ${rule.match === "any" ? "any" : "all"} of ${conditions.length} conditions match`;
    }

    const actions = (rule.actions || []).map(describeAction).join(", ");
    const tail = rule.stopProcessing ? ", stop" : "";

    return `${when} → ${actions || "do nothing"}${tail}`;
};

const toPayload = (rule: MailFilter) => ({
    name: rule.name,
    priority: rule.priority,
    match: rule.match,
    conditions: rule.conditions,
    actions: rule.actions,
    stopProcessing: rule.stopProcessing,
    active: rule.active,
});

const MailFilters: React.FC = () => {
    const queryClient = useQueryClient();
    const activeMailbox = useAuthStore((state) => state.activeMailbox);
    const ownEmail = useAuthStore((state) => state.user?.email ?? null);
    const impersonating = useIsImpersonating();
    const scope = activeMailbox || ownEmail || "self";

    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<MailFilter | null>(null);
    const [scriptOpen, setScriptOpen] = useState(false);

    const filtersQuery = useQuery(["mailbox-filters", scope], () =>
        mailboxAPI.getFilters().then((response) => response.data)
    );

    const scriptQuery = useQuery(
        ["mailbox-filter-script", scope],
        () => mailboxAPI.getFilterScript().then((response) => response.data),
        { enabled: scriptOpen }
    );

    const rules: MailFilter[] = useMemo(() => {
        const list: MailFilter[] = filtersQuery.data?.rules ?? [];
        return [...list].sort((a, b) => a.priority - b.priority);
    }, [filtersQuery.data]);

    const invalidate = () => {
        queryClient.invalidateQueries("mailbox-filters");
        queryClient.invalidateQueries("mailbox-filter-script");
    };

    const toggleActive = useMutation(
        (rule: MailFilter) =>
            mailboxAPI.updateFilter(rule.id as number, {
                ...toPayload(rule),
                active: !rule.active,
            }),
        {
            onSuccess: (_result, rule) => {
                invalidate();
                toast.success(
                    rule.active ? "Filter disabled" : "Filter enabled"
                );
            },
        }
    );

    /** Renumber priorities to match the new order and persist only what moved. */
    const reorder = useMutation(
        (updated: MailFilter[]) =>
            Promise.all(
                updated.map((rule) =>
                    mailboxAPI.updateFilter(rule.id as number, toPayload(rule))
                )
            ),
        {
            onSuccess: () => {
                invalidate();
                toast.success("Filter order updated");
            },
        }
    );

    const remove = useMutation((id: number) => mailboxAPI.deleteFilter(id), {
        onSuccess: () => {
            invalidate();
            toast.success("Filter deleted");
        },
    });

    const move = (index: number, direction: -1 | 1) => {
        const target = index + direction;
        if (target < 0 || target >= rules.length) return;

        const next = [...rules];
        [next[index], next[target]] = [next[target], next[index]];

        const changed = next
            .map((rule, position) => ({ rule, position }))
            .filter(({ rule, position }) => rule.priority !== position)
            .map(({ rule, position }) => ({ ...rule, priority: position }));

        if (changed.length > 0) reorder.mutate(changed);
    };

    const openNew = () => {
        setEditing(null);
        setModalOpen(true);
    };

    const openEdit = (rule: MailFilter) => {
        setEditing(rule);
        setModalOpen(true);
    };

    const handleDelete = (rule: MailFilter) => {
        if (
            window.confirm(
                `Delete the filter "${rule.name}"? This cannot be undone.`
            )
        ) {
            remove.mutate(rule.id as number);
        }
    };

    const copyScript = () => {
        const script: string = scriptQuery.data?.script ?? "";
        if (!script) return;
        navigator.clipboard.writeText(script);
        toast.success("Sieve script copied");
    };

    const busy =
        toggleActive.isLoading || reorder.isLoading || remove.isLoading;

    return (
        <div className="space-y-6">
            <Card padded={false}>
                <CardHeader
                    title={
                        <span className="flex items-center gap-2">
                            <FunnelIcon className="h-5 w-5 text-content-subtle" />
                            Mail filters
                            {impersonating && (
                                <Badge variant="warning">
                                    Editing {activeMailbox}
                                </Badge>
                            )}
                        </span>
                    }
                    description="These Sieve rules run inside Dovecot as mail is delivered, so they keep working while you are offline."
                    actions={
                        <Button
                            size="sm"
                            icon={<PlusIcon className="h-4 w-4" />}
                            onClick={openNew}
                        >
                            New filter
                        </Button>
                    }
                />

                {filtersQuery.isLoading ? (
                    <div className="p-5">
                        <SkeletonList rows={3} />
                    </div>
                ) : filtersQuery.isError ? (
                    <ErrorState
                        title="Unable to load your filters"
                        error={filtersQuery.error}
                        onRetry={() => filtersQuery.refetch()}
                    />
                ) : rules.length === 0 ? (
                    <EmptyState
                        icon={FunnelIcon}
                        title="No filters yet"
                        description="Filters sort, flag, forward or discard incoming mail automatically."
                        action={
                            <Button
                                icon={<PlusIcon className="h-4 w-4" />}
                                onClick={openNew}
                            >
                                Create your first filter
                            </Button>
                        }
                    />
                ) : (
                    <ul className="divide-y divide-line">
                        {rules.map((rule, index) => (
                            <li
                                key={rule.id}
                                className="flex items-start gap-4 px-5 py-4"
                            >
                                <div className="min-w-0 flex-1">
                                    <Checkbox
                                        label={
                                            <span className="flex items-center gap-2">
                                                <span className="truncate">
                                                    {rule.name}
                                                </span>
                                                {!rule.active && (
                                                    <Badge
                                                        variant="outline"
                                                        size="xs"
                                                    >
                                                        Off
                                                    </Badge>
                                                )}
                                            </span>
                                        }
                                        description={describeRule(rule)}
                                        checked={rule.active}
                                        disabled={busy}
                                        onChange={() =>
                                            toggleActive.mutate(rule)
                                        }
                                    />
                                </div>

                                <div className="flex shrink-0 items-center gap-1">
                                    <Button
                                        variant="ghost"
                                        size="xs"
                                        aria-label={`Move "${rule.name}" up`}
                                        disabled={index === 0 || busy}
                                        onClick={() => move(index, -1)}
                                        icon={
                                            <ArrowUpIcon className="h-4 w-4" />
                                        }
                                    />
                                    <Button
                                        variant="ghost"
                                        size="xs"
                                        aria-label={`Move "${rule.name}" down`}
                                        disabled={
                                            index === rules.length - 1 || busy
                                        }
                                        onClick={() => move(index, 1)}
                                        icon={
                                            <ArrowDownIcon className="h-4 w-4" />
                                        }
                                    />
                                    <Button
                                        variant="ghost"
                                        size="xs"
                                        onClick={() => openEdit(rule)}
                                        icon={
                                            <PencilSquareIcon className="h-4 w-4" />
                                        }
                                    >
                                        Edit
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="xs"
                                        className="text-danger-600 hover:bg-danger-50 hover:text-danger-700"
                                        onClick={() => handleDelete(rule)}
                                        icon={<TrashIcon className="h-4 w-4" />}
                                    >
                                        Delete
                                    </Button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>

            <Card padded={false}>
                <button
                    type="button"
                    onClick={() => setScriptOpen((open) => !open)}
                    className="flex w-full items-center gap-2 px-5 py-4 text-left text-sm font-medium text-content transition-colors hover:bg-surface-hover"
                    aria-expanded={scriptOpen}
                >
                    {scriptOpen ? (
                        <ChevronDownIcon className="h-4 w-4 text-content-subtle" />
                    ) : (
                        <ChevronRightIcon className="h-4 w-4 text-content-subtle" />
                    )}
                    View generated Sieve script
                </button>

                {scriptOpen && (
                    <div className="space-y-3 border-t border-line p-5">
                        <div className="flex items-start justify-between gap-4">
                            <p className="text-sm text-content-muted">
                                The script is regenerated from the rules above
                                every time you save. Editing it directly on the
                                server will be overwritten.
                            </p>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={copyScript}
                                disabled={!scriptQuery.data?.script}
                                icon={
                                    <ClipboardDocumentIcon className="h-4 w-4" />
                                }
                            >
                                Copy
                            </Button>
                        </div>

                        {scriptQuery.isLoading ? (
                            <SkeletonList rows={2} />
                        ) : scriptQuery.isError ? (
                            <ErrorState
                                compact
                                title="Unable to load the script"
                                error={scriptQuery.error}
                                onRetry={() => scriptQuery.refetch()}
                            />
                        ) : (
                            <pre className="max-h-96 overflow-auto rounded-lg bg-surface-sunken p-4 font-mono text-xs leading-relaxed text-content scrollbar-thin">
                                {scriptQuery.data?.script ||
                                    "# No active rules — nothing is generated yet."}
                            </pre>
                        )}
                    </div>
                )}
            </Card>

            <FilterRuleModal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                rule={editing}
                nextPriority={rules.length}
            />
        </div>
    );
};

export default MailFilters;
