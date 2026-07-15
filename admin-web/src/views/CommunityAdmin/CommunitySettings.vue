<template>
  <div data-testid="community-settings-page">
    <el-breadcrumb separator="/"><el-breadcrumb-item :to="{ name: 'communities' }">社区管理</el-breadcrumb-item><el-breadcrumb-item>{{ form.name || '当前社区' }}</el-breadcrumb-item><el-breadcrumb-item>社区设置</el-breadcrumb-item></el-breadcrumb>
    <h3>社区设置</h3>
    <el-form v-loading="loading" :model="form" label-width="110px" class="settings-form">
      <el-card shadow="never"><template #header><strong>基本资料</strong></template>
        <el-form-item label="社区名称"><el-input v-model="form.name" maxlength="40" /></el-form-item>
        <el-form-item label="社区描述"><el-input v-model="form.description" type="textarea" :rows="3" maxlength="300" /></el-form-item>
      </el-card>
      <el-card shadow="never"><template #header><strong>首页展示</strong></template>
        <el-form-item label="格言"><el-input v-model="form.motto" maxlength="60" /></el-form-item>
        <el-form-item label="引用/出处"><el-input v-model="form.mottoCite" maxlength="20" /></el-form-item>
        <el-form-item label="Banner">
          <div class="banner-list">
            <div v-for="(banner, index) in banners" :key="index" class="banner-row">
              <el-input v-model="banner.postId" placeholder="关联帖子 ID" />
              <el-input v-model="banner.title" placeholder="展示标题（可选）" />
              <el-input v-model="banner.coverImage" placeholder="cloud:// 或 https:// 封面图" />
              <el-switch v-model="banner.enabled" active-text="展示" />
              <el-button type="danger" link @click="banners.splice(index, 1)">删除</el-button>
            </div>
            <el-button @click="banners.push(emptyBanner())">添加 Banner</el-button>
          </div>
        </el-form-item>
      </el-card>
      <el-card shadow="never"><template #header><strong>加入方式</strong></template>
        <el-form-item label="成员加入"><el-radio-group v-model="form.joinType"><el-radio value="open">直接加入</el-radio><el-radio value="approval">申请加入</el-radio></el-radio-group></el-form-item>
      </el-card>
      <div class="save-bar"><el-button type="primary" :loading="saving" @click="save">保存设置</el-button></div>
    </el-form>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus/es/components/message/index'
import { communityApi } from '../../api/cloud'
import { useCommunityNavigationStore } from '../../stores/communityNavigation'

const route = useRoute()
const navigation = useCommunityNavigationStore()
const communityId = String(route.params.communityId || '')
const loading = ref(false)
const saving = ref(false)
const form = reactive({ name: '', description: '', motto: '', mottoCite: '', joinType: 'open' as 'open' | 'approval' })
const banners = ref<any[]>([])
function emptyBanner() { return { postId: '', title: '', coverImage: '', enabled: true } }

onMounted(load)
async function load() {
  loading.value = true
  try {
    const res = await communityApi.list() as any
    const community = (res.communities || []).find((item: any) => String(item._id || item.id || '') === communityId)
    if (!community) throw new Error('未找到该社区')
    form.name = String(community.name || '')
    form.description = String(community.description || '')
    form.motto = String(community.motto || '')
    form.mottoCite = String(community.mottoCite || '')
    form.joinType = community.joinType === 'approval' ? 'approval' : 'open'
    banners.value = Array.isArray(community.homeBanners) ? community.homeBanners.map((item: any) => ({ ...emptyBanner(), ...item })) : []
  } catch (error: any) { ElMessage.error(error.message || '加载社区设置失败') }
  finally { loading.value = false }
}
async function save() {
  if (!form.name.trim()) { ElMessage.warning('请输入社区名称'); return }
  const validBanners = banners.value.filter(item => item.postId && item.coverImage)
  if (validBanners.length !== banners.value.length) { ElMessage.warning('请完整填写 Banner 的帖子 ID 和封面图'); return }
  saving.value = true
  try {
    await communityApi.updateMeta({ communityId, name: form.name.trim(), description: form.description.trim(), motto: form.motto.trim(), mottoCite: form.mottoCite.trim(), joinType: form.joinType })
    await communityApi.updateHomeBanners({ communityId, banners: validBanners })
    await navigation.refresh()
    ElMessage.success('社区设置已保存')
  } catch (error: any) { ElMessage.error(error.message || '保存失败') }
  finally { saving.value = false }
}
</script>

<style scoped>
.settings-form{display:grid;gap:16px;max-width:960px}.banner-list{display:grid;gap:10px;width:100%}.banner-row{display:grid;grid-template-columns:1fr 1fr 1.4fr auto auto;gap:8px;align-items:center}.save-bar{position:sticky;bottom:0;padding:14px 0;background:#fff}@media(max-width:900px){.banner-row{grid-template-columns:1fr}}
</style>
