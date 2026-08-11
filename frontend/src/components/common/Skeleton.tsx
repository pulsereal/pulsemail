import React from "react";
import clsx from "clsx";

interface SkeletonProps {
    className?: string;
    circle?: boolean;
}

const Skeleton: React.FC<SkeletonProps> = ({ className, circle }) => (
    <div
        aria-hidden
        className={clsx(
            "animate-pulse bg-surface-sunken",
            circle ? "rounded-full" : "rounded-md",
            className
        )}
    />
);

export const SkeletonList: React.FC<{ rows?: number; className?: string }> = ({
    rows = 5,
    className,
}) => (
    <div className={clsx("space-y-3", className)}>
        {Array.from({ length: rows }).map((_, index) => (
            <div key={index} className="flex items-center gap-3">
                <Skeleton circle className="h-9 w-9 shrink-0" />
                <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-3 w-2/3" />
                </div>
            </div>
        ))}
    </div>
);

export default Skeleton;
