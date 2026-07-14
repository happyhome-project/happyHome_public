<template>
  <div class="widget-editor" :class="{ 'is-embedded': embedded }">
    <div v-if="!embedded" class="page-header">
      <div class="header-left">
        <el-button :icon="ArrowLeft" circle title="返回板块管理" @click="goBackToSections" />
        <div>
        <el-breadcrumb separator="/">
          <el-breadcrumb-item :to="{ name: 'communities' }">社区管理</el-breadcrumb-item>
          <el-breadcrumb-item :to="{ name: 'sections', params: { communityId: resolvedCommunityId } }">{{ communityName || '当前社区' }}</el-breadcrumb-item>
          <el-breadcrumb-item :to="{ name: 'sections', params: { communityId: resolvedCommunityId } }">板块管理</el-breadcrumb-item>
          <el-breadcrumb-item>控件配置</el-breadcrumb-item>
        </el-breadcrumb>
        <div class="title-row">
          <h3>控件配置</h3>
          <el-tag size="small" effect="plain" type="info">当前社区：{{ communityName || resolvedCommunityId }}</el-tag>
          <el-tag v-if="sectionName" size="small" effect="plain">当前板块：{{ sectionName }}</el-tag>
        </div>
        </div>
      </div>
      <div>
        <el-button @click="addWidget">+ 添加控件</el-button>
        <el-button type="primary" @click="save" :loading="saving" :disabled="listCount > 3">保存</el-button>
      </div>
    </div>
    <div v-else class="embedded-summary">
      <div>
        <strong>{{ sectionName || '当前板块' }}</strong>
        <span>使用低代码方式配置字段、列表展示和控件属性。</span>
      </div>
      <el-button size="small" @click="addWidget">+ 添加控件</el-button>
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
    <el-alert
      v-if="isGuideNoteTemplate"
      type="info"
      :closable="false"
      style="margin-bottom: 16px;"
      title="图文攻略固定控件"
      description="标题、封面/图片、距离、最高海拔、累计爬升、参考用时、正文、两步路轨迹编号、目的地位置为固定结构；正文使用富图文排版能力，支持换行和基础格式，但不支持插图。图片请上传到封面/图片。固定控件不能删除、改类型或调整顺序。"
    />
    <el-alert
      v-if="isImageNoteTemplate"
      type="info"
      :closable="false"
      style="margin-bottom: 16px;"
      title="图文_new 固定控件"
      description="添加图片、主题、正文、话题、设置地点为固定结构；固定控件不能删除、改类型或调整顺序。"
    />

    <div class="low-code-workbench">
      <section class="widget-list-panel">
        <div class="panel-head">
          <div>
            <h4>控件列表</h4>
            <p>从上到下就是发帖/详情页的字段顺序。</p>
          </div>
          <el-button size="small" @click="addWidget">+ 添加一行控件</el-button>
        </div>
        <el-table
          :data="widgets"
          row-key="widgetId"
          highlight-current-row
          border
          class="widget-config-table"
          @current-change="selectWidget"
        >
          <el-table-column label="#" width="82" align="center">
            <template #default="{ $index, row }">
              <div class="order-actions">
                <span>{{ $index + 1 }}</span>
                <el-button size="small" link :disabled="$index === 0 || isLockedWidget(row)" @click.stop="moveWidget($index, -1)">上移</el-button>
                <el-button size="small" link :disabled="$index === widgets.length - 1 || isLockedWidget(row)" @click.stop="moveWidget($index, 1)">下移</el-button>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="控件类型" min-width="170">
            <template #default="{ row }">
              <el-select v-model="row.type" :disabled="isLockedWidget(row) || !row._isNew" @change="handleTypeChange(row)">
                <el-option label="短文字" value="short_text" />
                <el-option label="一句话简介" value="summary" />
                <el-option label="日期时间" value="datetime" />
                <el-option label="数字" value="number" />
                <el-option label="图片组" value="image_group" />
                <el-option label="富图文" value="rich_note" />
                <el-option label="话题" value="topic" />
                <el-option v-if="row.type === 'note_blocks'" label="图文笔记（旧）" value="note_blocks" />
                <el-option label="视频组" value="video_group" />
                <el-option label="音频组" value="audio_group" />
                <el-option v-if="row.type === 'rich_text'" label="富文本（旧）" value="rich_text" />
                <el-option label="地图位置" value="location" />
                <el-option label="活动召集" value="activity_invite" :disabled="sectionType !== 'evergreen'" />
                <el-option label="活动参与" value="attendance" :disabled="sectionType !== 'realtime'" />
                <el-option label="公告内容" value="admin_notice" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="标签名" min-width="210">
            <template #default="{ row }">
              <el-input v-model="row.label" :disabled="isLockedWidget(row)" placeholder="例如：目的地、联系电话" />
            </template>
          </el-table-column>
          <el-table-column label="必填" width="90" align="center">
            <template #default="{ row }">
              <el-switch v-model="row.required" :disabled="isLockedWidget(row) || ['attendance', 'admin_notice', 'activity_invite'].includes(row.type)" />
            </template>
          </el-table-column>
          <el-table-column width="150" align="center">
            <template #header>
              <span>帖子列表</span>
              <el-tooltip placement="top" effect="dark" content="开启：会显示在帖子列表卡片摘要（最多 3 个）；关闭：只在帖子详情里展示。">
                <el-icon class="help-icon"><WarningFilled /></el-icon>
              </el-tooltip>
            </template>
            <template #default="{ row }">
              <el-switch
                v-model="row.showInList"
                :disabled="isLockedWidget(row) || row.type === 'admin_notice' || row.type === 'activity_invite' || !isListDisplayable(row.type)"
              />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="100" align="center">
            <template #default="{ row }">
              <el-button type="danger" link :disabled="isLockedWidget(row)" @click.stop="removeWidget(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="widgets.length === 0" description="暂无控件，点击“添加控件”开始配置" />
      </section>

      <aside class="property-panel">
        <template v-if="selectedWidget">
          <div class="panel-head compact">
            <div>
              <h4>属性配置</h4>
              <p>当前：{{ selectedWidget.label || defaultLabel(selectedWidget.type) }}</p>
            </div>
            <el-tag v-if="isLockedWidget(selectedWidget)" type="info" effect="plain">固定</el-tag>
          </div>

          <el-form label-width="86px" class="property-form">
            <el-form-item label="控件类型">
              <el-select v-model="selectedWidget.type" :disabled="isLockedWidget(selectedWidget) || !selectedWidget._isNew" @change="handleTypeChange(selectedWidget)">
                <el-option label="短文字" value="short_text" />
                <el-option label="一句话简介" value="summary" />
                <el-option label="日期时间" value="datetime" />
                <el-option label="数字" value="number" />
                <el-option label="图片组" value="image_group" />
                <el-option label="富图文" value="rich_note" />
                <el-option label="话题" value="topic" />
                <el-option v-if="selectedWidget.type === 'note_blocks'" label="图文笔记（旧）" value="note_blocks" />
                <el-option label="视频组" value="video_group" />
                <el-option label="音频组" value="audio_group" />
                <el-option v-if="selectedWidget.type === 'rich_text'" label="富文本（旧）" value="rich_text" />
                <el-option label="地图位置" value="location" />
                <el-option label="活动召集" value="activity_invite" :disabled="sectionType !== 'evergreen'" />
                <el-option label="活动参与" value="attendance" :disabled="sectionType !== 'realtime'" />
                <el-option label="公告内容" value="admin_notice" />
              </el-select>
            </el-form-item>

            <el-form-item label="标签名">
              <el-input v-model="selectedWidget.label" :disabled="isLockedWidget(selectedWidget)" />
            </el-form-item>

            <el-form-item v-if="selectedWidget.type === 'admin_notice'" label="公告正文">
              <div class="notice-editor">
                <el-input
                  v-model="selectedWidget.noticeContent"
                  type="textarea"
                  :rows="6"
                  maxlength="500"
                  show-word-limit
                  placeholder="例如：近期课程安排、报名说明、固定提醒等。"
                />
                <span class="notice-tip">仅管理员维护，普通成员不能通过发帖修改。支持 emoji；内容较长时首页只展示摘要，可点击查看全文。</span>
              </div>
            </el-form-item>

            <el-form-item v-if="selectedWidget.type === 'attendance'" label="人数上限">
              <el-input-number
                v-model="selectedWidget.capacity"
                :min="1"
                :step="1"
                :precision="0"
                placeholder="不填表示不限"
              />
            </el-form-item>

            <el-form-item v-else-if="selectedWidget.type === 'admin_notice'" label="发布方式">
              <el-tag type="info" effect="plain">管理员维护，不开放发帖</el-tag>
            </el-form-item>

            <el-form-item v-else-if="selectedWidget.type === 'activity_invite'" label="使用方式">
              <el-tag type="info" effect="plain">详情页操作入口，不进入帖子正文</el-tag>
            </el-form-item>

            <el-form-item v-else label="必填">
              <el-switch v-model="selectedWidget.required" :disabled="isLockedWidget(selectedWidget)" />
            </el-form-item>

            <el-form-item>
              <template #label>
                <span>列表展示</span>
                <el-tooltip placement="top" effect="dark" content="开启：会显示在帖子列表卡片摘要（最多 3 个）；关闭：只在帖子详情里展示。">
                  <el-icon class="help-icon"><WarningFilled /></el-icon>
                </el-tooltip>
              </template>
              <el-switch
                v-model="selectedWidget.showInList"
                :disabled="isLockedWidget(selectedWidget) || selectedWidget.type === 'admin_notice' || selectedWidget.type === 'activity_invite' || !isListDisplayable(selectedWidget.type)"
              />
            </el-form-item>
          </el-form>

          <div class="property-note">
            <template v-if="selectedWidget.type === 'attendance'">活动参与会在详情页展示参与按钮和头像名单；可选择是否进入列表摘要。</template>
            <template v-else-if="selectedWidget.type === 'admin_notice'">公告内容显示在小程序首页板块区域，不需要普通成员发帖。</template>
            <template v-else-if="selectedWidget.type === 'activity_invite'">活动召集只在沉淀帖详情中显示入口，会联动到实时邀约帖子。</template>
            <template v-else-if="selectedWidget.type === 'audio_group'">音频只在帖子详情页播放，不进入列表摘要。</template>
            <template v-else-if="selectedWidget.type === 'topic'">话题以 # 标签形式填写，最多 5 个，每个不超过 20 个字符。</template>
            <template v-else-if="!isListDisplayable(selectedWidget.type)">该类型只在详情页展示。</template>
            <template v-else>建议只把最关键字段展示到列表，最多 3 个，避免卡片过高。</template>
          </div>
        </template>
        <el-empty v-else description="请选择左侧一个控件" />
      </aside>
    </div>

    <div class="editor-footer">
      <span>保存前会检查历史帖子影响；删除控件后旧数据不会立刻丢失，但默认不再展示。</span>
      <el-button type="primary" @click="save" :loading="saving" :disabled="listCount > 3">保存</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { v4 as uuidv4 } from 'uuid'
import { ElMessage } from 'element-plus/es/components/message/index'
import { ElMessageBox } from 'element-plus/es/components/message-box/index'
import { ArrowLeft, WarningFilled } from '@element-plus/icons-vue'
import { communityApi, sectionApi } from '../../api/cloud'

const props = withDefaults(defineProps<{
  sectionId?: string
  communityId?: string
  embedded?: boolean
}>(), {
  sectionId: '',
  communityId: '',
  embedded: false,
})
const emit = defineEmits<{
  saved: []
}>()
const route = useRoute()
const router = useRouter()
const resolvedSectionId = computed(() => props.sectionId || String(route.params.sectionId || ''))
const resolvedCommunityId = computed(() => props.communityId || String(route.query.communityId || ''))
const embedded = computed(() => props.embedded)
const widgets = ref<any[]>([])
const originalWidgets = ref<any[]>([])
const saving = ref(false)
const selectedWidgetId = ref('')
const communityName = ref('')
const sectionName = ref('')
const sectionType = ref<'realtime' | 'evergreen'>('evergreen')
const sectionDisplayTemplate = ref<'default' | 'guide_note' | 'image_note'>('default')
const GUIDE_NOTE_LOCKED_WIDGET_IDS = new Set([
  'guide_title',
  'guide_images',
  'guide_distance',
  'guide_highest_altitude',
  'guide_total_climb',
  'guide_reference_duration',
  'guide_drive_duration',
  'guide_body',
  'guide_liangbulu_track_id',
  'guide_location',
  'guide_activity_invite',
])
const IMAGE_NOTE_LOCKED_WIDGET_IDS = new Set([
  'image_note_images',
  'image_note_title',
  'image_note_body',
  'image_note_topics',
  'image_note_location',
])
const LIST_DISPLAYABLE_TYPES = [
  'short_text',
  'summary',
  'datetime',
  'number',
  'attendance',
] as const
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
  topic: '话题',
  location: '位置',
  activity_invite: '活动召集',
  attendance: '活动参与',
  admin_notice: '公告',
}

const listCount = computed(() => widgets.value.filter((widget) => widget.showInList).length)
const isGuideNoteTemplate = computed(() => sectionDisplayTemplate.value === 'guide_note')
const isImageNoteTemplate = computed(() => sectionDisplayTemplate.value === 'image_note')
const selectedWidget = computed(() => widgets.value.find((widget) => String(widget.widgetId || '') === selectedWidgetId.value) || null)

function isListDisplayable(type: string) {
  return (LIST_DISPLAYABLE_TYPES as readonly string[]).includes(type)
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

function isLockedWidget(widget: any) {
  const widgetId = String(widget?.widgetId || '')
  if (isGuideNoteTemplate.value) {
    return widget?.locked === true || GUIDE_NOTE_LOCKED_WIDGET_IDS.has(widgetId)
  }
  if (isImageNoteTemplate.value) {
    return widget?.locked === true || IMAGE_NOTE_LOCKED_WIDGET_IDS.has(widgetId)
  }
  return false
}

onMounted(async () => {
  try {
    await loadCommunityContext()
    const sectionId = resolvedSectionId.value
    if (!sectionId) {
      ElMessage.error('缺少 sectionId，无法加载控件')
      return
    }
    const res = await sectionApi.get(sectionId) as any
    sectionName.value = String(res.section?.name || '')
    sectionType.value = res.section?.type === 'realtime' ? 'realtime' : 'evergreen'
    sectionDisplayTemplate.value = res.section?.displayTemplate === 'guide_note'
      ? 'guide_note'
      : res.section?.displayTemplate === 'image_note'
        ? 'image_note'
        : 'default'
    widgets.value = (res.section?.widgets ?? []).map((widget: any, index: number) => ({
      ...widget,
      label: widget?.type === 'attendance' && shouldClearAttendanceLabel(widget?.label)
        ? ''
        : String(widget?.label || ''),
      fieldKey: resolveFieldKey(widget, index),
      required: ['attendance', 'admin_notice', 'activity_invite'].includes(widget?.type) ? false : !!widget.required,
      showInList: isListDisplayable(widget?.type) ? !!widget.showInList : false,
      noticeContent: widget?.type === 'admin_notice' ? String(widget.noticeContent || '') : undefined,
      locked: !!widget.locked,
      _isNew: false,
    }))
    selectedWidgetId.value = String(widgets.value[0]?.widgetId || '')
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
  const widget = {
    widgetId: uuidv4(),
    type: nextType,
    label: defaultLabel(nextType),
    fieldKey: `field_${Date.now()}`,
    required: false,
    order: widgets.value.length,
    showInList: false,
    capacity: undefined,
    noticeContent: '',
    locked: false,
    _isNew: true,
  }
  widgets.value.push(widget)
  selectedWidgetId.value = widget.widgetId
}

async function loadCommunityContext() {
  if (!resolvedCommunityId.value) {
    communityName.value = ''
    return
  }
  try {
    const res = await communityApi.list() as any
    const current = (res.communities ?? []).find((community: any) => String(community?._id || community?.id || '') === resolvedCommunityId.value)
    communityName.value = String(current?.name || '')
  } catch {
    communityName.value = ''
  }
}

function selectWidget(widget: any) {
  if (!widget) return
  selectedWidgetId.value = String(widget.widgetId || '')
}

function moveWidget(index: number, delta: number) {
  const nextIndex = index + delta
  if (nextIndex < 0 || nextIndex >= widgets.value.length) return
  const current = widgets.value[index]
  const next = widgets.value[nextIndex]
  if (isLockedWidget(current) || isLockedWidget(next)) {
    ElMessage.warning('固定模板控件不能调整顺序')
    return
  }
  const [widget] = widgets.value.splice(index, 1)
  widgets.value.splice(nextIndex, 0, widget)
  selectedWidgetId.value = String(widget.widgetId || '')
}

function goBackToSections() {
  if (resolvedCommunityId.value) {
    router.push({ name: 'sections', params: { communityId: resolvedCommunityId.value } })
    return
  }
  router.push({ name: 'communities' })
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
  } else if (widget.type === 'activity_invite') {
    widget.required = false
    widget.showInList = false
    widget.capacity = undefined
    widget.noticeContent = undefined
  } else {
    widget.capacity = undefined
    widget.noticeContent = undefined
    if (!isListDisplayable(widget.type)) widget.showInList = false
  }
}

function removeWidget(widget: any) {
  if (isLockedWidget(widget)) {
    ElMessage.warning('固定模板控件不能删除')
    return
  }
  const index = widgets.value.findIndex((item) => item.widgetId === widget.widgetId)
  widgets.value = widgets.value.filter((item) => item.widgetId !== widget.widgetId)
  if (selectedWidgetId.value === String(widget.widgetId || '')) {
    const next = widgets.value[Math.min(index, widgets.value.length - 1)]
    selectedWidgetId.value = String(next?.widgetId || '')
  }
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
  const sectionId = resolvedSectionId.value
  const communityId = resolvedCommunityId.value
  if (!sectionId) {
    ElMessage.error('缺少 sectionId，无法保存')
    return
  }
  if (!communityId) {
    ElMessage.error('缺少 communityId，无法保存')
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
      required: ['attendance', 'admin_notice', 'activity_invite'].includes(widget.type) ? false : !!widget.required,
      showInList: widget.type === 'activity_invite' ? false : (isListDisplayable(widget.type) ? !!widget.showInList : false),
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
    emit('saved')
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

.header-left {
  display: flex;
  align-items: flex-start;
  gap: 12px;
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

.embedded-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #f8fafc;
}

.embedded-summary div {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.embedded-summary span {
  color: #909399;
  font-size: 13px;
}

.low-code-workbench {
  display: grid;
  grid-template-columns: minmax(520px, 1fr) 320px;
  gap: 16px;
  align-items: start;
}

.widget-list-panel,
.property-panel {
  border: 1px solid #e4e7ed;
  border-radius: 10px;
  background: #fff;
}

.widget-list-panel {
  min-width: 0;
  overflow: hidden;
}

.property-panel {
  position: sticky;
  top: 12px;
  padding: 14px;
}

.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  border-bottom: 1px solid #ebeef5;
}

.panel-head.compact {
  padding: 0 0 12px;
  border-bottom: 0;
}

.panel-head h4 {
  margin: 0 0 4px;
}

.panel-head p {
  margin: 0;
  color: #909399;
  font-size: 12px;
  line-height: 1.5;
}

.widget-config-table {
  border-left: 0;
  border-right: 0;
}

.order-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.property-form {
  margin-top: 4px;
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
  width: 100%;
  max-width: 100%;
}

.notice-tip {
  display: block;
  margin-top: 6px;
  color: #909399;
  font-size: 12px;
}

.property-note {
  margin-top: 12px;
  padding: 10px;
  border: 1px solid #f5dab1;
  border-radius: 8px;
  background: #fdf6ec;
  color: #8a5a1f;
  font-size: 12px;
  line-height: 1.6;
}

.editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 16px;
  padding: 12px 14px;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  background: #fafafa;
}

.editor-footer span {
  color: #909399;
  font-size: 12px;
}

@media (max-width: 1100px) {
  .low-code-workbench {
    grid-template-columns: 1fr;
  }

  .property-panel {
    position: static;
  }
}

@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
  }

  .header-left,
  .embedded-summary,
  .embedded-summary div,
  .editor-footer {
    align-items: stretch;
    flex-direction: column;
  }

}
</style>
