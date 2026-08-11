import { format, isThisYear, isToday, isYesterday } from "date-fns";
import type { EmailAddress, EmailSummary, MailFolder } from "../types";

export const isUnread = (email: Pick<EmailSummary, "flags">) =>
    !(email.flags || []).includes("\\Seen");

export const isFlagged = (email: Pick<EmailSummary, "flags">) =>
    (email.flags || []).includes("\\Flagged");

export const isDraft = (email: Pick<EmailSummary, "flags">) =>
    (email.flags || []).includes("\\Draft");

export const isAnswered = (email: Pick<EmailSummary, "flags">) =>
    (email.flags || []).includes("\\Answered");

/** Compact for the list ("14:32", "Yesterday", "12 Mar"), verbose elsewhere. */
export const formatListDate = (value: string | null | undefined) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    if (isToday(date)) return format(date, "HH:mm");
    if (isYesterday(date)) return "Yesterday";
    if (isThisYear(date)) return format(date, "d MMM");
    return format(date, "d MMM yyyy");
};

export const formatFullDate = (value: string | null | undefined) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return format(date, "EEE, d MMM yyyy 'at' HH:mm");
};

export const formatBytes = (bytes?: number) => {
    if (!bytes || bytes < 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const exponent = Math.min(
        Math.floor(Math.log(bytes) / Math.log(1024)),
        units.length - 1
    );
    const value = bytes / 1024 ** exponent;
    return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
};

export const addressText = (address?: EmailAddress | string | null) => {
    if (!address) return "";
    if (typeof address === "string") return address;
    if (address.text) return address.text;
    return (address.value || [])
        .map((entry) => entry.name || entry.address || "")
        .filter(Boolean)
        .join(", ");
};

export const senderLabel = (email: EmailSummary) =>
    email.fromName || email.fromAddress || email.from || "Unknown sender";

/** Bare addresses out of a parsed header, for reply-all and de-duplication. */
export const addressList = (address?: EmailAddress | string | null) => {
    if (!address) return [];

    if (typeof address === "string") {
        return address
            .split(/[,;]/)
            .map((entry) => entry.trim())
            .filter(Boolean);
    }

    const parsed = (address.value || [])
        .map((entry) => entry.address)
        .filter((entry): entry is string => Boolean(entry));

    if (parsed.length > 0) return parsed;

    return (address.text || "")
        .split(/[,;]/)
        .map((entry) => entry.trim())
        .filter(Boolean);
};

const canonical = (address: string) =>
    (address.match(/<([^>]+)>/)?.[1] || address).trim().toLowerCase();

/**
 * Reply-all recipients: the sender plus everyone on To and Cc, minus the
 * addresses that belong to the replying mailbox so nobody mails themselves.
 */
export const replyAllRecipients = (
    email: {
        from?: EmailAddress | string | null;
        to?: EmailAddress | string | null;
        cc?: EmailAddress | string | null;
    },
    ownAddresses: Array<string | null | undefined> = []
) => {
    const mine = new Set(
        ownAddresses.filter(Boolean).map((entry) => canonical(entry as string))
    );

    const dedupe = (entries: string[], seen: Set<string>) =>
        entries.filter((entry) => {
            const key = canonical(entry);
            if (!key || mine.has(key) || seen.has(key)) return false;
            seen.add(key);
            return true;
        });

    const seen = new Set<string>();
    const to = dedupe(
        [...addressList(email.from), ...addressList(email.to)],
        seen
    );
    const cc = dedupe(addressList(email.cc), seen);

    return { to, cc };
};

export const initialsFor = (value: string) => {
    const cleaned = value.replace(/[^a-zA-Z0-9@. ]/g, "").trim();
    if (!cleaned) return "?";

    const words = cleaned.split(/[.\s@]+/).filter(Boolean);
    if (words.length === 0) return "?";
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
};

const AVATAR_PALETTE = [
    "bg-primary-100 text-primary-700",
    "bg-success-100 text-success-700",
    "bg-warning-100 text-warning-700",
    "bg-danger-100 text-danger-700",
];

export const avatarTone = (value: string) => {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
        hash = (hash * 31 + value.charCodeAt(index)) % 997;
    }
    return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
};

const SPECIAL_USE_ORDER = [
    "inbox",
    "drafts",
    "sent",
    "archive",
    "junk",
    "trash",
];

/** Flatten the folder tree and put the special-use folders in the usual order. */
export const flattenFolders = (
    folders: MailFolder[],
    depth = 0
): Array<MailFolder & { depth: number }> =>
    folders.flatMap((folder) => [
        { ...folder, depth },
        ...flattenFolders(folder.children || [], depth + 1),
    ]);

export const sortFolders = (folders: Array<MailFolder & { depth: number }>) => {
    const rank = (folder: MailFolder) => {
        const index = folder.specialUse
            ? SPECIAL_USE_ORDER.indexOf(folder.specialUse)
            : -1;
        return index === -1 ? SPECIAL_USE_ORDER.length : index;
    };

    return [...folders].sort((a, b) => {
        if (a.depth !== b.depth && (a.depth === 0 || b.depth === 0)) {
            return a.depth - b.depth;
        }
        const rankDelta = rank(a) - rank(b);
        return rankDelta !== 0 ? rankDelta : a.name.localeCompare(b.name);
    });
};

/** Resolve a special-use folder by its role, falling back to the usual name. */
export const specialFolderPath = (
    folders: MailFolder[],
    role: string,
    fallback: string
) =>
    flattenFolders(folders).find((folder) => folder.specialUse === role)
        ?.path || fallback;

/** Folders a message can be filed into: selectable, and not the current one. */
export const moveTargets = (folders: MailFolder[], currentPath: string) =>
    sortFolders(flattenFolders(folders)).filter(
        (folder) => folder.selectable && folder.path !== currentPath
    );

/** Special-use folders exist for delivery and Sieve; the server refuses to remove them. */
export const isSystemFolder = (
    folder: Pick<MailFolder, "path" | "specialUse">
) =>
    Boolean(folder.specialUse) ||
    ["inbox", "sent", "drafts", "trash", "junk"].includes(
        folder.path.toLowerCase()
    );
