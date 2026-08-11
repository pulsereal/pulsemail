import React, { useMemo } from "react";
import {
    ArrowPathIcon,
    BoltIcon,
    ExclamationTriangleIcon,
    EnvelopeOpenIcon,
    FolderArrowDownIcon,
    MagnifyingGlassIcon,
    StarIcon,
    TrashIcon,
    XMarkIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import type { MailFolder } from "../../types";
import { moveTargets } from "../../utils/mail";
import Button from "../common/Button";
import Input from "../common/Input";
import Select from "../common/Select";
import Dropdown from "../common/Dropdown";

interface MailToolbarProps {
    title: string;
    count?: number;
    search: string;
    onSearchChange: (value: string) => void;
    onSearchSubmit: () => void;
    onRefresh: () => void;
    refreshing?: boolean;
    unreadOnly: boolean;
    onUnreadOnlyChange: (value: boolean) => void;
    category: string;
    onCategoryChange: (value: string) => void;
    /** Omitted when AI sorting is switched off server-side. */
    priorityOnly?: boolean;
    onPriorityOnlyChange?: (value: boolean) => void;
    selectedCount: number;
    allSelected?: boolean;
    onToggleSelectAll?: () => void;
    onClearSelection: () => void;
    onBulkMarkRead: () => void;
    onBulkDelete: () => void;
    onBulkFlag?: () => void;
    onBulkSpam?: () => void;
    onBulkMove?: (targetFolder: string) => void;
    folders?: MailFolder[];
    currentFolder?: string;
}

// Must match the categories the classifier is allowed to return, otherwise the
// filter silently matches nothing.
const CATEGORIES = [
    { value: "", label: "All categories" },
    { value: "important", label: "Important" },
    { value: "work", label: "Work" },
    { value: "personal", label: "Personal" },
    { value: "promotional", label: "Promotional" },
    { value: "social", label: "Social" },
    { value: "automated", label: "Automated" },
    { value: "spam", label: "Spam" },
    { value: "other", label: "Other" },
];

const MailToolbar: React.FC<MailToolbarProps> = ({
    title,
    count,
    search,
    onSearchChange,
    onSearchSubmit,
    onRefresh,
    refreshing,
    unreadOnly,
    onUnreadOnlyChange,
    category,
    onCategoryChange,
    priorityOnly,
    onPriorityOnlyChange,
    selectedCount,
    allSelected,
    onToggleSelectAll,
    onClearSelection,
    onBulkMarkRead,
    onBulkDelete,
    onBulkFlag,
    onBulkSpam,
    onBulkMove,
    folders = [],
    currentFolder = "INBOX",
}) => {
    const moveItems = useMemo(() => {
        if (!onBulkMove) return [];
        return moveTargets(folders, currentFolder).map((folder) => ({
            id: `bulk-move-${folder.path}`,
            label: folder.displayName,
            onSelect: () => onBulkMove(folder.path),
        }));
    }, [folders, currentFolder, onBulkMove]);

    return (
        <div className="shrink-0 border-b border-line px-4 py-3">
            <div className="flex items-center justify-between gap-3">
                <h2 className="truncate text-sm font-semibold text-content">
                    {title}
                    {typeof count === "number" && (
                        <span className="ml-2 font-normal text-content-subtle">
                            {count}
                        </span>
                    )}
                </h2>
                <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Refresh"
                    loading={refreshing}
                    onClick={onRefresh}
                    icon={<ArrowPathIcon className="h-4 w-4" />}
                />
            </div>

            <form
                className="mt-3"
                onSubmit={(event) => {
                    event.preventDefault();
                    onSearchSubmit();
                }}
            >
                <Input
                    type="search"
                    value={search}
                    onChange={(event) => onSearchChange(event.target.value)}
                    placeholder="Search mail"
                    aria-label="Search mail"
                    icon={<MagnifyingGlassIcon className="h-4 w-4" />}
                />
            </form>

            <div className="mt-3 flex items-center gap-2">
                {onToggleSelectAll && (
                    <input
                        type="checkbox"
                        checked={Boolean(allSelected)}
                        onChange={onToggleSelectAll}
                        aria-label="Select all messages"
                        className="h-4 w-4 shrink-0 rounded border-line-strong text-primary-600 focus:ring-primary-500"
                    />
                )}
                <Select
                    value={category}
                    onChange={(event) => onCategoryChange(event.target.value)}
                    options={CATEGORIES}
                    aria-label="Filter by category"
                    className="text-xs"
                />
                <Button
                    variant={unreadOnly ? "primary" : "outline"}
                    size="xs"
                    className="shrink-0"
                    onClick={() => onUnreadOnlyChange(!unreadOnly)}
                >
                    Unread
                </Button>
                {onPriorityOnlyChange && (
                    <Button
                        variant={priorityOnly ? "primary" : "outline"}
                        size="xs"
                        className="shrink-0"
                        title="Show only mail the AI ranked as important"
                        onClick={() => onPriorityOnlyChange(!priorityOnly)}
                        icon={<BoltIcon className="h-3.5 w-3.5" />}
                    >
                        Priority
                    </Button>
                )}
            </div>

            {selectedCount > 0 && (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-primary-50 px-2.5 py-1.5">
                    <span className="shrink-0 text-xs font-medium text-primary-800">
                        {selectedCount} selected
                    </span>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="xs"
                            aria-label="Mark selected as read"
                            title="Mark as read"
                            onClick={onBulkMarkRead}
                            icon={<EnvelopeOpenIcon className="h-3.5 w-3.5" />}
                        />
                        {onBulkFlag && (
                            <Button
                                variant="ghost"
                                size="xs"
                                aria-label="Star selected"
                                title="Star"
                                onClick={onBulkFlag}
                                icon={<StarIcon className="h-3.5 w-3.5" />}
                            />
                        )}
                        {moveItems.length > 0 && (
                            <Dropdown
                                trigger={
                                    <Button
                                        variant="ghost"
                                        size="xs"
                                        aria-label="Move selected"
                                        title="Move to folder"
                                        icon={
                                            <FolderArrowDownIcon className="h-3.5 w-3.5" />
                                        }
                                    />
                                }
                                items={moveItems}
                                menuClassName="max-h-72 overflow-y-auto scrollbar-thin"
                            />
                        )}
                        {onBulkSpam && (
                            <Button
                                variant="ghost"
                                size="xs"
                                aria-label="Report selected as spam"
                                title="Report as spam"
                                onClick={onBulkSpam}
                                icon={
                                    <ExclamationTriangleIcon className="h-3.5 w-3.5" />
                                }
                            />
                        )}
                        <Button
                            variant="ghost"
                            size="xs"
                            aria-label="Delete selected"
                            title="Delete"
                            onClick={onBulkDelete}
                            icon={<TrashIcon className="h-3.5 w-3.5" />}
                        />
                        <Button
                            variant="ghost"
                            size="xs"
                            aria-label="Clear selection"
                            title="Clear selection"
                            onClick={onClearSelection}
                            icon={<XMarkIcon className="h-3.5 w-3.5" />}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

/** Pager for the message list; IMAP paging is offset based, not cursor based. */
export const MailPager: React.FC<{
    offset: number;
    pageSize: number;
    shown: number;
    total?: number;
    onChange: (offset: number) => void;
    disabled?: boolean;
}> = ({ offset, pageSize, shown, total, onChange, disabled }) => {
    const hasPrevious = offset > 0;
    const hasNext =
        typeof total === "number" ? offset + shown < total : shown === pageSize;

    if (!hasPrevious && !hasNext) return null;

    return (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line px-4 py-2">
            <span className={clsx("text-xs text-content-subtle")}>
                {shown === 0
                    ? "No messages"
                    : `${offset + 1}–${offset + shown}${
                          typeof total === "number" ? ` of ${total}` : ""
                      }`}
            </span>
            <div className="flex items-center gap-1">
                <Button
                    variant="outline"
                    size="xs"
                    disabled={!hasPrevious || disabled}
                    onClick={() => onChange(Math.max(0, offset - pageSize))}
                >
                    Previous
                </Button>
                <Button
                    variant="outline"
                    size="xs"
                    disabled={!hasNext || disabled}
                    onClick={() => onChange(offset + pageSize)}
                >
                    Next
                </Button>
            </div>
        </div>
    );
};

export default MailToolbar;
