import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
    ArrowRightOnRectangleIcon,
    EllipsisHorizontalIcon,
    ExclamationTriangleIcon,
    MagnifyingGlassIcon,
    PlusIcon,
    UsersIcon,
} from "@heroicons/react/24/outline";
import Badge from "../components/common/Badge";
import Button from "../components/common/Button";
import Card from "../components/common/Card";
import Dropdown, { type DropdownItem } from "../components/common/Dropdown";
import EmptyState from "../components/common/EmptyState";
import ErrorState from "../components/common/ErrorState";
import Input from "../components/common/Input";
import Modal from "../components/common/Modal";
import { SkeletonList } from "../components/common/Skeleton";
import MailboxDetailDrawer from "../components/admin/MailboxDetailDrawer";
import MailboxFormModal from "../components/admin/MailboxFormModal";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { provisioningAPI } from "../services/api";
import { useAuthStore } from "../stores/authStore";
import { formatBytes } from "../utils/mail";
import type { ProvisionedMailbox } from "../types";

const PAGE_SIZE = 50;

const mbToBytes = (mb?: number) => (mb ?? 0) * 1048576;

const QuotaBar: React.FC<{ usedMb?: number; quotaMb: number }> = ({
    usedMb = 0,
    quotaMb,
}) => {
    const percent =
        quotaMb > 0 ? Math.min(100, (usedMb / quotaMb) * 100) : null;

    return (
        <div className="min-w-[8rem]">
            <span className="block text-xs text-content-muted">
                {formatBytes(mbToBytes(usedMb))}
                {quotaMb > 0
                    ? ` of ${formatBytes(mbToBytes(quotaMb))}`
                    : " · unlimited"}
            </span>
            {percent !== null && (
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
                    <div
                        className={
                            percent >= 90
                                ? "h-full rounded-full bg-danger-500"
                                : percent >= 75
                                  ? "h-full rounded-full bg-warning-500"
                                  : "h-full rounded-full bg-primary-500"
                        }
                        style={{ width: `${percent}%` }}
                    />
                </div>
            )}
        </div>
    );
};

const UsersPage: React.FC = () => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const setActiveMailbox = useAuthStore((state) => state.setActiveMailbox);

    const [search, setSearch] = useState("");
    const debouncedSearch = useDebouncedValue(search, 300);
    const [offset, setOffset] = useState(0);

    const [formMailbox, setFormMailbox] = useState<ProvisionedMailbox | null>(
        null
    );
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [isPasswordOnly, setIsPasswordOnly] = useState(false);
    const [detailEmail, setDetailEmail] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<ProvisionedMailbox | null>(
        null
    );
    const [deleteConfirm, setDeleteConfirm] = useState("");

    useEffect(() => {
        setOffset(0);
    }, [debouncedSearch]);

    useEffect(() => {
        setDeleteConfirm("");
    }, [deleteTarget]);

    const mailboxesQuery = useQuery(
        ["provision-mailboxes", debouncedSearch, offset],
        () =>
            provisioningAPI
                .getMailboxes({
                    search: debouncedSearch || undefined,
                    limit: PAGE_SIZE,
                    offset,
                })
                .then((response) => response.data),
        { keepPreviousData: true }
    );

    const mailboxes: ProvisionedMailbox[] =
        mailboxesQuery.data?.mailboxes ?? [];
    const total: number = mailboxesQuery.data?.total ?? mailboxes.length;

    const invalidate = () => {
        void queryClient.invalidateQueries("provision-mailboxes");
        void queryClient.invalidateQueries("provision-domains");
    };

    const toggleActive = useMutation(
        (mailbox: ProvisionedMailbox) =>
            provisioningAPI.updateMailbox(mailbox.email, {
                active: !mailbox.active,
            }),
        {
            onSuccess: (_data, mailbox) => {
                invalidate();
                toast.success(
                    mailbox.active
                        ? `${mailbox.email} disabled`
                        : `${mailbox.email} enabled`
                );
            },
        }
    );

    const deleteMutation = useMutation(
        (email: string) => provisioningAPI.deleteMailbox(email),
        {
            onSuccess: (_data, email) => {
                invalidate();
                toast.success(`${email} deleted`);
                setDeleteTarget(null);
            },
        }
    );

    const openMailbox = (email: string) => {
        setActiveMailbox(email);
        navigate("/emails");
    };

    const openForm = (
        mailbox: ProvisionedMailbox | null,
        passwordOnly = false
    ) => {
        setFormMailbox(mailbox);
        setIsPasswordOnly(passwordOnly);
        setIsFormOpen(true);
    };

    const rowActions = (mailbox: ProvisionedMailbox): DropdownItem[] => [
        {
            id: "edit",
            label: "Edit",
            onSelect: () => openForm(mailbox),
        },
        {
            id: "password",
            label: "Reset password",
            onSelect: () => openForm(mailbox, true),
        },
        {
            id: "toggle",
            label: mailbox.active ? "Disable" : "Enable",
            onSelect: () => toggleActive.mutate(mailbox),
        },
        {
            id: "delete",
            label: "Delete",
            danger: true,
            separatorBefore: true,
            onSelect: () => setDeleteTarget(mailbox),
        },
    ];

    const rangeStart = total === 0 ? 0 : offset + 1;
    const rangeEnd = offset + mailboxes.length;

    return (
        <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold text-content">
                        Mailboxes
                    </h1>
                    <p className="mt-1 text-sm text-content-muted">
                        Every mailbox you administer. Open one to work inside it
                        as its owner.
                    </p>
                </div>
                <div className="flex w-full items-center gap-3 sm:w-auto">
                    <div className="w-full sm:w-72">
                        <Input
                            type="search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search by name or address"
                            aria-label="Search mailboxes"
                            icon={<MagnifyingGlassIcon className="h-4 w-4" />}
                        />
                    </div>
                    <Button
                        onClick={() => openForm(null)}
                        icon={<PlusIcon className="h-4 w-4" />}
                        className="shrink-0"
                    >
                        Add mailbox
                    </Button>
                </div>
            </div>

            <Card padded={false} className="overflow-hidden">
                {mailboxesQuery.isLoading && (
                    <SkeletonList rows={6} className="p-6" />
                )}

                {mailboxesQuery.isError && (
                    <ErrorState
                        error={mailboxesQuery.error}
                        onRetry={() => mailboxesQuery.refetch()}
                    />
                )}

                {!mailboxesQuery.isLoading && !mailboxesQuery.isError && (
                    <>
                        {mailboxes.length === 0 ? (
                            <EmptyState
                                icon={UsersIcon}
                                title="No mailboxes found"
                                description={
                                    debouncedSearch
                                        ? `Nothing matched "${debouncedSearch}".`
                                        : "You do not administer any mailboxes yet."
                                }
                                action={
                                    debouncedSearch ? undefined : (
                                        <Button
                                            onClick={() => openForm(null)}
                                            icon={
                                                <PlusIcon className="h-4 w-4" />
                                            }
                                        >
                                            Add mailbox
                                        </Button>
                                    )
                                }
                            />
                        ) : (
                            <>
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-line text-sm">
                                        <thead>
                                            <tr className="text-left text-xs uppercase tracking-wide text-content-subtle">
                                                <th className="px-6 py-3 font-semibold">
                                                    Mailbox
                                                </th>
                                                <th className="px-6 py-3 font-semibold">
                                                    Domain
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
                                            {mailboxes.map((mailbox) => (
                                                <tr
                                                    key={mailbox.email}
                                                    className="transition-colors hover:bg-surface-hover"
                                                >
                                                    <td className="px-6 py-3">
                                                        <span className="block font-medium text-content">
                                                            {mailbox.name ||
                                                                mailbox.email}
                                                        </span>
                                                        <span className="block text-xs text-content-subtle">
                                                            {mailbox.email}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-3 text-content-muted">
                                                        {mailbox.domain}
                                                    </td>
                                                    <td className="px-6 py-3">
                                                        <QuotaBar
                                                            usedMb={
                                                                mailbox.usedMb
                                                            }
                                                            quotaMb={
                                                                mailbox.quotaMb ??
                                                                0
                                                            }
                                                        />
                                                    </td>
                                                    <td className="px-6 py-3">
                                                        <span className="flex flex-wrap items-center gap-1.5">
                                                            <Badge
                                                                variant={
                                                                    mailbox.active
                                                                        ? "success"
                                                                        : "danger"
                                                                }
                                                                dot
                                                            >
                                                                {mailbox.active
                                                                    ? "Active"
                                                                    : "Disabled"}
                                                            </Badge>
                                                            {mailbox.isGlobalAdmin && (
                                                                <Badge variant="info">
                                                                    Admin
                                                                </Badge>
                                                            )}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-3 text-right">
                                                        <div className="flex items-center justify-end gap-2">
                                                            <Button
                                                                size="xs"
                                                                variant="outline"
                                                                onClick={() =>
                                                                    openMailbox(
                                                                        mailbox.email
                                                                    )
                                                                }
                                                                icon={
                                                                    <ArrowRightOnRectangleIcon className="h-3.5 w-3.5" />
                                                                }
                                                            >
                                                                Open
                                                            </Button>
                                                            <Button
                                                                size="xs"
                                                                variant="ghost"
                                                                onClick={() =>
                                                                    setDetailEmail(
                                                                        mailbox.email
                                                                    )
                                                                }
                                                            >
                                                                Manage
                                                            </Button>
                                                            <Dropdown
                                                                items={rowActions(
                                                                    mailbox
                                                                )}
                                                                trigger={
                                                                    <Button
                                                                        size="xs"
                                                                        variant="ghost"
                                                                        aria-label={`Actions for ${mailbox.email}`}
                                                                        icon={
                                                                            <EllipsisHorizontalIcon className="h-4 w-4" />
                                                                        }
                                                                    />
                                                                }
                                                            />
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="flex items-center justify-between gap-4 border-t border-line px-6 py-3">
                                    <span className="text-xs text-content-subtle">
                                        Showing {rangeStart}–{rangeEnd} of{" "}
                                        {total}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            size="xs"
                                            variant="outline"
                                            disabled={offset === 0}
                                            onClick={() =>
                                                setOffset((current) =>
                                                    Math.max(
                                                        0,
                                                        current - PAGE_SIZE
                                                    )
                                                )
                                            }
                                        >
                                            Previous
                                        </Button>
                                        <Button
                                            size="xs"
                                            variant="outline"
                                            disabled={rangeEnd >= total}
                                            onClick={() =>
                                                setOffset(
                                                    (current) =>
                                                        current + PAGE_SIZE
                                                )
                                            }
                                        >
                                            Next
                                        </Button>
                                    </div>
                                </div>
                            </>
                        )}
                    </>
                )}
            </Card>

            <MailboxFormModal
                isOpen={isFormOpen}
                onClose={() => setIsFormOpen(false)}
                mailbox={formMailbox}
                passwordOnly={isPasswordOnly}
            />

            <MailboxDetailDrawer
                isOpen={Boolean(detailEmail)}
                onClose={() => setDetailEmail(null)}
                email={detailEmail}
                onEdit={(mailbox) => {
                    setDetailEmail(null);
                    openForm(mailbox);
                }}
                onResetPassword={(mailbox) => {
                    setDetailEmail(null);
                    openForm(mailbox, true);
                }}
            />

            <Modal
                isOpen={Boolean(deleteTarget)}
                onClose={() => setDeleteTarget(null)}
                title={`Delete ${deleteTarget?.email}`}
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
                                deleteTarget?.email
                            }
                            onClick={() =>
                                deleteTarget &&
                                deleteMutation.mutate(deleteTarget.email)
                            }
                        >
                            Delete mailbox
                        </Button>
                    </>
                }
            >
                <div className="space-y-4">
                    <div className="flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 p-3 text-sm text-danger-800">
                        <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />
                        <span>
                            The account is removed immediately and its maildir
                            is scheduled for deletion from disk. Stored mail
                            cannot be recovered afterwards.
                        </span>
                    </div>

                    <Input
                        label={`Type ${deleteTarget?.email} to confirm`}
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

export default UsersPage;
