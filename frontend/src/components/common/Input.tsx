import React, { forwardRef, useId } from "react";
import clsx from "clsx";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
    helpText?: string;
    icon?: React.ReactNode;
    iconPosition?: "left" | "right";
    action?: React.ReactNode;
}

export const fieldClasses = (hasError?: boolean) =>
    clsx(
        "block w-full rounded-lg bg-surface text-content placeholder:text-content-subtle",
        "border shadow-sm transition-colors sm:text-sm",
        "focus:ring-2 focus:ring-offset-0",
        hasError
            ? "border-danger-400 focus:border-danger-500 focus:ring-danger-500/40"
            : "border-line-strong focus:border-primary-500 focus:ring-primary-500/40",
        "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-content-subtle"
    );

const Input = forwardRef<HTMLInputElement, InputProps>(
    (
        {
            label,
            error,
            helpText,
            icon,
            iconPosition = "left",
            action,
            className,
            id,
            ...props
        },
        ref
    ) => {
        const generatedId = useId();
        const inputId = id || generatedId;
        const describedBy = error
            ? `${inputId}-error`
            : helpText
              ? `${inputId}-help`
              : undefined;

        return (
            <div className="w-full">
                {label && (
                    <label
                        htmlFor={inputId}
                        className="mb-1.5 block text-sm font-medium text-content"
                    >
                        {label}
                    </label>
                )}
                <div className="relative">
                    {icon && iconPosition === "left" && (
                        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-content-subtle">
                            {icon}
                        </span>
                    )}
                    <input
                        ref={ref}
                        id={inputId}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={describedBy}
                        className={clsx(
                            fieldClasses(Boolean(error)),
                            "px-3 py-2",
                            icon && iconPosition === "left" && "pl-10",
                            ((icon && iconPosition === "right") || action) &&
                                "pr-10",
                            className
                        )}
                        {...props}
                    />
                    {action ? (
                        <span className="absolute inset-y-0 right-0 flex items-center pr-2">
                            {action}
                        </span>
                    ) : (
                        icon &&
                        iconPosition === "right" && (
                            <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-content-subtle">
                                {icon}
                            </span>
                        )
                    )}
                </div>
                {error && (
                    <p
                        id={`${inputId}-error`}
                        className="mt-1.5 text-sm text-danger-600"
                    >
                        {error}
                    </p>
                )}
                {helpText && !error && (
                    <p
                        id={`${inputId}-help`}
                        className="mt-1.5 text-sm text-content-subtle"
                    >
                        {helpText}
                    </p>
                )}
            </div>
        );
    }
);

Input.displayName = "Input";

export default Input;
