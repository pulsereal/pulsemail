import React from "react";
import clsx from "clsx";

type BadgeVariant =
    "default" | "success" | "warning" | "danger" | "info" | "outline";

interface BadgeProps {
    children: React.ReactNode;
    variant?: BadgeVariant;
    size?: "xs" | "sm" | "md";
    dot?: boolean;
    className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
    default: "bg-surface-sunken text-content-muted",
    success: "bg-success-100 text-success-700",
    warning: "bg-warning-100 text-warning-700",
    danger: "bg-danger-100 text-danger-700",
    info: "bg-primary-100 text-primary-700",
    outline: "border border-line-strong text-content-muted",
};

const dotClasses: Record<BadgeVariant, string> = {
    default: "bg-content-subtle",
    success: "bg-success-500",
    warning: "bg-warning-500",
    danger: "bg-danger-500",
    info: "bg-primary-500",
    outline: "bg-content-subtle",
};

const sizeClasses = {
    xs: "px-1.5 py-0.5 text-2xs gap-1",
    sm: "px-2 py-0.5 text-xs gap-1.5",
    md: "px-2.5 py-1 text-sm gap-1.5",
};

const Badge: React.FC<BadgeProps> = ({
    children,
    variant = "default",
    size = "sm",
    dot,
    className,
}) => (
    <span
        className={clsx(
            "inline-flex items-center rounded-full font-medium",
            variantClasses[variant],
            sizeClasses[size],
            className
        )}
    >
        {dot && (
            <span
                className={clsx(
                    "h-1.5 w-1.5 rounded-full",
                    dotClasses[variant]
                )}
            />
        )}
        {children}
    </span>
);

export default Badge;
