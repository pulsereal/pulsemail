import React from "react";
import clsx from "clsx";
import Spinner from "./Spinner";

type ButtonVariant =
    "primary" | "secondary" | "outline" | "ghost" | "danger" | "success";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: "xs" | "sm" | "md" | "lg";
    loading?: boolean;
    icon?: React.ReactNode;
    iconPosition?: "left" | "right";
    fullWidth?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
    primary:
        "bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800 shadow-sm dark:text-content-inverted",
    secondary:
        "bg-surface-sunken text-content hover:bg-surface-hover border border-line",
    outline:
        "border border-line-strong text-content bg-surface hover:bg-surface-hover",
    ghost: "text-content-muted hover:bg-surface-hover hover:text-content",
    danger: "bg-danger-600 text-white hover:bg-danger-700 shadow-sm dark:text-content-inverted",
    success:
        "bg-success-600 text-white hover:bg-success-700 shadow-sm dark:text-content-inverted",
};

const sizeClasses = {
    xs: "px-2 py-1 text-xs gap-1.5 rounded-md",
    sm: "px-3 py-1.5 text-sm gap-1.5 rounded-lg",
    md: "px-4 py-2 text-sm gap-2 rounded-lg",
    lg: "px-5 py-2.5 text-base gap-2 rounded-lg",
};

/**
 * Ref-forwarding matters: Headless UI renders triggers with `as={Fragment}` and
 * hands the child a ref for focus management and popover positioning.
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    (
        {
            children,
            variant = "primary",
            size = "md",
            loading = false,
            icon,
            iconPosition = "left",
            fullWidth,
            className,
            disabled,
            type = "button",
            ...props
        },
        ref
    ) => (
        <button
            ref={ref}
            type={type}
            className={clsx(
                "inline-flex items-center justify-center font-medium transition-colors",
                "disabled:cursor-not-allowed disabled:opacity-50",
                variantClasses[variant],
                sizeClasses[size],
                fullWidth && "w-full",
                className
            )}
            disabled={disabled || loading}
            {...props}
        >
            {loading ? (
                <Spinner size="sm" />
            ) : (
                icon && iconPosition === "left" && icon
            )}
            {children}
            {!loading && icon && iconPosition === "right" && icon}
        </button>
    )
);

Button.displayName = "Button";

export default Button;
