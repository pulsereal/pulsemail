import React, { forwardRef, useId } from "react";
import clsx from "clsx";
import { fieldClasses, fieldLabelClasses, type FieldSize } from "./Input";

interface SelectProps extends Omit<
    React.SelectHTMLAttributes<HTMLSelectElement>,
    "size"
> {
    label?: string;
    error?: string;
    helpText?: string;
    options: { value: string; label: string; disabled?: boolean }[];
    size?: FieldSize;
}

const selectSizeClasses: Record<FieldSize, string> = {
    xs: "py-1 pl-2 pr-7",
    sm: "py-1.5 pl-2.5 pr-8",
    md: "py-2 pl-3 pr-9",
};

const Select = forwardRef<HTMLSelectElement, SelectProps>(
    (
        {
            label,
            error,
            helpText,
            options,
            size = "md",
            className,
            id,
            ...props
        },
        ref
    ) => {
        const generatedId = useId();
        const selectId = id || generatedId;

        return (
            <div className="w-full">
                {label && (
                    <label
                        htmlFor={selectId}
                        className={fieldLabelClasses(size)}
                    >
                        {label}
                    </label>
                )}
                <select
                    ref={ref}
                    id={selectId}
                    aria-invalid={error ? true : undefined}
                    className={clsx(
                        fieldClasses(Boolean(error), size),
                        selectSizeClasses[size],
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
