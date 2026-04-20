<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h3>社区管理</h3>
      <el-button @click="loadCommunities" :loading="loading">刷新</el-button>
    </div>

    <el-table :data="communities" v-loading="loading" style="width: 100%">
      <el-table-column prop="name" label="社区名称" min-width="180" />
      <el-table-column prop="description" label="描述" min-width="220" show-overflow-tooltip />
      <el-table-column label="格言" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">
          <span v-if="row.motto">"{{ row.motto }}"<span v-if="row.mottoCite" style="color:#909399; margin-left:6px;">— {{ row.mottoCite }}</span></span>
          <span v-else style="color: #C0C4CC;">未设置</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="120">
        <template #default="{ row }">
          <el-tag v-if="row.status === 'active'" type="success">已启用</el-tag>
          <el-tag v-else-if="row.status === 'pending'" type="warning">待审批</el-tag>
          <el-tag v-else-if="row.status === 'disabled'" type="info">已禁用</el-tag>
          <el-tag v-else type="info">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="memberCount" label="成员数" width="100" />
      <el-table-column label="操作" width="340">
        <template #default="{ row }">
          <el-button size="small" @click="goSections(row._id)">板块管理</el-button>
          <el-button size="small" @click="goMembers(row._id)">成员审批</el-button>
          <el-button size="small" @click="openMotto(row)">格言</el-button>
          <el-button
            size="small"
            type="danger"
            :loading="disablingId === row._id"
            @click="disableCommunity(row)"
          >
            禁用
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-empty
      v-if="!loading && communities.length === 0"
      description="暂无可管理社区"
    />

    <el-dialog v-model="showMottoDialog" title="编辑社区格言" width="480px">
      <div style="color: #909399; font-size: 13px; margin-bottom: 12px;">
        格言会显示在小程序首页的引文区域。可以留空不显示。
      </div>
      <el-form :model="mottoForm" label-width="80px">
        <el-form-item label="格言">
          <el-input
            v-model="mottoForm.motto"
            type="textarea"
            :rows="2"
            maxlength="60"
            show-word-limit
            placeholder="例：远亲不如近邻，近邻不如对门。"
          />
        </el-form-item>
        <el-form-item label="出处">
          <el-input
            v-model="mottoForm.mottoCite"
            maxlength="20"
            show-word-limit
            placeholder="例：民谚 / 作者名（可选）"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showMottoDialog = false">取消</el-button>
        <el-button type="primary" @click="saveMotto" :loading="savingMotto">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { communityApi } from '../../api/cloud'

const router = useRouter()
const loading = ref(false)
const communities = ref<any[]>([])
const disablingId = ref('')
const showMottoDialog = ref(false)
const savingMotto = ref(false)
const mottoForm = ref<{ communityId: string; motto: string; mottoCite: string }>({
  communityId: '', motto: '', mottoCite: '',
})

onMounted(() => {
  loadCommunities()
})

async function loadCommunities() {
  loading.value = true
  try {
    const res = await communityApi.list() as any
    // 只展示已启用社区；pending 社区在"社区审批"页处理，disabled 社区在"已禁用社区"页处理
    communities.value = (res.communities ?? []).filter((c: any) => c.status === 'active')
  } catch (e: any) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function goSections(communityId: string) {
  router.push(`/sections/${communityId}`)
}

function goMembers(communityId: string) {
  router.push(`/members/${communityId}`)
}

function openMotto(row: any) {
  mottoForm.value = {
    communityId: row._id,
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
    // 更新本地缓存，避免重新加载整个列表
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
  try {
    await ElMessageBox.confirm(
      `确认禁用社区「${row.name}」吗？禁用后小程序端将不可见，可随时在"已禁用社区"页恢复。`,
      '禁用确认',
      { type: 'warning', confirmButtonText: '禁用', cancelButtonText: '取消' }
    )
  } catch {
    return
  }

  disablingId.value = row._id
  try {
    await communityApi.disable(row._id)
    ElMessage.success('已禁用')
    communities.value = communities.value.filter(c => c._id !== row._id)
  } catch (e: any) {
    ElMessage.error(e.message || '禁用失败')
  } finally {
    disablingId.value = ''
  }
}
</script>
