import React, { useState } from "react";
import { useQuery, useMutation } from "react-query";
import { campaignAPI } from "../../services/api";
import Button from "../common/Button";
import Modal from "../common/Modal";
import Input from "../common/Input";
import {
    PlusIcon,
    EyeIcon,
    DocumentTextIcon,
} from "@heroicons/react/24/outline";
import { CampaignTemplate } from "../../types";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";
import toast from "react-hot-toast";

interface TemplateGalleryProps {
    onSelectTemplate?: (template: CampaignTemplate) => void;
    showActions?: boolean;
}

const TemplateGallery: React.FC<TemplateGalleryProps> = ({
    onSelectTemplate,
    showActions = true,
}) => {
    const [selectedTemplate, setSelectedTemplate] =
        useState<CampaignTemplate | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState<"view" | "create" | "edit">(
        "view"
    );
    const [templateContent, setTemplateContent] = useState("");

    const {
        data: templates,
        isLoading,
        refetch,
    } = useQuery("campaign-templates", () =>
        campaignAPI.getTemplates().then((res) => res.data)
    );

    const createTemplateMutation = useMutation(campaignAPI.createTemplate, {
        onSuccess: () => {
            toast.success("Template created successfully!");
            setIsModalOpen(false);
            refetch();
        },
        onError: (error: any) => {
            toast.error(
                error.response?.data?.error || "Failed to create template"
            );
        },
    });

    const handleCreateTemplate = () => {
        setSelectedTemplate(null);
        setTemplateContent("");
        setModalMode("create");
        setIsModalOpen(true);
    };

    const handleViewTemplate = (template: CampaignTemplate) => {
        setSelectedTemplate(template);
        setTemplateContent(template.content);
        setModalMode("view");
        setIsModalOpen(true);
    };

    const handleSelectTemplate = (template: CampaignTemplate) => {
        if (onSelectTemplate) {
            onSelectTemplate(template);
        }
    };

    const handleSubmitTemplate = async (formData: FormData) => {
        const templateData = {
            name: formData.get("name") as string,
            content: templateContent,
        };

        createTemplateMutation.mutate(templateData);
    };

    const defaultTemplates = [
        {
            id: 0,
            name: "Welcome Email",
            content: `
        <h2>Welcome to our community!</h2>
        <p>Hi {{name}},</p>
        <p>We're excited to have you join us. Here's what you can expect:</p>
        <ul>
          <li>Regular updates on our latest features</li>
          <li>Exclusive content and resources</li>
          <li>Direct access to our support team</li>
        </ul>
        <p>If you have any questions, don't hesitate to reach out.</p>
        <p>Best regards,<br>The Team</p>
      `,
            thumbnail: "",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        },
        {
            id: 0,
            name: "Newsletter Template",
            content: `
        <h1>Weekly Newsletter</h1>
        <h3>This Week's Highlights</h3>
        <p>Here are the top stories and updates from this week:</p>
        
        <div style="border: 1px solid #ddd; padding: 15px; margin: 10px 0;">
          <h4>Feature Update</h4>
          <p>We've added new automation capabilities to help you save time...</p>
        </div>
        
        <div style="border: 1px solid #ddd; padding: 15px; margin: 10px 0;">
          <h4>Community Spotlight</h4>
          <p>This week we're featuring amazing work from our community...</p>
        </div>
        
        <p>Stay tuned for more updates next week!</p>
      `,
            thumbnail: "",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        },
        {
            id: 0,
            name: "Product Announcement",
            content: `
        <h2>🎉 Exciting News: New Product Launch!</h2>
        <p>We're thrilled to announce the launch of our latest product...</p>
        
        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3>Key Features:</h3>
          <ul>
            <li>Advanced automation capabilities</li>
            <li>Intuitive user interface</li>
            <li>Seamless integrations</li>
          </ul>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="#" style="background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">
            Learn More
          </a>
        </div>
        
        <p>Questions? Our team is here to help!</p>
      `,
            thumbnail: "",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        },
    ];

    const allTemplates = [...defaultTemplates, ...(templates?.data || [])];

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h3 className="text-lg font-medium text-content">
                        Email Templates
                    </h3>
                    <p className="text-sm text-content-subtle">
                        Choose from pre-built templates or create your own
                    </p>
                </div>
                {showActions && (
                    <Button
                        onClick={handleCreateTemplate}
                        icon={<PlusIcon className="h-4 w-4" />}
                        size="sm"
                    >
                        New Template
                    </Button>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {allTemplates.map((template, index) => (
                    <div
                        key={`${template.id}-${index}`}
                        className="bg-surface border border-line rounded-lg shadow-sm hover:shadow-md transition-shadow"
                    >
                        <div className="p-4">
                            <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center space-x-2">
                                    <DocumentTextIcon className="h-5 w-5 text-content-subtle" />
                                    <h4 className="text-sm font-medium text-content">
                                        {template.name}
                                    </h4>
                                </div>
                            </div>

                            <div className="text-xs text-content-subtle mb-4 h-12 overflow-hidden">
                                <div
                                    dangerouslySetInnerHTML={{
                                        __html:
                                            template.content
                                                .replace(/<[^>]*>/g, "")
                                                .substring(0, 100) + "...",
                                    }}
                                />
                            </div>

                            <div className="flex space-x-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleViewTemplate(template)}
                                    icon={<EyeIcon className="h-4 w-4" />}
                                >
                                    Preview
                                </Button>
                                {onSelectTemplate && (
                                    <Button
                                        size="sm"
                                        onClick={() =>
                                            handleSelectTemplate(template)
                                        }
                                    >
                                        Use Template
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Template Modal */}
            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={
                    modalMode === "create"
                        ? "Create New Template"
                        : modalMode === "edit"
                          ? `Edit Template: ${selectedTemplate?.name}`
                          : `Template: ${selectedTemplate?.name}`
                }
                size="2xl"
                actions={
                    modalMode === "view" ? (
                        <div className="flex space-x-2">
                            {onSelectTemplate && selectedTemplate && (
                                <Button
                                    onClick={() => {
                                        handleSelectTemplate(selectedTemplate);
                                        setIsModalOpen(false);
                                    }}
                                >
                                    Use This Template
                                </Button>
                            )}
                            <Button
                                variant="outline"
                                onClick={() => setIsModalOpen(false)}
                            >
                                Close
                            </Button>
                        </div>
                    ) : (
                        <div className="flex space-x-2">
                            <Button
                                form="template-form"
                                type="submit"
                                loading={createTemplateMutation.isLoading}
                            >
                                {modalMode === "create"
                                    ? "Create Template"
                                    : "Update Template"}
                            </Button>
                            <Button
                                variant="outline"
                                onClick={() => setIsModalOpen(false)}
                            >
                                Cancel
                            </Button>
                        </div>
                    )
                }
            >
                {modalMode === "view" ? (
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-content mb-1">
                                Template Name
                            </label>
                            <p className="text-sm text-content">
                                {selectedTemplate?.name}
                            </p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-content mb-1">
                                Content Preview
                            </label>
                            <div
                                className="border border-line-strong rounded-md p-4 bg-surface-sunken max-h-96 overflow-y-auto"
                                dangerouslySetInnerHTML={{
                                    __html: selectedTemplate?.content || "",
                                }}
                            />
                        </div>
                    </div>
                ) : (
                    <form
                        id="template-form"
                        onSubmit={(e) => {
                            e.preventDefault();
                            const formData = new FormData(e.currentTarget);
                            handleSubmitTemplate(formData);
                        }}
                        className="space-y-4"
                    >
                        <Input
                            name="name"
                            label="Template Name"
                            required
                            defaultValue={selectedTemplate?.name || ""}
                        />
                        <div>
                            <label className="block text-sm font-medium text-content mb-1">
                                Template Content
                            </label>
                            <div className="border border-line-strong rounded-md">
                                <ReactQuill
                                    value={templateContent}
                                    onChange={setTemplateContent}
                                    theme="snow"
                                    modules={{
                                        toolbar: [
                                            [{ header: [1, 2, 3, false] }],
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
                                            [{ color: [] }, { background: [] }],
                                            ["link", "image"],
                                            ["clean"],
                                        ],
                                    }}
                                    style={{ minHeight: "300px" }}
                                />
                            </div>
                            <p className="mt-1 text-sm text-content-subtle">
                                You can use variables like {"{{name}}"} that
                                will be replaced when sending campaigns.
                            </p>
                        </div>
                    </form>
                )}
            </Modal>
        </div>
    );
};

export default TemplateGallery;
