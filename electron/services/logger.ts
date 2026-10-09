// 主进程本地日志：写入 {userData}/logs/ireader.log，超过 1MB 滚动为 ireader.log.old（仅保留一份）
// 对应设计文档 §11：主进程写本地日志，便于排查

import fs from 'node:fs'
import path from 'node:path'

const MAX_LOG_SIZE = 1024 * 1024 // 1MB

type LogLevel = 'info' | 'warn' | 'error'

let logFile = ''
let stream: fs.WriteStream | null = null

function rotateIfNeeded(): void {
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size >= MAX_LOG_SIZE) {
      fs.renameSync(logFile, `${logFile}.old`)
    }
  } catch {
    // 滚动失败不阻塞写入
  }
}

export function initLogger(userDataDir: string): void {
  const dir = path.join(userDataDir, 'logs')
  fs.mkdirSync(dir, { recursive: true })
  logFile = path.join(dir, 'ireader.log')
  rotateIfNeeded()
  stream = fs.createWriteStream(logFile, { flags: 'a' })
  info('---- app start ----')
}

export function logFilePath(): string {
  return logFile
}

function write(level: LogLevel, message: string): void {
  if (!stream) return
  const line = `[${new Date().toISOString()}] [${level}] ${message}\n`
  try {
    stream.write(line)
    if (stream.bytesWritten >= MAX_LOG_SIZE) {
      // 当前文件写满：关闭后滚动并重开
      stream.end()
      stream = null
      rotateIfNeeded()
      stream = fs.createWriteStream(logFile, { flags: 'a' })
    }
  } catch {
    // 日志写入失败静默，不影响应用
  }
}

export function info(message: string): void {
  write('info', message)
}

export function warn(message: string): void {
  write('warn', message)
}

export function error(message: string): void {
  write('error', message)
}

/** 挂接进程级异常兜底：未捕获异常与 Promise 拒绝都落到日志 */
export function attachProcessErrorHandlers(): void {
  process.on('uncaughtException', (err) => {
    error(`uncaughtException: ${err.stack ?? err.message}`)
  })
  process.on('unhandledRejection', (reason) => {
    const stack = reason instanceof Error ? reason.stack : String(reason)
    error(`unhandledRejection: ${stack}`)
  })
}
