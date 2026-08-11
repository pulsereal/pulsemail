import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import toast from "react-hot-toast";
import {
    ExclamationTriangleIcon,
    GlobeAltIcon,
    MagnifyingGlassIcon,
    PlusIcon,
} from "@heroicons/react/24/outline";
import Badge from "../components/common/Badge";
import Button from "../components/common/Button";
import Card from "../components/common/Card";
import EmptyState from "../components/common/EmptyState";
import ErrorState from "../components/common/ErrorState";
import Input from "../components/common/Input";
import Modal from "../components/common/Modal";
import { SkeletonList } from "../components/common/Skeleton";
import DomainDetailDrawer from "../components/admin/DomainDetailDrawer";
import DomainFormModal from "../components/admin/DomainFormModal";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { provisioningAPI } from "../services/api";
import { useAuthStore } from "../stores/authStore";
import { formatBytes } from "../utils/mail";
import type { Domain } from "../types";

const mbToBytes = (mb?: number) => (mb ?? 0) * 1048576;

const countLabel = (used?: number, max?: number) =>
    `${used ?? 0} / ${max && max > 0 ? max : "∞"}`;

const DomainsPage: React.FC = () => {
    const queryClient = useQueryClient();
    const user = useAuthStore((state) => state.user);
    const isGlobalAdmin = user?.adminType === "global";

    const [search, setSearch] = useState("");
    const debouncedSearch = useDebouncedValue(search, 300);

    const [formDomain, setFormDomain] = useState<Domain | null>(null);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [detailDomain, setDetailDomain] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<Domain | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState("");

    const domainsQuery = useQuery(
        ["provision-domains", debouncedSearch],
        () =>
            provisioningAPI
                .getDomains({ search: debouncedSearch || undefined })
                .then((response) => response.data),
        { keepPreviousData: true }
    );

    const domains: Domain[] = domainsQuery.data?.domains ?? [];

    useEffect(() => {
        setDeleteConfirm("");
    }, [deleteTarget]);

    const deleteMutation = useMutation(
        (domain: string) => provisioningAPI.deleteDomain(domain),
        {
            onSuccess: (_data, domain) => {
                void queryClient.invalidateQueries("provision-domains");
                void queryClient.invalidateQueries("provision-mailboxes");
                toast.success(`${domain} deleted`);
                setDeleteTarget(null);
            },
        }
    );

    const openCreate = () => {
        setFormDomain(null);
        setIsFormOpen(true);
    };

    const openEdit = (domain: Domain) => {
        setFormDomain(domain);
        setIsFormOpen(true);
    };

    return (
        <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold text-content">
                        Domains
                    </h1>
                    <p className="mt-1 text-sm text-content-muted">
                        Mail domains hosted on this server, their limits, and
                        their routing.
                    </p>
                </div>
                <div className="flex w-full items-center gap-3 sm:w-auto">
                    <div className="w-full sm:w-72">
                        <Input
                            type="search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search domains"
                            aria-label="Search domains"
                            icon={<MagnifyingGlassIcon className="h-4 w-4" />}
                        />
                    </div>
                    {isGlobalAdmin && (
                        <Button
                            onClick={openCreate}
                            icon={<PlusIcon className="h-4 w-4" />}
                            className="shrink-0"
                        >
                            Add domain
                        </Button>
                    )}
                </div>
            </div>

            <Card padded={false} className="overflow-hidden">
                {domainsQuery.isLoading && (
                    <SkeletonList rows={6} className="p-6" />
                )}

                {domainsQuery.isError && (
                    <ErrorState
                        error={domainsQuery.error}
                        onRetry={() => domainsQuery.refetch()}
                    />
                )}

                {!domainsQuery.isLoading && !domainsQuery.isError && (
                    <>
                        {domains.length === 0 ? (
                            <EmptyState
                                icon={GlobeAltIcon}
                                title="No domains found"
                                description={
                                    debouncedSearch
                                        ? `Nothing matched "${debouncedSearch}".`
                                        : "Add a domain to start provisioning mailboxes."
                                }
                                action={
                                    isGlobalAdmin && !debouncedSearch ? (
                                        <Button
                                            onClick={openCreate}
                                            icon={
                                                <PlusIcon className="h-4 w-4" />
                                            }
                                        >
                                            Add domain
                                        </Button>
                                    ) : undefined
                                }
                            />
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-line text-sm">
                                    <thead>
                                        <tr className="text-left text-xs uppercase tracking-wide text-content-subtle">
                                            <th className="px-6 py-3 font-semibold">
                                                Domain
                                            </th>
                                            <th className="px-6 py-3 font-semibold">
                                                Mailboxes
                                            </th>
                                            <th className="px-6 py-3 font-semibold">
                                                Aliases
                                            </th>
                                            <th className="px-6 py-3 font-semibold">
                                                Quota
                                            </th>
                                            <th className="px-6 py-3 font-semibold">
                                                Status
                                            </th>
                                            <th className="px-6 py-3" />
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-line">
                                        {domains.map((domain) => (
                                            <tr
                                                key={domain.domain}
                                                onClick={() =>
                                                    setDetailDomain(
                                                        domain.domain
                                                    )
                                                }
                                                className="cursor-pointer transition-colors hover:bg-surface-hover"
                                            >
                                                <td className="px-6 py-3">
                                                    <span className="block font-medium text-content">
                                                        {domain.domain}
                                                    </span>
                                                    {domain.description && (
                                                        <span className="block text-xs text-content-subtle">
                                                            {domain.description}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-3 text-content-muted">
                                                    {countLabel(
                                                        domain.mailboxCount,
                                                        domain.maxMailboxes
                                                    )}
                                                </td>
                                                <td className="px-6 py-3 text-content-muted">
                                                    {countLabel(
                                                        domain.aliasCount,
                                                        domain.maxAliases
                                                    )}
                                                </td>
                                                <td className="px-6 py-3 text-content-muted">
                                                    {formatBytes(
                                                        mbToBytes(
                                                            domain.usedQuotaMb
                                                        )
                                                    )}
                                                    <span className="text-content-subtle">
                                                        {" of "}
                                                        {domain.maxQuotaMb > 0
                                                            ? formatBytes(
                                                                  mbToBytes(
                                                                      domain.maxQuotaMb
                                                                  )
                                                              )
                                                            : "unlimited"}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-3">
                                                    <Badge
                                                        variant={
                                                            domain.active
                                                                ? "success"
                                                                : "danger"
                                                        }
                                                        dot
                                                    >
                                                        {domain.active
                                                            ? "Active"
                                                            : "Disabled"}
                                                    </Badge>
                                                </td>
                                                <td
                                                    className="px-6 py-3 text-right"
                                                    onClick={(event) =>
                                                        event.stopPropagation()
                                                    }
                                                >
                                                    <div className="flex items-center justify-end gap-2">
                                                        <Button
                                                            size="xs"
                                                            variant="outline"
                                                            onClick={() =>
                                                                setDetailDomain(
                                                                    domain.domain
                                                                )
                                                            }
                                                        >
                                                            Manage
                                                        </Button>
                                                        <Button
                                                            size="xs"
                                                            variant="ghost"
                                                            onClick={() =>
                                                                openEdit(domain)
                                                            }
                                                        >
                                                            Edit
                                                        </Button>
                                                        {isGlobalAdmin && (
                                                            <Button
                                                                size="xs"
                                                                variant="ghost"
                                                                className="text-danger-600 hover:bg-danger-50"
                                                                onClick={() =>
                                                                    setDeleteTarget(
                                                                        domain
                                                                    )
                                                                }
                                                            >
                                                                Delete
                                                            </Button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </>
                )}
            </Card>

            <DomainFormModal
                isOpen={isFormOpen}
                onClose={() => setIsFormOpen(false)}
                domain={formDomain}
            />

            <DomainDetailDrawer
                isOpen={Boolean(detailDomain)}
                onClose={() => setDetailDomain(null)}
                domain={detailDomain}
                onEdit={(domain) => {
                    setDetailDomain(null);
                    openEdit(domain);
                }}
            />

            <Modal
                isOpen={Boolean(deleteTarget)}
                onClose={() => setDeleteTarget(null)}
                title={`Delete ${deleteTarget?.domain}`}
                size="md"
                actions={
                    <>
                        <Button
                            variant="outline"
                            onClick={() => setDeleteTarget(null)}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="danger"
                            loading={deleteMutation.isLoading}
                            disabled={
                                deleteConfirm.trim().toLowerCase() !==
                                deleteTarget?.domain
                            }
                            onClick={() =>
                                deleteTarget &&
                                deleteMutation.mutate(deleteTarget.domain)
                            }
                        >
                            Delete domain
                        </Button>
                    </>
                }
            >
                <div className="space-y-4">
                    <div className="flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 p-3 text-sm text-danger-800">
                        <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />
                        <span>
                            Deleting this domain destroys every mailbox, alias,
                            and stored message it contains. This cannot be
                            undone.
                        </span>
                    </div>

                    <Input
                        label={`Type ${deleteTarget?.domain} to confirm`}
                        value={deleteConfirm}
                        autoComplete="off"
                        onChange={(event) =>
                            setDeleteConfirm(event.target.value)
                        }
                    />
                </div>
            </Modal>
        </div>
    );
};

export default DomainsPage;
