<template>
  <div data-testid="section-list-page">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h3>板块管理</h3>
      <el-button data-testid="section-create-button" type="primary" @click="openCreate">新建板块</el-button>
    </div>

    <el-alert
      type="info"
      :closable="false"
      style="margin-bottom: 16px;"
      title="板块类型说明"
      description="realtime 适合报名、拼车、签到等实时协作场景；evergreen 适合长期沉淀展示。"
    />

    <el-table data-testid="section-table" :data="sections" v-loading="loading">
      <el-table-column prop="name" label="板块名称" min-width="140" />
      <el-table-column label="类型" width="120">
        <template #default="{ row }">
          <el-tag :type="row.type === 'realtime' ? 'danger' : 'success'" size="small">
            {{ row.type === 'realtime' ? '实时协作' : '沉淀展示' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="160">
        <template #default="{ row }">
          <template v-if="row.type === 'realtime'">
            <el-tag :type="statusTagType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
          <template v-else>
            <span style="color: #909399; font-size: 12px;">常驻</span>
          </template>
        </template>
      </el-table-column>
      <el-table-column prop="icon" label="图标" width="80" />
      <el-table-column prop="order" label="排序" width="70" />
      <el-table-column label="互动" width="160">
        <template #default="{ row }">
          <el-tag size="small" :type="row.enableComment ? 'success' : 'info'">
            {{ row.enableComment ? '评论开' : '评论关' }}
          </el-tag>
          <el-tag size="small" :type="row.enableLike ? 'success' : 'info'" style="margin-left: 8px;">
            {{ row.enableLike ? '点赞开' : '点赞关' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" min-width="360">
        <template #default="{ row }">
          <el-button data-testid="section-widgets-button" :data-section-id="getSectionId(row)" size="small" @click="goWidgetEditor(getSectionId(row))">控件</el-button>
          <el-button data-testid="section-edit-button" :data-section-id="getSectionId(row)" size="small" @click="openEdit(row)">编辑</el-button>
          <el-dropdown
            data-testid="section-status-dropdown"
            v-if="row.type === 'realtime'"
            trigger="click"
            style="margin-left: 8px;"
            @command="(s: any) => onChangeStatus(row, s)"
          >
            <el-button size="small" type="primary" plain>
              切换状态<el-icon style="margin-left: 4px;"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  v-for="s in (['active', 'dormant', 'archived'] as const)"
                  :key="s"
                  :command="s"
                  :disabled="row.status === s"
                >
                  {{ statusLabel(s) }}<span v-if="row.status === s" style="color: #909399; margin-left: 6px;">(当前)</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button
            data-testid="section-delete-button"
            :data-section-id="getSectionId(row)"
            type="danger"
            size="small"
            @click="deleteSection(row)"
            :loading="deletingId === getSectionId(row)"
            style="margin-left: 8px;"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="showDialog" :title="editingId ? '编辑板块' : '新建板块'" width="480px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="板块名称">
          <div data-testid="section-name-input" style="width: 100%;">
            <el-input v-model="form.name" placeholder="例如：宠物交流、闲置转让、本周拼车" />
          </div>
        </el-form-item>
        <el-form-item label="类型">
          <el-radio-group v-model="form.type">
            <el-radio value="evergreen">沉淀展示</el-radio>
            <el-radio value="realtime">实时协作</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="图标">
          <el-input v-model="form.icon" placeholder="可选，例如：child / car / book" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.order" :min="0" :step="1" style="width: 180px;" />
        </el-form-item>
        <el-form-item label="左侧色条">
          <el-input v-model="form.accentColor" placeholder="可选，例如：#3A6A45" />
        </el-form-item>
        <el-form-item label="允许评论">
          <el-switch v-model="form.enableComment" />
        </el-form-item>
        <el-form-item label="允许点赞">
          <el-switch v-model="form.enableLike" />
        </el-form-item>
        <el-form-item v-if="editingId && form.type === 'realtime'" label="状态">
          <el-radio-group v-model="form.status">
            <el-radio value="active">active</el-radio>
            <el-radio value="dormant">dormant</el-radio>
            <el-radio value="archived">archived</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button data-testid="section-submit-button" type="primary" @click="submit" :loading="saving">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { sectionApi } from '../../api/cloud'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown } from '@element-plus/icons-vue'

type SectionType = 'realtime' | 'evergreen'
type SectionStatus = 'active' | 'dormant' | 'archived'

interface SectionRow {
  _id: string
  id?: string
  name: string
  icon: string
  order: number
  type: SectionType
  status: SectionStatus
  accentColor?: string
  enableComment: boolean
  enableLike: boolean
}

const route = useRoute()
const router = useRouter()
const sections = ref<SectionRow[]>([])
const loading = ref(false)
const saving = ref(false)
const deletingId = ref('')
const showDialog = ref(false)
const editingId = ref('')
const form = ref<{
  name: string
  icon: string
  order: number
  type: SectionType
  status: SectionStatus
  accentColor: string
  enableComment: boolean
  enableLike: boolean
}>({
  name: '',
  icon: '',
  order: 0,
  type: 'evergreen',
  status: 'active',
  accentColor: '',
  enableComment: true,
  enableLike: true,
})
const communityId = ref(String(route.params.communityId || ''))

onMounted(async () => {
  if (!communityId.value) {
    ElMessage.error('缺少 communityId，无法加载板块')
    router.push({ name: 'communities' })
    return
  }
  await loadSections()
})

watch(
  () => route.params.communityId,
  async (next) => {
    communityId.value = String(next || '')
    if (communityId.value) {
      await loadSections()
    }
  }
)

async function loadSections() {
  loading.value = true
  try {
    const res = await sectionApi.list(communityId.value) as any
    sections.value = (res.sections ?? []).map((section: any) => ({
      ...section,
      _id: String(section?._id || section?.id || ''),
    })) as SectionRow[]
  } catch (e: any) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function getSectionId(row: any): string {
  return String(row?._id || row?.id || '')
}

function openCreate() {
  editingId.value = ''
  form.value = {
    name: '',
    icon: '',
    order: sections.value.length,
    type: 'evergreen',
    status: 'active',
    accentColor: '',
    enableComment: true,
    enableLike: true,
  }
  showDialog.value = true
}

function openEdit(row: SectionRow) {
  const sectionId = getSectionId(row)
  if (!sectionId) {
    ElMessage.error('板块 ID 缺失，无法编辑')
    return
  }
  editingId.value = sectionId
  form.value = {
    name: row.name,
    icon: row.icon || '',
    order: row.order ?? 0,
    type: row.type || 'evergreen',
    status: row.status || 'active',
    accentColor: row.accentColor || '',
    enableComment: row.enableComment !== false,
    enableLike: row.enableLike !== false,
  }
  showDialog.value = true
}

async function submit() {
  if (!form.value.name.trim()) {
    ElMessage.warning('请填写板块名称')
    return
  }
  saving.value = true
  try {
    if (editingId.value) {
      await sectionApi.updateMeta({
        sectionId: editingId.value,
        name: form.value.name,
        icon: form.value.icon,
        order: form.value.order,
        type: form.value.type,
        status: form.value.type === 'realtime' ? form.value.status : 'active',
        accentColor: form.value.accentColor,
        enableComment: form.value.enableComment,
        enableLike: form.value.enableLike,
      })
      ElMessage.success('更新成功')
    } else {
      await sectionApi.create({
        communityId: communityId.value,
        name: form.value.name,
        icon: form.value.icon,
        order: form.value.order,
        type: form.value.type,
        enableComment: form.value.enableComment,
        enableLike: form.value.enableLike,
        ...(form.value.accentColor ? { accentColor: form.value.accentColor } : {}),
      })
      ElMessage.success('创建成功')
    }
    showDialog.value = false
    await loadSections()
  } catch (e: any) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function goWidgetEditor(sectionId: string) {
  if (!sectionId) {
    ElMessage.error('板块 ID 缺失，无法进入控件配置')
    return
  }
  if (!communityId.value) {
    ElMessage.error('社区 ID 缺失，无法进入控件配置')
    return
  }
  await router.push({ name: 'widgets', params: { sectionId }, query: { communityId: communityId.value } })
}

async function deleteSection(row: SectionRow) {
  const sectionId = getSectionId(row)
  if (!sectionId) {
    ElMessage.error('板块 ID 缺失，无法删除')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认删除板块「${row.name}」吗？`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }

  deletingId.value = sectionId
  try {
    await sectionApi.delete(sectionId)
    ElMessage.success('删除成功')
    await loadSections()
  } catch (e: any) {
    ElMessage.error(e.message || '删除失败')
  } finally {
    deletingId.value = ''
  }
}

async function onChangeStatus(row: SectionRow, status: SectionStatus) {
  const sectionId = getSectionId(row)
  if (!sectionId) {
    ElMessage.error('板块 ID 缺失，无法切换状态')
    return
  }
  if (row.status === status) return
  try {
    await sectionApi.updateStatus(sectionId, status)
    ElMessage.success(`已切换为 ${statusLabel(status)}`)
    await loadSections()
  } catch (e: any) {
    ElMessage.error(e.message || '切换失败')
  }
}

function statusLabel(s: SectionStatus): string {
  return s === 'active' ? '激活' : s === 'dormant' ? '休眠' : '归档'
}

function statusTagType(s: SectionStatus): 'success' | 'info' | 'warning' {
  return s === 'active' ? 'success' : s === 'dormant' ? 'warning' : 'info'
}
</script>
