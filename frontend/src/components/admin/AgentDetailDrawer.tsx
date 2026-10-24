import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import toast from "react-hot-toast";
import {
    ArrowPathIcon,
    ClipboardDocumentIcon,
    CodeBracketIcon,
    InboxArrowDownIcon,
    KeyIcon,
    PaperAirplaneIcon,
    ServerStackIcon,
} from "@heroicons/react/24/outline";
import Badge from "../common/Badge";
import Button from "../common/Button";
import Drawer from "../common/Drawer";
import EmptyState from "../common/EmptyState";
import ErrorState from "../common/ErrorState";
import Modal from "../common/Modal";
import { SkeletonList } from "../common/Skeleton";
import Tabs, { type TabItem } from "../common/Tabs";
import {
    AGENT_EVENTS,
    AGENT_PERMISSIONS,
    DELIVERY_VARIANT,
    scopeDetail,
} from "./agentMeta";
import { agentsAPI } from "../../services/api";
import { formatFullDate } from "../../utils/mail";
import type {
    Agent,
    AgentDelivery,
    AgentDeliveryStatus,
    AgentPingResult,
    AgentSecrets,
} from "../../types";

interface AgentDetailDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    agent: Agent | null;
    onEdit: (agent: Agent) => void;
    onSecrets: (agent: Agent, secrets: AgentSecrets) => void;
}

type DetailTab = "overview" | "deliveries" | "integration";
type DeliveryFilter = "all" | AgentDeliveryStatus;

const tabs: TabItem<DetailTab>[] = [
    { id: "overview", label: "Overview", icon: ServerStackIcon },
    { id: "deliveries", label: "Deliveries", icon: InboxArrowDownIcon },
    { id: "integration", label: "Integration", icon: CodeBracketIcon },
];

const filters: TabItem<DeliveryFilter>[] = [
    { id: "all", label: "All" },
    { id: "failed", label: "Failed" },
    { id: "pending", label: "Pending" },
    { id: "delivered", label: "Delivered" },
];

const labelFor = <T extends { id: string; label: string }>(
    list: T[],
    id: string
) => list.find((entry) => entry.id === id)?.label ?? id;

const verifySnippet = `import crypto from "node:crypto";

// rawBody must be the exact bytes received, before JSON parsing.
export function verifyPulsemail(rawBody, headers, secret) {
    const timestamp = headers["x-pulsemail-timestamp"];
    const signature = headers["x-pulsemail-signature"] ?? "";
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

    const expected = "sha256=" + crypto
        .createHmac("sha256", secret)
        .update(\`\${timestamp}.\${rawBody}\`)
        .digest("hex");

    return signature.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}`;

const apiSnippet = (
    origin: string,
    mailbox: string
) => `# Mailboxes this agent can reach
curl -H "Authorization: Bearer $PULSEMAIL_AGENT_KEY" \\
  ${origin}/api/agent/mailboxes

# Read the message referenced by a webhook (email.url in the payload)
curl -H "Authorization: Bearer $PULSEMAIL_AGENT_KEY" \\
  "${origin}/api/agent/mailboxes/${mailbox}/emails/<uid>?folder=INBOX"

# Reply in thread (needs the "send" permission)
curl -X POST -H "Authorization: Bearer $PULSEMAIL_AGENT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"text": "Thanks, we are on it."}' \\
  ${origin}/api/agent/mailboxes/${mailbox}/emails/<uid>/reply

# Create a mailbox (needs "provision"; same body as the admin panel)
curl -X POST -H "Authorization: Bearer $PULSEMAIL_AGENT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"email": "new.hire@${mailbox.split("@")[1]}", "password": "<at least 8 chars>", "name": "New Hire"}' \\
  ${origin}/api/agent/admin/mailboxes

# Set an out-of-office reply (needs "settings")
curl -X PUT -H "Authorization: Bearer $PULSEMAIL_AGENT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"enabled": true, "subject": "Away", "body": "Back Monday."}' \\
  ${origin}/api/agent/mailboxes/${mailbox}/settings/vacation`;

const CodeBlock: React.FC<{ code: string; label: string }> = ({
    code,
    label,
}) => (
    <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-content">{label}</span>
            <Button
                size="xs"
                variant="ghost"
                icon={<ClipboardDocumentIcon className="h-3.5 w-3.5" />}
                onClick={() => {
                    void navigator.clipboard.writeText(code);
                    toast.success("Copied");
                }}
            >
                Copy
            </Button>
        </div>
        <pre className="overflow-x-auto rounded-lg border border-line bg-surface-sunken p-3 font-mono text-xs leading-relaxed text-content scrollbar-thin">
            {code}
        </pre>
    </div>
);

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({
    label,
    children,
}) => (
    <div className="flex items-start justify-between gap-4 px-3 py-2">
        <dt className="shrink-0 text-content-muted">{label}</dt>
        <dd className="min-w-0 break-words text-right text-content">
            {children}
        </dd>
    </div>
);

const AgentDetailDrawer: React.FC<AgentDetailDrawerProps> = ({
    isOpen,
    onClose,
    agent,
    onEdit,
    onSecrets,
}) => {
    const queryClient = useQueryClient();
    const [tab, setTab] = useState<DetailTab>("overview");
    const [filter, setFilter] = useState<DeliveryFilter>("all");
    const [ping, setPing] = useState<AgentPingResult | null>(null);
    const [confirmRotate, setConfirmRotate] = useState<"key" | "secret" | null>(
        null
    );

    useEffect(() => {
        if (!isOpen) return;
        setTab("overview");
        setFilter("all");
        setPing(null);
    }, [isOpen, agent?.id]);

    const deliveriesQuery = useQuery(
        ["agent-deliveries", agent?.id, filter],
        () =>
            agentsAPI
                .getDeliveries(agent!.id, {
                    limit: 100,
                    status: filter === "all" ? undefined : filter,
                })
                .then(
                    (response) => response.data.deliveries as AgentDelivery[]
                ),
        {
            enabled: isOpen && Boolean(agent) && tab === "deliveries",
            refetchInterval: 15_000,
        }
    );

    const testMutation = useMutation(
        () =>
            agentsAPI
                .test(agent!.id)
                .then((response) => response.data.result as AgentPingResult),
        { onSuccess: setPing }
    );

    const rotateMutation = useMutation(
        (which: "key" | "secret") =>
            (which === "key"
                ? agentsAPI.rotateKey(agent!.id)
                : agentsAPI.rotateSecret(agent!.id)
            ).then((response) => response.data),
        {
            onSuccess: (data) => {
                void queryClient.invalidateQueries("agents");
                setConfirmRotate(null);
                onSecrets(data.agent as Agent, {
                    apiKey: data.apiKey,
                    signingSecret: data.signingSecret,
                });
            },
        }
    );

    const redeliverMutation = useMutation(
        (deliveryId: number) => agentsAPI.redeliver(agent!.id, deliveryId),
        {
            onSuccess: () => {
                toast.success("Queued for redelivery");
                void queryClient.invalidateQueries("agent-deliveries");
            },
        }
    );

    const exampleMailbox =
        agent?.mailboxes[0] ??
        (agent?.domains[0]
            ? `someone@${agent.domains[0]}`
            : "someone@example.com");

    return (
        <Drawer
            isOpen={isOpen}
            onClose={onClose}
            width="lg"
            title={agent?.name ?? "Agent"}
            description={
                agent?.description || "Webhook delivery and API access"
            }
        >
            {agent && (
                <div className="space-y-5">
                    <Tabs tabs={tabs} value={tab} onChange={setTab} />

                    {tab === "overview" && (
                        <div className="space-y-5">
                            <dl className="divide-y divide-line rounded-lg border border-line text-sm">
                                <Row label="Status">
                                    <Badge
                                        variant={
                                            agent.active ? "success" : "danger"
                                        }
                                        dot
                                    >
                                        {agent.active ? "Active" : "Disabled"}
                                    </Badge>
                                </Row>
                                <Row label="Scope">{scopeDetail(agent)}</Row>
                                <Row label="Webhook URL">
                                    {agent.webhookUrl ? (
                                        <code className="font-mono text-xs">
                                            {agent.webhookUrl}
                                        </code>
                                    ) : (
                                        "None (API only)"
                                    )}
                                </Row>
                                <Row label="Events">
                                    {agent.events.length
                                        ? agent.events
                                              .map((id) =>
                                                  labelFor(AGENT_EVENTS, id)
                                              )
                                              .join(", ")
                                        : "None"}
                                </Row>
                                <Row label="Permissions">
                                    {agent.permissions.length
                                        ? agent.permissions
                                              .map((id) =>
                                                  labelFor(
                                                      AGENT_PERMISSIONS,
                                                      id
                                                  )
                                              )
                                              .join(", ")
                                        : "None"}
                                </Row>
                                <Row label="API key">
                                    <code className="font-mono text-xs">
                                        {agent.apiKeyPrefix}…
                                    </code>
                                </Row>
                                <Row label="Signing secret">
                                    <code className="font-mono text-xs">
                                        {agent.signingSecretHint ??
                                            "Unreadable, rotate it"}
                                    </code>
                                </Row>
                                <Row label="Created by">{agent.createdBy}</Row>
                                <Row label="Last API use">
                                    {agent.lastUsedAt
                                        ? formatFullDate(agent.lastUsedAt)
                                        : "Never"}
                                </Row>
                            </dl>

                            <div className="flex flex-wrap gap-2">
                                <Button
                                    variant="outline"
                                    onClick={() => onEdit(agent)}
                                >
                                    Edit
                                </Button>
                                <Button
                                    variant="outline"
                                    icon={
                                        <PaperAirplaneIcon className="h-4 w-4" />
                                    }
                                    disabled={!agent.webhookUrl}
                                    loading={testMutation.isLoading}
                                    onClick={() => testMutation.mutate()}
                                >
                                    Send test event
                                </Button>
                                <Button
                                    variant="outline"
                                    icon={<KeyIcon className="h-4 w-4" />}
                                    onClick={() => setConfirmRotate("key")}
                                >
                                    Rotate API key
                                </Button>
                                <Button
                                    variant="outline"
                                    icon={<ArrowPathIcon className="h-4 w-4" />}
                                    onClick={() => setConfirmRotate("secret")}
                                >
                                    Rotate signing secret
                                </Button>
                            </div>

                            {ping && (
                                <div
                                    className={
                                        ping.ok
                                            ? "rounded-lg border border-success-200 bg-success-50 p-3 text-sm text-success-800"
                                            : "rounded-lg border border-danger-200 bg-danger-50 p-3 text-sm text-danger-800"
                                    }
                                >
                                    {ping.ok
                                        ? `The endpoint answered ${ping.statusCode}`
                                        : `The test failed: ${ping.error ?? "no response"}`}
                                    {typeof ping.durationMs === "number" &&
                                        ` in ${ping.durationMs} ms.`}
                                </div>
                            )}
                        </div>
                    )}

                    {tab === "deliveries" && (
                        <div className="space-y-4">
                            <Tabs
                                tabs={filters}
                                value={filter}
                                onChange={setFilter}
                                variant="pills"
                            />

                            {deliveriesQuery.isLoading && (
                                <SkeletonList rows={5} />
                            )}

                            {deliveriesQuery.isError && (
                                <ErrorState
                                    compact
                                    error={deliveriesQuery.error}
                                    onRetry={() => deliveriesQuery.refetch()}
                                />
                            )}

                            {deliveriesQuery.data?.length === 0 && (
                                <EmptyState
                                    compact
                                    icon={InboxArrowDownIcon}
                                    title="No deliveries yet"
                                    description="Events appear here once mail arrives in or leaves a covered mailbox."
                                />
                            )}

                            {deliveriesQuery.data &&
                                deliveriesQuery.data.length > 0 && (
                                    <ul className="divide-y divide-line rounded-lg border border-line">
                                        {deliveriesQuery.data.map(
                                            (delivery) => (
                                                <li
                                                    key={delivery.id}
                                                    className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm"
                                                >
                                                    <div className="min-w-0 space-y-0.5">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <Badge
                                                                variant={
                                                                    DELIVERY_VARIANT[
                                                                        delivery
                                                                            .status
                                                                    ]
                                                                }
                                                                size="xs"
                                                                dot
                                                            >
                                                                {
                                                                    delivery.status
                                                                }
                                                            </Badge>
                                                            <span className="font-medium text-content">
                                                                {labelFor(
                                                                    AGENT_EVENTS,
                                                                    delivery.event
                                                                )}
                                                            </span>
                                                            <span className="text-xs text-content-subtle">
                                                                {formatFullDate(
                                                                    delivery.createdAt
                                                                )}
                                                            </span>
                                                        </div>
                                                        <p className="truncate text-content-muted">
                                                            {delivery.subject ||
                                                                "(no subject)"}{" "}
                                                            · {delivery.mailbox}
                                                        </p>
                                                        <p className="text-xs text-content-subtle">
                                                            {delivery.attempts}{" "}
                                                            attempt
                                                            {delivery.attempts ===
                                                            1
                                                                ? ""
                                                                : "s"}
                                                            {delivery.lastStatusCode
                                                                ? ` · HTTP ${delivery.lastStatusCode}`
                                                                : ""}
                                                            {delivery.status ===
                                                                "pending" &&
                                                            delivery.attempts >
                                                                0
                                                                ? ` · next try ${formatFullDate(delivery.nextAttemptAt)}`
                                                                : ""}
                                                        </p>
                                                        {delivery.lastError && (
                                                            <p className="break-words text-xs text-danger-600">
                                                                {
                                                                    delivery.lastError
                                                                }
                                                            </p>
                                                        )}
                                                    </div>
                                                    {delivery.status !==
                                                        "delivered" && (
                                                        <Button
                                                            size="xs"
                                                            variant="outline"
                                                            loading={
                                                                redeliverMutation.isLoading &&
                                                                redeliverMutation.variables ===
                                                                    delivery.id
                                                            }
                                                            onClick={() =>
                                                                redeliverMutation.mutate(
                                                                    delivery.id
                                                                )
                                                            }
                                                        >
                                                            Retry now
                                                        </Button>
                                                    )}
                                                </li>
                                            )
                                        )}
                                    </ul>
                                )}
                        </div>
                    )}

                    {tab === "integration" && (
                        <div className="space-y-5">
                            <p className="text-sm text-content-muted">
                                Each webhook is a JSON POST carrying{" "}
                                <code className="font-mono text-xs">
                                    X-Pulsemail-Event
                                </code>
                                ,{" "}
                                <code className="font-mono text-xs">
                                    X-Pulsemail-Timestamp
                                </code>{" "}
                                and{" "}
                                <code className="font-mono text-xs">
                                    X-Pulsemail-Signature
                                </code>
                                . Answer with any 2xx; anything else is retried
                                with backoff for several hours.
                            </p>
                            <CodeBlock
                                label="Verify a webhook (Node.js)"
                                code={verifySnippet}
                            />
                            <CodeBlock
                                label="Call the agent API"
                                code={apiSnippet(
                                    window.location.origin,
                                    exampleMailbox
                                )}
                            />
                        </div>
                    )}
                </div>
            )}

            <Modal
                isOpen={confirmRotate !== null}
                onClose={() => setConfirmRotate(null)}
                title={
                    confirmRotate === "key"
                        ? "Rotate the API key?"
                        : "Rotate the signing secret?"
                }
                description={
                    confirmRotate === "key"
                        ? "The current key stops working immediately. Update the agent with the new key."
                        : "Webhooks are signed with the new secret from now on. Update the agent's verifier."
                }
                size="sm"
                actions={
                    <>
                        <Button
                            variant="outline"
                            onClick={() => setConfirmRotate(null)}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="danger"
                            loading={rotateMutation.isLoading}
                            onClick={() =>
                                confirmRotate &&
                                rotateMutation.mutate(confirmRotate)
                            }
                        >
                            Rotate
                        </Button>
                    </>
                }
            >
                <p className="text-sm text-content-muted">
                    The new value is shown once, right after rotating.
                </p>
            </Modal>
        </Drawer>
    );
};

export default AgentDetailDrawer;
