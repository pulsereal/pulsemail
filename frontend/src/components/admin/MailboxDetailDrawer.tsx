import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import toast from "react-hot-toast";
import {
    ArrowUturnRightIcon,
    AtSymbolIcon,
    ExclamationTriangleIcon,
    UserCircleIcon,
} from "@heroicons/react/24/outline";
import Badge from "../common/Badge";
import Button from "../common/Button";
import Checkbox from "../common/Checkbox";
import Drawer from "../common/Drawer";
import ErrorState from "../common/ErrorState";
import { SkeletonList } from "../common/Skeleton";
import Tabs, { type TabItem } from "../common/Tabs";
import AddressListEditor from "./AddressListEditor";
import { provisioningAPI } from "../../services/api";
import { formatBytes } from "../../utils/mail";
import type { MailboxDetail } from "../../types";

interface MailboxDetailDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    email: string | null;
    onEdit?: (mailbox: MailboxDetail) => void;
    onResetPassword?: (mailbox: MailboxDetail) => void;
}

type MailboxTab = "overview" | "aliases" | "forwarding";

const tabs: TabItem<MailboxTab>[] = [
    { id: "overview", label: "Overview", icon: UserCircleIcon },
    { id: "aliases", label: "Aliases", icon: AtSymbolIcon },
    { id: "forwarding", label: "Forwarding", icon: ArrowUturnRightIcon },
];

const mbToBytes = (mb?: number) => (mb ?? 0) * 1048576;

const SummaryRow: React.FC<{
    label: string;
    children: React.ReactNode;
}> = ({ label, children }) => (
    <div className="flex items-center justify-between gap-4 px-3 py-2">
        <dt className="text-content-muted">{label}</dt>
        <dd className="min-w-0 truncate text-content">{children}</dd>
    </div>
);

const MailboxDetailDrawer: React.FC<MailboxDetailDrawerProps> = ({
    isOpen,
    onClose,
    email,
    onEdit,
    onResetPassword,
}) => {
    const queryClient = useQueryClient();
    const [tab, setTab] = useState<MailboxTab>("overview");
    const [aliases, setAliases] = useState<string[]>([]);
    const [destinations, setDestinations] = useState<string[]>([]);
    const [keepCopy, setKeepCopy] = useState(true);

    const detailQuery = useQuery(
        ["provision-mailbox", email],
        () =>
            provisioningAPI
                .getMailbox(email as string)
                .then((response) => response.data.mailbox as MailboxDetail),
        { enabled: isOpen && Boolean(email) }
    );

    const detail = detailQuery.data;

    useEffect(() => {
        if (!isOpen) return;
        setTab("overview");
    }, [isOpen, email]);

    useEffect(() => {
        setAliases(detail?.aliases ?? []);
    }, [detail?.aliases]);

    useEffect(() => {
        setDestinations(detail?.forwardings?.destinations ?? []);
        setKeepCopy(detail?.forwardings?.keepCopy ?? true);
    }, [detail?.forwardings]);

    const refresh = () => {
        void queryClient.invalidateQueries(["provision-mailbox", email]);
        void queryClient.invalidateQueries("provision-mailboxes");
    };

    const saveAliases = useMutation(
        () => provisioningAPI.setMailboxAliases(email as string, aliases),
        {
            onSuccess: () => {
                refresh();
                toast.success("Aliases saved");
            },
        }
    );

    const saveForwarding = useMutation(
        () =>
            provisioningAPI.setMailboxForwardings(
                email as string,
                destinations,
                keepCopy
            ),
        {
            onSuccess: () => {
                refresh();
                toast.success("Forwarding saved");
            },
        }
    );

    const usedMb = detail?.usedMb ?? 0;
    const quotaMb = detail?.quotaMb ?? 0;
    const usagePercent =
        quotaMb > 0 ? Math.min(100, (usedMb / quotaMb) * 100) : 0;

    return (
        <Drawer
            isOpen={isOpen}
            onClose={onClose}
            width="lg"
            title={detail?.name || email || "Mailbox"}
            description={email ?? undefined}
        >
            {detailQuery.isLoading && <SkeletonList rows={5} />}

            {detailQuery.isError && (
                <ErrorState
                    error={detailQuery.error}
                    onRetry={() => detailQuery.refetch()}
                />
            )}

            {detail && (
                <div className="space-y-5">
                    <Tabs tabs={tabs} value={tab} onChange={setTab} />

                    {tab === "overview" && (
                        <div className="space-y-5">
                            <dl className="divide-y divide-line rounded-lg border border-line text-sm">
                                <SummaryRow label="Name">
                                    {detail.name || "—"}
                                </SummaryRow>
                                <SummaryRow label="Address">
                                    {detail.email}
                                </SummaryRow>
                                <SummaryRow label="Domain">
                                    {detail.domain}
                                </SummaryRow>
                                {detail.department && (
                                    <SummaryRow label="Department">
                                        {detail.department}
                                    </SummaryRow>
                                )}
                                <SummaryRow label="Created">
                                    {detail.created
                                        ? new Date(
                                              detail.created
                                          ).toLocaleDateString()
                                        : "—"}
                                </SummaryRow>
                                <SummaryRow label="Status">
                                    <span className="flex items-center gap-2">
                                        <Badge
                                            variant={
                                                detail.active
                                                    ? "success"
                                                    : "danger"
                                            }
                                            dot
                                        >
                                            {detail.active
                                                ? "Active"
                                                : "Disabled"}
                                        </Badge>
                                        {detail.isGlobalAdmin && (
                                            <Badge variant="info">Admin</Badge>
                                        )}
                                    </span>
                                </SummaryRow>
                            </dl>

                            <div>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-content-muted">
                                        Storage
                                    </span>
                                    <span className="text-content">
                                        {formatBytes(mbToBytes(usedMb))}
                                        {quotaMb > 0
                                            ? ` of ${formatBytes(mbToBytes(quotaMb))}`
                                            : " used — unlimited"}
                                    </span>
                                </div>
                                {quotaMb > 0 && (
                                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
                                        <div
                                            className={
                                                usagePercent >= 90
                                                    ? "h-full rounded-full bg-danger-500"
                                                    : usagePercent >= 75
                                                      ? "h-full rounded-full bg-warning-500"
                                                      : "h-full rounded-full bg-primary-500"
                                            }
                                            style={{
                                                width: `${usagePercent}%`,
                                            }}
                                        />
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-wrap gap-2">
                                {onEdit && (
                                    <Button
                                        variant="outline"
                                        onClick={() => onEdit(detail)}
                                    >
                                        Edit mailbox
                                    </Button>
                                )}
                                {onResetPassword && (
                                    <Button
                                        variant="outline"
                                        onClick={() => onResetPassword(detail)}
                                    >
                                        Reset password
                                    </Button>
                                )}
                            </div>
                        </div>
                    )}

                    {tab === "aliases" && (
                        <div className="space-y-4">
                            <AddressListEditor
                                label="Alias addresses"
                                value={aliases}
                                onChange={setAliases}
                                description="Extra addresses that deliver into this mailbox."
                            />
                            <Button
                                loading={saveAliases.isLoading}
                                onClick={() => saveAliases.mutate()}
                            >
                                Save aliases
                            </Button>
                        </div>
                    )}

                    {tab === "forwarding" && (
                        <div className="space-y-4">
                            <AddressListEditor
                                label="Forward to"
                                value={destinations}
                                onChange={setDestinations}
                                description="Every incoming message is copied to these addresses."
                            />

                            <Checkbox
                                label="Keep a copy in this mailbox"
                                checked={keepCopy}
                                onChange={(event) =>
                                    setKeepCopy(event.target.checked)
                                }
                            />

                            {destinations.length > 0 && !keepCopy && (
                                <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm text-warning-800">
                                    <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />
                                    <span>
                                        Incoming mail will no longer be stored
                                        in this mailbox — it is only handed to
                                        the addresses above.
                                    </span>
                                </div>
                            )}

                            <Button
                                loading={saveForwarding.isLoading}
                                onClick={() => saveForwarding.mutate()}
                            >
                                Save forwarding
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </Drawer>
    );
};

export default MailboxDetailDrawer;
