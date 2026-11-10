"use client";

/**
 * Forgot Password — recovery instructions.
 *
 * There is no e-mail reset: Cool Router is self-hosted, so recovery means proving you
 * control the machine it runs on. Three ways, one per kind of install:
 *   1. Desktop app — the tray / Help menu removes the password
 *   2. Source / Docker — the reset-password CLI
 *   3. Anything else — INITIAL_PASSWORD plus deleting the stored hash
 */

import Link from "next/link";
import { useTranslations } from "next-intl";
import CoolRouterLogo from "@/shared/components/CoolRouterLogo";

function Method({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start gap-3.5">
        <span
          className="material-symbols-outlined mt-0.5 text-[20px] text-text-main"
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-text-main">{title}</h2>
          <div className="mt-1.5 space-y-2.5 text-sm leading-relaxed text-text-muted">
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}

function Command({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-text-main">
      <code>{children}</code>
    </pre>
  );
}

export default function ForgotPasswordPage() {
  const t = useTranslations("auth");

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-4 py-10">
      <main id="main-content" className="w-full max-w-[520px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-5 flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <CoolRouterLogo size={24} />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-text-main">
            {t("resetPassword")}
          </h1>
          <p className="mt-1.5 text-sm text-text-muted">{t("resetDescription")}</p>
        </div>

        <div className="flex flex-col gap-3">
          <Method icon="desktop_windows" title={t("methodDesktopTitle")}>
            <p>{t("methodDesktopDescription")}</p>
          </Method>

          <Method icon="terminal" title={t("methodCliTitle")}>
            <p>{t("methodCliDescription")}</p>
            <Command>node bin/reset-password.mjs</Command>
            <p className="text-xs">{t("methodCliHint")}</p>
          </Method>

          <Method icon="database" title={t("methodManualTitle")}>
            <p>{t("methodManualDescription")}</p>
            <ol className="list-decimal space-y-2.5 pl-4">
              <li>{t("stopServer")}</li>
              <li>
                {t("setPasswordInYour")}{" "}
                <code className="rounded bg-bg px-1 font-mono text-xs text-text-main">.env</code>{" "}
                {t("fileLabelSuffix")}
                <div className="mt-1.5">
                  <Command>INITIAL_PASSWORD={t("newPasswordPlaceholder")}</Command>
                </div>
              </li>
              <li>
                {t("deleteSettingsFile")}
                <div className="mt-1.5">
                  <Command>
                    {`sqlite3 storage.sqlite "DELETE FROM key_value WHERE namespace='settings' AND key='password'"`}
                  </Command>
                </div>
              </li>
              <li>{t("restartServerWithNewPassword")}</li>
            </ol>
          </Method>
        </div>

        <p className="mt-6 text-center">
          <Link
            href="/login"
            className="inline-flex items-center gap-1 rounded text-sm text-text-muted transition-colors hover:text-text-main"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
              arrow_back
            </span>
            {t("backToLogin")}
          </Link>
        </p>
      </main>
    </div>
  );
}
