import { createRouter, createWebHashHistory, createWebHistory } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '../stores/auth'

const router = createRouter({
  history: import.meta.env.VITE_ROUTER_MODE === 'hash' ? createWebHashHistory() : createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('../views/Login.vue') },
    {
      path: '/',
      component: () => import('../views/Layout.vue'),
      meta: { requiresAuth: true },
      redirect: '/communities',
      children: [
        { path: 'approval', name: 'approval', component: () => import('../views/SuperAdmin/CommunityApproval.vue'), meta: { requiresRole: 'superAdmin' } },
        { path: 'disabled-communities', name: 'disabled-communities', component: () => import('../views/SuperAdmin/DisabledCommunityList.vue'), meta: { requiresRole: 'superAdmin' } },
        { path: 'admin-accounts', name: 'admin-accounts', component: () => import('../views/SuperAdmin/AdminAccountList.vue'), meta: { requiresRole: 'superAdmin' } },
        { path: 'communities', name: 'communities', component: () => import('../views/CommunityAdmin/CommunityList.vue') },
        { path: 'communities/new', name: 'community-create', component: () => import('../views/CommunityAdmin/CommunityCreate.vue') },
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
  const auth = useAuthStore()
  if (to.meta.requiresAuth && !auth.isAuthenticated) return '/login'
  const required = to.meta.requiresRole as 'superAdmin' | undefined
  if (required === 'superAdmin' && !auth.isSuperAdmin) {
    ElMessage.warning('该页面仅限超级管理员访问')
    return auth.isAuthenticated ? '/' : '/login'
  }
  if (to.name === 'login' && auth.isAuthenticated) return '/'
})

export default router
