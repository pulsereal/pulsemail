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
        <div style={style} className="px-1 py-px">
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
                    "group flex h-full cursor-pointer items-center gap-2 rounded-md border px-2 transition-colors",
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
                        className="h-4 w-4 shrink-0 rounded border-line-strong text-primary-600 focus:ring-primary-500"
                    />
                )}

                <span
                    className={clsx(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-2xs font-semibold",
                        avatarTone(sender)
                    )}
                >
                    {initialsFor(sender)}
                </span>

                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                        <p
                            className={clsx(
                                "min-w-0 flex-1 truncate text-sm leading-5",
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
                                    "-mr-0.5 shrink-0 rounded p-0.5 transition-colors hover:bg-surface-hover",
                                    flagged
                                        ? "text-warning-500"
                                        : "text-content-subtle opacity-0 focus:opacity-100 group-hover:opacity-100"
                                )}
                            >
                                {flagged ? (
                                    <StarSolidIcon className="h-3.5 w-3.5" />
                                ) : (
                                    <StarIcon className="h-3.5 w-3.5" />
                                )}
                            </button>
                        )}
                    </div>

                    <div className="flex items-center gap-1.5">
                        <p
                            className={clsx(
                                "min-w-0 flex-1 truncate text-sm leading-5",
                                unread
                                    ? "font-medium text-content"
                                    : "text-content-muted"
                            )}
                        >
                            {email.subject}
                        </p>
                        {email.priority && (
                            <BoltIcon
                                className="h-3.5 w-3.5 shrink-0 text-warning-500"
                                title={
                                    email.importanceReason ||
                                    "Ranked important by AI sorting"
                                }
                            />
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
                            <span className="max-w-[8rem] shrink-0 truncate rounded bg-surface-sunken px-1 text-2xs font-medium text-content-subtle">
                                {email.mailbox}
                            </span>
                        )}
                        {email.category && !showMailbox && (
                            <span className="max-w-[5rem] shrink-0 truncate text-2xs capitalize text-content-subtle">
                                {email.category}
                            </span>
                        )}
                        {unread && (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary-500" />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default React.memo(MessageRow);
