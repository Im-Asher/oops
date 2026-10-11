"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  createContext,
  useContext,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

interface ReasoningContextValue {
  isStreaming: boolean;
  isOpen: boolean;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

const useReasoning = () => {
  const ctx = useContext(ReasoningContext);
  if (!ctx) {
    throw new Error("Reasoning components must be used within Reasoning");
  }
  return ctx;
};

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  /** 思考内容是否仍在流式追加（流式期间自动展开，结束后自动收起）。 */
  isStreaming?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
};

/**
 * 可折叠思考区块：用户手动展开/收起优先于自动行为。
 * 自动行为 = 流式中展开、结束后收起；跨回合重置由消费方以 key 重挂载完成，
 * 组件内不做 effect（遵循 react-hooks/set-state-in-effect 约束）。
 */
export const Reasoning = ({
  className,
  isStreaming = false,
  defaultOpen = false,
  children,
  ...props
}: ReasoningProps) => {
  const [userOverride, setUserOverride] = useState<boolean | null>(null);
  const isOpen = userOverride ?? (isStreaming || defaultOpen);

  return (
    <ReasoningContext.Provider value={{ isStreaming, isOpen }}>
      <Collapsible
        className={cn("not-prose group mb-4", className)}
        onOpenChange={setUserOverride}
        open={isOpen}
        {...props}
      >
        {children}
      </Collapsible>
    </ReasoningContext.Provider>
  );
};

export type ReasoningTriggerProps = ComponentProps<typeof CollapsibleTrigger>;

export const ReasoningTrigger = ({
  className,
  children,
  ...props
}: ReasoningTriggerProps) => {
  const t = useTranslations("chat.reasoning");
  const { isStreaming, isOpen } = useReasoning();
  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-fit items-center gap-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground",
        className
      )}
      {...props}
    >
      {children ?? (
        <>
          <BrainIcon className="size-3.5" />
          <span>{isStreaming ? t("streaming") : t("label")}</span>
          <ChevronDownIcon
            className={cn(
              "size-3 transition-transform",
              isOpen ? "rotate-180" : "rotate-0"
            )}
          />
        </>
      )}
    </CollapsibleTrigger>
  );
};

export type ReasoningContentProps = ComponentProps<typeof CollapsibleContent>;

export const ReasoningContent = ({
  className,
  children,
  ...props
}: ReasoningContentProps) => (
  <CollapsibleContent
    className={cn(
      "mt-2 border-l-2 border-border pl-3 text-muted-foreground text-xs leading-relaxed whitespace-pre-wrap",
      "data-[state=closed]:hidden",
      className
    )}
    {...props}
  >
    {children}
  </CollapsibleContent>
);
