import React from "react";
import toast from "react-hot-toast";
import {
    ClipboardDocumentIcon,
    ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import Button from "../common/Button";
import Modal from "../common/Modal";
import type { AgentSecrets } from "../../types";

interface AgentSecretsModalProps {
    isOpen: boolean;
    onClose: () => void;
    agentName: string;
    secrets: AgentSecrets | null;
}

const SecretField: React.FC<{
    label: string;
    value: string;
    description: string;
}> = ({ label, value, description }) => (
    <div className="space-y-1.5">
        <span className="block text-sm font-medium text-content">{label}</span>
        <div className="flex items-stretch gap-2">
            <code className="min-w-0 flex-1 select-all break-all rounded-lg border border-line-strong bg-surface-sunken px-3 py-2 font-mono text-xs text-content">
                {value}
            </code>
            <Button
                variant="outline"
                icon={<ClipboardDocumentIcon className="h-4 w-4" />}
                onClick={() => {
                    void navigator.clipboard.writeText(value);
                    toast.success(`${label} copied`);
                }}
            >
                Copy
            </Button>
        </div>
        <p className="text-xs text-content-subtle">{description}</p>
    </div>
);

const AgentSecretsModal: React.FC<AgentSecretsModalProps> = ({
    isOpen,
    onClose,
    agentName,
    secrets,
}) => (
    <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={`Credentials for ${agentName}`}
        size="lg"
        actions={<Button onClick={onClose}>I have stored them</Button>}
    >
        <div className="space-y-5">
            <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm text-warning-800">
                <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />
                <span>
                    Copy these into the agent now. They are stored hashed or
                    encrypted and cannot be shown again; rotate them if they are
                    lost.
                </span>
            </div>

            {secrets?.apiKey && (
                <SecretField
                    label="API key"
                    value={secrets.apiKey}
                    description="Send as Authorization: Bearer <key> to /api/agent."
                />
            )}

            {secrets?.signingSecret && (
                <SecretField
                    label="Webhook signing secret"
                    value={secrets.signingSecret}
                    description="Verifies the X-Pulsemail-Signature header on each webhook."
                />
            )}
        </div>
    </Modal>
);

export default AgentSecretsModal;
