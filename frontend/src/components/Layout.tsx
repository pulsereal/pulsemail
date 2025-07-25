import React, { useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import {
    HomeIcon,
    InboxIcon,
    PaperAirplaneIcon,
    MegaphoneIcon,
    CogIcon,
    BellIcon,
    UserCircleIcon,
    ChevronDownIcon,
    Bars3Icon,
    XMarkIcon,
} from "@heroicons/react/24/outline";
import { Menu, Transition } from "@headlessui/react";
import { Fragment } from "react";
import clsx from "clsx";

const navigation = [
    { name: "Dashboard", href: "/dashboard", icon: HomeIcon },
    { name: "Emails", href: "/emails", icon: InboxIcon },
    { name: "Compose", href: "/emails/compose", icon: PaperAirplaneIcon },
    { name: "Campaigns", href: "/campaigns", icon: MegaphoneIcon },
    { name: "Automation", href: "/automation", icon: CogIcon },
];

const Layout: React.FC = () => {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const location = useLocation();
    const navigate = useNavigate();
    const { user, logout } = useAuthStore();

    const handleLogout = () => {
        logout();
        navigate("/login");
    };

    return (
        <div className="flex h-screen bg-gray-100">
            {/* Mobile sidebar */}
            <Transition.Root show={sidebarOpen} as={Fragment}>
                <div className="relative z-40 md:hidden">
                    <Transition.Child
                        as={Fragment}
                        enter="transition-opacity ease-linear duration-300"
                        enterFrom="opacity-0"
                        enterTo="opacity-100"
                        leave="transition-opacity ease-linear duration-300"
                        leaveFrom="opacity-100"
                        leaveTo="opacity-0"
                    >
                        <div className="fixed inset-0 bg-gray-600 bg-opacity-75" />
                    </Transition.Child>

                    <div className="fixed inset-0 z-40 flex">
                        <Transition.Child
                            as={Fragment}
                            enter="transition ease-in-out duration-300 transform"
                            enterFrom="-translate-x-full"
                            enterTo="translate-x-0"
                            leave="transition ease-in-out duration-300 transform"
                            leaveFrom="translate-x-0"
                            leaveTo="-translate-x-full"
                        >
                            <div className="relative flex w-full max-w-xs flex-1 flex-col bg-white">
                                <Transition.Child
                                    as={Fragment}
                                    enter="ease-in-out duration-300"
                                    enterFrom="opacity-0"
                                    enterTo="opacity-100"
                                    leave="ease-in-out duration-300"
                                    leaveFrom="opacity-100"
                                    leaveTo="opacity-0"
                                >
                                    <div className="absolute top-0 right-0 -mr-12 pt-2">
                                        <button
                                            type="button"
                                            className="ml-1 flex h-10 w-10 items-center justify-center rounded-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white"
                                            onClick={() =>
                                                setSidebarOpen(false)
                                            }
                                        >
                                            <XMarkIcon className="h-6 w-6 text-white" />
                                        </button>
                                    </div>
                                </Transition.Child>
                                <div className="h-0 flex-1 overflow-y-auto pt-5 pb-4">
                                    <div className="flex flex-shrink-0 items-center px-4">
                                        <h1 className="text-xl font-bold text-gray-900">
                                            Pulsemail Client
                                        </h1>
                                    </div>
                                    <nav className="mt-5 space-y-1 px-2">
                                        {navigation.map((item) => (
                                            <button
                                                key={item.name}
                                                onClick={() => {
                                                    navigate(item.href);
                                                    setSidebarOpen(false);
                                                }}
                                                className={clsx(
                                                    location.pathname ===
                                                        item.href
                                                        ? "bg-gray-100 text-gray-900"
                                                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
                                                    "group flex items-center px-2 py-2 text-base font-medium rounded-md w-full text-left"
                                                )}
                                            >
                                                <item.icon
                                                    className={clsx(
                                                        location.pathname ===
                                                            item.href
                                                            ? "text-gray-500"
                                                            : "text-gray-400 group-hover:text-gray-500",
                                                        "mr-4 h-6 w-6"
                                                    )}
                                                />
                                                {item.name}
                                            </button>
                                        ))}
                                    </nav>
                                </div>
                            </div>
                        </Transition.Child>
                        <div className="w-14 flex-shrink-0">
                            {/* Force sidebar to shrink to fit close icon */}
                        </div>
                    </div>
                </div>
            </Transition.Root>

            {/* Static sidebar for desktop */}
            <div className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0">
                <div className="flex flex-1 flex-col min-h-0 border-r border-gray-200 bg-white">
                    <div className="flex flex-1 flex-col pt-5 pb-4 overflow-y-auto">
                        <div className="flex items-center flex-shrink-0 px-4">
                            <h1 className="text-xl font-bold text-gray-900">
                                Pulsemail Client
                            </h1>
                        </div>
                        <nav className="mt-5 flex-1 px-2 bg-white space-y-1">
                            {navigation.map((item) => (
                                <button
                                    key={item.name}
                                    onClick={() => navigate(item.href)}
                                    className={clsx(
                                        location.pathname === item.href
                                            ? "bg-gray-100 text-gray-900"
                                            : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
                                        "group flex items-center px-2 py-2 text-sm font-medium rounded-md w-full text-left"
                                    )}
                                >
                                    <item.icon
                                        className={clsx(
                                            location.pathname === item.href
                                                ? "text-gray-500"
                                                : "text-gray-400 group-hover:text-gray-500",
                                            "mr-3 h-6 w-6"
                                        )}
                                    />
                                    {item.name}
                                </button>
                            ))}
                        </nav>
                    </div>
                </div>
            </div>

            {/* Main content */}
            <div className="flex flex-1 flex-col md:pl-64">
                {/* Top bar */}
                <div className="sticky top-0 z-10 bg-white pl-1 pt-1 sm:pl-3 sm:pt-3 md:hidden">
                    <button
                        type="button"
                        className="-ml-0.5 -mt-0.5 h-12 w-12 inline-flex items-center justify-center rounded-md text-gray-500 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                        onClick={() => setSidebarOpen(true)}
                    >
                        <Bars3Icon className="h-6 w-6" />
                    </button>
                </div>

                {/* Header */}
                <header className="bg-white shadow-sm border-b border-gray-200">
                    <div className="px-4 sm:px-6 lg:px-8">
                        <div className="flex justify-between h-16">
                            <div className="flex items-center">
                                <h2 className="text-lg font-semibold text-gray-900">
                                    {navigation.find(
                                        (item) =>
                                            item.href === location.pathname
                                    )?.name || "Dashboard"}
                                </h2>
                            </div>

                            <div className="flex items-center space-x-4">
                                {/* Notifications */}
                                <button className="p-2 text-gray-400 hover:text-gray-500">
                                    <BellIcon className="h-6 w-6" />
                                </button>

                                {/* User menu */}
                                <Menu as="div" className="relative">
                                    <Menu.Button className="flex items-center text-sm rounded-full focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
                                        <div className="flex items-center space-x-3">
                                            <UserCircleIcon className="h-8 w-8 text-gray-400" />
                                            <div className="hidden md:block text-left">
                                                <p className="text-sm font-medium text-gray-700">
                                                    {user?.name}
                                                </p>
                                                <p className="text-xs text-gray-500">
                                                    {user?.email}
                                                </p>
                                            </div>
                                            <ChevronDownIcon className="h-4 w-4 text-gray-400" />
                                        </div>
                                    </Menu.Button>

                                    <Transition
                                        as={Fragment}
                                        enter="transition ease-out duration-100"
                                        enterFrom="transform opacity-0 scale-95"
                                        enterTo="transform opacity-100 scale-100"
                                        leave="transition ease-in duration-75"
                                        leaveFrom="transform opacity-100 scale-100"
                                        leaveTo="transform opacity-0 scale-95"
                                    >
                                        <Menu.Items className="absolute right-0 mt-2 w-48 origin-top-right bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                                            <div className="py-1">
                                                <Menu.Item>
                                                    {({ active }) => (
                                                        <button
                                                            onClick={() =>
                                                                navigate(
                                                                    "/settings"
                                                                )
                                                            }
                                                            className={clsx(
                                                                active
                                                                    ? "bg-gray-100"
                                                                    : "",
                                                                "block w-full text-left px-4 py-2 text-sm text-gray-700"
                                                            )}
                                                        >
                                                            Settings
                                                        </button>
                                                    )}
                                                </Menu.Item>
                                                <Menu.Item>
                                                    {({ active }) => (
                                                        <button
                                                            onClick={
                                                                handleLogout
                                                            }
                                                            className={clsx(
                                                                active
                                                                    ? "bg-gray-100"
                                                                    : "",
                                                                "block w-full text-left px-4 py-2 text-sm text-gray-700"
                                                            )}
                                                        >
                                                            Sign out
                                                        </button>
                                                    )}
                                                </Menu.Item>
                                            </div>
                                        </Menu.Items>
                                    </Transition>
                                </Menu>
                            </div>
                        </div>
                    </div>
                </header>

                {/* Page content */}
                <main className="flex-1 overflow-hidden">
                    <Outlet />
                </main>
            </div>
        </div>
    );
};

export default Layout;
