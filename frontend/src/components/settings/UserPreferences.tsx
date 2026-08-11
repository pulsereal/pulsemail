import React from "react";
import { useForm } from "react-hook-form";
import { useMutation } from "react-query";
import toast from "react-hot-toast";
import {
    BellIcon,
    ClockIcon,
    GlobeAltIcon,
    UserIcon,
} from "@heroicons/react/24/outline";
import { authAPI } from "../../services/api";
import { useAuthStore } from "../../stores/authStore";
import { useTheme } from "../../providers/ThemeProvider";
import { errorMessage } from "../common/ErrorState";
import Button from "../common/Button";
import Card, { CardHeader } from "../common/Card";
import Checkbox from "../common/Checkbox";
import Input from "../common/Input";
import Select from "../common/Select";

interface UserPreferencesForm {
    name: string;
    email: string;
    language: string;
    timezone: string;
    theme: "light" | "dark" | "auto";
    emails_per_page: string;
    auto_refresh_interval: string;
    default_folder: string;
    email_notifications: boolean;
    desktop_notifications: boolean;
    sound_notifications: boolean;
    marketing_emails: boolean;
}

const TIMEZONES = [
    { value: "UTC", label: "UTC (Coordinated Universal Time)" },
    { value: "America/New_York", label: "Eastern Time (US & Canada)" },
    { value: "America/Chicago", label: "Central Time (US & Canada)" },
    { value: "America/Denver", label: "Mountain Time (US & Canada)" },
    { value: "America/Los_Angeles", label: "Pacific Time (US & Canada)" },
    { value: "Europe/London", label: "London (GMT)" },
    { value: "Europe/Paris", label: "Central European Time" },
    { value: "Europe/Berlin", label: "Berlin" },
    { value: "Asia/Tokyo", label: "Tokyo" },
    { value: "Asia/Shanghai", label: "Shanghai" },
    { value: "Asia/Kolkata", label: "India Standard Time" },
    { value: "Australia/Sydney", label: "Sydney" },
];

const LANGUAGES = [
    { value: "en", label: "English" },
    { value: "es", label: "Español" },
    { value: "fr", label: "Français" },
    { value: "de", label: "Deutsch" },
    { value: "it", label: "Italiano" },
    { value: "pt", label: "Português" },
    { value: "ja", label: "日本語" },
    { value: "ko", label: "한국어" },
    { value: "zh", label: "中文" },
];

const THEMES = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "auto", label: "Match system" },
];

const FOLDERS = [
    { value: "INBOX", label: "Inbox" },
    { value: "Sent", label: "Sent" },
    { value: "Archive", label: "Archive" },
    { value: "Drafts", label: "Drafts" },
];

const PER_PAGE = ["10", "25", "50", "100"].map((value) => ({
    value,
    label: `${value} messages`,
}));

const REFRESH_INTERVALS = [
    { value: "15", label: "Every 15 seconds" },
    { value: "30", label: "Every 30 seconds" },
    { value: "60", label: "Every minute" },
    { value: "300", label: "Every 5 minutes" },
    { value: "600", label: "Every 10 minutes" },
    { value: "0", label: "Never" },
];

const UserPreferences: React.FC = () => {
    const user = useAuthStore((state) => state.user);
    const updateUser = useAuthStore((state) => state.updateUser);
    const { setTheme } = useTheme();

    const {
        register,
        handleSubmit,
        reset,
        formState: { errors, isDirty },
    } = useForm<UserPreferencesForm>({
        defaultValues: {
            name: user?.name || "",
            email: user?.email || "",
            language: user?.preferences?.language || "en",
            timezone: user?.preferences?.timezone || "UTC",
            theme: user?.preferences?.theme || "auto",
            emails_per_page: String(user?.preferences?.emails_per_page ?? 25),
            auto_refresh_interval: String(
                user?.preferences?.auto_refresh_interval ?? 30
            ),
            default_folder: user?.preferences?.default_folder || "INBOX",
            email_notifications: user?.preferences?.email_notifications ?? true,
            desktop_notifications:
                user?.preferences?.desktop_notifications ?? true,
            sound_notifications:
                user?.preferences?.sound_notifications ?? false,
            marketing_emails: user?.preferences?.marketing_emails ?? true,
        },
    });

    const save = useMutation(
        (data: UserPreferencesForm) =>
            authAPI.updatePreferences({
                name: data.name,
                preferences: {
                    language: data.language,
                    timezone: data.timezone,
                    theme: data.theme,
                    emails_per_page: Number(data.emails_per_page),
                    auto_refresh_interval: Number(data.auto_refresh_interval),
                    default_folder: data.default_folder,
                    email_notifications: data.email_notifications,
                    desktop_notifications: data.desktop_notifications,
                    sound_notifications: data.sound_notifications,
                    marketing_emails: data.marketing_emails,
                },
            }),
        {
            onSuccess: (response, data) => {
                if (response.data?.user) updateUser(response.data.user);
                setTheme(data.theme);
                reset(data);
                toast.success("Preferences saved");
            },
            onError: (error) => {
                toast.error(
                    errorMessage(error, "Failed to save your preferences")
                );
            },
        }
    );

    return (
        <form
            onSubmit={handleSubmit((data) => save.mutate(data))}
            className="space-y-6"
        >
            <Card padded={false}>
                <CardHeader
                    title={
                        <span className="flex items-center gap-2">
                            <UserIcon className="h-5 w-5 text-content-subtle" />
                            Personal information
                        </span>
                    }
                />
                <div className="grid gap-5 p-5 md:grid-cols-2">
                    <Input
                        label="Full name"
                        error={errors.name?.message}
                        {...register("name", { required: "Name is required" })}
                    />
                    <Input
                        label="Email address"
                        type="email"
                        disabled
                        helpText="Contact your administrator to change this."
                        {...register("email")}
                    />
                    <Select
                        label="Language"
                        options={LANGUAGES}
                        {...register("language")}
                    />
                    <Select
                        label="Timezone"
                        options={TIMEZONES}
                        {...register("timezone")}
                    />
                </div>
            </Card>

            <Card padded={false}>
                <CardHeader
                    title={
                        <span className="flex items-center gap-2">
                            <GlobeAltIcon className="h-5 w-5 text-content-subtle" />
                            Appearance and reading
                        </span>
                    }
                />
                <div className="grid gap-5 p-5 md:grid-cols-2">
                    <Select
                        label="Theme"
                        options={THEMES}
                        helpText="Applies as soon as you save."
                        {...register("theme")}
                    />
                    <Select
                        label="Default folder"
                        options={FOLDERS}
                        helpText="Opened when you start the app."
                        {...register("default_folder")}
                    />
                    <Select
                        label="Messages per page"
                        options={PER_PAGE}
                        {...register("emails_per_page")}
                    />
                    <Select
                        label="Auto-refresh"
                        options={REFRESH_INTERVALS}
                        {...register("auto_refresh_interval")}
                    />
                </div>
            </Card>

            <Card padded={false}>
                <CardHeader
                    title={
                        <span className="flex items-center gap-2">
                            <BellIcon className="h-5 w-5 text-content-subtle" />
                            Notifications
                        </span>
                    }
                    description="Fine-grained controls live on the Notifications tab."
                />
                <div className="space-y-4 p-5">
                    <Checkbox
                        label="Email notifications"
                        description="Receive email for important events."
                        {...register("email_notifications")}
                    />
                    <Checkbox
                        label="Desktop notifications"
                        description="Show a system notification for new mail."
                        {...register("desktop_notifications")}
                    />
                    <Checkbox
                        label="Sound"
                        description="Play a sound when new mail arrives."
                        {...register("sound_notifications")}
                    />
                    <Checkbox
                        label="Product updates"
                        description="Occasional news about new features."
                        {...register("marketing_emails")}
                    />
                </div>
            </Card>

            <div className="flex items-center justify-end gap-3">
                <span className="flex items-center gap-1.5 text-xs text-content-subtle">
                    <ClockIcon className="h-3.5 w-3.5" />
                    Changes apply immediately after saving.
                </span>
                <Button
                    type="submit"
                    loading={save.isLoading}
                    disabled={!isDirty}
                >
                    Save changes
                </Button>
            </div>
        </form>
    );
};

export default UserPreferences;
