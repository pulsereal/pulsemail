import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import toast from "react-hot-toast";
import {
    ArrowUturnRightIcon,
    ExclamationTriangleIcon,
    XMarkIcon,
} from "@heroicons/react/24/outline";
import { mailboxAPI } from "../../services/api";
import { useAuthStore, useIsImpersonating } from "../../stores/authStore";
import type { MailboxForwarding } from "../../types";
import Badge from "../common/Badge";
import Button from "../common/Button";
import Card, { CardHeader } from "../common/Card";
import Checkbox from "../common/Checkbox";
import ErrorState from "../common/ErrorState";
import Input from "../common/Input";
import { SkeletonList } from "../common/Skeleton";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ForwardingSettings: React.FC = () => {
    const queryClient = useQueryClient();
    const activeMailbox = useAuthStore((state) => state.activeMailbox);
    const ownEmail = useAuthStore((state) => state.user?.email ?? null);
    const impersonating = useIsImpersonating();
    const scope = activeMailbox || ownEmail || "self";

    const [destinations, setDestinations] = useState<string[]>([]);
    const [keepCopy, setKeepCopy] = useState(true);
    const [draft, setDraft] = useState("");
    const [draftError, setDraftError] = useState("");

    const forwardingQuery = useQuery(["mailbox-forwarding", scope], () =>
        mailboxAPI.getForwarding().then((response) => response.data)
    );

    const forwarding: MailboxForwarding | undefined =
        forwardingQuery.data?.forwarding;

    useEffect(() => {
        if (!forwarding) return;
        setDestinations(forwarding.destinations || []);
        setKeepCopy(forwarding.keepCopy !== false);
    }, [forwarding]);

    const save = useMutation(
        () => mailboxAPI.setForwarding(destinations, keepCopy),
        {
            onSuccess: () => {
                queryClient.invalidateQueries("mailbox-forwarding");
                toast.success("Forwarding saved");
            },
        }
    );

    /** Commits whatever is in the input; returns false when it was rejected. */
    const commitDraft = (raw?: string) => {
        const value = (raw ?? draft).trim().toLowerCase().replace(/,$/, "");
        if (!value) {
            setDraft("");
            setDraftError("");
            return true;
        }

        if (!EMAIL_PATTERN.test(value)) {
            setDraftError(`"${value}" is not a valid email address.`);
            return false;
        }

        if (destinations.includes(value)) {
            setDraftError(`${value} is already on the list.`);
            return false;
        }

        setDestinations((current) => [...current, value]);
        setDraft("");
        setDraftError("");
        return true;
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            commitDraft();
        }
    };

    if (forwardingQuery.isLoading) {
        return (
            <Card>
                <SkeletonList rows={3} />
            </Card>
        );
    }

    if (forwardingQuery.isError) {
        return (
            <Card>
                <ErrorState
                    title="Unable to load your forwarding settings"
                    error={forwardingQuery.error}
                    onRetry={() => forwardingQuery.refetch()}
                />
            </Card>
        );
    }

    const forwardsWithoutCopy = destinations.length > 0 && !keepCopy;

    return (
        <form
            className="space-y-6"
            onSubmit={(event) => {
                event.preventDefault();
                if (!commitDraft()) return;
                save.mutate();
            }}
        >
            <Card padded={false}>
                <CardHeader
                    title={
                        <span className="flex items-center gap-2">
                            <ArrowUturnRightIcon className="h-5 w-5 text-content-subtle" />
                            Mail forwarding
                            {impersonating && (
                                <Badge variant="warning">
                                    Editing {activeMailbox}
                                </Badge>
                            )}
                        </span>
                    }
                    description="Incoming mail is copied to every address listed here as it is delivered."
                />

                <div className="space-y-5 p-5">
                    <div>
                        <p className="mb-2 text-sm font-medium text-content">
                            Forward to
                        </p>

                        {destinations.length > 0 ? (
                            <ul className="mb-3 flex flex-wrap gap-2">
                                {destinations.map((address) => (
                                    <li
                                        key={address}
                                        className="flex items-center gap-1.5 rounded-full border border-line bg-surface-sunken py-1 pl-3 pr-1.5 text-sm text-content"
                                    >
                                        <span className="truncate">
                                            {address}
                                        </span>
                                        <button
                                            type="button"
                                            aria-label={`Remove ${address}`}
                                            className="rounded-full p-0.5 text-content-subtle transition-colors hover:bg-surface-hover hover:text-danger-600"
                                            onClick={() =>
                                                setDestinations((current) =>
                                                    current.filter(
                                                        (item) =>
                                                            item !== address
                                                    )
                                                )
                                            }
                                        >
                                            <XMarkIcon className="h-4 w-4" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="mb-3 text-sm text-content-subtle">
                                No forwarding addresses. Mail is delivered here
                                only.
                            </p>
                        )}

                        <Input
                            aria-label="Add a forwarding address"
                            type="email"
                            placeholder="someone@example.com"
                            value={draft}
                            onChange={(event) => {
                                setDraft(event.target.value);
                                setDraftError("");
                            }}
                            onKeyDown={handleKeyDown}
                            onBlur={() => commitDraft()}
                            error={draftError}
                            helpText="Press Enter or type a comma to add each address."
                        />
                    </div>

                    <div className="border-t border-line pt-5">
                        <Checkbox
                            label="Keep a copy in this mailbox"
                            description="Recommended — otherwise nothing is stored on this server."
                            checked={keepCopy}
                            onChange={(event) =>
                                setKeepCopy(event.target.checked)
                            }
                        />
                    </div>

                    {forwardsWithoutCopy && (
                        <div className="rounded-xl border border-danger-200 bg-danger-50 p-4">
                            <div className="flex gap-3">
                                <ExclamationTriangleIcon className="h-5 w-5 shrink-0 text-danger-600" />
                                <div>
                                    <h4 className="text-sm font-medium text-danger-800">
                                        Incoming mail will not be stored here
                                    </h4>
                                    <p className="mt-1 text-sm text-danger-700">
                                        Every message is forwarded and then
                                        discarded. If a destination bounces or
                                        filters the mail as spam, it is gone for
                                        good.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </Card>

            <div className="flex justify-end">
                <Button type="submit" loading={save.isLoading}>
                    Save forwarding
                </Button>
            </div>
        </form>
    );
};

export default ForwardingSettings;
