import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { PencilSquareIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import { emailAPI } from "../services/api";
import { useAuthStore } from "../stores/authStore";
import {
    editDraft,
    forwardDraft,
    replyAllDraft,
    replyDraft,
    useComposeStore,
} from "../stores/composeStore";
import type { EmailDetail, EmailSummary, MailFolder } from "../types";
import {
    addressText,
    flattenFolders,
    isFlagged,
    replyAllRecipients,
} from "../utils/mail";
import { filenameFromHeaders, saveBlob } from "../utils/download";
import { useFeatures } from "../hooks/useFeatures";
import FolderRail from "../components/mail/FolderRail";
import MailToolbar, { MailPager } from "../components/mail/MailToolbar";
import MessageList from "../components/mail/MessageList";
import ReadingPane from "../components/mail/ReadingPane";
import Button from "../components/common/Button";
import Modal from "../components/common/Modal";
import Input from "../components/common/Input";

const PAGE_SIZE = 50;

interface FolderPrompt {
    mode: "rename" | "delete";
    folder: MailFolder;
}

const EmailsPage: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const queryClient = useQueryClient();
    const openCompose = useComposeStore((state) => state.openCompose);
    const activeMailbox = useAuthStore((state) => state.activeMailbox);
    const ownEmail = useAuthStore((state) => state.user?.email);

    const folder = searchParams.get("folder") || "INBOX";
    const selectedUid = searchParams.get("uid");

    const [searchInput, setSearchInput] = useState("");
    const [searchTerm, setSearchTerm] = useState("");
    const [unreadOnly, setUnreadOnly] = useState(false);
    const [category, setCategory] = useState("");
    const [priorityOnly, setPriorityOnly] = useState(false);
    const features = useFeatures();
    const [offset, setOffset] = useState(0);
    const [checkedUids, setCheckedUids] = useState<Set<string>>(new Set());
    const [folderPrompt, setFolderPrompt] = useState<FolderPrompt | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [source, setSource] = useState<string | null>(null);

    // Switching mailbox invalidates every per-mailbox selection.
    useEffect(() => {
        setCheckedUids(new Set());
        setSearchTerm("");
        setSearchInput("");
        setOffset(0);
    }, [activeMailbox]);

    useEffect(() => {
        setOffset(0);
        setCheckedUids(new Set());
    }, [folder, category, unreadOnly, priorityOnly, searchTerm]);

    const setParam = useCallback(
        (patch: Record<string, string | null>) => {
            setSearchParams(
                (previous) => {
                    const next = new URLSearchParams(previous);
                    Object.entries(patch).forEach(([key, value]) => {
                        if (value === null) next.delete(key);
                        else next.set(key, value);
                    });
                    return next;
                },
                { replace: true }
            );
        },
        [setSearchParams]
    );

    const scope = activeMailbox || ownEmail || "self";

    const foldersQuery = useQuery(
        ["folders", scope],
        () => emailAPI.getFolders().then((response) => response.data),
        { staleTime: 5 * 60 * 1000 }
    );

    const listQuery = useQuery(
        [
            "emails",
            scope,
            folder,
            category,
            unreadOnly,
            priorityOnly,
            searchTerm,
            offset,
        ],
        () => {
            if (searchTerm) {
                return emailAPI
                    .searchEmails({
                        query: searchTerm,
                        folder,
                        category: category || undefined,
                    })
                    .then((response) => response.data);
            }

            return emailAPI
                .getEmails({
                    folder,
                    limit: PAGE_SIZE,
                    offset,
                    category: category || undefined,
                    unread_only: unreadOnly || undefined,
                    priority: priorityOnly || undefined,
                })
                .then((response) => response.data);
        },
        { keepPreviousData: true }
    );

    const detailQuery = useQuery(
        ["email", scope, folder, selectedUid],
        () =>
            emailAPI
                .getEmail(selectedUid as string, folder)
                .then((response) => response.data.email as EmailDetail),
        { enabled: Boolean(selectedUid) }
    );

    const emails: EmailSummary[] = listQuery.data?.emails ?? [];
    const folders: MailFolder[] = foldersQuery.data?.folders ?? [];
    // Only an unfiltered listing knows the real folder size; otherwise the pager
    // falls back to "a full page means there is probably another one".
    const pagination = listQuery.data?.pagination;
    const total: number | undefined = pagination?.exact
        ? pagination.total
        : undefined;

    const invalidateList = useCallback(() => {
        queryClient.invalidateQueries(["emails", scope]);
        queryClient.invalidateQueries(["folders", scope]);
    }, [queryClient, scope]);

    const markMutation = useMutation(
        ({
            uid,
            action,
        }: {
            uid: string;
            action: "read" | "unread" | "flagged" | "unflagged";
        }) => emailAPI.markEmail(uid, action, folder),
        {
            onSuccess: () => {
                invalidateList();
                queryClient.invalidateQueries(["email", scope, folder]);
            },
        }
    );

    const deleteMutation = useMutation(
        (uid: string) => emailAPI.deleteEmail(uid, folder),
        {
            onSuccess: (response) => {
                toast.success(
                    response.data?.expunged
                        ? "Message permanently deleted"
                        : `Moved to ${response.data?.movedTo || "Trash"}`
                );
                invalidateList();
            },
        }
    );

    const moveMutation = useMutation(
        ({ uid, target }: { uid: string; target: string }) =>
            emailAPI.moveEmail(uid, target, folder),
        {
            onSuccess: (_result, variables) => {
                toast.success(`Moved to ${variables.target}`);
                invalidateList();
            },
        }
    );

    const spamMutation = useMutation(
        ({ uid, spam }: { uid: string; spam: boolean }) =>
            emailAPI.setSpam(uid, spam, folder),
        {
            onSuccess: (response, variables) => {
                toast.success(
                    variables.spam
                        ? `Reported as spam and moved to ${response.data?.target || "Junk"}`
                        : "Moved back to the inbox"
                );
                invalidateList();
            },
        }
    );

    const folderMutation = useMutation(
        (action: {
            type: "create" | "rename" | "delete";
            name: string;
            newName?: string;
        }) => {
            if (action.type === "create")
                return emailAPI.createFolder(action.name);
            if (action.type === "rename")
                return emailAPI.renameFolder(action.name, action.newName || "");
            return emailAPI.deleteFolder(action.name);
        },
        {
            onSuccess: (_result, action) => {
                toast.success(
                    action.type === "create"
                        ? "Folder created"
                        : action.type === "rename"
                          ? "Folder renamed"
                          : "Folder deleted"
                );
                queryClient.invalidateQueries(["folders", scope]);
                if (action.type !== "create" && folder === action.name) {
                    setParam({
                        folder: action.newName || "INBOX",
                        uid: null,
                    });
                }
                setFolderPrompt(null);
            },
        }
    );

    const clearSelection = () => setCheckedUids(new Set());

    const openMessage = useCallback(
        (email: EmailSummary) => {
            setParam({ uid: email.uid });
            if (!email.flags?.includes("\\Seen")) {
                markMutation.mutate({ uid: email.uid, action: "read" });
            }
        },
        [setParam, markMutation]
    );

    const toggleCheck = useCallback((uid: string) => {
        setCheckedUids((previous) => {
            const next = new Set(previous);
            if (next.has(uid)) next.delete(uid);
            else next.add(uid);
            return next;
        });
    }, []);

    const toggleFlag = useCallback(
        (email: Pick<EmailSummary, "uid" | "flags">) =>
            markMutation.mutate({
                uid: email.uid,
                action: isFlagged(email) ? "unflagged" : "flagged",
            }),
        [markMutation]
    );

    /** Bulk actions fan out one request per uid; IMAP has no batch endpoint here. */
    const runBulk = async (
        describe: (count: number) => string,
        action: (uid: string) => Promise<unknown>
    ) => {
        const uids = [...checkedUids];
        if (uids.length === 0) return;

        const results = await Promise.allSettled(uids.map(action));
        const failed = results.filter(
            (result) => result.status === "rejected"
        ).length;

        clearSelection();
        setParam({ uid: null });
        invalidateList();

        if (failed === 0) toast.success(describe(uids.length));
        else toast.error(`${failed} of ${uids.length} messages failed`);
    };

    const plural = (count: number) =>
        `${count} message${count === 1 ? "" : "s"}`;

    const downloadAttachment = async (email: EmailDetail, index: number) => {
        const response = await emailAPI.downloadAttachment(
            email.uid,
            index,
            email.folder || folder
        );
        saveBlob(
            response.data,
            filenameFromHeaders(
                response.headers as Record<string, unknown>,
                email.attachments[index]?.filename || `attachment-${index}`
            )
        );
    };

    const downloadMessage = async (email: EmailDetail) => {
        const response = await emailAPI.getSource(
            email.uid,
            email.folder || folder,
            true
        );
        saveBlob(
            response.data,
            `${email.subject || "message"}.eml`.replace(/[/\\]/g, "-")
        );
    };

    const viewSource = async (email: EmailDetail) => {
        const response = await emailAPI.getSource(
            email.uid,
            email.folder || folder
        );
        setSource(String(response.data));
    };

    const seedFrom = (email: EmailDetail) => ({
        uid: email.uid,
        folder: email.folder || folder,
        subject: email.subject,
        date: email.date,
        fromText: addressText(email.from),
        body: email.html || email.text || "",
    });

    const activeFolderLabel = useMemo(
        () =>
            flattenFolders(folders).find((entry) => entry.path === folder)
                ?.displayName ||
            folder.split(/[./]/).pop() ||
            folder,
        [folders, folder]
    );

    const allSelected =
        emails.length > 0 &&
        emails.every((email) => checkedUids.has(email.uid));

    return (
        <div className="flex h-[calc(100vh-4rem)] overflow-hidden rounded-xl border border-line bg-surface">
            <aside className="hidden w-56 shrink-0 flex-col border-r border-line p-3 lg:flex">
                <Button
                    fullWidth
                    className="mb-4"
                    onClick={() => openCompose()}
                    icon={<PencilSquareIcon className="h-4 w-4" />}
                >
                    Compose
                </Button>
                <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
                    <FolderRail
                        folders={folders}
                        activeFolder={folder}
                        loading={foldersQuery.isLoading}
                        onSelect={(path) =>
                            setParam({ folder: path, uid: null })
                        }
                        onCreate={(name) =>
                            folderMutation.mutate({ type: "create", name })
                        }
                        onRename={(target) => {
                            setRenameValue(target.displayName);
                            setFolderPrompt({ mode: "rename", folder: target });
                        }}
                        onDelete={(target) =>
                            setFolderPrompt({ mode: "delete", folder: target })
                        }
                    />
                </div>
            </aside>

            <section
                className={clsx(
                    "flex w-full shrink-0 flex-col border-r border-line md:w-80 xl:w-96",
                    selectedUid && "hidden md:flex"
                )}
            >
                <MailToolbar
                    title={activeFolderLabel}
                    count={total ?? emails.length}
                    search={searchInput}
                    onSearchChange={setSearchInput}
                    onSearchSubmit={() => setSearchTerm(searchInput.trim())}
                    onRefresh={() => listQuery.refetch()}
                    refreshing={listQuery.isFetching}
                    unreadOnly={unreadOnly}
                    onUnreadOnlyChange={setUnreadOnly}
                    category={category}
                    onCategoryChange={setCategory}
                    priorityOnly={priorityOnly}
                    onPriorityOnlyChange={
                        features.aiSorting ? setPriorityOnly : undefined
                    }
                    selectedCount={checkedUids.size}
                    allSelected={allSelected}
                    onToggleSelectAll={() =>
                        setCheckedUids(
                            allSelected
                                ? new Set()
                                : new Set(emails.map((email) => email.uid))
                        )
                    }
                    onClearSelection={clearSelection}
                    onBulkMarkRead={() =>
                        runBulk(
                            (count) => `Marked ${plural(count)} as read`,
                            (uid) => emailAPI.markEmail(uid, "read", folder)
                        )
                    }
                    onBulkFlag={() =>
                        runBulk(
                            (count) => `Starred ${plural(count)}`,
                            (uid) => emailAPI.markEmail(uid, "flagged", folder)
                        )
                    }
                    onBulkDelete={() =>
                        runBulk(
                            (count) => `Deleted ${plural(count)}`,
                            (uid) => emailAPI.deleteEmail(uid, folder)
                        )
                    }
                    onBulkSpam={() =>
                        runBulk(
                            (count) => `Reported ${plural(count)} as spam`,
                            (uid) => emailAPI.setSpam(uid, true, folder)
                        )
                    }
                    onBulkMove={(target) =>
                        runBulk(
                            (count) => `Moved ${plural(count)} to ${target}`,
                            (uid) => emailAPI.moveEmail(uid, target, folder)
                        )
                    }
                    folders={folders}
                    currentFolder={folder}
                />

                <div className="min-h-0 flex-1">
                    <MessageList
                        emails={emails}
                        selectedUid={selectedUid}
                        checkedUids={checkedUids}
                        onSelect={openMessage}
                        onToggleCheck={toggleCheck}
                        onToggleFlag={toggleFlag}
                        loading={listQuery.isLoading}
                        error={listQuery.error}
                        onRetry={() => listQuery.refetch()}
                        emptyTitle={
                            searchTerm ? "No matches" : "Nothing to read"
                        }
                        emptyDescription={
                            searchTerm
                                ? `No messages matched "${searchTerm}".`
                                : "This folder is empty."
                        }
                    />
                </div>

                {!searchTerm && (
                    <MailPager
                        offset={offset}
                        pageSize={PAGE_SIZE}
                        shown={emails.length}
                        total={total}
                        disabled={listQuery.isFetching}
                        onChange={(next) => {
                            setOffset(next);
                            setParam({ uid: null });
                        }}
                    />
                )}
            </section>

            <section
                className={clsx(
                    "min-w-0 flex-1",
                    !selectedUid && "hidden md:block"
                )}
            >
                {selectedUid && (
                    <div className="border-b border-line px-4 py-2 md:hidden">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setParam({ uid: null })}
                        >
                            Back to list
                        </Button>
                    </div>
                )}
                <ReadingPane
                    email={detailQuery.data}
                    loading={detailQuery.isLoading && Boolean(selectedUid)}
                    error={detailQuery.error}
                    onRetry={() => detailQuery.refetch()}
                    folders={folders}
                    mailboxLabel={
                        activeMailbox && activeMailbox !== ownEmail
                            ? activeMailbox
                            : undefined
                    }
                    onReply={(email) =>
                        openCompose(replyDraft(seedFrom(email)))
                    }
                    onReplyAll={(email) => {
                        const { to, cc } = replyAllRecipients(email, [
                            activeMailbox,
                            ownEmail,
                        ]);
                        openCompose(
                            replyAllDraft({ ...seedFrom(email), to, cc })
                        );
                    }}
                    onForward={(email) =>
                        openCompose(forwardDraft(seedFrom(email)))
                    }
                    onEditDraft={(email) =>
                        openCompose(
                            editDraft({
                                uid: email.uid,
                                folder: email.folder || folder,
                                subject: email.subject,
                                to: addressText(email.to),
                                cc: addressText(email.cc),
                                body: email.html || email.text || "",
                            })
                        )
                    }
                    onDelete={(email) => {
                        deleteMutation.mutate(email.uid);
                        setParam({ uid: null });
                    }}
                    onToggleRead={(email) =>
                        markMutation.mutate({
                            uid: email.uid,
                            action: email.flags?.includes("\\Seen")
                                ? "unread"
                                : "read",
                        })
                    }
                    onToggleFlag={toggleFlag}
                    onMove={(email, target) => {
                        moveMutation.mutate({ uid: email.uid, target });
                        setParam({ uid: null });
                    }}
                    onSpam={(email, spam) => {
                        spamMutation.mutate({ uid: email.uid, spam });
                        setParam({ uid: null });
                    }}
                    onDownloadAttachment={downloadAttachment}
                    onViewSource={viewSource}
                    onDownloadMessage={downloadMessage}
                />
            </section>

            <Modal
                isOpen={folderPrompt?.mode === "rename"}
                onClose={() => setFolderPrompt(null)}
                title="Rename folder"
                description="Messages and subfolders move with it."
                size="sm"
                actions={
                    <>
                        <Button
                            variant="ghost"
                            onClick={() => setFolderPrompt(null)}
                        >
                            Cancel
                        </Button>
                        <Button
                            loading={folderMutation.isLoading}
                            disabled={!renameValue.trim()}
                            onClick={() =>
                                folderPrompt &&
                                folderMutation.mutate({
                                    type: "rename",
                                    name: folderPrompt.folder.path,
                                    newName: renameValue.trim(),
                                })
                            }
                        >
                            Rename
                        </Button>
                    </>
                }
            >
                <Input
                    label="Folder name"
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    autoFocus
                />
            </Modal>

            <Modal
                isOpen={folderPrompt?.mode === "delete"}
                onClose={() => setFolderPrompt(null)}
                title={`Delete "${folderPrompt?.folder.displayName}"?`}
                description="Every message inside it is removed from the server. This cannot be undone."
                size="sm"
                actions={
                    <>
                        <Button
                            variant="ghost"
                            onClick={() => setFolderPrompt(null)}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="danger"
                            loading={folderMutation.isLoading}
                            onClick={() =>
                                folderPrompt &&
                                folderMutation.mutate({
                                    type: "delete",
                                    name: folderPrompt.folder.path,
                                })
                            }
                        >
                            Delete folder
                        </Button>
                    </>
                }
            >
                <p className="text-sm text-content-muted">
                    Move anything you want to keep to another folder first.
                </p>
            </Modal>

            <Modal
                isOpen={source !== null}
                onClose={() => setSource(null)}
                title="Message source"
                description="The raw RFC 822 message as stored by Dovecot."
                size="xl"
                bodyClassName="bg-surface-sunken"
            >
                <pre className="whitespace-pre-wrap break-all font-mono text-xs text-content-muted">
                    {source}
                </pre>
            </Modal>
        </div>
    );
};

export default EmailsPage;
