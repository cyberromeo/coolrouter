"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, Button, Input, Select, Toggle } from "@/shared/components";
import { AI_PROVIDERS, AUTH_METHODS } from "@/shared/constants/config";
import { APIKEY_PROVIDERS, FREE_PROVIDERS, OAUTH_PROVIDERS } from "@/shared/constants/providers";
import { getApiErrorMessage } from "@/shared/utils/apiErrorMessage";
import { useTranslations } from "next-intl";

// POST /api/providers only accepts API-key providers; OAuth providers sign in from their
// own provider page. Offer each list under the matching auth method.
const toOptions = (providers: Record<string, { id: string; name: string }>) =>
  Object.values(providers).map((p) => ({ value: p.id, label: p.name }));

const apiKeyProviderOptions = toOptions(APIKEY_PROVIDERS as any);
const oauthProviderOptions = toOptions({ ...FREE_PROVIDERS, ...OAUTH_PROVIDERS } as any);

const authMethodOptions = Object.values(AUTH_METHODS).map((m) => ({
  value: m.id,
  label: m.name,
}));

const API_KEY_METHOD = AUTH_METHODS.apikey.id;
const OAUTH_METHOD = AUTH_METHODS.oauth.id;

export default function NewProviderPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const t = useTranslations("providers");
  const [formData, setFormData] = useState({
    provider: "",
    authMethod: API_KEY_METHOD,
    apiKey: "",
    displayName: "",
    isActive: true,
  });
  const [errors, setErrors] = useState<any>({});

  const isApiKeyMethod = formData.authMethod === API_KEY_METHOD;
  const providerOptions = isApiKeyMethod ? apiKeyProviderOptions : oauthProviderOptions;

  const handleChange = (field, value) => {
    setFormData((prev) => {
      const next = { ...prev, [field]: value };
      // A provider picked under one auth method may not exist under the other.
      if (field === "authMethod") {
        const options = value === API_KEY_METHOD ? apiKeyProviderOptions : oauthProviderOptions;
        if (!options.some((option) => option.value === prev.provider)) next.provider = "";
      }
      return next;
    });
    if (errors[field] || errors.submit) {
      setErrors((prev) => ({ ...prev, [field]: null, submit: null }));
    }
  };

  const validate = () => {
    const newErrors: any = {};
    if (!formData.provider) newErrors.provider = t("selectProvider");
    if (isApiKeyMethod && !formData.apiKey.trim()) {
      newErrors.apiKey = t("apiKeyRequired");
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // OAuth sign-in (device code / browser flow) lives on the provider's own page.
  const goToProviderPage = () => {
    if (!formData.provider) {
      setErrors({ provider: t("selectProvider") });
      return;
    }
    router.push(`/dashboard/providers/${formData.provider}`);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    if (!isApiKeyMethod) {
      goToProviderPage();
      return;
    }

    setLoading(true);
    try {
      // Same rule as the "Add API key" dialog on the provider page: check the key first and
      // only store working keys, marked active. A connection saved without a status shows
      // up as "No connections" in the provider list and is left out of the combo model picker.
      const validation = await fetch("/api/providers/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: formData.provider, apiKey: formData.apiKey.trim() }),
      })
        .then((res) => res.json())
        .catch(() => null);
      if (!validation?.valid) {
        setErrors({ submit: t("apiKeyValidationFailed") });
        return;
      }

      const response = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The API requires `name`; fall back to the provider's name when none was typed.
        body: JSON.stringify({
          provider: formData.provider,
          apiKey: formData.apiKey.trim(),
          name:
            formData.displayName.trim() ||
            (AI_PROVIDERS as any)[formData.provider]?.name ||
            formData.provider,
          testStatus: "active",
        }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setErrors({ submit: getApiErrorMessage(data, t("failedCreate")) });
        return;
      }

      // New connections are always created active; apply the toggle afterwards.
      const connectionId = data?.connection?.id;
      if (!formData.isActive && connectionId) {
        await fetch(`/api/providers/${connectionId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: false }),
        }).catch(() => {});
      }

      router.push("/dashboard/providers");
    } catch (error) {
      setErrors({ submit: t("errorOccurred") });
    } finally {
      setLoading(false);
    }
  };

  const selectedProvider = (AI_PROVIDERS as any)[formData.provider];

  return (
    <div className="max-w-2xl mx-auto min-w-0">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/dashboard/providers"
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary transition-colors mb-4"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          {t("backToProviders")}
        </Link>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight break-words">
          {t("addNewProvider")}
        </h1>
        <p className="text-text-muted mt-2">{t("configureNewProvider")}</p>
      </div>

      {/* Form */}
      <Card>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          {/* Provider Selection */}
          <Select
            label={t("providerLabel")}
            options={providerOptions}
            value={formData.provider}
            onChange={(e) => handleChange("provider", e.target.value)}
            placeholder={t("selectProvider")}
            error={errors.provider as string}
            required
          />

          {/* Provider Info */}
          {selectedProvider && (
            <Card.Section className="flex items-center gap-3">
              <div className="size-10 rounded-lg flex items-center justify-center bg-bg border border-border">
                <span
                  className="material-symbols-outlined text-xl"
                  style={{ color: selectedProvider.color }}
                >
                  {selectedProvider.icon}
                </span>
              </div>
              <div>
                <p className="font-medium">{selectedProvider.name}</p>
                <p className="text-sm text-text-muted">{t("selectedProvider")}</p>
              </div>
            </Card.Section>
          )}

          {/* Auth Method */}
          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium">
              {t("authMethod")} <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-col sm:flex-row gap-3">
              {authMethodOptions.map((method) => (
                <button
                  key={method.value}
                  type="button"
                  onClick={() => handleChange("authMethod", method.value)}
                  className={`flex-1 min-w-0 flex items-center justify-center gap-2 p-4 rounded-lg border transition-all ${
                    formData.authMethod === method.value
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <span className="material-symbols-outlined">
                    {method.value === API_KEY_METHOD ? "key" : "lock"}
                  </span>
                  <span className="font-medium text-center break-words">
                    {method.value === API_KEY_METHOD ? t("apiKeyLabel") : t("oauth2Label")}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* API Key Input */}
          {isApiKeyMethod && (
            <Input
              label={t("apiKeyLabel")}
              type="password"
              placeholder={t("enterApiKey")}
              value={formData.apiKey}
              onChange={(e) => handleChange("apiKey", e.target.value)}
              error={errors.apiKey as string}
              hint={t("apiKeySecure")}
              required
            />
          )}

          {/* OAuth2 Button */}
          {formData.authMethod === OAUTH_METHOD && (
            <Card.Section className="">
              <p className="text-sm text-text-muted mb-4">{t("oauth2Desc")}</p>
              <Button type="button" variant="secondary" icon="link" onClick={goToProviderPage}>
                {t("oauth2Connect")}
              </Button>
            </Card.Section>
          )}

          {/* Display name and active toggle only apply to API-key connections created here */}
          {isApiKeyMethod && (
            <>
              <Input
                label={t("displayName")}
                placeholder={t("displayNamePlaceholder")}
                value={formData.displayName}
                onChange={(e) => handleChange("displayName", e.target.value)}
                hint={t("displayNameHint")}
              />

              <Toggle
                checked={formData.isActive}
                onChange={(checked) => handleChange("isActive", checked)}
                label={t("active")}
                description={t("activeDescription")}
              />
            </>
          )}

          {/* Error Message */}
          {errors.submit && (
            <div
              role="alert"
              className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm"
            >
              {errors.submit as string}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-border">
            <Link href="/dashboard/providers" className="flex-1">
              <Button type="button" variant="ghost" fullWidth>
                {t("cancel")}
              </Button>
            </Link>
            {isApiKeyMethod && (
              <Button type="submit" loading={loading} fullWidth className="flex-1">
                {t("createProvider")}
              </Button>
            )}
          </div>
        </form>
      </Card>
    </div>
  );
}
