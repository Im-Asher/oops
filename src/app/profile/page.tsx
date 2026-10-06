"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveDisplayName } from "@/lib/nickname";
import { cn } from "cn";
import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Gender = "male" | "female" | "secret";

interface Profile {
  username: string;
  oopsId: string;
  displayName: string | null;
  gender: Gender;
  bio: string | null;
}

interface Feedback {
  kind: "ok" | "error";
  message: string;
}

const GENDER_VALUES: Gender[] = ["secret", "male", "female"];

function FeedbackLine({ feedback }: { feedback: Feedback | null }) {
  if (!feedback) return null;
  return (
    <p
      className={cn(
        "text-sm",
        feedback.kind === "ok" ? "text-emerald-600" : "text-red-500",
      )}
      role="status"
    >
      {feedback.message}
    </p>
  );
}

/** 带显示/隐藏切换的密码输入框：切换仅改 type，受控值由父组件持有。 */
function PasswordField({
  autoComplete,
  id,
  minLength,
  onChange,
  required,
  value,
}: {
  autoComplete: string;
  id: string;
  minLength?: number;
  onChange: (value: string) => void;
  required?: boolean;
  value: string;
}) {
  const t = useTranslations("profile.password");
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        autoComplete={autoComplete}
        className="pr-9"
        id={id}
        minLength={minLength}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        type={visible ? "text" : "password"}
        value={value}
      />
      <button
        aria-label={visible ? t("hide") : t("show")}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 my-auto mr-1 flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        onClick={() => setVisible((v) => !v)}
        type="button"
      >
        {visible ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
      </button>
    </div>
  );
}

/** 个人信息页：身份头卡 + 基本信息卡（资料维护）+ 安全信息卡（改密），lg 起双栏。proxy 保护非公开路径，此处仅做 401 兜底跳转。 */
export default function ProfilePage() {
  const t = useTranslations("profile");
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [copied, setCopied] = useState(false);

  // 基本信息表单
  const [displayName, setDisplayName] = useState("");
  const [gender, setGender] = useState<Gender>("secret");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<Feedback | null>(null);

  // 安全信息表单
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changing, setChanging] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/profile")
      .then(async (res) => (res.ok ? ((await res.json()) as Profile) : null))
      .then((body) => {
        if (!alive) return;
        if (!body) {
          router.replace("/login");
          return;
        }
        setProfile(body);
        setDisplayName(body.displayName ?? "");
        setGender(body.gender);
        setBio(body.bio ?? "");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [router]);

  async function copyOopsId() {
    if (!profile) return;
    try {
      await navigator.clipboard.writeText(`oops_${profile.oopsId}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用（非安全上下文等）：静默失败，用户仍可手动选中复制
    }
  }

  // 空串即清除（API 约定：displayName/bio 空串 → NULL），整组提交保证回填一致
  async function onSaveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setSaveFeedback(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName, gender, bio }),
      });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setSaveFeedback({
          kind: "error",
          // 服务端 message 现阶段仍为中文；按 code 本地化在任务 2.8 统一接入
          message: body?.error?.message ?? t("saveFailed"),
        });
        return;
      }
      const updated = body as Profile;
      setProfile(updated);
      setDisplayName(updated.displayName ?? "");
      setBio(updated.bio ?? "");
      setSaveFeedback({ kind: "ok", message: t("saved") });
    } catch {
      setSaveFeedback({ kind: "error", message: t("networkError") });
    } finally {
      setSaving(false);
    }
  }

  async function onChangePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setPasswordFeedback({ kind: "error", message: t("password.mismatch") });
      return;
    }
    setChanging(true);
    setPasswordFeedback(null);
    try {
      const res = await fetch("/api/profile/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setPasswordFeedback({
          kind: "error",
          message: body?.error?.message ?? t("password.changeFailed"),
        });
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      // 响应已下发新 cookie：当前端保持登录，其他端被踢
      setPasswordFeedback({
        kind: "ok",
        message: t("password.changedAllSignedOut"),
      });
    } catch {
      setPasswordFeedback({ kind: "error", message: t("networkError") });
    } finally {
      setChanging(false);
    }
  }

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      </div>
    );
  }

  const nickname = resolveDisplayName(profile);
  const initial = nickname[0] ?? "";

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-10">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("title")}
        </h1>

        <section
          aria-label={t("identityLabel")}
          className="flex items-center gap-4 rounded-xl border border-border bg-card p-6 shadow-sm"
        >
          <div className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl font-semibold text-primary">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold text-foreground">{nickname}</p>
            <p className="truncate text-sm text-muted-foreground">{profile.username}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <p className="font-mono text-sm text-foreground">oops_{profile.oopsId}</p>
            <Button
              aria-label={t("copyOopsId")}
              size="icon-sm"
              variant="ghost"
              onClick={() => void copyOopsId()}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </Button>
          </div>
        </section>

        <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
          <section
            aria-label={t("basicTitle")}
            className="flex flex-col space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
          >
            <div className="space-y-1">
              <h2 className="text-sm font-medium text-foreground">{t("basicTitle")}</h2>
              <p className="text-xs text-muted-foreground">{t("basicDescription")}</p>
            </div>

            <form className="flex flex-1 flex-col space-y-4" onSubmit={onSaveProfile}>
              <div className="space-y-2">
                <label htmlFor="displayName" className="text-sm font-medium text-foreground">
                  {t("displayName")}
                </label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={20}
                  placeholder={nickname}
                />
                <p className="text-xs text-muted-foreground">{t("displayNameHint")}</p>
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium text-foreground">{t("gender.label")}</span>
                <div
                  aria-label={t("gender.label")}
                  className="flex rounded-lg border border-border p-1"
                  role="radiogroup"
                >
                  {GENDER_VALUES.map((value) => (
                    <button
                      key={value}
                      aria-checked={gender === value}
                      className={cn(
                        "flex-1 rounded-md px-3 py-1.5 text-sm transition-colors",
                        gender === value
                          ? "bg-primary/10 font-medium text-foreground"
                          : "text-muted-foreground hover:bg-muted",
                      )}
                      onClick={() => setGender(value)}
                      role="radio"
                      type="button"
                    >
                      {t(`gender.${value}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="bio" className="text-sm font-medium text-foreground">
                  {t("bio")}
                </label>
                <Input
                  id="bio"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  maxLength={60}
                  placeholder={t("bioPlaceholder")}
                />
              </div>

              <div className="mt-auto space-y-4">
                <FeedbackLine feedback={saveFeedback} />
                <Button className="w-full" disabled={saving} type="submit">
                  {saving ? t("saving") : t("save")}
                </Button>
              </div>
            </form>
          </section>

          <section
            aria-label={t("securityTitle")}
            className="flex flex-col space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
          >
            <div className="space-y-1">
              <h2 className="text-sm font-medium text-foreground">{t("securityTitle")}</h2>
              <p className="text-xs text-muted-foreground">{t("securityDescription")}</p>
            </div>

            <form className="flex flex-1 flex-col space-y-4" onSubmit={onChangePassword}>
              <div className="space-y-2">
                <label htmlFor="currentPassword" className="text-sm font-medium text-foreground">
                  {t("currentPassword")}
                </label>
                <PasswordField
                  autoComplete="current-password"
                  id="currentPassword"
                  onChange={setCurrentPassword}
                  required
                  value={currentPassword}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="newPassword" className="text-sm font-medium text-foreground">
                  {t("newPassword")}
                </label>
                <PasswordField
                  autoComplete="new-password"
                  id="newPassword"
                  minLength={8}
                  onChange={setNewPassword}
                  required
                  value={newPassword}
                />
                <p className="text-xs text-muted-foreground">{t("passwordHint")}</p>
              </div>

              <div className="space-y-2">
                <label htmlFor="confirmPassword" className="text-sm font-medium text-foreground">
                  {t("confirmPassword")}
                </label>
                <PasswordField
                  autoComplete="new-password"
                  id="confirmPassword"
                  onChange={setConfirmPassword}
                  required
                  value={confirmPassword}
                />
              </div>

              <div className="mt-auto space-y-4">
                <FeedbackLine feedback={passwordFeedback} />
                <Button className="w-full" disabled={changing} type="submit">
                  {changing ? t("password.changing") : t("password.change")}
                </Button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
