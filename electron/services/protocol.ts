// ireader:// 自定义协议：向渲染进程提供 PDF/EPUB 原文件、CBZ/MOBI 单页图片、封面图与 pdf.js 运行时资源
// 对应设计文档 §3.4 / §6.5

import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { booksRepo } from '../db/repos/booksRepo'
import { getCoverFilePath } from './coverService'
import { detectFormat } from './libraryService'
import { readPage as readCbzPage } from './cbzService'
import { readPage as readMobiPage } from './mobiService'
import * as logger from './logger'

export const IREADER_PROTOCOL = 'ireader'

/** 必须在 app ready 之前调用，声明协议为特权协议（支持流式、fetch、跨源访问） */
export function registerProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: IREADER_PROTOCOL,
      // cors_enabled：渲染进程页面（http://localhost:5173 或 file://）跨源 fetch ireader:// 资源必需，
      // 否则 pdf.js 加载 ireader://pdf/{id} 会被 CORS 拦截，封面队列全部静默失败
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ])
}

/** 为响应附加 CORS 头，允许页面内 fetch/img 跨源读取（本地应用，无敏感跨源面） */
function withCors(res: Response): Response {
  const headers = new Headers(res.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}

/** 必须在 app ready 之后调用，注册协议处理逻辑 */
export function registerProtocolHandler(): void {
  protocol.handle(IREADER_PROTOCOL, async (request) => {
    const url = new URL(request.url)
    // url.hostname 对应 pdf | epub | cbz | cover | pdfjs，url.pathname 对应 /{bookId} 或资源路径
    const kind = url.hostname

    // pdf.js 运行时资源（cmaps / standard_fonts）不是书籍数据，须在 bookId 校验前分流
    if (kind === 'pdfjs') {
      return servePdfjsAsset(url.pathname)
    }

    // cbz / mobi 逐页供给：/cbz|mobi/{bookId}/{page}；须在通用 bookId 解析前分流（通用解析对 /123/45 得 NaN）
    if (kind === 'cbz' || kind === 'mobi') {
      return servePagedImage(kind, url, kind === 'cbz' ? readCbzPage : readMobiPage)
    }

    const bookId = Number(url.pathname.replace(/^\//, ''))

    if (!Number.isInteger(bookId)) {
      return new Response('Invalid book id', { status: 400 })
    }

    // pdf / epub 均直出原始文件：渲染进程按格式选择对应 host 读取
    if (kind === 'pdf' || kind === 'epub') {
      const row = booksRepo.findById(bookId)
      if (!row || !fs.existsSync(row.file_path)) {
        return new Response('Not Found', { status: 404 })
      }
      return withCors(await net.fetch(pathToFileURL(row.file_path).toString()))
    }

    if (kind === 'cover') {
      const filePath = getCoverFilePath(bookId)
      if (!fs.existsSync(filePath)) {
        return new Response('Not Found', { status: 404 })
      }
      return withCors(await net.fetch(pathToFileURL(filePath).toString()))
    }

    return new Response('Not Found', { status: 404 })
  })
}

/**
 * 逐页图片供给（cbz / mobi 共用）：URL 形如 /{bookId}/{page}，page 为 1 基阅读页码。
 * 两个格式的单页读取函数签名一致，差异只在格式校验与错误语义文案。
 */
async function servePagedImage(
  kind: 'cbz' | 'mobi',
  url: URL,
  readPage: (filePath: string, page: number) => Promise<{ data: Buffer; contentType: string } | null>
): Promise<Response> {
  const match = /^\/(\d+)\/(\d+)$/.exec(url.pathname)
  if (!match) {
    return new Response(`Invalid ${kind} url`, { status: 400 })
  }
  const bookId = Number(match[1])
  const page = Number(match[2])
  const row = booksRepo.findById(bookId)
  if (!row || detectFormat(row.file_path) !== kind || !fs.existsSync(row.file_path)) {
    return new Response('Not Found', { status: 404 })
  }
  try {
    const p = await readPage(row.file_path, page)
    if (!p) return new Response('Not Found', { status: 404 })
    // Buffer 是 ArrayBufferLike 背景的视图，直接作为 BodyInit 时与 DOM 的 ArrayBufferView<ArrayBuffer> 不兼容，复制一份 Uint8Array
    return withCors(
      new Response(new Uint8Array(p.data), { headers: { 'Content-Type': p.contentType } })
    )
  } catch (e) {
    logger.error(
      `[protocol] ${kind} 读取失败 bookId=${bookId} page=${page}: ${e instanceof Error ? e.message : String(e)}`
    )
    return new Response(`Bad ${kind} file`, { status: 500 })
  }
}

/**
 * 供给 pdf.js 运行时资源：ireader://pdfjs/cmaps/xxx.bcmap、ireader://pdfjs/standard_fonts/xxx.pfb。
 * 中文等 CJK 文档的字体构建依赖 cmaps 目录的内置 CMap（如 Adobe-GB1-UCS2.bcmap），缺失会导致整段中文不渲染。
 * 资源根目录 = <APP_ROOT>/node_modules/pdfjs-dist：开发态即项目 node_modules，
 * 打包后位于 app.asar 内（Electron 的 fs 补丁支持直接读取 asar 内文件）。
 */
async function servePdfjsAsset(pathname: string): Promise<Response> {
  // 白名单校验：仅放行 cmaps / standard_fonts 两目录下的单层文件名；
  // 文件名按「字母数字下划线短横线 + 点号分段」匹配，连续点号不匹配，杜绝路径穿越
  const match = /^\/(cmaps|standard_fonts)\/([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)$/.exec(pathname)
  if (!match) {
    return new Response('Not Found', { status: 404 })
  }
  const [, dir, fileName] = match
  try {
    const data = await fs.promises.readFile(
      path.join(process.env.APP_ROOT!, 'node_modules', 'pdfjs-dist', dir, fileName)
    )
    return withCors(new Response(data, { headers: { 'Content-Type': 'application/octet-stream' } }))
  } catch {
    return new Response('Not Found', { status: 404 })
  }
}
