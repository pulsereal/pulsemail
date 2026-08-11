import { create } from "zustand";

export interface ComposeDraft {
    to: string;
    cc: string;
    bcc: string;
    subject: string;
    content: string;
    /** Set when the draft was seeded from a message, so replies can cite it. */
    inReplyToUid?: string;
    inReplyToFolder?: string;
    /** Set when editing a stored draft, so saving replaces it instead of piling up copies. */
    draftUid?: string;
    draftFolder?: string;
    /** Address chosen in the identity picker; blank means the mailbox itself. */
    fromAddress?: string;
}

const EMPTY: ComposeDraft = {
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    content: "",
};

interface ComposeState {
    open: boolean;
    draft: ComposeDraft;
    openCompose: (seed?: Partial<ComposeDraft>) => void;
    closeCompose: () => void;
    updateDraft: (patch: Partial<ComposeDraft>) => void;
}

export const useComposeStore = create<ComposeState>((set) => ({
    open: false,
    draft: EMPTY,
    openCompose: (seed) => set({ open: true, draft: { ...EMPTY, ...seed } }),
    closeCompose: () => set({ open: false, draft: EMPTY }),
    updateDraft: (patch) =>
        set((state) => ({ draft: { ...state.draft, ...patch } })),
}));

const quote = (author: string, date: string | null, body: string) =>
    `<br><br><blockquote style="margin:0 0 0 0.8ex;border-left:2px solid #ccc;padding-left:1ex">` +
    `<p>On ${date ? new Date(date).toLocaleString() : "an earlier date"}, ${author} wrote:</p>` +
    `${body}</blockquote>`;

const withPrefix = (prefix: string, subject: string) =>
    subject.toLowerCase().startsWith(prefix.toLowerCase())
        ? subject
        : `${prefix} ${subject}`;

interface SourceMessage {
    uid: string;
    folder: string;
    subject: string;
    date: string | null;
    fromText: string;
    body: string;
}

export const replyDraft = (email: SourceMessage): Partial<ComposeDraft> => ({
    to: email.fromText,
    subject: withPrefix("Re:", email.subject),
    content: quote(email.fromText, email.date, email.body),
    inReplyToUid: email.uid,
    inReplyToFolder: email.folder,
});

export const replyAllDraft = (
    email: SourceMessage & { to: string[]; cc: string[] }
): Partial<ComposeDraft> => ({
    to: email.to.join(", "),
    cc: email.cc.join(", "),
    subject: withPrefix("Re:", email.subject),
    content: quote(email.fromText, email.date, email.body),
    inReplyToUid: email.uid,
    inReplyToFolder: email.folder,
});

export const forwardDraft = (email: SourceMessage): Partial<ComposeDraft> => ({
    subject: withPrefix("Fwd:", email.subject),
    content: quote(email.fromText, email.date, email.body),
    inReplyToUid: email.uid,
    inReplyToFolder: email.folder,
});

/**
 * Reopen a stored draft for editing. The uid is carried separately from
 * `inReplyToUid` so that saving replaces the original rather than quoting it.
 */
export const editDraft = (email: {
    uid: string;
    folder: string;
    subject: string;
    to: string;
    cc?: string;
    body: string;
}): Partial<ComposeDraft> => ({
    to: email.to,
    cc: email.cc || "",
    subject: email.subject,
    content: email.body,
    draftUid: email.uid,
    draftFolder: email.folder,
});
