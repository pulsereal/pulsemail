import React, { useEffect, useMemo, useState } from "react";
import {
    ArrowDownTrayIcon,
    ArrowUturnLeftIcon,
    ArrowUturnRightIcon,
    CodeBracketIcon,
    EllipsisHorizontalIcon,
    EnvelopeIcon,
    EnvelopeOpenIcon,
    ExclamationTriangleIcon,
    EyeIcon,
    FolderArrowDownIcon,
    PaperClipIcon,
    PencilSquareIcon,
    ShieldCheckIcon,
    SparklesIcon,
    StarIcon,
    TrashIcon,
    UsersIcon,
} from "@heroicons/react/24/outline";
import { StarIcon as StarSolidIcon } from "@heroicons/react/24/solid";
import clsx from "clsx";
import type { EmailDetail, MailFolder } from "../../types";
import {
    addressText,
    avatarTone,
    formatBytes,
    formatFullDate,
    initialsFor,
    isDraft,
    isFlagged,
    isUnread,
    moveTargets,
} from "../../utils/mail";
import { sanitizeEmailHtml, textToHtml } from "../../utils/sanitize";
import Button from "../common/Button";
import Badge from "../common/Badge";
import Dropdown from "../common/Dropdown";
import EmptyState from "../common/EmptyState";
import ErrorState from "../common/ErrorState";
import LoadingSpinner from "../LoadingSpinner";
import Tooltip from "../common/Tooltip";

interface ReadingPaneProps {
    email?: EmailDetail | null;
    loading?: boolean;
    error?: unknown;
    onRetry?: () => void;
    folders?: MailFolder[];
    onReply: (email: EmailDetail) => void;
    onReplyAll?: (email: EmailDetail) => void;
    onForward: (email: EmailDetail) => void;
    onDelete: (email: EmailDetail) => void;
    onToggleRead: (email: EmailDetail) => void;
    onToggleFlag?: (email: EmailDetail) => void;
    onMove?: (email: EmailDetail, targetFolder: string) => void;
    onSpam?: (email: EmailDetail, spam: boolean) => void;
    onEditDraft?: (email: EmailDetail) => void;
    onDownloadAttachment?: (email: EmailDetail, index: number) => void;
    onViewSource?: (email: EmailDetail) => void;
    onDownloadMessage?: (email: EmailDetail) => void;
    mailboxLabel?: string;
}

const ReadingPane: React.FC<ReadingPaneProps> = ({
    email,
    loading,
    error,
    onRetry,
    folders = [],
    onReply,
    onReplyAll,
    onForward,
    onDelete,
    onToggleRead,
    onToggleFlag,
    onMove,
    onSpam,
    onEditDraft,
    onDownloadAttachment,
    onViewSource,
    onDownloadMessage,
    mailboxLabel,
}) => {
    const [showRemoteContent, setShowRemoteContent] = useState(false);

    // Each message decides afresh whether remote content is trusted.
    useEffect(() => setShowRemoteContent(false), [email?.uid, email?.mailbox]);

    const body = useMemo(() => {
        if (!email) return { html: "", hasBlockedRemoteContent: false };
        const source = email.html || textToHtml(email.text);
        return sanitizeEmailHtml(source, {
            blockRemoteContent: !showRemoteContent,
        });
    }, [email, showRemoteContent]);

    const folderItems = useMemo(() => {
        if (!email || !onMove) return [];
        return moveTargets(folders, email.folder || "").map((folder) => ({
            id: `move-${folder.path}`,
            label: folder.displayName,
            onSelect: () => onMove(email, folder.path),
        }));
    }, [email, folders, onMove]);

    if (error) return <ErrorState error={error} onRetry={onRetry} />;
    if (loading) return <LoadingSpinner fullHeight label="Opening message…" />;

    if (!email) {
        return (
            <EmptyState
                icon={EnvelopeOpenIcon}
                title="Select a message"
                description="Choose a message from the list to read it here."
            />
        );
    }

    const senderName = addressText(email.from) || "Unknown sender";
    const unread = isUnread(email);
    const flagged = isFlagged(email);
    const draft = isDraft(email);
    const inJunk = (email.folder || "").toLowerCase().includes("junk");

    const overflowItems = [
        ...(onSpam
            ? [
                  {
                      id: "spam",
                      label: inJunk ? "Not spam" : "Report as spam",
                      icon: inJunk ? ShieldCheckIcon : ExclamationTriangleIcon,
                      onSelect: () => onSpam(email, !inJunk),
                  },
              ]
            : []),
        ...(onViewSource
            ? [
                  {
                      id: "source",
                      label: "View source",
                      icon: CodeBracketIcon,
                      onSelect: () => onViewSource(email),
                      separatorBefore: true,
                  },
              ]
            : []),
        ...(onDownloadMessage
            ? [
                  {
                      id: "download",
                      label: "Download as .eml",
                      icon: ArrowDownTrayIcon,
                      onSelect: () => onDownloadMessage(email),
                  },
              ]
            : []),
    ];

    return (
        <article className="flex h-full flex-col">
            <header className="shrink-0 border-b border-line px-6 py-4">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <h2 className="text-lg font-semibold leading-snug text-content">
                            {email.subject}
                        </h2>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {mailboxLabel && (
                                <Badge variant="info" size="xs">
                                    {mailboxLabel}
                                </Badge>
                            )}
                            {draft && (
                                <Badge variant="warning" size="xs">
                                    Draft
                                </Badge>
                            )}
                            {inJunk && (
                                <Badge variant="danger" size="xs">
                                    Junk
                                </Badge>
                            )}
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                        {onToggleFlag && (
                            <Tooltip label={flagged ? "Remove star" : "Star"}>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label={
                                        flagged ? "Remove star" : "Add star"
                                    }
                                    aria-pressed={flagged}
                                    onClick={() => onToggleFlag(email)}
                                    icon={
                                        flagged ? (
                                            <StarSolidIcon className="h-4 w-4 text-warning-500" />
                                        ) : (
                                            <StarIcon className="h-4 w-4" />
                                        )
                                    }
                                />
                            </Tooltip>
                        )}
                        <Tooltip
                            label={unread ? "Mark as read" : "Mark as unread"}
                        >
                            <Button
                                variant="ghost"
                                size="sm"
                                aria-label={
                                    unread ? "Mark as read" : "Mark as unread"
                                }
                                onClick={() => onToggleRead(email)}
                                icon={
                                    unread ? (
                                        <EnvelopeOpenIcon className="h-4 w-4" />
                                    ) : (
                                        <EnvelopeIcon className="h-4 w-4" />
                                    )
                                }
                            />
                        </Tooltip>
                        {folderItems.length > 0 && (
                            <Dropdown
                                trigger={
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        aria-label="Move to folder"
                                        icon={
                                            <FolderArrowDownIcon className="h-4 w-4" />
                                        }
                                    />
                                }
                                items={folderItems}
                                menuClassName="max-h-72 overflow-y-auto scrollbar-thin"
                            />
                        )}
                        <Tooltip label="Delete">
                            <Button
                                variant="ghost"
                                size="sm"
                                aria-label="Delete message"
                                onClick={() => onDelete(email)}
                                icon={<TrashIcon className="h-4 w-4" />}
                            />
                        </Tooltip>
                        {overflowItems.length > 0 && (
                            <Dropdown
                                trigger={
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        aria-label="More actions"
                                        icon={
                                            <EllipsisHorizontalIcon className="h-4 w-4" />
                                        }
                                    />
                                }
                                items={overflowItems}
                            />
                        )}
                    </div>
                </div>

                <div className="mt-4 flex items-start gap-3">
                    <span
                        className={clsx(
                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                            avatarTone(senderName)
                        )}
                    >
                        {initialsFor(senderName)}
                    </span>
                    <div className="min-w-0 flex-1 text-sm">
                        <p className="truncate font-medium text-content">
                            {senderName}
                        </p>
                        <p className="truncate text-content-subtle">
                            to{" "}
                            {addressText(email.to) || "undisclosed recipients"}
                            {email.cc && ` · cc ${addressText(email.cc)}`}
                        </p>
                    </div>
                    <time className="shrink-0 text-xs text-content-subtle">
                        {formatFullDate(email.date)}
                    </time>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                    {draft && onEditDraft ? (
                        <Button
                            size="sm"
                            icon={<PencilSquareIcon className="h-4 w-4" />}
                            onClick={() => onEditDraft(email)}
                        >
                            Continue editing
                        </Button>
                    ) : (
                        <>
                            <Button
                                size="sm"
                                variant="outline"
                                icon={
                                    <ArrowUturnLeftIcon className="h-4 w-4" />
                                }
                                onClick={() => onReply(email)}
                            >
                                Reply
                            </Button>
                            {onReplyAll && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    icon={<UsersIcon className="h-4 w-4" />}
                                    onClick={() => onReplyAll(email)}
                                >
                                    Reply all
                                </Button>
                            )}
                            <Button
                                size="sm"
                                variant="outline"
                                icon={
                                    <ArrowUturnRightIcon className="h-4 w-4" />
                                }
                                onClick={() => onForward(email)}
                            >
                                Forward
                            </Button>
                        </>
                    )}
                </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 scrollbar-thin">
                {email.summary && (
                    <div className="mb-5 rounded-lg border border-primary-200 bg-primary-50 p-3">
                        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary-700">
                            <SparklesIcon className="h-3.5 w-3.5" />
                            Summary
                        </p>
                        <p className="mt-1 text-sm text-primary-900">
                            {email.summary}
                        </p>
                    </div>
                )}

                {body.hasBlockedRemoteContent && (
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning-300 bg-warning-50 px-3 py-2">
                        <p className="flex items-center gap-2 text-sm text-warning-800">
                            <EyeIcon className="h-4 w-4 shrink-0" />
                            Remote images are blocked to prevent tracking.
                        </p>
                        <Button
                            size="xs"
                            variant="outline"
                            onClick={() => setShowRemoteContent(true)}
                        >
                            Load images
                        </Button>
                    </div>
                )}

                <div
                    className="email-content"
                    dangerouslySetInnerHTML={{ __html: body.html }}
                />

                {email.attachments.length > 0 && (
                    <div className="mt-6 border-t border-line pt-4">
                        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-content-subtle">
                            <PaperClipIcon className="h-3.5 w-3.5" />
                            {email.attachments.length} attachment
                            {email.attachments.length === 1 ? "" : "s"}
                        </p>
                        <ul className="flex flex-wrap gap-2">
                            {email.attachments.map((attachment, index) => (
                                <li key={`${attachment.filename}-${index}`}>
                                    <button
                                        type="button"
                                        disabled={!onDownloadAttachment}
                                        onClick={() =>
                                            onDownloadAttachment?.(email, index)
                                        }
                                        className="flex items-center gap-2 rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm transition-colors enabled:hover:border-primary-400 enabled:hover:bg-surface-hover disabled:cursor-default"
                                    >
                                        <PaperClipIcon className="h-4 w-4 text-content-subtle" />
                                        <span className="max-w-[16rem] truncate text-content">
                                            {attachment.filename ||
                                                "attachment"}
                                        </span>
                                        <span className="text-xs text-content-subtle">
                                            {formatBytes(attachment.size)}
                                        </span>
                                        {onDownloadAttachment && (
                                            <ArrowDownTrayIcon className="h-4 w-4 text-content-subtle" />
                                        )}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </article>
    );
};

export default ReadingPane;
