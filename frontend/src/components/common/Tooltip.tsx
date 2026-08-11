import React from "react";
import clsx from "clsx";

interface TooltipProps {
    label: string;
    children: React.ReactNode;
    side?: "top" | "bottom" | "left" | "right";
    className?: string;
}

const sideClasses = {
    top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
    bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
    left: "right-full top-1/2 mr-2 -translate-y-1/2",
    right: "left-full top-1/2 ml-2 -translate-y-1/2",
};

const Tooltip: React.FC<TooltipProps> = ({
    label,
    children,
    side = "top",
    className,
}) => (
    <span className={clsx("group/tooltip relative inline-flex", className)}>
        {children}
        <span
            role="tooltip"
            className={clsx(
                "pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-content px-2 py-1 text-xs font-medium text-canvas opacity-0 shadow-medium transition-opacity",
                "group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100",
                sideClasses[side]
            )}
        >
            {label}
        </span>
    </span>
);

export default Tooltip;
