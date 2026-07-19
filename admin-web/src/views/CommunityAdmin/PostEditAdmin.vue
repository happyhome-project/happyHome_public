<template>
  <div class="post-edit-admin">
    <div class="page-header">
      <div class="page-header-top">
        <el-button :icon="ArrowLeft" circle title="返回帖子管理" @click="goToPosts" />
        <div>
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ name: 'communities' }">社区管理</el-breadcrumb-item>
            <el-breadcrumb-item :to="{ name: 'posts', params: { communityId } }">{{ communityName || '当前社区' }}</el-breadcrumb-item>
            <el-breadcrumb-item>编辑帖子</el-breadcrumb-item>
          </el-breadcrumb>
          <h3>编辑帖子</h3>
        </div>
      </div>
    </div>

    <el-card v-loading="loading" shadow="never">
      <template v-if="post && section">
        <el-descriptions :column="2" border class="meta-box">
          <el-descriptions-item label="当前社区">{{ communityName || communityId }}</el-descriptions-item>
          <el-descriptions-item label="所在板块">{{ section.name || post.sectionName || post.sectionId }}</el-descriptions-item>
          <el-descriptions-item label="原作者">
            {{ post.authorNickname || '未设置昵称' }}
            <span class="sub-text"> / {{ post.authorId }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="发布时间">{{ formatAdminDateTime(post.createdAt) }}</el-descriptions-item>
          <el-descriptions-item label="最后编辑" :span="2">
            <template v-if="post.adminEditedAt">
              {{ post.adminEditedByUsername || post.adminEditedByAccountId || '管理员' }}
              <span class="sub-text"> / {{ formatAdminDateTime(post.adminEditedAt) }}</span>
            </template>
            <span v-else class="sub-text">暂无后台编辑记录</span>
          </el-descriptions-item>
        </el-descriptions>

        <el-alert
          v-if="unsupportedWidgets.length > 0"
          class="unsupported-alert"
          type="info"
          :closable="false"
          show-icon
          title="部分控件当前后台暂不支持编辑"
          description="保存时会保留这些控件的原值；已从板块配置中删除的旧字段会按当前结构自动清理。"
        />

        <div v-for="widget in editableWidgets" :key="widget.widgetId" class="widget-block">
          <div class="widget-label">
            <span>{{ widget.label }}</span>
            <span v-if="widget.required" class="req">*</span>
            <span class="muted-tip">{{ widgetHint(widget.type) }}</span>
          </div>

          <template v-if="widget.type === 'video_group'">
            <VideoItemEditor
              v-for="(item, index) in (formData[widget.widgetId] as any[])"
              :key="item.itemId || index"
              :index="index"
              :cos-only="isArchiveVideoPost"
              v-model="(formData[widget.widgetId] as any[])[index]"
              @remove="removeVideoItem(widget.widgetId, index)"
            />
            <el-button
              v-if="!isArchiveVideoPost || (formData[widget.widgetId] as any[]).length === 0"
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

        <div v-if="unsupportedWidgets.length > 0" class="readonly-blocks">
          <div v-for="widget in unsupportedWidgets" :key="widget.widgetId" class="readonly-block">
            <div class="widget-label">
              <span>{{ widget.label || widget.type }}</span>
              <span class="muted-tip">当前后台暂不支持编辑，保存时会保留原值</span>
            </div>
            <div class="readonly-value">{{ formatReadonlyContentValue(post.content?.[widget.widgetId]) }}</div>
          </div>
        </div>

        <div class="actions">
          <el-button @click="router.push({ name: 'posts', params: { communityId } })">返回帖子管理</el-button>
          <el-button type="primary" :loading="submitting" :disabled="editableWidgets.length === 0" @click="submit">
            保存修改
          </el-button>
        </div>
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
import { communityApi, postAdminApi } from '../../api/cloud'
import AudioGroupEditor from '../../components/AudioGroupEditor.vue'
import ImageGroupAdminEditor from '../../components/ImageGroupAdminEditor.vue'
import LocationAdminEditor from '../../components/LocationAdminEditor.vue'
import NoteBlocksAdminEditor from '../../components/NoteBlocksAdminEditor.vue'
import RichNoteAdminEditor from '../../components/RichNoteAdminEditor.vue'
import TopicAdminEditor from '../../components/TopicAdminEditor.vue'
import VideoItemEditor from '../../components/VideoItemEditor.vue'
import { formatAdminDateTime } from '../../utils/datetime'
import {
  createDefaultVideoItem,
  editableWidgetsFor,
  formatReadonlyContentValue,
  hydrateAdminPostFormData,
  serializeAdminPostFormData,
  unsupportedContentWidgetsFor,
  validateAdminPostForm,
  widgetHint,
} from '../../utils/postAdminForm'

const route = useRoute()
const router = useRouter()

const communityId = String(route.params.communityId || '')
const postId = String(route.params.postId || '')
const loading = ref(false)
const submitting = ref(false)
const post = ref<any>(null)
const section = ref<any>(null)
const communityName = ref('')
const formData = reactive<Record<string, any>>({})

function goToPosts() {
  router.push({ name: 'posts', params: { communityId } })
}

const editableWidgets = computed(() => editableWidgetsFor(section.value))
const isArchiveVideoPost = computed(() => post.value?.area === 'archive' && post.value?.format === 'video')
const isFixedImageCanvasTemplate = computed(() => ['guide_note', 'image_note'].includes(String(section.value?.displayTemplate || '')))
const unsupportedWidgets = computed(() =>
  unsupportedContentWidgetsFor(section.value).filter((widget) => post.value?.content?.[widget.widgetId] !== undefined)
)

onMounted(async () => {
  await Promise.all([loadCommunityName(), loadPost()])
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

async function loadPost() {
  if (!postId) {
    ElMessage.error('缺少 postId，无法编辑帖子')
    router.push({ name: 'posts', params: { communityId } })
    return
  }
  loading.value = true
  try {
    const res = await postAdminApi.get(postId) as any
    post.value = res.post || null
    section.value = res.section || null
    if (!post.value || !section.value) throw new Error('帖子或板块不存在')
    if (post.value.status === 'deleted') throw new Error('已删除帖子不能编辑')
    hydrateAdminPostFormData(formData, editableWidgets.value, post.value.content || {})
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || err?.message || '加载帖子失败')
    router.push({ name: 'posts', params: { communityId } })
  } finally {
    loading.value = false
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
  if (!post.value || !section.value) return
  if (!validateAdminPostForm(editableWidgets.value, formData)) return

  submitting.value = true
  try {
    const result = await postAdminApi.update(
      post.value._id,
      serializeAdminPostFormData(editableWidgets.value, formData),
    ) as any
    const auditStatus = String(result?.auditStatus || 'pass')
    if (auditStatus === 'pass') {
      ElMessage.success('保存成功')
    } else if (auditStatus === 'rejected') {
      ElMessage.error(result?.auditReason || '修改未通过审核，原内容已保留')
    } else {
      ElMessage.warning(auditStatus === 'review' ? '修改已提交人工复核，通过后生效' : '修改已提交审核，通过后生效')
    }
    await loadPost()
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || err?.message || '保存失败')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.post-edit-admin { padding: 0; }
.page-header { margin-bottom: 16px; }
.page-header-top { display: flex; align-items: flex-start; gap: 12px; }
.page-header h3 { margin: 10px 0; }
.meta-box { margin-bottom: 16px; }
.sub-text { color: #909399; font-size: 12px; }
.unsupported-alert { margin-bottom: 16px; }
.widget-block { margin: 18px 0; }
.widget-label { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; font-weight: 600; }
.widget-label .req { color: #f56c6c; }
.muted-tip { color: #909399; font-size: 12px; font-weight: normal; }
.readonly-blocks { margin-top: 20px; display: grid; gap: 12px; }
.readonly-block { border: 1px dashed #dcdfe6; border-radius: 8px; padding: 12px; background: #fafafa; }
.readonly-value { color: #606266; word-break: break-all; white-space: pre-wrap; }
.actions { display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px; padding-top: 16px; border-top: 1px solid #ebeef5; }
</style>
