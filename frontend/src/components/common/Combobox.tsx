import React, { Fragment, useMemo, useState } from "react";
import { Combobox as HeadlessCombobox, Transition } from "@headlessui/react";
import {
    CheckIcon,
    ChevronUpDownIcon,
    MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";

export interface ComboboxOption {
    value: string;
    label: string;
    description?: string;
    group?: string;
    badge?: React.ReactNode;
}

interface ComboboxProps {
    options: ComboboxOption[];
    value: string | null;
    onChange: (value: string) => void;
    placeholder?: string;
    searchPlaceholder?: string;
    emptyMessage?: string;
    disabled?: boolean;
    className?: string;
    buttonClassName?: string;
    renderTrigger?: (option: ComboboxOption | undefined) => React.ReactNode;
}

const Combobox: React.FC<ComboboxProps> = ({
    options,
    value,
    onChange,
    placeholder = "Select an option",
    searchPlaceholder = "Search…",
    emptyMessage = "No matches",
    disabled,
    className,
    buttonClassName,
    renderTrigger,
}) => {
    const [queryText, setQueryText] = useState("");

    const selected = useMemo(
        () => options.find((option) => option.value === value),
        [options, value]
    );

    const grouped = useMemo(() => {
        const term = queryText.trim().toLowerCase();
        const filtered = term
            ? options.filter(
                  (option) =>
                      option.label.toLowerCase().includes(term) ||
                      option.value.toLowerCase().includes(term) ||
                      (option.description || "").toLowerCase().includes(term)
              )
            : options;

        return filtered.reduce<Record<string, ComboboxOption[]>>(
            (groups, option) => {
                const key = option.group || "";
                groups[key] = groups[key] || [];
                groups[key].push(option);
                return groups;
            },
            {}
        );
    }, [options, queryText]);

    const groupNames = Object.keys(grouped);
    const hasResults = groupNames.some((name) => grouped[name].length > 0);

    return (
        <HeadlessCombobox
            value={value ?? ""}
            onChange={onChange}
            disabled={disabled}
        >
            <div className={clsx("relative", className)}>
                <HeadlessCombobox.Button
                    className={clsx(
                        "flex w-full items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2 text-left text-sm",
                        "transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60",
                        buttonClassName
                    )}
                >
                    {renderTrigger ? (
                        renderTrigger(selected)
                    ) : (
                        <span
                            className={clsx(
                                "min-w-0 flex-1 truncate",
                                selected
                                    ? "text-content"
                                    : "text-content-subtle"
                            )}
                        >
                            {selected?.label || placeholder}
                        </span>
                    )}
                    <ChevronUpDownIcon className="h-4 w-4 shrink-0 text-content-subtle" />
                </HeadlessCombobox.Button>

                <Transition
                    as={Fragment}
                    leave="transition ease-in duration-100"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                    afterLeave={() => setQueryText("")}
                >
                    <HeadlessCombobox.Options className="absolute z-40 mt-2 max-h-80 w-full min-w-[16rem] overflow-auto rounded-xl border border-line bg-surface-raised py-1 shadow-hard scrollbar-thin focus:outline-none">
                        <div className="sticky top-0 z-10 border-b border-line bg-surface-raised px-2 pb-2 pt-1">
                            <div className="relative">
                                <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-subtle" />
                                <HeadlessCombobox.Input
                                    autoFocus
                                    className="w-full rounded-lg border-line bg-surface py-1.5 pl-8 pr-3 text-sm text-content placeholder:text-content-subtle focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                                    placeholder={searchPlaceholder}
                                    displayValue={() => queryText}
                                    onChange={(event) =>
                                        setQueryText(event.target.value)
                                    }
                                />
                            </div>
                        </div>

                        {!hasResults && (
                            <p className="px-3 py-6 text-center text-sm text-content-subtle">
                                {emptyMessage}
                            </p>
                        )}

                        {groupNames.map((group) => (
                            <div key={group || "ungrouped"} className="py-1">
                                {group && (
                                    <p className="px-3 py-1 text-2xs font-semibold uppercase tracking-wide text-content-subtle">
                                        {group}
                                    </p>
                                )}
                                {grouped[group].map((option) => (
                                    <HeadlessCombobox.Option
                                        key={option.value}
                                        value={option.value}
                                        className={({ active }) =>
                                            clsx(
                                                "flex cursor-pointer items-center gap-2 px-3 py-2 text-sm",
                                                active
                                                    ? "bg-primary-50 text-primary-700"
                                                    : "text-content"
                                            )
                                        }
                                    >
                                        {({ selected: isSelected }) => (
                                            <>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate font-medium">
                                                        {option.label}
                                                    </span>
                                                    {option.description && (
                                                        <span className="block truncate text-xs text-content-subtle">
                                                            {option.description}
                                                        </span>
                                                    )}
                                                </span>
                                                {option.badge}
                                                {isSelected && (
                                                    <CheckIcon className="h-4 w-4 shrink-0 text-primary-600" />
                                                )}
                                            </>
                                        )}
                                    </HeadlessCombobox.Option>
                                ))}
                            </div>
                        ))}
                    </HeadlessCombobox.Options>
                </Transition>
            </div>
        </HeadlessCombobox>
    );
};

export default Combobox;
