"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "cn";
import { apiErrorMessage } from "@/lib/api-error";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

export default function RegisterPage() {
  const t = useTranslations("auth");
  const tApi = useTranslations("common.apiErrors");
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // 实时规则提示与注册 zod 同步（3–20、字母开头、仅字母/数字/下划线）
  const trimmedUsername = username.trim();
  const usernameRules = [
    {
      key: "length",
      ok: trimmedUsername.length >= 3 && trimmedUsername.length <= 20,
      text: t("rules.length"),
    },
    { key: "startsWithLetter", ok: /^[A-Za-z]/.test(trimmedUsername), text: t("rules.startsWithLetter") },
    { key: "allowedChars", ok: /^[A-Za-z0-9_]*$/.test(trimmedUsername), text: t("rules.allowedChars") },
  ];

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteCode, username, displayName, password }),
      });
      if (res.ok) {
        router.replace("/home");
        router.refresh();
        return;
      }
      // code 已登记 → 词典文案；未登记（如 zod 动态校验消息）→ server message 兜底
      const body = (await res.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      setError(apiErrorMessage(body?.error, tApi, t("register.submitFailed")));
    } catch {
      setError(t("networkError"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
    >
      <div className="space-y-2">
        <label htmlFor="inviteCode" className="text-sm font-medium text-foreground">
          {t("inviteCode")}
        </label>
        <Input
          id="inviteCode"
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value)}
          placeholder={t("register.invitePlaceholder")}
          autoFocus
          required
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="username" className="text-sm font-medium text-foreground">
          {t("username")}
        </label>
        <Input
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          maxLength={20}
          minLength={3}
          pattern="[A-Za-z][A-Za-z0-9_]*"
          required
          title={t("rules.summary")}
        />
        {trimmedUsername.length > 0 && (
          <ul className="space-y-0.5" aria-label={t("rules.label")}>
            {usernameRules.map((rule) => (
              <li
                key={rule.key}
                className={cn(
                  "text-xs",
                  rule.ok ? "text-emerald-600" : "text-muted-foreground",
                )}
              >
                {rule.ok ? "✓" : "·"} {rule.text}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-2">
        <label htmlFor="displayName" className="text-sm font-medium text-foreground">
          {t("displayName")} <span className="font-normal text-muted-foreground">{t("optional")}</span>
        </label>
        <Input
          id="displayName"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          autoComplete="nickname"
          maxLength={20}
          placeholder={t("register.displayNamePlaceholder")}
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="password" className="text-sm font-medium text-foreground">
          {t("password")}
        </label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
        />
        <p className="text-xs text-muted-foreground">{t("passwordHint")}</p>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t("register.submitting") : t("register.submit")}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {t("register.haveAccount")}{" "}
        <Link href="/login" className="text-foreground underline-offset-4 hover:underline">
          {t("login.submit")}
        </Link>
      </p>
    </form>
  );
}
