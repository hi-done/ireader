// 应用内更新的纯展示格式化函数：字节 / 速度 / GitHub Release 说明清洗
// 对应设计文档《软件更新功能设计方案》§7.2（纯函数，与 Vue 解耦、可单测）

/** 字节数人性化（1024 进制）：'8.2 MB' / '136 MB' / '1.4 GB'（<1KB 取整 B，KB 起保留 1 位小数，≥100 显示整数） */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

/** 下载速度：'3.2 MB/s'（复用 formatBytes） */
export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`
}

/**
 * GitHub Release 说明轻量清洗：electron-updater 的 GitHub provider 从 releases.atom 取回的
 * releaseNotes 是「渲染后的 HTML」（content 元素，非 markdown 原文），故先做 HTML 减噪
 * （块级标签转换行、剥离全部标签、解码实体），再兼容 markdown 标记（手动编写的说明仍可能是标记原文）；
 * 链接转纯文字、PR 与 Issue 长链接缩为 #N（裸长 URL 严重影响窄栏可读性），
 * 连续空行与连续重复段落（发布流程对同一 Release 重复生成整段说明时出现）折叠。
 * 只做「够用的减噪」，不追求完整解析（零依赖红线，复杂语法容忍残留）。
 */
export function cleanReleaseNotes(raw: string): string {
  const text = raw
    // —— HTML 段（releases.atom 的 releaseNotes 实际形态）——
    // <br> 转换行
    .replace(/<br\s*\/?>/gi, '\n')
    // 块级闭合标签转换行，保证段落 / 列表项各自成行
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|pre|blockquote|table|tr|details|summary)>/gi, '\n')
    // 其余标签（含属性、图片、链接）整体剥离，仅保留文字
    .replace(/<[^>]+>/g, '')
    // —— markdown 段（手动编写的说明仍可能是标记原文）——
    // 图片语法整段移除（更新说明里不应出现，防御性规则；须先于链接规则，否则 ! 会残留）
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '')
    // 链接转纯文字：[text](url) → text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // GitHub PR / Issue 长链接缩为 #N（未用 [] 包裹的裸链接场景）
    .replace(/https?:\/\/(?:www\.)?github\.com\/[^/\s]+\/[^/\s]+\/(?:pull|issues)\/(\d+)/g, '#$1')
    // 行首标题标记（# ~ ######）
    .replace(/^#{1,6}\s+/gm, '')
    // 加粗（先于斜体，避免 ** 被拆成两次斜体）
    .replace(/\*\*(.+?)\*\*/g, '$1')
    // 斜体
    .replace(/\*(.+?)\*/g, '$1')
    // 行内代码
    .replace(/`([^`]+)`/g, '$1')
    // —— 实体解码（须在剥标签之后，&amp; 最后解码避免二次解码）——
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    // 块级标签转换行可能留下行尾空白
    .replace(/[ \t]+$/gm, '')
    // 连续空行折叠为一个空行
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  // 连续完全相同的段落折叠为一：GitHub 对同一 Release 重复生成整段说明（如 Full Changelog）时会出现
  const paragraphs = text.split(/\n{2,}/)
  return paragraphs.filter((p, i) => p !== paragraphs[i - 1]).join('\n\n')
}
