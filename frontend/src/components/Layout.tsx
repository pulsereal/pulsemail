import React, { Fragment, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Dialog, Transition } from "@headlessui/react";
import {
    ArrowRightOnRectangleIcon,
    Bars3Icon,
    Cog6ToothIcon,
    MoonIcon,
    PencilSquareIcon,
    SunIcon,
    UserCircleIcon,
    XMarkIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import { useAuthStore } from "../stores/authStore";
import { useComposeStore } from "../stores/composeStore";
import { useTheme } from "../providers/ThemeProvider";
import {
    activeNavItem,
    SECTION_LABELS,
    visibleNavItems,
    type NavItem,
} from "../config/navigation";
import Button from "./common/Button";
import Dropdown from "./common/Dropdown";
import Tooltip from "./common/Tooltip";
import MailboxSwitcher from "./admin/MailboxSwitcher";
import ImpersonationBanner from "./admin/ImpersonationBanner";
import ComposeDrawer from "./mail/ComposeDrawer";

const NavList: React.FC<{
    items: NavItem[];
    onNavigate?: () => void;
}> = ({ items, onNavigate }) => {
    const sections = useMemo(() => {
        const grouped = new Map<NavItem["section"], NavItem[]>();
        items.forEach((item) => {
            grouped.set(item.section, [
                ...(grouped.get(item.section) || []),
                item,
            ]);
        });
        return [...grouped.entries()];
    }, [items]);

    return (
        <nav className="flex-1 space-y-6 px-3 py-4">
            {sections.map(([section, sectionItems]) => (
                <div key={section}>
                    <p className="px-3 pb-2 text-2xs font-semibold uppercase tracking-wider text-sidebar-muted">
                        {SECTION_LABELS[section]}
                    </p>
                    <div className="space-y-0.5">
                        {sectionItems.map((item) => (
                            <NavLink
                                key={item.href}
                                to={item.href}
                                end={!item.matchPrefix}
                                onClick={onNavigate}
                                className={({ isActive }) =>
                                    clsx(
                                        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                                        isActive
                                            ? "bg-sidebar-active text-primary-600"
                                            : "text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-content"
                                    )
                                }
                            >
                                {({ isActive }) => (
                                    <>
                                        <item.icon
                                            className={clsx(
                                                "h-5 w-5 shrink-0",
                                                isActive
                                                    ? "text-primary-600"
                                                    : "text-sidebar-muted group-hover:text-sidebar-content"
                                            )}
                                        />
                                        {item.name}
                                    </>
                                )}
                            </NavLink>
                        ))}
                    </div>
                </div>
            ))}
        </nav>
    );
};

const Brand: React.FC = () => (
    <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-line px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 text-sm font-bold text-white">
            P
        </span>
        <span className="text-base font-semibold text-sidebar-content">
            Pulsemail
        </span>
    </div>
);

const Layout: React.FC = () => {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const location = useLocation();
    const navigate = useNavigate();
    const { resolvedTheme, toggleTheme } = useTheme();

    const user = useAuthStore((state) => state.user);
    const logout = useAuthStore((state) => state.logout);
    const openCompose = useComposeStore((state) => state.openCompose);

    const isAdmin = Boolean(user?.isAdmin);
    const navItems = useMemo(() => visibleNavItems(isAdmin), [isAdmin]);
    const current = activeNavItem(location.pathname, isAdmin);

    const handleLogout = () => {
        logout();
        navigate("/login");
    };

    return (
        <div className="flex h-screen overflow-hidden bg-canvas">
            <Transition show={sidebarOpen} as={Fragment}>
                <Dialog
                    as="div"
                    className="relative z-50 lg:hidden"
                    onClose={setSidebarOpen}
                >
                    <Transition.Child
                        as={Fragment}
                        enter="transition-opacity ease-linear duration-200"
                        enterFrom="opacity-0"
                        enterTo="opacity-100"
                        leave="transition-opacity ease-linear duration-200"
                        leaveFrom="opacity-100"
                        leaveTo="opacity-0"
                    >
                        <div className="fixed inset-0 bg-black/50" />
                    </Transition.Child>

                    <div className="fixed inset-0 flex">
                        <Transition.Child
                            as={Fragment}
                            enter="transition ease-in-out duration-250 transform"
                            enterFrom="-translate-x-full"
                            enterTo="translate-x-0"
                            leave="transition ease-in-out duration-200 transform"
                            leaveFrom="translate-x-0"
                            leaveTo="-translate-x-full"
                        >
                            <Dialog.Panel className="relative flex w-full max-w-xs flex-col bg-sidebar">
                                <button
                                    type="button"
                                    onClick={() => setSidebarOpen(false)}
                                    aria-label="Close navigation"
                                    className="absolute -right-12 top-2 rounded-lg p-2 text-white"
                                >
                                    <XMarkIcon className="h-6 w-6" />
                                </button>
                                <Brand />
                                <NavList
                                    items={navItems}
                                    onNavigate={() => setSidebarOpen(false)}
                                />
                            </Dialog.Panel>
                        </Transition.Child>
                    </div>
                </Dialog>
            </Transition>

            <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-sidebar lg:flex">
                <Brand />
                <NavList items={navItems} />
                <div className="border-t border-line p-3">
                    <Button
                        fullWidth
                        icon={<PencilSquareIcon className="h-4 w-4" />}
                        onClick={() => openCompose()}
                    >
                        Compose
                    </Button>
                </div>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col">
                <header className="z-20 shrink-0 border-b border-line bg-surface">
                    <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
                        <button
                            type="button"
                            onClick={() => setSidebarOpen(true)}
                            aria-label="Open navigation"
                            className="rounded-lg p-2 text-content-muted transition-colors hover:bg-surface-hover lg:hidden"
                        >
                            <Bars3Icon className="h-5 w-5" />
                        </button>

                        <h1 className="truncate text-base font-semibold text-content">
                            {current?.name ?? "Pulsemail"}
                        </h1>

                        <div className="ml-auto flex items-center gap-2 sm:gap-3">
                            <div className="hidden sm:block">
                                <MailboxSwitcher />
                            </div>

                            <Tooltip
                                label={
                                    resolvedTheme === "dark"
                                        ? "Switch to light"
                                        : "Switch to dark"
                                }
                            >
                                <button
                                    type="button"
                                    onClick={toggleTheme}
                                    aria-label="Toggle theme"
                                    className="rounded-lg p-2 text-content-muted transition-colors hover:bg-surface-hover hover:text-content"
                                >
                                    {resolvedTheme === "dark" ? (
                                        <SunIcon className="h-5 w-5" />
                                    ) : (
                                        <MoonIcon className="h-5 w-5" />
                                    )}
                                </button>
                            </Tooltip>

                            <Dropdown
                                trigger={
                                    <button
                                        type="button"
                                        className="flex items-center gap-2 rounded-lg p-1.5 transition-colors hover:bg-surface-hover"
                                    >
                                        <UserCircleIcon className="h-7 w-7 text-content-subtle" />
                                        <span className="hidden text-left md:block">
                                            <span className="block text-sm font-medium leading-tight text-content">
                                                {user?.name}
                                            </span>
                                            <span className="block text-xs leading-tight text-content-subtle">
                                                {user?.email}
                                            </span>
                                        </span>
                                    </button>
                                }
                                items={[
                                    {
                                        id: "settings",
                                        label: "Settings",
                                        icon: Cog6ToothIcon,
                                        onSelect: () => navigate("/settings"),
                                    },
                                    {
                                        id: "logout",
                                        label: "Sign out",
                                        icon: ArrowRightOnRectangleIcon,
                                        danger: true,
                                        separatorBefore: true,
                                        onSelect: handleLogout,
                                    },
                                ]}
                            />
                        </div>
                    </div>

                    <div className="border-t border-line px-4 py-2 sm:hidden">
                        <MailboxSwitcher className="w-full sm:w-full" />
                    </div>
                </header>

                <ImpersonationBanner />

                <main className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
                    <Outlet />
                </main>
            </div>

            <ComposeDrawer />
        </div>
    );
};

export default Layout;
