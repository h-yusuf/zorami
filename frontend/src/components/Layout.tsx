import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutGrid,
  Sparkles,
  Server,
  Plug,
  Activity,
  MessageSquare,
  Users,
  ChevronDown,
  LogOut,
} from "lucide-react";
import { getToken, logout } from "../api/client";
import { useHealth, useMe } from "../api/hooks";
import { LoginForm } from "./LoginForm";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  badge?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Inti",
    items: [
      { to: "/", label: "Overview", icon: LayoutGrid },
      { to: "/agents", label: "Agents", icon: Sparkles },
      { to: "/devices", label: "Devices", icon: Server },
      { to: "/providers", label: "Providers & Keys", icon: Plug },
    ],
  },
  {
    label: "Pantau",
    items: [
      { to: "/live-monitor", label: "Live Monitor", icon: Activity },
      { to: "/conversations", label: "Percakapan", icon: MessageSquare },
    ],
  },
  {
    label: "Akun",
    items: [
      { to: "/users-roles", label: "Users & Roles", icon: Users, badge: "F3" },
    ],
  },
];

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  "/": { title: "Overview", subtitle: "Ringkasan device, pipeline, dan aktivitas terakhir" },
  "/agents": { title: "Agents", subtitle: "Kepribadian, suara, dan tools tiap agent" },
  "/devices": { title: "Devices", subtitle: "Daftar dan status perangkat Zora Mini" },
  "/providers": { title: "Providers & Keys", subtitle: "Konfigurasi BYOK per tahap pipeline" },
  "/live-monitor": { title: "Live Monitor", subtitle: "Aktivitas voice loop secara real-time" },
  "/conversations": { title: "Percakapan", subtitle: "Riwayat turn per device dan agent" },
  "/users-roles": { title: "Users & Roles", subtitle: "Kelola akses tim (Fase 3)" },
};

function AccountMenu() {
  const { data: me, isLoading: meLoading } = useMe();
  const { data: health } = useHealth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const email = meLoading ? "" : (me?.email ?? "?");
  const initial = email ? email[0].toUpperCase() : "?";
  const dbLabel =
    health === undefined ? "cek..." : health.database === "ok" ? "postgres ok" : "postgres down";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface"
      >
        <div className="text-right">
          <div className="text-[12.5px] font-medium text-text">{email || "Memuat..."}</div>
          <div className={`font-mono text-[10px] ${health?.database === "down" ? "text-danger" : "text-text-dim"}`}>
            {dbLabel}
          </div>
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber/15 text-[12px] font-bold text-amber">
          {initial}
        </div>
        <ChevronDown size={14} strokeWidth={2} className="text-text-dim" />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] w-44 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg">
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-text-secondary hover:bg-surface-alt hover:text-danger"
          >
            <LogOut size={15} strokeWidth={1.8} />
            Keluar
          </button>
        </div>
      )}
    </div>
  );
}

function Sidebar() {
  return (
    <div className="flex w-60 shrink-0 flex-col border-r border-border bg-surface-alt">
      <div className="flex items-center gap-2.5 px-4 pb-5 pt-5">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#FF6A2E"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <rect x="4" y="7" width="16" height="12" rx="2" />
          <path d="M8 7V5m8 2V5M9 12h.01M15 12h.01M9 16h6" />
        </svg>
        <div className="text-[15px] font-semibold tracking-tight">Zora Bridge</div>
      </div>

      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="px-3">
          <div className="px-2 pb-1.5 pt-4 text-[11px] text-text-dim">{group.label}</div>
          {group.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium ${
                  isActive
                    ? "bg-surface text-text"
                    : "text-text-secondary hover:bg-surface hover:text-text"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon size={17} strokeWidth={1.7} className={isActive ? "text-amber" : ""} />
                  <span className="grow">{item.label}</span>
                  {item.badge && (
                    <span className="rounded-md border border-border font-mono text-[8.5px] text-text-dim px-1 py-0.5">
                      {item.badge}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </div>
      ))}

      <div className="grow" />
    </div>
  );
}

function Topbar() {
  const location = useLocation();
  const meta = PAGE_META[location.pathname] ?? { title: "Zora Bridge", subtitle: "" };
  return (
    <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-7">
      <div className="flex flex-col gap-0.5">
        <div className="text-[17px] font-semibold tracking-tight">{meta.title}</div>
        <div className="text-[11.5px] text-text-dim">{meta.subtitle}</div>
      </div>
      <AccountMenu />
    </div>
  );
}

export function Layout() {
  const token = getToken();
  if (!token) {
    return <LoginForm />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-text">
      <Sidebar />
      <div className="flex grow flex-col overflow-hidden">
        <Topbar />
        <div className="grow overflow-auto p-5">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
