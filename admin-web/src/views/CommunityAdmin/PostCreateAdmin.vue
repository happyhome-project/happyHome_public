<template>
  <div class="post-create-admin">
    <div class="page-header">
      <div class="page-header-top">
        <el-button :icon="ArrowLeft" circle title="返回帖子管理" @click="goToPosts" />
        <div>
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ name: 'communities' }">社区管理</el-breadcrumb-item>
            <el-breadcrumb-item>
              <span class="breadcrumb-link" tabindex="0" @click="goToPosts" @keydown.enter="goToPosts">
                {{ communityName || '当前社区' }}
              </span>
            </el-breadcrumb-item>
            <el-breadcrumb-item>新建帖子</el-breadcrumb-item>
          </el-breadcrumb>
          <h3>代发帖子</h3>
        </div>
      </div>
      <el-alert
        v-if="!authReady"
        type="warning"
        :closable="false"
        show-icon
        title="当前管理员账号未绑定微信身份"
        description="代发帖子前需要先在管理员账号里绑定微信 openId，否则发布会失败。绑定后，发出的帖子会以该微信身份作为作者展示。"
      />
    </div>

    <el-card v-loading="loadingSection" shadow="never">
      <el-form label-width="120px">
        <el-form-item label="发布类型" required>
          <el-select v-model="publishTargetKey" placeholder="请选择发布类型" style="width: 360px;" @change="onPublishTargetChange">
            <el-option-group label="沉淀内容">
              <el-option label="图文（图片 + 正文）" value="archive:image_text:rich" />
              <el-option label="图片（图片 + 标题）" value="archive:image_text:image" />
              <el-option label="视频" value="archive:video" />
            </el-option-group>
            <el-option-group v-if="activeCollaborationTemplates.length" label="实时协作">
              <el-option
                v-for="template in activeCollaborationTemplates"
                :key="template._id"
                :label="template.name"
                :value="`collaboration:${template._id}`"
              />
            </el-option-group>
            <el-option-group v-if="sections.length" label="原板块（兼容）">
              <el-option
                v-for="sectionItem in sections"
                :key="sectionItem._id"
                :label="sectionItem.name"
                :value="`legacy:${sectionItem._id}`"
              />
            </el-option-group>
          </el-select>
        </el-form-item>
      </el-form>

      <template v-if="section">
        <el-empty
          v-if="editableWidgets.length === 0"
          description="该板块暂未配置可填写的控件，请先去板块管理添加控件"
        />
        <template v-else>
          <div v-for="widget in editableWidgets" :key="widget.widgetId" class="widget-block">
            <div class="widget-label">
              <span>{{ widget.label }}</span>
              <span v-if="widget.required" class="req">*</span>
              <span class="muted-tip">{{ widgetHint(widget.type) }}</span>
            </div>

            <template v-if="widget.type === 'video_group'">
              <VideoItemEditor
                v-for="(item, index) in (formData[widget.widgetId] as any[])"
                :key="item.itemId"
                :index="index"
                :cos-only="isArchiveVideoTarget"
                v-model="(formData[widget.widgetId] as any[])[index]"
                @remove="removeVideoItem(widget.widgetId, index)"
              />
              <el-button
                v-if="!isArchiveVideoTarget || (formData[widget.widgetId] as any[]).length === 0"
                :icon="Plus"
                @click="addVideoItem(widget.widgetId)"
              >添加视频条目</el-button>
            </template>

            <AudioGroupEditor v-else-if="widget.type === 'audio_group'" v-model="formData[widget.widgetId] as any" />
            <NoteBlocksAdminEditor v-else-if="widget.type === 'note_blocks'" v-model="formData[widget.widgetId] as any" />
            <RichNoteAdminEditor
              v-else-if="widget.type === 'rich_note'"
              v-model="formData[widget.widgetId] as any"
              :allow-images="!isFixedImageCanvasTemplate"
            />
            <ImageGroupAdminEditor v-else-if="widget.type === 'image_group'" v-model="formData[widget.widgetId] as any" />
            <TopicAdminEditor v-else-if="widget.type === 'topic'" v-model="formData[widget.widgetId] as any" />
            <LocationAdminEditor v-else-if="widget.type === 'location'" v-model="formData[widget.widgetId] as any" />

            <el-input
              v-else-if="widget.type === 'short_text' || widget.type === 'summary'"
              v-model="formData[widget.widgetId] as any"
              :placeholder="widget.label"
              style="max-width: 480px;"
            />

            <el-input-number
              v-else-if="widget.type === 'number'"
              v-model="formData[widget.widgetId] as any"
              :min="0"
              :precision="0"
            />

            <el-date-picker
              v-else-if="widget.type === 'datetime'"
              v-model="formData[widget.widgetId] as any"
              type="datetime"
              value-format="YYYY-MM-DDTHH:mm:00"
              placeholder="选择日期时间"
            />

            <el-input
              v-else-if="widget.type === 'rich_text'"
              v-model="formData[widget.widgetId] as any"
              type="textarea"
              :rows="6"
              placeholder="支持纯文本，HTML 标签会被原样展示"
            />
          </div>

          <div class="actions">
            <el-button @click="$router.back()">取消</el-button>
            <el-button
              type="primary"
              :loading="submitting"
              :disabled="!publishTargetKey || editableWidgets.length === 0"
              @click="submit"
            >
              发布
            </el-button>
          </div>
        </template>
      </template>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { v4 as uuidv4 } from 'uuid'
import { ElMessage } from 'element-plus/es/components/message/index'
import { ArrowLeft, Plus } from '@element-plus/icons-vue'
import { collaborationTemplateApi, communityApi, postAdminApi, sectionApi, type AdminPostCreateParams } from '../../api/cloud'
import { useAuthStore } from '../../stores/auth'
import AudioGroupEditor from '../../components/AudioGroupEditor.vue'
import ImageGroupAdminEditor from '../../components/ImageGroupAdminEditor.vue'
import LocationAdminEditor from '../../components/LocationAdminEditor.vue'
import NoteBlocksAdminEditor from '../../components/NoteBlocksAdminEditor.vue'
import RichNoteAdminEditor from '../../components/RichNoteAdminEditor.vue'
import TopicAdminEditor from '../../components/TopicAdminEditor.vue'
import VideoItemEditor from '../../components/VideoItemEditor.vue'
import {
  createDefaultVideoItem,
  editableWidgetsFor,
  hydrateAdminPostFormData,
  serializeAdminPostFormData,
  validateAdminPostForm,
  widgetHint,
} from '../../utils/postAdminForm'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const communityId = String(route.params.communityId || '')
const initialSectionId = String(route.query.sectionId || '')

const sections = ref<any[]>([])
const collaborationTemplates = ref<any[]>([])
const publishTargetKey = ref<string>(initialSectionId ? `legacy:${initialSectionId}` : '')
const section = ref<any>(null)
const formData = reactive<Record<string, any>>({})
const submitting = ref(false)
const loadingSection = ref(false)
const communityName = ref('')
const authReady = computed(() => Boolean(auth.userId))

const editableWidgets = computed(() => editableWidgetsFor(section.value))
const activeCollaborationTemplates = computed(() => collaborationTemplates.value.filter((template) => template.status === 'active'))
const isArchiveVideoTarget = computed(() => publishTargetKey.value === 'archive:video')
const isFixedImageCanvasTemplate = computed(() => ['guide_note', 'image_note'].includes(String(section.value?.displayTemplate || '')))

onMounted(async () => {
  await Promise.all([loadCommunityName(), loadPublishTargets()])
  if (publishTargetKey.value) await onPublishTargetChange(publishTargetKey.value)
})

async function loadCommunityName() {
  try {
    const res = await communityApi.list() as any
    const current = (res.communities || []).find((community: any) => String(community?._id || community?.id || '') === communityId)
    communityName.value = String(current?.name || '')
  } catch {
    communityName.value = ''
  }
}

async function loadPublishTargets() {
  try {
    const [sectionRes, templateRes] = await Promise.all([
      sectionApi.list(communityId),
      collaborationTemplateApi.listAdmin(),
    ]) as any[]
    sections.value = sectionRes.sections || []
    collaborationTemplates.value = templateRes.templates || []
  } catch (err: any) {
    ElMessage.error(err?.message || '加载发布类型失败')
  }
}

async function onPublishTargetChange(key: string) {
  publishTargetKey.value = key
  if (key.startsWith('archive:')) {
    section.value = buildArchiveSection(key === 'archive:video' ? 'video' : 'image_text')
    hydrateAdminPostFormData(formData, editableWidgets.value)
    return
  }
  if (key.startsWith('collaboration:')) {
    const templateId = key.slice('collaboration:'.length)
    const template = activeCollaborationTemplates.value.find((item) => item._id === templateId)
    section.value = template ? {
      ...template, communityId, type: 'realtime', displayTemplate: 'default',
    } : null
    hydrateAdminPostFormData(formData, editableWidgets.value)
    return
  }
  await loadSection(key.slice('legacy:'.length))
}

async function loadSection(id: string) {
  loadingSection.value = true
  try {
    const res = await sectionApi.get(id) as any
    section.value = res.section || null
    hydrateAdminPostFormData(formData, editableWidgets.value)
  } catch (err: any) {
    ElMessage.error(err?.message || '加载板块失败')
    section.value = null
  } finally {
    loadingSection.value = false
  }
}

function buildArchiveSection(format: 'image_text' | 'video') {
  const body = { widgetId: 'body', type: 'rich_note', label: '正文', fieldKey: 'body', required: false, order: 2, showInList: false }
  const topics = { widgetId: 'topics', type: 'topic', label: '话题', fieldKey: 'topics', required: false, order: 3, showInList: false }
  const location = { widgetId: 'location', type: 'location', label: '地点', fieldKey: 'location', required: false, order: 4, showInList: false }
  return format === 'video'
    ? {
        name: '视频', communityId, type: 'evergreen', displayTemplate: 'default',
        widgets: [
          { widgetId: 'title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true },
          { ...body, order: 1 },
          { widgetId: 'videos', type: 'video_group', label: '视频', fieldKey: 'videos', required: true, order: 2, showInList: false },
          topics, location,
        ],
      }
    : {
        name: '图文 / 图片', communityId, type: 'evergreen', displayTemplate: 'image_note',
        widgets: [
          { widgetId: 'images', type: 'image_group', label: '图片', fieldKey: 'images', required: true, order: 0, showInList: false },
          { widgetId: 'title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 1, showInList: true },
          body, topics, location,
        ],
      }
}

function addVideoItem(widgetId: string) {
  const list = (formData[widgetId] as any[]) || []
  formData[widgetId] = [...list, createDefaultVideoItem(uuidv4())]
}

function removeVideoItem(widgetId: string, index: number) {
  const list = [...((formData[widgetId] as any[]) || [])]
  list.splice(index, 1)
  formData[widgetId] = list
}

async function submit() {
  if (!publishTargetKey.value) {
    ElMessage.warning('请先选择发布类型')
    return
  }
  if (!validateAdminPostForm(editableWidgets.value, formData)) return

  submitting.value = true
  try {
    const content = serializeAdminPostFormData(editableWidgets.value, formData)
    let payload: AdminPostCreateParams
    if (publishTargetKey.value.startsWith('archive:')) {
      const topics = Array.isArray(content.topics) ? content.topics : []
      delete content.topics
      payload = {
        communityId, area: 'archive',
        format: publishTargetKey.value === 'archive:video' ? 'video' : 'image_text',
        topics, content,
      }
    } else if (publishTargetKey.value.startsWith('collaboration:')) {
      payload = {
        communityId, area: 'collaboration',
        collaborationTemplateId: publishTargetKey.value.slice('collaboration:'.length),
        content,
      }
    } else {
      payload = {
        communityId,
        sectionId: publishTargetKey.value.slice('legacy:'.length),
        content,
      }
    }
    const result = await postAdminApi.createAdmin(payload) as any
    const auditStatus = String(result?.auditStatus || 'pass')
    if (auditStatus === 'pass') {
      ElMessage.success('发布成功')
    } else if (auditStatus === 'rejected') {
      ElMessage.error(result?.auditReason || '内容未通过审核，暂不会公开')
    } else {
      ElMessage.warning(auditStatus === 'review' ? '已提交人工复核，通过后公开' : '已提交审核，通过后公开')
    }
    goToPosts()
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || err?.message || '发布失败')
  } finally {
    submitting.value = false
  }
}

function goToPosts() {
  router.push({ name: 'posts', params: { communityId } })
}
</script>

<style scoped>
.post-create-admin { padding: 0; }
.page-header { margin-bottom: 16px; }
.page-header-top { display: flex; align-items: flex-start; gap: 12px; }
.page-header h3 { margin: 10px 0; }
.widget-block { margin: 18px 0; }
.widget-label { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; font-weight: 600; }
.widget-label .req { color: #f56c6c; }
.muted-tip { color: #909399; font-size: 12px; font-weight: normal; }
.breadcrumb-link { color: inherit; cursor: pointer; }
.breadcrumb-link:hover { color: #409eff; }
.actions { display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px; padding-top: 16px; border-top: 1px solid #ebeef5; }
</style>
