import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import toast from "react-hot-toast";
import {
    AtSymbolIcon,
    ExclamationTriangleIcon,
    GlobeAltIcon,
    InboxStackIcon,
    PlusIcon,
    ServerStackIcon,
    ShieldCheckIcon,
    TrashIcon,
    UsersIcon,
} from "@heroicons/react/24/outline";
import Badge from "../common/Badge";
import Button from "../common/Button";
import Drawer from "../common/Drawer";
import ErrorState from "../common/ErrorState";
import Input from "../common/Input";
import { SkeletonList } from "../common/Skeleton";
import StatCard from "../common/StatCard";
import Tabs, { type TabItem } from "../common/Tabs";
import AddressListEditor from "./AddressListEditor";
import { provisioningAPI } from "../../services/api";
import { formatBytes } from "../../utils/mail";
import type { DomainDetail } from "../../types";

interface DomainDetailDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    domain: string | null;
    onEdit?: (domain: DomainDetail) => void;
    canManage?: boolean;
}

type DomainTab = "overview" | "admins" | "alias-domains" | "catch-all";

const tabs: TabItem<DomainTab>[] = [
    { id: "overview", label: "Overview", icon: ServerStackIcon },
    { id: "admins", label: "Domain admins", icon: ShieldCheckIcon },
    { id: "alias-domains", label: "Alias domains", icon: GlobeAltIcon },
    { id: "catch-all", label: "Catch-all", icon: AtSymbolIcon },
];

const mbToBytes = (mb?: number) => (mb ?? 0) * 1048576;

const limitLabel = (used: number | undefined, max: number | undefined) =>
    `${used ?? 0} / ${max ? max : "∞"}`;

const RowList: React.FC<{
    items: string[];
    emptyLabel: string;
    onRemove: (item: string) => void;
    removingItem?: string | null;
    disabled?: boolean;
}> = ({ items, emptyLabel, onRemove, removingItem, disabled }) => {
    if (items.length === 0) {
        return <p className="text-sm text-content-subtle">{emptyLabel}</p>;
    }

    return (
        <ul className="divide-y divide-line rounded-lg border border-line">
            {items.map((item) => (
                <li
                    key={item}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                >
                    <span className="truncate text-sm text-content">
                        {item}
                    </span>
                    <Button
                        size="xs"
                        variant="ghost"
                        disabled={disabled}
                        loading={removingItem === item}
                        onClick={() => onRemove(item)}
                        icon={<TrashIcon className="h-3.5 w-3.5" />}
                        aria-label={`Remove ${item}`}
                    >
                        Remove
                    </Button>
                </li>
            ))}
        </ul>
    );
};

const DomainDetailDrawer: React.FC<DomainDetailDrawerProps> = ({
    isOpen,
    onClose,
    domain,
    onEdit,
    canManage = true,
}) => {
    const queryClient = useQueryClient();
    const [tab, setTab] = useState<DomainTab>("overview");
    const [pendingAdmins, setPendingAdmins] = useState<string[]>([]);
    const [aliasDomainDraft, setAliasDomainDraft] = useState("");
    const [catchAll, setCatchAll] = useState<string[]>([]);
    const [removing, setRemoving] = useState<string | null>(null);

    const detailQuery = useQuery(
        ["provision-domain", domain],
        () =>
            provisioningAPI
                .getDomain(domain as string)
                .then((response) => response.data.domain as DomainDetail),
        { enabled: isOpen && Boolean(domain) }
    );

    const detail = detailQuery.data;

    useEffect(() => {
        if (!isOpen) return;
        setTab("overview");
        setPendingAdmins([]);
        setAliasDomainDraft("");
    }, [isOpen, domain]);

    useEffect(() => {
        setCatchAll(detail?.catchAll ?? []);
    }, [detail?.catchAll]);

    const refresh = () => {
        void queryClient.invalidateQueries(["provision-domain", domain]);
        void queryClient.invalidateQueries("provision-domains");
    };

    const addAdmins = useMutation(
        async (emails: string[]) => {
            for (const email of emails) {
                await provisioningAPI.addDomainAdmin(domain as string, email);
            }
        },
        {
            onSuccess: (_data, emails) => {
                setPendingAdmins([]);
                refresh();
                toast.success(
                    emails.length > 1
                        ? `${emails.length} administrators added`
                        : "Administrator added"
                );
            },
        }
    );

    const removeAdmin = useMutation(
        (email: string) =>
            provisioningAPI.removeDomainAdmin(domain as string, email),
        {
            onSuccess: () => {
                refresh();
                toast.success("Administrator removed");
            },
            onSettled: () => setRemoving(null),
        }
    );

    const addAliasDomain = useMutation(
        (aliasDomain: string) =>
            provisioningAPI.addAliasDomain(domain as string, aliasDomain),
        {
            onSuccess: () => {
                setAliasDomainDraft("");
                refresh();
                toast.success("Alias domain added");
            },
        }
    );

    const removeAliasDomain = useMutation(
        (aliasDomain: string) =>
            provisioningAPI.removeAliasDomain(domain as string, aliasDomain),
        {
            onSuccess: () => {
                refresh();
                toast.success("Alias domain removed");
            },
            onSettled: () => setRemoving(null),
        }
    );

    const saveCatchAll = useMutation(
        () => provisioningAPI.setCatchAll(domain as string, catchAll),
        {
            onSuccess: () => {
                refresh();
                toast.success(
                    catchAll.length === 0
                        ? "Catch-all disabled"
                        : "Catch-all saved"
                );
            },
        }
    );

    const quotaPercent =
        detail && detail.maxQuotaMb > 0
            ? ((detail.usedQuotaMb ?? 0) / detail.maxQuotaMb) * 100
            : undefined;

    return (
        <Drawer
            isOpen={isOpen}
            onClose={onClose}
            width="lg"
            title={domain ?? "Domain"}
            description={detail?.description || "Domain settings and routing"}
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
                            <div className="grid gap-3 sm:grid-cols-3">
                                <StatCard
                                    label="Mailboxes"
                                    icon={UsersIcon}
                                    tone="primary"
                                    value={limitLabel(
                                        detail.mailboxCount,
                                        detail.maxMailboxes
                                    )}
                                />
                                <StatCard
                                    label="Aliases"
                                    icon={AtSymbolIcon}
                                    value={limitLabel(
                                        detail.aliasCount,
                                        detail.maxAliases
                                    )}
                                />
                                <StatCard
                                    label="Storage"
                                    icon={InboxStackIcon}
                                    tone="success"
                                    progress={quotaPercent}
                                    value={formatBytes(
                                        mbToBytes(detail.usedQuotaMb)
                                    )}
                                    hint={
                                        detail.maxQuotaMb > 0
                                            ? `of ${formatBytes(mbToBytes(detail.maxQuotaMb))}`
                                            : "Unlimited"
                                    }
                                />
                            </div>

                            <dl className="divide-y divide-line rounded-lg border border-line text-sm">
                                <div className="flex items-center justify-between gap-4 px-3 py-2">
                                    <dt className="text-content-muted">
                                        Status
                                    </dt>
                                    <dd>
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
                                    </dd>
                                </div>
                                <div className="flex items-center justify-between gap-4 px-3 py-2">
                                    <dt className="text-content-muted">
                                        Default mailbox quota
                                    </dt>
                                    <dd className="text-content">
                                        {detail.defaultUserQuotaMb > 0
                                            ? formatBytes(
                                                  mbToBytes(
                                                      detail.defaultUserQuotaMb
                                                  )
                                              )
                                            : "Unlimited"}
                                    </dd>
                                </div>
                                <div className="flex items-center justify-between gap-4 px-3 py-2">
                                    <dt className="text-content-muted">
                                        Created
                                    </dt>
                                    <dd className="text-content">
                                        {detail.created
                                            ? new Date(
                                                  detail.created
                                              ).toLocaleDateString()
                                            : "—"}
                                    </dd>
                                </div>
                            </dl>

                            {canManage && onEdit && (
                                <Button
                                    variant="outline"
                                    onClick={() => onEdit(detail)}
                                >
                                    Edit settings
                                </Button>
                            )}
                        </div>
                    )}

                    {tab === "admins" && (
                        <div className="space-y-4">
                            <p className="text-sm text-content-muted">
                                Domain admins can manage mailboxes and aliases
                                in {detail.domain} but nowhere else.
                            </p>

                            <RowList
                                items={detail.admins}
                                emptyLabel="No domain administrators yet."
                                removingItem={
                                    removeAdmin.isLoading ? removing : null
                                }
                                disabled={!canManage}
                                onRemove={(email) => {
                                    setRemoving(email);
                                    removeAdmin.mutate(email);
                                }}
                            />

                            {canManage && (
                                <div className="space-y-3 border-t border-line pt-4">
                                    <AddressListEditor
                                        label="Add administrators"
                                        value={pendingAdmins}
                                        onChange={setPendingAdmins}
                                        placeholder="admin@example.com"
                                    />
                                    <Button
                                        loading={addAdmins.isLoading}
                                        disabled={pendingAdmins.length === 0}
                                        onClick={() =>
                                            addAdmins.mutate(pendingAdmins)
                                        }
                                    >
                                        Grant access
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}

                    {tab === "alias-domains" && (
                        <div className="space-y-4">
                            <p className="text-sm text-content-muted">
                                Mail sent to an alias domain is delivered to the
                                matching mailbox in {detail.domain}.
                            </p>

                            <RowList
                                items={detail.aliasDomains}
                                emptyLabel="No alias domains configured."
                                removingItem={
                                    removeAliasDomain.isLoading
                                        ? removing
                                        : null
                                }
                                disabled={!canManage}
                                onRemove={(aliasDomain) => {
                                    setRemoving(aliasDomain);
                                    removeAliasDomain.mutate(aliasDomain);
                                }}
                            />

                            {canManage && (
                                <div className="flex items-start gap-2 border-t border-line pt-4">
                                    <Input
                                        value={aliasDomainDraft}
                                        placeholder="acme.net"
                                        aria-label="Alias domain"
                                        onChange={(event) =>
                                            setAliasDomainDraft(
                                                event.target.value
                                            )
                                        }
                                    />
                                    <Button
                                        variant="outline"
                                        loading={addAliasDomain.isLoading}
                                        disabled={
                                            aliasDomainDraft.trim().length === 0
                                        }
                                        icon={<PlusIcon className="h-4 w-4" />}
                                        onClick={() =>
                                            addAliasDomain.mutate(
                                                aliasDomainDraft
                                                    .trim()
                                                    .toLowerCase()
                                            )
                                        }
                                    >
                                        Add
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}

                    {tab === "catch-all" && (
                        <div className="space-y-4">
                            <AddressListEditor
                                label="Catch-all destinations"
                                value={catchAll}
                                onChange={setCatchAll}
                                disabled={!canManage}
                                description={`Mail addressed to an unknown mailbox in ${detail.domain} is delivered here. Leave the list empty to disable the catch-all.`}
                            />

                            <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm text-warning-800">
                                <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />
                                <span>
                                    Catch-all addresses attract a lot of spam
                                    because every typo and dictionary attack
                                    lands in them.
                                </span>
                            </div>

                            {canManage && (
                                <Button
                                    loading={saveCatchAll.isLoading}
                                    onClick={() => saveCatchAll.mutate()}
                                >
                                    Save catch-all
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            )}
        </Drawer>
    );
};

export default DomainDetailDrawer;
