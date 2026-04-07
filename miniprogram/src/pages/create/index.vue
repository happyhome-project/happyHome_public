<template>
  <view class="create-page">
    <!-- Step 1: Select section -->
    <view v-if="!selectedSection" class="section-picker">
      <text class="title">选择板块</text>
      <view
        v-for="section in communityStore.currentSections"
        :key="section._id"
        class="section-option"
        @tap="selectSection(section)"
      >
        <text class="section-name">{{ section.name }}</text>
        <text class="arrow">›</text>
      </view>
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
      <button
        class="submit-btn"
        :disabled="submitting"
        @tap="handleSubmit"
      >
        {{ submitting ? '发布中...' : '发布' }}
      </button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useCommunityStore } from '../../store/community'
import { useUserStore } from '../../store/user'
import { postApi } from '../../api/cloud'
import WidgetEditor from '../../components/widgets/WidgetEditor.vue'

const communityStore = useCommunityStore()
const userStore = useUserStore()
const selectedSection = ref<any>(null)
const formData = reactive<Record<string, any>>({})
const submitting = ref(false)

function selectSection(section: any) {
  selectedSection.value = section
  // Clear form data when switching sections
  Object.keys(formData).forEach((k) => delete formData[k])
}

async function handleSubmit() {
  if (!userStore.isLoggedIn) {
    uni.showModal({ title: '提示', content: '请先登录' })
    return
  }
  if (!communityStore.currentCommunityId) {
    uni.showModal({ title: '提示', content: '需要先加入社区，或创建自己的社区' })
    return
  }
  submitting.value = true
  try {
    await postApi.create({
      communityId: communityStore.currentCommunityId,
      sectionId: selectedSection.value._id,
      content: { ...formData },
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

<style scoped>
.create-page { padding: 32rpx; background: #fff; min-height: 100vh; }
.title { font-size: 36rpx; font-weight: bold; display: block; margin-bottom: 32rpx; }
.section-option {
  display: flex; justify-content: space-between; align-items: center;
  padding: 32rpx; border-radius: 16rpx; background: #f8f8f8; margin-bottom: 16rpx;
}
.section-name { font-size: 30rpx; color: #333; }
.arrow { font-size: 32rpx; color: #bbb; }
.form-header { margin-bottom: 32rpx; }
.section-tag { font-size: 28rpx; color: #666; }
.submit-btn {
  margin-top: 48rpx; background: #333; color: #fff; border-radius: 12rpx;
  font-size: 32rpx; padding: 24rpx;
}
.submit-btn[disabled] { background: #ccc; }
</style>
