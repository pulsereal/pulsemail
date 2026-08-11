import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import toast from "react-hot-toast";
import {
    ExclamationTriangleIcon,
    PaperAirplaneIcon,
    SunIcon,
} from "@heroicons/react/24/outline";
import { mailboxAPI } from "../../services/api";
import { useAuthStore, useIsImpersonating } from "../../stores/authStore";
import type { VacationSettings } from "../../types";
import Badge from "../common/Badge";
import Button from "../common/Button";
import Card, { CardHeader } from "../common/Card";
import Checkbox from "../common/Checkbox";
import ErrorState from "../common/ErrorState";
import Input from "../common/Input";
import { SkeletonList } from "../common/Skeleton";
import Textarea from "../common/Textarea";

const DEFAULT_SUBJECT = "Out of office";

/** The API returns dates as ISO timestamps; `type="date"` wants `YYYY-MM-DD`. */
const toDateInput = (value: string | null | undefined) =>
    value ? value.slice(0, 10) : "";

interface PublishResult {
    published: boolean;
    publishError: string | null;
}

const VacationResponder: React.FC = () => {
    const queryClient = useQueryClient();
    const activeMailbox = useAuthStore((state) => state.activeMailbox);
    const ownEmail = useAuthStore((state) => state.user?.email ?? null);
    const impersonating = useIsImpersonating();
    const scope = activeMailbox || ownEmail || "self";

    const [enabled, setEnabled] = useState(false);
    const [subject, setSubject] = useState(DEFAULT_SUBJECT);
    const [body, setBody] = useState("");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [intervalDays, setIntervalDays] = useState("7");
    const [publish, setPublish] = useState<PublishResult | null>(null);

    const vacationQuery = useQuery(["mailbox-vacation", scope], () =>
        mailboxAPI.getVacation().then((response) => response.data)
    );

    const vacation: VacationSettings | undefined = vacationQuery.data?.vacation;

    useEffect(() => {
        if (!vacation) return;
        setEnabled(vacation.enabled);
        setSubject(vacation.subject || DEFAULT_SUBJECT);
        setBody(vacation.body || "");
        setStartDate(toDateInput(vacation.startDate));
        setEndDate(toDateInput(vacation.endDate));
        setIntervalDays(String(vacation.intervalDays ?? 7));
    }, [vacation]);

    const save = useMutation(
        () =>
            mailboxAPI
                .setVacation({
                    enabled,
                    subject: subject.trim() || DEFAULT_SUBJECT,
                    body,
                    startDate: startDate || null,
                    endDate: endDate || null,
                    intervalDays: Math.max(1, Number(intervalDays) || 7),
                })
                .then((response) => response.data),
        {
            onSuccess: (data) => {
                setPublish({
                    published: data.published !== false,
                    publishError: data.publishError ?? null,
                });
                queryClient.invalidateQueries("mailbox-vacation");
                queryClient.invalidateQueries("mailbox-filter-script");
                toast.success("Auto-responder saved");
            },
        }
    );

    if (vacationQuery.isLoading) {
        return (
            <Card>
                <SkeletonList rows={4} />
            </Card>
        );
    }

    if (vacationQuery.isError) {
        return (
            <Card>
                <ErrorState
                    title="Unable to load your auto-responder"
                    error={vacationQuery.error}
                    onRetry={() => vacationQuery.refetch()}
                />
            </Card>
        );
    }

    return (
        <form
            className="space-y-6"
            onSubmit={(event) => {
                event.preventDefault();
                save.mutate();
            }}
        >
            <Card padded={false}>
                <CardHeader
                    title={
                        <span className="flex items-center gap-2">
                            <SunIcon className="h-5 w-5 text-content-subtle" />
                            Out of office
                            {impersonating && (
                                <Badge variant="warning">
                                    Editing {activeMailbox}
                                </Badge>
                            )}
                        </span>
                    }
                    description="Dovecot replies on your behalf while you are away. Mailing lists and automated senders are skipped."
                />

                <div className="space-y-5 p-5">
                    <Checkbox
                        label="Send an automatic reply"
                        description="Turn this off to stop replying without losing the message below."
                        checked={enabled}
                        onChange={(event) => setEnabled(event.target.checked)}
                    />

                    {enabled && (
                        <div className="space-y-5 border-t border-line pt-5">
                            <Input
                                label="Subject"
                                value={subject}
                                onChange={(event) =>
                                    setSubject(event.target.value)
                                }
                                placeholder={DEFAULT_SUBJECT}
                            />

                            <Textarea
                                label="Message"
                                rows={6}
                                value={body}
                                onChange={(event) =>
                                    setBody(event.target.value)
                                }
                                placeholder="I am away until 12 March and will reply when I am back."
                                helpText="Sieve auto-replies are sent as plain text, so formatting is not preserved."
                            />

                            <div className="grid gap-5 md:grid-cols-3">
                                <Input
                                    label="Start date"
                                    type="date"
                                    value={startDate}
                                    onChange={(event) =>
                                        setStartDate(event.target.value)
                                    }
                                    helpText="Optional."
                                />
                                <Input
                                    label="End date"
                                    type="date"
                                    value={endDate}
                                    onChange={(event) =>
                                        setEndDate(event.target.value)
                                    }
                                    helpText="Optional."
                                />
                                <Input
                                    label="Reply at most once every"
                                    type="number"
                                    min={1}
                                    value={intervalDays}
                                    onChange={(event) =>
                                        setIntervalDays(event.target.value)
                                    }
                                    helpText="Days before the same sender is answered again."
                                />
                            </div>
                        </div>
                    )}
                </div>
            </Card>

            {publish && !publish.published && (
                <div className="rounded-xl border border-warning-200 bg-warning-50 p-4">
                    <div className="flex gap-3">
                        <ExclamationTriangleIcon className="h-5 w-5 shrink-0 text-warning-600" />
                        <div className="min-w-0">
                            <h4 className="text-sm font-medium text-warning-800">
                                Saved, but not yet active on the server
                            </h4>
                            <p className="mt-1 text-sm text-warning-700">
                                Dovecot did not accept the generated Sieve
                                script, so replies will not be sent until it
                                does. Your settings are stored and will be
                                published on the next successful save.
                            </p>
                            {publish.publishError && (
                                <p className="mt-2 break-words font-mono text-xs text-warning-800">
                                    {publish.publishError}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {enabled && (
                <Card padded={false}>
                    <CardHeader
                        title={
                            <span className="flex items-center gap-2">
                                <PaperAirplaneIcon className="h-5 w-5 text-content-subtle" />
                                Preview
                            </span>
                        }
                        description="What people who email you will receive."
                    />
                    <div className="p-5">
                        <div className="rounded-lg border border-line bg-surface-sunken p-4">
                            <p className="text-xs uppercase tracking-wide text-content-subtle">
                                From
                            </p>
                            <p className="text-sm font-medium text-content">
                                {activeMailbox || ownEmail}
                            </p>
                            <p className="mt-3 text-xs uppercase tracking-wide text-content-subtle">
                                Subject
                            </p>
                            <p className="text-sm font-medium text-content">
                                {subject.trim() || DEFAULT_SUBJECT}
                            </p>
                            <p className="mt-3 text-xs uppercase tracking-wide text-content-subtle">
                                Message
                            </p>
                            <p className="whitespace-pre-wrap text-sm text-content-muted">
                                {body.trim() || "I am currently away."}
                            </p>
                        </div>
                    </div>
                </Card>
            )}

            <div className="flex justify-end">
                <Button type="submit" loading={save.isLoading}>
                    Save auto-responder
                </Button>
            </div>
        </form>
    );
};

export default VacationResponder;
