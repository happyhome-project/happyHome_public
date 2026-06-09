<template>
  <div>
    <div class="page-header">
      <div>
        <el-breadcrumb separator="/">
          <el-breadcrumb-item :to="{ name: 'communities' }">社区管理</el-breadcrumb-item>
          <el-breadcrumb-item>{{ communityName || '当前社区' }}</el-breadcrumb-item>
          <el-breadcrumb-item>帖子管理</el-breadcrumb-item>
        </el-breadcrumb>
        <div class="title-row">
          <h3>帖子管理</h3>
          <el-tag size="small" effect="plain" type="info">当前社区：{{ communityName || communityId }}</el-tag>
        </div>
      </div>
      <div class="header-actions">
        <el-button @click="loadPosts" :loading="loading">刷新</el-button>
        <el-button
          type="primary"
          @click="$router.push({
            name: 'post-create-admin',
            params: { communityId },
            query: filters.sectionId ? { sectionId: filters.sectionId } : {}
          })"
        >
          + 新建帖子
        </el-button>
      </div>
    </div>

    <div class="filters">
      <el-select v-model="filters.sectionId" clearable placeholder="按板块筛选" style="width: 220px;">
        <el-option
          v-for="section in sections"
          :key="section._id"
          :label="section.name"
          :value="section._id"
        />
      </el-select>
      <el-input
        v-model="filters.authorQuery"
        clearable
        placeholder="作者昵称或 ID"
        style="width: 220px;"
        @keyup.enter="loadPosts"
      />
      <el-select v-model="filters.status" style="width: 160px;">
        <el-option label="已发布" value="active" />
        <el-option label="已删除" value="deleted" />
        <el-option label="全部状态" value="all" />
      </el-select>
      <el-select v-model="filters.auditStatus" style="width: 150px;">
        <el-option label="全部审核" value="all" />
        <el-option label="审核中" value="pending" />
        <el-option label="需复核" value="review" />
        <el-option label="已通过" value="pass" />
        <el-option label="已拒绝" value="rejected" />
      </el-select>
      <el-select v-model="filters.pinnedStatus" style="width: 140px;">
        <el-option label="全部置顶" value="all" />
        <el-option label="仅置顶" value="true" />
        <el-option label="未置顶" value="false" />
      </el-select>
      <el-select v-model="filters.featuredStatus" style="width: 140px;">
        <el-option label="全部精华" value="all" />
        <el-option label="仅精华" value="true" />
        <el-option label="非精华" value="false" />
      </el-select>
      <el-date-picker
        v-model="dateRange"
        type="daterange"
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        value-format="YYYY-MM-DD"
      />
      <el-button type="primary" @click="loadPosts">查询</el-button>
    </div>

    <el-table :data="posts" v-loading="loading" style="width: 100%;">
      <el-table-column prop="sectionName" label="板块" min-width="120" />
      <el-table-column label="作者" min-width="180">
        <template #default="{ row }">
          <div>{{ row.authorNickname || '未设置昵称' }}</div>
          <div class="sub-text">{{ row.authorId }}</div>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
            {{ row.status === 'active' ? '已发布' : '已删除' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="审核" width="120">
        <template #default="{ row }">
          <el-tag :type="auditTag(row.pendingContent ? row.pendingAuditStatus : row.auditStatus)" size="small">
            {{ auditText(row.pendingContent ? row.pendingAuditStatus : row.auditStatus) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="运营标记" width="130">
        <template #default="{ row }">
          <div class="post-flags">
            <el-tag v-if="row.isPinned" size="small" type="warning">置顶</el-tag>
            <el-tag v-if="row.isFeatured" size="small" type="danger">精华</el-tag>
            <span v-if="!row.isPinned && !row.isFeatured" class="sub-text">无</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="摘要" min-width="320" show-overflow-tooltip>
        <template #default="{ row }">
          {{ getPostSummary(row) }}
        </template>
      </el-table-column>
      <el-table-column label="发布时间" width="180">
        <template #default="{ row }">
          <span>{{ formatAdminDateTime(row.createdAt) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="420">
        <template #default="{ row }">
          <el-button size="small" @click="openDetail(row)">详情</el-button>
          <el-button
            size="small"
            :type="row.isPinned ? 'warning' : 'default'"
            plain
            :disabled="row.status === 'deleted'"
            @click="togglePin(row)"
          >
            {{ row.isPinned ? '取消置顶' : '置顶' }}
          </el-button>
          <el-button
            size="small"
            :type="row.isFeatured ? 'danger' : 'default'"
            plain
            :disabled="row.status === 'deleted'"
            @click="toggleFeature(row)"
          >
            {{ row.isFeatured ? '取消精华' : '加精' }}
          </el-button>
          <el-button
            size="small"
            type="primary"
            plain
            :disabled="row.status === 'deleted'"
            @click="editPost(row)"
          >
            编辑
          </el-button>
          <el-button
            size="small"
            type="danger"
            :disabled="row.status === 'deleted'"
            @click="deletePost(row)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-empty v-if="!loading && posts.length === 0" description="暂无帖子记录" />

    <el-dialog v-model="showDetail" title="帖子详情" width="720px">
      <template v-if="detailPost">
        <div class="detail-meta">
          <div>板块：{{ detailSection?.name || detailPost.sectionName || '未知板块' }}</div>
          <div>作者：{{ detailPost.authorNickname || '未设置昵称' }} / {{ detailPost.authorId }}</div>
          <div>时间：{{ formatAdminDateTime(detailPost.createdAt) }}</div>
          <div class="post-flags">
            <span>运营标记：</span>
            <el-tag v-if="detailPost.isPinned" size="small" type="warning">置顶</el-tag>
            <el-tag v-if="detailPost.isFeatured" size="small" type="danger">精华</el-tag>
            <span v-if="!detailPost.isPinned && !detailPost.isFeatured" class="sub-text">无</span>
          </div>
          <div v-if="detailPost.adminEditedAt">
            最后编辑：{{ detailPost.adminEditedByUsername || detailPost.adminEditedByAccountId || '管理员' }} /
            {{ formatAdminDateTime(detailPost.adminEditedAt) }}
          </div>
          <div class="detail-actions">
            <el-button
              size="small"
              :type="detailPost.isPinned ? 'warning' : 'default'"
              plain
              :disabled="detailPost.status === 'deleted'"
              @click="togglePin(detailPost)"
            >
              {{ detailPost.isPinned ? '取消置顶' : '置顶' }}
            </el-button>
            <el-button
              size="small"
              :type="detailPost.isFeatured ? 'danger' : 'default'"
              plain
              :disabled="detailPost.status === 'deleted'"
              @click="toggleFeature(detailPost)"
            >
              {{ detailPost.isFeatured ? '取消精华' : '加精' }}
            </el-button>
            <el-button
              size="small"
              type="primary"
              plain
              :disabled="detailPost.status === 'deleted'"
              @click="editPost(detailPost)"
            >
              编辑帖子
            </el-button>
          </div>
        </div>

        <el-descriptions :column="1" border>
          <el-descriptions-item
            v-for="field in detailFields"
            :key="field.label"
            :label="field.label"
          >
            <div v-if="field.type === 'video_group'" class="video-detail-list">
              <div
                v-for="(item, index) in videoItems(field.rawValue)"
                :key="item.itemId || index"
                class="video-detail-item"
              >
                <el-image
                  v-if="item.cover"
                  :src="item.cover"
                  class="video-cover"
                  fit="cover"
                  :preview-src-list="[item.cover]"
                  preview-teleported
                />
                <div v-else class="video-cover video-cover-empty">视频</div>
                <div class="video-detail-main">
                  <div class="video-title">{{ item.title || `未命名视频 #${index + 1}` }}</div>
                  <div class="sub-text">来源：{{ videoSourceLabel(item.source) }}</div>
                  <div v-if="item.description" class="sub-text">简介：{{ item.description }}</div>
                  <div v-if="item.duration" class="sub-text">时长：{{ item.duration }} 秒</div>
                  <div class="sub-text video-link" :title="videoPrimaryText(item)">
                    {{ videoPrimaryText(item) }}
                  </div>
                </div>
              </div>
              <span v-if="videoItems(field.rawValue).length === 0">空</span>
            </div>
            <div v-else-if="field.type === 'audio_group'" class="audio-detail-list">
              <div
                v-for="(item, index) in audioItems(field.rawValue)"
                :key="item.fileID || index"
                class="audio-detail-item"
              >
                <div class="audio-title">{{ item.title || `未命名音频 #${index + 1}` }}</div>
                <div class="sub-text">格式：{{ String(item.ext || '').toUpperCase() || '未知' }}</div>
                <div class="sub-text">时长：{{ formatAudioDuration(item.duration) }}</div>
                <div class="sub-text">大小：{{ formatBytes(item.size) }}</div>
                <div class="sub-text video-link" :title="item.fileID">{{ item.fileID }}</div>
              </div>
              <span v-if="audioItems(field.rawValue).length === 0">空</span>
            </div>
            <div v-else-if="field.type === 'rich_note'" class="rich-note-detail">
              <RichNoteAdminPreview v-if="richNoteText(field.rawValue)" :value="field.rawValue" />
              <span v-else>空</span>
            </div>
            <span v-else>{{ field.value }}</span>
          </el-descriptions-item>
        </el-descriptions>

        <div v-for="block in attendanceBlocks" :key="block.widgetId" class="attendance-block">
          <div class="attendance-header">
            <div>
              <div class="attendance-title">{{ block.label }}</div>
              <div class="sub-text">
                {{ block.summary.count }} 人参与
                <span v-if="block.summary.capacity"> / {{ block.summary.capacity }} 人</span>
                <span v-if="block.summary.isFull">，已满员</span>
              </div>
            </div>
          </div>

          <el-table :data="block.members" size="small" border>
            <el-table-column label="参与人" min-width="220">
              <template #default="{ row }">
                <div class="member-cell">
                  <el-avatar :src="row.avatarUrl" :size="28">{{ (row.nickName || row.userId || '?').slice(0, 1) }}</el-avatar>
                  <div>
                    <div>{{ row.nickName || '未设置昵称' }}</div>
                    <div class="sub-text">{{ row.userId }}</div>
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="参与时间" width="180">
              <template #default="{ row }">
                <span>{{ formatAdminDateTime(row.joinedAt) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="110">
              <template #default="{ row }">
                <el-button size="small" type="danger" @click="removeAttendanceMember(block.widgetId, row)">移除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="block.members.length === 0" description="暂无参与人" />
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus/es/components/message/index'
import { ElMessageBox } from 'element-plus/es/components/message-box/index'
import { communityApi, postAdminApi, sectionApi } from '../../api/cloud'
import { formatAdminDateTime } from '../../utils/datetime'
import RichNoteAdminPreview from '../../components/RichNoteAdminPreview.vue'
import { normalizeRichNoteContent } from '../../utils/rich-note'

const route = useRoute()
const router = useRouter()
const communityId = ref(String(route.params.communityId || ''))
const loading = ref(false)
const posts = ref<any[]>([])
const sections = ref<any[]>([])
const showDetail = ref(false)
const detailPost = ref<any>(null)
const detailSection = ref<any>(null)
const attendanceMembersByWidget = ref<Record<string, any[]>>({})
const dateRange = ref<string[]>([])
const communityName = ref('')
const filters = ref({
  sectionId: '',
  authorQuery: '',
  status: 'active' as 'active' | 'deleted' | 'all',
  auditStatus: 'all' as 'pending' | 'pass' | 'review' | 'rejected' | 'all',
  pinnedStatus: 'all' as 'all' | 'true' | 'false',
  featuredStatus: 'all' as 'all' | 'true' | 'false',
})

const detailFields = computed(() => {
  if (!detailPost.value || !detailSection.value) return []
  return (detailSection.value.widgets || [])
    .filter((widget: any) => !['attendance', 'admin_notice'].includes(widget.type))
    .map((widget: any) => ({
      label: widget.label,
      type: widget.type,
      rawValue: detailPost.value.content?.[widget.widgetId],
      value: formatValue(detailPost.value.content?.[widget.widgetId], widget.type),
    }))
})

const attendanceBlocks = computed(() => {
  if (!detailSection.value || !detailPost.value) return []
  return (detailSection.value.widgets || [])
    .filter((widget: any) => widget.type === 'attendance')
    .map((widget: any) => ({
      widgetId: widget.widgetId,
      label: widget.label,
      summary: detailPost.value.attendanceSummaryByWidget?.[widget.widgetId] || { count: 0, previewUsers: [] },
      members: attendanceMembersByWidget.value?.[widget.widgetId] || [],
    }))
})

onMounted(async () => {
  if (!communityId.value) {
    ElMessage.error('缺少 communityId，无法加载帖子管理')
    router.push({ name: 'communities' })
    return
  }
  await loadCommunityContext()
  await loadSections()
  await loadPosts()
})

async function loadCommunityContext() {
  try {
    const res = await communityApi.list() as any
    const current = (res.communities ?? []).find((community: any) => String(community?._id || community?.id || '') === communityId.value)
    communityName.value = String(current?.name || '')
  } catch {
    communityName.value = ''
  }
}

async function loadSections() {
  const res = await sectionApi.list(communityId.value) as any
  sections.value = res.sections ?? []
}

async function loadPosts() {
  loading.value = true
  try {
    const res = await postAdminApi.list({
      communityId: communityId.value,
      sectionId: filters.value.sectionId || undefined,
      authorQuery: filters.value.authorQuery || undefined,
      status: filters.value.status,
      auditStatus: filters.value.auditStatus,
      pinned: parseFlagFilter(filters.value.pinnedStatus),
      featured: parseFlagFilter(filters.value.featuredStatus),
      dateFrom: dateRange.value?.[0] || undefined,
      dateTo: dateRange.value?.[1] || undefined,
    }) as any
    posts.value = res.posts ?? []
  } catch (error: any) {
    ElMessage.error(error.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function parseFlagFilter(value: 'all' | 'true' | 'false') {
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function auditText(status?: string) {
  if (status === 'pending') return '审核中'
  if (status === 'review') return '需复核'
  if (status === 'rejected') return '已拒绝'
  return '已通过'
}

function auditTag(status?: string) {
  if (status === 'pending') return 'info'
  if (status === 'review') return 'warning'
  if (status === 'rejected') return 'danger'
  return 'success'
}

async function openDetail(row: any) {
  try {
    const res = await postAdminApi.get(row._id) as any
    detailPost.value = res.post ?? null
    detailSection.value = res.section ?? null
    attendanceMembersByWidget.value = res.attendanceMembersByWidget ?? {}
    showDetail.value = true
  } catch (error: any) {
    ElMessage.error(error.message || '加载详情失败')
  }
}

function editPost(row: any) {
  const postId = String(row?._id || '')
  if (!postId || row?.status === 'deleted') return
  router.push({ name: 'post-edit-admin', params: { communityId: communityId.value, postId } })
}

async function deletePost(row: any) {
  try {
    await ElMessageBox.confirm(
      '确认删除这条帖子吗？删除后前台将不再展示。',
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }

  try {
    await postAdminApi.delete(row._id)
    ElMessage.success('已删除')
    await loadPosts()
    if (detailPost.value?._id === row._id) {
      showDetail.value = false
    }
  } catch (error: any) {
    ElMessage.error(error.message || '删除失败')
  }
}

async function refreshDetailIfOpen(postId: string) {
  if (detailPost.value?._id !== postId) return
  try {
    const res = await postAdminApi.get(postId) as any
    detailPost.value = res.post ?? null
    detailSection.value = res.section ?? null
    attendanceMembersByWidget.value = res.attendanceMembersByWidget ?? {}
  } catch {
    // The list has already refreshed; keep the existing dialog if detail refresh fails.
  }
}

async function togglePin(row: any) {
  const postId = String(row?._id || '')
  if (!postId || row?.status === 'deleted') return
  try {
    if (row.isPinned) {
      await postAdminApi.unpin(postId)
      ElMessage.success('已取消置顶')
    } else {
      await postAdminApi.pin(postId)
      ElMessage.success('已置顶')
    }
    await loadPosts()
    await refreshDetailIfOpen(postId)
  } catch (error: any) {
    ElMessage.error(error.message || '操作失败')
  }
}

async function toggleFeature(row: any) {
  const postId = String(row?._id || '')
  if (!postId || row?.status === 'deleted') return
  try {
    if (row.isFeatured) {
      await postAdminApi.unfeature(postId)
      ElMessage.success('已取消精华')
    } else {
      await postAdminApi.feature(postId)
      ElMessage.success('已加精')
    }
    await loadPosts()
    await refreshDetailIfOpen(postId)
  } catch (error: any) {
    ElMessage.error(error.message || '操作失败')
  }
}

async function removeAttendanceMember(widgetId: string, row: any) {
  if (!detailPost.value?._id) return
  try {
    await ElMessageBox.confirm(
      `确认移除 ${row.nickName || row.userId} 的参与记录吗？`,
      '移除参与人',
      { type: 'warning', confirmButtonText: '移除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }

  try {
    const res = await postAdminApi.removeAttendanceMember({
      postId: detailPost.value._id,
      widgetId,
      userId: row.userId,
    }) as any
    attendanceMembersByWidget.value = {
      ...attendanceMembersByWidget.value,
      [widgetId]: res.members ?? [],
    }
    const total = Number(res.total || 0)
    detailPost.value = {
      ...detailPost.value,
      attendanceSummaryByWidget: {
        ...(detailPost.value.attendanceSummaryByWidget || {}),
        [widgetId]: {
          ...(detailPost.value.attendanceSummaryByWidget?.[widgetId] || {}),
          count: total,
          previewUsers: (res.members || []).slice(0, 5).map((member: any) => ({
            userId: member.userId,
            nickName: member.nickName,
            avatarUrl: member.avatarUrl,
          })),
        },
      },
    }
    ElMessage.success('已移除')
  } catch (error: any) {
    ElMessage.error(error.message || '移除失败')
  }
}

function getPostSummary(row: any) {
  const attendanceSummaries = Object.values(row?.attendanceSummaryByWidget || {}) as any[]
  const firstAttendance = attendanceSummaries.find((item) => Number(item?.count || 0) > 0)
  if (firstAttendance) return `${firstAttendance.count}人参与`
  const content = row?.content || {}
  const firstRichNote = Object.values(content).find((value) => richNoteText(value))
  if (firstRichNote) return richNoteText(firstRichNote)
  const firstValue = Object.values(content).find((value) => !Array.isArray(value) && !(value && typeof value === 'object'))
  return formatValue(firstValue)
}

function formatValue(value: unknown, type?: string) {
  if (type === 'rich_note') return richNoteText(value) || '空'
  if (Array.isArray(value)) return value.length > 0 ? `共 ${value.length} 项` : '空'
  if (value && typeof value === 'object') return JSON.stringify(value)
  return String(value || '空')
}

function richNoteText(value: unknown) {
  return normalizeRichNoteContent(value).text.trim()
}

function videoSourceLabel(source: string) {
  const labels: Record<string, string> = {
    cos: '自托管视频',
    channels_feed: '视频号 Feed',
    channels_live: '视频号直播',
    miniprogram: '小程序',
    h5: 'H5 链接',
    app_link: 'App 链接',
  }
  return labels[source] || source || '未知'
}

function videoItems(value: unknown) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []
}

function audioItems(value: unknown) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []
}

function formatBytes(value: unknown) {
  const bytes = Number(value || 0)
  if (!Number.isFinite(bytes) || bytes <= 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatAudioDuration(value: unknown) {
  const total = Math.max(0, Math.round(Number(value || 0)))
  if (!total) return '-'
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function videoPrimaryText(item: any) {
  if (!item || typeof item !== 'object') return ''
  if (item.source === 'cos') return item.fileID || ''
  if (item.source === 'channels_feed') return [item.finderUserName, item.feedId].filter(Boolean).join(' / ')
  if (item.source === 'channels_live') return [item.finderUserName, item.nonceId].filter(Boolean).join(' / ')
  if (item.source === 'miniprogram') return [item.appId, item.path].filter(Boolean).join(' / ')
  if (item.source === 'h5' || item.source === 'app_link') return item.url || ''
  return ''
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
  flex-wrap: wrap;
}

.title-row h3 {
  margin: 0;
}

.filters {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.sub-text {
  font-size: 12px;
  color: #909399;
}

.detail-meta {
  margin-bottom: 12px;
  color: #606266;
  display: grid;
  gap: 6px;
}

.attendance-block {
  margin-top: 20px;
}

.attendance-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.attendance-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.member-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.post-flags {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.detail-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.video-detail-list,
.audio-detail-list,
.rich-note-detail {
  display: grid;
  gap: 12px;
}

.rich-note-detail {
  max-width: 100%;
  line-height: 1.8;
  color: #303133;
}

.rich-note-detail :deep(img) {
  max-width: 100%;
  border-radius: 8px;
}

.video-detail-item {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.video-cover {
  width: 96px;
  height: 54px;
  border-radius: 6px;
  flex: 0 0 auto;
  background: #f5f7fa;
}

.video-cover-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #909399;
  font-size: 12px;
}

.video-detail-main {
  min-width: 0;
}

.video-title {
  font-weight: 600;
  color: #303133;
  margin-bottom: 4px;
}

.video-link {
  max-width: 520px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.audio-detail-item {
  padding: 10px 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fafafa;
}

.audio-title {
  font-weight: 600;
  color: #303133;
  margin-bottom: 4px;
}

@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
