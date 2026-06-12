"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bot, Check, FolderGit2, LogOut, Plug, X } from "lucide-react";
import { apiClient, type JoinRequest, type Whoami } from "@/lib/api";
import { useRealtimeEvent } from "@/lib/realtime";
import { Avatar, providerLabel, secondsLeft } from "@/lib/ui";

type AppCtx = { whoami: Whoami | null; reloadWhoami: () => void };
const Ctx = createContext<AppCtx>({ whoami: null, reloadWhoami: () => {} });
export const useApp = () => useContext(Ctx);

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [whoami, setWhoami] = useState<Whoami | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [joins, setJoins] = useState<JoinRequest[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const isAuthPage = pathname === "/login";

  const reloadWhoami = () => {
    apiClient
      .me()
      .then(setWhoami)
      .catch(() => setWhoami(null))
      .finally(() => setAuthChecked(true));
  };

  const reloadJoins = () => {
    apiClient
      .listJoinRequests()
      .then((response) => setJoins(response.joinRequests))
      .catch(() => setJoins([]));
  };

  useEffect(() => {
    reloadWhoami();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (whoami) reloadJoins();
  }, [whoami]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useRealtimeEvent((envelope) => {
    if (envelope.event.startsWith("agent.join_request")) reloadJoins();
  }, []);

  // Redirect unauthenticated users out of band (never during render).
  useEffect(() => {
    if (authChecked && !whoami && !isAuthPage) router.replace("/login");
  }, [authChecked, whoami, isAuthPage, router]);

  if (isAuthPage) {
    return (
      <Ctx.Provider value={{ whoami, reloadWhoami }}>{children}</Ctx.Provider>
    );
  }

  if (authChecked && !whoami) {
    return null;
  }

  const railItem = (href: string, label: string, icon: React.ReactNode, match: (p: string) => boolean) => (
    <Link href={href} className={`rail-btn ${match(pathname) ? "active" : ""}`} title={label} aria-label={label}>
      {icon}
    </Link>
  );

  const logout = async () => {
    await apiClient.logout().catch(() => {});
    router.replace("/login");
  };

  return (
    <Ctx.Provider value={{ whoami, reloadWhoami }}>
      <div className="shell">
        <nav className="rail">
          <Link href="/" className="mark" aria-label="Centragent home">
            C
          </Link>
          {railItem("/", "Projects", <FolderGit2 size={18} />, (p) => p === "/" || p.startsWith("/p"))}
          {railItem("/agents", "Agents", <Bot size={18} />, (p) => p.startsWith("/a"))}
          {railItem("/connect", "Connect a tool", <Plug size={18} />, (p) => p.startsWith("/connect"))}
          <div className="spacer" />
          {whoami?.user ? (
            <button className="rail-btn" title={`${whoami.user.name} — sign out`} onClick={() => void logout()}>
              <LogOut size={17} />
            </button>
          ) : null}
        </nav>

        <div className="main">
          {joins.length > 0 ? (
            <div className="pad" style={{ paddingBottom: 0 }}>
              {joins.map((request) => (
                <div className="join-card" key={request.id}>
                  <Avatar name={request.agent.name} size={28} />
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>
                      {request.agent.name}{" "}
                      <span className="mono">@{request.agent.handle}</span> wants to join
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {request.conversation.title} · {providerLabel(request.agent.provider)} ·{" "}
                      {request.requestedRole}
                      {request.reason ? ` · “${request.reason}”` : ""}
                    </div>
                  </div>
                  <span className="countdown">{secondsLeft(request.expiresAt, now)}s</span>
                  <button
                    className="btn sm primary"
                    onClick={() => apiClient.acceptJoinRequest(request.id).then(reloadJoins)}
                  >
                    <Check size={14} /> Admit
                  </button>
                  <button
                    className="btn sm"
                    onClick={() => apiClient.rejectJoinRequest(request.id).then(reloadJoins)}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {children}
        </div>
      </div>
    </Ctx.Provider>
  );
}
