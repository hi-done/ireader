import { createRouter, createWebHashHistory } from 'vue-router'
import { exitFullscreen, isFullscreen } from '../services/fullscreen'
import { isFullscreenOutsideReader } from '../services/fullscreenRoute'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'library',
      component: () => import('../views/LibraryView.vue'),
    },
    {
      path: '/reader/:bookId',
      name: 'reader',
      component: () => import('../views/ReaderView.vue'),
      props: true,
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/SettingsView.vue'),
    },
    {
      path: '/stats',
      name: 'stats',
      component: () => import('../views/ReadingStatsView.vue'),
    },
    {
      path: '/manage',
      name: 'manage',
      component: () => import('../views/LibraryManageView.vue'),
    },
    {
      path: '/ai-config',
      name: 'aiConfig',
      component: () => import('../views/AiConfigView.vue'),
    },
  ],
})

// 全屏只属于阅读场景：目标路由不是阅读页就收尾，否则返回主页后会停在原生全屏，
// 而全屏下窗口没有最小化 / 最大化按钮可退出。
// 用 beforeEach 而非 afterEach：退出请求与导航并行发出，避免主页先按全屏尺寸渲染一帧。
router.beforeEach((to) => {
  if (isFullscreenOutsideReader(to.name, isFullscreen.value)) void exitFullscreen()
})

export default router
