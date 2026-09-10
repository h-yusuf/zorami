import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutGrid,
  Sparkles,
  Server,
  Plug,
  Activity,
  MessageSquare,
  Users,
} from "lucide-react";
import { getToken } from "../api/client";
import { useHealth, useMe } from "../api/hooks";
import { LoginForm } from "./LoginForm";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  badge?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "INTI",
    items: [
      { to: "/", label: "Overview", icon: LayoutGrid },
      { to: "/agents", label: "Agents", icon: Sparkles },
      { to: "/devices", label: "Devices", icon: Server },
      { to: "/providers", label: "Providers & Keys", icon: Plug },
    ],
  },
  {
    label: "PANTAU",
    items: [
      { to: "/live-monitor", label: "Live Monitor", icon: Activity },
      { to: "/conversations", label: "Percakapan", icon: MessageSquare },
    ],
  },
  {
    label: "AKUN",
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

function AccountFooter() {
  const { data: me, isLoading: meLoading } = useMe();
  const { data: health } = useHealth();

  const email = meLoading ? "" : (me?.email ?? "?");
  const initial = email ? email[0].toUpperCase() : "?";
  const dbLabel =
    health === undefined ? "cek..." : health.database === "ok" ? "postgres ok" : "postgres down";

  return (
    <div className="flex flex-col gap-1.5 border-t border-border px-[18px] py-3.5">
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-[2px] bg-[#3A342A] text-[11px] font-bold text-amber">
          {initial}
        </div>
        <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] text-text-secondary">
          {email || "Memuat..."}
        </div>
      </div>
      <div
        className={`font-mono text-[9.5px] ${health?.database === "down" ? "text-danger" : "text-[#56534D]"}`}
      >
        v0.1.0-dev &middot; {dbLabel}
      </div>
    </div>
  );
}

function Sidebar() {
  return (
    <div className="flex w-56 shrink-0 flex-col border-r border-border bg-surface-alt">
      <div className="flex items-center gap-2 px-[18px] pb-[18px] pt-5">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#E8A33D"
          strokeWidth="1.7"
          strokeLinecap="round"
        >
          <rect x="4" y="7" width="16" height="12" rx="2" />
          <path d="M8 7V5m8 2V5M9 12h.01M15 12h.01M9 16h6" />
        </svg>
        <div>
          <div className="text-[15px] font-bold tracking-wide">ZORA</div>
          <div className="font-mono text-[9.5px] tracking-widest text-text-dim">
            BRIDGE
          </div>
        </div>
      </div>

      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <div className="px-[18px] pb-1.5 pt-4 text-[10.5px] font-semibold tracking-[0.12em] text-text-dim">
            {group.label}
          </div>
          {group.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-2.5 border-l-[3px] px-[18px] py-2 pl-[15px] text-[13.5px] font-medium ${
                  isActive
                    ? "border-amber bg-[#221F1B] text-text"
                    : "border-transparent text-text-secondary hover:text-text"
                }`
              }
            >
              <item.icon size={17} strokeWidth={1.7} />
              <span className="grow">{item.label}</span>
              {item.badge && (
                <span className="rounded-[2px] border border-[#35322C] font-mono text-[8.5px] text-text-dim px-1 py-0.5">
                  {item.badge}
                </span>
              )}
            </NavLink>
          ))}
        </div>
      ))}

      <div className="grow" />

      <AccountFooter />
    </div>
  );
}

function Topbar() {
  const location = useLocation();
  const meta = PAGE_META[location.pathname] ?? { title: "Zora Bridge", subtitle: "" };
  return (
    <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-border px-7">
      <div className="flex flex-col gap-0.5">
        <div className="text-[17px] font-semibold tracking-tight">{meta.title}</div>
        <div className="text-[11.5px] text-text-dim">{meta.subtitle}</div>
      </div>
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
