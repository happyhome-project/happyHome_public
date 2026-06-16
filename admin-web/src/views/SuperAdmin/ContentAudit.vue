<template>
  <div data-testid="content-audit-page">
    <div class="page-header">
      <div>
        <h2>内容审核</h2>
        <p>仅 superAdmin 可处理机器复核、接口异常和待人工确认的帖子。</p>
      </div>
      <el-button @click="load" :loading="loading">刷新</el-button>
    </div>

    <div class="toolbar">
      <el-select v-model="auditStatus" style="width: 180px" @change="load">
        <el-option label="待处理" value="actionable" />
        <el-option label="审核中" value="pending" />
        <el-option label="需人工复核" value="review" />
        <el-option label="已拒绝" value="rejected" />
        <el-option label="已通过" value="pass" />
        <el-option label="全部" value="all" />
      </el-select>
    </div>

    <el-table
      :data="posts"
      v-loading="loading"
      border
      style="width: 100%"
      @header-dragend="handleColumnDragEnd"
    >
      <el-table-column
        column-key="community"
        label="社区/板块"
        :width="columnWidths.community"
        min-width="170"
        :resizable="true"
      >
        <template #default="{ row }">
          <div>{{ row.communityName || row.communityId }}</div>
          <div class="muted">{{ row.sectionName || row.sectionId }}</div>
        </template>
      </el-table-column>

      <el-table-column
        column-key="author"
        label="作者"
        :width="columnWidths.author"
        min-width="140"
        :resizable="true"
      >
        <template #default="{ row }">
          <div>{{ row.authorNickname || '未设置' }}</div>
          <div class="muted">{{ shortId(row.authorId) }}</div>
        </template>
      </el-table-column>

      <el-table-column
        column-key="audit"
        label="审核状态"
        :width="columnWidths.audit"
        min-width="120"
        :resizable="true"
      >
        <template #default="{ row }">
          <el-tag :type="auditTag(displayAuditStatus(row))">
            {{ auditText(displayAuditStatus(row)) }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column
        column-key="visibility"
        label="公开状态"
        :width="columnWidths.visibility"
        min-width="110"
        :resizable="true"
      >
        <template #default="{ row }">
          <el-tag :type="row.isVisibleToMembers ? 'success' : 'info'">
            {{ row.isVisibleToMembers ? '已公开' : '未公开' }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column
        column-key="reason"
        label="原因"
        :width="columnWidths.reason"
        min-width="180"
        show-overflow-tooltip
        :resizable="true"
      >
        <template #default="{ row }">
          {{ row.pendingAuditReason || row.auditReason || '-' }}
        </template>
      </el-table-column>

      <el-table-column
        column-key="updatedAt"
        label="更新时间"
        :width="columnWidths.updatedAt"
        min-width="150"
        :resizable="true"
      >
        <template #default="{ row }">
          {{ formatTime(row.pendingSubmittedAt || row.auditUpdatedAt || row.updatedAt || row.createdAt) }}
        </template>
      </el-table-column>

      <el-table-column
        column-key="actions"
        label="操作"
        :width="columnWidths.actions"
        min-width="240"
        fixed="right"
        :resizable="true"
      >
        <template #default="{ row }">
          <el-button size="small" @click="openDetail(row)">详情</el-button>
          <el-button size="small" type="success" @click="approve(row)">通过</el-button>
          <el-button size="small" type="danger" @click="reject(row)">拒绝</el-button>
          <el-button size="small" @click="retry(row)">重审</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-empty v-if="!loading && posts.length === 0" description="暂无待处理内容" />

    <el-dialog v-model="detailVisible" title="审核详情" width="860px">
      <template v-if="detail">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="帖子 ID">{{ detail.post._id }}</el-descriptions-item>
          <el-descriptions-item label="作者">{{ detail.post.authorNickname || detail.post.authorId }}</el-descriptions-item>
          <el-descriptions-item label="当前审核">{{ auditText(detail.post.auditStatus) }}</el-descriptions-item>
          <el-descriptions-item label="待审编辑">
            {{ detail.post.pendingContent ? auditText(detail.post.pendingAuditStatus) : '无' }}
          </el-descriptions-item>
        </el-descriptions>

        <h3>待审核内容</h3>
        <pre class="content-preview">{{ formatContent(detail.post.pendingContent || detail.post.content) }}</pre>

        <h3>审核任务</h3>
        <el-table :data="detail.auditTasks || []" size="small">
          <el-table-column prop="targetType" label="类型" width="90" />
          <el-table-column prop="provider" label="来源" width="110" />
          <el-table-column label="状态" width="120">
            <template #default="{ row }">
              <el-tag :type="auditTag(row.status)">{{ auditText(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="targetLabel" label="字段" min-width="140" />
          <el-table-column prop="reason" label="原因" min-width="220" />
          <el-table-column label="trace/job" min-width="180">
            <template #default="{ row }">{{ row.traceId || row.jobId || '-' }}</template>
          </el-table-column>
        </el-table>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { auditApi } from '../../api/cloud'
import { usePersistedTableColumns } from '../../utils/persistedTableColumns'

type AuditStatus = 'actionable' | 'pending' | 'pass' | 'review' | 'rejected' | 'all'
type ContentAuditTableColumnKey = 'community' | 'author' | 'audit' | 'visibility' | 'reason' | 'updatedAt' | 'actions'

const CONTENT_AUDIT_TABLE_DEFAULT_COLUMN_WIDTHS: Record<ContentAuditTableColumnKey, number> = {
  community: 210,
  author: 170,
  audit: 150,
  visibility: 120,
  reason: 260,
  updatedAt: 180,
  actions: 270,
}
const CONTENT_AUDIT_TABLE_MIN_COLUMN_WIDTHS: Record<ContentAuditTableColumnKey, number> = {
  community: 170,
  author: 140,
  audit: 120,
  visibility: 110,
  reason: 180,
  updatedAt: 150,
  actions: 240,
}

const loading = ref(false)
const posts = ref<any[]>([])
const auditStatus = ref<AuditStatus>('actionable')
const detailVisible = ref(false)
const detail = ref<any | null>(null)
const { columnWidths, handleColumnDragEnd } = usePersistedTableColumns<ContentAuditTableColumnKey>({
  storageKey: 'happyhome.admin.contentAuditTable.columnWidths.v1',
  defaults: CONTENT_AUDIT_TABLE_DEFAULT_COLUMN_WIDTHS,
  minimums: CONTENT_AUDIT_TABLE_MIN_COLUMN_WIDTHS,
})

function displayAuditStatus(row: any) {
  return row?.pendingContent ? row?.pendingAuditStatus : row?.auditStatus
}

function auditText(status?: string) {
  if (status === 'pending') return '审核中'
  if (status === 'pass') return '已通过'
  if (status === 'review') return '需人工复核'
  if (status === 'rejected') return '已拒绝'
  return '历史已通过'
}

function auditTag(status?: string) {
  if (status === 'pass') return 'success'
  if (status === 'rejected') return 'danger'
  if (status === 'review') return 'warning'
  if (status === 'pending') return 'info'
  return 'success'
}

function shortId(value?: string) {
  const id = String(value || '')
  if (id.length <= 14) return id
  return `${id.slice(0, 8)}...${id.slice(-6)}`
}

function formatTime(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function formatContent(value: any) {
  return JSON.stringify(value || {}, null, 2)
}

async function load() {
  loading.value = true
  try {
    const res: any = await auditApi.list({ auditStatus: auditStatus.value })
    posts.value = res.posts || []
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.error || error?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function openDetail(row: any) {
  try {
    detail.value = await auditApi.get(row._id)
    detailVisible.value = true
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.error || error?.message || '加载详情失败')
  }
}

async function approve(row: any) {
  try {
    await auditApi.approve(row._id)
    ElMessage.success('已通过')
    await load()
    if (detailVisible.value) await openDetail(row)
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.error || error?.message || '通过失败')
  }
}

async function reject(row: any) {
  const reason = await ElMessageBox.prompt('请输入拒绝原因', '拒绝内容', {
    confirmButtonText: '拒绝',
    cancelButtonText: '取消',
    inputValue: row.pendingAuditReason || row.auditReason || '内容未通过审核',
  }).then((res) => String(res.value || '').trim()).catch(() => '')
  if (!reason) return

  try {
    await auditApi.reject(row._id, reason)
    ElMessage.success('已拒绝')
    await load()
    if (detailVisible.value) await openDetail(row)
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.error || error?.message || '拒绝失败')
  }
}

async function retry(row: any) {
  try {
    await auditApi.retry(row._id)
    ElMessage.success('已重新提交审核')
    await load()
    if (detailVisible.value) await openDetail(row)
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.error || error?.message || '重审失败')
  }
}

onMounted(load)
</script>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.page-header h2 {
  margin: 0 0 6px;
}

.page-header p,
.muted {
  color: #909399;
  font-size: 12px;
}

.toolbar {
  margin: 16px 0;
}

.content-preview {
  max-height: 260px;
  overflow: auto;
  padding: 12px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  background: #fafafa;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
