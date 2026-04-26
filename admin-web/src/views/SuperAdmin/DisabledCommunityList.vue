<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h3>已禁用社区</h3>
      <el-button @click="loadList" :loading="loading">刷新</el-button>
    </div>

    <el-table :data="communities" v-loading="loading" style="width: 100%">
      <el-table-column prop="name" label="社区名称" min-width="180" />
      <el-table-column prop="description" label="描述" min-width="220" show-overflow-tooltip />
      <el-table-column label="创建时间" width="200">
        <template #default="{ row }">
          <span>{{ formatAdminDateTime(row.createdAt) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="240">
        <template #default="{ row }">
          <el-button
            type="primary"
            size="small"
            :loading="restoringId === row._id"
            @click="restore(row)"
          >
            恢复
          </el-button>
          <el-button
            type="danger"
            size="small"
            :loading="deletingId === row._id"
            @click="hardDelete(row)"
          >
            永久删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-empty v-if="!loading && communities.length === 0" description="暂无已禁用社区" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { communityApi } from '../../api/cloud'
import { formatAdminDateTime } from '../../utils/datetime'

const loading = ref(false)
const communities = ref<any[]>([])
const restoringId = ref('')
const deletingId = ref('')

onMounted(() => {
  loadList()
})

async function loadList() {
  loading.value = true
  try {
    const res = await communityApi.listDisabled() as any
    communities.value = res.communities ?? []
  } catch (e: any) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function restore(row: any) {
  try {
    await ElMessageBox.confirm(
      `确认恢复社区「${row.name}」吗？恢复后小程序端将重新可见。`,
      '恢复确认',
      { type: 'warning', confirmButtonText: '恢复', cancelButtonText: '取消' }
    )
  } catch {
    return
  }

  restoringId.value = row._id
  try {
    await communityApi.restore(row._id)
    ElMessage.success('已恢复')
    communities.value = communities.value.filter(c => c._id !== row._id)
  } catch (e: any) {
    ElMessage.error(e.message || '恢复失败')
  } finally {
    restoringId.value = ''
  }
}

async function hardDelete(row: any) {
  try {
    await ElMessageBox.confirm(
      `确认永久删除社区「${row.name}」吗？此操作不可恢复，将同时删除该社区下所有板块、帖子、成员和图片。`,
      '永久删除确认',
      { type: 'warning', confirmButtonText: '永久删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }

  deletingId.value = row._id
  try {
    await communityApi.hardDelete(row._id)
    ElMessage.success('已永久删除')
    communities.value = communities.value.filter(c => c._id !== row._id)
  } catch (e: any) {
    ElMessage.error(e.message || '删除失败')
  } finally {
    deletingId.value = ''
  }
}
</script>
