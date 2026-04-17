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

<style lang="scss" scoped>
.page { padding: $hh-space-lg; min-height: 100vh; background: $hh-color-bg-sub; }
.form { background: $hh-color-surface; border-radius: $hh-radius-md; padding: $hh-space-lg; margin-bottom: $hh-space-lg; }
.field { margin-bottom: $hh-space-xl; }
.field:last-child { margin-bottom: 0; }
.label { font-size: $hh-font-body; color: $hh-color-text; display: block; margin-bottom: $hh-space-sm; font-weight: $hh-font-weight-medium; }
.required { color: $hh-color-danger; }
/* padding 放在外层 view，input/textarea 本身不带 padding，避免微信原生组件 placeholder 截断 */
.input-wrap { background: $hh-color-bg-sub; border-radius: $hh-radius-sm; padding: $hh-space-md; }
.input { font-size: $hh-font-body; width: 100%; min-height: 40rpx; background: transparent; color: $hh-color-text; }
.textarea { font-size: $hh-font-body; width: 100%; min-height: 160rpx; background: transparent; color: $hh-color-text; }
.input-placeholder { color: $hh-color-text-mute; font-size: $hh-font-body; }
.radio-group { display: flex; gap: $hh-space-xl; }
.radio-item { display: flex; align-items: center; gap: $hh-space-sm; font-size: $hh-font-body; color: $hh-color-text; }
.radio { width: 36rpx; height: 36rpx; border-radius: 50%; border: 2rpx solid $hh-color-border; }
.radio.checked { border-color: $hh-color-primary; background: $hh-color-primary; box-shadow: inset 0 0 0 6rpx $hh-color-surface; }
.submit-btn { background: $hh-color-primary; color: $hh-color-text-inverse; border-radius: $hh-radius-md; font-size: $hh-font-h3; padding: $hh-space-md; width: 100%; border: none; }
.submit-btn[disabled] { opacity: $hh-opacity-disabled; }
.tip { display: block; text-align: center; font-size: $hh-font-caption; color: $hh-color-text-mute; margin-top: $hh-space-md; }
</style>
