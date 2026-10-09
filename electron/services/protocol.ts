// ireader:// 自定义协议：向渲染进程提供 PDF 原文件与封面图
// 对应设计文档 §3.4 / §6.5

import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
import { booksRepo } from '../db/repos/booksRepo'
import { getCoverFilePath } from './coverService'

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
    // url.hostname 对应 pdf | cover，url.pathname 对应 /{bookId}
    const kind = url.hostname
    const bookId = Number(url.pathname.replace(/^\//, ''))

    if (!Number.isInteger(bookId)) {
      return new Response('Invalid book id', { status: 400 })
    }

    if (kind === 'pdf') {
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
