import { createRouter, createWebHashHistory, createWebHistory } from 'vue-router'
import { ElMessage } from 'element-plus/es/components/message/index'
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
        { path: 'approval', name: 'approval', component: () => import('../views/SuperAdmin/ApprovalCenter.vue') },
        { path: 'community-approval', name: 'community-approval', component: () => import('../views/SuperAdmin/CommunityApproval.vue'), meta: { requiresRole: 'superAdmin' } },
        { path: 'disabled-communities', name: 'disabled-communities', component: () => import('../views/SuperAdmin/DisabledCommunityList.vue'), meta: { requiresRole: 'superAdmin' } },
        { path: 'admin-accounts', name: 'admin-accounts', component: () => import('../views/SuperAdmin/AdminAccountList.vue'), meta: { requiresRole: 'superAdmin' } },
        { path: 'content-audit', name: 'content-audit', component: () => import('../views/SuperAdmin/ContentAudit.vue'), meta: { requiresRole: 'superAdmin' } },
        { path: 'guest-intro-config', name: 'guest-intro-config', component: () => import('../views/SuperAdmin/GuestIntroConfig.vue'), meta: { requiresRole: 'superAdmin' } },
        { path: 'collaboration-templates', name: 'collaboration-templates', component: () => import('../views/SuperAdmin/CollaborationTemplateList.vue'), meta: { requiresRole: 'superAdmin' } },
        { path: 'communities', name: 'communities', component: () => import('../views/CommunityAdmin/CommunityList.vue') },
        { path: 'communities/new', name: 'community-create', component: () => import('../views/CommunityAdmin/CommunityCreate.vue') },
        { path: 'sections/:communityId', name: 'sections', component: () => import('../views/CommunityAdmin/SectionList.vue') },
        { path: 'archive-topics/:communityId', name: 'archive-topics', component: () => import('../views/CommunityAdmin/ArchiveTopics.vue') },
        { path: 'widgets/:sectionId', name: 'widgets', component: () => import('../views/CommunityAdmin/WidgetEditor.vue') },
        { path: 'members/:communityId', name: 'members', component: () => import('../views/CommunityAdmin/MemberApproval.vue') },
        { path: 'posts/:communityId', name: 'posts', component: () => import('../views/CommunityAdmin/PostManagement.vue') },
        { path: 'posts/:communityId/new', name: 'post-create-admin', component: () => import('../views/CommunityAdmin/PostCreateAdmin.vue') },
        { path: 'posts/:communityId/:postId/edit', name: 'post-edit-admin', component: () => import('../views/CommunityAdmin/PostEditAdmin.vue') },
        { path: 'community-settings/:communityId', name: 'community-settings', component: () => import('../views/CommunityAdmin/CommunitySettings.vue') },
      ]
    },
    // Fallback to avoid rendering a blank page on unknown URLs.
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ]
})

router.onError((error) => {
  const message = String(error?.message || error || '')
  const isChunkLoadFailure =
    message.includes('Failed to fetch dynamically imported module') ||
    message.includes('Importing a module script failed') ||
    message.includes('error loading dynamically imported module') ||
    message.includes('Unable to preload CSS')
  if (!isChunkLoadFailure) return

  const reloadKey = `happyhome-admin-reloaded:${location.pathname}${location.search}`
  if (sessionStorage.getItem(reloadKey)) {
    ElMessage.error('后台页面资源已更新，请手动刷新后重试')
    return
  }
  sessionStorage.setItem(reloadKey, '1')
  ElMessage.info('后台已更新，正在刷新页面...')
  location.reload()
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
