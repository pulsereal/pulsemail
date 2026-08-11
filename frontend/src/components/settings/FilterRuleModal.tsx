import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import toast from "react-hot-toast";
import { PlusIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { emailAPI, mailboxAPI } from "../../services/api";
import { useAuthStore } from "../../stores/authStore";
import { flattenFolders, sortFolders } from "../../utils/mail";
import type {
    FilterAction,
    FilterActionType,
    FilterCondition,
    FilterField,
    FilterMatch,
    MailFilter,
    MailFolder,
} from "../../types";
import Button from "../common/Button";
import Checkbox from "../common/Checkbox";
import Input from "../common/Input";
import Modal from "../common/Modal";
import Select from "../common/Select";
import Textarea from "../common/Textarea";

const FIELD_OPTIONS: { value: FilterField; label: string }[] = [
    { value: "from", label: "From" },
    { value: "to", label: "To" },
    { value: "subject", label: "Subject" },
    { value: "body", label: "Body" },
    { value: "header", label: "Header" },
];

const MATCH_OPTIONS: { value: FilterMatch; label: string }[] = [
    { value: "contains", label: "contains" },
    { value: "is", label: "is" },
    { value: "matches", label: "matches (wildcards)" },
];

const ACTION_OPTIONS: { value: FilterActionType; label: string }[] = [
    { value: "fileinto", label: "File into" },
    { value: "copy", label: "File a copy into" },
    { value: "redirect", label: "Redirect to" },
    { value: "discard", label: "Discard" },
    { value: "reject", label: "Reject with reason" },
    { value: "keep", label: "Keep" },
    { value: "flag", label: "Add flag" },
    { value: "markread", label: "Mark as read" },
];

const FLAG_OPTIONS = [
    { value: "\\Flagged", label: "Flagged (starred)" },
    { value: "\\Seen", label: "Seen (read)" },
    { value: "\\Answered", label: "Answered" },
];

const NEW_FOLDER = "__new_folder__";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let rowSequence = 0;
const nextKey = () => {
    rowSequence += 1;
    return `row-${rowSequence}`;
};

type DraftCondition = FilterCondition & { key: string };
type DraftAction = FilterAction & { key: string; customFolder?: boolean };

const emptyCondition = (): DraftCondition => ({
    key: nextKey(),
    field: "from",
    match: "contains",
    value: "",
});

const emptyAction = (): DraftAction => ({
    key: nextKey(),
    type: "fileinto",
    folder: "",
});

/** Drop the UI-only bookkeeping and any field the chosen action type ignores. */
const serialiseAction = (action: DraftAction): FilterAction => {
    switch (action.type) {
        case "fileinto":
        case "copy":
            return { type: action.type, folder: (action.folder || "").trim() };
        case "redirect":
            return { type: action.type, to: (action.to || "").trim() };
        case "reject":
            return { type: action.type, reason: (action.reason || "").trim() };
        case "flag":
            return { type: action.type, flag: action.flag || "\\Flagged" };
        default:
            return { type: action.type };
    }
};

const serialiseCondition = (condition: DraftCondition): FilterCondition => ({
    field: condition.field,
    match: condition.field === "body" ? "contains" : condition.match,
    value: condition.value.trim(),
    ...(condition.field === "header"
        ? { header: (condition.header || "").trim() }
        : {}),
    ...(condition.negate ? { negate: true } : {}),
});

interface FilterRuleModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** The rule being edited, or null to create a new one. */
    rule: MailFilter | null;
    nextPriority: number;
}

const FilterRuleModal: React.FC<FilterRuleModalProps> = ({
    isOpen,
    onClose,
    rule,
    nextPriority,
}) => {
    const queryClient = useQueryClient();
    const activeMailbox = useAuthStore((state) => state.activeMailbox);
    const ownEmail = useAuthStore((state) => state.user?.email ?? null);
    const scope = activeMailbox || ownEmail || "self";

    const [name, setName] = useState("");
    const [match, setMatch] = useState<"all" | "any">("all");
    const [conditions, setConditions] = useState<DraftCondition[]>([]);
    const [actions, setActions] = useState<DraftAction[]>([]);
    const [stopProcessing, setStopProcessing] = useState(true);
    const [active, setActive] = useState(true);
    const [formError, setFormError] = useState<{
        name?: string;
        conditions?: string;
        actions?: string;
    }>({});
    const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

    const foldersQuery = useQuery(
        ["folders", scope],
        () => emailAPI.getFolders().then((response) => response.data),
        { staleTime: 5 * 60 * 1000, enabled: isOpen }
    );

    const folderOptions = useMemo(() => {
        const folders: MailFolder[] = foldersQuery.data?.folders ?? [];
        return sortFolders(flattenFolders(folders))
            .filter((folder) => folder.selectable)
            .map((folder) => ({
                value: folder.path,
                label: `${"\u00a0\u00a0".repeat(folder.depth)}${folder.displayName || folder.name}`,
            }));
    }, [foldersQuery.data]);

    const knownFolders = useMemo(
        () => new Set(folderOptions.map((option) => option.value)),
        [folderOptions]
    );

    useEffect(() => {
        if (!isOpen) return;

        setName(rule?.name ?? "");
        setMatch(rule?.match ?? "all");
        setConditions(
            rule?.conditions?.length
                ? rule.conditions.map((condition) => ({
                      ...condition,
                      key: nextKey(),
                  }))
                : [emptyCondition()]
        );
        setActions(
            rule?.actions?.length
                ? rule.actions.map((action) => ({ ...action, key: nextKey() }))
                : [emptyAction()]
        );
        setStopProcessing(rule?.stopProcessing ?? true);
        setActive(rule?.active ?? true);
        setFormError({});
        setRowErrors({});
    }, [isOpen, rule]);

    const patchCondition = (key: string, patch: Partial<DraftCondition>) => {
        setConditions((current) =>
            current.map((condition) =>
                condition.key === key ? { ...condition, ...patch } : condition
            )
        );
        setRowErrors((current) => ({ ...current, [key]: "" }));
    };

    const patchAction = (key: string, patch: Partial<DraftAction>) => {
        setActions((current) =>
            current.map((action) =>
                action.key === key ? { ...action, ...patch } : action
            )
        );
        setRowErrors((current) => ({ ...current, [key]: "" }));
    };

    const validate = () => {
        const errors: typeof formError = {};
        const rows: Record<string, string> = {};

        if (!name.trim()) errors.name = "Give this filter a name.";

        conditions.forEach((condition) => {
            if (!condition.value.trim()) {
                rows[condition.key] = "Enter a value to match on.";
            } else if (
                condition.field === "header" &&
                !(condition.header || "").trim()
            ) {
                rows[condition.key] = "Enter the header name.";
            }
        });

        if (!conditions.some((condition) => condition.value.trim())) {
            errors.conditions = "Add at least one condition with a value.";
        }

        actions.forEach((action) => {
            if (action.type === "fileinto" || action.type === "copy") {
                if (!(action.folder || "").trim()) {
                    rows[action.key] = "Choose or name a destination folder.";
                }
            } else if (action.type === "redirect") {
                const to = (action.to || "").trim();
                if (!to) rows[action.key] = "Enter a destination address.";
                else if (!EMAIL_PATTERN.test(to))
                    rows[action.key] = "Enter a valid email address.";
            } else if (action.type === "reject") {
                if (!(action.reason || "").trim()) {
                    rows[action.key] = "Enter the reason sent back to senders.";
                }
            } else if (action.type === "flag" && !action.flag) {
                rows[action.key] = "Choose a flag.";
            }
        });

        if (actions.length === 0) {
            errors.actions = "Add at least one action.";
        } else if (actions.some((action) => rows[action.key])) {
            errors.actions = "Complete the highlighted actions.";
        }

        setFormError(errors);
        setRowErrors(rows);

        return (
            Object.keys(errors).length === 0 &&
            Object.values(rows).every((message) => !message)
        );
    };

    const save = useMutation(
        (payload: Omit<MailFilter, "id">) =>
            rule?.id
                ? mailboxAPI.updateFilter(rule.id, payload)
                : mailboxAPI.createFilter(payload),
        {
            onSuccess: () => {
                queryClient.invalidateQueries("mailbox-filters");
                queryClient.invalidateQueries("mailbox-filter-script");
                toast.success(rule?.id ? "Filter updated" : "Filter created");
                onClose();
            },
        }
    );

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        if (!validate()) return;

        save.mutate({
            name: name.trim(),
            priority: rule?.priority ?? nextPriority,
            match,
            conditions: conditions
                .filter((condition) => condition.value.trim())
                .map(serialiseCondition),
            actions: actions.map(serialiseAction),
            stopProcessing,
            active,
        });
    };

    const renderFolderField = (action: DraftAction) => {
        const usesCustom =
            action.customFolder ||
            Boolean(action.folder && !knownFolders.has(action.folder));

        return (
            <div className="space-y-2">
                <Select
                    aria-label="Destination folder"
                    options={[
                        { value: "", label: "Select a folder…" },
                        ...folderOptions,
                        { value: NEW_FOLDER, label: "New folder…" },
                    ]}
                    value={usesCustom ? NEW_FOLDER : action.folder || ""}
                    onChange={(event) =>
                        patchAction(action.key, {
                            customFolder: event.target.value === NEW_FOLDER,
                            folder:
                                event.target.value === NEW_FOLDER
                                    ? ""
                                    : event.target.value,
                        })
                    }
                />
                {usesCustom && (
                    <Input
                        aria-label="New folder name"
                        placeholder="Newsletters"
                        value={action.folder || ""}
                        onChange={(event) =>
                            patchAction(action.key, {
                                folder: event.target.value,
                            })
                        }
                        helpText="Created automatically the first time the filter runs."
                    />
                )}
            </div>
        );
    };

    const renderActionField = (action: DraftAction) => {
        switch (action.type) {
            case "fileinto":
            case "copy":
                return renderFolderField(action);
            case "redirect":
                return (
                    <Input
                        aria-label="Redirect to"
                        type="email"
                        placeholder="someone@example.com"
                        value={action.to || ""}
                        onChange={(event) =>
                            patchAction(action.key, { to: event.target.value })
                        }
                    />
                );
            case "reject":
                return (
                    <Textarea
                        aria-label="Rejection reason"
                        rows={2}
                        placeholder="This address no longer accepts mail."
                        value={action.reason || ""}
                        onChange={(event) =>
                            patchAction(action.key, {
                                reason: event.target.value,
                            })
                        }
                    />
                );
            case "flag":
                return (
                    <Select
                        aria-label="Flag"
                        options={FLAG_OPTIONS}
                        value={action.flag || "\\Flagged"}
                        onChange={(event) =>
                            patchAction(action.key, {
                                flag: event.target.value,
                            })
                        }
                    />
                );
            default:
                return null;
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={rule?.id ? "Edit filter" : "New filter"}
            description="Conditions are evaluated on delivery, before the message reaches your inbox."
            size="xl"
            actions={
                <>
                    <Button variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        form="filter-rule-form"
                        loading={save.isLoading}
                    >
                        {rule?.id ? "Save filter" : "Create filter"}
                    </Button>
                </>
            }
        >
            <form
                id="filter-rule-form"
                onSubmit={handleSubmit}
                className="space-y-6"
            >
                <div className="grid gap-4 sm:grid-cols-2">
                    <Input
                        label="Filter name"
                        placeholder="Newsletters"
                        value={name}
                        onChange={(event) => {
                            setName(event.target.value);
                            setFormError((current) => ({
                                ...current,
                                name: undefined,
                            }));
                        }}
                        error={formError.name}
                    />
                    <Select
                        label="Run this filter when"
                        options={[
                            { value: "all", label: "All conditions match" },
                            { value: "any", label: "Any condition matches" },
                        ]}
                        value={match}
                        onChange={(event) =>
                            setMatch(event.target.value as "all" | "any")
                        }
                    />
                </div>

                <section className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-content">
                            Conditions
                        </h4>
                        <Button
                            variant="ghost"
                            size="xs"
                            icon={<PlusIcon className="h-4 w-4" />}
                            onClick={() =>
                                setConditions((current) => [
                                    ...current,
                                    emptyCondition(),
                                ])
                            }
                        >
                            Add condition
                        </Button>
                    </div>

                    <div className="space-y-3">
                        {conditions.map((condition) => (
                            <div
                                key={condition.key}
                                className="rounded-lg border border-line bg-surface-sunken p-3"
                            >
                                <div className="flex items-start gap-2">
                                    <div className="grid flex-1 gap-2 sm:grid-cols-3">
                                        <Select
                                            aria-label="Field"
                                            options={FIELD_OPTIONS}
                                            value={condition.field}
                                            onChange={(event) => {
                                                const field = event.target
                                                    .value as FilterField;
                                                patchCondition(condition.key, {
                                                    field,
                                                    match:
                                                        field === "body"
                                                            ? "contains"
                                                            : condition.match,
                                                });
                                            }}
                                        />
                                        <Select
                                            aria-label="Match type"
                                            options={MATCH_OPTIONS}
                                            disabled={
                                                condition.field === "body"
                                            }
                                            value={
                                                condition.field === "body"
                                                    ? "contains"
                                                    : condition.match
                                            }
                                            onChange={(event) =>
                                                patchCondition(condition.key, {
                                                    match: event.target
                                                        .value as FilterMatch,
                                                })
                                            }
                                        />
                                        <Input
                                            aria-label="Value"
                                            placeholder="Value"
                                            value={condition.value}
                                            onChange={(event) =>
                                                patchCondition(condition.key, {
                                                    value: event.target.value,
                                                })
                                            }
                                        />
                                        {condition.field === "header" && (
                                            <Input
                                                aria-label="Header name"
                                                placeholder="X-Spam-Flag"
                                                value={condition.header || ""}
                                                onChange={(event) =>
                                                    patchCondition(
                                                        condition.key,
                                                        {
                                                            header: event.target
                                                                .value,
                                                        }
                                                    )
                                                }
                                            />
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        aria-label="Remove condition"
                                        className="rounded-lg p-2 text-content-subtle transition-colors hover:bg-surface-hover hover:text-danger-600"
                                        onClick={() =>
                                            setConditions((current) =>
                                                current.filter(
                                                    (item) =>
                                                        item.key !==
                                                        condition.key
                                                )
                                            )
                                        }
                                    >
                                        <XMarkIcon className="h-4 w-4" />
                                    </button>
                                </div>

                                <div className="mt-3">
                                    <Checkbox
                                        label="Does not match"
                                        checked={Boolean(condition.negate)}
                                        onChange={(event) =>
                                            patchCondition(condition.key, {
                                                negate: event.target.checked,
                                            })
                                        }
                                    />
                                </div>

                                {rowErrors[condition.key] && (
                                    <p className="mt-2 text-sm text-danger-600">
                                        {rowErrors[condition.key]}
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>

                    {conditions.length === 0 && (
                        <p className="text-sm text-content-subtle">
                            No conditions yet.
                        </p>
                    )}
                    {formError.conditions && (
                        <p className="text-sm text-danger-600">
                            {formError.conditions}
                        </p>
                    )}
                </section>

                <section className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-content">
                            Actions
                        </h4>
                        <Button
                            variant="ghost"
                            size="xs"
                            icon={<PlusIcon className="h-4 w-4" />}
                            onClick={() =>
                                setActions((current) => [
                                    ...current,
                                    emptyAction(),
                                ])
                            }
                        >
                            Add action
                        </Button>
                    </div>

                    <div className="space-y-3">
                        {actions.map((action) => (
                            <div
                                key={action.key}
                                className="rounded-lg border border-line bg-surface-sunken p-3"
                            >
                                <div className="flex items-start gap-2">
                                    <div className="grid flex-1 gap-2 sm:grid-cols-2">
                                        <Select
                                            aria-label="Action"
                                            options={ACTION_OPTIONS}
                                            value={action.type}
                                            onChange={(event) =>
                                                patchAction(action.key, {
                                                    type: event.target
                                                        .value as FilterActionType,
                                                    folder: "",
                                                    to: "",
                                                    reason: "",
                                                    flag: undefined,
                                                    customFolder: false,
                                                })
                                            }
                                        />
                                        {renderActionField(action)}
                                    </div>
                                    <button
                                        type="button"
                                        aria-label="Remove action"
                                        className="rounded-lg p-2 text-content-subtle transition-colors hover:bg-surface-hover hover:text-danger-600"
                                        onClick={() =>
                                            setActions((current) =>
                                                current.filter(
                                                    (item) =>
                                                        item.key !== action.key
                                                )
                                            )
                                        }
                                    >
                                        <XMarkIcon className="h-4 w-4" />
                                    </button>
                                </div>

                                {rowErrors[action.key] && (
                                    <p className="mt-2 text-sm text-danger-600">
                                        {rowErrors[action.key]}
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>

                    {formError.actions && (
                        <p className="text-sm text-danger-600">
                            {formError.actions}
                        </p>
                    )}
                </section>

                <div className="space-y-3 border-t border-line pt-4">
                    <Checkbox
                        label="Stop processing further rules"
                        description="Later filters are skipped once this one matches."
                        checked={stopProcessing}
                        onChange={(event) =>
                            setStopProcessing(event.target.checked)
                        }
                    />
                    <Checkbox
                        label="Filter is active"
                        description="Inactive filters stay saved but are left out of the Sieve script."
                        checked={active}
                        onChange={(event) => setActive(event.target.checked)}
                    />
                </div>
            </form>
        </Modal>
    );
};

export default FilterRuleModal;
