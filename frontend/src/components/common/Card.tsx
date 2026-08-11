import React from "react";
import clsx from "clsx";

interface CardProps {
    children: React.ReactNode;
    className?: string;
    padded?: boolean;
    as?: React.ElementType;
}

export const Card: React.FC<CardProps> = ({
    children,
    className,
    padded = true,
    as: Component = "div",
}) => (
    <Component
        className={clsx(
            "rounded-xl border border-line bg-surface shadow-soft",
            padded && "p-5",
            className
        )}
    >
        {children}
    </Component>
);

interface CardHeaderProps {
    title: React.ReactNode;
    description?: React.ReactNode;
    actions?: React.ReactNode;
    className?: string;
}

export const CardHeader: React.FC<CardHeaderProps> = ({
    title,
    description,
    actions,
    className,
}) => (
    <div
        className={clsx(
            "flex items-start justify-between gap-4 border-b border-line px-5 py-4",
            className
        )}
    >
        <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-content">
                {title}
            </h2>
            {description && (
                <p className="mt-0.5 text-sm text-content-muted">
                    {description}
                </p>
            )}
        </div>
        {actions && (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
    </div>
);

export default Card;
