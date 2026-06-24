<template>
  <el-container class="layout-shell" data-testid="layout-shell">
    <el-aside
      class="layout-sidebar"
      :class="{ 'is-collapsed': sidebarCollapsed }"
      :width="sidebarCollapsed ? '0px' : `${sidebarWidth}px`"
      data-testid="layout-sidebar"
    >
      <div class="sidebar-title">
        <span class="sidebar-title-text">HappyHome 管理</span>
        <button class="sidebar-collapse-button" type="button" title="收起侧边栏" @click="collapseSidebar">
          ‹
        </button>
      </div>
      <el-menu
        data-testid="layout-menu"
        router
        :default-active="$route.path"
        background-color="#304156"
        text-color="#bfcbd9"
        active-text-color="#409EFF"
      >
        <el-menu-item data-testid="menu-approval" index="/approval">
          <span>审批中心</span>
          <span v-if="approvalTotal > 0" class="menu-badge">{{ approvalTotal }}</span>
        </el-menu-item>
        <el-menu-item data-testid="menu-communities" index="/communities">
          {{ authStore.isSuperAdmin ? '社区管理' : '我的社区' }}
        </el-menu-item>
        <el-menu-item data-testid="menu-community-create" index="/communities/new">
          创建社区
        </el-menu-item>
        <el-menu-item
          v-if="authStore.isSuperAdmin"
          data-testid="menu-disabled-communities"
          index="/disabled-communities"
        >已禁用社区</el-menu-item>
        <el-menu-item
          v-if="authStore.isSuperAdmin"
          data-testid="menu-admin-accounts"
          index="/admin-accounts"
        >管理员管理</el-menu-item>
        <el-menu-item
          v-if="authStore.isSuperAdmin"
          data-testid="menu-content-audit"
          index="/content-audit"
        >内容审核</el-menu-item>
        <el-menu-item
          v-if="authStore.isSuperAdmin"
          data-testid="menu-guest-intro-config"
          index="/guest-intro-config"
        >样板社群引导</el-menu-item>
      </el-menu>
      <div
        class="sidebar-resizer"
        title="拖拽调整侧边栏宽度"
        @pointerdown="startSidebarResize"
      />
    </el-aside>
    <button
      v-if="sidebarCollapsed"
      class="sidebar-expand-button"
      type="button"
      data-testid="sidebar-expand-button"
      @click="expandSidebar"
    >
      展开菜单 ›
    </button>
    <el-main class="layout-main" data-testid="layout-main">
      <div class="user-bar" data-testid="user-bar">
        <span class="user-info">
          <el-tag size="small" :type="authStore.isSuperAdmin ? 'danger' : 'primary'">
            {{ authStore.isSuperAdmin ? '超级管理员' : '社区管理员' }}
          </el-tag>
          <span class="user-name">{{ authStore.username }}</span>
        </span>
        <el-button size="small" @click="handleLogout" data-testid="user-logout">退出登录</el-button>
      </div>
      <router-view />
    </el-main>
  </el-container>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { approvalApi } from '../api/cloud'

const SIDEBAR_WIDTH_KEY = 'happyhome.admin.sidebar.width.v1'
const SIDEBAR_COLLAPSED_KEY = 'happyhome.admin.sidebar.collapsed.v1'
const SIDEBAR_DEFAULT_WIDTH = 220
const SIDEBAR_MIN_WIDTH = 96
const SIDEBAR_MAX_WIDTH = 360

const authStore = useAuthStore()
const router = useRouter()
const pendingCommunityCount = ref(0)
const pendingMemberCount = ref(0)
const approvalTotal = computed(() => pendingCommunityCount.value + pendingMemberCount.value)
const sidebarWidth = ref(loadSidebarWidth())
const sidebarCollapsed = ref(loadSidebarCollapsed())
const resizingSidebar = ref(false)

onMounted(() => {
  // 页面刷新后若有 token 但 role 缺失，尝试向后端拉身份回填
  if (authStore.token && !authStore.role) authStore.fetchMe()
  void loadApprovalSummary()
})

onBeforeUnmount(() => {
  stopSidebarResize()
})

watch(() => router.currentRoute.value.fullPath, () => {
  void loadApprovalSummary()
})

async function loadApprovalSummary() {
  if (!authStore.isAuthenticated) return
  try {
    const res = await approvalApi.summary()
    pendingCommunityCount.value = Number(res.pendingCommunityCount || 0)
    pendingMemberCount.value = Number(res.pendingMemberCount || 0)
  } catch {
    pendingCommunityCount.value = 0
    pendingMemberCount.value = 0
  }
}

async function handleLogout() {
  await authStore.logout()
  router.push({ name: 'login' })
}

function clampSidebarWidth(value: number) {
  if (!Number.isFinite(value)) return SIDEBAR_DEFAULT_WIDTH
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)))
}

function loadSidebarWidth() {
  if (typeof window === 'undefined') return SIDEBAR_DEFAULT_WIDTH
  return clampSidebarWidth(Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY) || SIDEBAR_DEFAULT_WIDTH))
}

function loadSidebarCollapsed() {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
}

function persistSidebarState() {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth.value))
  window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed.value ? '1' : '0')
}

function collapseSidebar() {
  sidebarCollapsed.value = true
  persistSidebarState()
}

function expandSidebar() {
  sidebarCollapsed.value = false
  sidebarWidth.value = clampSidebarWidth(sidebarWidth.value || SIDEBAR_DEFAULT_WIDTH)
  persistSidebarState()
}

function startSidebarResize(event: PointerEvent) {
  if (sidebarCollapsed.value) return
  event.preventDefault()
  resizingSidebar.value = true
  window.addEventListener('pointermove', resizeSidebar)
  window.addEventListener('pointerup', stopSidebarResize)
  window.addEventListener('pointercancel', stopSidebarResize)
}

function resizeSidebar(event: PointerEvent) {
  if (!resizingSidebar.value) return
  sidebarWidth.value = clampSidebarWidth(event.clientX)
}

function stopSidebarResize() {
  if (!resizingSidebar.value) return
  resizingSidebar.value = false
  window.removeEventListener('pointermove', resizeSidebar)
  window.removeEventListener('pointerup', stopSidebarResize)
  window.removeEventListener('pointercancel', stopSidebarResize)
  persistSidebarState()
}
</script>

<style scoped>
.layout-shell {
  min-height: 100vh;
}
.layout-sidebar {
  position: relative;
  overflow: visible;
  background: #304156;
  transition: width 0.16s ease;
}
.layout-sidebar.is-collapsed {
  overflow: hidden;
}
.sidebar-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  padding: 20px 12px 20px 20px;
  color: #fff;
  font-size: 18px;
  font-weight: bold;
}
.sidebar-title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sidebar-collapse-button,
.sidebar-expand-button {
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  cursor: pointer;
}
.sidebar-collapse-button {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  font-size: 20px;
  line-height: 22px;
}
.sidebar-collapse-button:hover,
.sidebar-expand-button:hover {
  background: rgba(255, 255, 255, 0.18);
}
.sidebar-resizer {
  position: absolute;
  top: 0;
  right: -4px;
  z-index: 12;
  width: 8px;
  height: 100%;
  cursor: col-resize;
}
.sidebar-resizer::after {
  content: '';
  position: absolute;
  top: 0;
  left: 3px;
  width: 2px;
  height: 100%;
  background: transparent;
}
.sidebar-resizer:hover::after {
  background: rgba(64, 158, 255, 0.8);
}
.sidebar-expand-button {
  position: fixed;
  top: 14px;
  left: 8px;
  z-index: 30;
  padding: 6px 10px;
  background: #304156;
  font-size: 13px;
}
.layout-main {
  min-width: 0;
}
.user-bar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid #ebeef5;
  margin-bottom: 16px;
}
.user-info { display: flex; align-items: center; gap: 8px; }
.user-name { font-size: 14px; color: #606266; }
:deep(.el-menu-item[data-testid="menu-approval"]) {
  display: flex;
  align-items: center;
}
.menu-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  margin-left: 8px;
  padding: 0 5px;
  border-radius: 999px;
  background: #f56c6c;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
  box-sizing: border-box;
}
</style>
