import React, { forwardRef, useId } from "react";
import clsx from "clsx";

interface CheckboxProps extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "type"
> {
    label: React.ReactNode;
    description?: React.ReactNode;
}

const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
    ({ label, description, className, id, ...props }, ref) => {
        const generatedId = useId();
        const inputId = id || generatedId;

        return (
            <div className={clsx("flex items-start gap-3", className)}>
                <input
                    ref={ref}
                    id={inputId}
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-strong bg-surface text-primary-600 focus:ring-primary-500"
                    {...props}
                />
                <div className="min-w-0">
                    <label
                        htmlFor={inputId}
                        className="block text-sm font-medium text-content"
                    >
                        {label}
                    </label>
                    {description && (
                        <p className="mt-0.5 text-sm text-content-subtle">
                            {description}
                        </p>
                    )}
                </div>
            </div>
        );
    }
);

Checkbox.displayName = "Checkbox";

export default Checkbox;
