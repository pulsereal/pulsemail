import React, { useCallback } from "react";
import { FixedSizeList, type ListChildComponentProps } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";
import { InboxIcon } from "@heroicons/react/24/outline";
import type { EmailSummary } from "../../types";
import MessageRow from "./MessageRow";
import EmptyState from "../common/EmptyState";
import ErrorState from "../common/ErrorState";
import { SkeletonList } from "../common/Skeleton";

const ROW_HEIGHT = 92;

interface MessageListProps {
    emails: EmailSummary[];
    selectedUid?: string | null;
    checkedUids?: Set<string>;
    onSelect: (email: EmailSummary) => void;
    onToggleCheck?: (uid: string) => void;
    onToggleFlag?: (email: EmailSummary) => void;
    showMailbox?: boolean;
    loading?: boolean;
    error?: unknown;
    onRetry?: () => void;
    emptyTitle?: string;
    emptyDescription?: string;
}

const MessageList: React.FC<MessageListProps> = ({
    emails,
    selectedUid,
    checkedUids,
    onSelect,
    onToggleCheck,
    onToggleFlag,
    showMailbox,
    loading,
    error,
    onRetry,
    emptyTitle = "No messages here",
    emptyDescription = "This folder is empty.",
}) => {
    const Row = useCallback(
        ({ index, style }: ListChildComponentProps) => {
            const email = emails[index];
            return (
                <MessageRow
                    style={style}
                    email={email}
                    selected={email.uid === selectedUid}
                    checked={checkedUids?.has(email.uid)}
                    onSelect={onSelect}
                    onToggleCheck={onToggleCheck}
                    onToggleFlag={onToggleFlag}
                    showMailbox={showMailbox}
                />
            );
        },
        [
            emails,
            selectedUid,
            checkedUids,
            onSelect,
            onToggleCheck,
            onToggleFlag,
            showMailbox,
        ]
    );

    if (error) {
        return <ErrorState error={error} onRetry={onRetry} compact />;
    }

    if (loading && emails.length === 0) {
        return <SkeletonList rows={6} className="p-4" />;
    }

    if (emails.length === 0) {
        return (
            <EmptyState
                icon={InboxIcon}
                title={emptyTitle}
                description={emptyDescription}
                compact
            />
        );
    }

    return (
        <div className="h-full">
            <AutoSizer>
                {({ height, width }) => (
                    <FixedSizeList
                        height={height}
                        width={width}
                        itemCount={emails.length}
                        itemSize={ROW_HEIGHT}
                        itemKey={(index) =>
                            `${emails[index].mailbox}:${emails[index].folder}:${emails[index].uid}`
                        }
                        overscanCount={6}
                        className="scrollbar-thin"
                    >
                        {Row}
                    </FixedSizeList>
                )}
            </AutoSizer>
        </div>
    );
};

export default MessageList;
