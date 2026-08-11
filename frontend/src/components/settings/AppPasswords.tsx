import React, { useState } from "react";
import { useQuery, useMutation } from "react-query";
import { authAPI } from "../../services/api";
import Button from "../common/Button";
import Input from "../common/Input";
import Modal from "../common/Modal";
import Badge from "../common/Badge";
import {
    KeyIcon,
    PlusIcon,
    TrashIcon,
    EyeIcon,
    EyeSlashIcon,
    ClipboardDocumentIcon,
} from "@heroicons/react/24/outline";
import { formatDistanceToNow } from "date-fns";
import toast from "react-hot-toast";

interface AppPassword {
    id: string;
    name: string;
    password?: string; // Only available when first created
    created_at: string;
    last_used?: string;
    expires_at?: string;
}

const AppPasswords: React.FC = () => {
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [newPasswordName, setNewPasswordName] = useState("");
    const [newPassword, setNewPassword] = useState<AppPassword | null>(null);
    const [showPassword, setShowPassword] = useState(false);

    // Fetch app passwords
    const {
        data: appPasswords,
        isLoading,
        refetch,
    } = useQuery("app-passwords", () =>
        authAPI.getAppPasswords().then((res) => res.data)
    );

    // Create app password mutation
    const createPasswordMutation = useMutation(authAPI.createAppPassword, {
        onSuccess: (response) => {
            setNewPassword(response.data);
            setNewPasswordName("");
            refetch();
            toast.success("App password created successfully!");
        },
        onError: (error: any) => {
            toast.error(
                error.response?.data?.error || "Failed to create app password"
            );
        },
    });

    // Delete app password mutation
    const deletePasswordMutation = useMutation(authAPI.deleteAppPassword, {
        onSuccess: () => {
            refetch();
            toast.success("App password deleted successfully");
        },
        onError: (error: any) => {
            toast.error(
                error.response?.data?.error || "Failed to delete app password"
            );
        },
    });

    const handleCreatePassword = () => {
        if (!newPasswordName.trim()) {
            toast.error("Please enter a name for the app password");
            return;
        }
        createPasswordMutation.mutate(newPasswordName.trim());
    };

    const handleDeletePassword = (id: string, name: string) => {
        if (
            window.confirm(
                `Are you sure you want to delete the app password "${name}"? This action cannot be undone.`
            )
        ) {
            deletePasswordMutation.mutate(id);
        }
    };

    const copyPassword = (password: string) => {
        navigator.clipboard.writeText(password);
        toast.success("Password copied to clipboard");
    };

    const handleCloseNewPasswordModal = () => {
        setNewPassword(null);
        setIsCreateModalOpen(false);
        setShowPassword(false);
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-medium text-content mb-4">
                    <KeyIcon className="h-5 w-5 inline mr-2" />
                    App Passwords
                </h3>

                <div className="bg-surface shadow rounded-lg">
                    <div className="px-6 py-4 border-b border-line">
                        <div className="flex justify-between items-center">
                            <div>
                                <h4 className="text-md font-medium text-content">
                                    Application Passwords
                                </h4>
                                <p className="text-sm text-content-muted">
                                    Generate passwords for third-party
                                    applications and email clients
                                </p>
                            </div>
                            <Button
                                onClick={() => setIsCreateModalOpen(true)}
                                icon={<PlusIcon className="h-4 w-4" />}
                                size="sm"
                            >
                                New Password
                            </Button>
                        </div>
                    </div>

                    <div className="divide-y divide-line">
                        {appPasswords?.data?.length === 0 ? (
                            <div className="px-6 py-12 text-center">
                                <KeyIcon className="mx-auto h-12 w-12 text-content-subtle" />
                                <h3 className="mt-2 text-sm font-medium text-content">
                                    No app passwords
                                </h3>
                                <p className="mt-1 text-sm text-content-subtle">
                                    Create app passwords to use with third-party
                                    email clients
                                </p>
                                <div className="mt-6">
                                    <Button
                                        onClick={() =>
                                            setIsCreateModalOpen(true)
                                        }
                                        icon={<PlusIcon className="h-4 w-4" />}
                                    >
                                        Create your first app password
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            appPasswords?.data?.map((password: AppPassword) => (
                                <div key={password.id} className="px-6 py-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center space-x-3">
                                                <h4 className="text-sm font-medium text-content">
                                                    {password.name}
                                                </h4>
                                                <Badge
                                                    variant="default"
                                                    size="sm"
                                                >
                                                    Active
                                                </Badge>
                                            </div>
                                            <div className="mt-1 text-sm text-content-subtle space-y-1">
                                                <div>
                                                    Created{" "}
                                                    {formatDistanceToNow(
                                                        new Date(
                                                            password.created_at
                                                        ),
                                                        { addSuffix: true }
                                                    )}
                                                </div>
                                                {password.last_used && (
                                                    <div>
                                                        Last used{" "}
                                                        {formatDistanceToNow(
                                                            new Date(
                                                                password.last_used
                                                            ),
                                                            { addSuffix: true }
                                                        )}
                                                    </div>
                                                )}
                                                {!password.last_used && (
                                                    <div className="text-warning-600">
                                                        Never used
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <Button
                                                variant="danger"
                                                size="sm"
                                                onClick={() =>
                                                    handleDeletePassword(
                                                        password.id,
                                                        password.name
                                                    )
                                                }
                                                icon={
                                                    <TrashIcon className="h-4 w-4" />
                                                }
                                            >
                                                Delete
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Info Section */}
                <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-primary-900 mb-2">
                        About App Passwords
                    </h4>
                    <ul className="text-sm text-primary-800 space-y-1">
                        <li>
                            • Use app passwords to connect third-party email
                            clients like Outlook, Thunderbird, or Apple Mail
                        </li>
                        <li>
                            • Each password is unique and can be revoked
                            independently
                        </li>
                        <li>
                            • App passwords bypass two-factor authentication for
                            designated applications
                        </li>
                        <li>
                            • Never share your app passwords or use them on
                            untrusted devices
                        </li>
                    </ul>
                </div>
            </div>

            {/* Create App Password Modal */}
            <Modal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                title="Create App Password"
                size="md"
                actions={
                    <div className="flex space-x-2">
                        <Button
                            onClick={handleCreatePassword}
                            loading={createPasswordMutation.isLoading}
                            disabled={!newPasswordName.trim()}
                        >
                            Generate Password
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => setIsCreateModalOpen(false)}
                        >
                            Cancel
                        </Button>
                    </div>
                }
            >
                <div className="space-y-4">
                    <Input
                        label="Password Name"
                        value={newPasswordName}
                        onChange={(e) => setNewPasswordName(e.target.value)}
                        placeholder="e.g., iPhone Mail, Outlook, Thunderbird"
                        helpText="Choose a descriptive name to identify where this password will be used"
                    />

                    <div className="bg-warning-50 border border-warning-200 rounded-md p-4">
                        <div className="text-sm text-warning-800">
                            <strong>Note:</strong> The generated password will
                            only be shown once. Make sure to copy it before
                            closing this dialog.
                        </div>
                    </div>
                </div>
            </Modal>

            {/* New Password Display Modal */}
            <Modal
                isOpen={!!newPassword}
                onClose={handleCloseNewPasswordModal}
                title="App Password Created"
                size="md"
                actions={
                    <Button onClick={handleCloseNewPasswordModal}>Done</Button>
                }
            >
                {newPassword && (
                    <div className="space-y-4">
                        <div className="text-center">
                            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-success-100 mb-4">
                                <KeyIcon className="h-6 w-6 text-success-600" />
                            </div>
                            <h3 className="text-lg font-medium text-content mb-2">
                                Password Generated Successfully
                            </h3>
                            <p className="text-sm text-content-muted">
                                Use this password with{" "}
                                <strong>{newPassword.name}</strong>
                            </p>
                        </div>

                        <div className="bg-surface-sunken p-4 rounded-md">
                            <label className="block text-sm font-medium text-content mb-2">
                                App Password
                            </label>
                            <div className="flex items-center space-x-2">
                                <div className="flex-1 relative">
                                    <input
                                        type={
                                            showPassword ? "text" : "password"
                                        }
                                        value={newPassword.password || ""}
                                        readOnly
                                        className="block w-full font-mono text-sm border-line-strong rounded-md bg-surface"
                                    />
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                        setShowPassword(!showPassword)
                                    }
                                    icon={
                                        showPassword ? (
                                            <EyeSlashIcon className="h-4 w-4" />
                                        ) : (
                                            <EyeIcon className="h-4 w-4" />
                                        )
                                    }
                                />
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                        copyPassword(newPassword.password || "")
                                    }
                                    icon={
                                        <ClipboardDocumentIcon className="h-4 w-4" />
                                    }
                                />
                            </div>
                        </div>

                        <div className="bg-danger-50 border border-danger-200 rounded-md p-4">
                            <div className="text-sm text-danger-800">
                                <strong>Important:</strong> This password will
                                not be shown again. Copy it now and store it
                                securely. You can always delete and create a new
                                one if needed.
                            </div>
                        </div>

                        <div className="bg-primary-50 border border-primary-200 rounded-md p-4">
                            <h4 className="text-sm font-medium text-primary-900 mb-2">
                                Setup Instructions
                            </h4>
                            <div className="text-sm text-primary-800 space-y-1">
                                <div>1. Open your email client settings</div>
                                <div>
                                    2. Use your regular email address as the
                                    username
                                </div>
                                <div>
                                    3. Use the generated app password instead of
                                    your account password
                                </div>
                                <div>
                                    4. Configure IMAP/SMTP settings as usual
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
};

export default AppPasswords;
