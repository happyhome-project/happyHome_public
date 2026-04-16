import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('../views/Login.vue') },
    {
      path: '/',
      component: () => import('../views/Layout.vue'),
      meta: { requiresAuth: true },
      redirect: '/approval',
      children: [
        { path: 'approval', component: () => import('../views/SuperAdmin/CommunityApproval.vue') },
        { path: 'communities', component: () => import('../views/CommunityAdmin/CommunityList.vue') },
        { path: 'sections/:communityId', component: () => import('../views/CommunityAdmin/SectionList.vue') },
        { path: 'widgets/:sectionId', component: () => import('../views/CommunityAdmin/WidgetEditor.vue') },
        { path: 'members/:communityId', component: () => import('../views/CommunityAdmin/MemberApproval.vue') },
      ]
    },
    // Fallback to avoid rendering a blank page on unknown URLs.
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ]
})

router.beforeEach((to) => {
  const isAuthenticated = !!localStorage.getItem('token')
  if (to.meta.requiresAuth && !isAuthenticated) {
    return '/login'
  }
})

export default router
