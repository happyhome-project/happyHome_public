<template>
  <div data-testid="section-list-page">
    <div class="page-header">
      <div>
        <el-breadcrumb separator="/">
          <el-breadcrumb-item :to="{ name: 'communities' }">社区管理</el-breadcrumb-item>
          <el-breadcrumb-item>{{ communityName || '当前社区' }}</el-breadcrumb-item>
          <el-breadcrumb-item>板块管理</el-breadcrumb-item>
        </el-breadcrumb>
        <div class="title-row">
          <h3>板块管理</h3>
          <el-tag size="small" effect="plain" type="info">当前社区：{{ communityName || communityId }}</el-tag>
        </div>
      </div>
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
      <el-table-column label="入口图标" width="110">
        <template #default="{ row }">
          <span>{{ row.icon || '默认' }}</span>
        </template>
      </el-table-column>
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
        <el-form-item v-if="form.type === 'evergreen'" label="展示模板">
          <el-radio-group v-model="form.displayTemplate">
            <el-radio value="default">默认列表</el-radio>
            <el-radio value="guide_note">图文攻略</el-radio>
          </el-radio-group>
          <div class="field-hint">图文攻略适合亲子出游、村游路线等沉淀板块；会固定路线数据、顶部图片和富图文正文，不启用标签归类。</div>
        </el-form-item>
        <el-form-item>
          <template #label>
            <span>首页入口图标（可选）</span>
            <el-tooltip
              placement="top"
              effect="dark"
              content="显示在小程序首页这个板块入口前的小图标。留空也可以，系统会用默认样式展示。"
            >
              <el-icon class="help-icon"><WarningFilled /></el-icon>
            </el-tooltip>
          </template>
          <div class="preset-grid">
            <button
              v-for="option in iconOptions"
              :key="option.value || 'default'"
              type="button"
              class="preset-button icon-preset"
              :class="{ active: form.icon === option.value }"
              @click="form.icon = option.value"
            >
              <span class="icon-glyph">{{ option.glyph }}</span>
              <span class="preset-label">{{ option.label }}</span>
            </button>
          </div>
          <div class="field-hint">不需要手输。直接点一个图标；不选则使用系统默认样式。</div>
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.order" :min="0" :step="1" style="width: 180px;" />
        </el-form-item>
        <el-form-item>
          <template #label>
            <span>首页强调色（可选）</span>
            <el-tooltip
              placement="top"
              effect="dark"
              content="用于小程序首页里这个板块卡片的强调色。留空时系统会自动分配，不影响正常使用。"
            >
              <el-icon class="help-icon"><WarningFilled /></el-icon>
            </el-tooltip>
          </template>
          <div class="preset-grid color-grid">
            <button
              v-for="option in colorOptions"
              :key="option.value || 'default'"
              type="button"
              class="preset-button color-preset"
              :class="{ active: form.accentColor === option.value }"
              @click="form.accentColor = option.value"
            >
              <span
                class="color-swatch"
                :style="{ background: option.preview }"
              />
              <span class="preset-label">{{ option.label }}</span>
            </button>
          </div>
          <div class="field-hint">不需要手写色号。直接点选一种颜色；不选则由系统自动分配。</div>
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
import { communityApi, sectionApi } from '../../api/cloud'
import { ElMessage } from 'element-plus/es/components/message/index'
import { ElMessageBox } from 'element-plus/es/components/message-box/index'
import { ArrowDown, WarningFilled } from '@element-plus/icons-vue'

type SectionType = 'realtime' | 'evergreen'
type SectionStatus = 'active' | 'dormant' | 'archived'
type SectionDisplayTemplate = 'default' | 'guide_note'

interface SectionRow {
  _id: string
  id?: string
  name: string
  icon: string
  order: number
  type: SectionType
  status: SectionStatus
  displayTemplate?: SectionDisplayTemplate
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
const communityName = ref('')
const iconOptions = [
  { value: '', glyph: '·', label: '系统默认' },
  { value: '📣', glyph: '📣', label: '通知' },
  { value: '🚗', glyph: '🚗', label: '出行' },
  { value: '🍲', glyph: '🍲', label: '美食' },
  { value: '🛍️', glyph: '🛍️', label: '闲置' },
  { value: '📚', glyph: '📚', label: '学习' },
  { value: '🏃', glyph: '🏃', label: '活动' },
  { value: '🐾', glyph: '🐾', label: '宠物' },
  { value: '👨‍👩‍👧', glyph: '👨‍👩‍👧', label: '亲子' },
  { value: '💬', glyph: '💬', label: '交流' },
] as const
const colorOptions = [
  { value: '', label: '系统默认', preview: 'linear-gradient(135deg, #e5e7eb, #cbd5e1)' },
  { value: '#3A6A45', label: '松林绿', preview: '#3A6A45' },
  { value: '#2F5D8C', label: '湖水蓝', preview: '#2F5D8C' },
  { value: '#A65A3A', label: '陶土橙', preview: '#A65A3A' },
  { value: '#7A4E8A', label: '梅子紫', preview: '#7A4E8A' },
  { value: '#B8860B', label: '暖金色', preview: '#B8860B' },
  { value: '#B94B6B', label: '玫瑰红', preview: '#B94B6B' },
  { value: '#4C7A5A', label: '鼠尾草', preview: '#4C7A5A' },
  { value: '#5B6C8F', label: '雾霭蓝', preview: '#5B6C8F' },
] as const
const form = ref<{
  name: string
  icon: string
  order: number
  type: SectionType
  status: SectionStatus
  displayTemplate: SectionDisplayTemplate
  accentColor: string
  enableComment: boolean
  enableLike: boolean
}>({
  name: '',
  icon: '',
  order: 0,
  type: 'evergreen',
  status: 'active',
  displayTemplate: 'default',
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
  await loadCommunityContext()
  await loadSections()
})

watch(
  () => route.params.communityId,
  async (next) => {
    communityId.value = String(next || '')
    if (communityId.value) {
      await loadCommunityContext()
      await loadSections()
    }
  }
)

async function loadCommunityContext() {
  try {
    const res = await communityApi.list() as any
    const communities = res.communities ?? []
    const current = communities.find((community: any) => String(community?._id || community?.id || '') === communityId.value)
    communityName.value = String(current?.name || '')
  } catch {
    communityName.value = ''
  }
}

async function loadSections() {
  loading.value = true
  try {
    const res = await sectionApi.list(communityId.value) as any
    sections.value = (res.sections ?? []).map((section: any) => ({
      ...section,
      _id: String(section?._id || section?.id || ''),
      displayTemplate: section?.displayTemplate === 'guide_note' ? 'guide_note' : 'default',
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
    displayTemplate: 'default',
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
    displayTemplate: row.displayTemplate === 'guide_note' ? 'guide_note' : 'default',
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
        displayTemplate: form.value.type === 'evergreen' ? form.value.displayTemplate : 'default',
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
        displayTemplate: form.value.type === 'evergreen' ? form.value.displayTemplate : 'default',
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

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 16px;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
}

.title-row h3 {
  margin: 0;
}

.help-icon {
  margin-left: 6px;
  font-size: 14px;
  color: #909399;
  cursor: pointer;
  vertical-align: middle;
}

.preset-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
}

.preset-button {
  border: 1px solid #dcdfe6;
  background: #fff;
  border-radius: 10px;
  padding: 10px 12px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.preset-button:hover {
  border-color: #409eff;
}

.preset-button.active {
  border-color: #409eff;
  background: #ecf5ff;
  box-shadow: 0 0 0 1px rgba(64, 158, 255, 0.15) inset;
}

.icon-preset {
  min-width: 92px;
}

.icon-glyph {
  font-size: 18px;
  line-height: 1;
}

.preset-label {
  font-size: 13px;
  color: #303133;
}

.color-grid {
  gap: 10px;
}

.color-preset {
  min-width: 110px;
}

.color-swatch {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  flex: none;
}

.field-hint {
  margin-top: 8px;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}

@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
  }

  .title-row {
    flex-wrap: wrap;
  }
}
</style>
