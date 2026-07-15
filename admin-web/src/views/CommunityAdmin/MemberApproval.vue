<template>
  <div data-testid="member-approval-page">
    <div class="page-header">
      <div class="header-left">
        <div>
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ name: 'communities' }">社区管理</el-breadcrumb-item>
            <el-breadcrumb-item>{{ communityName || '当前社区' }}</el-breadcrumb-item>
            <el-breadcrumb-item>成员管理</el-breadcrumb-item>
          </el-breadcrumb>
          <div class="title-row">
            <h3 style="margin: 0;">成员管理</h3>
            <el-tag size="small" effect="plain" type="info">当前社区：{{ communityName || communityId }}</el-tag>
          </div>
        </div>
      </div>
      <el-button data-testid="member-refresh-button" @click="loadMembers" :loading="loading">刷新</el-button>
    </div>

    <div style="display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap;">
      <el-input
        v-model="keyword"
        clearable
        placeholder="搜索昵称或内部ID"
        style="width: 280px;"
        @keyup.enter="loadMembers"
      />
      <el-select v-model="statusFilter" style="width: 180px;" @change="loadMembers">
        <el-option label="全部状态" value="all" />
        <el-option label="待审批" value="pending" />
        <el-option label="已加入" value="active" />
        <el-option label="已拒绝" value="rejected" />
      </el-select>
      <el-button @click="loadMembers">查询</el-button>
    </div>

    <el-tabs data-testid="member-tabs" v-model="activeTab">
      <el-tab-pane :label="`待审批（${pendingMembers.length}）`" name="pending">
        <el-table
          data-testid="member-pending-table"
          :data="pendingMembers"
          v-loading="loading"
          border
          @header-dragend="handlePendingColumnDragEnd"
        >
          <el-table-column
            column-key="nickname"
            label="昵称"
            :width="pendingColumnWidths.nickname"
            min-width="130"
            :resizable="true"
          >
            <template #default="{ row }">
              <div class="member-identity">
                <el-avatar :src="row.avatarUrl" :size="28">
                  {{ (row.nickName || row.userId || '?').slice(0, 1) }}
                </el-avatar>
                <span>{{ row.nickName || '未设置' }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column
            column-key="userId"
            label="内部ID"
            :width="pendingColumnWidths.userId"
            min-width="180"
            :resizable="true"
          >
            <template #default="{ row }">
              <el-tooltip :content="row.userId" placement="top">
                <span>{{ formatUserId(row.userId) }}</span>
              </el-tooltip>
            </template>
          </el-table-column>
          <el-table-column
            column-key="appliedAt"
            label="申请时间"
            :width="pendingColumnWidths.appliedAt"
            min-width="150"
            :resizable="true"
          >
            <template #default="{ row }">
              <span>{{ formatAdminDateTime(row.appliedAt) }}</span>
            </template>
          </el-table-column>
          <el-table-column
            column-key="actions"
            label="操作"
            :width="pendingColumnWidths.actions"
            min-width="160"
            :resizable="true"
          >
            <template #default="{ row }">
              <el-button data-testid="member-approve-button" :data-member-id="row._id" type="primary" size="small" @click="approve(row)">通过</el-button>
              <el-button data-testid="member-reject-button" :data-member-id="row._id" type="danger" size="small" @click="reject(row)">拒绝</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!loading && pendingMembers.length === 0" description="暂无待审批成员" />
      </el-tab-pane>

      <el-tab-pane :label="`成员列表（${allMembers.length}）`" name="all">
        <el-table
          data-testid="member-all-table"
          :data="allMembers"
          v-loading="loading"
          border
          @header-dragend="handleAllColumnDragEnd"
        >
          <el-table-column
            column-key="nickname"
            label="昵称"
            :width="allColumnWidths.nickname"
            min-width="130"
            :resizable="true"
          >
            <template #default="{ row }">
              <div class="member-identity">
                <el-avatar :src="row.avatarUrl" :size="28">
                  {{ (row.nickName || row.userId || '?').slice(0, 1) }}
                </el-avatar>
                <span>{{ row.nickName || '未设置' }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column
            column-key="userId"
            label="内部ID"
            :width="allColumnWidths.userId"
            min-width="180"
            :resizable="true"
          >
            <template #default="{ row }">
              <el-tooltip :content="row.userId" placement="top">
                <span>{{ formatUserId(row.userId) }}</span>
              </el-tooltip>
            </template>
          </el-table-column>
          <el-table-column
            column-key="role"
            label="角色"
            :width="allColumnWidths.role"
            min-width="90"
            :resizable="true"
          >
            <template #default="{ row }">
              <el-tag size="small" :type="row.role === 'admin' ? 'danger' : 'info'">
                {{ row.role === 'admin' ? '管理员' : '成员' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column
            column-key="status"
            label="状态"
            :width="allColumnWidths.status"
            min-width="100"
            :resizable="true"
          >
            <template #default="{ row }">
              <el-tag size="small" :type="statusTagType(row.status)">
                {{ statusLabel(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column
            column-key="appliedAt"
            label="申请时间"
            :width="allColumnWidths.appliedAt"
            min-width="150"
            :resizable="true"
          >
            <template #default="{ row }">
              <span>{{ formatAdminDateTime(row.appliedAt) }}</span>
            </template>
          </el-table-column>
          <el-table-column
            column-key="joinedAt"
            label="加入时间"
            :width="allColumnWidths.joinedAt"
            min-width="150"
            :resizable="true"
          >
            <template #default="{ row }">
              <span>{{ formatAdminDateTime(row.joinedAt) }}</span>
            </template>
          </el-table-column>
          <el-table-column
            column-key="actions"
            label="操作"
            :width="allColumnWidths.actions"
            min-width="160"
            :resizable="true"
          >
            <template #default="{ row }">
              <el-button
                size="small"
                type="danger"
                :disabled="!canKick(row)"
                @click="kick(row)"
              >
                移出
              </el-button>
              <span v-if="row.isCreator" style="margin-left: 8px; color: #909399; font-size: 12px;">创建者</span>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!loading && allMembers.length === 0" description="暂无成员记录" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { communityApi, memberApi } from '../../api/cloud'
import { ElMessage } from 'element-plus/es/components/message/index'
import { ElMessageBox } from 'element-plus/es/components/message-box/index'
import { formatAdminDateTime } from '../../utils/datetime'
import { usePersistedTableColumns } from '../../utils/persistedTableColumns'

type MemberStatus = 'pending' | 'active' | 'rejected'
type PendingMemberTableColumnKey = 'nickname' | 'userId' | 'appliedAt' | 'actions'
type AllMemberTableColumnKey = 'nickname' | 'userId' | 'role' | 'status' | 'appliedAt' | 'joinedAt' | 'actions'

const PENDING_MEMBER_TABLE_DEFAULT_COLUMN_WIDTHS: Record<PendingMemberTableColumnKey, number> = {
  nickname: 160,
  userId: 240,
  appliedAt: 180,
  actions: 180,
}
const PENDING_MEMBER_TABLE_MIN_COLUMN_WIDTHS: Record<PendingMemberTableColumnKey, number> = {
  nickname: 130,
  userId: 180,
  appliedAt: 150,
  actions: 160,
}
const ALL_MEMBER_TABLE_DEFAULT_COLUMN_WIDTHS: Record<AllMemberTableColumnKey, number> = {
  nickname: 160,
  userId: 240,
  role: 100,
  status: 110,
  appliedAt: 180,
  joinedAt: 180,
  actions: 180,
}
const ALL_MEMBER_TABLE_MIN_COLUMN_WIDTHS: Record<AllMemberTableColumnKey, number> = {
  nickname: 130,
  userId: 180,
  role: 90,
  status: 100,
  appliedAt: 150,
  joinedAt: 150,
  actions: 160,
}

interface MemberRow {
  _id: string
  communityId: string
  userId: string
  avatarUrl?: string
  role: 'admin' | 'member'
  status: MemberStatus
  appliedAt: string
  joinedAt?: string
  nickName?: string
  isCreator?: boolean
}

const route = useRoute()
const router = useRouter()
const communityId = ref(String(route.params.communityId || ''))
const allMembers = ref<MemberRow[]>([])
const pendingMembers = computed(() => allMembers.value.filter(m => m.status === 'pending'))
const activeTab = ref<'pending' | 'all'>(route.query.tab === 'all' ? 'all' : 'pending')
const loading = ref(false)
const keyword = ref('')
const statusFilter = ref<'all' | MemberStatus>('all')
const communityName = ref('')
const {
  columnWidths: pendingColumnWidths,
  handleColumnDragEnd: handlePendingColumnDragEnd,
} = usePersistedTableColumns<PendingMemberTableColumnKey>({
  storageKey: 'happyhome.admin.memberPendingTable.columnWidths.v1',
  defaults: PENDING_MEMBER_TABLE_DEFAULT_COLUMN_WIDTHS,
  minimums: PENDING_MEMBER_TABLE_MIN_COLUMN_WIDTHS,
})
const {
  columnWidths: allColumnWidths,
  handleColumnDragEnd: handleAllColumnDragEnd,
} = usePersistedTableColumns<AllMemberTableColumnKey>({
  storageKey: 'happyhome.admin.memberAllTable.columnWidths.v1',
  defaults: ALL_MEMBER_TABLE_DEFAULT_COLUMN_WIDTHS,
  minimums: ALL_MEMBER_TABLE_MIN_COLUMN_WIDTHS,
})

onMounted(async () => {
  if (!communityId.value) {
    ElMessage.error('缺少 communityId，无法加载成员列表')
    router.push({ name: 'communities' })
    return
  }
  await loadCommunityContext()
  await loadMembers()
})

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


async function loadMembers() {
  loading.value = true
  try {
    const res = await memberApi.list({
      communityId: communityId.value,
      q: keyword.value,
      status: statusFilter.value,
    }) as any
    allMembers.value = (res.members ?? []) as MemberRow[]
  } catch (e: any) {
    const message = getErrorMessage(e)
    if (message.includes('Unknown action: member.list')) {
      const fallback = await memberApi.pendingList(communityId.value) as any
      allMembers.value = (fallback.members ?? []) as MemberRow[]
      ElMessage.warning('后端暂未部署 member.list，当前仅展示待审批成员')
    } else {
      ElMessage.error(message || '加载失败')
    }
  } finally {
    loading.value = false
  }
}

async function approve(row: MemberRow) {
  try {
    await memberApi.memberApprove(communityId.value, row._id)
    ElMessage.success('已通过')
    await loadMembers()
  } catch (e: any) {
    ElMessage.error(e.message || '操作失败')
  }
}

async function reject(row: MemberRow) {
  try {
    await memberApi.memberReject(communityId.value, row._id)
    ElMessage.info('已拒绝')
    await loadMembers()
  } catch (e: any) {
    ElMessage.error(e.message || '操作失败')
  }
}

async function kick(row: MemberRow) {
  // 二次确认：移出成员是不可逆的危险操作，跟 disable / hardDelete 等保持一致的确认流
  const label = row.nickName || row.userId || '该成员'
  try {
    await ElMessageBox.confirm(
      `确认将成员「${label}」移出社区吗？该用户之后需重新申请才能加入。`,
      '移出确认',
      { confirmButtonText: '移出', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return // 用户取消
  }
  try {
    await memberApi.kick(communityId.value, row._id)
    ElMessage.success('已移出成员')
    await loadMembers()
  } catch (e: any) {
    ElMessage.error(getErrorMessage(e) || '操作失败')
  }
}

function canKick(row: MemberRow) {
  return (row.status === 'active' || row.status === 'rejected') && row.role === 'member' && !row.isCreator
}

function statusLabel(status: MemberStatus) {
  if (status === 'active') return '已加入'
  if (status === 'pending') return '待审批'
  return '已拒绝'
}

function statusTagType(status: MemberStatus): 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'active') return 'success'
  if (status === 'pending') return 'warning'
  if (status === 'rejected') return 'danger'
  return 'info'
}

function getErrorMessage(error: any): string {
  return String(error?.response?.data?.error || error?.message || '')
}

function formatUserId(userId: string) {
  const text = String(userId || '')
  if (text.length <= 18) return text
  return `${text.slice(0, 8)}...${text.slice(-6)}`
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

.header-left {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.member-identity {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.member-identity span {
  min-width: 0;
  word-break: break-all;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
  flex-wrap: wrap;
}

@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
  }

  .header-left {
    width: 100%;
  }
}
</style>
