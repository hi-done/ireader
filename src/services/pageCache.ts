// 页面位图 LRU 缓存：渲染好的整页位图（离屏 canvas）
// 对应设计文档 §4.2「渲染与预加载」：默认 12 张，容量满时淘汰最久未使用的条目
// 缓存 key 含渲染签名（视口/缩放/模式），签名变化自动失效，无需显式清理

const MAX_ENTRIES = 12

const cache = new Map<string, HTMLCanvasElement>()

/** 缓存 key：书 id + 页码 + 渲染签名 */
function cacheKey(bookId: number, page: number, signature: string): string {
  return `${bookId}:${page}:${signature}`
}

export function getFromCache(
  bookId: number,
  page: number,
  signature: string
): HTMLCanvasElement | null {
  const key = cacheKey(bookId, page, signature)
  const canvas = cache.get(key)
  if (!canvas) return null
  // 刷新为最近使用（Map 迭代按插入序，删后重插即移到末尾）
  cache.delete(key)
  cache.set(key, canvas)
  return canvas
}

export function putToCache(
  bookId: number,
  page: number,
  signature: string,
  canvas: HTMLCanvasElement
): void {
  const key = cacheKey(bookId, page, signature)
  if (cache.has(key)) cache.delete(key)
  cache.set(key, canvas)
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

export function cacheSize(): number {
  return cache.size
}

/** 换书时清空，避免上一本的位图占着容量等 LRU 淘汰 */
export function clearCache(): void {
  cache.clear()
}
