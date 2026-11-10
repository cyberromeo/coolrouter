"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, Input } from "@/shared/components";
import CoolRouterLogo from "@/shared/components/CoolRouterLogo";
import { getApiErrorMessage } from "@/shared/utils/apiErrorMessage";

/**
 * Full page load on purpose. The dashboard is behind a server-side auth redirect, and
 * the client router keeps the "/dashboard → /login" redirect it saw while signed out;
 * `router.push("/dashboard")` right after signing in replays it and the page appears
 * to ignore the password.
 */
function enterDashboard() {
  window.location.replace("/dashboard");
}

export default function LoginPage() {
  const t = useTranslations("auth");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [initialPasswordActive, setInitialPasswordActive] = useState(false);
  const [nodeVersion, setNodeVersion] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    (async () => {
      try {
        const res = await fetch("/api/settings/require-login", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (res.ok) {
          const data = await res.json();
          if (data.nodeCompatible === false && data.nodeVersion) setNodeVersion(data.nodeVersion);
          // Nothing to sign in with: login is off, or no password has been created yet
          // (the dashboard sends first-time visitors on to the setup wizard).
          if (data.requireLogin === false || !data.hasPassword) {
            enterDashboard();
            return;
          }
          setInitialPasswordActive(data.initialPasswordActive === true);
        }
      } catch {
        // Server unreachable or slow — still show the form so the user can retry.
      } finally {
        clearTimeout(timeoutId);
      }
      setReady(true);
    })();

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, []);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password || loading) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        try {
          sessionStorage.setItem("coolrouter_login_time", String(Date.now()));
        } catch {
          /* storage unavailable */
        }
        // Keep the button in its loading state until the new page replaces this one.
        enterDashboard();
        return;
      }

      const data = await res.json().catch(() => null);
      if (data?.needsSetup) {
        window.location.replace("/dashboard/onboarding");
        return;
      }
      setError(
        res.status === 401
          ? t("invalidPassword")
          : getApiErrorMessage(data, t("errorOccurredRetry"))
      );
    } catch {
      setError(t("errorOccurredRetry"));
    }
    setLoading(false);
  };

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg">
        <span
          className="material-symbols-outlined animate-spin text-[22px] text-text-muted"
          role="status"
          aria-label={t("loading")}
        >
          progress_activity
        </span>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-4 py-10">
      <main id="main-content" className="w-full max-w-[380px]">
        {nodeVersion && (
          <div
            role="alert"
            className="mb-6 rounded-lg border border-warning/40 bg-warning/[0.08] px-4 py-3"
          >
            <p className="text-sm font-medium text-text-main">{t("nodeIncompatibleTitle")}</p>
            <p className="mt-1 text-sm text-text-muted">
              {t("nodeIncompatibleDesc", { version: nodeVersion })}
            </p>
          </div>
        )}

        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-5 flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <CoolRouterLogo size={24} />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-text-main">{t("signIn")}</h1>
          <p className="mt-1.5 text-sm text-text-muted">{t("enterPassword")}</p>
        </div>

        <form
          onSubmit={handleLogin}
          className="rounded-xl border border-border bg-surface p-6 shadow-elevated"
        >
          <div className="relative">
            <Input
              label={t("password")}
              type={showPassword ? "text" : "password"}
              name="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError("");
              }}
              error={error || undefined}
              hint={initialPasswordActive ? t("defaultPasswordHint") : undefined}
              inputClassName="h-10 pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? t("hidePassword") : t("showPassword")}
              aria-pressed={showPassword}
              className="absolute right-1.5 top-[30px] flex size-8 items-center justify-center rounded text-text-muted transition-colors hover:text-text-main"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                {showPassword ? "visibility_off" : "visibility"}
              </span>
            </button>
          </div>

          <Button
            type="submit"
            size="lg"
            fullWidth
            className="mt-5 h-10"
            loading={loading}
            disabled={!password}
          >
            {t("continue")}
          </Button>
        </form>

        <p className="mt-5 text-center">
          <Link
            href="/forgot-password"
            className="rounded text-sm text-text-muted transition-colors hover:text-text-main"
          >
            {t("forgotPassword")}
          </Link>
        </p>
      </main>
    </div>
  );
}
