// 补播遮罩单例：连翻瞬切期间把阅读区冻结在连翻起点画面，
// 保证「停手补播动画的起点 = 屏幕当前画面」，避免「先闪目标页再播旧页卷曲」
// 对应设计文档《连翻瞬切先闪目标页遮罩修复设计方案-20261102》§4.1

/** 遮罩归属：turn = 单次动画的冻结帧；burst = 连翻会话的补播遮罩（互不误揭） */
export type TurnCoverOwner = 'turn' | 'burst'

export interface TurnCoverOptions {
  /** 定位参考（与 pageCurl 的 container 一致：.reader-view，需 position: relative） */
  container: HTMLElement
  /** 覆盖区域（与 pageCurl 的 target 一致） */
  target: HTMLElement
  /** 起点画面快照（物理像素 + style 逻辑尺寸，与 pageCurl 的 from 同源） */
  canvas: HTMLCanvasElement
  owner: TurnCoverOwner
}

/** 当前遮罩；null = 无 */
let current: { el: HTMLCanvasElement; owner: TurnCoverOwner } | null = null

/**
 * 上屏遮罩（先揭除旧遮罩，全局单例）。几何按 target 当前 bbox 锁定，
 * 连翻期不跟随内容滚动——「冻结」语义由锁定几何保证。
 */
export function attachTurnCover(options: TurnCoverOptions): void {
  removeTurnCover() // 单例：新遮罩必须从干净覆盖层开始
  const { container, target, canvas, owner } = options
  const containerRect = container.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  canvas.style.position = 'absolute'
  canvas.style.left = `${targetRect.left - containerRect.left}px`
  canvas.style.top = `${targetRect.top - containerRect.top}px`
  canvas.style.width = `${targetRect.width}px`
  canvas.style.height = `${targetRect.height}px`
  canvas.style.zIndex = '1' // 与卷曲覆盖层同级（覆盖层后 append 故在其上）；低于控制栏 z2
  canvas.style.pointerEvents = 'none'
  container.appendChild(canvas)
  current = { el: canvas, owner }
}

/**
 * 揭除遮罩（幂等）。
 * @param owner 只揭除该归属的遮罩（不传 = 无条件）
 * @param el 只揭除该画布的遮罩（不传 = 不校验）；用于双 rAF 等迟到回调，
 *           避免揭掉后续新会话刚贴上的遮罩
 */
export function removeTurnCover(owner?: TurnCoverOwner, el?: HTMLCanvasElement): void {
  if (!current) return
  if (owner && current.owner !== owner) return
  if (el && current.el !== el) return
  current.el.remove()
  current = null
}

/** 是否有遮罩在屏（连翻补播闸门的 covered 判据） */
export function isTurnCoverActive(): boolean {
  return current !== null
}

/** 双 rAF：等一帧提交后的合成输出更新；卷曲首帧画出后揭罩才无跳变 */
export function doubleRaf(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}
