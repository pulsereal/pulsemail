import React from "react";
import {
    ArrowUturnLeftIcon,
    BoltIcon,
    PaperClipIcon,
    StarIcon,
} from "@heroicons/react/24/outline";
import { StarIcon as StarSolidIcon } from "@heroicons/react/24/solid";
import clsx from "clsx";
import type { EmailSummary } from "../../types";
import {
    avatarTone,
    formatListDate,
    initialsFor,
    isAnswered,
    isFlagged,
    isUnread,
    senderLabel,
} from "../../utils/mail";

interface MessageRowProps {
    email: EmailSummary;
    selected: boolean;
    checked?: boolean;
    onSelect: (email: EmailSummary) => void;
    onToggleCheck?: (uid: string) => void;
    onToggleFlag?: (email: EmailSummary) => void;
    /** Renders the owning mailbox, used by the unified all-inboxes view. */
    showMailbox?: boolean;
    style?: React.CSSProperties;
}

const MessageRow: React.FC<MessageRowProps> = ({
    email,
    selected,
    checked,
    onSelect,
    onToggleCheck,
    onToggleFlag,
    showMailbox,
    style,
}) => {
    const unread = isUnread(email);
    const flagged = isFlagged(email);
    const sender = senderLabel(email);

    return (
        <div style={style} className="px-2">
            <div
                role="button"
                tabIndex={0}
                onClick={() => onSelect(email)}
                onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect(email);
                    }
                }}
                className={clsx(
                    "group flex h-full cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                    selected
                        ? "border-primary-300 bg-primary-50"
                        : "border-transparent hover:bg-surface-hover"
                )}
            >
                {onToggleCheck && (
                    <input
                        type="checkbox"
                        checked={Boolean(checked)}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => onToggleCheck(email.uid)}
                        aria-label={`Select ${email.subject}`}
                        className="mt-1.5 h-4 w-4 shrink-0 rounded border-line-strong text-primary-600 focus:ring-primary-500"
                    />
                )}

                <span
                    className={clsx(
                        "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                        avatarTone(sender)
                    )}
                >
                    {initialsFor(sender)}
                </span>

                <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                        <p
                            className={clsx(
                                "min-w-0 flex-1 truncate text-sm",
                                unread
                                    ? "font-semibold text-content"
                                    : "text-content-muted"
                            )}
                        >
                            {sender}
                        </p>
                        <time className="shrink-0 text-xs text-content-subtle">
                            {formatListDate(email.date)}
                        </time>
                        {onToggleFlag && (
                            <button
                                type="button"
                                aria-label={
                                    flagged ? "Remove star" : "Add star"
                                }
                                aria-pressed={flagged}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onToggleFlag(email);
                                }}
                                className={clsx(
                                    "shrink-0 rounded p-0.5 transition-colors hover:bg-surface-hover",
                                    flagged
                                        ? "text-warning-500"
                                        : "text-content-subtle opacity-0 focus:opacity-100 group-hover:opacity-100"
                                )}
                            >
                                {flagged ? (
                                    <StarSolidIcon className="h-4 w-4" />
                                ) : (
                                    <StarIcon className="h-4 w-4" />
                                )}
                            </button>
                        )}
                    </div>

                    <p
                        className={clsx(
                            "truncate text-sm",
                            unread
                                ? "font-medium text-content"
                                : "text-content-muted"
                        )}
                    >
                        {email.subject}
                    </p>

                    <div className="mt-1 flex items-center gap-2">
                        {unread && (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary-500" />
                        )}
                        {email.priority && (
                            <span
                                title={
                                    email.importanceReason ||
                                    "Ranked important by AI sorting"
                                }
                                className="flex shrink-0 items-center gap-1 rounded bg-warning-100 px-1.5 py-0.5 text-2xs font-medium text-warning-700"
                            >
                                <BoltIcon className="h-3 w-3" />
                                Priority
                            </span>
                        )}
                        {flagged && !onToggleFlag && (
                            <StarSolidIcon className="h-3.5 w-3.5 shrink-0 text-warning-500" />
                        )}
                        {isAnswered(email) && (
                            <ArrowUturnLeftIcon
                                className="h-3.5 w-3.5 shrink-0 text-content-subtle"
                                title="Replied"
                            />
                        )}
                        {email.hasAttachments && (
                            <PaperClipIcon className="h-3.5 w-3.5 shrink-0 text-content-subtle" />
                        )}
                        {showMailbox && (
                            <span className="truncate rounded bg-surface-sunken px-1.5 py-0.5 text-2xs font-medium text-content-subtle">
                                {email.mailbox}
                            </span>
                        )}
                        {email.category && !showMailbox && (
                            <span className="truncate text-2xs capitalize text-content-subtle">
                                {email.category}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default React.memo(MessageRow);
