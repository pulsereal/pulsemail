import React, { forwardRef, useId } from "react";
import clsx from "clsx";
import { fieldClasses } from "./Input";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    label?: string;
    error?: string;
    helpText?: string;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
    ({ label, error, helpText, className, id, ...props }, ref) => {
        const generatedId = useId();
        const textareaId = id || generatedId;

        return (
            <div className="w-full">
                {label && (
                    <label
                        htmlFor={textareaId}
                        className="mb-1.5 block text-sm font-medium text-content"
                    >
                        {label}
                    </label>
                )}
                <textarea
                    ref={ref}
                    id={textareaId}
                    aria-invalid={error ? true : undefined}
                    className={clsx(
                        fieldClasses(Boolean(error)),
                        "px-3 py-2",
                        className
                    )}
                    {...props}
                />
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

Textarea.displayName = "Textarea";

export default Textarea;
