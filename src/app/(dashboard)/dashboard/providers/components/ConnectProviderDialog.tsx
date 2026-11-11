"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import Button from "@/shared/components/Button";
import Modal from "@/shared/components/Modal";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { OAuthModal, KiroOAuthWrapper, CursorAuthModal } from "@/shared/components";
import { cn } from "@/shared/utils/cn";
import { LOCAL_SERVERS, type LocalServer } from "@/shared/constants/localServers";
import { precheckApiKey, uniquePrefix, type GalleryProvider } from "../providerGallery";

export type ConnectTarget =
  | { kind: "apikey" | "oauth"; provider: GalleryProvider; info: Record<string, unknown> }
  | { kind: "local"; server: LocalServer }
  | { kind: "custom"; api: "openai" | "anthropic" };

interface ConnectProviderDialogProps {
  target: ConnectTarget | null;
  onClose: () => void;
  /** Called after a connection exists and its models were fetched. */
  onConnected: () => void;
}

type Phase = "form" | "working" | "done";

async function readError(response: Response, fallback: string) {
  try {
    const data = await response.json();
    const error = data?.error;
    if (typeof error === "string") return error;
    return error?.message || fallback;
  } catch {
    return fallback;
  }
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(await readError(response, `Request failed (${response.status})`));
  return response.json();
}

/** Fetch the new connection's models and fill an empty model map from them. */
async function syncAndArrange(connectionId: string): Promise<number> {
  let count = 0;
  try {
    const synced = await postJson(`/api/providers/${connectionId}/sync-models`, {});
    count = Array.isArray(synced?.models)
      ? synced.models.length
      : Number(synced?.syncedModels) || 0;
  } catch {
    // Built-in providers ship a model list, so a failed fetch is not fatal.
  }
  try {
    await postJson("/api/model-map/auto-fill", {});
  } catch {
    // The map page offers "Arrange my models" as well.
  }
  return count;
}

async function newestConnectionId(providerId: string): Promise<string | null> {
  const response = await fetch("/api/providers", { cache: "no-store" });
  if (!response.ok) return null;
  const data = await response.json();
  const list = (data?.connections || []).filter(
    (c: { provider: string }) => c.provider === providerId
  );
  list.sort((a: { createdAt?: string }, b: { createdAt?: string }) =>
    String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
  );
  return list[0]?.id ?? null;
}

async function createCustomConnection(options: {
  name: string;
  type: "openai-compatible" | "anthropic-compatible";
  baseUrl: string;
  apiKey: string;
}): Promise<string> {
  const nodesResponse = await fetch("/api/provider-nodes", { cache: "no-store" });
  const nodes = nodesResponse.ok ? (await nodesResponse.json())?.nodes || [] : [];
  const prefix = uniquePrefix(
    options.name,
    nodes.map((n: { prefix?: string }) => n.prefix || "")
  );
  const { node } = await postJson("/api/provider-nodes", {
    name: options.name,
    prefix,
    type: options.type,
    ...(options.type === "openai-compatible" ? { apiType: "chat" } : {}),
    baseUrl: options.baseUrl,
  });
  const { connection } = await postJson("/api/providers", {
    provider: node.id,
    apiKey: options.apiKey || "local",
    name: options.name,
  });
  return connection.id;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-text-main">{label}</span>
      {children}
      {hint && <span className="text-xs text-text-muted">{hint}</span>}
    </label>
  );
}

const inputClass =
  "h-10 w-full rounded-lg border border-border bg-bg px-3 text-sm text-text-main outline-none transition-colors focus:border-accent";

export default function ConnectProviderDialog({
  target,
  onClose,
  onConnected,
}: ConnectProviderDialogProps) {
  const t = useTranslations("providerGallery");
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelCount, setModelCount] = useState(0);
  const [probe, setProbe] = useState<{
    reachable: boolean;
    models: string[];
    baseUrl: string;
  } | null>(null);
  // The parent remounts this dialog for every new target (key), so state starts fresh.
  const [oauthOpen, setOauthOpen] = useState(target?.kind === "oauth");

  // Local servers: look for the server as soon as the dialog opens.
  useEffect(() => {
    if (target?.kind !== "local") return;
    let cancelled = false;
    postJson("/api/providers/local-probe", { server: target.server.id })
      .then((result) => !cancelled && setProbe(result))
      .catch(() => !cancelled && setProbe({ reachable: false, models: [], baseUrl: "" }));
    return () => {
      cancelled = true;
    };
  }, [target]);

  if (!target) return null;

  const finish = async (connectionId: string | null) => {
    const count = connectionId ? await syncAndArrange(connectionId) : 0;
    setModelCount(count);
    setPhase("done");
    onConnected();
  };

  const connectApiKey = async () => {
    if (target.kind !== "apikey") return;
    const checked = precheckApiKey(target.provider.id, apiKey);
    if (checked.error === "empty") return setError(t("keyEmpty"));
    if (checked.error === "short") return setError(t("keyShort"));
    if (checked.error?.startsWith("prefix:")) {
      return setError(
        t("keyPrefix", { provider: target.provider.name, prefix: checked.error.slice(7) })
      );
    }
    setError(null);
    setPhase("working");
    try {
      const validation = await postJson("/api/providers/validate", {
        provider: target.provider.id,
        apiKey: checked.key,
      }).catch(() => null);
      if (validation && validation.valid === false) {
        setPhase("form");
        setError(validation.error || t("keyRejected"));
        return;
      }
      const { connection } = await postJson("/api/providers", {
        provider: target.provider.id,
        apiKey: checked.key,
        name: target.provider.name,
        testStatus: validation?.valid ? "active" : undefined,
      });
      await finish(connection?.id ?? null);
    } catch (err) {
      setPhase("form");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const connectLocal = async () => {
    if (target.kind !== "local" || !probe?.reachable) return;
    setPhase("working");
    try {
      const id = await createCustomConnection({
        name: target.server.name,
        type: "openai-compatible",
        baseUrl: probe.baseUrl,
        apiKey: "local",
      });
      await finish(id);
    } catch (err) {
      setPhase("form");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const connectCustom = async () => {
    if (target.kind !== "custom") return;
    const trimmedName = name.trim();
    const trimmedUrl = baseUrl.trim();
    if (!trimmedName) return setError(t("nameRequired"));
    if (!/^https?:\/\/\S+$/i.test(trimmedUrl)) return setError(t("urlInvalid"));
    setError(null);
    setPhase("working");
    try {
      const id = await createCustomConnection({
        name: trimmedName,
        type: target.api === "anthropic" ? "anthropic-compatible" : "openai-compatible",
        baseUrl: trimmedUrl,
        apiKey: apiKey.trim(),
      });
      await finish(id);
    } catch (err) {
      setPhase("form");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Sign-in providers use their existing sign-in dialogs.
  if (target.kind === "oauth") {
    const providerId = target.provider.id;
    const onSuccess = async () => {
      setOauthOpen(false);
      setPhase("working");
      await finish(await newestConnectionId(providerId));
    };
    const signIn =
      providerId === "kiro" ? (
        <KiroOAuthWrapper
          isOpen={oauthOpen}
          providerInfo={target.info}
          onSuccess={onSuccess}
          onClose={onClose}
        />
      ) : providerId === "cursor" ? (
        <CursorAuthModal isOpen={oauthOpen} onSuccess={onSuccess} onClose={onClose} />
      ) : (
        <OAuthModal
          isOpen={oauthOpen}
          provider={providerId}
          providerInfo={target.info as { name: string }}
          onSuccess={onSuccess}
          onClose={onClose}
        />
      );
    if (oauthOpen) return signIn;
  }

  const title =
    target.kind === "local"
      ? target.server.name
      : target.kind === "custom"
        ? t(target.api === "anthropic" ? "customAnthropicTitle" : "customOpenAITitle")
        : target.provider.name;
  const iconId =
    target.kind === "local"
      ? target.server.icon
      : target.kind === "custom"
        ? target.api === "anthropic"
          ? "anthropic-m"
          : "oai-cc"
        : target.provider.id;

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="md"
      title={
        <span className="flex items-center gap-2.5">
          <ProviderIcon providerId={iconId} size={22} type="color" />
          {title}
        </span>
      }
    >
      {phase === "done" ? (
        <div className="flex flex-col items-center py-4 text-center">
          <span className="material-symbols-outlined text-[44px] text-success" aria-hidden="true">
            check_circle
          </span>
          <h3 className="mt-2 text-lg font-semibold text-text-main">{t("connectedTitle")}</h3>
          <p className="mt-1 text-sm text-text-muted">
            {modelCount > 0 ? t("connectedModels", { count: modelCount }) : t("connectedNoCount")}
          </p>
          <div className="mt-6 flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
            <Link href="/dashboard/map">
              <Button iconRight="arrow_forward" fullWidth>
                {t("arrangeNext")}
              </Button>
            </Link>
            <Button variant="secondary" onClick={onClose}>
              {t("addAnother")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {target.kind === "apikey" && (
            <>
              <Field
                label={t("apiKey")}
                hint={
                  target.provider.website ? (
                    <a
                      href={target.provider.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-accent hover:underline"
                    >
                      {t("getKey", { provider: target.provider.name })} ↗
                    </a>
                  ) : (
                    target.provider.hint
                  )
                }
              >
                <input
                  autoFocus
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && connectApiKey()}
                  placeholder={t("pasteKey")}
                  className={cn(inputClass, "font-mono")}
                  aria-label={t("apiKey")}
                />
              </Field>
              {target.provider.freeNote && (
                <p className="rounded-lg bg-success/10 px-3 py-2 text-xs text-text-main">
                  {target.provider.freeNote}
                </p>
              )}
            </>
          )}

          {target.kind === "local" && (
            <div className="flex flex-col gap-3">
              {probe === null && (
                <p className="flex items-center gap-2 text-sm text-text-muted">
                  <span
                    className="material-symbols-outlined animate-spin text-[18px]"
                    aria-hidden="true"
                  >
                    progress_activity
                  </span>
                  {t("localLooking", { name: target.server.name, port: target.server.port })}
                </p>
              )}
              {probe?.reachable && (
                <p className="text-sm text-text-main">
                  {t("localFound", { count: probe.models.length, url: probe.baseUrl })}
                </p>
              )}
              {probe && !probe.reachable && (
                <div className="flex flex-col gap-2 text-sm text-text-muted">
                  <p>
                    {t("localNotFound", { name: target.server.name, port: target.server.port })}
                  </p>
                  <code className="rounded-lg bg-bg px-3 py-2 font-mono text-xs text-text-main">
                    {target.server.startCommand}
                  </code>
                  <a
                    href={target.server.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-accent hover:underline"
                  >
                    {t("localGet", { name: target.server.name })} ↗
                  </a>
                </div>
              )}
            </div>
          )}

          {target.kind === "custom" && (
            <>
              <Field label={t("customName")}>
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t("customNamePlaceholder")}
                  className={inputClass}
                />
              </Field>
              <Field label={t("customUrl")} hint={t("customUrlHint")}>
                <input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder={
                    target.api === "anthropic"
                      ? "https://api.example.com/v1"
                      : "https://api.example.com/v1"
                  }
                  spellCheck={false}
                  className={cn(inputClass, "font-mono")}
                />
              </Field>
              <Field label={t("customKey")} hint={t("customKeyHint")}>
                <input
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  className={cn(inputClass, "font-mono")}
                />
              </Field>
            </>
          )}

          {error && (
            <p className="rounded-lg bg-error/10 px-3 py-2 text-sm text-error" role="alert">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            {target.kind === "apikey" ? (
              <Link
                href={`/dashboard/providers/${target.provider.id}`}
                className="text-xs font-medium text-text-muted hover:text-text-main"
              >
                {t("moreOptions")}
              </Link>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose} disabled={phase === "working"}>
                {t("cancel")}
              </Button>
              {target.kind === "local" ? (
                <Button
                  icon="link"
                  loading={phase === "working"}
                  disabled={!probe?.reachable}
                  onClick={connectLocal}
                >
                  {probe?.reachable
                    ? t("connectModels", { count: probe.models.length })
                    : t("connect")}
                </Button>
              ) : (
                <Button
                  icon="link"
                  loading={phase === "working"}
                  onClick={target.kind === "custom" ? connectCustom : connectApiKey}
                >
                  {t("connect")}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

export { LOCAL_SERVERS };
