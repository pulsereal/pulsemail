import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import toast from "react-hot-toast";
import { XMarkIcon } from "@heroicons/react/24/outline";
import Button from "../common/Button";
import Checkbox from "../common/Checkbox";
import Combobox from "../common/Combobox";
import Input from "../common/Input";
import Modal from "../common/Modal";
import Textarea from "../common/Textarea";
import { AGENT_EVENTS, AGENT_PERMISSIONS } from "./agentMeta";
import { adminAPI, agentsAPI, provisioningAPI } from "../../services/api";
import type {
    Agent,
    AgentEvent,
    AgentInput,
    AgentPermission,
    AgentSecrets,
    Domain,
} from "../../types";

interface AgentFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    agent?: Agent | null;
    canGrantAll: boolean;
    onCreated: (agent: Agent, secrets: AgentSecrets) => void;
}

interface AccessibleMailbox {
    email: string;
    name?: string;
    domain: string;
}

const toggle = <T,>(list: T[], item: T, on: boolean) =>
    on ? [...new Set([...list, item])] : list.filter((entry) => entry !== item);

const AgentFormModal: React.FC<AgentFormModalProps> = ({
    isOpen,
    onClose,
    agent,
    canGrantAll,
    onCreated,
}) => {
    const queryClient = useQueryClient();
    const isEdit = Boolean(agent);

    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [webhookUrl, setWebhookUrl] = useState("");
    const [scopeAll, setScopeAll] = useState(false);
    const [domains, setDomains] = useState<string[]>([]);
    const [mailboxes, setMailboxes] = useState<string[]>([]);
    const [events, setEvents] = useState<AgentEvent[]>([]);
    const [permissions, setPermissions] = useState<AgentPermission[]>([]);
    const [active, setActive] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const errorRef = useRef<HTMLParagraphElement>(null);

    // Events only mean something with somewhere to deliver them, so they stay
    // off until a URL is entered, keeping API-only agents a valid default.
    const hasWebhook = webhookUrl.trim().length > 0;

    // The form scrolls, and the submit button sits below it.
    useEffect(() => {
        if (error) errorRef.current?.scrollIntoView({ block: "nearest" });
    }, [error]);

    useEffect(() => {
        if (!isOpen) return;
        setError(null);
        setName(agent?.name ?? "");
        setDescription(agent?.description ?? "");
        setWebhookUrl(agent?.webhookUrl ?? "");
        setScopeAll(agent?.scopeAll ?? false);
        setDomains(agent?.domains ?? []);
        setMailboxes(agent?.mailboxes ?? []);
        setEvents(agent?.events ?? ["email.received"]);
        setPermissions(agent?.permissions ?? ["read"]);
        setActive(agent ? agent.active : true);
    }, [isOpen, agent]);

    const domainsQuery = useQuery(
        ["provision-domains", ""],
        () => provisioningAPI.getDomains().then((response) => response.data),
        { enabled: isOpen }
    );
    const availableDomains: Domain[] = domainsQuery.data?.domains ?? [];

    const mailboxesQuery = useQuery(
        ["agent-accessible-mailboxes"],
        () =>
            adminAPI
                .getAccessibleMailboxes({ limit: 1000 })
                .then(
                    (response) =>
                        (response.data.mailboxes ?? []) as AccessibleMailbox[]
                ),
        { enabled: isOpen }
    );

    const mailboxOptions = useMemo(
        () =>
            (mailboxesQuery.data ?? [])
                .filter(
                    (mailbox) =>
                        !mailboxes.includes(mailbox.email) &&
                        !domains.includes(mailbox.domain)
                )
                .map((mailbox) => ({
                    value: mailbox.email,
                    label: mailbox.email,
                    description: mailbox.name || undefined,
                    group: mailbox.domain,
                })),
        [mailboxesQuery.data, mailboxes, domains]
    );

    const payload = (): AgentInput => ({
        name: name.trim(),
        description: description.trim(),
        webhookUrl: webhookUrl.trim() || null,
        scopeAll,
        domains: scopeAll ? [] : domains,
        mailboxes: scopeAll ? [] : mailboxes,
        events: hasWebhook ? events : [],
        permissions,
        active,
    });

    const onSaved = () => {
        void queryClient.invalidateQueries("agents");
    };

    const createMutation = useMutation(
        () => agentsAPI.create(payload()).then((response) => response.data),
        {
            onSuccess: (data) => {
                onSaved();
                onCreated(data.agent as Agent, {
                    apiKey: data.apiKey,
                    signingSecret: data.signingSecret,
                });
                onClose();
            },
        }
    );

    const updateMutation = useMutation(
        () => agentsAPI.update(agent!.id, payload()),
        {
            onSuccess: () => {
                onSaved();
                toast.success("Agent updated");
                onClose();
            },
        }
    );

    const submit = (event: React.FormEvent) => {
        event.preventDefault();

        if (!name.trim()) {
            setError("Give the agent a name");
            return;
        }
        if (!scopeAll && domains.length === 0 && mailboxes.length === 0) {
            setError("Choose at least one domain or mailbox");
            return;
        }
        const directory = AGENT_PERMISSIONS.filter(
            (entry) => entry.directory && permissions.includes(entry.id)
        );
        if (directory.length > 0 && !scopeAll && domains.length === 0) {
            setError(
                `${directory.map((entry) => entry.label).join(" and ")} needs whole domains in scope, not individual mailboxes`
            );
            return;
        }

        setError(null);
        if (isEdit) updateMutation.mutate();
        else createMutation.mutate();
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={isEdit ? `Edit ${agent?.name}` : "Add agent"}
            description="Agents receive mail events by webhook and act on mailboxes with their own API key, limited to the scope below."
            size="lg"
            actions={
                <>
                    <Button variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        form="agent-form"
                        loading={
                            createMutation.isLoading || updateMutation.isLoading
                        }
                    >
                        {isEdit ? "Save changes" : "Create agent"}
                    </Button>
                </>
            }
        >
            <form id="agent-form" onSubmit={submit} className="space-y-6">
                {error && (
                    <p
                        ref={errorRef}
                        role="alert"
                        className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700"
                    >
                        {error}
                    </p>
                )}

                <div className="space-y-4">
                    <Input
                        label="Name"
                        value={name}
                        autoFocus={!isEdit}
                        placeholder="Support triage bot"
                        onChange={(event) => setName(event.target.value)}
                    />
                    <Textarea
                        label="Description"
                        rows={2}
                        value={description}
                        placeholder="What this agent does and who owns it"
                        onChange={(event) => setDescription(event.target.value)}
                    />
                    <Input
                        label="Webhook URL"
                        type="url"
                        value={webhookUrl}
                        placeholder="https://agents.example.com/hooks/pulsemail"
                        helpText="Receives signed JSON POSTs for the events below. Leave empty for an API-only agent."
                        onChange={(event) => setWebhookUrl(event.target.value)}
                    />
                </div>

                <fieldset className="space-y-3">
                    <legend className="text-sm font-semibold text-content">
                        Mailbox scope
                    </legend>

                    {canGrantAll && (
                        <Checkbox
                            label="All mailboxes on this server"
                            description="Includes domains and mailboxes created later."
                            checked={scopeAll}
                            onChange={(event) =>
                                setScopeAll(event.target.checked)
                            }
                        />
                    )}

                    {!scopeAll && (
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <span className="block text-sm font-medium text-content">
                                    Domains
                                </span>
                                <p className="text-sm text-content-subtle">
                                    Every mailbox in a selected domain,
                                    including ones added later.
                                </p>
                                {availableDomains.length === 0 ? (
                                    <p className="text-sm text-content-subtle">
                                        {domainsQuery.isLoading
                                            ? "Loading domains…"
                                            : "No domains available."}
                                    </p>
                                ) : (
                                    <div className="grid max-h-48 gap-2 overflow-y-auto rounded-lg border border-line p-3 scrollbar-thin sm:grid-cols-2">
                                        {availableDomains.map((entry) => (
                                            <Checkbox
                                                key={entry.domain}
                                                label={entry.domain}
                                                checked={domains.includes(
                                                    entry.domain
                                                )}
                                                onChange={(event) =>
                                                    setDomains((current) =>
                                                        toggle(
                                                            current,
                                                            entry.domain,
                                                            event.target.checked
                                                        )
                                                    )
                                                }
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2">
                                <span className="block text-sm font-medium text-content">
                                    Individual mailboxes
                                </span>
                                {mailboxes.length > 0 && (
                                    <ul className="flex flex-wrap gap-2">
                                        {mailboxes.map((address) => (
                                            <li
                                                key={address}
                                                className="inline-flex items-center gap-1.5 rounded-full bg-surface-sunken py-1 pl-3 pr-1.5 text-sm text-content"
                                            >
                                                <span className="truncate">
                                                    {address}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setMailboxes(
                                                            (current) =>
                                                                current.filter(
                                                                    (entry) =>
                                                                        entry !==
                                                                        address
                                                                )
                                                        )
                                                    }
                                                    aria-label={`Remove ${address}`}
                                                    className="rounded-full p-0.5 text-content-subtle transition-colors hover:bg-surface-hover hover:text-danger-600"
                                                >
                                                    <XMarkIcon className="h-3.5 w-3.5" />
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                <Combobox
                                    options={mailboxOptions}
                                    value={null}
                                    placeholder={
                                        mailboxesQuery.isLoading
                                            ? "Loading mailboxes…"
                                            : "Add a mailbox"
                                    }
                                    searchPlaceholder="Search mailboxes"
                                    emptyMessage="No other mailboxes available"
                                    onChange={(address) =>
                                        setMailboxes((current) =>
                                            toggle(current, address, true)
                                        )
                                    }
                                />
                            </div>
                        </div>
                    )}
                </fieldset>

                <fieldset className="space-y-3">
                    <legend className="text-sm font-semibold text-content">
                        Webhook events
                    </legend>
                    {!hasWebhook && (
                        <p className="text-sm text-content-subtle">
                            Add a webhook URL above to choose events. Without
                            one, the agent works through its API key only.
                        </p>
                    )}
                    {AGENT_EVENTS.map((entry) => (
                        <Checkbox
                            key={entry.id}
                            label={entry.label}
                            description={entry.description}
                            disabled={!hasWebhook}
                            className={hasWebhook ? undefined : "opacity-50"}
                            checked={hasWebhook && events.includes(entry.id)}
                            onChange={(event) =>
                                setEvents((current) =>
                                    toggle(
                                        current,
                                        entry.id,
                                        event.target.checked
                                    )
                                )
                            }
                        />
                    ))}
                </fieldset>

                <fieldset className="space-y-3">
                    <legend className="text-sm font-semibold text-content">
                        API permissions
                    </legend>
                    {[false, true].map((directory) => (
                        <div key={String(directory)} className="space-y-3">
                            {directory && (
                                <div className="space-y-1 border-t border-line pt-3">
                                    <span className="block text-sm font-medium text-content">
                                        Directory administration
                                    </span>
                                    <p className="text-sm text-content-subtle">
                                        Acts with your admin rights over the
                                        selected domains. Requires whole domains
                                        in scope.
                                    </p>
                                </div>
                            )}
                            {AGENT_PERMISSIONS.filter(
                                (entry) =>
                                    Boolean(entry.directory) === directory
                            ).map((entry) => (
                                <Checkbox
                                    key={entry.id}
                                    label={entry.label}
                                    description={entry.description}
                                    checked={permissions.includes(entry.id)}
                                    onChange={(event) =>
                                        setPermissions((current) =>
                                            toggle(
                                                current,
                                                entry.id,
                                                event.target.checked
                                            )
                                        )
                                    }
                                />
                            ))}
                        </div>
                    ))}
                </fieldset>

                <Checkbox
                    label="Agent is active"
                    description="A disabled agent receives no webhooks and its API key is refused."
                    checked={active}
                    onChange={(event) => setActive(event.target.checked)}
                />
            </form>
        </Modal>
    );
};

export default AgentFormModal;
