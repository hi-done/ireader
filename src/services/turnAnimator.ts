// 卷曲覆盖层单例：全应用最多一条卷曲动画，并统一「自然结束 / 被取消」两种收尾
// 对应设计文档《翻页动画快速翻页响应优化设计方案-20261020》§5.2

import { playPageCurl, type PageCurlOptions } from './pageCurl'

export interface TurnCurlHandle {
  cancel: () => void
  /** 正常结束或被取消时兑现一次 */
  done: Promise<void>
}

/** 当前在播的卷曲；null = 无 */
interface ActiveTurn {
  cancel: () => void
  /** 兑现 done 并回调调用方 onDone（幂等） */
  settle: () => void
}
let active: ActiveTurn | null = null

/**
 * 播放卷曲（先揭除上一条）。`options.onDone` 在自然结束或取消时调用一次。
 * 无 2D 上下文时底层会同步结束，此时不登记为「在播」。
 */
export function playTurnCurl(options: PageCurlOptions): TurnCurlHandle {
  cancelTurnCurl() // 单例：新动画必须从干净覆盖层开始

  let ended = false
  let settle!: () => void
  const done = new Promise<void>((resolve) => {
    settle = () => {
      if (ended) return
      ended = true
      resolve()
      options.onDone?.()
    }
  })

  let entry: ActiveTurn | null = null
  const handle = playPageCurl({
    ...options,
    onDone: () => {
      if (active === entry) active = null
      settle()
    },
  })

  entry = { cancel: handle.cancel, settle }
  if (!ended) active = entry // 同步结束时（无 2D 上下文）不登记

  return {
    cancel: () => {
      if (active === entry) active = null
      handle.cancel()
    },
    done,
  }
}

/** 立即揭除当前卷曲（幂等）；底层页面已是动画终点 */
export function cancelTurnCurl(): void {
  const current = active
  if (!current) return
  active = null
  current.cancel()
}

/** 是否有卷曲在播 */
export function isTurnCurlActive(): boolean {
  return active !== null
}
