<template>
  <view class="create-page">
    <!-- Guard: not logged in -->
    <view v-if="!userStore.isLoggedIn" class="guard-state">
      <text class="guard-title">请先登录</text>
      <text class="guard-desc">登录后才能发布内容</text>
      <wd-button size="small" plain type="primary" @click="goLogin">去登录</wd-button>
    </view>

    <!-- Guard: no community selected -->
    <view v-else-if="!communityStore.currentCommunityId" class="guard-state">
      <text class="guard-title">还没有加入社区</text>
      <text class="guard-desc">加入社区后才能发帖</text>
      <wd-button size="small" plain type="primary" @click="goOnboarding">去加入</wd-button>
    </view>

    <!-- Guard: checking membership -->
    <view v-else-if="membershipChecking" class="guard-state">
      <wd-loading color="#E07A5F" />
      <text class="guard-desc">检查社区成员身份...</text>
    </view>

    <!-- Guard: not a member of current community -->
    <view v-else-if="!isMember" class="guard-state">
      <text class="guard-title">你还不是「{{ communityStore.currentCommunity?.name }}」的成员</text>
      <text class="guard-desc">{{ memberStatus === 'pending' ? '你的加入申请正在审批中，请耐心等待' : '加入社区后才能发帖' }}</text>
      <wd-button
        v-if="memberStatus !== 'pending'"
        size="small"
        plain
        type="primary"
        :loading="joining"
        @click="handleJoin"
      >
        加入社区
      </wd-button>
    </view>

    <!-- Normal flow: member of current community -->
    <template v-else>
      <!-- Step 1: Select section -->
      <view v-if="!selectedSection" class="section-picker">
        <text class="title">选择板块</text>
        <wd-cell
          v-for="section in communityStore.currentSections"
          :key="section._id"
          :title="section.name"
          is-link
          class="section-cell"
          @click="selectSection(section)"
        />
      </view>

      <!-- Step 2: Fill form -->
      <view v-else class="form">
        <view class="form-header">
          <text class="section-tag" @tap="selectedSection = null">‹ {{ selectedSection.name }}</text>
        </view>
        <WidgetEditor
          v-for="widget in selectedSection.widgets"
          :key="widget.widgetId"
          :widget="widget"
          v-model="formData[widget.widgetId]"
        />
        <wd-button
          type="primary"
          block
          :loading="submitting"
          :disabled="submitting"
          @click="handleSubmit"
        >
          发布
        </wd-button>
      </view>
    </template>
  </view>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useCommunityStore } from '../../store/community'
import { useUserStore } from '../../store/user'
import { postApi, memberApi } from '../../api/cloud'
import WidgetEditor from '../../components/widgets/WidgetEditor.vue'

const communityStore = useCommunityStore()
const userStore = useUserStore()
const selectedSection = ref<any>(null)
const formData = reactive<Record<string, any>>({})
const submitting = ref(false)

// Membership guard state
const membershipChecking = ref(false)
const isMember = ref(false)
const memberStatus = ref<string | null>(null)
const joining = ref(false)

async function checkMembership() {
  if (!communityStore.currentCommunityId || !userStore.isLoggedIn) {
    isMember.value = false
    return
  }
  membershipChecking.value = true
  try {
    const res = await memberApi.myStatus(communityStore.currentCommunityId)
    isMember.value = res.isMember
    memberStatus.value = res.status
  } catch {
    isMember.value = false
    memberStatus.value = null
  } finally {
    membershipChecking.value = false
  }
}

// Re-check when community switches or page shows
onShow(() => { checkMembership() })
watch(() => communityStore.currentCommunityId, () => { checkMembership() })

async function handleJoin() {
  joining.value = true
  try {
    const res = await memberApi.apply(communityStore.currentCommunityId)
    if (res.status === 'active') {
      isMember.value = true
      memberStatus.value = 'active'
      uni.showToast({ title: '加入成功', icon: 'success' })
    } else {
      memberStatus.value = 'pending'
      uni.showToast({ title: '申请已提交，等待审批', icon: 'none' })
    }
  } catch (e: any) {
    uni.showModal({ title: '加入失败', content: e?.message ?? '请重试' })
  } finally {
    joining.value = false
  }
}

function goLogin() {
  uni.switchTab({ url: '/pages/profile/index' })
}

function goOnboarding() {
  uni.navigateTo({ url: '/pages/onboarding/index' })
}

function selectSection(section: any) {
  selectedSection.value = section
  Object.keys(formData).forEach((k) => delete formData[k])
}

// Upload temp images to cloud storage, return cloud file IDs
async function uploadImages(tempPaths: string[]): Promise<string[]> {
  return Promise.all(tempPaths.map((path) => {
    if (path.startsWith('cloud://')) return Promise.resolve(path)
    const ext = path.split('.').pop() ?? 'jpg'
    const cloudPath = `posts/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
    return new Promise<string>((resolve, reject) => {
      wx.cloud.uploadFile({
        cloudPath,
        filePath: path,
        success: (res: any) => resolve(res.fileID),
        fail: reject,
      })
    })
  }))
}

async function handleSubmit() {
  submitting.value = true
  try {
    const content = { ...formData }
    for (const widget of selectedSection.value.widgets) {
      if (widget.type === 'image_group' && Array.isArray(content[widget.widgetId])) {
        content[widget.widgetId] = await uploadImages(content[widget.widgetId])
      }
    }

    await postApi.create({
      communityId: communityStore.currentCommunityId,
      sectionId: selectedSection.value._id,
      content,
    })
    uni.showToast({ title: '发布成功', icon: 'success' })
    selectedSection.value = null
    uni.switchTab({ url: '/pages/index/index' })
  } catch (e: any) {
    uni.showModal({ title: '发布失败', content: e?.message ?? '请重试' })
  } finally {
    submitting.value = false
  }
}
</script>

<style lang="scss" scoped>
.create-page {
  padding: $hh-space-lg;
  background: $hh-color-bg;
  min-height: 100vh;
}

.title {
  font-size: $hh-font-h2;
  font-weight: $hh-font-weight-medium;
  color: $hh-color-text;
  display: block;
  margin-bottom: $hh-space-lg;
}

/* ── Section picker (Step 1) ── */
.section-cell {
  margin-bottom: $hh-space-sm;
  border-radius: $hh-radius-md;
  overflow: hidden;
}

/* ── Form (Step 2) ── */
.form-header {
  margin-bottom: $hh-space-lg;
}

.section-tag {
  font-size: $hh-font-body;
  color: $hh-color-primary-text;
}

/* ── Guard states (empty / no-permission) ── */
.guard-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  gap: $hh-space-md;
}

.guard-title {
  font-size: $hh-font-h3;
  font-weight: $hh-font-weight-medium;
  color: $hh-color-text;
  text-align: center;
}

.guard-desc {
  font-size: $hh-font-body;
  color: $hh-color-text-mute;
  text-align: center;
}
</style>
