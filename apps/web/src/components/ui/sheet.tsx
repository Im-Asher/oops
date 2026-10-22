"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import { XIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";

/**
 * 覆盖式抽屉（DESIGN.md B7.2.5）。基于已装的 radix-ui Dialog，不新增依赖：
 * 焦点陷阱、Esc、aria-modal、滚动锁定与焦点归还都由 Radix 提供，
 * 手写 keydown + 遮罩 div 无法等价替代。
 *
 * 过渡只用 B6 的既有档位（--duration-slow），不引入第四档。
 */

function Sheet({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-black/20 backdrop-blur-[2px] data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      data-slot="sheet-overlay"
      {...props}
    />
  );
}

const SIDE_CLASSES = {
  bottom: "inset-x-0 bottom-0 border-t data-open:slide-in-from-bottom data-closed:slide-out-to-bottom",
  left: "inset-y-0 left-0 h-full w-sidebar-drawer max-w-[85vw] border-r data-open:slide-in-from-left data-closed:slide-out-to-left",
  right:
    "inset-y-0 right-0 h-full w-sidebar-drawer max-w-[85vw] border-l data-open:slide-in-from-right data-closed:slide-out-to-right",
  top: "inset-x-0 top-0 border-b data-open:slide-in-from-top data-closed:slide-out-to-top",
} as const;

export type SheetSide = keyof typeof SIDE_CLASSES;

function SheetContent({
  children,
  className,
  side = "left",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  side?: SheetSide;
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex flex-col gap-0 bg-sidebar text-sidebar-foreground shadow-[var(--shadow-pop)] outline-none duration-[var(--duration-slow)] ease-[var(--ease-standard)] motion-reduce:duration-0 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
          SIDE_CLASSES[side],
          className,
        )}
        data-slot="sheet-content"
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1", className)} data-slot="sheet-header" {...props} />;
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("font-heading text-base font-semibold text-foreground", className)}
      data-slot="sheet-title"
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm text-muted-foreground", className)}
      data-slot="sheet-description"
      {...props}
    />
  );
}

/** 抽屉关闭钮；label 由调用方给（须来自词典，客户端禁止裸中文）。 */
function SheetCloseButton({ label, side = "left" }: { label: string; side?: SheetSide }) {
  return (
    <SheetClose asChild>
      <Button
        aria-label={label}
        className={cn("absolute top-3 z-10", side === "right" ? "left-3" : "right-3")}
        size="icon-sm"
        title={label}
        variant="ghost"
      >
        <XIcon />
      </Button>
    </SheetClose>
  );
}

export {
  Sheet,
  SheetClose,
  SheetCloseButton,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
};