import React, { Fragment } from "react";
import { Menu, Transition } from "@headlessui/react";
import clsx from "clsx";

export interface DropdownItem {
    id: string;
    label: string;
    icon?: React.ComponentType<{ className?: string }>;
    onSelect?: () => void;
    danger?: boolean;
    disabled?: boolean;
    separatorBefore?: boolean;
}

interface DropdownProps {
    trigger: React.ReactNode;
    items: DropdownItem[];
    align?: "left" | "right";
    className?: string;
    menuClassName?: string;
}

const Dropdown: React.FC<DropdownProps> = ({
    trigger,
    items,
    align = "right",
    className,
    menuClassName,
}) => (
    <Menu
        as="div"
        className={clsx("relative inline-block text-left", className)}
    >
        <Menu.Button as={Fragment}>{trigger}</Menu.Button>
        <Transition
            as={Fragment}
            enter="transition ease-out duration-100"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="transition ease-in duration-75"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
        >
            <Menu.Items
                className={clsx(
                    "absolute z-40 mt-2 w-56 origin-top rounded-xl border border-line bg-surface-raised py-1 shadow-hard focus:outline-none",
                    align === "right" ? "right-0" : "left-0",
                    menuClassName
                )}
            >
                {items.map((item) => (
                    <Fragment key={item.id}>
                        {item.separatorBefore && (
                            <div className="my-1 h-px bg-line" />
                        )}
                        <Menu.Item disabled={item.disabled}>
                            {({ active }) => (
                                <button
                                    type="button"
                                    onClick={item.onSelect}
                                    disabled={item.disabled}
                                    className={clsx(
                                        "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                                        item.disabled &&
                                            "cursor-not-allowed opacity-50",
                                        item.danger
                                            ? active
                                                ? "bg-danger-50 text-danger-700"
                                                : "text-danger-600"
                                            : active
                                              ? "bg-surface-hover text-content"
                                              : "text-content-muted"
                                    )}
                                >
                                    {item.icon && (
                                        <item.icon className="h-4 w-4 shrink-0" />
                                    )}
                                    {item.label}
                                </button>
                            )}
                        </Menu.Item>
                    </Fragment>
                ))}
            </Menu.Items>
        </Transition>
    </Menu>
);

export default Dropdown;
