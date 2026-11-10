"use client";

import { useTranslations } from "next-intl";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { copyToClipboard } from "@/shared/utils/clipboard";

/** How long to wait for the dashboard to confirm it received the result. */
const ACK_TIMEOUT_MS = 1500;

/**
 * OAuth Callback Page Content
 *
 * The provider redirects here with ?code=… (or ?error=…). The result is handed to the
 * dashboard that started the flow:
 *   - popup: postMessage to the opener, then the popup closes itself;
 *   - other tab of the same browser: BroadcastChannel / localStorage, and the dashboard
 *     answers with an acknowledgement;
 *   - anything else (the desktop app opens links in the system browser, remote access,
 *     another browser profile): nobody can be reached, so the URL is shown with a Copy
 *     button for the "paste the callback URL" field of the dialog.
 */
function CallbackContent() {
  const searchParams = useSearchParams();
  // processing | success (popup, closing) | done (delivered) | manual (copy the URL) | error
  const [status, setStatus] = useState("processing");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [errorText, setErrorText] = useState("");
  const [copied, setCopied] = useState(false);
  const t = useTranslations("auth");
  const tc = useTranslations("common");

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");
    const errorDescription = searchParams.get("error_description");

    const callbackData = {
      code,
      state,
      error,
      errorDescription,
      fullUrl: window.location.href,
    };

    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => {
      timers.push(setTimeout(fn, ms));
    };
    let channel: BroadcastChannel | null = null;
    let settled = false;

    // Method 1: postMessage to opener (popup mode)
    let sentToOpener = false;
    if (window.opener) {
      try {
        window.opener.postMessage({ type: "oauth_callback", data: callbackData }, "*"); // Allow any origin for local dev
        sentToOpener = true;
      } catch (e) {
        console.log("postMessage failed:", e);
      }
    }

    // Method 2: BroadcastChannel (same origin tabs). Posting never fails just because
    // nobody listens, so wait for the dashboard's acknowledgement before claiming success.
    try {
      channel = new BroadcastChannel("oauth_callback");
      channel.onmessage = (event) => {
        if (event.data?.type !== "oauth_callback_ack" || settled || error || !code) return;
        settled = true;
        setStatus("done");
      };
      channel.postMessage(callbackData);
    } catch (e) {
      console.log("BroadcastChannel failed:", e);
    }

    // Method 3: localStorage event (fallback)
    try {
      localStorage.setItem(
        "oauth_callback",
        JSON.stringify({ ...callbackData, timestamp: Date.now() })
      );
    } catch (e) {
      console.log("localStorage failed:", e);
    }

    // Use setTimeout to avoid synchronous setState in effect
    later(() => {
      setCallbackUrl(window.location.href);

      if (error) {
        // The provider refused (access_denied, …). This used to be shown as
        // "Authorization Successful!".
        settled = true;
        setErrorText(errorDescription || error);
        setStatus("error");
        if (sentToOpener) later(() => window.close(), 2500);
        return;
      }

      if (!code) {
        settled = true;
        setStatus("manual");
        return;
      }

      if (sentToOpener) {
        // Popup: the dashboard has the code, close automatically.
        settled = true;
        setStatus("success");
        later(() => {
          window.close();
          // If can't close (not a popup), show success message
          later(() => setStatus("done"), 500);
        }, 1500);
        return;
      }

      // Opened as a normal tab. Unless a dashboard tab acknowledges, show the URL so it
      // can be pasted into the dialog — telling the user to close the tab here would
      // throw away the only copy of the authorization code.
      later(() => {
        if (settled) return;
        settled = true;
        setStatus("manual");
      }, ACK_TIMEOUT_MS);
    }, 0);

    return () => {
      timers.forEach(clearTimeout);
      try {
        channel?.close();
      } catch {
        /* already closed */
      }
    };
  }, [searchParams]);

  const handleCopy = async () => {
    const ok = await copyToClipboard(callbackUrl);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="text-center p-8 max-w-md">
        {status === "processing" && (
          <>
            <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-primary animate-spin">
                progress_activity
              </span>
            </div>
            <h1 className="text-xl font-semibold mb-2">{t("processing")}</h1>
            <p className="text-text-muted">{t("pleaseWait")}</p>
          </>
        )}

        {(status === "success" || status === "done") && (
          <>
            <div className="size-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-green-600">
                check_circle
              </span>
            </div>
            <h1 className="text-xl font-semibold mb-2">{t("authSuccess")}</h1>
            <p className="text-text-muted">
              {status === "success" ? t("windowWillClose") : t("closeTabNow")}
            </p>
          </>
        )}

        {status === "error" && (
          <div role="alert">
            <div className="size-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-red-600">error</span>
            </div>
            <h1 className="text-xl font-semibold mb-2">
              {t.has("authFailed") ? t("authFailed") : "Authorization failed"}
            </h1>
            <p className="text-sm text-red-600 dark:text-red-400 break-words mb-2">{errorText}</p>
            <p className="text-text-muted">{t("closeTabNow")}</p>
          </div>
        )}

        {status === "manual" && (
          <>
            <div className="size-16 mx-auto mb-4 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-yellow-600">info</span>
            </div>
            <h1 className="text-xl font-semibold mb-2">{t("copyUrl")}</h1>
            <p className="text-text-muted mb-4">{t("copyUrlManual")}</p>
            <div className="bg-surface border border-border rounded-lg p-3 text-left">
              <code className="text-xs break-all">{callbackUrl}</code>
            </div>
            <button
              type="button"
              onClick={handleCopy}
              className="mt-3 inline-flex items-center justify-center gap-2 h-9 px-4 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary-hover transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                {copied ? "check" : "content_copy"}
              </span>
              {copied ? tc("copied") : tc("copy")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * OAuth Callback Page
 * Receives callback from OAuth providers and sends data back via multiple methods
 */
export default function CallbackPage() {
  const t = useTranslations("auth");
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-bg">
          <div className="text-center p-8">
            <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-primary animate-spin">
                progress_activity
              </span>
            </div>
            <p className="text-text-muted">{t("loading")}</p>
          </div>
        </div>
      }
    >
      <CallbackContent />
    </Suspense>
  );
}
