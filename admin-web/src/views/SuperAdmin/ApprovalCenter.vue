<template>
  <div data-testid="approval-center-page">
    <div class="page-header">
      <div>
        <h3 style="margin: 0;">审批中心</h3>
        <div class="subtitle">集中查看社区创建申请和成员加入申请</div>
      </div>
      <el-button @click="loadSummary" :loading="loading">刷新</el-button>
    </div>

    <div class="summary-grid">
      <el-card shadow="never">
        <div class="summary-card">
          <div>
            <div class="summary-label">社区创建申请</div>
            <div class="summary-count">{{ summary.pendingCommunityCount }}</div>
          </div>
          <el-button
            v-if="authStore.isSuperAdmin"
            type="primary"
            plain
            @click="router.push({ name: 'community-approval' })"
          >
            去审批
          </el-button>
        </div>
      </el-card>
      <el-card shadow="never">
        <div class="summary-card">
          <div>
            <div class="summary-label">成员加入申请</div>
            <div class="summary-count">{{ summary.pendingMemberCount }}</div>
          </div>
          <el-button plain @click="router.push({ name: 'communities' })">查看社区</el-button>
        </div>
      </el-card>
    </div>

    <el-card shadow="never" class="member-card">
      <template #header>
        <span>按社区查看成员加入申请</span>
      </template>
      <el-table :data="summary.communities" v-loading="loading" style="width: 100%;">
        <el-table-column prop="communityName" label="社区" min-width="220" />
        <el-table-column prop="pendingMemberCount" label="待审批成员" width="140">
          <template #default="{ row }">
            <el-badge :value="row.pendingMemberCount" type="danger" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160">
          <template #default="{ row }">
            <el-button type="primary" size="small" @click="goPendingMembers(row.communityId)">处理</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty
        v-if="!loading && summary.communities.length === 0"
        description="暂无待审批成员"
      />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus/es/components/message/index'
import { approvalApi } from '../../api/cloud'
import { useAuthStore } from '../../stores/auth'

const router = useRouter()
const authStore = useAuthStore()
const loading = ref(false)
const summary = reactive({
  pendingCommunityCount: 0,
  pendingMemberCount: 0,
  communities: [] as Array<{ communityId: string; communityName: string; pendingMemberCount: number }>,
})

onMounted(() => {
  void loadSummary()
})

async function loadSummary() {
  loading.value = true
  try {
    const res = await approvalApi.summary()
    summary.pendingCommunityCount = Number(res.pendingCommunityCount || 0)
    summary.pendingMemberCount = Number(res.pendingMemberCount || 0)
    summary.communities = Array.isArray(res.communities) ? res.communities : []
  } catch (error: any) {
    ElMessage.error(error?.message || '加载审批待办失败')
  } finally {
    loading.value = false
  }
}

function goPendingMembers(communityId: string) {
  router.push({ name: 'members', params: { communityId }, query: { tab: 'pending' } })
}
</script>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
}
.subtitle {
  color: #909399;
  font-size: 13px;
  margin-top: 6px;
}
.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
  margin-bottom: 16px;
}
.summary-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.summary-label {
  color: #606266;
  font-size: 14px;
}
.summary-count {
  font-size: 34px;
  line-height: 1.2;
  font-weight: 700;
  color: #303133;
}
.member-card {
  margin-top: 16px;
}
</style>
