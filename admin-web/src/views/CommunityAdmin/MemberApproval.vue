<template>
  <div>
    <h3>成员审批</h3>
    <el-table :data="pendingMembers" v-loading="loading">
      <el-table-column prop="userId" label="用户 ID" />
      <el-table-column prop="appliedAt" label="申请时间" width="180" />
      <el-table-column label="操作" width="160">
        <template #default="{ row }">
          <el-button type="primary" size="small" @click="approve(row)">通过</el-button>
          <el-button type="danger" size="small" @click="reject(row)">拒绝</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && pendingMembers.length === 0" description="暂无待审批成员" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { memberApi } from '../../api/cloud'
import { ElMessage } from 'element-plus'

const route = useRoute()
const communityId = route.params.communityId as string
const pendingMembers = ref<any[]>([])
const loading = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    const res = await memberApi.pendingList(communityId) as any
    pendingMembers.value = res.members ?? []
  } catch (e: any) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
})

async function approve(row: any) {
  try {
    await memberApi.memberApprove(communityId, row._id)
    pendingMembers.value = pendingMembers.value.filter(m => m._id !== row._id)
    ElMessage.success('已通过')
  } catch (e: any) {
    ElMessage.error(e.message || '操作失败')
  }
}

async function reject(row: any) {
  try {
    await memberApi.memberReject(communityId, row._id)
    pendingMembers.value = pendingMembers.value.filter(m => m._id !== row._id)
    ElMessage.info('已拒绝')
  } catch (e: any) {
    ElMessage.error(e.message || '操作失败')
  }
}
</script>
