<template>
  <div data-testid="community-list-page">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h3>社区管理</h3>
      <el-button data-testid="community-list-refresh" @click="loadCommunities" :loading="loading">刷新</el-button>
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
        <el-option label="已拒绝" value="rejected" />
      </el-select>
    </div>

    <el-table data-testid="community-table" :data="filteredCommunities" v-loading="loading" style="width: 100%">
      <el-table-column prop="name" label="社区名称" min-width="180" />
      <el-table-column prop="description" label="描述" min-width="220" show-overflow-tooltip />
      <el-table-column label="格言" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">
          <span v-if="row.motto">
            "{{ row.motto }}"
            <span v-if="row.mottoCite" style="color: #909399; margin-left: 6px;">- {{ row.mottoCite }}</span>
          </span>
          <span v-else style="color: #c0c4cc;">未设置</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="120">
        <template #default="{ row }">
          <el-tag v-if="row.status === 'active'" type="success">已启用</el-tag>
          <el-tag v-else-if="row.status === 'pending'" type="warning">待审批</el-tag>
          <el-tag v-else-if="row.status === 'rejected'" type="danger">已拒绝</el-tag>
          <el-tag v-else-if="row.status === 'disabled'" type="info">已禁用</el-tag>
          <el-tag v-else type="info">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="memberCount" label="成员数" width="100" />
      <el-table-column label="操作" width="420">
        <template #default="{ row }">
          <template v-if="row.status === 'active'">
            <el-button data-testid="community-sections-button" :data-community-id="getCommunityId(row)" size="small" @click="goSections(getCommunityId(row))">板块管理</el-button>
            <el-button data-testid="community-members-button" :data-community-id="getCommunityId(row)" size="small" @click="goMembers(getCommunityId(row))">成员管理</el-button>
            <el-button size="small" @click="goPosts(getCommunityId(row))">帖子管理</el-button>
            <el-button data-testid="community-motto-button" :data-community-id="getCommunityId(row)" size="small" @click="openMotto(row)">格言</el-button>
            <el-button
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
import { ElMessage, ElMessageBox } from 'element-plus'
import { communityApi } from '../../api/cloud'

const router = useRouter()
const loading = ref(false)
const communities = ref<any[]>([])
const disablingId = ref('')
const showMottoDialog = ref(false)
const savingMotto = ref(false)
const keyword = ref('')
const statusFilter = ref<'all' | 'active' | 'rejected'>('all')
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
      .filter((c: any) => c.status === 'active' || c.status === 'rejected')
  } catch (e: any) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function getCommunityId(row: any): string {
  return String(row?._id || row?.id || '')
}

function goSections(communityId: string) {
  if (!communityId) {
    ElMessage.error('社区 ID 缺失，无法进入板块管理')
    return
  }
  router.push({ name: 'sections', params: { communityId } })
}

function goMembers(communityId: string) {
  if (!communityId) {
    ElMessage.error('社区 ID 缺失，无法进入成员管理')
    return
  }
  router.push({ name: 'members', params: { communityId } })
}

function goPosts(communityId: string) {
  if (!communityId) {
    ElMessage.error('社区 ID 缺失，无法进入帖子管理')
    return
  }
  router.push({ name: 'posts', params: { communityId } })
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
