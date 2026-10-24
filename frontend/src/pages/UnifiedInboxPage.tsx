import React, { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import toast from "react-hot-toast";
import {
    ArrowPathIcon,
    InboxStackIcon,
    MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import { adminAPI, emailAPI } from "../services/api";
import {
    forwardDraft,
    replyDraft,
    useComposeStore,
} from "../stores/composeStore";
import type {
    EmailDetail,
    EmailSummary,
    MailboxUnreadStat,
    UnifiedMailboxSummary,
} from "../types";
import { addressText } from "../utils/mail";
import MessageList from "../components/mail/MessageList";
import ReadingPane from "../components/mail/ReadingPane";
import Button from "../components/common/Button";
import Input from "../components/common/Input";
import Skeleton from "../components/common/Skeleton";

const FOLDER = "INBOX";

const UnifiedInboxPage: React.FC = () => {
    const queryClient = useQueryClient();
    const openCompose = useComposeStore((state) => state.openCompose);

    const [selected, setSelected] = useState<EmailSummary | null>(null);
    const [mailboxFilter, setMailboxFilter] = useState<Set<string>>(new Set());
    const [unreadOnly, setUnreadOnly] = useState(false);
    const [search, setSearch] = useState("");

    const statsQuery = useQuery(
        ["unified-stats", FOLDER],
        () =>
            adminAPI
                .getUnifiedStats({ folder: FOLDER })
                .then((response) => response.data),
        { staleTime: 60 * 1000 }
    );

    const listQuery = useQuery(
        ["unified-emails", FOLDER, unreadOnly, [...mailboxFilter].join(",")],
        () =>
            adminAPI
                .getUnifiedEmails({
                    folder: FOLDER,
                    limit: 200,
                    unread_only: unreadOnly || undefined,
                    mailboxes: mailboxFilter.size
                        ? [...mailboxFilter].join(",")
                        : undefined,
                })
                .then((response) => response.data),
        { keepPreviousData: true }
    );

    const detailQuery = useQuery(
        ["unified-email", selected?.mailbox, selected?.uid],
        () =>
            emailAPI
                .getEmail(
                    selected!.uid,
                    selected!.folder || FOLDER,
                    selected!.mailbox
                )
                .then((response) => response.data.email as EmailDetail),
        { enabled: Boolean(selected) }
    );

    const refreshAll = () => {
        queryClient.invalidateQueries("unified-emails");
        queryClient.invalidateQueries("unified-stats");
    };

    const toggleRead = useMutation(
        (email: EmailDetail) =>
            emailAPI.markEmail(
                email.uid,
                email.flags?.includes("\\Seen") ? "unread" : "read",
                email.folder || FOLDER,
                email.mailbox
            ),
        { onSuccess: refreshAll }
    );

    const remove = useMutation(
        (email: EmailDetail) =>
            emailAPI.deleteEmail(
                email.uid,
                email.folder || FOLDER,
                email.mailbox
            ),
        {
            onSuccess: () => {
                toast.success("Message deleted");
                setSelected(null);
                refreshAll();
            },
        }
    );

    const emails: EmailSummary[] = listQuery.data?.emails ?? [];
    const perMailbox: UnifiedMailboxSummary[] = listQuery.data?.mailboxes ?? [];
    const unreadStats: MailboxUnreadStat[] = statsQuery.data?.mailboxes ?? [];

    const unreadByMailbox = useMemo(
        () =>
            new Map(unreadStats.map((entry) => [entry.mailbox, entry.unread])),
        [unreadStats]
    );

    const mailboxes = useMemo(() => {
        const merged = new Map<string, { mailbox: string; name: string }>();
        unreadStats.forEach((entry) =>
            merged.set(entry.mailbox, {
                mailbox: entry.mailbox,
                name: entry.name,
            })
        );
        perMailbox.forEach((entry) =>
            merged.set(entry.mailbox, {
                mailbox: entry.mailbox,
                name: entry.name,
            })
        );

        const term = search.trim().toLowerCase();
        return [...merged.values()]
            .filter(
                (entry) =>
                    !term ||
                    entry.mailbox.toLowerCase().includes(term) ||
                    entry.name?.toLowerCase().includes(term)
            )
            .sort((a, b) => a.mailbox.localeCompare(b.mailbox));
    }, [unreadStats, perMailbox, search]);

    const toggleMailbox = useCallback((mailbox: string) => {
        setMailboxFilter((previous) => {
            const next = new Set(previous);
            if (next.has(mailbox)) next.delete(mailbox);
            else next.add(mailbox);
            return next;
        });
    }, []);

    const seedFrom = (email: EmailDetail) => ({
        uid: email.uid,
        folder: email.folder || FOLDER,
        subject: email.subject,
        date: email.date,
        fromText: addressText(email.from),
        body: email.html || email.text || "",
    });

    const failed = perMailbox.filter((entry) => entry.error);

    return (
        <div className="flex h-full overflow-hidden bg-surface">
            <aside className="hidden w-56 shrink-0 flex-col border-r border-line lg:flex">
                <div className="border-b border-line p-2">
                    <Input
                        type="search"
                        size="sm"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Filter mailboxes"
                        aria-label="Filter mailboxes"
                        icon={<MagnifyingGlassIcon className="h-4 w-4" />}
                    />
                    {mailboxFilter.size > 0 && (
                        <Button
                            variant="ghost"
                            size="xs"
                            className="mt-1.5"
                            onClick={() => setMailboxFilter(new Set())}
                        >
                            Clear {mailboxFilter.size} filter
                            {mailboxFilter.size === 1 ? "" : "s"}
                        </Button>
                    )}
                </div>

                <div className="min-h-0 flex-1 space-y-px overflow-y-auto p-1.5 scrollbar-thin">
                    {statsQuery.isLoading &&
                        Array.from({ length: 5 }).map((_, index) => (
                            <Skeleton key={index} className="mb-1 h-8" />
                        ))}

                    {mailboxes.map((entry) => {
                        const active = mailboxFilter.has(entry.mailbox);
                        const unread = unreadByMailbox.get(entry.mailbox) ?? 0;

                        return (
                            <button
                                key={entry.mailbox}
                                type="button"
                                onClick={() => toggleMailbox(entry.mailbox)}
                                className={clsx(
                                    "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors",
                                    active
                                        ? "bg-primary-100 text-primary-700"
                                        : "text-content-muted hover:bg-surface-hover hover:text-content"
                                )}
                            >
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate font-medium leading-5">
                                        {entry.name || entry.mailbox}
                                    </span>
                                    <span className="block truncate text-2xs text-content-subtle">
                                        {entry.mailbox}
                                    </span>
                                </span>
                                {unread > 0 && (
                                    <span className="shrink-0 rounded-full bg-surface-sunken px-1.5 text-2xs font-semibold text-content-subtle">
                                        {unread}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </aside>

            <section className="flex w-full shrink-0 flex-col border-r border-line md:w-80 xl:w-88">
                <div className="shrink-0 border-b border-line px-3 py-2">
                    <div className="flex h-7 items-center gap-1.5">
                        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-content">
                            All inboxes
                            <span className="ml-1.5 font-normal text-content-subtle">
                                {emails.length}
                            </span>
                            {mailboxFilter.size > 0 && (
                                <span className="ml-1.5 text-xs font-normal text-content-subtle">
                                    · {mailboxFilter.size} mailbox
                                    {mailboxFilter.size === 1 ? "" : "es"}
                                </span>
                            )}
                        </h2>
                        <Button
                            variant={unreadOnly ? "primary" : "outline"}
                            size="xs"
                            className="shrink-0"
                            onClick={() => setUnreadOnly((value) => !value)}
                        >
                            Unread only
                        </Button>
                        <Button
                            variant="ghost"
                            size="xs"
                            aria-label="Refresh"
                            title="Refresh"
                            className="shrink-0"
                            loading={listQuery.isFetching}
                            onClick={refreshAll}
                            icon={<ArrowPathIcon className="h-4 w-4" />}
                        />
                    </div>
                    {failed.length > 0 && (
                        <p className="mt-1 text-xs text-warning-700">
                            {failed.length} mailbox
                            {failed.length === 1 ? "" : "es"} could not be read.
                        </p>
                    )}
                </div>

                <div className="min-h-0 flex-1">
                    <MessageList
                        emails={emails}
                        selectedUid={selected?.uid}
                        onSelect={setSelected}
                        showMailbox
                        loading={listQuery.isLoading}
                        error={listQuery.error}
                        onRetry={() => listQuery.refetch()}
                        emptyTitle="Nothing across your mailboxes"
                        emptyDescription="No messages matched the current filters."
                    />
                </div>
            </section>

            <section className="hidden min-w-0 flex-1 md:block">
                {selected ? (
                    <ReadingPane
                        email={detailQuery.data}
                        loading={detailQuery.isLoading}
                        error={detailQuery.error}
                        onRetry={() => detailQuery.refetch()}
                        mailboxLabel={selected.mailbox}
                        onReply={(email) =>
                            openCompose(replyDraft(seedFrom(email)))
                        }
                        onForward={(email) =>
                            openCompose(forwardDraft(seedFrom(email)))
                        }
                        onDelete={(email) => remove.mutate(email)}
                        onToggleRead={(email) => toggleRead.mutate(email)}
                    />
                ) : (
                    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-sunken text-content-subtle">
                            <InboxStackIcon className="h-6 w-6" />
                        </span>
                        <h3 className="text-sm font-semibold text-content">
                            Select a message
                        </h3>
                        <p className="mt-1.5 max-w-sm text-sm text-content-muted">
                            Messages from every mailbox you administer are
                            merged here, newest first.
                        </p>
                    </div>
                )}
            </section>
        </div>
    );
};

export default UnifiedInboxPage;
