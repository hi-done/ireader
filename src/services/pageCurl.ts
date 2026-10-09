// 仿真纸张翻页动画（折缝推进 + 翻起页原样平移 + 投影/暗化/边缘高光）
// 以覆盖层 canvas 逐帧绘制，不接管布局与交互：动画结束后底下显示层已就位，无缝揭除
// 内容保真约束：翻起页 1:1 绘制——不镜像、不压缩、高度恒定，只做位移与光影变化

export interface PageCurlOptions {
  /** 定位参考（overlay 的 offsetParent，需有 position） */
  container: HTMLElement
  /** 被动画覆盖的内容区域（翻页发生在它的 bbox 内） */
  target: HTMLElement
  /** 旧页组合成快照（物理像素 = CSS × dpr，且带有 style.width/height） */
  from: HTMLCanvasElement
  /** 新页组合成快照 */
  to: HTMLCanvasElement
  /** 视觉方向：true = 从右往左翻（旧页右缘掀起向左），false = 从左往右 */
  fromRight: boolean
  duration?: number
  onDone?: () => void
}

export interface PageCurlHandle {
  cancel: () => void
}

const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

function cssSize(canvas: HTMLCanvasElement): { w: number; h: number } {
  return {
    w: parseFloat(canvas.style.width) || canvas.width,
    h: parseFloat(canvas.style.height) || canvas.height,
  }
}

export function playPageCurl(opts: PageCurlOptions): PageCurlHandle {
  const { container, target, from, to, fromRight, onDone } = opts
  const duration = opts.duration ?? 450
  const dpr = window.devicePixelRatio || 1

  const containerRect = container.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const w = targetRect.width
  const h = targetRect.height

  const overlay = document.createElement('canvas')
  overlay.width = Math.max(1, Math.round(w * dpr))
  overlay.height = Math.max(1, Math.round(h * dpr))
  overlay.style.position = 'absolute'
  overlay.style.left = `${targetRect.left - containerRect.left}px`
  overlay.style.top = `${targetRect.top - containerRect.top}px`
  overlay.style.width = `${w}px`
  overlay.style.height = `${h}px`
  overlay.style.zIndex = '5'
  overlay.style.pointerEvents = 'none'
  container.appendChild(overlay)

  const ctx = overlay.getContext('2d')
  if (!ctx) {
    overlay.remove()
    onDone?.()
    return { cancel: () => undefined }
  }
  ctx.scale(dpr, dpr)

  let raf = 0
  let finished = false
  const start = performance.now()

  const finish = () => {
    if (finished) return
    finished = true
    cancelAnimationFrame(raf)
    overlay.remove()
    onDone?.()
  }

  const drawBmp = (bmp: HTMLCanvasElement) => {
    const { w: cw, h: ch } = cssSize(bmp)
    ctx.drawImage(bmp, 0, 0, cw, ch)
  }

  const frame = (now: number) => {
    if (finished) return
    const t = Math.min(1, (now - start) / duration)
    const e = easeInOutCubic(t)

    ctx.clearRect(0, 0, w, h)

    // 方向：forward = 从右往左翻（旧页右段掀起向左盖）；backward 相反
    const forward = fromRight
    // 折缝位置：forward 从右缘推进到左缘，backward 相反
    const fx = forward ? w * (1 - e) : w * e
    // 翻起块随折缝同步平移的位移；页面 1:1 绘制，无镜像无压缩
    const shift = forward ? w - fx : fx
    const restW = forward ? fx : w - fx // 未翻保留区宽度
    const liftW = w - restW // 翻起块宽度

    // 1. 底图：新页组（内容始终正向）
    drawBmp(to)

    // 2. 翻起块悬空投在底图上的软投影：贴折缝、向翻走方向羽化
    const castW = Math.min(120, shift * 0.45 + 30) * e
    if (castW > 2 && liftW > 0) {
      const cast = forward
        ? ctx.createLinearGradient(fx - castW, 0, fx, 0)
        : ctx.createLinearGradient(fx, 0, fx + castW, 0)
      cast.addColorStop(0, 'rgba(0,0,0,0)')
      cast.addColorStop(0.7, 'rgba(0,0,0,0.16)')
      cast.addColorStop(1, 'rgba(0,0,0,0.26)')
      ctx.fillStyle = cast
      ctx.fillRect(forward ? fx - castW : fx, 0, castW, h)
    }

    // 3. 旧页未翻起的保留区（源区域 = 画布坐标，快照与显示区同位同尺寸）
    if (restW > 0) {
      ctx.drawImage(
        from,
        forward ? 0 : from.width * (fx / w),
        0,
        from.width * (restW / w),
        from.height,
        forward ? 0 : fx,
        0,
        restW,
        h
      )
    }

    // 4. 翻起块：整块 1:1 原样向翻走方向平移（forward 向左 / backward 向右）
    if (liftW > 0) {
      ctx.drawImage(
        from,
        forward ? from.width * (fx / w) : 0,
        0,
        from.width * (liftW / w),
        from.height,
        forward ? fx - shift : fx,
        0,
        liftW,
        h
      )
    }

    if (liftW > 1) {
      // 5. 翻起块翘起背光：靠折缝略亮、靠自由边渐暗
      const dark = forward
        ? ctx.createLinearGradient(fx, 0, fx - shift, 0)
        : ctx.createLinearGradient(fx, 0, fx + shift, 0)
      dark.addColorStop(0, 'rgba(0,0,0,0.06)')
      dark.addColorStop(1, 'rgba(0,0,0,0.30)')
      ctx.fillStyle = dark
      ctx.fillRect(forward ? fx - shift : fx, 0, liftW, h)

      // 6. 折缝根部窄深影（页面弯折处的接缝暗线，画在保留区一侧）
      const seamW = Math.min(18, restW)
      if (seamW > 1) {
        const seam = forward
          ? ctx.createLinearGradient(fx, 0, fx - seamW, 0)
          : ctx.createLinearGradient(fx, 0, fx + seamW, 0)
        seam.addColorStop(0, 'rgba(0,0,0,0.35)')
        seam.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = seam
        ctx.fillRect(forward ? fx - seamW : fx, 0, seamW, h)
      }

      // 7. 折缝根部弯折反光（一条细亮带，体现纸面弯曲受光）
      const hiW = Math.min(22, restW)
      if (hiW > 1) {
        const sheen = forward
          ? ctx.createLinearGradient(fx, 0, fx - hiW, 0)
          : ctx.createLinearGradient(fx, 0, fx + hiW, 0)
        sheen.addColorStop(0, 'rgba(255,255,255,0)')
        sheen.addColorStop(0.5, 'rgba(255,255,255,0.12)')
        sheen.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = sheen
        ctx.fillRect(forward ? fx - hiW : fx, 0, hiW, h)
      }

      // 8. 翻起块自由边的前缘高光（纸边反光）
      const freeEdge = forward ? fx - shift : fx + shift
      const inView = forward ? freeEdge > 0.5 : freeEdge < w - 0.5
      if (inView) {
        ctx.fillStyle = 'rgba(255,255,255,0.3)'
        ctx.fillRect(forward ? freeEdge - 1.5 : freeEdge, 0, 1.5, h)
      }
    }

    if (t < 1) {
      raf = requestAnimationFrame(frame)
    } else {
      finish()
    }
  }

  raf = requestAnimationFrame(frame)

  return {
    cancel: finish,
  }
}
