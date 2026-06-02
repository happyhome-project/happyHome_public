<template>
  <el-container style="min-height: 100vh" data-testid="layout-shell">
    <el-aside width="220px" style="background: #304156">
      <div style="padding: 20px; color: #fff; font-size: 18px; font-weight: bold;">HappyHome 管理</div>
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
      </el-menu>
    </el-aside>
    <el-main data-testid="layout-main">
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
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { approvalApi } from '../api/cloud'

const authStore = useAuthStore()
const router = useRouter()
const pendingCommunityCount = ref(0)
const pendingMemberCount = ref(0)
const approvalTotal = computed(() => pendingCommunityCount.value + pendingMemberCount.value)

onMounted(() => {
  // 页面刷新后若有 token 但 role 缺失，尝试向后端拉身份回填
  if (authStore.token && !authStore.role) authStore.fetchMe()
  void loadApprovalSummary()
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
</script>

<style scoped>
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
