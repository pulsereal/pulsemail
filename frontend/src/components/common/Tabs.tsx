import React from "react";
import clsx from "clsx";

export interface TabItem<T extends string = string> {
    id: T;
    label: string;
    icon?: React.ComponentType<{ className?: string }>;
    count?: number;
}

interface TabsProps<T extends string> {
    tabs: TabItem<T>[];
    value: T;
    onChange: (id: T) => void;
    variant?: "underline" | "pills";
    className?: string;
}

function Tabs<T extends string>({
    tabs,
    value,
    onChange,
    variant = "underline",
    className,
}: TabsProps<T>) {
    const isPills = variant === "pills";

    return (
        <div
            role="tablist"
            className={clsx(
                "flex items-center gap-1 overflow-x-auto scrollbar-thin",
                isPills
                    ? "rounded-lg bg-surface-sunken p-1"
                    : "border-b border-line",
                className
            )}
        >
            {tabs.map((tab) => {
                const active = tab.id === value;
                const Icon = tab.icon;

                return (
                    <button
                        key={tab.id}
                        role="tab"
                        type="button"
                        aria-selected={active}
                        onClick={() => onChange(tab.id)}
                        className={clsx(
                            "flex shrink-0 items-center gap-2 whitespace-nowrap text-sm font-medium transition-colors",
                            isPills
                                ? clsx(
                                      "rounded-md px-3 py-1.5",
                                      active
                                          ? "bg-surface text-content shadow-soft"
                                          : "text-content-muted hover:text-content"
                                  )
                                : clsx(
                                      "-mb-px border-b-2 px-3 py-2.5",
                                      active
                                          ? "border-primary-500 text-primary-600"
                                          : "border-transparent text-content-muted hover:border-line-strong hover:text-content"
                                  )
                        )}
                    >
                        {Icon && <Icon className="h-4 w-4" />}
                        {tab.label}
                        {typeof tab.count === "number" && (
                            <span
                                className={clsx(
                                    "rounded-full px-1.5 py-0.5 text-2xs font-semibold",
                                    active
                                        ? "bg-primary-100 text-primary-700"
                                        : "bg-surface-sunken text-content-subtle"
                                )}
                            >
                                {tab.count}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

export default Tabs;
