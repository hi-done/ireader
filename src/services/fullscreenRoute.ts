// 全屏归属口径（纯逻辑）：全屏只属于阅读页，离开阅读页就该退出全屏
// 路由守卫与全局 Esc 兜底共用同一判定，避免两处条件各写一份后漂移
// 对应设计文档《20261105-阅读页返回自动退出全屏设计方案》§4

/** 阅读页路由名（src/router/index.ts 的 name: 'reader'） */
const READER_ROUTE = 'reader'

/**
 * 排除阅读页后，当前是否仍处于全屏。
 * @param routeName 当前（或即将进入）路由的 name，即 vue-router 的 RouteRecordName
 * @param fullscreen 窗口真实全屏态（services/fullscreen 的 isFullscreen，非 document.fullscreenElement）
 * @returns 需要退出全屏时为 true：非阅读页且处于全屏
 */
export function isFullscreenOutsideReader(
  routeName: string | symbol | null | undefined,
  fullscreen: boolean
): boolean {
  if (!fullscreen) return false
  // 阅读页内切书 / 刷新 / 加载失败态都仍在 reader，不能误退全屏
  return routeName !== READER_ROUTE
}
