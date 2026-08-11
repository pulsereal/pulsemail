import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
    EnvelopeIcon,
    EyeIcon,
    EyeSlashIcon,
    LockClosedIcon,
    ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { useAuthStore } from "../stores/authStore";
import Button from "../components/common/Button";
import Input from "../components/common/Input";

interface LoginForm {
    email: string;
    password: string;
    twoFactorCode?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const LoginPage: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const login = useAuthStore((state) => state.login);
    const isLoading = useAuthStore((state) => state.isLoading);

    const [showPassword, setShowPassword] = useState(false);
    const [requires2FA, setRequires2FA] = useState(false);

    const {
        register,
        handleSubmit,
        formState: { errors },
    } = useForm<LoginForm>({
        defaultValues: { email: "", password: "", twoFactorCode: "" },
    });

    const onSubmit = async (data: LoginForm) => {
        try {
            await login(data.email, data.password, data.twoFactorCode);
            const target =
                (location.state as { from?: string } | null)?.from || "/emails";
            navigate(target, { replace: true });
        } catch (error) {
            const response = (
                error as {
                    response?: {
                        data?: { requires2FA?: boolean; error?: string };
                    };
                }
            ).response;

            if (response?.data?.requires2FA) {
                setRequires2FA(true);
                toast("Enter the code from your authenticator app");
                return;
            }

            toast.error(response?.data?.error || "Sign in failed");
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12">
            <div className="w-full max-w-md">
                <div className="text-center">
                    <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-600 shadow-medium">
                        <EnvelopeIcon className="h-7 w-7 text-white" />
                    </span>
                    <h1 className="mt-6 text-2xl font-semibold tracking-tight text-content">
                        Sign in to Pulsemail
                    </h1>
                    <p className="mt-1.5 text-sm text-content-muted">
                        Use your mailbox address and password.
                    </p>
                </div>

                <form
                    onSubmit={handleSubmit(onSubmit)}
                    className="mt-8 space-y-5 rounded-xl border border-line bg-surface p-6 shadow-soft sm:p-8"
                >
                    <Input
                        label="Email address"
                        type="email"
                        autoComplete="email"
                        autoFocus
                        placeholder="you@example.com"
                        icon={<EnvelopeIcon className="h-5 w-5" />}
                        error={errors.email?.message}
                        {...register("email", {
                            required: "Email is required",
                            pattern: {
                                value: EMAIL_PATTERN,
                                message: "Enter a valid email address",
                            },
                        })}
                    />

                    <Input
                        label="Password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        placeholder="••••••••"
                        icon={<LockClosedIcon className="h-5 w-5" />}
                        error={errors.password?.message}
                        action={
                            <button
                                type="button"
                                onClick={() => setShowPassword((v) => !v)}
                                aria-label={
                                    showPassword
                                        ? "Hide password"
                                        : "Show password"
                                }
                                className="rounded p-1 text-content-subtle transition-colors hover:text-content"
                            >
                                {showPassword ? (
                                    <EyeSlashIcon className="h-5 w-5" />
                                ) : (
                                    <EyeIcon className="h-5 w-5" />
                                )}
                            </button>
                        }
                        {...register("password", {
                            required: "Password is required",
                        })}
                    />

                    {requires2FA && (
                        <Input
                            label="Two-factor code"
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={6}
                            placeholder="000000"
                            className="text-center font-mono tracking-[0.4em]"
                            icon={<ShieldCheckIcon className="h-5 w-5" />}
                            helpText="Six digits from your authenticator app."
                            error={errors.twoFactorCode?.message}
                            {...register("twoFactorCode", {
                                required: requires2FA
                                    ? "Two-factor code is required"
                                    : false,
                                pattern: {
                                    value: /^\d{6}$/,
                                    message: "The code is exactly six digits",
                                },
                            })}
                        />
                    )}

                    <Button
                        type="submit"
                        fullWidth
                        size="lg"
                        loading={isLoading}
                    >
                        {isLoading ? "Signing in…" : "Sign in"}
                    </Button>

                    {requires2FA && (
                        <button
                            type="button"
                            onClick={() => setRequires2FA(false)}
                            className="block w-full text-center text-sm font-medium text-primary-600 hover:text-primary-500"
                        >
                            Back to sign in
                        </button>
                    )}
                </form>
            </div>
        </div>
    );
};

export default LoginPage;
