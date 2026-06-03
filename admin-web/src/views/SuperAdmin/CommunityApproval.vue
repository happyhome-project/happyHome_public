<template>
  <div data-testid="community-approval-page">
    <h3>社区审批</h3>
    <el-table data-testid="community-approval-table" :data="pendingCommunities" v-loading="loading" style="width: 100%">
      <el-table-column prop="name" label="社区名称" />
      <el-table-column prop="description" label="描述" show-overflow-tooltip />
      <el-table-column label="申请时间" width="180">
        <template #default="{ row }">
          <span>{{ formatAdminDateTime(row.createdAt) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160">
        <template #default="{ row }">
          <el-button data-testid="community-approve-button" :data-community-id="row._id" type="primary" size="small" @click="approve(row)">通过</el-button>
          <el-button data-testid="community-reject-button" :data-community-id="row._id" type="danger" size="small" @click="reject(row)">拒绝</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && pendingCommunities.length === 0" description="暂无待审批社区" />

    <el-dialog
      v-model="showCredsDialog"
      title="审批通过 · 创建者已自动获得管理员账号"
      width="520px"
      data-testid="approval-creds-dialog"
    >
      <div v-if="creds.alreadyExisted" style="color: #67c23a; margin-bottom: 12px;">
        ✓ 该创建者之前已经有管理员账号了，无需重复创建。请直接告诉对方继续使用原账号。
      </div>
      <div v-else style="color: #e6a23c; margin-bottom: 12px;">
        ⚠️ 这是该创建者首个 admin 账号。<b>密码只在这里显示一次</b>，请立刻复制并通过安全渠道告诉对方。关掉对话框后无法再次查看（可在"管理员管理"重置密码）。
      </div>
      <el-descriptions :column="1" border>
        <el-descriptions-item label="社区">{{ creds.communityName }}</el-descriptions-item>
        <el-descriptions-item label="用户名">
          <code data-testid="approval-creds-username">{{ creds.username }}</code>
          <el-button size="small" link @click="copy(creds.username)">复制</el-button>
        </el-descriptions-item>
        <el-descriptions-item v-if="creds.password" label="初始密码">
          <code data-testid="approval-creds-password">{{ creds.password }}</code>
          <el-button size="small" link @click="copy(creds.password!)">复制</el-button>
        </el-descriptions-item>
      </el-descriptions>
      <template #footer>
        <el-button type="primary" @click="showCredsDialog = false">我已复制并发送</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { communityApi } from '../../api/cloud'
import { ElMessage } from 'element-plus/es/components/message/index'
import { formatAdminDateTime } from '../../utils/datetime'

const pendingCommunities = ref<any[]>([])
const loading = ref(false)

const showCredsDialog = ref(false)
const creds = ref<{ communityName: string; username: string; password?: string; alreadyExisted: boolean }>({
  communityName: '', username: '', password: undefined, alreadyExisted: false,
})

onMounted(async () => {
  loading.value = true
  try {
    const result = await communityApi.list() as any
    pendingCommunities.value = (result.communities ?? []).filter((c: any) => c.status === 'pending')
  } catch (e: any) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
})

async function approve(row: any) {
  try {
    const res = await communityApi.approve(row._id) as any
    pendingCommunities.value = pendingCommunities.value.filter(c => c._id !== row._id)
    if (res?.adminAccount?.username) {
      creds.value = {
        communityName: row.name,
        username: res.adminAccount.username,
        password: res.adminAccount.password,
        alreadyExisted: !!res.adminAccount.alreadyExisted,
      }
      showCredsDialog.value = true
    } else {
      ElMessage.success('已通过（社区无 creatorId，未生成管理员账号）')
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '操作失败')
  }
}

async function reject(row: any) {
  try {
    await communityApi.reject(row._id)
    pendingCommunities.value = pendingCommunities.value.filter(c => c._id !== row._id)
    ElMessage.info('已拒绝')
  } catch (e: any) {
    ElMessage.error(e.message || '操作失败')
  }
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制')
  } catch {
    ElMessage.warning('复制失败，请手动选中')
  }
}
</script>
