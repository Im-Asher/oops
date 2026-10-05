import { randomBytes } from "node:crypto";

export const OOPS_ID_LENGTH = 8;

/** 去易混字符集：小写字母去 i/l/o，数字去 0/1，共 31 个 */
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const ALPHABET_SIZE = ALPHABET.length;

/** 拒采样上限（31 的最大整数倍 ≤ 256），避免取模偏差 */
const REJECT_ABOVE = Math.floor(256 / ALPHABET_SIZE) * ALPHABET_SIZE;

export const OOPS_ID_PATTERN = /^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/;

/** 生成 8 位 oops ID（库存裸值，展示层加 oops_ 前缀）。 */
export function generateOopsId(): string {
  let id = "";
  while (id.length < OOPS_ID_LENGTH) {
    const bytes = randomBytes(OOPS_ID_LENGTH * 2);
    for (const byte of bytes) {
      if (byte >= REJECT_ABOVE) continue;
      id += ALPHABET[byte % ALPHABET_SIZE];
      if (id.length === OOPS_ID_LENGTH) break;
    }
  }
  return id;
}

export class OopsIdGenerationError extends Error {
  constructor() {
    super("oops id generation exhausted retries");
    this.name = "OopsIdGenerationError";
  }
}

/**
 * 生成全局唯一 oops ID：冲突时重试，上限 5 次。
 * `isAvailable` 返回 true 表示该 ID 未被占用（查库或由唯一索引冲突反馈）。
 */
export async function generateUniqueOopsId(
  isAvailable: (id: string) => Promise<boolean>,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = generateOopsId();
    if (await isAvailable(id)) return id;
  }
  throw new OopsIdGenerationError();
}
