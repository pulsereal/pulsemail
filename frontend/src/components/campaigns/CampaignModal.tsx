import React, { useState, useEffect } from "react";
import { useQuery, useMutation } from "react-query";
import { useForm } from "react-hook-form";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";
import { campaignAPI } from "../../services/api";
import Modal from "../common/Modal";
import Button from "../common/Button";
import Input from "../common/Input";
import Select from "../common/Select";
import Textarea from "../common/Textarea";
import {
    CalendarIcon,
    UserGroupIcon,
    DocumentTextIcon,
    PaperAirplaneIcon,
} from "@heroicons/react/24/outline";
import { format } from "date-fns";
import toast from "react-hot-toast";

interface CampaignModalProps {
    isOpen: boolean;
    onClose: () => void;
    campaign?: any;
    mode: "create" | "edit" | "view";
    onSuccess: () => void;
}

interface CampaignFormData {
    name: string;
    subject: string;
    content: string;
    template_id?: number;
    recipients: string;
    scheduled_at?: string;
    test_emails: string;
}

const CampaignModal: React.FC<CampaignModalProps> = ({
    isOpen,
    onClose,
    campaign,
    mode,
    onSuccess,
}) => {
    const [currentStep, setCurrentStep] = useState(1);
    const [content, setContent] = useState("");

    const {
        register,
        handleSubmit,
        setValue,
        watch,
        reset,
        formState: { errors },
    } = useForm<CampaignFormData>();

    // Fetch templates
    const { data: templates } = useQuery(
        "campaign-templates",
        () => campaignAPI.getTemplates().then((res) => res.data),
        { enabled: isOpen }
    );

    // Create campaign mutation
    const createCampaignMutation = useMutation(campaignAPI.createCampaign, {
        onSuccess: () => {
            toast.success("Campaign created successfully!");
            onSuccess();
        },
        onError: (error: any) => {
            toast.error(
                error.response?.data?.error || "Failed to create campaign"
            );
        },
    });

    // Update campaign mutation
    const updateCampaignMutation = useMutation(
        ({ id, data }: { id: string; data: any }) =>
            campaignAPI.updateCampaign(id, data),
        {
            onSuccess: () => {
                toast.success("Campaign updated successfully!");
                onSuccess();
            },
            onError: (error: any) => {
                toast.error(
                    error.response?.data?.error || "Failed to update campaign"
                );
            },
        }
    );

    // Test campaign mutation
    const testCampaignMutation = useMutation(
        ({ id, emails }: { id: string; emails: string[] }) =>
            campaignAPI.testCampaign(id, emails),
        {
            onSuccess: () => {
                toast.success("Test emails sent successfully!");
            },
            onError: (error: any) => {
                toast.error(
                    error.response?.data?.error || "Failed to send test emails"
                );
            },
        }
    );

    useEffect(() => {
        if (campaign && mode !== "create") {
            reset({
                name: campaign.name,
                subject: campaign.subject,
                content: campaign.content,
                template_id: campaign.template_id,
                recipients:
                    campaign.recipients?.map((r: any) => r.email).join("\n") ||
                    "",
                scheduled_at: campaign.scheduled_at
                    ? format(
                          new Date(campaign.scheduled_at),
                          "yyyy-MM-dd'T'HH:mm"
                      )
                    : "",
                test_emails: "",
            });
            setContent(campaign.content || "");
        } else {
            reset();
            setContent("");
        }
        setCurrentStep(1);
    }, [campaign, mode, reset]);

    const onSubmit = async (data: CampaignFormData) => {
        const recipients = data.recipients
            .split("\n")
            .filter((email) => email.trim())
            .map((email) => ({ email: email.trim() }));

        const campaignData = {
            ...data,
            content,
            recipients,
            scheduled_at: data.scheduled_at || undefined,
        };

        if (mode === "create") {
            createCampaignMutation.mutate(campaignData);
        } else if (mode === "edit") {
            updateCampaignMutation.mutate({
                id: campaign.id,
                data: campaignData,
            });
        }
    };

    const handleTestCampaign = () => {
        const testEmails = watch("test_emails")
            .split("\n")
            .filter((email) => email.trim())
            .map((email) => email.trim());

        if (testEmails.length === 0) {
            toast.error("Please enter at least one test email address");
            return;
        }

        testCampaignMutation.mutate({ id: campaign.id, emails: testEmails });
    };

    const handleTemplateSelect = async (templateId: string) => {
        if (!templateId) return;

        const template = templates?.find(
            (t: any) => t.id === parseInt(templateId)
        );
        if (template) {
            setContent(template.content);
            setValue("template_id", parseInt(templateId));
        }
    };

    const steps = [
        { id: 1, name: "Campaign Details", icon: DocumentTextIcon },
        { id: 2, name: "Content", icon: PaperAirplaneIcon },
        { id: 3, name: "Recipients", icon: UserGroupIcon },
        { id: 4, name: "Schedule & Send", icon: CalendarIcon },
    ];

    const renderStepContent = () => {
        switch (currentStep) {
            case 1:
                return (
                    <div className="space-y-4">
                        <Input
                            label="Campaign Name"
                            {...register("name", {
                                required: "Campaign name is required",
                            })}
                            error={errors.name?.message}
                            disabled={mode === "view"}
                        />
                        <Input
                            label="Email Subject"
                            {...register("subject", {
                                required: "Subject is required",
                            })}
                            error={errors.subject?.message}
                            disabled={mode === "view"}
                        />
                        {mode !== "view" && (
                            <Select
                                label="Use Template (Optional)"
                                options={[
                                    {
                                        value: "",
                                        label: "Select a template...",
                                    },
                                    ...(templates?.map((t: any) => ({
                                        value: t.id.toString(),
                                        label: t.name,
                                    })) || []),
                                ]}
                                onChange={(e) =>
                                    handleTemplateSelect(e.target.value)
                                }
                            />
                        )}
                    </div>
                );

            case 2:
                return (
                    <div className="space-y-4">
                        <label className="block text-sm font-medium text-content">
                            Email Content
                        </label>
                        <div className="border border-line-strong rounded-md">
                            <ReactQuill
                                value={content}
                                onChange={setContent}
                                readOnly={mode === "view"}
                                theme="snow"
                                modules={{
                                    toolbar:
                                        mode === "view"
                                            ? false
                                            : [
                                                  [
                                                      {
                                                          header: [
                                                              1,
                                                              2,
                                                              3,
                                                              false,
                                                          ],
                                                      },
                                                  ],
                                                  [
                                                      "bold",
                                                      "italic",
                                                      "underline",
                                                      "strike",
                                                  ],
                                                  [
                                                      { list: "ordered" },
                                                      { list: "bullet" },
                                                  ],
                                                  [
                                                      { color: [] },
                                                      { background: [] },
                                                  ],
                                                  ["link", "image"],
                                                  ["clean"],
                                              ],
                                }}
                                style={{ minHeight: "300px" }}
                            />
                        </div>
                    </div>
                );

            case 3:
                return (
                    <div className="space-y-4">
                        <Textarea
                            label="Recipients (one email per line)"
                            rows={10}
                            {...register("recipients", {
                                required: "At least one recipient is required",
                            })}
                            error={errors.recipients?.message}
                            helpText="Enter one email address per line"
                            disabled={mode === "view"}
                        />
                        {mode === "view" && campaign?.recipients_count && (
                            <div className="text-sm text-content-muted">
                                Total recipients:{" "}
                                {campaign.recipients_count.toLocaleString()}
                            </div>
                        )}
                    </div>
                );

            case 4:
                return (
                    <div className="space-y-4">
                        {mode !== "view" && (
                            <>
                                <Input
                                    label="Schedule Send Time (Optional)"
                                    type="datetime-local"
                                    {...register("scheduled_at")}
                                    helpText="Leave empty to send immediately"
                                />
                                <Textarea
                                    label="Test Email Addresses (Optional)"
                                    rows={3}
                                    {...register("test_emails")}
                                    helpText="Enter test email addresses (one per line) to send a test before the actual campaign"
                                />
                            </>
                        )}
                        {mode === "view" && (
                            <div className="space-y-3">
                                <div className="bg-surface-sunken p-4 rounded-md">
                                    <h4 className="font-medium text-content">
                                        Campaign Summary
                                    </h4>
                                    <div className="mt-2 space-y-1 text-sm text-content-muted">
                                        <div>Name: {campaign?.name}</div>
                                        <div>Subject: {campaign?.subject}</div>
                                        <div>
                                            Recipients:{" "}
                                            {campaign?.recipients_count?.toLocaleString()}
                                        </div>
                                        {campaign?.scheduled_at && (
                                            <div>
                                                Scheduled:{" "}
                                                {format(
                                                    new Date(
                                                        campaign.scheduled_at
                                                    ),
                                                    "PPP p"
                                                )}
                                            </div>
                                        )}
                                        {campaign?.sent_at && (
                                            <div>
                                                Sent:{" "}
                                                {format(
                                                    new Date(campaign.sent_at),
                                                    "PPP p"
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                );

            default:
                return null;
        }
    };

    const canProceedToNextStep = () => {
        switch (currentStep) {
            case 1:
                return watch("name") && watch("subject");
            case 2:
                return content.trim().length > 0;
            case 3:
                return watch("recipients")?.trim().length > 0;
            default:
                return true;
        }
    };

    const getModalTitle = () => {
        if (mode === "view") return `Campaign: ${campaign?.name}`;
        if (mode === "edit") return `Edit Campaign: ${campaign?.name}`;
        return "Create New Campaign";
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
                        {mode === "view" &&
                            campaign?.status === "draft" &&
                            currentStep === 4 && (
                                <>
                                    <Button
                                        variant="outline"
                                        onClick={handleTestCampaign}
                                        loading={testCampaignMutation.isLoading}
                                        disabled={!watch("test_emails")?.trim()}
                                    >
                                        Send Test
                                    </Button>
                                </>
                            )}
                        {mode !== "view" && currentStep < 4 && (
                            <Button
                                onClick={() => setCurrentStep(currentStep + 1)}
                                disabled={!canProceedToNextStep()}
                            >
                                Next
                            </Button>
                        )}
                        {mode !== "view" && currentStep === 4 && (
                            <Button
                                onClick={handleSubmit(onSubmit)}
                                loading={
                                    createCampaignMutation.isLoading ||
                                    updateCampaignMutation.isLoading
                                }
                            >
                                {mode === "create"
                                    ? "Create Campaign"
                                    : "Update Campaign"}
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

export default CampaignModal;
