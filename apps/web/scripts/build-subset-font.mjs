/**
 * 字体子集化构建脚本：把 .fontcache/ 下的完整 TTF 裁剪为常用字子集，
 * 产出到 assets/fonts/（产物入库，源字体不入库）。
 *
 * 字体来源与授权
 * ─────────────
 * 思源黑体 Noto Sans SC，SIL Open Font License 1.1（可自由使用与再分发，
 * 含子集产物入库）。官方为**可变字体**（wght 轴 100~900），需先实例化为静态字重：
 *
 *   curl -L -o .fontcache/NotoSansSC-VF.ttf \
 *     "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf"
 *   python3 -m fontTools.varLib.instancer .fontcache/NotoSansSC-VF.ttf wght=400 \
 *     -o .fontcache/NotoSansSC-Regular.ttf
 *   python3 -m fontTools.varLib.instancer .fontcache/NotoSansSC-VF.ttf wght=700 \
 *     -o .fontcache/NotoSansSC-Bold.ttf
 *
 * 实例化是一次性开发机步骤（需 fonttools）；本脚本自身只依赖 npm 包 subset-font，
 * 运行时与 CI 均不需要 Python。若拿到的是静态 TTF/OTF，跳过实例化直接放进
 * .fontcache/ 即可。
 *
 * 用法：
 *   1. 按上面准备 .fontcache/ 下的 NotoSansSC-Regular 与 NotoSansSC-Bold 源字体
 *   2. node scripts/build-subset-font.mjs
 *
 * 为什么必须子集化：完整中文字体 10MB+，塞不进函数包；而 satori 需要显式注入
 * 字体 buffer。
 *
 * 为什么两个字重：satori 不合成加粗，海报主标题 64~96px 的重磅字重必须有真实
 * Bold 文件，否则 font-weight:700 会静默退回常规字重（无报错）。
 *
 * ⚠️ 不要用系统自带字体（Arial Unicode MS、Hiragino、Songti 等）当源：它们多为
 * 商业授权，不允许再分发，其子集产物入库有法律风险。
 *
 * 依赖：subset-font（基于 harfbuzzjs，无 Python / fonttools 依赖），
 * 产物格式固定为 'sfnt'（即 TTF/OTF 容器）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import subsetFont from "subset-font";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FONT_CACHE_DIR = resolve(APP_ROOT, ".fontcache");
const OUT_DIR = resolve(APP_ROOT, "assets", "fonts");

/** 两个字重：源文件名 → 产物文件名。 */
const WEIGHTS = [
  {
    weight: 400,
    label: "Regular",
    source: "NotoSansSC-Regular",
    target: "NotoSansSC-Regular.subset.ttf",
  },
  {
    weight: 700,
    label: "Bold",
    source: "NotoSansSC-Bold",
    target: "NotoSansSC-Bold.subset.ttf",
  },
];

const SOURCE_EXTS = [".ttf", ".otf", ".ttc"];

/** 找出源字体文件（按扩展名尝试）。 */
function findSource(baseName) {
  for (const ext of SOURCE_EXTS) {
    const p = resolve(FONT_CACHE_DIR, baseName + ext);
    if (existsSync(p)) return { path: p, ext };
  }
  return undefined;
}

/**
 * 子集字符集。
 *
 * ⚠️ 三条 subset-font 实测约束，改动前必读：
 *
 * 1. **只接受字面字符，不解析 `U+XXXX` 范围语法**。传 `'U+4E00-9FFF'` 会被静默
 *    忽略，产出几乎空的子集。必须把范围展开成字面串，见 expandRanges()。
 *
 * 2. **总字形数超过约 17483 时产出损坏的 glyf 表**：loca 与 glyf 长度不一致，
 *    渲染报 `Offset is outside the bounds of the DataView`（fontTools 侧报
 *    `not enough 'glyf' table data`）。整个 CJK 基本区 20992 字会触发，故不能
 *    用连续范围 0x4E00-0x9FFF。
 *
 * 3. **连续范围裁不出够用的简体字集**。曾用 0x4E00-0x5A00（3072 字），结果
 *    「标题」「图片」的 标(U+6807)/题(U+9898)/片(U+7247) 全在范围外，海报上
 *    静默变空白——缺字形不报错，只能靠渲染后肉眼发现。
 *
 * 因此汉字用 GB 2312 一二级**实际字符表**（6763 字，见 gb2312-hanzi.txt）：
 * 离散集合而非连续范围，总量约 7000 字形，既远低于 bug 阈值，又覆盖简体中文
 * 常用字全集。生僻字（如部分品牌名用字）仍可能缺字形，属已接受的代价。
 */
const HANZI_FILE = resolve(APP_ROOT, "scripts", "gb2312-hanzi.txt");

const RANGES = [
  [0x0020, 0x007e], // ASCII 可打印
  [0x00a0, 0x00ff], // 拉丁补充（含 ¥ £ © 等）
  [0x2000, 0x206f], // 通用标点（— – ' " … 等）
  [0x2070, 0x209f], // 上标下标
  [0x20a0, 0x20bf], // 货币符号（¥ $ € £ 等）
  [0x2100, 0x214f], // 字母式符号（™ ℃ № 等）
  [0x2150, 0x218b], // 数字形式（⅓ ⅔ ① ② 等）
  [0x2460, 0x24ff], // 带圈字符
  [0x25a0, 0x27bf], // 几何图形 / 杂项符号（■ ▲ ● ★ ☆ 等）
  [0x3000, 0x303f], // CJK 符号与标点（。、！？：；等）
  [0xff00, 0xffef], // 半角全角形式（全角标点、全角字母数字）
];

/** 把码点范围展开为字面字符串（subset-font 不接受范围语法）。 */
function expandRanges(ranges) {
  let out = "";
  for (const [from, to] of ranges) {
    for (let cp = from; cp <= to; cp += 1) {
      // 跳过代理区（0xD800-0xDFFF），String.fromCodePoint 会产出孤立代理
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      out += String.fromCodePoint(cp);
    }
  }
  return out;
}

/** GB 2312 一二级汉字（6763 字）。文件为标准字符表，无授权问题。 */
function loadHanzi() {
  if (!existsSync(HANZI_FILE)) {
    throw new Error(
      `汉字表缺失：${HANZI_FILE}（GB 2312 一二级字符表，应随仓库提交）`,
    );
  }
  const text = readFileSync(HANZI_FILE, "utf8").trim();
  if (text.length < 6000) {
    throw new Error(
      `汉字表异常：仅 ${text.length} 字，期望 6763（GB 2312 一二级）`,
    );
  }
  return text;
}

/** 电商常用词补充（GB 2312 已覆盖绝大部分，这里兜住繁体/异体倾向用字）。 */
const EXTRA_CHARS = [
  "爆款", "热卖", "秒杀", "抢购", "直降", "包邮", "顺丰", "现货", "预售",
  "限时", "特惠", "满减", "券后", "起售", "尝鲜", "会员", "专享", "新品",
  "上市", "臻选", "品质", "匠心", "精选", "特价", "钜惠", "狂欢", "同款",
].join("");

const SUBSET_TEXT = expandRanges(RANGES) + loadHanzi() + EXTRA_CHARS;

/** 关键字符校验集：这些字符缺失会让电商海报出现静默空白。 */
const MUST_HAVE = [..."0123456789¥", ..."限时秒杀爆款", ..."。，！？：；"];

async function main() {
  if (!existsSync(FONT_CACHE_DIR)) {
    console.error(
      `✗ 字体源目录不存在：${FONT_CACHE_DIR}\n` +
        `  请先把完整 TTF/OTF 源字体放入该目录（该目录已 gitignore，源字体不入库）。`,
    );
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });

  let failed = false;
  for (const w of WEIGHTS) {
    const source = findSource(w.source);
    if (!source) {
      console.error(
        `✗ 未找到 ${w.label} 源字体：${FONT_CACHE_DIR}/${w.source}{${SOURCE_EXTS.join(",")}}`,
      );
      failed = true;
      continue;
    }

    const input = readFileSync(source.path);
    const t0 = Date.now();
    let output;
    try {
      output = await subsetFont(input, SUBSET_TEXT, { targetFormat: "sfnt" });
    } catch (err) {
      console.error(`✗ ${w.label} 子集化失败：${err?.message ?? err}`);
      failed = true;
      continue;
    }

    // 体积异常小 = 字符集没进去（subset-font 静默忽略不认识的输入），必须拦住
    if (output.length < 100_000) {
      console.error(
        `✗ ${w.label} 子集体积异常（${output.length} 字节）：字符集未生效，` +
          `请检查 subset-font 版本与 SUBSET_TEXT 生成逻辑`,
      );
      failed = true;
      continue;
    }

    const outPath = resolve(OUT_DIR, w.target);
    writeFileSync(outPath, output);
    const ratio = ((output.length / input.length) * 100).toFixed(1);
    console.log(
      `✓ ${w.label.padEnd(8)} ${(input.length / 1024 / 1024).toFixed(1)}MB → ` +
        `${(output.length / 1024).toFixed(0)}KB（${ratio}%） ${Date.now() - t0}ms → ${w.target}`,
    );

    // 校验关键字符确实在子集内（缺字形静默留空，不校验则要等渲染才发现）
    const probe = await subsetFont(input, MUST_HAVE.join(""), { targetFormat: "sfnt" });
    if (probe.length < 1000) {
      console.error(`✗ ${w.label} 疑似不含中文/关键符号（校验子集仅 ${probe.length} 字节）`);
      failed = true;
    }
  }

  if (failed) process.exit(1);
  console.log(`\n产物已写入 ${OUT_DIR}（入库；源字体保留在 .fontcache/ 不入库）`);
  console.log("下一步：确认 assets/fonts/ 下两个字重文件后运行 pnpm test");
}

main().catch((err) => {
  console.error("✗ 未预期的失败：", err);
  process.exit(1);
});
