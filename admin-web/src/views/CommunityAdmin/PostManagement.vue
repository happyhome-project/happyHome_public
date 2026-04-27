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
      <el-button @click="loadPosts" :loading="loading">刷新</el-button>
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
      <el-table-column label="操作" width="180">
        <template #default="{ row }">
          <el-button size="small" @click="openDetail(row)">详情</el-button>
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
        </div>

        <el-descriptions :column="1" border>
          <el-descriptions-item
            v-for="field in detailFields"
            :key="field.label"
            :label="field.label"
          >
            {{ field.value }}
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
import { ElMessage, ElMessageBox } from 'element-plus'
import { communityApi, postAdminApi, sectionApi } from '../../api/cloud'
import { formatAdminDateTime } from '../../utils/datetime'

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
})

const detailFields = computed(() => {
  if (!detailPost.value || !detailSection.value) return []
  return (detailSection.value.widgets || [])
    .filter((widget: any) => !['attendance', 'admin_notice'].includes(widget.type))
    .map((widget: any) => ({
      label: widget.label,
      value: formatValue(detailPost.value.content?.[widget.widgetId]),
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
  const firstValue = Object.values(content)[0]
  return formatValue(firstValue)
}

function formatValue(value: unknown) {
  if (Array.isArray(value)) return value.length > 0 ? `共 ${value.length} 项` : '空'
  if (value && typeof value === 'object') return JSON.stringify(value)
  return String(value || '空')
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

@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
