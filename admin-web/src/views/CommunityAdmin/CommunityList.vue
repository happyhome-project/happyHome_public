<template>
  <div data-testid="community-list-page">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h3>{{ authStore.isSuperAdmin ? '社区管理' : '我的社区' }}</h3>
      <div style="display: flex; gap: 8px;">
        <el-button data-testid="community-create-entry" type="primary" @click="goCreate">创建社区</el-button>
        <el-button data-testid="community-list-refresh" @click="loadCommunities" :loading="loading">刷新</el-button>
      </div>
    </div>

    <div style="display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap;">
      <el-input
        v-model="keyword"
        clearable
        placeholder="搜索社区名称或描述"
        style="width: 280px;"
      />
      <el-select v-model="statusFilter" style="width: 180px;">
        <el-option label="全部状态" value="all" />
        <el-option label="已启用" value="active" />
        <el-option label="待审批" value="pending" />
        <el-option label="已拒绝" value="rejected" />
      </el-select>
    </div>

    <el-table
      data-testid="community-table"
      :data="filteredCommunities"
      v-loading="loading"
      border
      style="width: 100%"
      @header-dragend="handleColumnDragEnd"
    >
      <el-table-column
        prop="name"
        column-key="name"
        label="社区名称"
        :width="columnWidths.name"
        min-width="180"
        :resizable="true"
      />
      <el-table-column
        prop="description"
        column-key="description"
        label="描述"
        :width="columnWidths.description"
        min-width="220"
        :resizable="true"
      >
        <template #default="{ row }">
          <div data-testid="community-description-cell" class="wrapping-table-cell">
            {{ row.description || '未设置' }}
          </div>
        </template>
      </el-table-column>
      <el-table-column
        column-key="motto"
        label="格言"
        :width="columnWidths.motto"
        min-width="220"
        :resizable="true"
      >
        <template #default="{ row }">
          <div v-if="row.motto" data-testid="community-motto-cell" class="wrapping-table-cell">
            "{{ row.motto }}"
            <span v-if="row.mottoCite" style="color: #909399; margin-left: 6px;">- {{ row.mottoCite }}</span>
          </div>
          <div v-else data-testid="community-motto-cell" class="wrapping-table-cell muted-table-cell">未设置</div>
        </template>
      </el-table-column>
      <el-table-column
        column-key="status"
        label="状态"
        :width="columnWidths.status"
        min-width="110"
        :resizable="true"
      >
        <template #default="{ row }">
          <el-tag v-if="row.status === 'active'" type="success">已启用</el-tag>
          <el-tag v-else-if="row.status === 'pending'" type="warning">待审批</el-tag>
          <el-tag v-else-if="row.status === 'rejected'" type="danger">已拒绝</el-tag>
          <el-tag v-else-if="row.status === 'disabled'" type="info">已禁用</el-tag>
          <el-tag v-else type="info">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column
        column-key="joinType"
        label="加入方式"
        :width="columnWidths.joinType"
        min-width="120"
        :resizable="true"
      >
        <template #default="{ row }">
          <el-tag :type="normalizeJoinType(row.joinType) === 'open' ? 'success' : 'warning'">
            {{ formatJoinType(row.joinType) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column
        prop="memberCount"
        column-key="memberCount"
        label="成员数"
        :width="columnWidths.memberCount"
        min-width="100"
        :resizable="true"
      />
      <el-table-column
        column-key="pendingMemberCount"
        label="待审批成员"
        :width="columnWidths.pendingMemberCount"
        min-width="120"
        :resizable="true"
      >
        <template #default="{ row }">
          <el-button
            v-if="getPendingMemberCount(row) > 0"
            type="danger"
            link
            @click="goMembers(getCommunityId(row), 'pending')"
          >
            {{ getPendingMemberCount(row) }}
          </el-button>
          <span v-else style="color: #c0c4cc;">0</span>
        </template>
      </el-table-column>
      <el-table-column
        column-key="actions"
        label="操作"
        :width="columnWidths.actions"
        min-width="520"
        :resizable="true"
      >
        <template #default="{ row }">
          <template v-if="row.status === 'active'">
            <el-button data-testid="community-sections-button" :data-community-id="getCommunityId(row)" size="small" @click="goSections(getCommunityId(row))">板块管理</el-button>
            <el-button data-testid="community-members-button" :data-community-id="getCommunityId(row)" size="small" @click="goMembers(getCommunityId(row))">成员管理</el-button>
            <el-button size="small" @click="goPosts(getCommunityId(row))">帖子管理</el-button>
            <el-button data-testid="community-motto-button" :data-community-id="getCommunityId(row)" size="small" @click="openMotto(row)">格言</el-button>
            <el-button
              data-testid="community-join-type-toggle"
              :data-community-id="getCommunityId(row)"
              size="small"
              :loading="updatingJoinTypeId === getCommunityId(row)"
              @click="toggleJoinType(row)"
            >
              {{ normalizeJoinType(row.joinType) === 'open' ? '改为申请加入' : '改为直接加入' }}
            </el-button>
            <el-button
              v-if="authStore.isSuperAdmin"
              data-testid="community-disable-button"
              :data-community-id="getCommunityId(row)"
              size="small"
              type="danger"
              :loading="disablingId === getCommunityId(row)"
              @click="disableCommunity(row)"
            >
              禁用
            </el-button>
          </template>
          <span v-else-if="row.status === 'pending'" style="color: #909399;">等待超级管理员审批</span>
          <span v-else style="color: #909399;">已拒绝，仅读历史记录</span>
        </template>
      </el-table-column>
    </el-table>

    <el-empty v-if="!loading && filteredCommunities.length === 0" description="暂无可管理社区" />

    <el-dialog v-model="showMottoDialog" title="编辑社区格言" width="480px">
      <div style="color: #909399; font-size: 13px; margin-bottom: 12px;">
        格言会显示在小程序首页的引文区域，可以留空不展示。
      </div>
      <el-form :model="mottoForm" label-width="80px">
        <el-form-item label="格言">
          <div data-testid="community-motto-input" style="width: 100%;">
            <el-input
              v-model="mottoForm.motto"
              type="textarea"
              :rows="2"
              maxlength="60"
              show-word-limit
              placeholder="例如：远亲不如近邻，近邻不如对门。"
            />
          </div>
        </el-form-item>
        <el-form-item label="出处">
          <div data-testid="community-motto-cite-input" style="width: 100%;">
            <el-input
              v-model="mottoForm.mottoCite"
              maxlength="20"
              show-word-limit
              placeholder="例如：民谣 / 作者名（可选）"
            />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showMottoDialog = false">取消</el-button>
        <el-button data-testid="community-motto-save" type="primary" @click="saveMotto" :loading="savingMotto">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus/es/components/message/index'
import { ElMessageBox } from 'element-plus/es/components/message-box/index'
import { approvalApi, communityApi } from '../../api/cloud'
import { useAuthStore } from '../../stores/auth'
import { usePersistedTableColumns } from '../../utils/persistedTableColumns'

const router = useRouter()
const authStore = useAuthStore()
const loading = ref(false)
const communities = ref<any[]>([])
const disablingId = ref('')
const updatingJoinTypeId = ref('')
const showMottoDialog = ref(false)
const savingMotto = ref(false)
const keyword = ref('')
const statusFilter = ref<'all' | 'active' | 'pending' | 'rejected'>('all')
const pendingMemberCountByCommunity = ref<Record<string, number>>({})
type JoinType = 'open' | 'approval'
type CommunityTableColumnKey =
  | 'name'
  | 'description'
  | 'motto'
  | 'status'
  | 'joinType'
  | 'memberCount'
  | 'pendingMemberCount'
  | 'actions'

const COMMUNITY_TABLE_COLUMN_WIDTHS_KEY = 'happyhome.admin.communityTable.columnWidths.v1'
const COMMUNITY_TABLE_DEFAULT_COLUMN_WIDTHS: Record<CommunityTableColumnKey, number> = {
  name: 180,
  description: 260,
  motto: 260,
  status: 120,
  joinType: 120,
  memberCount: 100,
  pendingMemberCount: 120,
  actions: 520,
}
const COMMUNITY_TABLE_MIN_COLUMN_WIDTHS: Record<CommunityTableColumnKey, number> = {
  name: 160,
  description: 220,
  motto: 220,
  status: 110,
  joinType: 120,
  memberCount: 100,
  pendingMemberCount: 120,
  actions: 520,
}

const { columnWidths, handleColumnDragEnd } = usePersistedTableColumns<CommunityTableColumnKey>({
  storageKey: COMMUNITY_TABLE_COLUMN_WIDTHS_KEY,
  defaults: COMMUNITY_TABLE_DEFAULT_COLUMN_WIDTHS,
  minimums: COMMUNITY_TABLE_MIN_COLUMN_WIDTHS,
})
const mottoForm = ref<{ communityId: string; motto: string; mottoCite: string }>({
  communityId: '',
  motto: '',
  mottoCite: '',
})

const filteredCommunities = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  return communities.value.filter((community) => {
    if (statusFilter.value !== 'all' && community.status !== statusFilter.value) return false
    if (!q) return true
    return [community.name, community.description, community.motto, community.mottoCite]
      .some((part) => String(part || '').toLowerCase().includes(q))
  })
})

onMounted(() => {
  loadCommunities()
})

async function loadCommunities() {
  loading.value = true
  try {
    const res = await communityApi.list() as any
    communities.value = (res.communities ?? [])
      .map((c: any) => ({ ...c, _id: c._id || c.id || '' }))
      .filter((c: any) => ['active', 'pending', 'rejected'].includes(c.status))
    await loadApprovalSummary()
  } catch (e: any) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function loadApprovalSummary() {
  try {
    const res = await approvalApi.summary()
    const next: Record<string, number> = {}
    for (const item of res.communities || []) {
      next[String(item.communityId || '')] = Number(item.pendingMemberCount || 0)
    }
    pendingMemberCountByCommunity.value = next
  } catch {
    pendingMemberCountByCommunity.value = {}
  }
}

function getPendingMemberCount(row: any): number {
  return pendingMemberCountByCommunity.value[getCommunityId(row)] || 0
}

function getCommunityId(row: any): string {
  return String(row?._id || row?.id || '')
}

function normalizeJoinType(joinType: unknown): JoinType {
  return joinType === 'approval' ? 'approval' : 'open'
}

function formatJoinType(joinType: unknown): string {
  return normalizeJoinType(joinType) === 'open' ? '直接加入' : '申请加入'
}

async function goCreate() {
  await router.push({ name: 'community-create' })
}

async function goSections(communityId: string) {
  if (!communityId) {
    ElMessage.error('社区 ID 缺失，无法进入板块管理')
    return
  }
  await router.push({ name: 'sections', params: { communityId } })
}

async function goMembers(communityId: string, tab?: 'pending') {
  if (!communityId) {
    ElMessage.error('社区 ID 缺失，无法进入成员管理')
    return
  }
  await router.push({ name: 'members', params: { communityId }, query: tab ? { tab } : {} })
}

async function goPosts(communityId: string) {
  if (!communityId) {
    ElMessage.error('社区 ID 缺失，无法进入帖子管理')
    return
  }
  await router.push({ name: 'posts', params: { communityId } })
}

function openMotto(row: any) {
  const communityId = getCommunityId(row)
  if (!communityId) {
    ElMessage.error('社区 ID 缺失，无法编辑格言')
    return
  }

  mottoForm.value = {
    communityId,
    motto: row.motto || '',
    mottoCite: row.mottoCite || '',
  }
  showMottoDialog.value = true
}

async function saveMotto() {
  savingMotto.value = true
  try {
    await communityApi.updateMeta({
      communityId: mottoForm.value.communityId,
      motto: mottoForm.value.motto,
      mottoCite: mottoForm.value.mottoCite,
    })
    ElMessage.success('已保存')
    const target = communities.value.find(c => c._id === mottoForm.value.communityId)
    if (target) {
      target.motto = mottoForm.value.motto
      target.mottoCite = mottoForm.value.mottoCite
    }
    showMottoDialog.value = false
  } catch (e: any) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    savingMotto.value = false
  }
}

async function toggleJoinType(row: any) {
  const communityId = getCommunityId(row)
  if (!communityId) {
    ElMessage.error('社区 ID 缺失，无法切换加入方式')
    return
  }

  const current = normalizeJoinType(row.joinType)
  const next: JoinType = current === 'open' ? 'approval' : 'open'
  const nextLabel = formatJoinType(next)
  try {
    await ElMessageBox.confirm(
      `确认将社区“${row.name || communityId}”改为“${nextLabel}”吗？改动会立即影响新用户加入流程。`,
      '切换加入方式',
      { type: 'warning', confirmButtonText: '确认切换', cancelButtonText: '取消' }
    )
  } catch {
    return
  }

  updatingJoinTypeId.value = communityId
  try {
    await communityApi.updateMeta({ communityId, joinType: next })
    row.joinType = next
    ElMessage.success(`已改为${nextLabel}`)
  } catch (e: any) {
    ElMessage.error(e.message || '切换加入方式失败')
  } finally {
    updatingJoinTypeId.value = ''
  }
}

async function disableCommunity(row: any) {
  const communityId = getCommunityId(row)
  if (!communityId) {
    ElMessage.error('社区 ID 缺失，无法禁用')
    return
  }

  try {
    await ElMessageBox.confirm(
      `确认禁用社区「${row.name}」吗？禁用后小程序端将不可见，可随时在“已禁用社区”页面恢复。`,
      '禁用确认',
      { type: 'warning', confirmButtonText: '禁用', cancelButtonText: '取消' }
    )
  } catch {
    return
  }

  disablingId.value = communityId
  try {
    await communityApi.disable(communityId)
    ElMessage.success('已禁用')
    communities.value = communities.value.filter(c => c._id !== communityId)
  } catch (e: any) {
    ElMessage.error(e.message || '禁用失败')
  } finally {
    disablingId.value = ''
  }
}
</script>

<style scoped>
.wrapping-table-cell {
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
  line-height: 1.55;
  padding: 2px 0;
}

.muted-table-cell {
  color: #c0c4cc;
}
</style>
