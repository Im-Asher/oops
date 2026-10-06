/**
 * 设计草稿本机持久化（spec design-editor「草稿持久化」）：MVP 单草稿槽，
 * 键 oops:design:draft:v1。损坏 / 版本不符返回 null（回落空白画布），
 * 由 parseDesignDoc 严格校验承担语义防线。
 */
import type { StorageLike } from "@/lib/canvas/workspace-storage";
import { parseDesignDoc, type DesignDoc } from "@/lib/design/doc";

const DRAFT_KEY = "oops:design:draft:v1";

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadDraft(storage: StorageLike | null = defaultStorage()): DesignDoc | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return parseDesignDoc(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveDraft(doc: DesignDoc, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(DRAFT_KEY, JSON.stringify(doc));
  } catch {
    // 配额满 / 隐私模式：保存失败静默（草稿是尽力而为的本机能力）
  }
}

export function clearDraft(storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(DRAFT_KEY);
  } catch {
    // 同上
  }
}
