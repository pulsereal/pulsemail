import React from "react";
import clsx from "clsx";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import Button from "./Button";

interface ErrorStateProps {
    title?: string;
    error?: unknown;
    onRetry?: () => void;
    className?: string;
    compact?: boolean;
}

export const errorMessage = (
    error: unknown,
    fallback = "Something went wrong"
) => {
    if (!error) return fallback;
    if (typeof error === "string") return error;

    const candidate = error as {
        response?: { data?: { error?: string; message?: string } };
        message?: string;
    };

    return (
        candidate.response?.data?.error ||
        candidate.response?.data?.message ||
        candidate.message ||
        fallback
    );
};

const ErrorState: React.FC<ErrorStateProps> = ({
    title = "Unable to load this view",
    error,
    onRetry,
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
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-100 text-danger-600">
            <ExclamationTriangleIcon className="h-6 w-6" />
        </span>
        <h3 className="text-sm font-semibold text-content">{title}</h3>
        <p className="mt-1.5 max-w-sm text-sm text-content-muted">
            {errorMessage(error)}
        </p>
        {onRetry && (
            <Button
                variant="outline"
                size="sm"
                className="mt-5"
                onClick={onRetry}
            >
                Try again
            </Button>
        )}
    </div>
);

export default ErrorState;
