/**
 * 公式渲染预处理（阶段3提前：用户反馈"下划线没有变成下标"）。
 *
 * PDF 提取产物里公式的两种形态：
 * 1) 定界 LaTeX：\(O(ND)\)、\[E=mc^2\]——pymupdf4llm 输出的标准形态。
 *    remark-math 只认 $...$ / $$...$$，需要转换定界符后交给 KaTeX 渲染。
 * 2) 下划线碎片：E_D-1、pn_d、e_o——提取层把数学下标拍平成 _ 连接的
 *    文本（无定界符）。KaTeX 无法识别整段（内容混着正文），按空白
 *    token 启发式转换：`X_sub` / `X^sup` 形态的 token 包成 $X_{sub}$，
 *    KaTeX 就能渲染出真正的上下标。
 *
 * 启发式的安全边界：
 * - 下标部分长度 >6 的不转（adam_optimizer 这类 snake_case 标识符
 *   不是数学下标，转了反而怪）；
 * - 纯数字/字母+数字组合才转，避免碰普通标点。
 */

const _DOLLAR_DISPLAY = /\\\[(.+?)\\\]/gs;
const _DOLLAR_INLINE = /\\\((.+?)\\\)/gs;

// X_sub / X^sup：base 以字母开头；sub/sup 为 ≤6 位字母数字/+-（剥掉
// token 首尾的包裹符号 {}() 等，尾部允许残留的下划线——s_n_ 形态）
const _MATH_TOKEN =
  /^([({\[]*)([A-Za-z][A-Za-z0-9]*)([_^])([A-Za-z0-9+\-]{1,6})([_)}\].,;:!?]*)$/;

/** 下标部分是否像数学记号（而非英文单词）：数字开头、含数字/-、或单个大写/小写字母 */
function _subscript_like(sub: string): boolean {
  if (sub.length <= 2) return true; // D, d, 0, -1…
  if (/[0-9\-]/.test(sub)) return true; // D-1, 2-1, n1…
  return false;
}

/** 单个空白 token → KaTeX 行内式；不匹配原样返回 */
function _convert_token(tok: string): string {
  const m = _MATH_TOKEN.exec(tok);
  if (!m) return tok;
  const [, pre, base, op, sub, post] = m;
  if (!_subscript_like(sub)) return tok;
  const script = op === "^" ? "^" : "_";
  // 尾部残留下划线（s_n_ 形态）并入公式，避免渲染后还剩一个裸 _
  const tail = post.startsWith("_") ? post.slice(1) : post;
  return `${pre}$${base}{${script}{${sub}}}$${tail}`;
}

export function preprocessMath(md: string): string {
  if (!md) return md;
  let out = md.replace(_DOLLAR_DISPLAY, (_m, body) => `\n$$${body}$$\n`);
  out = out.replace(_DOLLAR_INLINE, (_m, body) => `$${body}$`);
  // 下划线碎片：仅对含 _/^ 的行做 token 转换（不含这些字符的行零开销直通）
  if (out.includes("_") || out.includes("^")) {
    out = out
      .split("\n")
      .map((line) =>
        line.includes("_") || line.includes("^")
          ? line.split(" ").map(_convert_token).join(" ")
          : line
      )
      .join("\n");
  }
  return out;
}
