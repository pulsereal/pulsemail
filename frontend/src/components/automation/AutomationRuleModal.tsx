import React, { useState, useEffect } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { useMutation } from "react-query";
import { automationAPI } from "../../services/api";
import Modal from "../common/Modal";
import Button from "../common/Button";
import Input from "../common/Input";
import Select from "../common/Select";
import Textarea from "../common/Textarea";
import {
    PlusIcon,
    TrashIcon,
    LightBulbIcon,
    CogIcon,
    BoltIcon,
} from "@heroicons/react/24/outline";
import toast from "react-hot-toast";

interface AutomationRuleModalProps {
    isOpen: boolean;
    onClose: () => void;
    rule?: any;
    mode: "create" | "edit" | "view";
    onSuccess: () => void;
}

interface RuleFormData {
    name: string;
    trigger_type: string;
    trigger_conditions: {
        keywords?: string[];
        sender_patterns?: string[];
        subject_patterns?: string[];
        body_patterns?: string[];
        folder?: string;
        schedule_cron?: string;
        follow_up_delay_hours?: number;
    };
    actions: Array<{
        type: string;
        config: any;
    }>;
    active: boolean;
}

const AutomationRuleModal: React.FC<AutomationRuleModalProps> = ({
    isOpen,
    onClose,
    rule,
    mode,
    onSuccess,
}) => {
    const [currentStep, setCurrentStep] = useState(1);

    const {
        register,
        handleSubmit,
        watch,
        reset,
        control,
        formState: { errors },
    } = useForm<RuleFormData>({
        defaultValues: {
            active: true,
            actions: [{ type: "", config: {} }],
        },
    });

    const {
        fields: actionFields,
        append: appendAction,
        remove: removeAction,
    } = useFieldArray({
        control,
        name: "actions",
    });

    const watchTriggerType = watch("trigger_type");
    const watchActions = watch("actions");

    // Create rule mutation
    const createRuleMutation = useMutation(automationAPI.createRule, {
        onSuccess: () => {
            toast.success("Automation rule created successfully!");
            onSuccess();
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.error || "Failed to create rule");
        },
    });

    // Update rule mutation
    const updateRuleMutation = useMutation(
        ({ id, data }: { id: string; data: any }) =>
            automationAPI.updateRule(id, data),
        {
            onSuccess: () => {
                toast.success("Automation rule updated successfully!");
                onSuccess();
            },
            onError: (error: any) => {
                toast.error(
                    error.response?.data?.error || "Failed to update rule"
                );
            },
        }
    );

    useEffect(() => {
        if (rule && mode !== "create") {
            reset({
                name: rule.name,
                trigger_type: rule.trigger_type,
                trigger_conditions: rule.trigger_conditions || {},
                actions:
                    rule.actions.length > 0
                        ? rule.actions
                        : [{ type: "", config: {} }],
                active: rule.active,
            });
        } else {
            reset({
                name: "",
                trigger_type: "",
                trigger_conditions: {},
                actions: [{ type: "", config: {} }],
                active: true,
            });
        }
        setCurrentStep(1);
    }, [rule, mode, reset]);

    const onSubmit = async (data: RuleFormData) => {
        // Process keywords and patterns
        const processedData = {
            ...data,
            trigger_conditions: {
                ...data.trigger_conditions,
                keywords: data.trigger_conditions.keywords?.length
                    ? data.trigger_conditions.keywords
                    : undefined,
            },
            actions: data.actions.filter((action) => action.type), // Remove empty actions
        };

        if (mode === "create") {
            createRuleMutation.mutate(processedData);
        } else if (mode === "edit") {
            updateRuleMutation.mutate({ id: rule.id, data: processedData });
        }
    };

    const triggerTypeOptions = [
        { value: "", label: "Select trigger type..." },
        { value: "email_received", label: "Email Received" },
        { value: "email_sent", label: "Email Sent" },
        { value: "keyword_match", label: "Keyword Match" },
        { value: "sender_domain", label: "Sender Domain" },
        { value: "schedule", label: "Schedule" },
        { value: "follow_up_due", label: "Follow-up Due" },
    ];

    const actionTypeOptions = [
        { value: "", label: "Select action type..." },
        { value: "auto_reply", label: "Auto Reply" },
        { value: "forward_email", label: "Forward Email" },
        { value: "categorize", label: "Categorize Email" },
        { value: "schedule_follow_up", label: "Schedule Follow-up" },
        { value: "create_task", label: "Create Task" },
        { value: "llm_generate_reply", label: "AI Generate Reply" },
        { value: "send_notification", label: "Send Notification" },
        { value: "move_to_folder", label: "Move to Folder" },
    ];

    const renderTriggerConditions = () => {
        switch (watchTriggerType) {
            case "keyword_match":
                return (
                    <div className="space-y-4">
                        <Textarea
                            label="Keywords (one per line)"
                            {...register("trigger_conditions.keywords")}
                            rows={3}
                            helpText="Enter keywords to match in email subject or body"
                            disabled={mode === "view"}
                        />
                        <Textarea
                            label="Subject Patterns (one per line)"
                            {...register("trigger_conditions.subject_patterns")}
                            rows={2}
                            helpText="Optional: Specific patterns to match in subject line"
                            disabled={mode === "view"}
                        />
                    </div>
                );

            case "sender_domain":
                return (
                    <Textarea
                        label="Sender Patterns (one per line)"
                        {...register("trigger_conditions.sender_patterns")}
                        rows={3}
                        helpText="Enter email addresses or domains (e.g., @company.com)"
                        disabled={mode === "view"}
                    />
                );

            case "email_received":
            case "email_sent":
                return (
                    <div className="space-y-4">
                        <Select
                            label="Folder"
                            {...register("trigger_conditions.folder")}
                            options={[
                                { value: "", label: "Any folder" },
                                { value: "INBOX", label: "Inbox" },
                                { value: "Sent", label: "Sent" },
                                { value: "Important", label: "Important" },
                            ]}
                            disabled={mode === "view"}
                        />
                        <Textarea
                            label="Sender Patterns (optional, one per line)"
                            {...register("trigger_conditions.sender_patterns")}
                            rows={2}
                            helpText="Optional: Filter by specific senders"
                            disabled={mode === "view"}
                        />
                    </div>
                );

            case "schedule":
                return (
                    <Input
                        label="Cron Expression"
                        {...register("trigger_conditions.schedule_cron")}
                        helpText="e.g., '0 9 * * MON' for every Monday at 9 AM"
                        disabled={mode === "view"}
                    />
                );

            case "follow_up_due":
                return (
                    <Input
                        label="Follow-up Delay (hours)"
                        type="number"
                        {...register(
                            "trigger_conditions.follow_up_delay_hours"
                        )}
                        helpText="Trigger when a follow-up is due after this many hours"
                        disabled={mode === "view"}
                    />
                );

            default:
                return (
                    <div className="text-content-subtle text-sm">
                        Select a trigger type to configure conditions
                    </div>
                );
        }
    };

    const renderActionConfig = (actionIndex: number, actionType: string) => {
        const fieldPrefix = `actions.${actionIndex}.config` as const;

        switch (actionType) {
            case "auto_reply":
                return (
                    <div className="space-y-3 p-4 border border-line rounded-md">
                        <Input
                            label="Reply Subject"
                            {...register(`${fieldPrefix}.subject` as const)}
                            disabled={mode === "view"}
                        />
                        <Textarea
                            label="Reply Message"
                            {...register(`${fieldPrefix}.message` as const)}
                            rows={3}
                            disabled={mode === "view"}
                        />
                        <div className="flex items-center">
                            <input
                                type="checkbox"
                                {...register(`${fieldPrefix}.use_llm` as const)}
                                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-line-strong rounded"
                                disabled={mode === "view"}
                            />
                            <label className="ml-2 text-sm text-content">
                                Use AI to personalize reply
                            </label>
                        </div>
                    </div>
                );

            case "forward_email":
                return (
                    <div className="p-4 border border-line rounded-md">
                        <Input
                            label="Forward To"
                            {...register(`${fieldPrefix}.forward_to` as const)}
                            helpText="Email address to forward to"
                            disabled={mode === "view"}
                        />
                    </div>
                );

            case "categorize":
                return (
                    <div className="p-4 border border-line rounded-md">
                        <Select
                            label="Category"
                            {...register(`${fieldPrefix}.category` as const)}
                            options={[
                                { value: "", label: "Select category..." },
                                { value: "important", label: "Important" },
                                { value: "urgent", label: "Urgent" },
                                { value: "newsletter", label: "Newsletter" },
                                { value: "promotion", label: "Promotion" },
                                { value: "social", label: "Social" },
                            ]}
                            disabled={mode === "view"}
                        />
                    </div>
                );

            case "schedule_follow_up":
                return (
                    <div className="space-y-3 p-4 border border-line rounded-md">
                        <Input
                            label="Follow-up Subject"
                            {...register(`${fieldPrefix}.subject` as const)}
                            disabled={mode === "view"}
                        />
                        <Textarea
                            label="Follow-up Message"
                            {...register(`${fieldPrefix}.message` as const)}
                            rows={3}
                            disabled={mode === "view"}
                        />
                        <Input
                            label="Delay (hours)"
                            type="number"
                            {...register(`${fieldPrefix}.delay_hours` as const)}
                            helpText="How many hours to wait before sending follow-up"
                            disabled={mode === "view"}
                        />
                        <div className="flex items-center">
                            <input
                                type="checkbox"
                                {...register(`${fieldPrefix}.use_llm` as const)}
                                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-line-strong rounded"
                                disabled={mode === "view"}
                            />
                            <label className="ml-2 text-sm text-content">
                                Use AI to generate follow-up content
                            </label>
                        </div>
                    </div>
                );

            case "create_task":
                return (
                    <div className="space-y-3 p-4 border border-line rounded-md">
                        <Input
                            label="Task Title"
                            {...register(`${fieldPrefix}.title` as const)}
                            disabled={mode === "view"}
                        />
                        <Textarea
                            label="Task Description"
                            {...register(`${fieldPrefix}.description` as const)}
                            rows={2}
                            disabled={mode === "view"}
                        />
                        <Input
                            label="Due Date (days from now)"
                            type="number"
                            {...register(`${fieldPrefix}.due_in_days` as const)}
                            disabled={mode === "view"}
                        />
                    </div>
                );

            case "llm_generate_reply":
                return (
                    <div className="space-y-3 p-4 border border-line rounded-md">
                        <Select
                            label="Reply Tone"
                            {...register(`${fieldPrefix}.tone` as const)}
                            options={[
                                {
                                    value: "professional",
                                    label: "Professional",
                                },
                                { value: "friendly", label: "Friendly" },
                                { value: "formal", label: "Formal" },
                                { value: "casual", label: "Casual" },
                            ]}
                            disabled={mode === "view"}
                        />
                        <Textarea
                            label="Custom Instructions"
                            {...register(
                                `${fieldPrefix}.instructions` as const
                            )}
                            rows={2}
                            helpText="Additional instructions for AI reply generation"
                            disabled={mode === "view"}
                        />
                        <div className="flex items-center">
                            <input
                                type="checkbox"
                                {...register(
                                    `${fieldPrefix}.auto_send` as const
                                )}
                                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-line-strong rounded"
                                disabled={mode === "view"}
                            />
                            <label className="ml-2 text-sm text-content">
                                Send reply automatically (without review)
                            </label>
                        </div>
                    </div>
                );

            case "send_notification":
                return (
                    <div className="space-y-3 p-4 border border-line rounded-md">
                        <Input
                            label="Notification Title"
                            {...register(`${fieldPrefix}.title` as const)}
                            disabled={mode === "view"}
                        />
                        <Textarea
                            label="Notification Message"
                            {...register(`${fieldPrefix}.message` as const)}
                            rows={2}
                            disabled={mode === "view"}
                        />
                    </div>
                );

            case "move_to_folder":
                return (
                    <div className="p-4 border border-line rounded-md">
                        <Select
                            label="Target Folder"
                            {...register(`${fieldPrefix}.folder` as const)}
                            options={[
                                { value: "", label: "Select folder..." },
                                { value: "Important", label: "Important" },
                                { value: "Archive", label: "Archive" },
                                { value: "Spam", label: "Spam" },
                                { value: "Trash", label: "Trash" },
                            ]}
                            disabled={mode === "view"}
                        />
                    </div>
                );

            default:
                return null;
        }
    };

    const steps = [
        { id: 1, name: "Basic Info", icon: CogIcon },
        { id: 2, name: "Trigger", icon: BoltIcon },
        { id: 3, name: "Actions", icon: LightBulbIcon },
    ];

    const renderStepContent = () => {
        switch (currentStep) {
            case 1:
                return (
                    <div className="space-y-4">
                        <Input
                            label="Rule Name"
                            {...register("name", {
                                required: "Rule name is required",
                            })}
                            error={errors.name?.message}
                            disabled={mode === "view"}
                        />
                        <div className="flex items-center">
                            <input
                                type="checkbox"
                                {...register("active")}
                                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-line-strong rounded"
                                disabled={mode === "view"}
                            />
                            <label className="ml-2 text-sm text-content">
                                Activate rule immediately
                            </label>
                        </div>
                    </div>
                );

            case 2:
                return (
                    <div className="space-y-4">
                        <Select
                            label="Trigger Type"
                            {...register("trigger_type", {
                                required: "Trigger type is required",
                            })}
                            options={triggerTypeOptions}
                            error={errors.trigger_type?.message}
                            disabled={mode === "view"}
                        />
                        {watchTriggerType && (
                            <div>
                                <h4 className="text-sm font-medium text-content mb-3">
                                    Trigger Conditions
                                </h4>
                                {renderTriggerConditions()}
                            </div>
                        )}
                    </div>
                );

            case 3:
                return (
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <h4 className="text-sm font-medium text-content">
                                Actions
                            </h4>
                            {mode !== "view" && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                        appendAction({ type: "", config: {} })
                                    }
                                    icon={<PlusIcon className="h-4 w-4" />}
                                >
                                    Add Action
                                </Button>
                            )}
                        </div>

                        {actionFields.map((field, index) => (
                            <div
                                key={field.id}
                                className="border border-line rounded-lg p-4"
                            >
                                <div className="flex justify-between items-start mb-4">
                                    <Select
                                        label={`Action ${index + 1}`}
                                        {...register(
                                            `actions.${index}.type` as const
                                        )}
                                        options={actionTypeOptions}
                                        disabled={mode === "view"}
                                    />
                                    {mode !== "view" &&
                                        actionFields.length > 1 && (
                                            <Button
                                                variant="danger"
                                                size="sm"
                                                onClick={() =>
                                                    removeAction(index)
                                                }
                                                icon={
                                                    <TrashIcon className="h-4 w-4" />
                                                }
                                                className="ml-2"
                                            />
                                        )}
                                </div>

                                {watchActions[index]?.type &&
                                    renderActionConfig(
                                        index,
                                        watchActions[index].type
                                    )}
                            </div>
                        ))}
                    </div>
                );

            default:
                return null;
        }
    };

    const canProceedToNextStep = () => {
        switch (currentStep) {
            case 1:
                return watch("name");
            case 2:
                return watch("trigger_type");
            case 3:
                return watchActions.some((action) => action.type);
            default:
                return true;
        }
    };

    const getModalTitle = () => {
        if (mode === "view") return `Rule: ${rule?.name}`;
        if (mode === "edit") return `Edit Rule: ${rule?.name}`;
        return "Create Automation Rule";
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={getModalTitle()}
            size="2xl"
            actions={
                <div className="flex justify-between w-full">
                    <div className="flex space-x-2">
                        {currentStep > 1 && mode !== "view" && (
                            <Button
                                variant="outline"
                                onClick={() => setCurrentStep(currentStep - 1)}
                            >
                                Previous
                            </Button>
                        )}
                    </div>
                    <div className="flex space-x-2">
                        {mode !== "view" && currentStep < 3 && (
                            <Button
                                onClick={() => setCurrentStep(currentStep + 1)}
                                disabled={!canProceedToNextStep()}
                            >
                                Next
                            </Button>
                        )}
                        {mode !== "view" && currentStep === 3 && (
                            <Button
                                onClick={handleSubmit(onSubmit)}
                                loading={
                                    createRuleMutation.isLoading ||
                                    updateRuleMutation.isLoading
                                }
                            >
                                {mode === "create"
                                    ? "Create Rule"
                                    : "Update Rule"}
                            </Button>
                        )}
                        <Button variant="outline" onClick={onClose}>
                            {mode === "view" ? "Close" : "Cancel"}
                        </Button>
                    </div>
                </div>
            }
        >
            <div>
                {/* Step Navigation */}
                <div className="mb-8">
                    <nav aria-label="Progress">
                        <ol className="flex items-center">
                            {steps.map((step, stepIdx) => (
                                <li
                                    key={step.name}
                                    className={`relative ${stepIdx !== steps.length - 1 ? "pr-8 sm:pr-20" : ""}`}
                                >
                                    <div className="flex items-center">
                                        <div
                                            className={`relative flex h-8 w-8 items-center justify-center rounded-full ${
                                                step.id <= currentStep
                                                    ? "bg-primary-600 text-white"
                                                    : "border-2 border-line-strong bg-surface text-content-subtle"
                                            }`}
                                        >
                                            <step.icon className="h-4 w-4" />
                                        </div>
                                        <div className="ml-4 min-w-0 flex flex-col">
                                            <span
                                                className={`text-xs font-semibold tracking-wide uppercase ${
                                                    step.id <= currentStep
                                                        ? "text-primary-600"
                                                        : "text-content-subtle"
                                                }`}
                                            >
                                                {step.name}
                                            </span>
                                        </div>
                                    </div>
                                    {stepIdx !== steps.length - 1 && (
                                        <div className="absolute top-4 left-8 -ml-px h-0.5 w-full bg-line-strong" />
                                    )}
                                </li>
                            ))}
                        </ol>
                    </nav>
                </div>

                {/* Step Content */}
                <div className="min-h-[400px]">{renderStepContent()}</div>
            </div>
        </Modal>
    );
};

export default AutomationRuleModal;
