import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import toast from "react-hot-toast";
import {
    AtSymbolIcon,
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
import AliasFormModal from "../components/admin/AliasFormModal";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { provisioningAPI } from "../services/api";
import type { MailAlias } from "../types";

const MEMBER_PREVIEW = 2;

const membersLabel = (members: string[]) => {
    if (members.length === 0) return "No members";
    const preview = members.slice(0, MEMBER_PREVIEW).join(", ");
    const remaining = members.length - MEMBER_PREVIEW;
    return remaining > 0 ? `${preview} +${remaining} more` : preview;
};

const AliasesPage: React.FC = () => {
    const queryClient = useQueryClient();

    const [search, setSearch] = useState("");
    const debouncedSearch = useDebouncedValue(search, 300);

    const [formAlias, setFormAlias] = useState<MailAlias | null>(null);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<MailAlias | null>(null);

    const aliasesQuery = useQuery(
        ["provision-aliases", debouncedSearch],
        () =>
            provisioningAPI
                .getAliases({ search: debouncedSearch || undefined })
                .then((response) => response.data),
        { keepPreviousData: true }
    );

    const aliases: MailAlias[] = aliasesQuery.data?.aliases ?? [];

    const deleteMutation = useMutation(
        (address: string) => provisioningAPI.deleteAlias(address),
        {
            onSuccess: (_data, address) => {
                void queryClient.invalidateQueries("provision-aliases");
                void queryClient.invalidateQueries("provision-domains");
                toast.success(`${address} deleted`);
                setDeleteTarget(null);
            },
        }
    );

    const openForm = (alias: MailAlias | null) => {
        setFormAlias(alias);
        setIsFormOpen(true);
    };

    return (
        <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold text-content">
                        Aliases
                    </h1>
                    <p className="mt-1 text-sm text-content-muted">
                        Shared addresses that fan mail out to a list of
                        recipients.
                    </p>
                </div>
                <div className="flex w-full items-center gap-3 sm:w-auto">
                    <div className="w-full sm:w-72">
                        <Input
                            type="search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search aliases"
                            aria-label="Search aliases"
                            icon={<MagnifyingGlassIcon className="h-4 w-4" />}
                        />
                    </div>
                    <Button
                        onClick={() => openForm(null)}
                        icon={<PlusIcon className="h-4 w-4" />}
                        className="shrink-0"
                    >
                        Add alias
                    </Button>
                </div>
            </div>

            <Card padded={false} className="overflow-hidden">
                {aliasesQuery.isLoading && (
                    <SkeletonList rows={6} className="p-6" />
                )}

                {aliasesQuery.isError && (
                    <ErrorState
                        error={aliasesQuery.error}
                        onRetry={() => aliasesQuery.refetch()}
                    />
                )}

                {!aliasesQuery.isLoading && !aliasesQuery.isError && (
                    <>
                        {aliases.length === 0 ? (
                            <EmptyState
                                icon={AtSymbolIcon}
                                title="No aliases found"
                                description={
                                    debouncedSearch
                                        ? `Nothing matched "${debouncedSearch}".`
                                        : "Create an alias to route mail to a group of mailboxes."
                                }
                                action={
                                    debouncedSearch ? undefined : (
                                        <Button
                                            onClick={() => openForm(null)}
                                            icon={
                                                <PlusIcon className="h-4 w-4" />
                                            }
                                        >
                                            Add alias
                                        </Button>
                                    )
                                }
                            />
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-line text-sm">
                                    <thead>
                                        <tr className="text-left text-xs uppercase tracking-wide text-content-subtle">
                                            <th className="px-6 py-3 font-semibold">
                                                Address
                                            </th>
                                            <th className="px-6 py-3 font-semibold">
                                                Name
                                            </th>
                                            <th className="px-6 py-3 font-semibold">
                                                Members
                                            </th>
                                            <th className="px-6 py-3 font-semibold">
                                                Status
                                            </th>
                                            <th className="px-6 py-3" />
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-line">
                                        {aliases.map((alias) => (
                                            <tr
                                                key={alias.address}
                                                className="transition-colors hover:bg-surface-hover"
                                            >
                                                <td className="px-6 py-3">
                                                    <span className="block font-medium text-content">
                                                        {alias.address}
                                                    </span>
                                                    <span className="block text-xs text-content-subtle">
                                                        {alias.domain}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-3 text-content-muted">
                                                    {alias.name || "—"}
                                                </td>
                                                <td className="max-w-xs px-6 py-3">
                                                    <span className="block text-content-muted">
                                                        {alias.members.length}
                                                    </span>
                                                    <span className="block truncate text-xs text-content-subtle">
                                                        {membersLabel(
                                                            alias.members
                                                        )}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-3">
                                                    <Badge
                                                        variant={
                                                            alias.active
                                                                ? "success"
                                                                : "danger"
                                                        }
                                                        dot
                                                    >
                                                        {alias.active
                                                            ? "Active"
                                                            : "Disabled"}
                                                    </Badge>
                                                </td>
                                                <td className="px-6 py-3 text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <Button
                                                            size="xs"
                                                            variant="outline"
                                                            onClick={() =>
                                                                openForm(alias)
                                                            }
                                                        >
                                                            Edit
                                                        </Button>
                                                        <Button
                                                            size="xs"
                                                            variant="ghost"
                                                            className="text-danger-600 hover:bg-danger-50"
                                                            onClick={() =>
                                                                setDeleteTarget(
                                                                    alias
                                                                )
                                                            }
                                                        >
                                                            Delete
                                                        </Button>
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

            <AliasFormModal
                isOpen={isFormOpen}
                onClose={() => setIsFormOpen(false)}
                alias={formAlias}
            />

            <Modal
                isOpen={Boolean(deleteTarget)}
                onClose={() => setDeleteTarget(null)}
                title={`Delete ${deleteTarget?.address}`}
                description="Mail sent to this address will bounce from now on. Member mailboxes are untouched."
                size="sm"
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
                            onClick={() =>
                                deleteTarget &&
                                deleteMutation.mutate(deleteTarget.address)
                            }
                        >
                            Delete alias
                        </Button>
                    </>
                }
            >
                <p className="text-sm text-content-muted">
                    {deleteTarget?.members.length
                        ? `${deleteTarget.members.length} member${deleteTarget.members.length === 1 ? "" : "s"} will stop receiving mail through this address.`
                        : "This alias has no members."}
                </p>
            </Modal>
        </div>
    );
};

export default AliasesPage;
