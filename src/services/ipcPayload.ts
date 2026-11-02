// IPC 入参净化（纯函数）
// 对应设计文档 specs/20261103-封面单独成页失效修复与单本封面开关设计方案.md §4.2

/**
 * 深纯化为结构化克隆安全值。
 *
 * Electron 的 ipcRenderer.invoke 用结构化克隆序列化参数，而 Vue 的响应式对象是 Proxy：
 * 直接把 reactive 对象（或其浅拷贝里嵌套的嵌套对象）交给 IPC，会在渲染进程序列化阶段
 * 抛 `An object could not be cloned.`，请求根本到不了主进程，表现为「设置改了但没保存」。
 * toRaw 只解顶层，浅拷贝里的嵌套值仍是代理，因此统一走 JSON 往返。
 *
 * 注意：仅适用于只含 JSON 安全值（string / number / boolean / null / 数组 / 普通对象）
 * 的载荷；Date、Buffer 等非 JSON 值不会被保留，值为 undefined 的字段会被丢弃。
 * @param value 待发送给主进程的载荷
 * @returns 与入参等值、且可被结构化克隆的普通对象
 */
export function toIpcPayload<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
