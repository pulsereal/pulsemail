import React, { useMemo, useState } from "react";
import {
    ArchiveBoxIcon,
    DocumentTextIcon,
    EllipsisHorizontalIcon,
    ExclamationTriangleIcon,
    FolderIcon,
    FolderPlusIcon,
    InboxIcon,
    PaperAirplaneIcon,
    PencilIcon,
    TrashIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import type { MailFolder } from "../../types";
import { flattenFolders, isSystemFolder, sortFolders } from "../../utils/mail";
import Skeleton from "../common/Skeleton";
import Dropdown from "../common/Dropdown";

const SPECIAL_ICONS: Record<
    string,
    React.ComponentType<{ className?: string }>
> = {
    inbox: InboxIcon,
    sent: PaperAirplaneIcon,
    drafts: DocumentTextIcon,
    trash: TrashIcon,
    junk: ExclamationTriangleIcon,
    archive: ArchiveBoxIcon,
};

interface FolderRailProps {
    folders: MailFolder[];
    activeFolder: string;
    onSelect: (path: string) => void;
    onCreate?: (name: string) => void;
    onRename?: (folder: MailFolder) => void;
    onDelete?: (folder: MailFolder) => void;
    loading?: boolean;
    className?: string;
}

const FolderRail: React.FC<FolderRailProps> = ({
    folders,
    activeFolder,
    onSelect,
    onCreate,
    onRename,
    onDelete,
    loading,
    className,
}) => {
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState("");

    const items = useMemo(
        () => sortFolders(flattenFolders(folders)),
        [folders]
    );

    const commit = () => {
        const trimmed = name.trim();
        if (trimmed) onCreate?.(trimmed);
        setName("");
        setCreating(false);
    };

    return (
        <div className={clsx("space-y-0.5", className)}>
            {loading &&
                items.length === 0 &&
                Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton key={index} className="h-9 w-full" />
                ))}

            {items.map((folder) => {
                const Icon = folder.specialUse
                    ? SPECIAL_ICONS[folder.specialUse] || FolderIcon
                    : FolderIcon;
                const active = folder.path === activeFolder;
                const manageable =
                    (onRename || onDelete) && !isSystemFolder(folder);

                return (
                    <div
                        key={folder.path}
                        className={clsx(
                            "group flex items-center rounded-lg",
                            active ? "bg-primary-100" : "hover:bg-surface-hover"
                        )}
                    >
                        <button
                            type="button"
                            disabled={!folder.selectable}
                            onClick={() => onSelect(folder.path)}
                            style={{
                                paddingLeft: `${0.75 + folder.depth * 0.75}rem`,
                            }}
                            className={clsx(
                                "flex min-w-0 flex-1 items-center gap-2.5 py-2 pr-1 text-sm transition-colors",
                                active
                                    ? "font-medium text-primary-700"
                                    : "text-content-muted group-hover:text-content",
                                !folder.selectable &&
                                    "cursor-default opacity-60"
                            )}
                        >
                            <Icon className="h-4.5 w-4 shrink-0" />
                            <span className="min-w-0 flex-1 truncate text-left">
                                {folder.displayName}
                            </span>
                            {Boolean(folder.unseen) && (
                                <span
                                    className={clsx(
                                        "rounded-full px-1.5 py-0.5 text-2xs font-semibold",
                                        active
                                            ? "bg-primary-200 text-primary-800"
                                            : "bg-surface-sunken text-content-subtle"
                                    )}
                                >
                                    {folder.unseen}
                                </span>
                            )}
                        </button>

                        {manageable && (
                            <Dropdown
                                className="shrink-0 pr-1"
                                trigger={
                                    <button
                                        type="button"
                                        aria-label={`Manage ${folder.displayName}`}
                                        className="rounded p-1 text-content-subtle opacity-0 transition-opacity hover:bg-surface-hover hover:text-content focus:opacity-100 group-hover:opacity-100"
                                    >
                                        <EllipsisHorizontalIcon className="h-4 w-4" />
                                    </button>
                                }
                                items={[
                                    ...(onRename
                                        ? [
                                              {
                                                  id: "rename",
                                                  label: "Rename",
                                                  icon: PencilIcon,
                                                  onSelect: () =>
                                                      onRename(folder),
                                              },
                                          ]
                                        : []),
                                    ...(onDelete
                                        ? [
                                              {
                                                  id: "delete",
                                                  label: "Delete",
                                                  icon: TrashIcon,
                                                  danger: true,
                                                  onSelect: () =>
                                                      onDelete(folder),
                                              },
                                          ]
                                        : []),
                                ]}
                            />
                        )}
                    </div>
                );
            })}

            {onCreate &&
                (creating ? (
                    <input
                        autoFocus
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        onBlur={commit}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") commit();
                            if (event.key === "Escape") {
                                setName("");
                                setCreating(false);
                            }
                        }}
                        placeholder="Folder name"
                        aria-label="New folder name"
                        className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-content placeholder:text-content-subtle focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                ) : (
                    <button
                        type="button"
                        onClick={() => setCreating(true)}
                        className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-content-subtle transition-colors hover:bg-surface-hover hover:text-content"
                    >
                        <FolderPlusIcon className="h-4 w-4 shrink-0" />
                        New folder
                    </button>
                ))}
        </div>
    );
};

export default FolderRail;
