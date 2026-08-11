import React from "react";
import clsx from "clsx";
import Skeleton from "./Skeleton";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger";

interface StatCardProps {
    label: string;
    value: React.ReactNode;
    icon?: React.ComponentType<{ className?: string }>;
    tone?: Tone;
    hint?: React.ReactNode;
    /** 0-100; renders a usage bar under the value */
    progress?: number;
    loading?: boolean;
    className?: string;
}

const toneClasses: Record<Tone, { icon: string; bar: string }> = {
    neutral: {
        icon: "bg-surface-sunken text-content-muted",
        bar: "bg-content-subtle",
    },
    primary: { icon: "bg-primary-100 text-primary-600", bar: "bg-primary-500" },
    success: { icon: "bg-success-100 text-success-600", bar: "bg-success-500" },
    warning: { icon: "bg-warning-100 text-warning-600", bar: "bg-warning-500" },
    danger: { icon: "bg-danger-100 text-danger-600", bar: "bg-danger-500" },
};

const StatCard: React.FC<StatCardProps> = ({
    label,
    value,
    icon: Icon,
    tone = "neutral",
    hint,
    progress,
    loading,
    className,
}) => {
    const tones = toneClasses[tone];
    const clamped =
        typeof progress === "number"
            ? Math.min(100, Math.max(0, progress))
            : null;

    return (
        <div
            className={clsx(
                "rounded-xl border border-line bg-surface p-4 shadow-soft",
                className
            )}
        >
            <div className="flex items-start gap-3">
                {Icon && (
                    <span
                        className={clsx(
                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                            tones.icon
                        )}
                    >
                        <Icon className="h-5 w-5" />
                    </span>
                )}
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-content-muted">
                        {label}
                    </p>
                    {loading ? (
                        <Skeleton className="mt-1.5 h-7 w-24" />
                    ) : (
                        <p className="mt-0.5 truncate text-2xl font-semibold tracking-tight text-content">
                            {value}
                        </p>
                    )}
                    {hint && !loading && (
                        <p className="mt-1 truncate text-xs text-content-subtle">
                            {hint}
                        </p>
                    )}
                </div>
            </div>

            {clamped !== null && !loading && (
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
                    <div
                        className={clsx("h-full rounded-full", tones.bar)}
                        style={{ width: `${clamped}%` }}
                    />
                </div>
            )}
        </div>
    );
};

export default StatCard;
