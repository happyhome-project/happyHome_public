import { createRouter, createWebHashHistory, createWebHistory } from 'vue-router'

const router = createRouter({
  history: import.meta.env.VITE_ROUTER_MODE === 'hash' ? createWebHashHistory() : createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('../views/Login.vue') },
    {
      path: '/',
      component: () => import('../views/Layout.vue'),
      meta: { requiresAuth: true },
      redirect: '/approval',
      children: [
        { path: 'approval', name: 'approval', component: () => import('../views/SuperAdmin/CommunityApproval.vue') },
        { path: 'communities', name: 'communities', component: () => import('../views/CommunityAdmin/CommunityList.vue') },
        { path: 'disabled-communities', name: 'disabled-communities', component: () => import('../views/SuperAdmin/DisabledCommunityList.vue') },
        { path: 'sections/:communityId', name: 'sections', component: () => import('../views/CommunityAdmin/SectionList.vue') },
        { path: 'widgets/:sectionId', name: 'widgets', component: () => import('../views/CommunityAdmin/WidgetEditor.vue') },
        { path: 'members/:communityId', name: 'members', component: () => import('../views/CommunityAdmin/MemberApproval.vue') },
        { path: 'posts/:communityId', name: 'posts', component: () => import('../views/CommunityAdmin/PostManagement.vue') },
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
