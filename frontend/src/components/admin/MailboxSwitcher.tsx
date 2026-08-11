import React, { useEffect, useMemo } from "react";
import { useQueryClient } from "react-query";
import toast from "react-hot-toast";
import {
    ArrowsRightLeftIcon,
    InboxIcon,
    UserCircleIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import Combobox, { type ComboboxOption } from "../common/Combobox";
import Badge from "../common/Badge";
import { useAuthStore } from "../../stores/authStore";

interface MailboxSwitcherProps {
    className?: string;
}

const MailboxSwitcher: React.FC<MailboxSwitcherProps> = ({ className }) => {
    const queryClient = useQueryClient();
    const user = useAuthStore((state) => state.user);
    const activeMailbox = useAuthStore((state) => state.activeMailbox);
    const mailboxes = useAuthStore((state) => state.accessibleMailboxes);
    const loadAccessibleMailboxes = useAuthStore(
        (state) => state.loadAccessibleMailboxes
    );
    const setActiveMailbox = useAuthStore((state) => state.setActiveMailbox);

    useEffect(() => {
        if (user?.isAdmin && mailboxes.length === 0) {
            void loadAccessibleMailboxes();
        }
    }, [user?.isAdmin, mailboxes.length, loadAccessibleMailboxes]);

    const options = useMemo<ComboboxOption[]>(() => {
        if (!user) return [];

        const own: ComboboxOption = {
            value: user.email,
            label: `${user.name || user.email} (you)`,
            description: user.email,
            group: "Your mailbox",
        };

        const others = mailboxes
            .filter((mailbox) => mailbox.email !== user.email)
            .map((mailbox) => ({
                value: mailbox.email,
                label: mailbox.name || mailbox.email,
                description: mailbox.email,
                group: mailbox.domain,
            }));

        return [own, ...others];
    }, [mailboxes, user]);

    if (!user?.isAdmin) return null;

    const isImpersonating = activeMailbox !== user.email;

    const handleChange = (nextMailbox: string) => {
        if (nextMailbox === activeMailbox) return;

        setActiveMailbox(nextMailbox);
        // Every cached response was fetched under the previous mailbox scope.
        queryClient.clear();

        toast.success(
            nextMailbox === user.email
                ? "Back in your own mailbox"
                : `Now viewing ${nextMailbox}`
        );
    };

    return (
        <Combobox
            className={clsx("w-full sm:w-72", className)}
            options={options}
            value={activeMailbox}
            onChange={handleChange}
            searchPlaceholder="Search mailboxes…"
            emptyMessage="No mailboxes match"
            buttonClassName={clsx(
                isImpersonating &&
                    "border-warning-400 bg-warning-50 hover:bg-warning-100"
            )}
            renderTrigger={(selected) => (
                <>
                    {isImpersonating ? (
                        <ArrowsRightLeftIcon className="h-4 w-4 shrink-0 text-warning-600" />
                    ) : (
                        <UserCircleIcon className="h-4 w-4 shrink-0 text-content-subtle" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-left">
                        <span className="block truncate text-sm font-medium text-content">
                            {selected?.description || activeMailbox}
                        </span>
                    </span>
                    {isImpersonating && (
                        <Badge variant="warning" size="xs">
                            Viewing as
                        </Badge>
                    )}
                </>
            )}
        />
    );
};

export const MailboxSwitcherHint: React.FC = () => (
    <p className="flex items-center gap-1.5 text-xs text-content-subtle">
        <InboxIcon className="h-3.5 w-3.5" />
        Admin access is audited
    </p>
);

export default MailboxSwitcher;
