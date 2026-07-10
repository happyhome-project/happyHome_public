<template>
  <view class="page">
    <LoginGuard
      v-if="!userStore.isLoggedIn"
      title="请先登录"
      desc="登录后才能创建社区"
    />
    <view v-else class="form-content">
      <view class="form-section name-section">
        <text class="label">社区名称 <text class="required">*</text></text>
        <view class="input-wrap">
          <input v-model="form.name" placeholder="如：阳光小区、星河村" placeholder-class="input-placeholder" class="input" maxlength="20" />
        </view>
      </view>

      <view class="form-section description-section">
        <text class="label">社区简介 <text class="required">*</text></text>
        <view class="textarea-wrap">
          <textarea v-model="form.description" placeholder="介绍一下你的社区..." placeholder-class="input-placeholder" class="textarea" maxlength="200" />
        </view>
      </view>

      <view class="form-section join-section">
        <text class="label">加入方式</text>
        <view class="radio-group" role="radiogroup" aria-label="加入方式">
          <view
            class="radio-item"
            role="radio"
            :aria-checked="form.joinType === 'open'"
            tabindex="0"
            @tap="form.joinType = 'open'"
            @keydown.enter="form.joinType = 'open'"
          >
            <view class="radio" :class="{ checked: form.joinType === 'open' }" />
            <text>直接加入</text>
          </view>
          <view
            class="radio-item"
            role="radio"
            :aria-checked="form.joinType === 'approval'"
            tabindex="0"
            @tap="form.joinType = 'approval'"
            @keydown.enter="form.joinType = 'approval'"
          >
            <view class="radio" :class="{ checked: form.joinType === 'approval' }" />
            <text>需要审批</text>
          </view>
        </view>
      </view>
    </view>

    <view v-if="userStore.isLoggedIn" class="bottom-action">
      <button class="submit-btn" :disabled="submitting" @tap="handleSubmit">
        {{ submitting ? '创建中...' : '创建社区' }}
      </button>
      <text class="tip">创建后需等待平台审核通过，才能对外展示</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { communityApi } from '../../api/cloud'
import { useCommunityStore } from '../../store/community'
import { useUserStore } from '../../store/user'
import LoginGuard from '../../components/LoginGuard.vue'
import { ensureHierarchyStack, navigateBackOrHome } from '../../utils/hierarchy-nav'

const userStore = useUserStore()

const communityStore = useCommunityStore()
const submitting = ref(false)
const form = reactive({
  name: '',
  description: '',
  joinType: 'open' as 'open' | 'approval',
})

onLoad((options: any) => {
  if (ensureHierarchyStack('/pages/createCommunity/index', options || {}, '/pages/onboarding/index?mode=discover')) return
})

async function handleSubmit() {
  if (submitting.value) return
  if (!form.name.trim()) {
    uni.showToast({ title: '请填写社区名称', icon: 'none' })
    return
  }
  if (!form.description.trim()) {
    uni.showToast({ title: '请填写社区简介', icon: 'none' })
    return
  }
  submitting.value = true
  try {
    await communityApi.create({
      name: form.name.trim(),
      description: form.description.trim(),
      coverImage: '',
      location: null,
      joinType: form.joinType,
    })
    uni.showModal({
      title: '提交成功',
      content: '社区已创建，等待平台审核通过后即可对外展示',
      showCancel: false,
      success: () => navigateBackOrHome(),
    })
  } catch (e: any) {
    uni.showToast({ title: e?.message || '创建失败', icon: 'none' })
  } finally {
    submitting.value = false
  }
}
</script>

<style lang="scss" scoped>
.page {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 32rpx 32rpx calc(288rpx + env(safe-area-inset-bottom));
  background: #f2f3f7;
}

.form-content {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

.form-section {
  box-sizing: border-box;
  padding: 32rpx;
  background: #fff;
  border-radius: 24rpx;
}

.label {
  display: block;
  margin-bottom: 24rpx;
  color: #181818;
  font-size: 36rpx;
  font-weight: $hh-font-weight-bold;
  line-height: 52rpx;
}

.required {
  color: #d53d3c;
  font-weight: $hh-font-weight-medium;
}

.input-wrap {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  height: 80rpx;
  padding: 0 24rpx;
  background: #fff;
  border: 2rpx solid #f1f1f1;
  border-radius: 12rpx;
}

.input {
  width: 100%;
  min-height: 44rpx;
  background: transparent;
  color: #181818;
  font-size: 28rpx;
  line-height: 44rpx;
}

.textarea-wrap {
  min-height: 400rpx;
}

.textarea {
  box-sizing: border-box;
  width: 100%;
  height: 400rpx;
  padding: 0;
  background: transparent;
  color: #181818;
  font-size: 32rpx;
  line-height: 48rpx;
}

.input-placeholder {
  color: #a6a6a6;
  font-size: 28rpx;
}

.join-section {
  display: flex;
  align-items: center;
  gap: 24rpx;
}

.join-section .label {
  flex: 0 0 auto;
  margin-bottom: 0;
  white-space: nowrap;
}

.radio-group {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 48rpx;
}

.radio-item {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 20rpx;
  color: #181818;
  font-size: 32rpx;
  line-height: 48rpx;
  white-space: nowrap;
}

.radio-item text {
  white-space: nowrap;
}

.radio {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 48rpx;
  height: 48rpx;
  border: 2rpx solid #c6c6c6;
  border-radius: 50%;
}

.radio.checked {
  border-color: #3dad7d;
  background: #3dad7d;
}

.radio.checked::after {
  width: 18rpx;
  height: 10rpx;
  border-bottom: 4rpx solid #fff;
  border-left: 4rpx solid #fff;
  content: '';
  transform: translateY(-2rpx) rotate(-45deg);
}

.bottom-action {
  position: fixed;
  z-index: 10;
  right: 0;
  bottom: 0;
  left: 0;
  box-sizing: border-box;
  padding: 32rpx 32rpx calc(64rpx + env(safe-area-inset-bottom));
  background: #fff;
}

.submit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 96rpx;
  padding: 0;
  background: #3dad7d;
  border: 0;
  border-radius: 999rpx;
  color: #fff;
  font-size: 36rpx;
  font-weight: $hh-font-weight-bold;
  line-height: 52rpx;
}

.submit-btn::after {
  border: 0;
}

.submit-btn[disabled] {
  opacity: $hh-opacity-disabled;
}

.tip {
  display: block;
  margin-top: 24rpx;
  color: rgba(0, 0, 0, 0.45);
  font-size: 28rpx;
  line-height: 44rpx;
  text-align: center;
}
</style>
