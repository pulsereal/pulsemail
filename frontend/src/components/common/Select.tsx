import React, { forwardRef, useId } from "react";
import clsx from "clsx";
import { fieldClasses } from "./Input";

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    label?: string;
    error?: string;
    helpText?: string;
    options: { value: string; label: string; disabled?: boolean }[];
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
    ({ label, error, helpText, options, className, id, ...props }, ref) => {
        const generatedId = useId();
        const selectId = id || generatedId;

        return (
            <div className="w-full">
                {label && (
                    <label
                        htmlFor={selectId}
                        className="mb-1.5 block text-sm font-medium text-content"
                    >
                        {label}
                    </label>
                )}
                <select
                    ref={ref}
                    id={selectId}
                    aria-invalid={error ? true : undefined}
                    className={clsx(
                        fieldClasses(Boolean(error)),
                        "py-2 pl-3 pr-9",
                        className
                    )}
                    {...props}
                >
                    {options.map((option) => (
                        <option
                            key={option.value}
                            value={option.value}
                            disabled={option.disabled}
                        >
                            {option.label}
                        </option>
                    ))}
                </select>
                {error && (
                    <p className="mt-1.5 text-sm text-danger-600">{error}</p>
                )}
                {helpText && !error && (
                    <p className="mt-1.5 text-sm text-content-subtle">
                        {helpText}
                    </p>
                )}
            </div>
        );
    }
);

Select.displayName = "Select";

export default Select;
