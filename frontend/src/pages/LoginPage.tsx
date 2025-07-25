import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { useAuthStore } from "../stores/authStore";
import {
    EyeIcon,
    EyeSlashIcon,
    EnvelopeIcon,
    LockClosedIcon,
    ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import LoadingSpinner from "../components/LoadingSpinner";
import toast from "react-hot-toast";

interface LoginForm {
    email: string;
    password: string;
    twoFactorCode?: string;
}

const LoginPage: React.FC = () => {
    const [showPassword, setShowPassword] = useState(false);
    const [requires2FA, setRequires2FA] = useState(false);
    const { login, isLoading } = useAuthStore();

    const {
        register,
        handleSubmit,
        formState: { errors },
        watch,
    } = useForm<LoginForm>();

    const onSubmit = async (data: LoginForm) => {
        try {
            await login(data.email, data.password, data.twoFactorCode);
            toast.success("Login successful!");
        } catch (error: any) {
            if (error.response?.data?.requires2FA) {
                setRequires2FA(true);
                toast.info("Please enter your 2FA code");
            } else {
                toast.error(error.response?.data?.error || "Login failed");
            }
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                {/* Logo and Title */}
                <div className="mx-auto h-16 w-16 flex items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg">
                    <EnvelopeIcon className="h-8 w-8 text-white" />
                </div>

                <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-gray-900">
                    Sign in to your account
                </h2>

                <p className="mt-2 text-center text-sm text-gray-600">
                    Pulsemail Custom Client
                </p>

                <div className="mt-2 text-center">
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        Enhanced with AI features
                    </span>
                </div>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-white py-8 px-4 shadow-xl sm:rounded-lg sm:px-10 border border-gray-100">
                    <div className="space-y-6">
                        {/* Email Field */}
                        <div>
                            <label
                                htmlFor="email"
                                className="block text-sm font-medium text-gray-700 mb-1"
                            >
                                Email address
                            </label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <EnvelopeIcon className="h-5 w-5 text-gray-400" />
                                </div>
                                <input
                                    {...register("email", {
                                        required: "Email is required",
                                        pattern: {
                                            value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                                            message:
                                                "Please enter a valid email address",
                                        },
                                    })}
                                    type="email"
                                    autoComplete="email"
                                    className={`
                    block w-full pl-10 pr-3 py-3 border rounded-lg shadow-sm placeholder-gray-400 
                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                    text-sm transition-all duration-200
                    ${
                        errors.email
                            ? "border-red-300 focus:ring-red-500 focus:border-red-500"
                            : "border-gray-300"
                    }
                    ${requires2FA ? "rounded-t-lg rounded-b-none" : ""}
                  `}
                                    placeholder="Enter your email address"
                                />
                            </div>
                            {errors.email && (
                                <p className="mt-2 text-sm text-red-600 flex items-center">
                                    <span className="w-1 h-1 bg-red-600 rounded-full mr-2"></span>
                                    {errors.email.message}
                                </p>
                            )}
                        </div>

                        {/* Password Field */}
                        <div>
                            <label
                                htmlFor="password"
                                className="block text-sm font-medium text-gray-700 mb-1"
                            >
                                Password
                            </label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <LockClosedIcon className="h-5 w-5 text-gray-400" />
                                </div>
                                <input
                                    {...register("password", {
                                        required: "Password is required",
                                        minLength: {
                                            value: 6,
                                            message:
                                                "Password must be at least 6 characters",
                                        },
                                    })}
                                    type={showPassword ? "text" : "password"}
                                    autoComplete="current-password"
                                    className={`
                    block w-full pl-10 pr-12 py-3 border rounded-lg shadow-sm placeholder-gray-400 
                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                    text-sm transition-all duration-200
                    ${
                        errors.password
                            ? "border-red-300 focus:ring-red-500 focus:border-red-500"
                            : "border-gray-300"
                    }
                    ${requires2FA ? "rounded-none" : ""}
                  `}
                                    placeholder="Enter your password"
                                />
                                <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setShowPassword(!showPassword)
                                        }
                                        className="text-gray-400 hover:text-gray-600 focus:outline-none focus:text-gray-600 transition-colors duration-200"
                                    >
                                        {showPassword ? (
                                            <EyeSlashIcon className="h-5 w-5" />
                                        ) : (
                                            <EyeIcon className="h-5 w-5" />
                                        )}
                                    </button>
                                </div>
                            </div>
                            {errors.password && (
                                <p className="mt-2 text-sm text-red-600 flex items-center">
                                    <span className="w-1 h-1 bg-red-600 rounded-full mr-2"></span>
                                    {errors.password.message}
                                </p>
                            )}
                        </div>

                        {/* 2FA Code Field */}
                        {requires2FA && (
                            <div className="animate-slide-down">
                                <label
                                    htmlFor="twoFactorCode"
                                    className="block text-sm font-medium text-gray-700 mb-1"
                                >
                                    Two-Factor Authentication Code
                                </label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <ShieldCheckIcon className="h-5 w-5 text-gray-400" />
                                    </div>
                                    <input
                                        {...register("twoFactorCode", {
                                            required: requires2FA
                                                ? "2FA code is required"
                                                : false,
                                            pattern: {
                                                value: /^\d{6}$/,
                                                message:
                                                    "2FA code must be exactly 6 digits",
                                            },
                                        })}
                                        type="text"
                                        autoComplete="one-time-code"
                                        maxLength={6}
                                        className={`
                      block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-b-lg shadow-sm 
                      placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 
                      focus:border-blue-500 text-sm text-center font-mono text-lg tracking-widest
                      transition-all duration-200
                      ${
                          errors.twoFactorCode
                              ? "border-red-300 focus:ring-red-500 focus:border-red-500"
                              : ""
                      }
                    `}
                                        placeholder="000000"
                                    />
                                </div>
                                {errors.twoFactorCode && (
                                    <p className="mt-2 text-sm text-red-600 flex items-center">
                                        <span className="w-1 h-1 bg-red-600 rounded-full mr-2"></span>
                                        {errors.twoFactorCode.message}
                                    </p>
                                )}
                                <p className="mt-2 text-xs text-gray-500">
                                    Enter the 6-digit code from your
                                    authenticator app
                                </p>
                            </div>
                        )}

                        {/* Submit Button */}
                        <div>
                            <button
                                type="button"
                                onClick={handleSubmit(onSubmit)}
                                disabled={isLoading}
                                className={`
                  group relative w-full flex justify-center py-3 px-4 border border-transparent 
                  text-sm font-medium rounded-lg text-white transition-all duration-200
                  focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500
                  ${
                      isLoading
                          ? "bg-gray-400 cursor-not-allowed"
                          : "bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                  }
                `}
                            >
                                <span className="absolute left-0 inset-y-0 flex items-center pl-3">
                                    {isLoading ? (
                                        <LoadingSpinner
                                            size="sm"
                                            className="text-white"
                                        />
                                    ) : (
                                        <LockClosedIcon className="h-5 w-5 text-blue-300 group-hover:text-blue-200" />
                                    )}
                                </span>
                                {isLoading ? "Signing in..." : "Sign in"}
                            </button>
                        </div>

                        {/* Back to login link for 2FA */}
                        {requires2FA && (
                            <div className="text-center animate-slide-down">
                                <button
                                    type="button"
                                    onClick={() => setRequires2FA(false)}
                                    className="text-sm text-blue-600 hover:text-blue-500 font-medium transition-colors duration-200"
                                >
                                    ← Back to login
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Divider */}
                    <div className="mt-6">
                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-gray-300" />
                            </div>
                            <div className="relative flex justify-center text-sm">
                                <span className="px-2 bg-white text-gray-500">
                                    Secure Pulsemail Access
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Features */}
                    <div className="mt-6">
                        <div className="grid grid-cols-2 gap-4 text-center">
                            <div className="flex flex-col items-center p-3 bg-gray-50 rounded-lg">
                                <ShieldCheckIcon className="h-6 w-6 text-blue-600 mb-1" />
                                <span className="text-xs font-medium text-gray-700">
                                    2FA Security
                                </span>
                            </div>
                            <div className="flex flex-col items-center p-3 bg-gray-50 rounded-lg">
                                <EnvelopeIcon className="h-6 w-6 text-green-600 mb-1" />
                                <span className="text-xs font-medium text-gray-700">
                                    AI Features
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="mt-8 text-center">
                    <p className="text-sm text-gray-600">
                        Enhanced email client with campaigns, automation, and AI
                        features
                    </p>
                    <div className="mt-2 flex justify-center space-x-4 text-xs text-gray-500">
                        <span>• Spam Protection</span>
                        <span>• Smart Categorization</span>
                        <span>• Campaign Management</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LoginPage;
