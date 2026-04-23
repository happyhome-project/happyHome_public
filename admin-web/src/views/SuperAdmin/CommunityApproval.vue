<template>
  <div data-testid="community-approval-page">
    <h3>社区审批</h3>
    <el-table data-testid="community-approval-table" :data="pendingCommunities" v-loading="loading" style="width: 100%">
      <el-table-column prop="name" label="社区名称" />
      <el-table-column prop="description" label="描述" show-overflow-tooltip />
      <el-table-column prop="createdAt" label="申请时间" width="180" />
      <el-table-column label="操作" width="160">
        <template #default="{ row }">
          <el-button data-testid="community-approve-button" :data-community-id="row._id" type="primary" size="small" @click="approve(row)">通过</el-button>
          <el-button data-testid="community-reject-button" :data-community-id="row._id" type="danger" size="small" @click="reject(row)">拒绝</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && pendingCommunities.length === 0" description="暂无待审批社区" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { communityApi } from '../../api/cloud'
import { ElMessage } from 'element-plus'

const pendingCommunities = ref<any[]>([])
const loading = ref(false)

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
    await communityApi.approve(row._id)
    pendingCommunities.value = pendingCommunities.value.filter(c => c._id !== row._id)
    ElMessage.success('已通过')
  } catch (e: any) {
    ElMessage.error(e.message || '操作失败')
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
</script>
