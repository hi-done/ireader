// EPUB 图片型书（pre-paginated）的跨页组划分与步进（纯函数）
// 对应设计文档《EPUB双页翻页跨页步进修复设计方案-20261021》§4.1 / §4.2
//
// 背景：pre-paginated 布局下 spine 一项 = 一页，双页显示由 epubjs 的
// handleNextPrePaginated 追加相邻 section 组成。翻页若按 spine 索引 ±1 推进，
// 会把当前右页变成左页，视觉上「只翻一页」。本模块把「一屏 = 一个跨页组」的
// 事实集中成组表，供翻页推演、定位对齐与连翻合并共用。

/** spine 项的最小元数据（来自 book.spine.get(i)） */
export interface EpubSpineItem {
  /** spine 原索引（section.index；linear=no 的项也保留原索引） */
  index: number
  /** itemref properties（page-spread-left / page-spread-right 等） */
  properties: string[]
  /** section.linear：false 的项不参与翻页（与 Section.next() 一致） */
  linear: boolean
}

/** properties 运行时可能缺失（旧书 itemref 无属性），统一做数组兜底 */
function hasProp(item: EpubSpineItem, name: string): boolean {
  return Array.isArray(item.properties) && item.properties.includes(name)
}

/**
 * 按 epubjs pre-paginated 双页的实际配对规则构建跨页组。
 *
 * 规则来源（与 src/services/epub.ts 的补丁一一对应）：
 * - 封面单独成页开启：照抄原生 display 的 forceRight（page-spread-right 独占）
 *   与 handleNextPrePaginated（index===0 独占、next 带 page-spread-left 不并排）；
 * - 封面不单独成页：applyCoverSinglePage 已把 handleNextPrePaginated 改为无条件
 *   追加，组表按线性序列两两成组（用户设置优先于 EPUB 元数据声明）。
 *
 * @param items spine 项（含 linear=no 的项，函数内部过滤）
 * @param coverSinglePage 全局设置：双页模式封面是否单独成页
 * @returns 每组为 spine 索引数组（升序）；单页组长度为 1
 */
export function buildPrePaginatedSpreads(
  items: EpubSpineItem[],
  coverSinglePage: boolean
): number[][] {
  const linear = items.filter((it) => it.linear)
  const groups: number[][] = []
  let p = 0
  while (p < linear.length) {
    const cur = linear[p]
    if (coverSinglePage) {
      // 原生 handleNextPrePaginated：spine 第 0 项（封面）恒单独
      if (cur.index === 0) {
        groups.push([cur.index])
        p += 1
        continue
      }
      // 原生 display：带 page-spread-right 的 section 独占（forceRight）
      if (hasProp(cur, 'page-spread-right')) {
        groups.push([cur.index])
        p += 1
        continue
      }
      // 原生 handleNextPrePaginated：next 带 page-spread-left 则不并排
      const next = linear[p + 1]
      if (next && !hasProp(next, 'page-spread-left')) {
        groups.push([cur.index, next.index])
        p += 2
      } else {
        groups.push([cur.index])
        p += 1
      }
    } else {
      // applyCoverSinglePage 的 patch：用户设置优先，线性序列一律两两并排
      const next = linear[p + 1]
      if (next) {
        groups.push([cur.index, next.index])
        p += 2
      } else {
        groups.push([cur.index])
        p += 1
      }
    }
  }
  return groups
}

/**
 * 把任意页索引对齐到其所在组的首页。
 * 命中按「组索引区间」判定而非仅组内枚举：linear=no 的页会落在组内空洞里
 * （如组 [1,3]），它属于该组、翻页时就是显示这两页。找不到时前向对齐到最近
 * 的下一组；超出末组落到末组首页。
 *
 * @param groups buildPrePaginatedSpreads 的结果
 * @param page 任意 spine 索引
 * @returns 组首页索引（组表为空时原样返回）
 */
export function alignPrePaginatedPage(groups: number[][], page: number): number {
  if (groups.length === 0) return Math.max(0, page)
  const hit = groups.find((g) => g.length > 0 && page >= g[0] && page <= g[g.length - 1])
  if (hit) return hit[0]
  const forward = groups.find((g) => g[0] > page)
  return (forward ?? groups[groups.length - 1])[0]
}

/**
 * 从 page 所在组前进 delta 个跨页，返回目标组首页（夹取到首/末组）。
 * 先对齐再步进：即使当前停在本组第二页，也只前进一组而不是多跳。
 *
 * @param groups buildPrePaginatedSpreads 的结果
 * @param page 当前 spine 索引
 * @param delta 跨页步数（正=下一页，负=上一页）
 * @returns 目标组首页索引（组表为空时按原索引放行，由调用方夹取）
 */
export function stepPrePaginatedPage(
  groups: number[][],
  page: number,
  delta: number
): number {
  if (groups.length === 0) return Math.max(0, page)
  const aligned = alignPrePaginatedPage(groups, page)
  const gi = groups.findIndex((g) => g[0] === aligned)
  const target = Math.min(Math.max((gi === -1 ? 0 : gi) + delta, 0), groups.length - 1)
  return groups[target][0]
}
