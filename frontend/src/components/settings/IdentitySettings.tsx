import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import toast from "react-hot-toast";
import {
    IdentificationIcon,
    PencilSquareIcon,
    PlusIcon,
    TrashIcon,
} from "@heroicons/react/24/outline";
import { mailboxAPI } from "../../services/api";
import { useAuthStore, useIsImpersonating } from "../../stores/authStore";
import type { Identity } from "../../types";
import RichTextEditor from "../mail/RichTextEditor";
import Badge from "../common/Badge";
import Button from "../common/Button";
import Card, { CardHeader } from "../common/Card";
import Checkbox from "../common/Checkbox";
import EmptyState from "../common/EmptyState";
import ErrorState from "../common/ErrorState";
import Input from "../common/Input";
import Modal from "../common/Modal";
import Select from "../common/Select";
import { SkeletonList } from "../common/Skeleton";

/** Signatures are stored as HTML; the list only needs a one-line gist. */
const signaturePreview = (signature: string) => {
    const text = signature
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (!text) return "";
    return text.length > 120 ? `${text.slice(0, 120)}…` : text;
};

const IdentitySettings: React.FC = () => {
    const queryClient = useQueryClient();
    const activeMailbox = useAuthStore((state) => state.activeMailbox);
    const ownEmail = useAuthStore((state) => state.user?.email ?? null);
    const impersonating = useIsImpersonating();
    const scope = activeMailbox || ownEmail || "self";

    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<Identity | null>(null);
    const [fromAddress, setFromAddress] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [signature, setSignature] = useState("");
    const [isDefault, setIsDefault] = useState(false);
    const [addressError, setAddressError] = useState("");

    const identitiesQuery = useQuery(["mailbox-identities", scope], () =>
        mailboxAPI.getIdentities().then((response) => response.data)
    );

    const identities: Identity[] = identitiesQuery.data?.identities ?? [];
    const availableAddresses: string[] =
        identitiesQuery.data?.availableAddresses ?? [];

    useEffect(() => {
        if (!modalOpen) return;
        setFromAddress(editing?.fromAddress ?? availableAddresses[0] ?? "");
        setDisplayName(editing?.displayName ?? "");
        setSignature(editing?.signature ?? "");
        setIsDefault(editing?.isDefault ?? identities.length === 0);
        setAddressError("");
        // Re-seeding on every list change would clobber in-progress edits.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [modalOpen, editing]);

    const save = useMutation(
        () =>
            mailboxAPI.saveIdentity({
                fromAddress,
                displayName: displayName.trim(),
                signature,
                isDefault,
            }),
        {
            onSuccess: () => {
                queryClient.invalidateQueries("mailbox-identities");
                toast.success(editing ? "Identity updated" : "Identity added");
                setModalOpen(false);
            },
        }
    );

    const remove = useMutation((id: number) => mailboxAPI.deleteIdentity(id), {
        onSuccess: () => {
            queryClient.invalidateQueries("mailbox-identities");
            toast.success("Identity deleted");
        },
    });

    const openNew = () => {
        setEditing(null);
        setModalOpen(true);
    };

    const openEdit = (identity: Identity) => {
        setEditing(identity);
        setModalOpen(true);
    };

    const handleDelete = (identity: Identity) => {
        if (window.confirm(`Delete the identity ${identity.fromAddress}?`)) {
            remove.mutate(identity.id);
        }
    };

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        if (!fromAddress) {
            setAddressError("Choose an address to send from.");
            return;
        }
        save.mutate();
    };

    const canAdd = availableAddresses.length > 0;

    return (
        <div className="space-y-6">
            <Card padded={false}>
                <CardHeader
                    title={
                        <span className="flex items-center gap-2">
                            <IdentificationIcon className="h-5 w-5 text-content-subtle" />
                            Sending identities
                            {impersonating && (
                                <Badge variant="warning">
                                    Editing {activeMailbox}
                                </Badge>
                            )}
                        </span>
                    }
                    description="You may only send as your own address or an alias that resolves to it — the server rejects anything else."
                    actions={
                        <Button
                            size="sm"
                            icon={<PlusIcon className="h-4 w-4" />}
                            onClick={openNew}
                            disabled={!canAdd}
                        >
                            Add identity
                        </Button>
                    }
                />

                {identitiesQuery.isLoading ? (
                    <div className="p-5">
                        <SkeletonList rows={2} />
                    </div>
                ) : identitiesQuery.isError ? (
                    <ErrorState
                        title="Unable to load your identities"
                        error={identitiesQuery.error}
                        onRetry={() => identitiesQuery.refetch()}
                    />
                ) : identities.length === 0 ? (
                    <EmptyState
                        icon={IdentificationIcon}
                        title="No identities yet"
                        description="Add one to control the display name and signature used when you send mail."
                        action={
                            <Button
                                icon={<PlusIcon className="h-4 w-4" />}
                                onClick={openNew}
                                disabled={!canAdd}
                            >
                                Add identity
                            </Button>
                        }
                    />
                ) : (
                    <ul className="divide-y divide-line">
                        {identities.map((identity) => {
                            const preview = signaturePreview(
                                identity.signature || ""
                            );

                            return (
                                <li
                                    key={identity.id}
                                    className="flex items-start gap-4 px-5 py-4"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <p className="truncate text-sm font-medium text-content">
                                                {identity.fromAddress}
                                            </p>
                                            {identity.isDefault && (
                                                <Badge variant="info" size="xs">
                                                    Default
                                                </Badge>
                                            )}
                                        </div>
                                        {identity.displayName && (
                                            <p className="mt-0.5 truncate text-sm text-content-muted">
                                                {identity.displayName}
                                            </p>
                                        )}
                                        <p className="mt-1 truncate text-sm text-content-subtle">
                                            {preview || "No signature"}
                                        </p>
                                    </div>

                                    <div className="flex shrink-0 items-center gap-1">
                                        <Button
                                            variant="ghost"
                                            size="xs"
                                            onClick={() => openEdit(identity)}
                                            icon={
                                                <PencilSquareIcon className="h-4 w-4" />
                                            }
                                        >
                                            Edit
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="xs"
                                            className="text-danger-600 hover:bg-danger-50 hover:text-danger-700"
                                            onClick={() =>
                                                handleDelete(identity)
                                            }
                                            icon={
                                                <TrashIcon className="h-4 w-4" />
                                            }
                                        >
                                            Delete
                                        </Button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}

                {!canAdd && identities.length > 0 && (
                    <p className="border-t border-line px-5 py-3 text-sm text-content-subtle">
                        Every address you are allowed to send from already has
                        an identity.
                    </p>
                )}
            </Card>

            <Modal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                title={editing ? "Edit identity" : "Add identity"}
                size="xl"
                actions={
                    <>
                        <Button
                            variant="outline"
                            onClick={() => setModalOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            form="identity-form"
                            loading={save.isLoading}
                        >
                            Save identity
                        </Button>
                    </>
                }
            >
                <form
                    id="identity-form"
                    onSubmit={handleSubmit}
                    className="space-y-5"
                >
                    {editing ? (
                        <Input
                            label="From address"
                            value={editing.fromAddress}
                            disabled
                            helpText="Delete this identity and add a new one to use a different address."
                        />
                    ) : (
                        <Select
                            label="From address"
                            options={availableAddresses.map((address) => ({
                                value: address,
                                label: address,
                            }))}
                            value={fromAddress}
                            onChange={(event) => {
                                setFromAddress(event.target.value);
                                setAddressError("");
                            }}
                            error={addressError}
                        />
                    )}

                    <Input
                        label="Display name"
                        placeholder="Sarah Chen"
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                        helpText="Shown to recipients next to the address."
                    />

                    <div>
                        <p className="mb-1.5 block text-sm font-medium text-content">
                            Signature
                        </p>
                        <RichTextEditor
                            value={signature}
                            onChange={setSignature}
                            placeholder="Sarah Chen — Support"
                        />
                    </div>

                    <Checkbox
                        label="Make this the default identity"
                        description="Used automatically when you compose a new message."
                        checked={isDefault}
                        onChange={(event) => setIsDefault(event.target.checked)}
                    />
                </form>
            </Modal>
        </div>
    );
};

export default IdentitySettings;
