"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api";
import { useApp } from "@/components/Shell";

export default function LoginPage() {
  const router = useRouter();
  const { reloadWhoami } = useApp();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") {
        await apiClient.signup(name, email, password);
      } else {
        await apiClient.login(email, password);
      }
      reloadWhoami();
      router.replace("/");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-page">
      <div className="card auth-card">
        <div className="row gap-3" style={{ marginBottom: 20 }}>
          <div className="mark" style={{ margin: 0 }}>
            C
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Centragent</div>
            <div className="muted" style={{ fontSize: 13 }}>
              {mode === "login" ? "Sign in to your control plane" : "Create an account"}
            </div>
          </div>
        </div>

        {error ? <div className="banner error">{error}</div> : null}

        <form
          className="col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {mode === "signup" ? (
            <div>
              <label className="lbl">Name</label>
              <input className="field" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
          ) : null}
          <div>
            <label className="lbl">Email</label>
            <input
              className="field"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div>
            <label className="lbl">Password</label>
            <input
              className="field"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <button className="btn primary" type="submit" disabled={busy} style={{ justifyContent: "center" }}>
            {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <div className="row between" style={{ marginTop: 16, fontSize: 13 }}>
          <button
            className="btn ghost sm"
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
          >
            {mode === "login" ? "Create an account" : "I have an account"}
          </button>
          <span className="muted" style={{ fontSize: 12 }}>
            Local owner? Just continue.
          </span>
        </div>
      </div>
    </div>
  );
}
