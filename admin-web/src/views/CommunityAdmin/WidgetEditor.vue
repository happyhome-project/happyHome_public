<template>
  <div class="widget-editor">
    <div class="page-header">
      <div>
        <el-breadcrumb separator="/">
          <el-breadcrumb-item :to="{ name: 'communities' }">社区管理</el-breadcrumb-item>
          <el-breadcrumb-item :to="{ name: 'sections', params: { communityId } }">{{ communityName || '当前社区' }}</el-breadcrumb-item>
          <el-breadcrumb-item :to="{ name: 'sections', params: { communityId } }">板块管理</el-breadcrumb-item>
          <el-breadcrumb-item>控件配置</el-breadcrumb-item>
        </el-breadcrumb>
        <div class="title-row">
          <h3>控件配置</h3>
          <el-tag size="small" effect="plain" type="info">当前社区：{{ communityName || communityId }}</el-tag>
          <el-tag v-if="sectionName" size="small" effect="plain">当前板块：{{ sectionName }}</el-tag>
        </div>
      </div>
      <div>
        <el-button @click="addWidget">+ 添加控件</el-button>
        <el-button type="primary" @click="save" :loading="saving" :disabled="listCount > 3">保存</el-button>
      </div>
    </div>

    <el-alert
      v-if="listCount > 3"
      title="帖子列表卡片展示项不能超过 3 个"
      type="error"
      style="margin-bottom: 16px;"
    />
    <el-alert
      type="warning"
      :closable="false"
      style="margin-bottom: 16px;"
      title="结构变更说明"
      description="如果板块内已有帖子，删除控件或修改控件类型会影响历史帖子展示；旧数据不会立刻丢失，但用户下次编辑旧帖子时会按最新控件结构自动清理。"
    />

    <draggable v-model="widgets" item-key="widgetId" handle=".drag-handle">
      <template #item="{ element: widget }">
        <el-card class="widget-card">
          <div class="widget-row">
            <div class="drag-handle">⋮⋮</div>
            <el-form label-width="138px" class="widget-form">
              <el-form-item label="控件类型">
                <el-select v-model="widget.type" :disabled="!widget._isNew" style="width: 260px;" @change="handleTypeChange(widget)">
                  <el-option label="短文字" value="short_text" />
                  <el-option label="一句话简介" value="summary" />
                  <el-option label="日期时间" value="datetime" />
                  <el-option label="数字" value="number" />
                  <el-option label="图片组" value="image_group" />
                  <el-option label="富图文" value="rich_note" />
                  <el-option v-if="widget.type === 'note_blocks'" label="图文笔记（旧）" value="note_blocks" />
                  <el-option label="视频组" value="video_group" />
                  <el-option label="音频组" value="audio_group" />
                  <el-option v-if="widget.type === 'rich_text'" label="富文本（旧）" value="rich_text" />
                  <el-option label="地图位置" value="location" />
                  <el-option label="活动参与" value="attendance" :disabled="sectionType !== 'realtime'" />
                  <el-option label="公告内容" value="admin_notice" />
                </el-select>
                <span v-if="sectionType !== 'realtime'" class="muted-tip">活动参与控件仅支持 realtime 板块</span>
              </el-form-item>

              <el-form-item label="标签名">
                <el-input v-model="widget.label" style="width: 260px;" />
              </el-form-item>

              <el-form-item v-if="widget.type === 'admin_notice'" label="公告正文">
                <div class="notice-editor">
                  <el-input
                    v-model="widget.noticeContent"
                    type="textarea"
                    :rows="4"
                    maxlength="500"
                    show-word-limit
                    style="width: 520px; max-width: 100%;"
                    placeholder="例如：近期课程安排、报名说明、固定提醒等。"
                  />
                  <span class="notice-tip">仅管理员在这里维护，普通成员不能通过发帖修改。支持 emoji 表情；内容较长时，小程序首页只展示摘要，可点击查看全文。</span>
                </div>
              </el-form-item>

              <el-form-item v-if="widget.type === 'attendance'" label="人数上限">
                <el-input-number
                  v-model="widget.capacity"
                  :min="1"
                  :step="1"
                  :precision="0"
                  placeholder="不填表示不限"
                />
                <span class="muted-tip">留空表示不限人数</span>
              </el-form-item>

              <el-form-item v-else-if="widget.type === 'admin_notice'" label="发布方式">
                <el-tag type="info" effect="plain">管理员维护，不开放发帖</el-tag>
              </el-form-item>

              <el-form-item v-else label="必填">
                <el-switch v-model="widget.required" />
              </el-form-item>

              <el-form-item>
                <template #label>
                  <span>显示在帖子列表卡片</span>
                  <el-tooltip
                    placement="top"
                    effect="dark"
                    content="开启：会显示在帖子列表卡片摘要（最多 3 个）；关闭：只在帖子详情里展示。"
                  >
                    <el-icon class="help-icon"><WarningFilled /></el-icon>
                  </el-tooltip>
                </template>
                <el-switch
                  v-model="widget.showInList"
                  :disabled="widget.type === 'admin_notice' || !isListDisplayable(widget.type)"
                />
                <span class="muted-tip" v-if="widget.type === 'attendance'">开启后会显示“参与人数 + 头像预览”</span>
                <span class="muted-tip" v-else-if="widget.type === 'admin_notice'">公告会直接展示在小程序首页板块区域，不进入帖子列表摘要</span>
                <span class="muted-tip" v-else-if="widget.type === 'audio_group'">音频只在帖子详情页播放，不进入列表摘要</span>
                <span class="muted-tip" v-else-if="!isListDisplayable(widget.type)">该类型不支持列表展示</span>
                <span class="muted-tip" v-else>关闭后仅在帖子详情页展示</span>
              </el-form-item>
            </el-form>
            <el-button type="danger" size="small" @click="removeWidget(widget)">删除</el-button>
          </div>
        </el-card>
      </template>
    </draggable>

    <el-empty v-if="widgets.length === 0" description="暂无控件，点击“添加控件”开始配置" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import draggable from 'vuedraggable'
import { v4 as uuidv4 } from 'uuid'
import { ElMessage } from 'element-plus/es/components/message/index'
import { ElMessageBox } from 'element-plus/es/components/message-box/index'
import { WarningFilled } from '@element-plus/icons-vue'
import { communityApi, sectionApi } from '../../api/cloud'
import { LIST_DISPLAYABLE_TYPES } from '../../../../cloud/shared/types'

const route = useRoute()
const sectionId = String(route.params.sectionId || '')
const communityId = String(route.query.communityId || '')
const widgets = ref<any[]>([])
const originalWidgets = ref<any[]>([])
const saving = ref(false)
const communityName = ref('')
const sectionName = ref('')
const sectionType = ref<'realtime' | 'evergreen'>('evergreen')
const DEFAULT_LABELS: Record<string, string> = {
  rich_note: '富图文',
  short_text: '短文字',
  summary: '一句话简介',
  datetime: '日期时间',
  number: '数字',
  image_group: '图片组',
  note_blocks: '图文笔记',
  video_group: '视频列表',
  audio_group: '音频列表',
  rich_text: '正文',
  location: '位置',
  attendance: '活动参与',
  admin_notice: '公告',
}

const listCount = computed(() => widgets.value.filter((widget) => widget.showInList).length)

function isListDisplayable(type: string) {
  return LIST_DISPLAYABLE_TYPES.includes(type as any)
}

function defaultLabel(type: string) {
  return DEFAULT_LABELS[type] || '内容'
}

function isPlaceholderLabel(label: unknown) {
  const text = String(label || '').trim().toLowerCase()
  return !text || text === '新控件' || text === 'new widget'
}

function isDefaultWidgetLabel(label: unknown) {
  const text = String(label || '').trim()
  return Object.values(DEFAULT_LABELS).includes(text)
}

function shouldClearAttendanceLabel(label: unknown) {
  return isPlaceholderLabel(label) || isDefaultWidgetLabel(label)
}

onMounted(async () => {
  try {
    await loadCommunityContext()
    const res = await sectionApi.get(sectionId) as any
    sectionName.value = String(res.section?.name || '')
    sectionType.value = res.section?.type === 'realtime' ? 'realtime' : 'evergreen'
    widgets.value = (res.section?.widgets ?? []).map((widget: any, index: number) => ({
      ...widget,
      label: widget?.type === 'attendance' && shouldClearAttendanceLabel(widget?.label)
        ? ''
        : String(widget?.label || ''),
      fieldKey: resolveFieldKey(widget, index),
      required: ['attendance', 'admin_notice'].includes(widget?.type) ? false : !!widget.required,
      showInList: isListDisplayable(widget?.type) ? !!widget.showInList : false,
      noticeContent: widget?.type === 'admin_notice' ? String(widget.noticeContent || '') : undefined,
      _isNew: false,
    }))
    originalWidgets.value = widgets.value.map((widget) => ({
      widgetId: String(widget.widgetId || ''),
      type: widget.type,
    }))
  } catch (error: any) {
    ElMessage.error(error.message || '加载失败')
  }
})

function addWidget() {
  const nextType = 'short_text'
  widgets.value.push({
    widgetId: uuidv4(),
    type: nextType,
    label: defaultLabel(nextType),
    fieldKey: `field_${Date.now()}`,
    required: false,
    order: widgets.value.length,
    showInList: false,
    capacity: undefined,
    noticeContent: '',
    _isNew: true,
  })
}

async function loadCommunityContext() {
  if (!communityId) {
    communityName.value = ''
    return
  }
  try {
    const res = await communityApi.list() as any
    const current = (res.communities ?? []).find((community: any) => String(community?._id || community?.id || '') === communityId)
    communityName.value = String(current?.name || '')
  } catch {
    communityName.value = ''
  }
}

function resolveFieldKey(widget: any, index: number) {
  const raw = String(widget?.fieldKey || '').trim()
  if (raw) return raw
  const widgetId = String(widget?.widgetId || '').replace(/[^a-zA-Z0-9_]/g, '')
  if (widgetId) return `field_${widgetId.slice(0, 12)}`
  return `field_${index + 1}`
}

function handleTypeChange(widget: any) {
  if (widget.type === 'attendance') {
    widget.required = false
    widget.capacity = typeof widget.capacity === 'number' ? widget.capacity : undefined
    widget.showInList = true
    widget.noticeContent = undefined
    if (shouldClearAttendanceLabel(widget.label)) {
      widget.label = ''
    }
  } else if (widget.type === 'admin_notice') {
    widget.required = false
    widget.showInList = false
    widget.capacity = undefined
    widget.noticeContent = typeof widget.noticeContent === 'string' ? widget.noticeContent : ''
  } else {
    widget.capacity = undefined
    widget.noticeContent = undefined
    if (!isListDisplayable(widget.type)) widget.showInList = false
  }
}

function removeWidget(widget: any) {
  widgets.value = widgets.value.filter((item) => item.widgetId !== widget.widgetId)
}

function hasStructuralWidgetChanges(nextWidgets: any[]) {
  const nextIds = new Set(nextWidgets.map((widget) => String(widget.widgetId || '')))
  if (originalWidgets.value.some((widget) => !nextIds.has(String(widget.widgetId || '')))) {
    return true
  }

  const originalById = new Map(originalWidgets.value.map((widget) => [String(widget.widgetId || ''), widget]))
  return nextWidgets.some((widget) => {
    const original = originalById.get(String(widget.widgetId || ''))
    return original && original.type !== widget.type
  })
}

async function save() {
  if (!sectionId) {
    ElMessage.error('缺少 sectionId，无法保存')
    return
  }
  if (listCount.value > 3) {
    ElMessage.error('帖子列表卡片展示项不能超过 3 个')
    return
  }
  saving.value = true
  try {
    const orderedWidgets = widgets.value.map(({ _isNew, ...widget }, index) => ({
      ...widget,
      label: widget.type === 'attendance' && shouldClearAttendanceLabel(widget.label) ? '' : widget.label,
      fieldKey: resolveFieldKey(widget, index),
      required: ['attendance', 'admin_notice'].includes(widget.type) ? false : !!widget.required,
      showInList: isListDisplayable(widget.type) ? !!widget.showInList : false,
      capacity: widget.type === 'attendance' && widget.capacity ? Number(widget.capacity) : undefined,
      noticeContent: widget.type === 'admin_notice' ? String(widget.noticeContent || '').trim() : undefined,
      order: index,
    }))
    const needsImpactPreview = hasStructuralWidgetChanges(orderedWidgets)

    if (needsImpactPreview) {
      const preview = await sectionApi.updateWidgets({
        sectionId,
        communityId,
        widgets: orderedWidgets,
        preview: true,
      }) as any

      if (preview.requireConfirmation) {
        const removedLabels = preview.structuralChanges?.removedLabels?.join('、') || '已删除控件'
        await ElMessageBox.confirm(
          `该板块已有 ${preview.activePostCount} 条帖子，本次将移除控件：${removedLabels}。历史帖子中的旧数据不会立刻删除，但会从当前展示结构中消失，并在用户下次编辑时自动清理。确认继续吗？`,
          '确认结构变更',
          { type: 'warning', confirmButtonText: '继续保存', cancelButtonText: '取消' }
        )
      }
    }

    await sectionApi.updateWidgets({
      sectionId,
      communityId,
      widgets: orderedWidgets,
      confirmStructureChange: true,
    })
    widgets.value = widgets.value.map((widget, index) => ({
      ...widget,
      ...orderedWidgets[index],
      _isNew: false,
    }))
    originalWidgets.value = orderedWidgets.map((widget) => ({
      widgetId: String(widget.widgetId || ''),
      type: widget.type,
    }))
    ElMessage.success('保存成功')
  } catch (error: any) {
    ElMessage.error(error.message || '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.widget-editor {
  padding: 0;
}

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
  flex-wrap: wrap;
}

.title-row h3 {
  margin: 0;
}

.widget-card {
  margin-bottom: 12px;
}

.widget-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.widget-form {
  flex: 1;
}

.drag-handle {
  cursor: grab;
  font-size: 20px;
  color: #c0c4cc;
  padding-top: 6px;
  user-select: none;
}

.help-icon {
  margin-left: 6px;
  font-size: 14px;
  color: #909399;
  cursor: pointer;
  vertical-align: middle;
}

.muted-tip {
  margin-left: 8px;
  color: #909399;
  font-size: 12px;
}

.notice-editor {
  width: 520px;
  max-width: 100%;
}

.notice-tip {
  display: block;
  margin-top: 6px;
  color: #909399;
  font-size: 12px;
}

@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
  }

  .widget-row {
    flex-direction: column;
  }
}
</style>
