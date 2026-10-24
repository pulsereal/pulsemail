import React, { forwardRef, useId } from "react";
import clsx from "clsx";

/** Heights line up with the outline `Button` of the same size. */
export type FieldSize = "xs" | "sm" | "md";

interface InputProps extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "size"
> {
    label?: string;
    error?: string;
    helpText?: string;
    icon?: React.ReactNode;
    iconPosition?: "left" | "right";
    action?: React.ReactNode;
    size?: FieldSize;
}

const fieldTextClasses: Record<FieldSize, string> = {
    xs: "text-xs",
    sm: "text-sm",
    md: "sm:text-sm",
};

export const fieldLabelClasses = (size: FieldSize = "md") =>
    clsx(
        "block text-sm font-medium text-content",
        size === "md" ? "mb-1.5" : "mb-1"
    );

const inputSizeClasses: Record<FieldSize, string> = {
    xs: "px-2 py-1",
    sm: "px-2.5 py-1.5",
    md: "px-3 py-2",
};

export const fieldClasses = (hasError?: boolean, size: FieldSize = "md") =>
    clsx(
        "block w-full rounded-lg bg-surface text-content placeholder:text-content-subtle",
        "border shadow-sm transition-colors",
        fieldTextClasses[size],
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
            size = "md",
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
        const large = size === "md";

        return (
            <div className="w-full">
                {label && (
                    <label
                        htmlFor={inputId}
                        className={fieldLabelClasses(size)}
                    >
                        {label}
                    </label>
                )}
                <div className="relative">
                    {icon && iconPosition === "left" && (
                        <span
                            className={clsx(
                                "pointer-events-none absolute inset-y-0 left-0 flex items-center text-content-subtle",
                                large ? "pl-3" : "pl-2.5"
                            )}
                        >
                            {icon}
                        </span>
                    )}
                    <input
                        ref={ref}
                        id={inputId}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={describedBy}
                        className={clsx(
                            fieldClasses(Boolean(error), size),
                            inputSizeClasses[size],
                            icon &&
                                iconPosition === "left" &&
                                (large ? "pl-10" : "pl-8"),
                            ((icon && iconPosition === "right") || action) &&
                                (large ? "pr-10" : "pr-8"),
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
                            <span
                                className={clsx(
                                    "pointer-events-none absolute inset-y-0 right-0 flex items-center text-content-subtle",
                                    large ? "pr-3" : "pr-2.5"
                                )}
                            >
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
