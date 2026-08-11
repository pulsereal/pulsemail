import React, { Fragment } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title?: React.ReactNode;
    description?: React.ReactNode;
    children: React.ReactNode;
    size?: "sm" | "md" | "lg" | "xl" | "2xl";
    showCloseButton?: boolean;
    actions?: React.ReactNode;
    bodyClassName?: string;
}

const sizeClasses = {
    sm: "max-w-md",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
    "2xl": "max-w-6xl",
};

const Modal: React.FC<ModalProps> = ({
    isOpen,
    onClose,
    title,
    description,
    children,
    size = "md",
    showCloseButton = true,
    actions,
    bodyClassName,
}) => (
    <Transition appear show={isOpen} as={Fragment}>
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

            <div className="fixed inset-0 overflow-y-auto">
                <div className="flex min-h-full items-center justify-center p-4">
                    <Transition.Child
                        as={Fragment}
                        enter="ease-out duration-200"
                        enterFrom="opacity-0 scale-95"
                        enterTo="opacity-100 scale-100"
                        leave="ease-in duration-150"
                        leaveFrom="opacity-100 scale-100"
                        leaveTo="opacity-0 scale-95"
                    >
                        <Dialog.Panel
                            className={clsx(
                                "w-full transform overflow-hidden rounded-2xl border border-line bg-surface text-left shadow-hard transition-all",
                                sizeClasses[size]
                            )}
                        >
                            {(title || showCloseButton) && (
                                <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
                                    <div className="min-w-0">
                                        {title && (
                                            <Dialog.Title
                                                as="h3"
                                                className="text-base font-semibold text-content"
                                            >
                                                {title}
                                            </Dialog.Title>
                                        )}
                                        {description && (
                                            <Dialog.Description className="mt-1 text-sm text-content-muted">
                                                {description}
                                            </Dialog.Description>
                                        )}
                                    </div>
                                    {showCloseButton && (
                                        <button
                                            type="button"
                                            onClick={onClose}
                                            aria-label="Close dialog"
                                            className="-mr-2 -mt-1 rounded-lg p-2 text-content-subtle transition-colors hover:bg-surface-hover hover:text-content"
                                        >
                                            <XMarkIcon className="h-5 w-5" />
                                        </button>
                                    )}
                                </div>
                            )}

                            <div
                                className={clsx(
                                    "max-h-[70vh] overflow-y-auto px-6 py-5 scrollbar-thin",
                                    bodyClassName
                                )}
                            >
                                {children}
                            </div>

                            {actions && (
                                <div className="flex justify-end gap-3 border-t border-line bg-surface-sunken px-6 py-4">
                                    {actions}
                                </div>
                            )}
                        </Dialog.Panel>
                    </Transition.Child>
                </div>
            </div>
        </Dialog>
    </Transition>
);

export default Modal;
