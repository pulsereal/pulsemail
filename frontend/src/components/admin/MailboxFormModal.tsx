import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import toast from "react-hot-toast";
import Button from "../common/Button";
import Checkbox from "../common/Checkbox";
import Input from "../common/Input";
import Modal from "../common/Modal";
import Select from "../common/Select";
import { provisioningAPI } from "../../services/api";
import { useAuthStore } from "../../stores/authStore";
import type { Domain, ProvisionedMailbox } from "../../types";

interface MailboxFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    mailbox?: ProvisionedMailbox | null;
    /** Row action shortcut: show only the password reset fields. */
    passwordOnly?: boolean;
}

interface MailboxFormState {
    localPart: string;
    domain: string;
    password: string;
    confirmPassword: string;
    name: string;
    firstName: string;
    lastName: string;
    department: string;
    quotaMb: string;
    active: boolean;
    isGlobalAdmin: boolean;
}

const emptyForm: MailboxFormState = {
    localPart: "",
    domain: "",
    password: "",
    confirmPassword: "",
    name: "",
    firstName: "",
    lastName: "",
    department: "",
    quotaMb: "1024",
    active: true,
    isGlobalAdmin: false,
};

const LOCAL_PART_PATTERN = /^[a-z0-9._%+-]+$/i;

const passwordStrength = (password: string) => {
    if (!password) return null;

    const score = [
        password.length >= 12,
        /[A-Z]/.test(password),
        /[a-z]/.test(password),
        /\d/.test(password),
        /[^A-Za-z0-9]/.test(password),
    ].filter(Boolean).length;

    if (password.length < 8)
        return { label: "Too short", tone: "text-danger-600" };
    if (score <= 2) return { label: "Weak password", tone: "text-danger-600" };
    if (score === 3)
        return { label: "Fair password", tone: "text-warning-600" };
    if (score === 4)
        return { label: "Good password", tone: "text-success-600" };
    return { label: "Strong password", tone: "text-success-600" };
};

const MailboxFormModal: React.FC<MailboxFormModalProps> = ({
    isOpen,
    onClose,
    mailbox,
    passwordOnly = false,
}) => {
    const queryClient = useQueryClient();
    const viewer = useAuthStore((state) => state.user);
    const viewerIsGlobalAdmin = viewer?.adminType === "global";

    const isEdit = Boolean(mailbox);
    const [form, setForm] = useState<MailboxFormState>(emptyForm);
    const [error, setError] = useState<string | null>(null);
    const [resettingPassword, setResettingPassword] = useState(false);

    const showPasswordFields = passwordOnly || !isEdit || resettingPassword;

    const domainsQuery = useQuery(
        ["provision-domains", ""],
        () => provisioningAPI.getDomains().then((response) => response.data),
        { enabled: isOpen && !isEdit }
    );

    const domains: Domain[] = domainsQuery.data?.domains ?? [];

    const domainOptions = useMemo(
        () =>
            domains
                .filter((domain) => domain.active)
                .map((domain) => ({
                    value: domain.domain,
                    label: domain.domain,
                })),
        [domains]
    );

    useEffect(() => {
        if (!isOpen) return;

        setError(null);
        setResettingPassword(false);
        setForm(
            mailbox
                ? {
                      ...emptyForm,
                      localPart: mailbox.email.split("@")[0] ?? "",
                      domain: mailbox.domain,
                      name: mailbox.name ?? "",
                      firstName: mailbox.firstName ?? "",
                      lastName: mailbox.lastName ?? "",
                      department: mailbox.department ?? "",
                      quotaMb: String(mailbox.quotaMb ?? 0),
                      active: mailbox.active !== false,
                      isGlobalAdmin: Boolean(mailbox.isGlobalAdmin),
                  }
                : emptyForm
        );
    }, [isOpen, mailbox]);

    // Default the quota and domain from the first available domain.
    useEffect(() => {
        if (isEdit || domains.length === 0) return;

        setForm((current) => {
            if (current.domain) return current;
            const first = domains.find((domain) => domain.active) ?? domains[0];
            return {
                ...current,
                domain: first.domain,
                quotaMb: String(first.defaultUserQuotaMb ?? 0),
            };
        });
    }, [domains, isEdit]);

    const update = <K extends keyof MailboxFormState>(
        key: K,
        next: MailboxFormState[K]
    ) => setForm((current) => ({ ...current, [key]: next }));

    const selectDomain = (nextDomain: string) => {
        const match = domains.find((domain) => domain.domain === nextDomain);
        setForm((current) => ({
            ...current,
            domain: nextDomain,
            quotaMb: match
                ? String(match.defaultUserQuotaMb ?? 0)
                : current.quotaMb,
        }));
    };

    const invalidate = () => {
        void queryClient.invalidateQueries("provision-mailboxes");
        void queryClient.invalidateQueries("provision-domains");
        if (mailbox) {
            void queryClient.invalidateQueries([
                "provision-mailbox",
                mailbox.email,
            ]);
        }
    };

    const quotaMb = () => {
        const parsed = Number(form.quotaMb);
        return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
    };

    const profilePayload = () => ({
        name: form.name.trim(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        department: form.department.trim(),
        quotaMb: quotaMb(),
        active: form.active,
        ...(viewerIsGlobalAdmin ? { isGlobalAdmin: form.isGlobalAdmin } : {}),
    });

    const createMutation = useMutation(
        () =>
            provisioningAPI.createMailbox({
                email: `${form.localPart.trim().toLowerCase()}@${form.domain}`,
                password: form.password,
                ...profilePayload(),
            }),
        {
            onSuccess: () => {
                invalidate();
                toast.success("Mailbox created");
                onClose();
            },
        }
    );

    const updateMutation = useMutation(
        () =>
            provisioningAPI.updateMailbox(
                mailbox?.email ?? "",
                profilePayload()
            ),
        {
            onSuccess: () => {
                invalidate();
                toast.success("Mailbox updated");
                onClose();
            },
        }
    );

    const passwordMutation = useMutation(
        () =>
            provisioningAPI.setMailboxPassword(
                mailbox?.email ?? "",
                form.password
            ),
        {
            onSuccess: () => {
                invalidate();
                toast.success("Password updated");
                if (passwordOnly) onClose();
                else {
                    setResettingPassword(false);
                    update("password", "");
                    update("confirmPassword", "");
                }
            },
        }
    );

    const validatePassword = () => {
        if (form.password.length < 8) {
            setError("Password must be at least 8 characters");
            return false;
        }
        if (form.password !== form.confirmPassword) {
            setError("Passwords do not match");
            return false;
        }
        return true;
    };

    const submit = (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);

        if (passwordOnly || (isEdit && resettingPassword)) {
            if (!validatePassword()) return;
            passwordMutation.mutate();
            return;
        }

        if (isEdit) {
            updateMutation.mutate();
            return;
        }

        const localPart = form.localPart.trim().toLowerCase();
        if (!LOCAL_PART_PATTERN.test(localPart)) {
            setError("The part before @ contains unsupported characters");
            return;
        }
        if (!form.domain) {
            setError("Choose a domain for this mailbox");
            return;
        }
        if (!validatePassword()) return;

        createMutation.mutate();
    };

    const saving =
        createMutation.isLoading ||
        updateMutation.isLoading ||
        passwordMutation.isLoading;

    const strength = showPasswordFields
        ? passwordStrength(form.password)
        : null;

    const title = passwordOnly
        ? `Reset password for ${mailbox?.email}`
        : isEdit
          ? `Edit ${mailbox?.email}`
          : "Add mailbox";

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={title}
            description={
                passwordOnly
                    ? "The owner will need the new password in every connected mail client."
                    : isEdit
                      ? "Profile, quota, and access for this mailbox."
                      : "Provision a new mailbox in one of your domains."
            }
            size="lg"
            actions={
                <>
                    <Button variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button type="submit" form="mailbox-form" loading={saving}>
                        {passwordOnly || (isEdit && resettingPassword)
                            ? "Set password"
                            : isEdit
                              ? "Save changes"
                              : "Create mailbox"}
                    </Button>
                </>
            }
        >
            <form id="mailbox-form" onSubmit={submit} className="space-y-5">
                {!isEdit && (
                    <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
                        <Input
                            label="Address"
                            value={form.localPart}
                            autoFocus
                            placeholder="jane.doe"
                            onChange={(event) =>
                                update("localPart", event.target.value)
                            }
                        />
                        <Select
                            label="Domain"
                            value={form.domain}
                            options={
                                domainOptions.length > 0
                                    ? domainOptions
                                    : [
                                          {
                                              value: "",
                                              label: domainsQuery.isLoading
                                                  ? "Loading…"
                                                  : "No domains available",
                                          },
                                      ]
                            }
                            onChange={(event) =>
                                selectDomain(event.target.value)
                            }
                        />
                    </div>
                )}

                {showPasswordFields && (
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                            <Input
                                label="Password"
                                type="password"
                                autoComplete="new-password"
                                value={form.password}
                                onChange={(event) =>
                                    update("password", event.target.value)
                                }
                            />
                            {strength && (
                                <p
                                    className={`mt-1.5 text-sm ${strength.tone}`}
                                >
                                    {strength.label}
                                </p>
                            )}
                        </div>
                        <Input
                            label="Confirm password"
                            type="password"
                            autoComplete="new-password"
                            value={form.confirmPassword}
                            helpText="At least 8 characters."
                            onChange={(event) =>
                                update("confirmPassword", event.target.value)
                            }
                        />
                    </div>
                )}

                {isEdit && !passwordOnly && !resettingPassword && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setResettingPassword(true)}
                    >
                        Reset password
                    </Button>
                )}

                {!passwordOnly && (
                    <>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Input
                                label="Display name"
                                value={form.name}
                                placeholder="Jane Doe"
                                onChange={(event) =>
                                    update("name", event.target.value)
                                }
                            />
                            <Input
                                label="Department"
                                value={form.department}
                                placeholder="Support"
                                onChange={(event) =>
                                    update("department", event.target.value)
                                }
                            />
                            <Input
                                label="First name"
                                value={form.firstName}
                                onChange={(event) =>
                                    update("firstName", event.target.value)
                                }
                            />
                            <Input
                                label="Last name"
                                value={form.lastName}
                                onChange={(event) =>
                                    update("lastName", event.target.value)
                                }
                            />
                        </div>

                        <Input
                            label="Quota (MB)"
                            type="number"
                            min={0}
                            value={form.quotaMb}
                            helpText="0 means unlimited."
                            onChange={(event) =>
                                update("quotaMb", event.target.value)
                            }
                        />

                        <div className="space-y-3">
                            <Checkbox
                                label="Mailbox is active"
                                description="Inactive mailboxes cannot sign in or receive mail."
                                checked={form.active}
                                onChange={(event) =>
                                    update("active", event.target.checked)
                                }
                            />
                            {viewerIsGlobalAdmin && (
                                <Checkbox
                                    label="Global administrator"
                                    description="Full access to every domain and mailbox on this server."
                                    checked={form.isGlobalAdmin}
                                    onChange={(event) =>
                                        update(
                                            "isGlobalAdmin",
                                            event.target.checked
                                        )
                                    }
                                />
                            )}
                        </div>
                    </>
                )}

                {error && <p className="text-sm text-danger-600">{error}</p>}
            </form>
        </Modal>
    );
};

export default MailboxFormModal;
