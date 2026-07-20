<template>
  <el-container class="layout-shell" data-testid="layout-shell">
    <el-aside class="layout-sidebar" :class="{ 'is-collapsed': sidebarCollapsed }" :width="sidebarCollapsed ? '0px' : `${sidebarWidth}px`" data-testid="layout-sidebar">
      <div class="sidebar-title">
        <span class="sidebar-title-text">HappyHome 管理</span>
        <button class="sidebar-collapse-button" type="button" title="收起侧边栏" @click="collapseSidebar">‹</button>
      </div>
      <div class="sidebar-scroll">
        <el-menu data-testid="layout-menu" router :default-active="activeMenuPath" background-color="#304156" text-color="#bfcbd9" active-text-color="#409EFF">
          <el-menu-item data-testid="menu-approval" index="/approval"><span>审批中心</span><span v-if="approvalTotal > 0" class="menu-badge">{{ approvalTotal }}</span></el-menu-item>
          <el-menu-item v-if="authStore.isSuperAdmin" data-testid="menu-content-audit" index="/content-audit">内容审核</el-menu-item>
          <el-menu-item v-if="authStore.isSuperAdmin" data-testid="menu-collaboration-templates" index="/collaboration-templates">协作模板</el-menu-item>

          <li class="menu-section-label">社区管理</li>
          <el-menu-item data-testid="menu-communities" index="/communities">社区总览</el-menu-item>
          <li v-for="community in navigation.communities" :key="community.id" class="community-navigation-tree" :data-community-id="community.id">
            <button class="community-row" type="button" @click="toggleCommunity(community.id)">
              <span class="community-chevron">{{ navigation.expandedSet.has(community.id) ? '▾' : '▸' }}</span>
              <span class="community-name">{{ community.name }}</span>
              <span v-if="community.pendingMemberCount" class="menu-badge">{{ community.pendingMemberCount }}</span>
            </button>
            <el-menu-item v-if="navigation.expandedSet.has(community.id)" :index="`/sections/${community.id}`">板块管理</el-menu-item>
            <el-menu-item v-if="navigation.expandedSet.has(community.id)" :index="`/posts/${community.id}`">帖子管理</el-menu-item>
            <el-menu-item v-if="navigation.expandedSet.has(community.id)" :index="`/archive-topics/${community.id}`">沉淀区话题</el-menu-item>
            <el-menu-item v-if="navigation.expandedSet.has(community.id)" :index="`/members/${community.id}`">成员管理<span v-if="community.pendingMemberCount" class="menu-badge">{{ community.pendingMemberCount }}</span></el-menu-item>
            <el-menu-item v-if="navigation.expandedSet.has(community.id)" :index="`/community-settings/${community.id}`">社区设置</el-menu-item>
          </li>

          <template v-if="authStore.isSuperAdmin">
            <li class="menu-section-label system-management-toggle" data-testid="system-management-toggle" @click="toggleSystemManagement">
              <span>系统管理</span><span>{{ systemManagementExpanded ? '▾' : '▸' }}</span>
            </li>
            <el-menu-item v-if="systemManagementExpanded" data-testid="menu-admin-accounts" index="/admin-accounts">管理员管理</el-menu-item>
            <el-menu-item v-if="systemManagementExpanded" data-testid="menu-guest-intro-config" index="/guest-intro-config">样板社群引导</el-menu-item>
          </template>
        </el-menu>
      </div>
      <div class="sidebar-resizer" title="拖拽调整侧边栏宽度" @pointerdown="startSidebarResize" />
    </el-aside>
    <button v-if="sidebarCollapsed" class="sidebar-expand-button" type="button" data-testid="sidebar-expand-button" @click="expandSidebar">展开菜单 ›</button>
    <el-main class="layout-main" data-testid="layout-main">
      <div class="user-bar" data-testid="user-bar">
        <span class="user-info"><el-tag size="small" :type="authStore.isSuperAdmin ? 'danger' : 'primary'">{{ authStore.isSuperAdmin ? '超级管理员' : '社区管理员' }}</el-tag><span class="user-name">{{ authStore.username }}</span></span>
        <el-button size="small" data-testid="user-logout" @click="handleLogout">退出登录</el-button>
      </div>
      <router-view v-slot="{ Component }">
        <component :is="Component" :key="routeViewKey" @approval-changed="refreshNavigation" />
      </router-view>
    </el-main>
  </el-container>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useCommunityNavigationStore } from '../stores/communityNavigation'
import { approvalApi } from '../api/cloud'

const SIDEBAR_WIDTH_KEY = 'happyhome.admin.sidebar.width.v1'
const SIDEBAR_COLLAPSED_KEY = 'happyhome.admin.sidebar.collapsed.v1'
const SYSTEM_EXPANDED_KEY = 'happyhome.admin.system.expanded.v1'
const SIDEBAR_DEFAULT_WIDTH = 260
const SIDEBAR_MIN_WIDTH = 232
const SIDEBAR_MAX_WIDTH = 360
const authStore = useAuthStore()
const navigation = useCommunityNavigationStore()
const router = useRouter()
const route = useRoute()
const pendingCommunityCount = ref(0)
const pendingMemberCount = ref(0)
const approvalTotal = computed(() => pendingCommunityCount.value + pendingMemberCount.value)
const sidebarWidth = ref(loadSidebarWidth())
const sidebarCollapsed = ref(loadSidebarCollapsed())
const resizingSidebar = ref(false)
const suppressAutoExpandCommunityId = ref('')
const systemManagementExpanded = ref(typeof window !== 'undefined' && window.localStorage.getItem(SYSTEM_EXPANDED_KEY) === '1')
const routeViewKey = computed(() => `${String(route.name || route.path)}:${String(route.params.communityId || '')}:${String(route.params.sectionId || '')}:${String(route.params.postId || '')}`)
const activeMenuPath = computed(() => {
  const id = String(route.params.communityId || '')
  if ((route.name === 'post-create-admin' || route.name === 'post-edit-admin') && id) return `/posts/${id}`
  if (route.name === 'widgets' && id) return `/sections/${id}`
  return route.path
})

onMounted(() => {
  if (authStore.token && !authStore.role) void authStore.fetchMe()
  void refreshNavigation()
})
onBeforeUnmount(stopSidebarResize)
watch(() => route.fullPath, () => {
  const communityId = String(route.params.communityId || '')
  if (communityId && suppressAutoExpandCommunityId.value === communityId) suppressAutoExpandCommunityId.value = ''
  else ensureCurrentCommunityExpanded()
  void loadApprovalSummary()
})

async function refreshNavigation() { await Promise.all([navigation.refresh(), loadApprovalSummary()]); ensureCurrentCommunityExpanded() }
async function loadApprovalSummary() {
  if (!authStore.isAuthenticated) return
  try { const res = await approvalApi.summary(); pendingCommunityCount.value = Number(res.pendingCommunityCount || 0); pendingMemberCount.value = Number(res.pendingMemberCount || 0) }
  catch { pendingCommunityCount.value = 0; pendingMemberCount.value = 0 }
}
function ensureCurrentCommunityExpanded() { navigation.ensureExpanded(String(route.params.communityId || '')) }
function toggleCommunity(communityId: string) {
  const targetPath = `/posts/${communityId}`
  const collapsing = navigation.expandedSet.has(communityId)
  navigation.toggle(communityId)
  if (collapsing && route.path !== targetPath) suppressAutoExpandCommunityId.value = communityId
  void router.push({ name: 'posts', params: { communityId } })
}
function toggleSystemManagement() { systemManagementExpanded.value = !systemManagementExpanded.value; window.localStorage.setItem(SYSTEM_EXPANDED_KEY, systemManagementExpanded.value ? '1' : '0') }
async function handleLogout() { await authStore.logout(); router.push({ name: 'login' }) }
function clampSidebarWidth(value: number) { return Number.isFinite(value) ? Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value))) : SIDEBAR_DEFAULT_WIDTH }
function loadSidebarWidth() { return typeof window === 'undefined' ? SIDEBAR_DEFAULT_WIDTH : clampSidebarWidth(Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY) || SIDEBAR_DEFAULT_WIDTH)) }
function loadSidebarCollapsed() { return typeof window !== 'undefined' && window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1' }
function persistSidebarState() { window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth.value)); window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed.value ? '1' : '0') }
function collapseSidebar() { sidebarCollapsed.value = true; persistSidebarState() }
function expandSidebar() { sidebarCollapsed.value = false; persistSidebarState() }
function startSidebarResize(event: PointerEvent) { if (sidebarCollapsed.value) return; event.preventDefault(); resizingSidebar.value = true; window.addEventListener('pointermove', resizeSidebar); window.addEventListener('pointerup', stopSidebarResize); window.addEventListener('pointercancel', stopSidebarResize) }
function resizeSidebar(event: PointerEvent) { if (resizingSidebar.value) sidebarWidth.value = clampSidebarWidth(event.clientX) }
function stopSidebarResize() { if (!resizingSidebar.value) return; resizingSidebar.value = false; window.removeEventListener('pointermove', resizeSidebar); window.removeEventListener('pointerup', stopSidebarResize); window.removeEventListener('pointercancel', stopSidebarResize); persistSidebarState() }
</script>

<style scoped>
.layout-shell{min-height:100vh}.layout-sidebar{position:relative;overflow:visible;background:#304156;transition:width .16s ease}.layout-sidebar.is-collapsed{overflow:hidden}.sidebar-title{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:20px 12px 16px 20px;color:#fff;font-size:18px;font-weight:700}.sidebar-title-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sidebar-scroll{height:calc(100vh - 66px);overflow-y:auto;overflow-x:hidden}.sidebar-collapse-button,.sidebar-expand-button{border:1px solid rgba(255,255,255,.24);border-radius:999px;background:rgba(255,255,255,.1);color:#fff;cursor:pointer}.sidebar-collapse-button{width:26px;height:26px;font-size:20px}.sidebar-resizer{position:absolute;top:0;right:-4px;z-index:12;width:8px;height:100%;cursor:col-resize}.sidebar-expand-button{position:fixed;top:14px;left:8px;z-index:30;padding:6px 10px;background:#304156}.layout-main{min-width:0}.user-bar{display:flex;justify-content:flex-end;align-items:center;gap:12px;padding:8px 16px;border-bottom:1px solid #ebeef5;margin-bottom:16px}.user-info{display:flex;align-items:center;gap:8px}.user-name{font-size:14px;color:#606266}.menu-badge{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;margin-left:8px;padding:0 5px;border-radius:999px;background:#f56c6c;color:#fff;font-size:12px;line-height:18px}.menu-section-label{display:flex;align-items:center;justify-content:space-between;padding:18px 20px 8px;color:#8492a6;font-size:12px;letter-spacing:.08em}.system-management-toggle{cursor:pointer}.system-management-toggle:hover{color:#fff}.community-navigation-tree{list-style:none}.community-row{display:flex;align-items:center;width:100%;height:44px;padding:0 20px;border:0;background:transparent;color:#d7dde8;cursor:pointer;text-align:left}.community-row:hover{background:#263445;color:#fff}.community-chevron{width:20px}.community-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.community-navigation-tree :deep(.el-menu-item){height:42px;padding-left:52px!important}
</style>
