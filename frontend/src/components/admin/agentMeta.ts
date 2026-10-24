import type {
    AgentDeliveryStatus,
    AgentEvent,
    AgentPermission,
    AgentScope,
} from "../../types";

export const AGENT_EVENTS: {
    id: AgentEvent;
    label: string;
    description: string;
}[] = [
    {
        id: "email.received",
        label: "Email received",
        description: "New mail arrives in the inbox of a covered mailbox.",
    },
    {
        id: "email.sent",
        label: "Email sent",
        description:
            "A covered mailbox sends mail through webmail, an app password or the agent API.",
    },
];

export const AGENT_PERMISSIONS: {
    id: AgentPermission;
    label: string;
    description: string;
    /** Needs whole domains in scope rather than individual mailboxes. */
    directory?: boolean;
}[] = [
    {
        id: "read",
        label: "Read",
        description:
            "List, search and open messages, sources, folders and attachments.",
    },
    {
        id: "send",
        label: "Send",
        description: "Send new mail and reply in thread as the mailbox.",
    },
    {
        id: "modify",
        label: "Modify",
        description:
            "Mark, move, delete and report spam; save drafts; create, rename and delete folders.",
    },
    {
        id: "settings",
        label: "Settings",
        description:
            "Manage each mailbox's filters, vacation reply, forwarding and identities.",
    },
    {
        id: "provision",
        label: "Provision",
        description:
            "Create, change and delete mailboxes and aliases, reset passwords, and edit domain settings. Adding or removing whole domains also needs the all-mailboxes scope.",
        directory: true,
    },
    {
        id: "admins",
        label: "Grant admins",
        description:
            "Add or remove domain administrators, and grant global admin when scoped to all mailboxes. These accounts keep their rights after the agent is revoked.",
        directory: true,
    },
];

export const DELIVERY_VARIANT: Record<
    AgentDeliveryStatus,
    "success" | "warning" | "danger"
> = {
    delivered: "success",
    pending: "warning",
    failed: "danger",
};

const plural = (count: number, noun: string) =>
    `${count} ${noun}${count === 1 ? "" : "s"}`;

export const scopeSummary = ({ scopeAll, domains, mailboxes }: AgentScope) => {
    if (scopeAll) return "All mailboxes";
    return [
        domains.length > 0 && plural(domains.length, "domain"),
        mailboxes.length > 0 && plural(mailboxes.length, "mailbox"),
    ]
        .filter(Boolean)
        .join(", ");
};

export const scopeDetail = ({ scopeAll, domains, mailboxes }: AgentScope) =>
    scopeAll
        ? "Every mailbox on the server"
        : [...domains.map((domain) => `*@${domain}`), ...mailboxes].join(", ");
