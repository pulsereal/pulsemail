import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import toast from "react-hot-toast";
import Button from "../common/Button";
import Checkbox from "../common/Checkbox";
import Input from "../common/Input";
import Modal from "../common/Modal";
import Select from "../common/Select";
import AddressListEditor from "./AddressListEditor";
import { provisioningAPI } from "../../services/api";
import type { Domain, MailAlias } from "../../types";

interface AliasFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    alias?: MailAlias | null;
}

const LOCAL_PART_PATTERN = /^[a-z0-9._%+-]+$/i;

const AliasFormModal: React.FC<AliasFormModalProps> = ({
    isOpen,
    onClose,
    alias,
}) => {
    const queryClient = useQueryClient();
    const isEdit = Boolean(alias);

    const [localPart, setLocalPart] = useState("");
    const [domain, setDomain] = useState("");
    const [name, setName] = useState("");
    const [active, setActive] = useState(true);
    const [members, setMembers] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);

    const domainsQuery = useQuery(
        ["provision-domains", ""],
        () => provisioningAPI.getDomains().then((response) => response.data),
        { enabled: isOpen && !isEdit }
    );

    const domains: Domain[] = domainsQuery.data?.domains ?? [];

    const domainOptions = useMemo(
        () =>
            domains
                .filter((entry) => entry.active)
                .map((entry) => ({ value: entry.domain, label: entry.domain })),
        [domains]
    );

    useEffect(() => {
        if (!isOpen) return;

        setError(null);
        setLocalPart(alias ? (alias.address.split("@")[0] ?? "") : "");
        setDomain(alias?.domain ?? "");
        setName(alias?.name ?? "");
        setActive(alias ? alias.active !== false : true);
        setMembers(alias?.members ?? []);
    }, [isOpen, alias]);

    useEffect(() => {
        if (isEdit || domainOptions.length === 0) return;
        setDomain((current) => current || domainOptions[0].value);
    }, [domainOptions, isEdit]);

    const invalidate = () => {
        void queryClient.invalidateQueries("provision-aliases");
        void queryClient.invalidateQueries("provision-domains");
    };

    const address = isEdit
        ? (alias?.address ?? "")
        : `${localPart.trim().toLowerCase()}@${domain}`;

    const createMutation = useMutation(
        () =>
            provisioningAPI.createAlias({
                address,
                name: name.trim(),
                members,
                active,
            }),
        {
            onSuccess: () => {
                invalidate();
                toast.success(`${address} created`);
                onClose();
            },
        }
    );

    const updateMutation = useMutation(
        () =>
            provisioningAPI.updateAlias(address, {
                name: name.trim(),
                members,
                active,
            }),
        {
            onSuccess: () => {
                invalidate();
                toast.success("Alias updated");
                onClose();
            },
        }
    );

    const submit = (event: React.FormEvent) => {
        event.preventDefault();

        if (!isEdit) {
            if (!LOCAL_PART_PATTERN.test(localPart.trim())) {
                setError("The part before @ contains unsupported characters");
                return;
            }
            if (!domain) {
                setError("Choose a domain for this alias");
                return;
            }
        }

        setError(null);
        if (isEdit) updateMutation.mutate();
        else createMutation.mutate();
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={isEdit ? `Edit ${alias?.address}` : "Add alias"}
            description="Mail sent to this address is delivered to every member below."
            size="lg"
            actions={
                <>
                    <Button variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        form="alias-form"
                        loading={
                            createMutation.isLoading || updateMutation.isLoading
                        }
                    >
                        {isEdit ? "Save changes" : "Create alias"}
                    </Button>
                </>
            }
        >
            <form id="alias-form" onSubmit={submit} className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
                    <Input
                        label="Address"
                        value={localPart}
                        disabled={isEdit}
                        autoFocus={!isEdit}
                        placeholder="support"
                        error={error ?? undefined}
                        onChange={(event) => setLocalPart(event.target.value)}
                    />
                    <Select
                        label="Domain"
                        value={domain}
                        disabled={isEdit}
                        options={
                            isEdit
                                ? [{ value: domain, label: domain }]
                                : domainOptions.length > 0
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
                        onChange={(event) => setDomain(event.target.value)}
                    />
                </div>

                <Input
                    label="Display name"
                    value={name}
                    placeholder="Support team"
                    onChange={(event) => setName(event.target.value)}
                />

                <AddressListEditor
                    label="Members"
                    value={members}
                    onChange={setMembers}
                    description="Each member receives a copy of every message sent to this address."
                />

                <Checkbox
                    label="Alias is active"
                    description="Inactive aliases reject incoming mail."
                    checked={active}
                    onChange={(event) => setActive(event.target.checked)}
                />
            </form>
        </Modal>
    );
};

export default AliasFormModal;
