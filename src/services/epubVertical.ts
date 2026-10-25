// 图片型 EPUB 的纵向页面源：section → 图片 → canvas
// 对应设计文档 specs/阅读方向上至下连续滚动设计方案-20261023.md §6.5
// 图片型书在 ttb 下不创建 rendition（连续流会强制单列），改由 VerticalScrollView 驱动

import type { EpubBook } from './epub'
import type { PageBox, VerticalPageSource } from './verticalLayout'

/** 已解析页面的元数据缓存上限：只存元数据与 <img> 元素，位图交给浏览器缓存 */
const META_CACHE_SIZE = 8

interface EpubImageMeta {
  /** 压缩包内路径（data: 时即原始 URL） */
  path: string
  /** 可直接赋给 <img src> 的 URL */
  url: string
  image: HTMLImageElement
  width: number
  height: number
}

/**
 * 把 section 内图片的相对 src 解析为压缩包内路径（纯函数，供单测）。
 * - `data:` 原样返回（不查压缩包）
 * - 远程地址返回 null（纯离线，不取网络资源）
 * - 相对/绝对路径按 section 的 url 解析，去掉前导斜杠并做 URL 解码
 */
export function resolveEpubImagePath(sectionUrl: string, src: string): string | null {
  const trimmed = src.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('data:')) return trimmed
  // 带协议（http/https/blob/ireader…）的地址一律拒绝：阅读器不访问网络
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null
  try {
    const resolved = new URL(trimmed, `http://local/${sectionUrl.replace(/^\/+/, '')}`)
    const path = resolved.pathname.replace(/^\/+/, '')
    return path ? decodeURIComponent(path) : null
  } catch {
    return null
  }
}

/** 取 section 内图片的 src：优先 <img>，其次 SVG <image>（href / xlink:href） */
function pickImageSrc(doc: Document): string {
  const img = doc.querySelector('img')
  if (img) return img.getAttribute('src') ?? ''
  const svgImage = doc.querySelector('image')
  if (!svgImage) return ''
  return svgImage.getAttribute('href') ?? svgImage.getAttribute('xlink:href') ?? ''
}

/** 按目标尺寸等比计算 CSS 盒（只给一边时另一边按纵横比推导） */
function fitImageBox(
  naturalWidth: number,
  naturalHeight: number,
  target: { width?: number; height?: number }
): PageBox {
  const ratio = naturalHeight / naturalWidth
  if (target.width && target.width > 0) {
    return { width: target.width, height: target.width * ratio }
  }
  if (target.height && target.height > 0) {
    return { width: target.height / ratio, height: target.height }
  }
  return { width: naturalWidth, height: naturalHeight }
}

/**
 * 图片型 EPUB 的纵向页面源。pageId = spine 索引（0 起）。
 * archive.createUrl 自带 urlCache，同一页重复滚动不会重复解压；
 * 文档随用随卸（section.unload），避免整本 spine 常驻内存。
 */
export function createEpubImageSource(book: EpubBook): VerticalPageSource {
  const metaCache = new Map<number, EpubImageMeta>()

  async function loadMeta(page: number): Promise<EpubImageMeta> {
    const cached = metaCache.get(page)
    if (cached) {
      // LRU：命中即移到队尾
      metaCache.delete(page)
      metaCache.set(page, cached)
      return cached
    }

    const section = book.spine.get(page)
    if (!section) throw new Error(`EPUB spine 缺少第 ${page} 项`)
    let src = ''
    try {
      const doc = await Promise.resolve(section.load(book.load.bind(book)))
      src = pickImageSrc(doc)
    } finally {
      section.unload()
    }
    const path = resolveEpubImagePath(section.url, src)
    if (!path) throw new Error(`EPUB 第 ${page + 1} 页无可解析图片`)

    const url = path.startsWith('data:')
      ? path
      : await book.archive.createUrl(`/${path}`, { base64: false })
    const image = new Image()
    image.src = url
    await image.decode()
    // 宽高为 0 视为解码失败：抛出后由视图显示占位并可点击重试
    if (!(image.naturalWidth > 0) || !(image.naturalHeight > 0)) {
      throw new Error(`EPUB 第 ${page + 1} 页图片解码失败`)
    }

    const meta: EpubImageMeta = {
      path,
      url,
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
    }
    metaCache.set(page, meta)
    if (metaCache.size > META_CACHE_SIZE) {
      const oldest = metaCache.keys().next().value
      if (oldest !== undefined) metaCache.delete(oldest)
    }
    return meta
  }

  return {
    async render(page, canvas, target) {
      const meta = await loadMeta(page)
      const box = fitImageBox(meta.width, meta.height, target)
      const width = Math.max(1, Math.round(box.width))
      const height = Math.max(1, Math.round(box.height))
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas 2D context unavailable')
      context.fillStyle = '#000'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(meta.image, 0, 0, canvas.width, canvas.height)
      return { width, height }
    },
    // 图片解码与绘制都是同步收尾：无进行中的异步任务可取消
    cancel() {},
  }
}
