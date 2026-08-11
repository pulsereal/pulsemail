import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import toast from "react-hot-toast";
import {
    DocumentArrowDownIcon,
    PaperAirplaneIcon,
    PaperClipIcon,
    ShieldCheckIcon,
    SparklesIcon,
    XMarkIcon,
} from "@heroicons/react/24/outline";
import { emailAPI, mailboxAPI } from "../../services/api";
import { useComposeStore } from "../../stores/composeStore";
import { useAuthStore } from "../../stores/authStore";
import { formatBytes } from "../../utils/mail";
import type { Identity } from "../../types";
import Drawer from "../common/Drawer";
import Button from "../common/Button";
import Input from "../common/Input";
import Select from "../common/Select";
import Badge from "../common/Badge";
import RichTextEditor from "./RichTextEditor";

const splitAddresses = (value: string) =>
    value
        .split(/[,;]/)
        .map((entry) => entry.trim())
        .filter(Boolean);

const SIGNATURE_MARKER = "data-pulsemail-signature";

/** Swap the signature block in place so switching identity never stacks them. */
const applySignature = (content: string, signature: string) => {
    const stripped = content.replace(
        new RegExp(`<div ${SIGNATURE_MARKER}[\\s\\S]*?</div>`, "g"),
        ""
    );

    if (!signature.trim()) return stripped;
    return `${stripped}<div ${SIGNATURE_MARKER}="true"><br>${signature}</div>`;
};

interface SpamResult {
    score?: number;
    max_score?: number;
    recommendation?: string;
}

const ComposeDrawer: React.FC = () => {
    const { open, draft, closeCompose, updateDraft } = useComposeStore();
    const queryClient = useQueryClient();
    const activeMailbox = useAuthStore((state) => state.activeMailbox);
    const ownEmail = useAuthStore((state) => state.user?.email);

    const [attachments, setAttachments] = useState<File[]>([]);
    const [showCc, setShowCc] = useState(false);
    const [spam, setSpam] = useState<SpamResult | null>(null);

    const mailbox = activeMailbox || ownEmail || "";

    const identitiesQuery = useQuery(
        ["identities", mailbox],
        () => mailboxAPI.getIdentities().then((response) => response.data),
        { enabled: open, staleTime: 5 * 60 * 1000 }
    );

    const identities: Identity[] = identitiesQuery.data?.identities ?? [];

    const identityOptions = useMemo(() => {
        const extra: string[] = identitiesQuery.data?.availableAddresses ?? [];
        return [
            ...identities.map((identity) => ({
                value: identity.fromAddress,
                label: identity.displayName
                    ? `${identity.displayName} <${identity.fromAddress}>`
                    : identity.fromAddress,
            })),
            ...extra.map((address) => ({ value: address, label: address })),
        ];
    }, [identities, identitiesQuery.data]);

    // A fresh compose starts from the default identity, signature included.
    useEffect(() => {
        if (!open || draft.fromAddress || identities.length === 0) return;

        const preferred =
            identities.find((identity) => identity.isDefault) || identities[0];

        updateDraft({
            fromAddress: preferred.fromAddress,
            content: applySignature(draft.content, preferred.signature),
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, identities]);

    useEffect(() => {
        if (draft.cc || draft.bcc) setShowCc(true);
    }, [draft.cc, draft.bcc]);

    const reset = () => {
        setAttachments([]);
        setShowCc(false);
        setSpam(null);
        closeCompose();
    };

    const chooseIdentity = (address: string) => {
        const identity = identities.find(
            (entry) => entry.fromAddress === address
        );
        updateDraft({
            fromAddress: address,
            content: applySignature(draft.content, identity?.signature || ""),
        });
    };

    const send = useMutation(
        () =>
            emailAPI.sendEmail({
                to: splitAddresses(draft.to),
                cc: draft.cc ? splitAddresses(draft.cc) : undefined,
                bcc: draft.bcc ? splitAddresses(draft.bcc) : undefined,
                subject: draft.subject,
                content: draft.content,
                attachments,
            }),
        {
            onSuccess: () => {
                toast.success("Message sent");
                // The sent copy and any replaced draft change these folders.
                queryClient.invalidateQueries(["emails"]);
                reset();
            },
        }
    );

    const saveDraft = useMutation(
        () =>
            emailAPI.saveDraft({
                to: draft.to,
                cc: draft.cc,
                bcc: draft.bcc,
                subject: draft.subject,
                content: draft.content,
                replaceUid: draft.draftUid,
                attachments,
            }),
        {
            onSuccess: (response) => {
                toast.success("Draft saved");
                queryClient.invalidateQueries(["emails"]);
                updateDraft({
                    draftUid: response.data?.uid ?? draft.draftUid,
                    draftFolder: response.data?.folder ?? draft.draftFolder,
                });
            },
        }
    );

    const spamTest = useMutation(
        () => emailAPI.testSpam(draft.content, draft.subject, draft.to),
        {
            onSuccess: (response) =>
                setSpam(response.data?.spamResult ?? response.data),
        }
    );

    const aiReply = useMutation(
        () =>
            emailAPI.generateReply(draft.inReplyToUid as string, {
                folder: draft.inReplyToFolder,
                tone: "professional",
            }),
        {
            onSuccess: (response) => {
                const generated = response.data?.reply;
                if (!generated) {
                    toast.error("The assistant returned nothing usable");
                    return;
                }
                updateDraft({ content: `${generated}${draft.content}` });
                toast.success("Draft reply inserted");
            },
        }
    );

    const addFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || []);
        if (files.length) setAttachments((prev) => [...prev, ...files]);
        event.target.value = "";
    };

    const canSend =
        draft.to.trim().length > 0 &&
        draft.subject.trim().length > 0 &&
        draft.content.trim().length > 0;

    const hasContent =
        Boolean(draft.to.trim()) ||
        Boolean(draft.subject.trim()) ||
        Boolean(draft.content.trim());

    return (
        <Drawer
            isOpen={open}
            onClose={reset}
            width="xl"
            title={draft.draftUid ? "Edit draft" : "New message"}
            description={mailbox ? `Sending from ${mailbox}` : undefined}
            footer={
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            loading={spamTest.isLoading}
                            disabled={!draft.content.trim()}
                            onClick={() => spamTest.mutate()}
                            icon={<ShieldCheckIcon className="h-4 w-4" />}
                        >
                            Spam check
                        </Button>
                        {draft.inReplyToUid && (
                            <Button
                                variant="outline"
                                size="sm"
                                loading={aiReply.isLoading}
                                onClick={() => aiReply.mutate()}
                                icon={<SparklesIcon className="h-4 w-4" />}
                            >
                                Draft with AI
                            </Button>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            loading={saveDraft.isLoading}
                            disabled={!hasContent}
                            onClick={() => saveDraft.mutate()}
                            icon={<DocumentArrowDownIcon className="h-4 w-4" />}
                        >
                            Save draft
                        </Button>
                        <Button variant="ghost" size="sm" onClick={reset}>
                            Discard
                        </Button>
                        <Button
                            size="sm"
                            loading={send.isLoading}
                            disabled={!canSend}
                            onClick={() => send.mutate()}
                            icon={<PaperAirplaneIcon className="h-4 w-4" />}
                        >
                            Send
                        </Button>
                    </div>
                </div>
            }
        >
            <div className="space-y-4">
                {identityOptions.length > 1 && (
                    <Select
                        label="From"
                        value={draft.fromAddress || mailbox}
                        onChange={(event) => chooseIdentity(event.target.value)}
                        options={identityOptions}
                    />
                )}

                <div className="flex items-end gap-2">
                    <Input
                        label="To"
                        type="text"
                        value={draft.to}
                        onChange={(event) =>
                            updateDraft({ to: event.target.value })
                        }
                        placeholder="name@example.com, second@example.com"
                    />
                    {!showCc && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="mb-1"
                            onClick={() => setShowCc(true)}
                        >
                            Cc / Bcc
                        </Button>
                    )}
                </div>

                {showCc && (
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Input
                            label="Cc"
                            type="text"
                            value={draft.cc}
                            onChange={(event) =>
                                updateDraft({ cc: event.target.value })
                            }
                        />
                        <Input
                            label="Bcc"
                            type="text"
                            value={draft.bcc}
                            onChange={(event) =>
                                updateDraft({ bcc: event.target.value })
                            }
                        />
                    </div>
                )}

                <Input
                    label="Subject"
                    value={draft.subject}
                    onChange={(event) =>
                        updateDraft({ subject: event.target.value })
                    }
                />

                <div>
                    <span className="mb-1.5 block text-sm font-medium text-content">
                        Message
                    </span>
                    <RichTextEditor
                        value={draft.content}
                        onChange={(content) => updateDraft({ content })}
                        placeholder="Write your message…"
                    />
                </div>

                {spam && (
                    <div className="rounded-lg border border-line bg-surface-sunken p-3">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-content">
                                Spam score
                            </span>
                            <Badge
                                variant={
                                    (spam.score ?? 0) <= 3
                                        ? "success"
                                        : (spam.score ?? 0) <= 6
                                          ? "warning"
                                          : "danger"
                                }
                            >
                                {spam.score ?? "?"} / {spam.max_score ?? 10}
                            </Badge>
                        </div>
                        {spam.recommendation && (
                            <p className="mt-1.5 text-sm text-content-muted">
                                {spam.recommendation}
                            </p>
                        )}
                    </div>
                )}

                <div>
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-line-strong px-3 py-2 text-sm text-content-muted transition-colors hover:border-primary-400 hover:text-content">
                        <PaperClipIcon className="h-4 w-4" />
                        Attach files
                        <input
                            type="file"
                            multiple
                            className="sr-only"
                            onChange={addFiles}
                        />
                    </label>

                    {attachments.length > 0 && (
                        <ul className="mt-3 space-y-2">
                            {attachments.map((file, index) => (
                                <li
                                    key={`${file.name}-${index}`}
                                    className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm"
                                >
                                    <span className="min-w-0 truncate text-content">
                                        {file.name}
                                    </span>
                                    <span className="flex shrink-0 items-center gap-2">
                                        <span className="text-xs text-content-subtle">
                                            {formatBytes(file.size)}
                                        </span>
                                        <button
                                            type="button"
                                            aria-label={`Remove ${file.name}`}
                                            onClick={() =>
                                                setAttachments((prev) =>
                                                    prev.filter(
                                                        (_, position) =>
                                                            position !== index
                                                    )
                                                )
                                            }
                                            className="rounded p-0.5 text-content-subtle hover:bg-surface-hover hover:text-danger-600"
                                        >
                                            <XMarkIcon className="h-4 w-4" />
                                        </button>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </Drawer>
    );
};

export default ComposeDrawer;
