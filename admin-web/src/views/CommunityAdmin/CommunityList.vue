<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h3>社区管理</h3>
      <el-button @click="loadCommunities" :loading="loading">刷新</el-button>
    </div>

    <el-table :data="communities" v-loading="loading" style="width: 100%">
      <el-table-column prop="name" label="社区名称" min-width="180" />
      <el-table-column prop="description" label="描述" min-width="220" show-overflow-tooltip />
      <el-table-column label="状态" width="120">
        <template #default="{ row }">
          <el-tag v-if="row.status === 'active'" type="success">已启用</el-tag>
          <el-tag v-else-if="row.status === 'pending'" type="warning">待审批</el-tag>
          <el-tag v-else type="info">已禁用</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="memberCount" label="成员数" width="100" />
      <el-table-column label="操作" width="260">
        <template #default="{ row }">
          <el-button size="small" @click="goSections(row._id)">板块管理</el-button>
          <el-button size="small" @click="goMembers(row._id)">成员审批</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-empty
      v-if="!loading && communities.length === 0"
      description="暂无可管理社区"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { communityApi } from '../../api/cloud'

const router = useRouter()
const loading = ref(false)
const communities = ref<any[]>([])

onMounted(() => {
  loadCommunities()
})

async function loadCommunities() {
  loading.value = true
  try {
    const res = await communityApi.list() as any
    communities.value = res.communities ?? []
  } catch (e: any) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function goSections(communityId: string) {
  router.push(`/sections/${communityId}`)
}

function goMembers(communityId: string) {
  router.push(`/members/${communityId}`)
}
</script>
