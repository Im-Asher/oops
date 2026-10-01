"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "cn";
import { CheckIcon, CopyIcon } from "lucide-react";
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

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: "secret", label: "保密" },
  { value: "male", label: "男" },
  { value: "female", label: "女" },
];

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

/** 个人信息页：基本信息卡（资料维护）+ 安全信息卡（改密）。proxy 保护非公开路径，此处仅做 401 兜底跳转。 */
export default function ProfilePage() {
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
          message: body?.error?.message ?? "保存失败，请稍后再试",
        });
        return;
      }
      const updated = body as Profile;
      setProfile(updated);
      setDisplayName(updated.displayName ?? "");
      setBio(updated.bio ?? "");
      setSaveFeedback({ kind: "ok", message: "已保存" });
    } catch {
      setSaveFeedback({ kind: "error", message: "网络异常，请稍后再试" });
    } finally {
      setSaving(false);
    }
  }

  async function onChangePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setPasswordFeedback({ kind: "error", message: "两次输入的新密码不一致" });
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
          message: body?.error?.message ?? "修改失败，请稍后再试",
        });
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      // 响应已下发新 cookie：当前端保持登录，其他端被踢
      setPasswordFeedback({
        kind: "ok",
        message: "密码已修改，其他设备的登录已全部下线",
      });
    } catch {
      setPasswordFeedback({ kind: "error", message: "网络异常，请稍后再试" });
    } finally {
      setChanging(false);
    }
  }

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground">加载中…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-6 px-4 py-10">
      <h1 className="text-center text-xl font-semibold tracking-tight text-foreground">
        个人信息
      </h1>

      <section
        aria-label="基本信息"
        className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
      >
        <h2 className="text-sm font-medium text-foreground">基本信息</h2>

        <div className="space-y-1">
          <span className="text-sm text-muted-foreground">用户名</span>
          <p className="text-sm text-foreground">{profile.username}</p>
        </div>

        <div className="space-y-1">
          <span className="text-sm text-muted-foreground">oops ID</span>
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-sm text-foreground">
              oops_{profile.oopsId}
            </p>
            <Button
              aria-label="复制 oops ID"
              size="icon-sm"
              variant="ghost"
              onClick={() => void copyOopsId()}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </Button>
          </div>
        </div>

        <form className="space-y-4" onSubmit={onSaveProfile}>
          <div className="space-y-2">
            <label htmlFor="displayName" className="text-sm font-medium text-foreground">
              昵称
            </label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={20}
              placeholder="选填，清空即移除"
            />
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium text-foreground">性别</span>
            <div aria-label="性别" className="flex gap-2" role="radiogroup">
              {GENDER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  aria-checked={gender === opt.value}
                  className={cn(
                    "flex-1 rounded-lg border px-3 py-1.5 text-sm transition-colors",
                    gender === opt.value
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                  onClick={() => setGender(opt.value)}
                  role="radio"
                  type="button"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="bio" className="text-sm font-medium text-foreground">
              个性签名
            </label>
            <Input
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={60}
              placeholder="选填，清空即移除"
            />
          </div>

          <FeedbackLine feedback={saveFeedback} />
          <Button className="w-full" disabled={saving} type="submit">
            {saving ? "保存中…" : "保存"}
          </Button>
        </form>
      </section>

      <section
        aria-label="安全信息"
        className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
      >
        <h2 className="text-sm font-medium text-foreground">安全信息</h2>

        <form className="space-y-4" onSubmit={onChangePassword}>
          <div className="space-y-2">
            <label htmlFor="currentPassword" className="text-sm font-medium text-foreground">
              当前密码
            </label>
            <Input
              id="currentPassword"
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              type="password"
              value={currentPassword}
              autoComplete="current-password"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="newPassword" className="text-sm font-medium text-foreground">
              新密码
            </label>
            <Input
              id="newPassword"
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={8}
              required
              type="password"
              value={newPassword}
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">至少 8 位</p>
          </div>

          <div className="space-y-2">
            <label htmlFor="confirmPassword" className="text-sm font-medium text-foreground">
              确认新密码
            </label>
            <Input
              id="confirmPassword"
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              type="password"
              value={confirmPassword}
              autoComplete="new-password"
            />
          </div>

          <FeedbackLine feedback={passwordFeedback} />
          <Button className="w-full" disabled={changing} type="submit">
            {changing ? "修改中…" : "修改密码"}
          </Button>
        </form>
      </section>
    </div>
  );
}
