<template>
  <div class="post-create-admin">
    <div class="page-header">
      <el-breadcrumb separator="/">
        <el-breadcrumb-item :to="{ name: 'communities' }">社区管理</el-breadcrumb-item>
        <el-breadcrumb-item :to="{ name: 'posts', params: { communityId } }">{{ communityName || '当前社区' }}</el-breadcrumb-item>
        <el-breadcrumb-item>新建帖子</el-breadcrumb-item>
      </el-breadcrumb>
      <h3>代发帖子</h3>
      <el-alert
        v-if="!authReady"
        type="warning"
        :closable="false"
        show-icon
        title="当前管理员账号未绑定微信身份"
        description="代发帖前需要先在『管理员账号』里给本账号 bindWechat（绑定 openId），否则发布会失败。绑定后，发出的帖子将以您的微信身份作为作者展示。"
      />
    </div>

    <el-card v-loading="loadingSection" shadow="never">
      <el-form label-width="120px">
        <el-form-item label="选择板块" required>
          <el-select v-model="sectionId" placeholder="请选择板块" style="width: 320px;" @change="onSectionChange">
            <el-option
              v-for="s in sections"
              :key="s._id"
              :label="`${s.name}${s.type === 'realtime' ? ' (实时)' : ''}`"
              :value="s._id"
            />
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
                v-for="(item, i) in (formData[widget.widgetId] as any[])"
                :key="item.itemId"
                :index="i"
                v-model="(formData[widget.widgetId] as any[])[i]"
                @remove="removeVideoItem(widget.widgetId, i)"
              />
              <el-button @click="addVideoItem(widget.widgetId)" :icon="Plus">添加视频条目</el-button>
            </template>

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

            <div v-else class="muted-tip">
              该控件类型（{{ widget.type }}）暂不支持后台代发，请使用小程序发帖。
            </div>
          </div>

          <div class="actions">
            <el-button @click="$router.back()">取消</el-button>
            <el-button
              type="primary"
              :loading="submitting"
              :disabled="!sectionId || editableWidgets.length === 0"
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
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { communityApi, sectionApi, postAdminApi } from '../../api/cloud'
import { useAuthStore } from '../../stores/auth'
import VideoItemEditor from '../../components/VideoItemEditor.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const communityId = String(route.params.communityId || '')
const initialSectionId = String(route.query.sectionId || '')

const sections = ref<any[]>([])
const sectionId = ref<string>(initialSectionId)
const section = ref<any>(null)
const formData = reactive<Record<string, any>>({})
const submitting = ref(false)
const loadingSection = ref(false)
const communityName = ref('')
const authReady = computed(() => Boolean(auth.userId))
const ADMIN_CREATABLE_WIDGET_TYPES = new Set(['short_text', 'summary', 'number', 'datetime', 'rich_text', 'video_group'])

const editableWidgets = computed(() =>
  ((section.value?.widgets || []) as any[]).filter((w) => ADMIN_CREATABLE_WIDGET_TYPES.has(String(w.type || '')))
)

function widgetHint(type: string) {
  if (type === 'video_group') return '由管理员上传 / 配置视频列表'
  if (type === 'attendance') return '（活动参与控件，由用户参与产生数据，不在此填写）'
  return ''
}

onMounted(async () => {
  await Promise.all([loadCommunityName(), loadSections()])
  if (sectionId.value) await loadSection(sectionId.value)
})

async function loadCommunityName() {
  try {
    const res = await communityApi.list() as any
    const current = (res.communities || []).find((c: any) => String(c?._id || c?.id || '') === communityId)
    communityName.value = String(current?.name || '')
  } catch {
    communityName.value = ''
  }
}

async function loadSections() {
  try {
    const res = await sectionApi.list(communityId) as any
    sections.value = res.sections || []
  } catch (err: any) {
    ElMessage.error(err?.message || '加载板块失败')
  }
}

async function onSectionChange(id: string) {
  sectionId.value = id
  await loadSection(id)
}

async function loadSection(id: string) {
  loadingSection.value = true
  try {
    const res = await sectionApi.get(id) as any
    section.value = res.section || null
    Object.keys(formData).forEach((k) => delete formData[k])
    for (const w of editableWidgets.value) {
      if (w.type === 'video_group') formData[w.widgetId] = []
      else if (w.type === 'number') formData[w.widgetId] = 0
      else formData[w.widgetId] = ''
    }
  } catch (err: any) {
    ElMessage.error(err?.message || '加载板块失败')
    section.value = null
  } finally {
    loadingSection.value = false
  }
}

function addVideoItem(widgetId: string) {
  const list = (formData[widgetId] as any[]) || []
  list.push({
    itemId: uuidv4(),
    source: 'cos',
    title: '',
    duration: undefined,
    description: '',
    cover: '',
    fileID: '',
    allowDownload: true,
    allowShare: true,
  })
  formData[widgetId] = list
}

function removeVideoItem(widgetId: string, index: number) {
  const list = (formData[widgetId] as any[]) || []
  list.splice(index, 1)
  formData[widgetId] = [...list]
}

async function submit() {
  if (!sectionId.value) {
    ElMessage.warning('请先选择板块')
    return
  }

  for (const w of editableWidgets.value) {
    if (w.type !== 'video_group') continue
    const list = (formData[w.widgetId] as any[]) || []
    for (const [i, item] of list.entries()) {
      if (!item.title) {
        ElMessage.error(`「${w.label}」第 ${i + 1} 条视频的标题为空`)
        return
      }
      if (item.source === 'cos' && !item.fileID) {
        ElMessage.error(`「${w.label}」第 ${i + 1} 条视频未上传文件`)
        return
      }
      if (item.source === 'channels_feed' && (!item.finderUserName || !item.feedId)) {
        ElMessage.error(`「${w.label}」第 ${i + 1} 条视频号 feed 信息不全`)
        return
      }
      if (item.source === 'channels_live' && (!item.finderUserName || !item.nonceId)) {
        ElMessage.error(`「${w.label}」第 ${i + 1} 条视频号直播信息不全`)
        return
      }
      if (item.source === 'miniprogram' && !item.appId) {
        ElMessage.error(`「${w.label}」第 ${i + 1} 条小程序 appId 为空`)
        return
      }
      if ((item.source === 'h5' || item.source === 'app_link') && !item.url) {
        ElMessage.error(`「${w.label}」第 ${i + 1} 条 URL 为空`)
        return
      }
    }
  }

  submitting.value = true
  try {
    await postAdminApi.createAdmin({
      communityId,
      sectionId: sectionId.value,
      content: { ...formData },
    })
    ElMessage.success('发布成功')
    router.push({ name: 'posts', params: { communityId } })
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || err?.message || '发布失败')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.post-create-admin { padding: 0; }
.page-header { margin-bottom: 16px; }
.page-header h3 { margin: 10px 0; }
.widget-block { margin: 18px 0; }
.widget-label { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; font-weight: 600; }
.widget-label .req { color: #f56c6c; }
.muted-tip { color: #909399; font-size: 12px; font-weight: normal; }
.actions { display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px; padding-top: 16px; border-top: 1px solid #ebeef5; }
</style>
