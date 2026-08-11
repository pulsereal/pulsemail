import React from "react";
import { useForm } from "react-hook-form";
import { useMutation } from "react-query";
import toast from "react-hot-toast";
import {
    BellIcon,
    ComputerDesktopIcon,
    EnvelopeIcon,
    MoonIcon,
} from "@heroicons/react/24/outline";
import { authAPI } from "../../services/api";
import { useAuthStore } from "../../stores/authStore";
import { errorMessage } from "../common/ErrorState";
import Button from "../common/Button";
import Card, { CardHeader } from "../common/Card";
import Checkbox from "../common/Checkbox";
import Input from "../common/Input";
import Select from "../common/Select";

interface NotificationForm {
    email_notifications: boolean;
    desktop_notifications: boolean;
    sound_notifications: boolean;
    push_notifications: boolean;

    new_email_notifications: boolean;
    campaign_notifications: boolean;
    automation_notifications: boolean;
    security_notifications: boolean;
    system_notifications: boolean;

    notification_frequency: "immediate" | "hourly" | "daily" | "weekly";
    max_notifications_per_hour: string;

    quiet_hours_enabled: boolean;
    quiet_hours_start: string;
    quiet_hours_end: string;
    weekend_notifications: boolean;

    digest_enabled: boolean;
    digest_frequency: "daily" | "weekly" | "monthly";
    digest_time: string;
}

const FREQUENCIES = [
    { value: "immediate", label: "As they happen" },
    { value: "hourly", label: "Hourly summary" },
    { value: "daily", label: "Daily summary" },
    { value: "weekly", label: "Weekly summary" },
];

const DIGEST_FREQUENCIES = [
    { value: "daily", label: "Daily" },
    { value: "weekly", label: "Weekly" },
    { value: "monthly", label: "Monthly" },
];

const RATE_LIMITS = ["5", "10", "20", "50", "0"].map((value) => ({
    value,
    label: value === "0" ? "No limit" : `${value} per hour`,
}));

const NotificationSettings: React.FC = () => {
    const user = useAuthStore((state) => state.user);
    const updateUser = useAuthStore((state) => state.updateUser);

    const {
        register,
        handleSubmit,
        watch,
        reset,
        formState: { isDirty },
    } = useForm<NotificationForm>({
        defaultValues: {
            email_notifications: user?.preferences?.email_notifications ?? true,
            desktop_notifications:
                user?.preferences?.desktop_notifications ?? true,
            sound_notifications:
                user?.preferences?.sound_notifications ?? false,
            push_notifications: user?.preferences?.push_notifications ?? true,

            new_email_notifications:
                user?.preferences?.new_email_notifications ?? true,
            campaign_notifications:
                user?.preferences?.campaign_notifications ?? true,
            automation_notifications:
                user?.preferences?.automation_notifications ?? true,
            security_notifications:
                user?.preferences?.security_notifications ?? true,
            system_notifications:
                user?.preferences?.system_notifications ?? true,

            notification_frequency:
                user?.preferences?.notification_frequency ?? "immediate",
            max_notifications_per_hour: String(
                user?.preferences?.max_notifications_per_hour ?? 20
            ),

            quiet_hours_enabled:
                user?.preferences?.quiet_hours_enabled ?? false,
            quiet_hours_start: user?.preferences?.quiet_hours_start ?? "22:00",
            quiet_hours_end: user?.preferences?.quiet_hours_end ?? "08:00",
            weekend_notifications:
                user?.preferences?.weekend_notifications ?? true,

            digest_enabled: user?.preferences?.digest_enabled ?? false,
            digest_frequency: user?.preferences?.digest_frequency ?? "daily",
            digest_time: user?.preferences?.digest_time ?? "08:00",
        },
    });

    const quietHoursEnabled = watch("quiet_hours_enabled");
    const digestEnabled = watch("digest_enabled");
    const desktopEnabled = watch("desktop_notifications");

    const save = useMutation(
        (data: NotificationForm) =>
            authAPI.updatePreferences({
                preferences: {
                    ...user?.preferences,
                    ...data,
                    max_notifications_per_hour: Number(
                        data.max_notifications_per_hour
                    ),
                },
            }),
        {
            onSuccess: (response, data) => {
                if (response.data?.user) updateUser(response.data.user);
                reset(data);
                toast.success("Notification settings saved");
            },
            onError: (error) => {
                toast.error(errorMessage(error, "Failed to save settings"));
            },
        }
    );

    const requestBrowserPermission = async () => {
        if (!("Notification" in window)) {
            toast.error("This browser does not support notifications");
            return;
        }

        const permission = await Notification.requestPermission();
        if (permission === "granted") {
            toast.success("Browser notifications enabled");
        } else {
            toast.error("Permission denied in your browser settings");
        }
    };

    return (
        <form
            onSubmit={handleSubmit((data) => save.mutate(data))}
            className="space-y-6"
        >
            <Card padded={false}>
                <CardHeader
                    title={
                        <span className="flex items-center gap-2">
                            <BellIcon className="h-5 w-5 text-content-subtle" />
                            Channels
                        </span>
                    }
                    description="Where notifications are delivered."
                    actions={
                        desktopEnabled ? (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={requestBrowserPermission}
                                icon={
                                    <ComputerDesktopIcon className="h-4 w-4" />
                                }
                            >
                                Grant browser permission
                            </Button>
                        ) : undefined
                    }
                />
                <div className="grid gap-4 p-5 sm:grid-cols-2">
                    <Checkbox
                        label="Email"
                        description="Send notifications to this mailbox."
                        {...register("email_notifications")}
                    />
                    <Checkbox
                        label="Desktop"
                        description="Show system notifications while the app is open."
                        {...register("desktop_notifications")}
                    />
                    <Checkbox
                        label="Sound"
                        description="Play a short chime on arrival."
                        {...register("sound_notifications")}
                    />
                    <Checkbox
                        label="Push"
                        description="Deliver to registered mobile devices."
                        {...register("push_notifications")}
                    />
                </div>
            </Card>

            <Card padded={false}>
                <CardHeader
                    title={
                        <span className="flex items-center gap-2">
                            <EnvelopeIcon className="h-5 w-5 text-content-subtle" />
                            What to notify me about
                        </span>
                    }
                />
                <div className="grid gap-4 p-5 sm:grid-cols-2">
                    <Checkbox
                        label="New mail"
                        {...register("new_email_notifications")}
                    />
                    <Checkbox
                        label="Campaign activity"
                        description="Sends, opens, and bounces."
                        {...register("campaign_notifications")}
                    />
                    <Checkbox
                        label="Automation runs"
                        description="Rule executions and failures."
                        {...register("automation_notifications")}
                    />
                    <Checkbox
                        label="Security events"
                        description="Sign-ins, password and 2FA changes."
                        {...register("security_notifications")}
                    />
                    <Checkbox
                        label="System notices"
                        description="Maintenance and quota warnings."
                        {...register("system_notifications")}
                    />
                </div>

                <div className="grid gap-5 border-t border-line p-5 sm:grid-cols-2">
                    <Select
                        label="Delivery cadence"
                        options={FREQUENCIES}
                        {...register("notification_frequency")}
                    />
                    <Select
                        label="Rate limit"
                        options={RATE_LIMITS}
                        helpText="Caps how noisy a busy hour can get."
                        {...register("max_notifications_per_hour")}
                    />
                </div>
            </Card>

            <Card padded={false}>
                <CardHeader
                    title={
                        <span className="flex items-center gap-2">
                            <MoonIcon className="h-5 w-5 text-content-subtle" />
                            Quiet hours and digests
                        </span>
                    }
                />
                <div className="space-y-5 p-5">
                    <Checkbox
                        label="Enable quiet hours"
                        description="Hold non-urgent notifications during this window."
                        {...register("quiet_hours_enabled")}
                    />

                    {quietHoursEnabled && (
                        <div className="grid gap-5 pl-7 sm:grid-cols-2">
                            <Input
                                label="From"
                                type="time"
                                {...register("quiet_hours_start")}
                            />
                            <Input
                                label="Until"
                                type="time"
                                {...register("quiet_hours_end")}
                            />
                        </div>
                    )}

                    <Checkbox
                        label="Notify me on weekends"
                        {...register("weekend_notifications")}
                    />

                    <div className="border-t border-line pt-5">
                        <Checkbox
                            label="Send a digest"
                            description="A single roll-up instead of individual messages."
                            {...register("digest_enabled")}
                        />

                        {digestEnabled && (
                            <div className="mt-4 grid gap-5 pl-7 sm:grid-cols-2">
                                <Select
                                    label="Frequency"
                                    options={DIGEST_FREQUENCIES}
                                    {...register("digest_frequency")}
                                />
                                <Input
                                    label="Delivery time"
                                    type="time"
                                    {...register("digest_time")}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </Card>

            <div className="flex justify-end">
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

export default NotificationSettings;
