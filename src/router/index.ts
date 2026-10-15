import { createRouter, createWebHashHistory } from 'vue-router'

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
  ],
})

export default router
