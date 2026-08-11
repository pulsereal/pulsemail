import React from "react";
import clsx from "clsx";

interface EmptyStateProps {
    icon?: React.ComponentType<{ className?: string }>;
    title: string;
    description?: React.ReactNode;
    action?: React.ReactNode;
    className?: string;
    compact?: boolean;
}

const EmptyState: React.FC<EmptyStateProps> = ({
    icon: Icon,
    title,
    description,
    action,
    className,
    compact,
}) => (
    <div
        className={clsx(
            "flex flex-col items-center justify-center text-center",
            compact ? "px-4 py-8" : "px-6 py-16",
            className
        )}
    >
        {Icon && (
            <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-sunken text-content-subtle">
                <Icon className="h-6 w-6" />
            </span>
        )}
        <h3 className="text-sm font-semibold text-content">{title}</h3>
        {description && (
            <p className="mt-1.5 max-w-sm text-sm text-content-muted">
                {description}
            </p>
        )}
        {action && <div className="mt-5">{action}</div>}
    </div>
);

export default EmptyState;
