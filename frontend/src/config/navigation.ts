import {
    Squares2X2Icon,
    AtSymbolIcon,
    GlobeAltIcon,
    InboxIcon,
    InboxStackIcon,
    MegaphoneIcon,
    BoltIcon,
    UsersIcon,
    SparklesIcon,
    Cog6ToothIcon,
} from "@heroicons/react/24/outline";

export interface NavItem {
    name: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
    requiresAdmin?: boolean;
    section: "mail" | "manage" | "admin";
    /** Matches nested routes for highlighting and header titles. */
    matchPrefix?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
    {
        name: "Inbox",
        href: "/emails",
        icon: InboxIcon,
        section: "mail",
        matchPrefix: true,
    },
    {
        name: "All Inboxes",
        href: "/all-inboxes",
        icon: InboxStackIcon,
        section: "mail",
        requiresAdmin: true,
    },
    {
        name: "Campaigns",
        href: "/campaigns",
        icon: MegaphoneIcon,
        section: "manage",
    },
    {
        name: "Automation",
        href: "/automation",
        icon: BoltIcon,
        section: "manage",
    },
    {
        name: "Dashboard",
        href: "/dashboard",
        icon: Squares2X2Icon,
        section: "admin",
        requiresAdmin: true,
    },
    {
        name: "Domains",
        href: "/domains",
        icon: GlobeAltIcon,
        section: "admin",
        requiresAdmin: true,
    },
    {
        name: "Mailboxes",
        href: "/users",
        icon: UsersIcon,
        section: "admin",
        requiresAdmin: true,
    },
    {
        name: "Aliases",
        href: "/aliases",
        icon: AtSymbolIcon,
        section: "admin",
        requiresAdmin: true,
    },
    {
        name: "AI Sorting",
        href: "/ai",
        icon: SparklesIcon,
        section: "admin",
        requiresAdmin: true,
    },
    {
        name: "Settings",
        href: "/settings",
        icon: Cog6ToothIcon,
        section: "manage",
    },
];

export const SECTION_LABELS: Record<NavItem["section"], string> = {
    mail: "Mail",
    manage: "Workspace",
    admin: "Administration",
};

export const visibleNavItems = (isAdmin: boolean) =>
    NAV_ITEMS.filter((item) => !item.requiresAdmin || isAdmin);

/**
 * Longest-prefix match so nested routes resolve to their parent nav entry
 * instead of falling through to a default.
 */
export const activeNavItem = (pathname: string, isAdmin: boolean) =>
    visibleNavItems(isAdmin)
        .filter((item) =>
            item.matchPrefix
                ? pathname === item.href || pathname.startsWith(`${item.href}/`)
                : pathname === item.href
        )
        .sort((a, b) => b.href.length - a.href.length)[0];
