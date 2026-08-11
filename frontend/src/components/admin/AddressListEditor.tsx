import React, { useState } from "react";
import { PlusIcon, XMarkIcon } from "@heroicons/react/24/outline";
import Button from "../common/Button";
import Input from "../common/Input";

export interface AddressListEditorProps {
    value: string[];
    onChange: (next: string[]) => void;
    label?: string;
    placeholder?: string;
    description?: string;
    disabled?: boolean;
}

const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const SEPARATORS = /[\s,;]+/;

const AddressListEditor: React.FC<AddressListEditorProps> = ({
    value,
    onChange,
    label,
    placeholder = "name@example.com",
    description,
    disabled,
}) => {
    const [draft, setDraft] = useState("");
    const [error, setError] = useState<string | null>(null);

    const commit = (raw: string) => {
        const entries = raw.split(SEPARATORS).filter(Boolean);
        if (entries.length === 0) {
            setDraft("");
            setError(null);
            return;
        }

        const accepted: string[] = [];
        const rejected: string[] = [];
        let reason: string | null = null;

        entries.forEach((entry) => {
            const address = entry.toLowerCase();

            if (!EMAIL_PATTERN.test(address)) {
                rejected.push(entry);
                reason = reason ?? `"${entry}" is not a valid email address`;
                return;
            }
            if (
                value.some((existing) => existing.toLowerCase() === address) ||
                accepted.includes(address)
            ) {
                rejected.push(entry);
                reason = reason ?? `"${entry}" is already in the list`;
                return;
            }

            accepted.push(address);
        });

        if (accepted.length > 0) onChange([...value, ...accepted]);
        setDraft(rejected.join(", "));
        setError(reason);
    };

    const remove = (address: string) => {
        onChange(value.filter((existing) => existing !== address));
        setError(null);
    };

    return (
        <div className="space-y-2">
            {label && (
                <span className="block text-sm font-medium text-content">
                    {label}
                </span>
            )}
            {description && (
                <p className="text-sm text-content-subtle">{description}</p>
            )}

            {value.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                    {value.map((address) => (
                        <li
                            key={address}
                            className="inline-flex items-center gap-1.5 rounded-full bg-surface-sunken py-1 pl-3 pr-1.5 text-sm text-content"
                        >
                            <span className="truncate">{address}</span>
                            <button
                                type="button"
                                disabled={disabled}
                                onClick={() => remove(address)}
                                aria-label={`Remove ${address}`}
                                className="rounded-full p-0.5 text-content-subtle transition-colors hover:bg-surface-hover hover:text-danger-600 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <XMarkIcon className="h-3.5 w-3.5" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            <div className="flex items-start gap-2">
                <Input
                    value={draft}
                    disabled={disabled}
                    placeholder={placeholder}
                    error={error ?? undefined}
                    onChange={(event) => {
                        const next = event.target.value;
                        // Typing a separator or pasting a list commits eagerly.
                        if (SEPARATORS.test(next)) {
                            commit(next);
                            return;
                        }
                        setDraft(next);
                        setError(null);
                    }}
                    onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        commit(draft);
                    }}
                    onBlur={() => commit(draft)}
                />
                <Button
                    variant="outline"
                    disabled={disabled || draft.trim().length === 0}
                    onClick={() => commit(draft)}
                    icon={<PlusIcon className="h-4 w-4" />}
                >
                    Add
                </Button>
            </div>
        </div>
    );
};

export default AddressListEditor;
