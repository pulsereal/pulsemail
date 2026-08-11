import React, { Fragment } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";

interface DrawerProps {
    isOpen: boolean;
    onClose: () => void;
    title?: React.ReactNode;
    description?: React.ReactNode;
    children: React.ReactNode;
    footer?: React.ReactNode;
    width?: "md" | "lg" | "xl";
}

const widthClasses = {
    md: "max-w-md",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
};

const Drawer: React.FC<DrawerProps> = ({
    isOpen,
    onClose,
    title,
    description,
    children,
    footer,
    width = "lg",
}) => (
    <Transition show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={onClose}>
            <Transition.Child
                as={Fragment}
                enter="ease-out duration-200"
                enterFrom="opacity-0"
                enterTo="opacity-100"
                leave="ease-in duration-150"
                leaveFrom="opacity-100"
                leaveTo="opacity-0"
            >
                <div className="fixed inset-0 bg-black/50 backdrop-blur-xs" />
            </Transition.Child>

            <div className="fixed inset-0 overflow-hidden">
                <div className="absolute inset-0 flex justify-end">
                    <Transition.Child
                        as={Fragment}
                        enter="transform transition ease-out duration-250"
                        enterFrom="translate-x-full"
                        enterTo="translate-x-0"
                        leave="transform transition ease-in duration-200"
                        leaveFrom="translate-x-0"
                        leaveTo="translate-x-full"
                    >
                        <Dialog.Panel
                            className={clsx(
                                "flex h-full w-screen flex-col border-l border-line bg-surface shadow-hard",
                                widthClasses[width]
                            )}
                        >
                            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
                                <div className="min-w-0">
                                    <Dialog.Title className="text-base font-semibold text-content">
                                        {title}
                                    </Dialog.Title>
                                    {description && (
                                        <Dialog.Description className="mt-0.5 text-sm text-content-muted">
                                            {description}
                                        </Dialog.Description>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    aria-label="Close panel"
                                    className="-mr-2 -mt-1 rounded-lg p-2 text-content-subtle transition-colors hover:bg-surface-hover hover:text-content"
                                >
                                    <XMarkIcon className="h-5 w-5" />
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto px-5 py-5 scrollbar-thin">
                                {children}
                            </div>

                            {footer && (
                                <div className="border-t border-line bg-surface-sunken px-5 py-4">
                                    {footer}
                                </div>
                            )}
                        </Dialog.Panel>
                    </Transition.Child>
                </div>
            </div>
        </Dialog>
    </Transition>
);

export default Drawer;
