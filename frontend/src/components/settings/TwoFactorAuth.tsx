import React, { useState } from "react";
import { useMutation } from "react-query";
import { authAPI } from "../../services/api";
import { useAuthStore } from "../../stores/authStore";
import Button from "../common/Button";
import Input from "../common/Input";
import Modal from "../common/Modal";
import {
    ShieldCheckIcon,
    QrCodeIcon,
    KeyIcon,
    CheckCircleIcon,
    XCircleIcon,
    ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import toast from "react-hot-toast";

interface TwoFactorSetup {
    secret: string;
    qr_code: string;
    backup_codes: string[];
}

const TwoFactorAuth: React.FC = () => {
    const { user, updateUser } = useAuthStore();
    const [setupData, setSetupData] = useState<TwoFactorSetup | null>(null);
    const [isSetupModalOpen, setIsSetupModalOpen] = useState(false);
    const [isDisableModalOpen, setIsDisableModalOpen] = useState(false);
    const [verificationCode, setVerificationCode] = useState("");
    const [disablePassword, setDisablePassword] = useState("");
    const [disableCode, setDisableCode] = useState("");
    const [step, setStep] = useState(1); // 1: QR Code, 2: Verify, 3: Backup Codes

    // Setup 2FA mutation
    const setup2FAMutation = useMutation(authAPI.setup2FA, {
        onSuccess: (response) => {
            setSetupData(response.data);
            setIsSetupModalOpen(true);
            setStep(1);
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.error || "Failed to setup 2FA");
        },
    });

    // Verify 2FA mutation
    const verify2FAMutation = useMutation(authAPI.verify2FA, {
        onSuccess: (response) => {
            updateUser(response.data.user);
            setStep(3); // Show backup codes
            toast.success("Two-factor authentication enabled successfully!");
        },
        onError: (error: any) => {
            toast.error(
                error.response?.data?.error || "Invalid verification code"
            );
        },
    });

    // Disable 2FA mutation
    const disable2FAMutation = useMutation(
        ({ token, password }: { token: string; password: string }) =>
            authAPI.disable2FA(token, password),
        {
            onSuccess: (response) => {
                updateUser(response.data.user);
                setIsDisableModalOpen(false);
                setDisablePassword("");
                setDisableCode("");
                toast.success(
                    "Two-factor authentication disabled successfully"
                );
            },
            onError: (error: any) => {
                toast.error(
                    error.response?.data?.error || "Failed to disable 2FA"
                );
            },
        }
    );

    const handleSetup2FA = () => {
        setup2FAMutation.mutate();
    };

    const handleVerify = () => {
        if (!verificationCode.trim()) {
            toast.error("Please enter the verification code");
            return;
        }
        verify2FAMutation.mutate(verificationCode);
    };

    const handleDisable2FA = () => {
        if (!disablePassword.trim() || !disableCode.trim()) {
            toast.error("Please enter both password and verification code");
            return;
        }
        disable2FAMutation.mutate({
            token: disableCode,
            password: disablePassword,
        });
    };

    const handleFinishSetup = () => {
        setIsSetupModalOpen(false);
        setSetupData(null);
        setVerificationCode("");
        setStep(1);
    };

    const copyBackupCodes = () => {
        if (setupData?.backup_codes) {
            navigator.clipboard.writeText(setupData.backup_codes.join("\n"));
            toast.success("Backup codes copied to clipboard");
        }
    };

    const downloadBackupCodes = () => {
        if (setupData?.backup_codes) {
            const content = `Pulsemail 2FA Backup Codes\n\nGenerated: ${new Date().toLocaleString()}\n\n${setupData.backup_codes.join("\n")}\n\nKeep these codes safe. Each code can only be used once.`;
            const blob = new Blob([content], { type: "text/plain" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "pulsemail-backup-codes.txt";
            a.click();
            URL.revokeObjectURL(url);
        }
    };

    const renderSetupStep = () => {
        switch (step) {
            case 1:
                return (
                    <div className="space-y-4">
                        <div className="text-center">
                            <QrCodeIcon className="h-16 w-16 text-content-subtle mx-auto mb-4" />
                            <h3 className="text-lg font-medium text-content mb-2">
                                Scan QR Code
                            </h3>
                            <p className="text-sm text-content-muted mb-4">
                                Use your authenticator app (Google
                                Authenticator, Authy, etc.) to scan this QR
                                code.
                            </p>
                        </div>

                        {setupData?.qr_code && (
                            <div className="flex justify-center">
                                <img
                                    src={setupData.qr_code}
                                    alt="2FA QR Code"
                                    className="border border-line-strong rounded-lg"
                                />
                            </div>
                        )}

                        <div className="bg-surface-sunken p-4 rounded-md">
                            <p className="text-sm text-content-muted mb-2">
                                Or enter this secret key manually:
                            </p>
                            <code className="text-sm font-mono bg-surface px-2 py-1 rounded border">
                                {setupData?.secret}
                            </code>
                        </div>
                    </div>
                );

            case 2:
                return (
                    <div className="space-y-4">
                        <div className="text-center">
                            <KeyIcon className="h-16 w-16 text-content-subtle mx-auto mb-4" />
                            <h3 className="text-lg font-medium text-content mb-2">
                                Verify Setup
                            </h3>
                            <p className="text-sm text-content-muted mb-4">
                                Enter the 6-digit code from your authenticator
                                app to complete setup.
                            </p>
                        </div>

                        <Input
                            label="Verification Code"
                            value={verificationCode}
                            onChange={(e) =>
                                setVerificationCode(e.target.value)
                            }
                            placeholder="000000"
                            maxLength={6}
                            className="text-center text-lg tracking-widest"
                        />
                    </div>
                );

            case 3:
                return (
                    <div className="space-y-4">
                        <div className="text-center">
                            <CheckCircleIcon className="h-16 w-16 text-success-500 mx-auto mb-4" />
                            <h3 className="text-lg font-medium text-content mb-2">
                                Setup Complete!
                            </h3>
                            <p className="text-sm text-content-muted mb-4">
                                Two-factor authentication is now enabled. Save
                                these backup codes in a safe place.
                            </p>
                        </div>

                        <div className="bg-warning-50 border border-warning-200 rounded-md p-4">
                            <div className="flex">
                                <ExclamationTriangleIcon className="h-5 w-5 text-warning-500 mr-2 mt-0.5" />
                                <div>
                                    <h4 className="text-sm font-medium text-warning-800">
                                        Important
                                    </h4>
                                    <p className="text-sm text-warning-700 mt-1">
                                        These backup codes can be used to access
                                        your account if you lose your
                                        authenticator device. Each code can only
                                        be used once.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-surface-sunken p-4 rounded-md">
                            <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                                {setupData?.backup_codes.map((code, index) => (
                                    <div
                                        key={index}
                                        className="bg-surface px-2 py-1 rounded border"
                                    >
                                        {code}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="flex space-x-3">
                            <Button
                                variant="outline"
                                onClick={copyBackupCodes}
                                className="flex-1"
                            >
                                Copy Codes
                            </Button>
                            <Button
                                variant="outline"
                                onClick={downloadBackupCodes}
                                className="flex-1"
                            >
                                Download
                            </Button>
                        </div>
                    </div>
                );

            default:
                return null;
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-medium text-content mb-4">
                    <ShieldCheckIcon className="h-5 w-5 inline mr-2" />
                    Two-Factor Authentication
                </h3>

                <div className="bg-surface shadow rounded-lg p-6">
                    <div className="flex items-start justify-between">
                        <div className="flex-1">
                            <div className="flex items-center mb-2">
                                {user?.two_factor_enabled ? (
                                    <CheckCircleIcon className="h-5 w-5 text-success-500 mr-2" />
                                ) : (
                                    <XCircleIcon className="h-5 w-5 text-content-subtle mr-2" />
                                )}
                                <h4 className="text-md font-medium text-content">
                                    Two-Factor Authentication
                                </h4>
                            </div>

                            <p className="text-sm text-content-muted mb-4">
                                {user?.two_factor_enabled
                                    ? "Two-factor authentication is enabled for your account. This adds an extra layer of security."
                                    : "Add an extra layer of security to your account by enabling two-factor authentication."}
                            </p>

                            {user?.two_factor_enabled && (
                                <div className="bg-success-50 border border-success-200 rounded-md p-3 mb-4">
                                    <div className="flex">
                                        <CheckCircleIcon className="h-5 w-5 text-success-400 mr-2" />
                                        <div>
                                            <h5 className="text-sm font-medium text-success-800">
                                                Protected
                                            </h5>
                                            <p className="text-sm text-success-700">
                                                Your account is protected with
                                                two-factor authentication.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="ml-6">
                            {user?.two_factor_enabled ? (
                                <Button
                                    variant="danger"
                                    onClick={() => setIsDisableModalOpen(true)}
                                >
                                    Disable 2FA
                                </Button>
                            ) : (
                                <Button
                                    onClick={handleSetup2FA}
                                    loading={setup2FAMutation.isLoading}
                                >
                                    Enable 2FA
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Setup 2FA Modal */}
            <Modal
                isOpen={isSetupModalOpen}
                onClose={() => setIsSetupModalOpen(false)}
                title="Setup Two-Factor Authentication"
                size="lg"
                actions={
                    <div className="flex justify-between w-full">
                        <div>
                            {step > 1 && step < 3 && (
                                <Button
                                    variant="outline"
                                    onClick={() => setStep(step - 1)}
                                >
                                    Back
                                </Button>
                            )}
                        </div>
                        <div className="flex space-x-2">
                            {step === 1 && (
                                <Button onClick={() => setStep(2)}>Next</Button>
                            )}
                            {step === 2 && (
                                <Button
                                    onClick={handleVerify}
                                    loading={verify2FAMutation.isLoading}
                                    disabled={!verificationCode.trim()}
                                >
                                    Verify & Enable
                                </Button>
                            )}
                            {step === 3 && (
                                <Button onClick={handleFinishSetup}>
                                    Finish
                                </Button>
                            )}
                        </div>
                    </div>
                }
            >
                {renderSetupStep()}
            </Modal>

            {/* Disable 2FA Modal */}
            <Modal
                isOpen={isDisableModalOpen}
                onClose={() => setIsDisableModalOpen(false)}
                title="Disable Two-Factor Authentication"
                size="md"
                actions={
                    <div className="flex space-x-2">
                        <Button
                            variant="danger"
                            onClick={handleDisable2FA}
                            loading={disable2FAMutation.isLoading}
                            disabled={
                                !disablePassword.trim() || !disableCode.trim()
                            }
                        >
                            Disable 2FA
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => setIsDisableModalOpen(false)}
                        >
                            Cancel
                        </Button>
                    </div>
                }
            >
                <div className="space-y-4">
                    <div className="bg-danger-50 border border-danger-200 rounded-md p-4">
                        <div className="flex">
                            <ExclamationTriangleIcon className="h-5 w-5 text-danger-400 mr-2" />
                            <div>
                                <h4 className="text-sm font-medium text-danger-800">
                                    Warning
                                </h4>
                                <p className="text-sm text-danger-700 mt-1">
                                    Disabling two-factor authentication will
                                    make your account less secure.
                                </p>
                            </div>
                        </div>
                    </div>

                    <Input
                        label="Current Password"
                        type="password"
                        value={disablePassword}
                        onChange={(e) => setDisablePassword(e.target.value)}
                        placeholder="Enter your current password"
                    />

                    <Input
                        label="Verification Code"
                        value={disableCode}
                        onChange={(e) => setDisableCode(e.target.value)}
                        placeholder="Enter code from your authenticator app"
                        maxLength={6}
                    />
                </div>
            </Modal>
        </div>
    );
};

export default TwoFactorAuth;
