"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { resolveDisplayName } from "@/lib/nickname";
import { LogOutIcon, UserRoundIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface ProfileSummary {
  username: string;
  oopsId: string;
  displayName: string | null;
}

/**
 * 用户菜单内容：账号摘要（昵称——默认裸 oops ID + oops_ 前缀 ID）/ 个人信息 / 退出登录。
 * 独立导出供时钟下拉底部复用（须渲染在某个 DropdownMenu 根内）。
 * 摘要随组件挂载拉取一次即可（账号信息变更频率极低）。
 */
export function UserMenuContent() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: ProfileSummary | null) => {
        if (alive && body) setProfile(body);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function onLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  const nickname = profile ? resolveDisplayName(profile) : "";

  return (
    <>
      {profile ? (
        <>
          <DropdownMenuLabel className="font-normal">
            <span className="block truncate text-sm">{nickname}</span>
            <span className="block truncate text-xs text-zinc-400">
              oops_{profile.oopsId}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="bg-zinc-800" />
        </>
      ) : null}
      <DropdownMenuItem asChild>
        <Link href="/profile">个人信息</Link>
      </DropdownMenuItem>
      <DropdownMenuItem
        className="text-red-400 focus:text-red-300"
        disabled={loggingOut}
        onSelect={(e) => {
          e.preventDefault();
          void onLogout();
        }}
      >
        <LogOutIcon />
        {loggingOut ? "退出中…" : "退出登录"}
      </DropdownMenuItem>
    </>
  );
}

/**
 * 用户入口（原工具条底部）：头像触发 + 用户菜单内容。
 */
export function UserMenu() {
  const [profile, setProfile] = useState<ProfileSummary | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: ProfileSummary | null) => {
        if (alive && body) setProfile(body);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const nickname = profile ? resolveDisplayName(profile) : "";
  const initial = nickname[0] ?? "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="用户菜单"
          className="size-10 rounded-full text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50"
          size="icon"
          variant="ghost"
        >
          {initial ? (
            <span className="flex size-6 items-center justify-center rounded-full bg-zinc-700 text-xs">
              {initial}
            </span>
          ) : (
            <UserRoundIcon />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-52 border-zinc-800 bg-zinc-900 text-zinc-50"
      >
        <UserMenuContent />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
