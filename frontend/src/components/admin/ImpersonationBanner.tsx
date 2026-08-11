import React from "react";
import { useQueryClient } from "react-query";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useAuthStore, useIsImpersonating } from "../../stores/authStore";

/**
 * Always-visible reminder that actions apply to somebody else's mailbox.
 * Without this, an admin can send mail as another user without realising it.
 */
const ImpersonationBanner: React.FC = () => {
    const queryClient = useQueryClient();
    const isImpersonating = useIsImpersonating();
    const activeMailbox = useAuthStore((state) => state.activeMailbox);
    const resetActiveMailbox = useAuthStore(
        (state) => state.resetActiveMailbox
    );

    if (!isImpersonating) return null;

    return (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-warning-300 bg-warning-100 px-4 py-2 text-warning-800 sm:px-6">
            <p className="flex items-center gap-2 text-sm">
                <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />
                <span>
                    Viewing and acting as{" "}
                    <strong className="font-semibold">{activeMailbox}</strong>.
                    Mail you send will come from this address.
                </span>
            </p>
            <button
                type="button"
                onClick={() => {
                    resetActiveMailbox();
                    queryClient.clear();
                }}
                className="rounded-md border border-warning-400 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-warning-200"
            >
                Return to my mailbox
            </button>
        </div>
    );
};

export default ImpersonationBanner;
