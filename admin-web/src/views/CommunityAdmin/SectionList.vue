<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h3>板块管理</h3>
      <el-button type="primary" @click="showCreateDialog = true">新建板块</el-button>
    </div>

    <el-table :data="sections" v-loading="loading">
      <el-table-column prop="name" label="板块名称" />
      <el-table-column prop="icon" label="图标" width="100" />
      <el-table-column prop="order" label="排序" width="80" />
      <el-table-column label="操作" width="220">
        <template #default="{ row }">
          <el-button size="small" @click="goWidgetEditor(row._id)">配置控件</el-button>
          <el-button
            type="danger"
            size="small"
            @click="deleteSection(row)"
            :loading="deletingId === row._id"
            style="margin-left: 8px;"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="showCreateDialog" title="新建板块" width="400px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="板块名称">
          <el-input v-model="form.name" placeholder="如：宠物交流、二手闲置" />
        </el-form-item>
        <el-form-item label="图标">
          <el-input v-model="form.icon" placeholder="如 child / car / book" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="createSection" :loading="saving">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { sectionApi } from '../../api/cloud'
import { ElMessage, ElMessageBox } from 'element-plus'

const route = useRoute()
const router = useRouter()
const sections = ref<any[]>([])
const loading = ref(false)
const saving = ref(false)
const deletingId = ref('')
const showCreateDialog = ref(false)
const form = ref({ name: '', icon: '' })
const communityId = route.params.communityId as string

onMounted(async () => {
  await loadSections()
})

async function loadSections() {
  loading.value = true
  try {
    const res = await sectionApi.list(communityId) as any
    sections.value = res.sections ?? []
  } catch (e: any) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function createSection() {
  if (!form.value.name.trim()) {
    ElMessage.warning('请填写板块名称')
    return
  }
  saving.value = true
  try {
    await sectionApi.create({
      communityId,
      name: form.value.name,
      icon: form.value.icon,
      order: sections.value.length,
    })
    await loadSections()
    showCreateDialog.value = false
    form.value = { name: '', icon: '' }
    ElMessage.success('创建成功')
  } catch (e: any) {
    ElMessage.error(e.message || '创建失败')
  } finally {
    saving.value = false
  }
}

function goWidgetEditor(sectionId: string) {
  router.push({ path: `/widgets/${sectionId}`, query: { communityId } })
}

async function deleteSection(row: any) {
  try {
    await ElMessageBox.confirm(
      `确认删除板块「${row.name}」吗？`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }

  deletingId.value = row._id
  try {
    await sectionApi.delete(row._id)
    ElMessage.success('删除成功')
    await loadSections()
  } catch (e: any) {
    ElMessage.error(e.message || '删除失败')
  } finally {
    deletingId.value = ''
  }
}
</script>
