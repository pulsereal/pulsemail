import React, { useState } from "react";
import {
    ChartBarIcon,
    DocumentTextIcon,
    ListBulletIcon,
} from "@heroicons/react/24/outline";
import CampaignList from "../components/campaigns/CampaignList";
import CampaignAnalytics from "../components/campaigns/CampaignAnalytics";
import TemplateGallery from "../components/campaigns/TemplateGallery";
import Tabs, { type TabItem } from "../components/common/Tabs";

type CampaignTab = "campaigns" | "templates" | "analytics";

const TABS: TabItem<CampaignTab>[] = [
    { id: "campaigns", label: "Campaigns", icon: ListBulletIcon },
    { id: "templates", label: "Templates", icon: DocumentTextIcon },
    { id: "analytics", label: "Analytics", icon: ChartBarIcon },
];

const CampaignsPage: React.FC = () => {
    const [tab, setTab] = useState<CampaignTab>("campaigns");

    return (
        <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
            <div>
                <h1 className="text-xl font-semibold text-content">
                    Campaigns
                </h1>
                <p className="mt-1 text-sm text-content-muted">
                    Build, schedule, and measure bulk sends from this mailbox.
                </p>
            </div>

            <Tabs tabs={TABS} value={tab} onChange={setTab} />

            {tab === "campaigns" && <CampaignList />}
            {tab === "templates" && <TemplateGallery showActions />}
            {tab === "analytics" && <CampaignAnalytics />}
        </div>
    );
};

export default CampaignsPage;
