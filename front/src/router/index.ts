import { createRouter, createWebHistory } from 'vue-router'
import Chat from '../components/chat.vue'
import Werewolf from '../views/Werewolf.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'chat',
      component: Chat,
      meta: { title: 'AI 聊天' },
    },
    {
      path: '/werewolf',
      name: 'werewolf',
      component: Werewolf,
      meta: { title: '狼人杀' },
    },
  ],
})

router.afterEach((to) => {
  const title = (to.meta.title as string) || 'front'
  document.title = title
})

export default router
