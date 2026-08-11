import React from "react";
import clsx from "clsx";

interface SpinnerProps {
    size?: "xs" | "sm" | "md" | "lg";
    className?: string;
    label?: string;
}

const sizeClasses = {
    xs: "h-3 w-3 border",
    sm: "h-4 w-4 border-2",
    md: "h-6 w-6 border-2",
    lg: "h-9 w-9 border-[3px]",
};

const Spinner: React.FC<SpinnerProps> = ({
    size = "md",
    className,
    label = "Loading",
}) => (
    <span
        role="status"
        aria-label={label}
        className={clsx(
            "inline-block animate-spin rounded-full border-current border-r-transparent align-[-0.125em]",
            sizeClasses[size],
            className
        )}
    />
);

export default Spinner;
