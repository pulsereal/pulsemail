import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import toast from "react-hot-toast";
import {
    BoltIcon,
    CheckCircleIcon,
    ExclamationTriangleIcon,
    InboxArrowDownIcon,
    PlayIcon,
    SparklesIcon,
} from "@heroicons/react/24/outline";
import Badge from "../components/common/Badge";
import Button from "../components/common/Button";
import Card, { CardHeader } from "../components/common/Card";
import Checkbox from "../components/common/Checkbox";
import ErrorState, { errorMessage } from "../components/common/ErrorState";
import Input from "../components/common/Input";
import { SkeletonList } from "../components/common/Skeleton";
import StatCard from "../components/common/StatCard";
import Textarea from "../components/common/Textarea";
import { aiAPI } from "../services/api";
import type {
    ClassificationStats,
    ClassificationWorkerStatus,
    LLMConnectionTest,
    LLMSettings,
    LLMUsageDay,
} from "../types";

// Presets only fill in the base URL. The model still has to be named, because
// every endpoint exposes a different catalogue.
const PRESETS = [
    { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
    {
        label: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "openai/gpt-4o-mini",
    },
    { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.1-8b-instant" },
    { label: "Ollama (local)", baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.1" },
];

interface FormState {
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    model: string;
    classifyEnabled: boolean;
    summariesEnabled: boolean;
    repliesEnabled: boolean;
    importanceThreshold: number;
    snippetChars: number;
    batchSize: number;
    dailyLimit: number;
    lookbackDays: number;
    customInstructions: string;
}

const toForm = (settings: LLMSettings): FormState => ({
    enabled: settings.enabled,
    baseUrl: settings.base_url,
    apiKey: "",
    model: settings.model,
    classifyEnabled: settings.classify_enabled,
    summariesEnabled: settings.summaries_enabled,
    repliesEnabled: settings.replies_enabled,
    importanceThreshold: settings.importance_threshold,
    snippetChars: settings.snippet_chars,
    batchSize: settings.batch_size,
    dailyLimit: settings.daily_limit,
    lookbackDays: settings.lookback_days,
    customInstructions: settings.custom_instructions ?? "",
});

const AISettingsPage: React.FC = () => {
    const queryClient = useQueryClient();

    const [form, setForm] = useState<FormState | null>(null);
    const [test, setTest] = useState<LLMConnectionTest | null>(null);

    const settingsQuery = useQuery(["ai-settings"], () =>
        aiAPI.getSettings().then(
            (response) =>
                response.data as {
                    settings: LLMSettings;
                    worker: ClassificationWorkerStatus;
                }
        )
    );

    const usageQuery = useQuery(["ai-usage"], () =>
        aiAPI.getUsage(14).then(
            (response) =>
                response.data as {
                    usage: LLMUsageDay[];
                    today: number;
                    classifications: ClassificationStats;
                }
        )
    );

    // Seed the form once the saved settings arrive, and re-seed after a save.
    const settings = settingsQuery.data?.settings;
    useEffect(() => {
        if (settings) setForm(toForm(settings));
    }, [settings]);

    const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
        setForm((current) => (current ? { ...current, [key]: value } : current));

    const saveMutation = useMutation(
        (values: FormState) =>
            aiAPI.saveSettings({
                enabled: values.enabled,
                baseUrl: values.baseUrl,
                // Only send a key when one was typed, so saving the form does
                // not wipe a key the admin never sees.
                ...(values.apiKey ? { apiKey: values.apiKey } : {}),
                model: values.model,
                classifyEnabled: values.classifyEnabled,
                summariesEnabled: values.summariesEnabled,
                repliesEnabled: values.repliesEnabled,
                importanceThreshold: values.importanceThreshold,
                snippetChars: values.snippetChars,
                batchSize: values.batchSize,
                dailyLimit: values.dailyLimit,
                lookbackDays: values.lookbackDays,
                customInstructions: values.customInstructions || null,
            }),
        {
            onSuccess: () => {
                toast.success("AI settings saved");
                queryClient.invalidateQueries(["ai-settings"]);
            },
            onError: (error) => {
                toast.error(errorMessage(error));
            },
        }
    );

    const testMutation = useMutation(
        (values: FormState) =>
            aiAPI
                .testConnection({
                    baseUrl: values.baseUrl,
                    model: values.model,
                    ...(values.apiKey ? { apiKey: values.apiKey } : {}),
                })
                .then((response) => response.data.result as LLMConnectionTest),
        {
            onSuccess: (result) => {
                setTest(result);
                if (result.ok) toast.success("The endpoint responded");
                else toast.error(result.error || "The endpoint did not respond");
            },
            onError: (error) => {
                toast.error(errorMessage(error));
            },
        }
    );

    const runMutation = useMutation(() => aiAPI.runClassification(), {
        onSuccess: (response) => {
            const result = response.data.result as {
                scored?: number;
                mailboxes?: number;
                skipped?: string;
            };

            if (result.skipped) toast(`Nothing to do: ${result.skipped}`);
            else
                toast.success(
                    `Scored ${result.scored ?? 0} message(s) across ${result.mailboxes ?? 0} mailbox(es)`
                );

            queryClient.invalidateQueries(["ai-usage"]);
            queryClient.invalidateQueries(["ai-settings"]);
        },
        onError: (error) => {
            toast.error(errorMessage(error));
        },
    });

    if (settingsQuery.isLoading || !form) {
        return (
            <div className="space-y-6">
                <SkeletonList rows={4} />
            </div>
        );
    }

    if (settingsQuery.isError) {
        return (
            <ErrorState
                title="Could not load AI settings"
                error={settingsQuery.error}
                onRetry={() => {
                    settingsQuery.refetch();
                }}
            />
        );
    }

    const worker = settingsQuery.data?.worker;
    const stats = usageQuery.data?.classifications;
    const usedToday = usageQuery.data?.today ?? 0;

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="flex items-center gap-2 text-xl font-semibold text-content">
                        <SparklesIcon className="h-6 w-6 text-primary-600" />
                        AI inbox sorting
                    </h1>
                    <p className="mt-1 max-w-2xl text-sm text-content-muted">
                        Scores incoming mail for importance so users can open a
                        priority view. Messages are scored by a background job,
                        never while a mailbox is loading, so this cannot slow
                        the inbox down.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    {settings?.configured ? (
                        <Badge variant="success" dot>
                            Endpoint configured
                        </Badge>
                    ) : (
                        <Badge variant="default" dot>
                            Not configured
                        </Badge>
                    )}
                    {worker?.scheduled && (
                        <Badge variant="info" dot>
                            Classifier running
                        </Badge>
                    )}
                </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                    label="Messages scored"
                    value={stats?.classified ?? 0}
                    icon={InboxArrowDownIcon}
                    loading={usageQuery.isLoading}
                />
                <StatCard
                    label="Marked important"
                    value={stats?.important ?? 0}
                    icon={BoltIcon}
                    tone="warning"
                    loading={usageQuery.isLoading}
                />
                <StatCard
                    label="Mailboxes covered"
                    value={stats?.mailboxes ?? 0}
                    loading={usageQuery.isLoading}
                />
                <StatCard
                    label="Scored today"
                    value={
                        form.dailyLimit > 0
                            ? `${usedToday} / ${form.dailyLimit}`
                            : usedToday
                    }
                    hint={form.dailyLimit > 0 ? "Against the daily cap" : "No cap"}
                    progress={
                        form.dailyLimit > 0
                            ? Math.min(100, (usedToday / form.dailyLimit) * 100)
                            : undefined
                    }
                    loading={usageQuery.isLoading}
                />
            </div>

            <Card>
                <CardHeader
                    title="LLM endpoint"
                    description="Any service that speaks the OpenAI chat completions API, including a model you host yourself."
                />

                <div className="mt-4 space-y-4">
                    <div className="flex flex-wrap gap-2">
                        {PRESETS.map((preset) => (
                            <Button
                                key={preset.label}
                                variant="outline"
                                size="xs"
                                type="button"
                                onClick={() => {
                                    set("baseUrl", preset.baseUrl);
                                    set("model", preset.model);
                                }}
                            >
                                {preset.label}
                            </Button>
                        ))}
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <Input
                            label="Base URL"
                            value={form.baseUrl}
                            onChange={(event) =>
                                set("baseUrl", event.target.value)
                            }
                            placeholder="https://api.openai.com/v1"
                        />
                        <Input
                            label="Model"
                            value={form.model}
                            onChange={(event) => set("model", event.target.value)}
                            placeholder="gpt-4o-mini"
                        />
                    </div>

                    <Input
                        label="API key"
                        type="password"
                        autoComplete="off"
                        value={form.apiKey}
                        onChange={(event) => set("apiKey", event.target.value)}
                        placeholder={
                            settings?.hasApiKey
                                ? `Saved (${settings.apiKeyHint}) — leave blank to keep it`
                                : "Leave blank if your endpoint needs no key"
                        }
                        helpText="Stored encrypted. It is never sent back to this page."
                    />

                    <div className="flex flex-wrap items-center gap-3">
                        <Button
                            variant="secondary"
                            type="button"
                            loading={testMutation.isLoading}
                            onClick={() => testMutation.mutate(form)}
                        >
                            Test connection
                        </Button>

                        {test && (
                            <span
                                className={`flex items-center gap-1.5 text-sm ${
                                    test.ok
                                        ? "text-success-600"
                                        : "text-danger-600"
                                }`}
                            >
                                {test.ok ? (
                                    <>
                                        <CheckCircleIcon className="h-4 w-4" />
                                        {test.model} replied in {test.latencyMs}ms
                                    </>
                                ) : (
                                    <>
                                        <ExclamationTriangleIcon className="h-4 w-4" />
                                        {test.error}
                                    </>
                                )}
                            </span>
                        )}
                    </div>
                </div>
            </Card>

            <Card>
                <CardHeader
                    title="Features"
                    description="Each one costs a request to the endpoint above, so they are off until you switch them on."
                />

                <div className="mt-4 space-y-4">
                    <Checkbox
                        label="Enable AI features"
                        description="The master switch. Everything below is ignored while this is off."
                        checked={form.enabled}
                        onChange={(event) =>
                            set("enabled", event.target.checked)
                        }
                    />
                    <Checkbox
                        label="Importance sorting"
                        description="Scores new inbox mail in the background and powers the Priority view."
                        checked={form.classifyEnabled}
                        disabled={!form.enabled}
                        onChange={(event) =>
                            set("classifyEnabled", event.target.checked)
                        }
                    />
                    <Checkbox
                        label="Message summaries"
                        description="Summarises a message when it is opened. Adds latency to every message view."
                        checked={form.summariesEnabled}
                        disabled={!form.enabled}
                        onChange={(event) =>
                            set("summariesEnabled", event.target.checked)
                        }
                    />
                    <Checkbox
                        label="Suggested replies"
                        description="Lets users generate a draft reply from the reading pane."
                        checked={form.repliesEnabled}
                        disabled={!form.enabled}
                        onChange={(event) =>
                            set("repliesEnabled", event.target.checked)
                        }
                    />
                </div>
            </Card>

            <Card>
                <CardHeader
                    title="Sorting behaviour"
                    description="Controls how aggressively mail is promoted, and how much the classifier is allowed to spend."
                    actions={
                        <Button
                            variant="secondary"
                            size="sm"
                            type="button"
                            icon={<PlayIcon className="h-4 w-4" />}
                            loading={runMutation.isLoading}
                            onClick={() => runMutation.mutate()}
                        >
                            Run now
                        </Button>
                    }
                />

                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Input
                        label="Priority threshold"
                        type="number"
                        min={0}
                        max={100}
                        value={form.importanceThreshold}
                        onChange={(event) =>
                            set("importanceThreshold", Number(event.target.value))
                        }
                        helpText="Score of 0-100 at which mail enters the Priority view. Lower promotes more."
                    />
                    <Input
                        label="Daily message cap"
                        type="number"
                        min={0}
                        value={form.dailyLimit}
                        onChange={(event) =>
                            set("dailyLimit", Number(event.target.value))
                        }
                        helpText="Across the whole server. Zero removes the cap."
                    />
                    <Input
                        label="Messages per request"
                        type="number"
                        min={1}
                        max={25}
                        value={form.batchSize}
                        onChange={(event) =>
                            set("batchSize", Number(event.target.value))
                        }
                        helpText="Batching lowers cost. Very large batches confuse smaller models."
                    />
                    <Input
                        label="Body characters sent"
                        type="number"
                        min={0}
                        max={4000}
                        value={form.snippetChars}
                        onChange={(event) =>
                            set("snippetChars", Number(event.target.value))
                        }
                        helpText="Zero sends only sender and subject, which is the most private option."
                    />
                    <Input
                        label="Look back (days)"
                        type="number"
                        min={1}
                        max={90}
                        value={form.lookbackDays}
                        onChange={(event) =>
                            set("lookbackDays", Number(event.target.value))
                        }
                        helpText="Older mail is left unscored."
                    />
                </div>

                <div className="mt-4">
                    <Textarea
                        label="Extra instructions for the classifier"
                        rows={4}
                        value={form.customInstructions}
                        onChange={(event) =>
                            set("customInstructions", event.target.value)
                        }
                        placeholder="For example: treat anything from our billing provider or mentioning a purchase order as important."
                        helpText="Optional. Appended to the built-in prompt and takes precedence over it."
                    />
                </div>

                {worker?.lastError && (
                    <p className="mt-4 flex items-center gap-1.5 text-sm text-danger-600">
                        <ExclamationTriangleIcon className="h-4 w-4" />
                        Last run failed: {worker.lastError}
                    </p>
                )}

                {worker?.lastRun && !worker.lastError && (
                    <p className="mt-4 text-sm text-content-muted">
                        Last run {new Date(worker.lastRun).toLocaleString()}.
                    </p>
                )}
            </Card>

            <div className="flex justify-end gap-3">
                <Button
                    variant="secondary"
                    type="button"
                    onClick={() => settings && setForm(toForm(settings))}
                >
                    Reset
                </Button>
                <Button
                    type="button"
                    loading={saveMutation.isLoading}
                    onClick={() => saveMutation.mutate(form)}
                >
                    Save settings
                </Button>
            </div>
        </div>
    );
};

export default AISettingsPage;
