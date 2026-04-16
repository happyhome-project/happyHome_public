<template>
  <view class="page">
    <view class="form">
      <view class="field">
        <text class="label">社区名称 <text class="required">*</text></text>
        <view class="input-wrap">
          <input v-model="form.name" placeholder="如：阳光小区、星河村" placeholder-class="input-placeholder" class="input" maxlength="20" />
        </view>
      </view>

      <view class="field">
        <text class="label">社区简介 <text class="required">*</text></text>
        <view class="input-wrap">
          <textarea v-model="form.description" placeholder="介绍一下你的社区..." placeholder-class="input-placeholder" class="textarea" maxlength="200" />
        </view>
      </view>

      <view class="field">
        <text class="label">加入方式</text>
        <view class="radio-group">
          <view class="radio-item" @tap="form.joinType = 'open'">
            <view class="radio" :class="{ checked: form.joinType === 'open' }" />
            <text>直接加入</text>
          </view>
          <view class="radio-item" @tap="form.joinType = 'approval'">
            <view class="radio" :class="{ checked: form.joinType === 'approval' }" />
            <text>需要审批</text>
          </view>
        </view>
      </view>
    </view>

    <button class="submit-btn" :disabled="submitting" @tap="handleSubmit">
      {{ submitting ? '创建中...' : '创建社区' }}
    </button>

    <text class="tip">创建后需等待平台审核通过，才能对外展示</text>
  </view>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { communityApi } from '../../api/cloud'
import { useCommunityStore } from '../../store/community'

const communityStore = useCommunityStore()
const submitting = ref(false)
const form = reactive({
  name: '',
  description: '',
  joinType: 'open' as 'open' | 'approval',
})

async function handleSubmit() {
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
      success: () => uni.navigateBack(),
    })
  } catch (e: any) {
    uni.showToast({ title: e?.message || '创建失败', icon: 'none' })
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.page { padding: 32rpx; min-height: 100vh; background: #f5f5f5; }
.form { background: #fff; border-radius: 16rpx; padding: 32rpx; margin-bottom: 32rpx; }
.field { margin-bottom: 40rpx; }
.field:last-child { margin-bottom: 0; }
.label { font-size: 28rpx; color: #333; display: block; margin-bottom: 16rpx; font-weight: 500; }
.required { color: #ff4444; }
/* padding 放在外层 view，input/textarea 本身不带 padding，避免微信原生组件 placeholder 截断 */
.input-wrap { background: #f8f8f8; border-radius: 12rpx; padding: 20rpx 24rpx; }
.input { font-size: 28rpx; width: 100%; min-height: 40rpx; background: transparent; }
.textarea { font-size: 28rpx; width: 100%; min-height: 160rpx; background: transparent; }
.input-placeholder { color: #bbb; font-size: 28rpx; }
.radio-group { display: flex; gap: 40rpx; }
.radio-item { display: flex; align-items: center; gap: 12rpx; font-size: 28rpx; color: #333; }
.radio { width: 36rpx; height: 36rpx; border-radius: 50%; border: 2rpx solid #ccc; }
.radio.checked { border-color: #333; background: #333; box-shadow: inset 0 0 0 6rpx #fff; }
.submit-btn { background: #333; color: #fff; border-radius: 12rpx; font-size: 32rpx; padding: 24rpx; width: 100%; }
.submit-btn[disabled] { opacity: 0.5; }
.tip { display: block; text-align: center; font-size: 24rpx; color: #aaa; margin-top: 24rpx; }
</style>
