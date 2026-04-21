<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h3 style="margin: 0;">帖子管理</h3>
      <el-button @click="loadPosts" :loading="loading">刷新</el-button>
    </div>

    <div style="display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap;">
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
          <div style="font-size: 12px; color: #909399;">{{ row.authorId }}</div>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
            {{ row.status === 'active' ? '已发布' : '已删除' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="摘要" min-width="260" show-overflow-tooltip>
        <template #default="{ row }">
          {{ getPostSummary(row) }}
        </template>
      </el-table-column>
      <el-table-column prop="createdAt" label="发布时间" width="180" />
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

    <el-dialog v-model="showDetail" title="帖子详情" width="640px">
      <template v-if="detailPost">
        <div style="margin-bottom: 12px; color: #606266;">
          <div>板块：{{ detailSection?.name || detailPost.sectionName || '未知板块' }}</div>
          <div>作者：{{ detailPost.authorNickname || '未设置昵称' }} / {{ detailPost.authorId }}</div>
          <div>时间：{{ detailPost.createdAt }}</div>
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
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { postAdminApi, sectionApi } from '../../api/cloud'

const route = useRoute()
const router = useRouter()
const communityId = ref(String(route.params.communityId || ''))
const loading = ref(false)
const posts = ref<any[]>([])
const sections = ref<any[]>([])
const showDetail = ref(false)
const detailPost = ref<any>(null)
const detailSection = ref<any>(null)
const dateRange = ref<string[]>([])
const filters = ref({
  sectionId: '',
  authorQuery: '',
  status: 'active' as 'active' | 'deleted' | 'all',
})

const detailFields = computed(() => {
  if (!detailPost.value || !detailSection.value) return []
  return (detailSection.value.widgets || []).map((widget: any) => ({
    label: widget.label,
    value: formatValue(detailPost.value.content?.[widget.widgetId]),
  }))
})

onMounted(async () => {
  if (!communityId.value) {
    ElMessage.error('缺少 communityId，无法加载帖子管理')
    router.push({ name: 'communities' })
    return
  }
  await loadSections()
  await loadPosts()
})

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
  } catch (e: any) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function openDetail(row: any) {
  try {
    const res = await postAdminApi.get(row._id) as any
    detailPost.value = res.post ?? null
    detailSection.value = res.section ?? null
    showDetail.value = true
  } catch (e: any) {
    ElMessage.error(e.message || '加载详情失败')
  }
}

async function deletePost(row: any) {
  try {
    await ElMessageBox.confirm(
      `确认删除这条帖子吗？删除后前台将不再展示。`,
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
  } catch (e: any) {
    ElMessage.error(e.message || '删除失败')
  }
}

function getPostSummary(row: any) {
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
