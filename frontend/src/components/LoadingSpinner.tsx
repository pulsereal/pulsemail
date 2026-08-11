import clsx from "clsx";
import Spinner from "./common/Spinner";

interface LoadingSpinnerProps {
    size?: "sm" | "md" | "lg";
    className?: string;
    label?: string;
    /** Fills the available height and centers the spinner. */
    fullHeight?: boolean;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
    size = "md",
    className,
    label,
    fullHeight,
}) => (
    <div
        className={clsx(
            "flex flex-col items-center justify-center gap-3 text-primary-600",
            fullHeight && "h-full min-h-[12rem] w-full",
            className
        )}
    >
        <Spinner size={size} />
        {label && <p className="text-sm text-content-muted">{label}</p>}
    </div>
);

export default LoadingSpinner;
