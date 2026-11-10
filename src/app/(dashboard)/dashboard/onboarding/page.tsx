"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Input } from "@/shared/components";
import CoolRouterLogo from "@/shared/components/CoolRouterLogo";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { getApiErrorMessage, readApiError } from "@/shared/utils/apiErrorMessage";

const STEP_IDS = ["welcome", "security", "provider", "done"] as const;
type StepId = (typeof STEP_IDS)[number];

// Must match keys of APIKEY_PROVIDERS (src/shared/constants/providers.ts) — the API
// rejects anything else as "Invalid provider".
const COMMON_PROVIDERS = [
  { id: "openai", name: "OpenAI" },
  { id: "anthropic", name: "Anthropic" },
  { id: "gemini", name: "Gemini" },
  { id: "openrouter", name: "OpenRouter" },
  { id: "groq", name: "Groq" },
  { id: "mistral", name: "Mistral" },
];

const MIN_PASSWORD_LENGTH = 4;

type ProviderResult =
  { status: "connected" } | { status: "saved"; reason: string; connectionId: string | null } | null;

/**
 * Leave the wizard with a full page load. A client-side `router.push` can replay a
 * redirect the router cached before the session cookie existed and land on /login again.
 */
function go(path: string) {
  window.location.assign(path);
}

export default function OnboardingWizard() {
  const t = useTranslations("onboarding");
  const tc = useTranslations("common");

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [endpoint, setEndpoint] = useState("http://localhost:20128/v1");
  const [copied, setCopied] = useState(false);

  // Security step
  const [hasPassword, setHasPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Provider step
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [providerKey, setProviderKey] = useState("");
  const [providerResult, setProviderResult] = useState<ProviderResult>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setEndpoint(`${window.location.origin}/v1`);
      try {
        const res = await fetch("/api/settings/require-login", { cache: "no-store" });
        const state = res.ok ? await res.json() : null;
        if (cancelled) return;

        if (state?.setupComplete) {
          go("/dashboard");
          return;
        }

        if (state?.hasPassword) {
          // A password exists (set earlier, or INITIAL_PASSWORD): the rest of the wizard
          // needs a signed-in session, so make sure there is one before showing it.
          const session = await fetch("/api/auth/status", { cache: "no-store" })
            .then((r) => r.json())
            .catch(() => null);
          if (cancelled) return;
          if (state.requireLogin !== false && !session?.authenticated) {
            go("/login");
            return;
          }
          setHasPassword(true);
        }
      } catch {
        // Offline or server restarting — show the wizard; each step reports its own errors.
      }
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const stepId: StepId = STEP_IDS[step];
  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const canSubmitPassword =
    password.length >= MIN_PASSWORD_LENGTH && password === confirmPassword && !busy;

  const goTo = (index: number) => {
    setErrorMessage("");
    setStep(Math.max(0, Math.min(STEP_IDS.length - 1, index)));
  };
  const next = () => goTo(step + 1);
  const back = () => goTo(step - 1);

  const handleSetPassword = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!canSubmitPassword) return;
    setBusy(true);
    setErrorMessage("");
    try {
      const res = await fetch("/api/settings/require-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireLogin: true, password }),
      });
      if (!res.ok) {
        setErrorMessage(await readApiError(res, t("failedSetPassword")));
        return;
      }
      // The server signed us in with the response cookie; later steps are authenticated.
      setHasPassword(true);
      setPassword("");
      setConfirmPassword("");
      next();
    } catch {
      setErrorMessage(t("connectionError"));
    } finally {
      setBusy(false);
    }
  };

  const handleSkipPassword = async () => {
    setBusy(true);
    setErrorMessage("");
    try {
      // Explicitly turn login off, otherwise the login page would later ask for a
      // password that was never created.
      const res = await fetch("/api/settings/require-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireLogin: false }),
      });
      if (!res.ok) {
        setErrorMessage(await readApiError(res, t("failedSetPassword")));
        return;
      }
      next();
    } catch {
      setErrorMessage(t("connectionError"));
    } finally {
      setBusy(false);
    }
  };

  const handleAddProvider = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const apiKey = providerKey.trim();
    if (!selectedProvider || !apiKey || busy) return;
    setBusy(true);
    setErrorMessage("");
    try {
      const provider = COMMON_PROVIDERS.find((p) => p.id === selectedProvider);
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selectedProvider,
          name: provider?.name || selectedProvider,
          apiKey,
        }),
      });
      if (!res.ok) {
        setErrorMessage(await readApiError(res, t("failedAddProvider")));
        return;
      }
      const created = await res.json().catch(() => null);
      const connectionId = created?.connection?.id;

      // Saved. Now check the key actually works — the test route answers 200 either way
      // and reports the outcome in `valid`.
      let result: ProviderResult = {
        status: "saved",
        reason: t("couldNotTest"),
        connectionId: connectionId || null,
      };
      if (connectionId) {
        try {
          const testRes = await fetch(`/api/providers/${connectionId}/test`, { method: "POST" });
          const test = await testRes.json().catch(() => null);
          if (testRes.ok && test?.valid === true) {
            result = { status: "connected" };
          } else {
            result = {
              status: "saved",
              connectionId,
              reason:
                typeof test?.error === "string" && test.error
                  ? test.error
                  : getApiErrorMessage(test, t("testFailed")),
            };
          }
        } catch {
          // keep the "could not test" result
        }
      }
      setProviderResult(result);
      setProviderKey("");
    } catch {
      setErrorMessage(t("connectionError"));
    } finally {
      setBusy(false);
    }
  };

  // Throw away the connection that failed its test and go back to the key form.
  const handleRetryProvider = async () => {
    if (busy || providerResult?.status !== "saved") return;
    const { connectionId } = providerResult;
    setBusy(true);
    setErrorMessage("");
    try {
      if (connectionId) {
        await fetch(`/api/providers/${connectionId}`, { method: "DELETE" });
      }
    } catch {
      // Leaving the untested connection behind is harmless; it can be removed later.
    } finally {
      setProviderResult(null);
      setBusy(false);
    }
  };

  const handleFinish = async () => {
    if (busy) return;
    setBusy(true);
    setErrorMessage("");
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupComplete: true }),
      });
      if (res.status === 401) {
        go("/login");
        return;
      }
      if (!res.ok) {
        setErrorMessage(await readApiError(res, t("failedFinish")));
        setBusy(false);
        return;
      }
      go("/dashboard");
    } catch {
      setErrorMessage(t("connectionError"));
      setBusy(false);
    }
  };

  const copyEndpoint = async () => {
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const features = useMemo(
    () => [
      { icon: "hub", title: t("featureEndpointTitle"), desc: t("featureEndpointDesc") },
      { icon: "alt_route", title: t("featureFallbackTitle"), desc: t("featureFallbackDesc") },
      { icon: "monitoring", title: t("featureUsageTitle"), desc: t("featureUsageDesc") },
    ],
    [t]
  );

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg">
        <span
          className="material-symbols-outlined animate-spin text-[22px] text-text-muted"
          role="status"
          aria-label={tc("loading")}
        >
          progress_activity
        </span>
      </div>
    );
  }

  const titles: Record<StepId, string> = {
    welcome: t("welcomeTitle"),
    security: t("securityTitle"),
    provider: t("providerTitle"),
    done: t("doneTitle"),
  };
  const descriptions: Record<StepId, string> = {
    welcome: t("welcomeDesc"),
    security: hasPassword ? t("passwordAlreadySet") : t("securityDesc"),
    provider: t("providerDesc"),
    done: t("doneDesc"),
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-4 py-10">
      <main id="main-content" className="w-full max-w-[480px]">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <CoolRouterLogo size={18} />
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-text-main">
            Cool Router
          </span>
        </div>

        <div className="rounded-xl border border-border bg-surface shadow-elevated">
          {/* Progress */}
          <div className="flex items-center gap-3 border-b border-border px-6 py-3.5">
            <ol className="flex flex-1 gap-1.5" aria-hidden="true">
              {STEP_IDS.map((id, index) => (
                <li
                  key={id}
                  className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                    index <= step ? "bg-primary" : "bg-border"
                  }`}
                />
              ))}
            </ol>
            <span className="font-mono text-[11px] tabular-nums text-text-muted">
              {t("stepOf", { current: step + 1, total: STEP_IDS.length })}
            </span>
          </div>

          <div className="px-6 pb-6 pt-6">
            <h1 className="text-xl font-semibold tracking-tight text-text-main">
              {titles[stepId]}
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-text-muted">{descriptions[stepId]}</p>

            <div className="mt-6">
              {stepId === "welcome" && (
                <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                  {features.map((feature) => (
                    <li key={feature.icon} className="flex items-start gap-3 px-4 py-3">
                      <span
                        className="material-symbols-outlined mt-0.5 text-[20px] text-text-main"
                        aria-hidden="true"
                      >
                        {feature.icon}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-text-main">{feature.title}</p>
                        <p className="text-sm text-text-muted">{feature.desc}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {stepId === "security" && hasPassword && (
                <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
                  <span
                    className="material-symbols-outlined text-[20px] text-success"
                    aria-hidden="true"
                  >
                    check_circle
                  </span>
                  <p className="text-sm text-text-main">{t("passwordReady")}</p>
                </div>
              )}

              {stepId === "security" && !hasPassword && (
                <form id="onboarding-password" onSubmit={handleSetPassword} className="space-y-4">
                  <Input
                    label={t("passwordLabel")}
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    error={
                      passwordTooShort
                        ? t("passwordTooShort", { min: MIN_PASSWORD_LENGTH })
                        : undefined
                    }
                    hint={t("passwordHint", { min: MIN_PASSWORD_LENGTH })}
                  />
                  <Input
                    label={t("confirmPassword")}
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    error={passwordsMismatch ? t("passwordsMismatch") : undefined}
                  />
                  <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-text-muted">
                    <input
                      type="checkbox"
                      checked={showPassword}
                      onChange={(e) => setShowPassword(e.target.checked)}
                      className="size-3.5 accent-[var(--color-primary)]"
                    />
                    {t("showPassword")}
                  </label>
                </form>
              )}

              {stepId === "provider" && !providerResult && (
                <form id="onboarding-provider" onSubmit={handleAddProvider} className="space-y-4">
                  <div
                    className="grid grid-cols-2 gap-2 sm:grid-cols-3"
                    role="radiogroup"
                    aria-label={t("provider")}
                  >
                    {COMMON_PROVIDERS.map((p) => {
                      const selected = selectedProvider === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => {
                            setSelectedProvider(p.id);
                            setErrorMessage("");
                          }}
                          className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                            selected
                              ? "border-primary bg-primary/[0.06] text-text-main"
                              : "border-border text-text-muted hover:border-text-muted/50 hover:text-text-main"
                          }`}
                        >
                          <ProviderIcon providerId={p.id} size={18} type="color" />
                          <span className="truncate">{p.name}</span>
                        </button>
                      );
                    })}
                  </div>
                  {selectedProvider && (
                    <Input
                      label={t("apiKeyLabel")}
                      type="password"
                      autoComplete="off"
                      autoFocus
                      placeholder={t("apiKeyPlaceholder")}
                      value={providerKey}
                      onChange={(e) => setProviderKey(e.target.value)}
                      hint={t("apiKeyHint")}
                    />
                  )}
                </form>
              )}

              {stepId === "provider" && providerResult && (
                <div
                  className="flex items-start gap-3 rounded-lg border border-border px-4 py-3"
                  role="status"
                >
                  <span
                    className={`material-symbols-outlined mt-0.5 text-[20px] ${
                      providerResult.status === "connected" ? "text-success" : "text-warning"
                    }`}
                    aria-hidden="true"
                  >
                    {providerResult.status === "connected" ? "check_circle" : "warning"}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-main">
                      {providerResult.status === "connected"
                        ? t("connectionSuccessful")
                        : t("providerSavedUntested")}
                    </p>
                    {providerResult.status === "saved" && (
                      <p className="mt-0.5 break-words text-sm text-text-muted">
                        {providerResult.reason}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {stepId === "done" && (
                <div className="rounded-lg border border-border">
                  <p className="border-b border-border px-4 py-2 text-xs font-medium uppercase tracking-wider text-text-muted">
                    {t("yourEndpoint")}
                  </p>
                  <div className="flex items-center gap-2 px-4 py-3">
                    <code className="min-w-0 flex-1 truncate font-mono text-sm text-text-main">
                      {endpoint}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      icon={copied ? "check" : "content_copy"}
                      onClick={copyEndpoint}
                    >
                      {copied ? tc("copied") : tc("copy")}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {errorMessage && (
              <p
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-md border border-error/30 bg-error/[0.06] px-3 py-2 text-sm text-error"
              >
                <span className="material-symbols-outlined mt-px text-[16px]" aria-hidden="true">
                  error
                </span>
                <span className="min-w-0 break-words">{errorMessage}</span>
              </p>
            )}

            {/* Actions */}
            <div className="mt-6 flex items-center justify-between gap-3">
              <div>
                {step > 0 && stepId !== "done" && (
                  <Button variant="ghost" onClick={back} disabled={busy}>
                    {tc("back")}
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {stepId === "welcome" && (
                  <Button onClick={next} iconRight="arrow_forward">
                    {t("getStarted")}
                  </Button>
                )}

                {stepId === "security" && hasPassword && (
                  <Button onClick={next} iconRight="arrow_forward">
                    {t("continue")}
                  </Button>
                )}
                {stepId === "security" && !hasPassword && (
                  <>
                    <Button variant="ghost" onClick={handleSkipPassword} disabled={busy}>
                      {t("skipPassword")}
                    </Button>
                    <Button
                      type="submit"
                      form="onboarding-password"
                      loading={busy}
                      disabled={!canSubmitPassword}
                    >
                      {t("setPassword")}
                    </Button>
                  </>
                )}

                {stepId === "provider" && !providerResult && (
                  <>
                    <Button variant="ghost" onClick={next} disabled={busy}>
                      {t("skipForNow")}
                    </Button>
                    <Button
                      type="submit"
                      form="onboarding-provider"
                      loading={busy}
                      disabled={!selectedProvider || !providerKey.trim()}
                    >
                      {busy ? t("testingConnection") : t("addProvider")}
                    </Button>
                  </>
                )}
                {stepId === "provider" && providerResult && (
                  <>
                    {providerResult.status === "saved" && (
                      <Button variant="ghost" onClick={handleRetryProvider} disabled={busy}>
                        {t("tryDifferentKey")}
                      </Button>
                    )}
                    <Button onClick={next} iconRight="arrow_forward" disabled={busy}>
                      {t("continue")}
                    </Button>
                  </>
                )}

                {stepId === "done" && (
                  <Button onClick={handleFinish} loading={busy} iconRight="arrow_forward">
                    {t("goToDashboard")}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        {stepId !== "done" && (
          <div className="mt-5 text-center">
            <button
              type="button"
              onClick={handleFinish}
              disabled={busy}
              className="rounded text-xs text-text-muted transition-colors hover:text-text-main disabled:opacity-50"
            >
              {t("skipWizard")}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
