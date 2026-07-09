<template>
  <div data-testid="community-list-page">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h3>{{ authStore.isSuperAdmin ? '社区管理' : '我的社区' }}</h3>
      <div style="display: flex; gap: 8px;">
        <el-button data-testid="community-create-entry" type="primary" @click="goCreate">创建社区</el-button>
        <el-button data-testid="community-list-refresh" @click="loadCommunities" :loading="loading">刷新</el-button>
      </div>
    </div>

    <el-tabs v-model="communityTab" class="community-tabs" style="margin-bottom: 12px;">
      <el-tab-pane data-testid="community-tab-all" name="all" :label="`全部社区(${allCount})`" />
      <el-tab-pane data-testid="community-tab-active" name="active" :label="`已启用(${activeCount})`" />
      <el-tab-pane
        v-if="authStore.isSuperAdmin"
        data-testid="community-tab-disabled"
        name="disabled"
        :label="`已禁用(${disabledCount})`"
      />
    </el-tabs>

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
        <el-option v-if="authStore.isSuperAdmin" label="已禁用" value="disabled" />
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
            <el-button size="small" @click="goPosts(getCommunityId(row))">帖子管理</el-button>
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
            <el-dropdown
              data-testid="community-more-actions"
              trigger="click"
              style="margin-left: 8px;"
              @command="(command: any) => handleCommunityCommand(row, command)"
            >
              <el-button size="small">
                更多<el-icon style="margin-left: 4px;"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item data-testid="community-members-button" command="members">成员管理</el-dropdown-item>
                  <el-dropdown-item data-testid="community-motto-button" command="motto">格言</el-dropdown-item>
                  <el-dropdown-item data-testid="community-banner-button" command="banner">首页 Banner</el-dropdown-item>
                  <el-dropdown-item
                    data-testid="community-join-type-toggle"
                    command="joinType"
                    :disabled="updatingJoinTypeId === getCommunityId(row)"
                  >
                    {{ normalizeJoinType(row.joinType) === 'open' ? '改为申请加入' : '改为直接加入' }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
          <template v-else-if="row.status === 'disabled'">
            <el-button
              data-testid="community-restore-button"
              :data-community-id="getCommunityId(row)"
              size="small"
              type="primary"
              plain
              :loading="restoringId === getCommunityId(row)"
              @click="restoreCommunity(row)"
            >
              恢复
            </el-button>
            <el-dropdown
              data-testid="community-more-actions"
              trigger="click"
              style="margin-left: 8px;"
              @command="(command: any) => handleCommunityCommand(row, command)"
            >
              <el-button size="small">
                更多<el-icon style="margin-left: 4px;"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item
                    command="hardDelete"
                    :disabled="hardDeletingId === getCommunityId(row)"
                    class="danger-dropdown-item"
                  >永久删除</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
          <span v-else-if="row.status === 'pending'" style="color: #909399;">等待超级管理员审批</span>
          <span v-else style="color: #909399;">已拒绝，仅读历史记录</span>
        </template>
      </el-table-column>
    </el-table>

    <el-empty v-if="!loading && filteredCommunities.length === 0" description="暂无可管理社区" />

    <el-dialog v-model="showMottoDialog" title="编辑格言" width="560px">
      <div style="color: #909399; font-size: 13px; margin-bottom: 12px;">
        格言会显示在小程序首页社区名下方，可以留空不展示。Banner 图片请到“首页 Banner”单独管理。
      </div>
      <el-form :model="mottoForm" label-width="70px">
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

    <el-dialog
      v-model="showBannerDialog"
      data-testid="community-banner-dialog"
      title="首页 Banner 管理"
      width="860px"
    >
      <div class="banner-dialog-help">
        从当前社区的任意板块选择帖子，单独上传首页展示图。用户点击 Banner 后会进入关联帖子详情。
      </div>
      <div class="banner-toolbar">
        <el-button data-testid="community-banner-add" type="primary" @click="addBannerRow">添加 Banner</el-button>
        <span class="muted-table-cell">拖拽图片可更换封面；第一张图会作为 Banner 图。</span>
      </div>
      <div v-loading="loadingBannerPosts" class="banner-manager">
        <div
          v-for="(row, index) in bannerForm.rows"
          :key="row.localId"
          data-testid="community-banner-row"
          class="banner-row"
        >
          <div class="banner-row-head">
            <strong>第 {{ index + 1 }} 位</strong>
            <div class="banner-row-actions">
              <el-button size="small" :disabled="index === 0" @click="moveBannerRow(index, -1)">上移</el-button>
              <el-button size="small" :disabled="index === bannerForm.rows.length - 1" @click="moveBannerRow(index, 1)">下移</el-button>
              <el-button size="small" type="danger" @click="removeBannerRow(index)">删除</el-button>
            </div>
          </div>
          <el-form :model="row" label-width="86px">
            <el-form-item label="关联帖子">
              <el-select
                v-model="row.postId"
                filterable
                style="width: 100%;"
                placeholder="选择当前社区中的帖子"
                @change="onBannerPostChange(row)"
              >
                <el-option
                  v-for="post in bannerPostOptions"
                  :key="post.postId"
                  :label="post.label"
                  :value="post.postId"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="展示标题">
              <el-input
                v-model="row.title"
                maxlength="60"
                show-word-limit
                placeholder="可选；为空时小程序会使用帖子标题"
              />
            </el-form-item>
            <el-form-item label="封面图">
              <div data-testid="community-banner-cover-editor" style="width: 100%;">
                <ImageGroupAdminEditor v-model="row.coverImages" />
                <div class="muted-table-cell" style="margin-top: 6px;">仅第一张作为首页 Banner 图；可上传图片，也可粘贴 cloud:// 或 https:// 图片地址。</div>
              </div>
            </el-form-item>
          </el-form>
        </div>
        <el-empty v-if="!loadingBannerPosts && bannerForm.rows.length === 0" description="暂无 Banner" />
      </div>
      <template #footer>
        <el-button @click="showBannerDialog = false">取消</el-button>
        <el-button data-testid="community-banner-save" type="primary" @click="saveHomeBanners" :loading="savingBanners">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus/es/components/message/index'
import { ElMessageBox } from 'element-plus/es/components/message-box/index'
import { ArrowDown } from '@element-plus/icons-vue'
import { approvalApi, communityApi, postAdminApi } from '../../api/cloud'
import { useAuthStore } from '../../stores/auth'
import { usePersistedTableColumns } from '../../utils/persistedTableColumns'
import ImageGroupAdminEditor from '../../components/ImageGroupAdminEditor.vue'

const router = useRouter()
const authStore = useAuthStore()
const loading = ref(false)
const communities = ref<any[]>([])
const disablingId = ref('')
const restoringId = ref('')
const hardDeletingId = ref('')
const updatingJoinTypeId = ref('')
const showMottoDialog = ref(false)
const savingMotto = ref(false)
const showBannerDialog = ref(false)
const savingBanners = ref(false)
const loadingBannerPosts = ref(false)
const bannerPosts = ref<any[]>([])
const keyword = ref('')
const communityTab = ref<'all' | 'active' | 'disabled'>('all')
const statusFilter = ref<'all' | 'active' | 'pending' | 'rejected' | 'disabled'>('all')
const pendingMemberCountByCommunity = ref<Record<string, number>>({})
interface BannerFormRow {
  localId: string
  bannerId: string
  postId: string
  title: string
  coverImages: string[]
}
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

const COMMUNITY_TABLE_COLUMN_WIDTHS_KEY = 'happyhome.admin.communityTable.columnWidths.v2'
const COMMUNITY_TABLE_DEFAULT_COLUMN_WIDTHS: Record<CommunityTableColumnKey, number> = {
  name: 150,
  description: 180,
  motto: 180,
  status: 100,
  joinType: 105,
  memberCount: 85,
  pendingMemberCount: 110,
  actions: 250,
}
const COMMUNITY_TABLE_MIN_COLUMN_WIDTHS: Record<CommunityTableColumnKey, number> = {
  name: 140,
  description: 160,
  motto: 160,
  status: 90,
  joinType: 100,
  memberCount: 80,
  pendingMemberCount: 100,
  actions: 230,
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
const bannerForm = ref<{ communityId: string; rows: BannerFormRow[] }>({
  communityId: '',
  rows: [],
})

const filteredCommunities = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  return communities.value.filter((community) => {
    if (communityTab.value === 'active' && community.status !== 'active') return false
    if (communityTab.value === 'disabled' && community.status !== 'disabled') return false
    if (statusFilter.value !== 'all' && community.status !== statusFilter.value) return false
    if (!q) return true
    return [community.name, community.description, community.motto, community.mottoCite]
      .some((part) => String(part || '').toLowerCase().includes(q))
  })
})

const allCount = computed(() => communities.value.length)
const activeCount = computed(() => communities.value.filter((community) => community.status === 'active').length)
const disabledCount = computed(() => communities.value.filter((community) => community.status === 'disabled').length)

const bannerPostOptions = computed(() => {
  return bannerPosts.value.map((post) => ({
    postId: String(post._id || post.id || ''),
    title: extractPostTitle(post),
    label: `${post.sectionName || '未命名板块'}｜${extractPostTitle(post)}`,
  })).filter((post) => post.postId)
})

onMounted(() => {
  loadCommunities()
})

watch(communityTab, () => {
  statusFilter.value = 'all'
})

async function loadCommunities() {
  loading.value = true
  try {
    const [res, disabledRes] = await Promise.all([
      communityApi.list() as Promise<any>,
      authStore.isSuperAdmin ? communityApi.listDisabled() as Promise<any> : Promise.resolve({ communities: [] }),
    ])
    const visibleCommunities = (res.communities ?? [])
      .map((c: any) => ({ ...c, _id: c._id || c.id || '' }))
      .filter((c: any) => ['active', 'pending', 'rejected'].includes(c.status))
    const disabledCommunities = (disabledRes.communities ?? [])
      .map((c: any) => ({ ...c, _id: c._id || c.id || '', status: 'disabled' }))
      .filter((c: any) => getCommunityId(c))
    const byId = new Map<string, any>()
    for (const community of [...visibleCommunities, ...disabledCommunities]) {
      byId.set(getCommunityId(community), community)
    }
    communities.value = Array.from(byId.values())
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

async function handleCommunityCommand(row: any, command: string) {
  if (command === 'members') {
    await goMembers(getCommunityId(row))
    return
  }
  if (command === 'motto') {
    openMottoEditor(row)
    return
  }
  if (command === 'banner') {
    await openBannerManager(row)
    return
  }
  if (command === 'joinType') {
    await toggleJoinType(row)
    return
  }
  if (command === 'hardDelete') {
    await hardDeleteCommunity(row)
  }
}

function openMottoEditor(row: any) {
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

async function openBannerManager(row: any) {
  const communityId = getCommunityId(row)
  if (!communityId) {
    ElMessage.error('社区 ID 缺失，无法管理首页 Banner')
    return
  }

  bannerForm.value = {
    communityId,
    rows: normalizeBannerRows(row.homeBanners || []),
  }
  showBannerDialog.value = true
  await loadBannerPosts(communityId)
}

async function loadBannerPosts(communityId: string) {
  loadingBannerPosts.value = true
  try {
    const res = await postAdminApi.list({
      communityId,
      status: 'active',
      auditStatus: 'all',
    }) as any
    bannerPosts.value = res.posts || []
  } catch (e: any) {
    bannerPosts.value = []
    ElMessage.error(e.message || '加载帖子失败')
  } finally {
    loadingBannerPosts.value = false
  }
}

function normalizeBannerRows(banners: any[]): BannerFormRow[] {
  return (Array.isArray(banners) ? banners : [])
    .slice()
    .sort((a, b) => Number(a?.order || 0) - Number(b?.order || 0))
    .map((banner, index) => ({
      localId: `${Date.now()}-${index}-${String(banner?.postId || '')}`,
      bannerId: String(banner?.bannerId || ''),
      postId: String(banner?.postId || ''),
      title: String(banner?.title || ''),
      coverImages: banner?.coverImage ? [String(banner.coverImage)] : [],
    }))
}

function addBannerRow() {
  bannerForm.value.rows.push({
    localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    bannerId: '',
    postId: '',
    title: '',
    coverImages: [],
  })
}

function moveBannerRow(index: number, delta: number) {
  const nextIndex = index + delta
  if (nextIndex < 0 || nextIndex >= bannerForm.value.rows.length) return
  const rows = bannerForm.value.rows
  const [row] = rows.splice(index, 1)
  rows.splice(nextIndex, 0, row)
}

function removeBannerRow(index: number) {
  bannerForm.value.rows.splice(index, 1)
}

function onBannerPostChange(row: BannerFormRow) {
  if (row.title.trim()) return
  const selected = bannerPostOptions.value.find((post) => post.postId === row.postId)
  if (selected) row.title = selected.title
}

async function saveHomeBanners() {
  const seenPostIds = new Set<string>()
  for (const [index, row] of bannerForm.value.rows.entries()) {
    if (!row.postId) {
      ElMessage.error(`第 ${index + 1} 个 Banner 请选择关联帖子`)
      return
    }
    if (!row.coverImages[0]) {
      ElMessage.error(`第 ${index + 1} 个 Banner 请上传封面图`)
      return
    }
    if (seenPostIds.has(row.postId)) {
      ElMessage.error('Banner 关联帖子不能重复')
      return
    }
    seenPostIds.add(row.postId)
  }

  savingBanners.value = true
  try {
    const banners = bannerForm.value.rows.map((row) => ({
      bannerId: row.bannerId,
      postId: row.postId,
      title: row.title,
      coverImage: row.coverImages[0] || '',
      enabled: true,
    }))
    await communityApi.updateHomeBanners({
      communityId: bannerForm.value.communityId,
      banners,
    })
    const target = communities.value.find(c => c._id === bannerForm.value.communityId)
    if (target) {
      target.homeBanners = banners.map((banner, index) => ({
        ...banner,
        bannerId: banner.bannerId || `${banner.postId}-${index}`,
        order: index,
      }))
    }
    ElMessage.success('已保存首页 Banner')
    showBannerDialog.value = false
  } catch (e: any) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    savingBanners.value = false
  }
}

function extractPostTitle(post: any): string {
  const content = post?.content || {}
  const direct = pickReadableText(Object.values(content), 0)
  return direct || post?.title || post?._id || '未命名帖子'
}

function pickReadableText(values: unknown[], depth: number): string {
  if (depth > 2) return ''
  for (const value of values) {
    if (typeof value === 'string') {
      const text = value.trim().replace(/\s+/g, ' ')
      if (text) return text.slice(0, 40)
    }
    if (Array.isArray(value)) {
      const nested = pickReadableText(value, depth + 1)
      if (nested) return nested
    }
    if (value && typeof value === 'object') {
      const objectValue = value as Record<string, unknown>
      const preferred = pickReadableText([
        objectValue.title,
        objectValue.name,
        objectValue.text,
        objectValue.address,
        objectValue.content,
      ], depth + 1)
      if (preferred) return preferred
    }
  }
  return ''
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
      `确认禁用社区「${row.name}」吗？禁用后小程序端将不可见，可在当前页面“已禁用”tab 中恢复。`,
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
    await loadCommunities()
    communityTab.value = 'disabled'
  } catch (e: any) {
    ElMessage.error(e.message || '禁用失败')
  } finally {
    disablingId.value = ''
  }
}

async function restoreCommunity(row: any) {
  const communityId = getCommunityId(row)
  if (!communityId) {
    ElMessage.error('社区 ID 缺失，无法恢复')
    return
  }

  restoringId.value = communityId
  try {
    await communityApi.restore(communityId)
    ElMessage.success('已恢复')
    await loadCommunities()
    communityTab.value = 'active'
  } catch (e: any) {
    ElMessage.error(e.message || '恢复失败')
  } finally {
    restoringId.value = ''
  }
}

async function hardDeleteCommunity(row: any) {
  const communityId = getCommunityId(row)
  if (!communityId) {
    ElMessage.error('社区 ID 缺失，无法永久删除')
    return
  }

  try {
    await ElMessageBox.confirm(
      `确认永久删除社区「${row.name || communityId}」吗？该操作不可恢复，请确认社区已经不再需要保留。`,
      '永久删除确认',
      { type: 'error', confirmButtonText: '永久删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }

  hardDeletingId.value = communityId
  try {
    await communityApi.hardDelete(communityId)
    ElMessage.success('已永久删除')
    communities.value = communities.value.filter((community) => getCommunityId(community) !== communityId)
  } catch (e: any) {
    ElMessage.error(e.message || '永久删除失败')
  } finally {
    hardDeletingId.value = ''
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

.community-tabs {
  --el-tabs-header-height: 36px;
}

:deep(.danger-dropdown-item) {
  color: #f56c6c;
}

.banner-dialog-help {
  color: #606266;
  font-size: 13px;
  line-height: 1.6;
  margin-bottom: 12px;
}

.banner-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.banner-manager {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 62vh;
  overflow: auto;
  padding-right: 4px;
}

.banner-row {
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 14px 14px 4px;
  background: #fff;
}

.banner-row-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.banner-row-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
