
"use client";

import React, { useState } from "react";
import {
    LayoutDashboard,
    TrendingUp,
    Target,
    Settings,
    Menu,
    X,
    Home
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

interface DashboardLayoutProps {
    children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const pathname = usePathname();

    const navItems = [
        { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
        { label: "Performance", href: "/dashboard/performance", icon: TrendingUp },
        { label: "Strategy", href: "/dashboard/strategy", icon: Target },
        { label: "Back to App", href: "/", icon: Home },
    ];

    return (
        <div className="min-h-screen bg-gray-950 text-gray-100 flex">
            {/* Mobile Sidebar Overlay */}
            {isSidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 md:hidden"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside
                className={clsx(
                    "fixed md:static inset-y-0 left-0 z-50 w-64 bg-gray-900 border-r border-gray-800 transition-transform duration-300 md:transform-none",
                    isSidebarOpen ? "translate-x-0" : "-translate-x-full"
                )}
            >
                <div className="h-full flex flex-col">
                    <div className="p-6 border-b border-gray-800 flex items-center justify-between">
                        <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-400">
                            MINATOMIRAI <span className="text-gray-500 text-sm">Analytics</span>
                        </h1>
                        <button
                            className="md:hidden text-gray-400"
                            onClick={() => setIsSidebarOpen(false)}
                        >
                            <X size={24} />
                        </button>
                    </div>

                    <nav className="flex-1 p-4 space-y-2">
                        {navItems.map((item) => {
                            const isActive = pathname === item.href;
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    onClick={() => setIsSidebarOpen(false)}
                                    className={clsx(
                                        "flex items-center space-x-3 px-4 py-3 rounded-xl transition-all",
                                        isActive
                                            ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                                            : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-100"
                                    )}
                                >
                                    <item.icon size={20} />
                                    <span>{item.label}</span>
                                </Link>
                            );
                        })}
                    </nav>

                    <div className="p-4 border-t border-gray-800">
                        <div className="flex items-center space-x-3 text-gray-500 text-xs px-4">
                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                            <span>System: Online (v8.0)</span>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Mobile Header */}
                <header className="md:hidden bg-gray-900/80 backdrop-blur-md border-b border-gray-800 p-4 flex items-center">
                    <button
                        onClick={() => setIsSidebarOpen(true)}
                        className="text-gray-400 p-1"
                    >
                        <Menu size={24} />
                    </button>
                    <span className="ml-4 font-bold">Analytics Dashboard</span>
                </header>

                <div className="flex-1 overflow-y-auto p-4 md:p-8">
                    <div className="max-w-7xl mx-auto">
                        {children}
                    </div>
                </div>
            </main>
        </div>
    );
}
