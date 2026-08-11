import React, { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "react-query";
import toast from "react-hot-toast";
import Button from "../common/Button";
import Checkbox from "../common/Checkbox";
import Input from "../common/Input";
import Modal from "../common/Modal";
import Textarea from "../common/Textarea";
import { provisioningAPI } from "../../services/api";
import type { Domain } from "../../types";

interface DomainFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    domain?: Domain | null;
}

interface DomainFormState {
    domain: string;
    description: string;
    maxMailboxes: string;
    maxAliases: string;
    maxQuotaMb: string;
    defaultUserQuotaMb: string;
    active: boolean;
}

const HOSTNAME_PATTERN =
    /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

const emptyForm: DomainFormState = {
    domain: "",
    description: "",
    maxMailboxes: "0",
    maxAliases: "0",
    maxQuotaMb: "0",
    defaultUserQuotaMb: "1024",
    active: true,
};

const toNumber = (raw: string) => {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
};

const UNLIMITED_HINT = "0 means unlimited.";

const DomainFormModal: React.FC<DomainFormModalProps> = ({
    isOpen,
    onClose,
    domain,
}) => {
    const queryClient = useQueryClient();
    const isEdit = Boolean(domain);
    const [form, setForm] = useState<DomainFormState>(emptyForm);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) return;

        setError(null);
        setForm(
            domain
                ? {
                      domain: domain.domain,
                      description: domain.description ?? "",
                      maxMailboxes: String(domain.maxMailboxes ?? 0),
                      maxAliases: String(domain.maxAliases ?? 0),
                      maxQuotaMb: String(domain.maxQuotaMb ?? 0),
                      defaultUserQuotaMb: String(
                          domain.defaultUserQuotaMb ?? 0
                      ),
                      active: domain.active !== false,
                  }
                : emptyForm
        );
    }, [isOpen, domain]);

    const update = <K extends keyof DomainFormState>(
        key: K,
        next: DomainFormState[K]
    ) => setForm((current) => ({ ...current, [key]: next }));

    const invalidate = () => {
        void queryClient.invalidateQueries("provision-domains");
        if (domain) {
            void queryClient.invalidateQueries([
                "provision-domain",
                domain.domain,
            ]);
        }
    };

    const payload = () => ({
        description: form.description.trim(),
        maxMailboxes: toNumber(form.maxMailboxes),
        maxAliases: toNumber(form.maxAliases),
        maxQuotaMb: toNumber(form.maxQuotaMb),
        defaultUserQuotaMb: toNumber(form.defaultUserQuotaMb),
        active: form.active,
    });

    const createMutation = useMutation(
        () =>
            provisioningAPI.createDomain({
                domain: form.domain.trim().toLowerCase(),
                ...payload(),
            }),
        {
            onSuccess: () => {
                invalidate();
                toast.success(`${form.domain.trim().toLowerCase()} created`);
                onClose();
            },
        }
    );

    const updateMutation = useMutation(
        () => provisioningAPI.updateDomain(domain?.domain ?? "", payload()),
        {
            onSuccess: () => {
                invalidate();
                toast.success("Domain updated");
                onClose();
            },
        }
    );

    const submit = (event: React.FormEvent) => {
        event.preventDefault();

        if (!isEdit) {
            const candidate = form.domain.trim().toLowerCase();
            if (!HOSTNAME_PATTERN.test(candidate)) {
                setError("Enter a valid domain name, for example acme.com");
                return;
            }
        }

        setError(null);
        if (isEdit) updateMutation.mutate();
        else createMutation.mutate();
    };

    const saving = createMutation.isLoading || updateMutation.isLoading;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={isEdit ? `Edit ${domain?.domain}` : "Add domain"}
            description={
                isEdit
                    ? "Limits apply to mailboxes created from now on as well as existing ones."
                    : "Create a mail domain in this iRedMail installation."
            }
            size="lg"
            actions={
                <>
                    <Button variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        form="domain-form"
                        loading={saving}
                        disabled={form.domain.trim().length === 0}
                    >
                        {isEdit ? "Save changes" : "Create domain"}
                    </Button>
                </>
            }
        >
            <form id="domain-form" onSubmit={submit} className="space-y-5">
                <Input
                    label="Domain"
                    value={form.domain}
                    disabled={isEdit}
                    autoFocus={!isEdit}
                    placeholder="acme.com"
                    error={error ?? undefined}
                    helpText={
                        isEdit
                            ? "The domain name cannot be changed after creation."
                            : undefined
                    }
                    onChange={(event) => update("domain", event.target.value)}
                />

                <Textarea
                    label="Description"
                    rows={2}
                    value={form.description}
                    placeholder="Optional note for other administrators"
                    onChange={(event) =>
                        update("description", event.target.value)
                    }
                />

                <div className="grid gap-4 sm:grid-cols-2">
                    <Input
                        label="Mailbox limit"
                        type="number"
                        min={0}
                        value={form.maxMailboxes}
                        helpText={`Maximum mailboxes in this domain. ${UNLIMITED_HINT}`}
                        onChange={(event) =>
                            update("maxMailboxes", event.target.value)
                        }
                    />
                    <Input
                        label="Alias limit"
                        type="number"
                        min={0}
                        value={form.maxAliases}
                        helpText={`Maximum alias addresses. ${UNLIMITED_HINT}`}
                        onChange={(event) =>
                            update("maxAliases", event.target.value)
                        }
                    />
                    <Input
                        label="Domain quota (MB)"
                        type="number"
                        min={0}
                        value={form.maxQuotaMb}
                        helpText={`Total storage across every mailbox. ${UNLIMITED_HINT}`}
                        onChange={(event) =>
                            update("maxQuotaMb", event.target.value)
                        }
                    />
                    <Input
                        label="Default mailbox quota (MB)"
                        type="number"
                        min={0}
                        value={form.defaultUserQuotaMb}
                        helpText={`Pre-filled when creating a mailbox here. ${UNLIMITED_HINT}`}
                        onChange={(event) =>
                            update("defaultUserQuotaMb", event.target.value)
                        }
                    />
                </div>

                <Checkbox
                    label="Domain is active"
                    description="Inactive domains stop accepting and delivering mail."
                    checked={form.active}
                    onChange={(event) => update("active", event.target.checked)}
                />
            </form>
        </Modal>
    );
};

export default DomainFormModal;
