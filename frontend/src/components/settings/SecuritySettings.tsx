import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation } from "react-query";
import { authAPI } from "../../services/api";
import { useAuthStore } from "../../stores/authStore";
import Button from "../common/Button";
import Input from "../common/Input";
import Modal from "../common/Modal";
import {
    KeyIcon,
    EyeIcon,
    EyeSlashIcon,
    ShieldCheckIcon,
    LockClosedIcon,
} from "@heroicons/react/24/outline";
import toast from "react-hot-toast";

interface PasswordChangeForm {
    current_password: string;
    new_password: string;
    confirm_password: string;
}

const SecuritySettings: React.FC = () => {
    const { user } = useAuthStore();
    const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    const {
        register,
        handleSubmit,
        watch,
        reset,
        formState: { errors },
    } = useForm<PasswordChangeForm>();

    const changePasswordMutation = useMutation(
        (data: PasswordChangeForm) =>
            authAPI.changePassword({
                currentPassword: data.current_password,
                newPassword: data.new_password,
            }),
        {
            onSuccess: () => {
                toast.success("Password changed successfully!");
                setIsPasswordModalOpen(false);
                reset();
            },
            onError: (error: any) => {
                toast.error(
                    error.response?.data?.error || "Failed to change password"
                );
            },
        }
    );

    const onSubmit = (data: PasswordChangeForm) => {
        if (data.new_password !== data.confirm_password) {
            toast.error("New passwords do not match");
            return;
        }
        changePasswordMutation.mutate(data);
    };

    const validatePassword = (password: string) => {
        const minLength = password.length >= 8;
        const hasUpperCase = /[A-Z]/.test(password);
        const hasLowerCase = /[a-z]/.test(password);
        const hasNumbers = /\d/.test(password);
        const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

        return {
            minLength,
            hasUpperCase,
            hasLowerCase,
            hasNumbers,
            hasSpecialChar,
            isValid:
                minLength &&
                hasUpperCase &&
                hasLowerCase &&
                hasNumbers &&
                hasSpecialChar,
        };
    };

    const watchNewPassword = watch("new_password");
    const passwordValidation = watchNewPassword
        ? validatePassword(watchNewPassword)
        : null;

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-medium text-content mb-4">
                    <ShieldCheckIcon className="h-5 w-5 inline mr-2" />
                    Security Settings
                </h3>

                <div className="bg-surface shadow rounded-lg p-6 space-y-6">
                    {/* Password Section */}
                    <div className="flex items-center justify-between">
                        <div>
                            <h4 className="text-md font-medium text-content flex items-center">
                                <LockClosedIcon className="h-5 w-5 mr-2" />
                                Password
                            </h4>
                            <p className="text-sm text-content-muted mt-1">
                                Change your account password to keep your
                                account secure
                            </p>
                        </div>
                        <Button
                            onClick={() => setIsPasswordModalOpen(true)}
                            variant="outline"
                        >
                            Change Password
                        </Button>
                    </div>

                    {/* Account Security Status */}
                    <div className="border-t border-line pt-6">
                        <h4 className="text-md font-medium text-content mb-4">
                            Security Status
                        </h4>

                        <div className="space-y-3">
                            <div className="flex items-center justify-between p-3 bg-success-50 border border-success-200 rounded-md">
                                <div className="flex items-center">
                                    <div className="h-2 w-2 bg-success-500 rounded-full mr-3"></div>
                                    <div>
                                        <p className="text-sm font-medium text-success-900">
                                            Strong Password
                                        </p>
                                        <p className="text-xs text-success-700">
                                            Your password meets security
                                            requirements
                                        </p>
                                    </div>
                                </div>
                                <ShieldCheckIcon className="h-5 w-5 text-success-500" />
                            </div>

                            <div
                                className={`flex items-center justify-between p-3 border rounded-md ${
                                    user?.two_factor_enabled
                                        ? "bg-success-50 border-success-200"
                                        : "bg-warning-50 border-warning-200"
                                }`}
                            >
                                <div className="flex items-center">
                                    <div
                                        className={`h-2 w-2 rounded-full mr-3 ${
                                            user?.two_factor_enabled
                                                ? "bg-success-500"
                                                : "bg-warning-500"
                                        }`}
                                    ></div>
                                    <div>
                                        <p
                                            className={`text-sm font-medium ${
                                                user?.two_factor_enabled
                                                    ? "text-success-900"
                                                    : "text-warning-900"
                                            }`}
                                        >
                                            Two-Factor Authentication
                                        </p>
                                        <p
                                            className={`text-xs ${
                                                user?.two_factor_enabled
                                                    ? "text-success-700"
                                                    : "text-warning-700"
                                            }`}
                                        >
                                            {user?.two_factor_enabled
                                                ? "Your account is protected with 2FA"
                                                : "Enable 2FA for additional security"}
                                        </p>
                                    </div>
                                </div>
                                <ShieldCheckIcon
                                    className={`h-5 w-5 ${
                                        user?.two_factor_enabled
                                            ? "text-success-500"
                                            : "text-warning-500"
                                    }`}
                                />
                            </div>

                            <div className="flex items-center justify-between p-3 bg-primary-50 border border-primary-200 rounded-md">
                                <div className="flex items-center">
                                    <div className="h-2 w-2 bg-primary-500 rounded-full mr-3"></div>
                                    <div>
                                        <p className="text-sm font-medium text-primary-900">
                                            Secure Connection
                                        </p>
                                        <p className="text-xs text-primary-700">
                                            Your connection is encrypted with
                                            HTTPS
                                        </p>
                                    </div>
                                </div>
                                <LockClosedIcon className="h-5 w-5 text-primary-500" />
                            </div>
                        </div>
                    </div>

                    {/* Security Recommendations */}
                    <div className="border-t border-line pt-6">
                        <h4 className="text-md font-medium text-content mb-4">
                            Security Recommendations
                        </h4>

                        <div className="space-y-3">
                            {!user?.two_factor_enabled && (
                                <div className="p-3 bg-warning-50 border border-warning-200 rounded-md">
                                    <div className="flex">
                                        <div className="flex-shrink-0">
                                            <ShieldCheckIcon className="h-5 w-5 text-warning-500" />
                                        </div>
                                        <div className="ml-3">
                                            <h5 className="text-sm font-medium text-warning-800">
                                                Enable Two-Factor Authentication
                                            </h5>
                                            <p className="text-sm text-warning-700 mt-1">
                                                Add an extra layer of security
                                                to protect your account from
                                                unauthorized access.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="p-3 bg-primary-50 border border-primary-200 rounded-md">
                                <div className="flex">
                                    <div className="flex-shrink-0">
                                        <KeyIcon className="h-5 w-5 text-primary-400" />
                                    </div>
                                    <div className="ml-3">
                                        <h5 className="text-sm font-medium text-primary-800">
                                            Use App Passwords
                                        </h5>
                                        <p className="text-sm text-primary-700 mt-1">
                                            Create app-specific passwords for
                                            third-party email clients instead of
                                            using your main password.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="p-3 bg-success-50 border border-success-200 rounded-md">
                                <div className="flex">
                                    <div className="flex-shrink-0">
                                        <LockClosedIcon className="h-5 w-5 text-success-400" />
                                    </div>
                                    <div className="ml-3">
                                        <h5 className="text-sm font-medium text-success-800">
                                            Regular Password Updates
                                        </h5>
                                        <p className="text-sm text-success-700 mt-1">
                                            Consider changing your password
                                            every 3-6 months for optimal
                                            security.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Recent Security Activity */}
                    <div className="border-t border-line pt-6">
                        <h4 className="text-md font-medium text-content mb-4">
                            Recent Security Activity
                        </h4>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-content-muted">
                                    Last password change
                                </span>
                                <span className="text-content">
                                    3 months ago
                                </span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-content-muted">
                                    Last login
                                </span>
                                <span className="text-content">
                                    {user?.last_login
                                        ? new Date(
                                              user.last_login
                                          ).toLocaleDateString()
                                        : "Never"}
                                </span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-content-muted">
                                    Account created
                                </span>
                                <span className="text-content">
                                    {user?.created_at
                                        ? new Date(
                                              user.created_at
                                          ).toLocaleDateString()
                                        : "Unknown"}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Change Password Modal */}
            <Modal
                isOpen={isPasswordModalOpen}
                onClose={() => setIsPasswordModalOpen(false)}
                title="Change Password"
                size="md"
                actions={
                    <div className="flex space-x-2">
                        <Button
                            form="password-form"
                            type="submit"
                            loading={changePasswordMutation.isLoading}
                            disabled={!passwordValidation?.isValid}
                        >
                            Update Password
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => setIsPasswordModalOpen(false)}
                        >
                            Cancel
                        </Button>
                    </div>
                }
            >
                <form
                    id="password-form"
                    onSubmit={handleSubmit(onSubmit)}
                    className="space-y-4"
                >
                    <div className="relative">
                        <Input
                            label="Current Password"
                            type={showCurrentPassword ? "text" : "password"}
                            {...register("current_password", {
                                required: "Current password is required",
                            })}
                            error={errors.current_password?.message}
                        />
                        <button
                            type="button"
                            className="absolute inset-y-0 right-0 top-6 pr-3 flex items-center"
                            onClick={() =>
                                setShowCurrentPassword(!showCurrentPassword)
                            }
                        >
                            {showCurrentPassword ? (
                                <EyeSlashIcon className="h-4 w-4 text-content-subtle" />
                            ) : (
                                <EyeIcon className="h-4 w-4 text-content-subtle" />
                            )}
                        </button>
                    </div>

                    <div className="relative">
                        <Input
                            label="New Password"
                            type={showNewPassword ? "text" : "password"}
                            {...register("new_password", {
                                required: "New password is required",
                                minLength: {
                                    value: 8,
                                    message:
                                        "Password must be at least 8 characters",
                                },
                            })}
                            error={errors.new_password?.message}
                        />
                        <button
                            type="button"
                            className="absolute inset-y-0 right-0 top-6 pr-3 flex items-center"
                            onClick={() => setShowNewPassword(!showNewPassword)}
                        >
                            {showNewPassword ? (
                                <EyeSlashIcon className="h-4 w-4 text-content-subtle" />
                            ) : (
                                <EyeIcon className="h-4 w-4 text-content-subtle" />
                            )}
                        </button>
                    </div>

                    {/* Password Requirements */}
                    {passwordValidation && (
                        <div className="bg-surface-sunken p-4 rounded-md">
                            <h5 className="text-sm font-medium text-content mb-2">
                                Password Requirements
                            </h5>
                            <div className="space-y-1">
                                <div
                                    className={`flex items-center text-xs ${passwordValidation.minLength ? "text-success-600" : "text-content-subtle"}`}
                                >
                                    <div
                                        className={`h-1.5 w-1.5 rounded-full mr-2 ${passwordValidation.minLength ? "bg-success-500" : "bg-line-strong"}`}
                                    ></div>
                                    At least 8 characters
                                </div>
                                <div
                                    className={`flex items-center text-xs ${passwordValidation.hasUpperCase ? "text-success-600" : "text-content-subtle"}`}
                                >
                                    <div
                                        className={`h-1.5 w-1.5 rounded-full mr-2 ${passwordValidation.hasUpperCase ? "bg-success-500" : "bg-line-strong"}`}
                                    ></div>
                                    One uppercase letter
                                </div>
                                <div
                                    className={`flex items-center text-xs ${passwordValidation.hasLowerCase ? "text-success-600" : "text-content-subtle"}`}
                                >
                                    <div
                                        className={`h-1.5 w-1.5 rounded-full mr-2 ${passwordValidation.hasLowerCase ? "bg-success-500" : "bg-line-strong"}`}
                                    ></div>
                                    One lowercase letter
                                </div>
                                <div
                                    className={`flex items-center text-xs ${passwordValidation.hasNumbers ? "text-success-600" : "text-content-subtle"}`}
                                >
                                    <div
                                        className={`h-1.5 w-1.5 rounded-full mr-2 ${passwordValidation.hasNumbers ? "bg-success-500" : "bg-line-strong"}`}
                                    ></div>
                                    One number
                                </div>
                                <div
                                    className={`flex items-center text-xs ${passwordValidation.hasSpecialChar ? "text-success-600" : "text-content-subtle"}`}
                                >
                                    <div
                                        className={`h-1.5 w-1.5 rounded-full mr-2 ${passwordValidation.hasSpecialChar ? "bg-success-500" : "bg-line-strong"}`}
                                    ></div>
                                    One special character
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="relative">
                        <Input
                            label="Confirm New Password"
                            type={showConfirmPassword ? "text" : "password"}
                            {...register("confirm_password", {
                                required: "Please confirm your new password",
                            })}
                            error={errors.confirm_password?.message}
                        />
                        <button
                            type="button"
                            className="absolute inset-y-0 right-0 top-6 pr-3 flex items-center"
                            onClick={() =>
                                setShowConfirmPassword(!showConfirmPassword)
                            }
                        >
                            {showConfirmPassword ? (
                                <EyeSlashIcon className="h-4 w-4 text-content-subtle" />
                            ) : (
                                <EyeIcon className="h-4 w-4 text-content-subtle" />
                            )}
                        </button>
                    </div>

                    <div className="bg-warning-50 border border-warning-200 rounded-md p-4">
                        <div className="text-sm text-warning-800">
                            <strong>Note:</strong> After changing your password,
                            you'll need to update it in any email clients or
                            applications that use your account credentials.
                        </div>
                    </div>
                </form>
            </Modal>
        </div>
    );
};

export default SecuritySettings;
