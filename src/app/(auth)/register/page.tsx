"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function RegisterPage() {
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteCode, username, password }),
      });
      if (res.ok) {
        router.replace("/chat");
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(body?.error?.message ?? "注册失败，请稍后再试");
    } catch {
      setError("网络异常，请稍后再试");
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
          邀请码
        </label>
        <Input
          id="inviteCode"
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value)}
          placeholder="向管理员索取"
          autoFocus
          required
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="username" className="text-sm font-medium text-foreground">
          用户名
        </label>
        <Input
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          minLength={2}
          maxLength={32}
          required
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="password" className="text-sm font-medium text-foreground">
          密码
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
        <p className="text-xs text-muted-foreground">至少 8 位</p>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "注册中…" : "注册并进入工作台"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        已有账号？
        <Link href="/login" className="text-foreground underline-offset-4 hover:underline">
          登录
        </Link>
      </p>
    </form>
  );
}
