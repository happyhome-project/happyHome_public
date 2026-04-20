<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h3>板块管理</h3>
      <el-button type="primary" @click="openCreate">新建板块</el-button>
    </div>

    <el-alert
      type="info"
      :closable="false"
      style="margin-bottom: 16px;"
      title="板块类型说明"
      description="实时协作（realtime）：拼车/签到/活动报名类，支持 active/dormant/archived 三态切换，首页会置顶。沉淀展示（evergreen）：好店/课件/作品类，始终作为归档分组卡展示。"
    />

    <el-table :data="sections" v-loading="loading">
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
            <span style="color: #909399; font-size: 12px;">— 常驻 —</span>
          </template>
        </template>
      </el-table-column>
      <el-table-column prop="icon" label="图标" width="80" />
      <el-table-column prop="order" label="排序" width="70" />
      <el-table-column label="操作" min-width="360">
        <template #default="{ row }">
          <el-button size="small" @click="goWidgetEditor(row._id)">控件</el-button>
          <el-button size="small" @click="openEdit(row)">编辑</el-button>
          <el-dropdown
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
                  v-for="s in (['active','dormant','archived'] as const)"
                  :key="s"
                  :command="s"
                  :disabled="row.status === s"
                >
                  {{ statusLabel(s) }}<span v-if="row.status === s" style="color:#909399; margin-left:6px;">(当前)</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
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

    <!-- 新建 / 编辑 弹窗 -->
    <el-dialog v-model="showDialog" :title="editingId ? '编辑板块' : '新建板块'" width="480px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="板块名称">
          <el-input v-model="form.name" placeholder="如：宠物交流、二手闲置、本周拼车" />
        </el-form-item>
        <el-form-item label="类型">
          <el-radio-group v-model="form.type">
            <el-radio value="evergreen">沉淀展示（evergreen）</el-radio>
            <el-radio value="realtime">实时协作（realtime）</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="图标">
          <el-input v-model="form.icon" placeholder="可选，如 child / car / book" />
        </el-form-item>
        <el-form-item label="左彩条色">
          <el-input v-model="form.accentColor" placeholder="可选，hex 值如 #3A6A45；不填按序循环" />
        </el-form-item>
        <el-form-item v-if="editingId && form.type === 'realtime'" label="状态">
          <el-radio-group v-model="form.status">
            <el-radio value="active">active · 激活</el-radio>
            <el-radio value="dormant">dormant · 休眠</el-radio>
            <el-radio value="archived">archived · 归档</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button type="primary" @click="submit" :loading="saving">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { sectionApi } from '../../api/cloud'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown } from '@element-plus/icons-vue'

type SectionType = 'realtime' | 'evergreen'
type SectionStatus = 'active' | 'dormant' | 'archived'

interface SectionRow {
  _id: string
  name: string
  icon: string
  order: number
  type: SectionType
  status: SectionStatus
  accentColor?: string
}

const route = useRoute()
const router = useRouter()
const sections = ref<SectionRow[]>([])
const loading = ref(false)
const saving = ref(false)
const deletingId = ref('')
const showDialog = ref(false)
const editingId = ref('')
const form = ref<{ name: string; icon: string; type: SectionType; status: SectionStatus; accentColor: string }>({
  name: '', icon: '', type: 'evergreen', status: 'active', accentColor: '',
})
const communityId = route.params.communityId as string

onMounted(async () => {
  await loadSections()
})

async function loadSections() {
  loading.value = true
  try {
    const res = await sectionApi.list(communityId) as any
    sections.value = (res.sections ?? []) as SectionRow[]
  } catch (e: any) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingId.value = ''
  form.value = { name: '', icon: '', type: 'evergreen', status: 'active', accentColor: '' }
  showDialog.value = true
}

function openEdit(row: SectionRow) {
  editingId.value = row._id
  form.value = {
    name: row.name,
    icon: row.icon || '',
    type: row.type || 'evergreen',
    status: row.status || 'active',
    accentColor: row.accentColor || '',
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
        type: form.value.type,
        status: form.value.type === 'realtime' ? form.value.status : 'active',
        accentColor: form.value.accentColor,
      })
      ElMessage.success('更新成功')
    } else {
      await sectionApi.create({
        communityId,
        name: form.value.name,
        icon: form.value.icon,
        order: sections.value.length,
        type: form.value.type,
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

function goWidgetEditor(sectionId: string) {
  router.push({ path: `/widgets/${sectionId}`, query: { communityId } })
}

async function deleteSection(row: SectionRow) {
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

async function onChangeStatus(row: SectionRow, status: SectionStatus) {
  if (row.status === status) return
  try {
    await sectionApi.updateStatus(row._id, status)
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
