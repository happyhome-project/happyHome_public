<template>
  <view class="topic-picker">
    <view class="topic-trigger" data-testid="topic-picker-trigger" @tap="openPicker">
      <view v-if="topics.length > 0" class="topic-trigger-chips">
        <text v-for="topic in topics.slice(0, 1)" :key="topic" class="topic-trigger-chip">#{{ topic }}</text>
        <text v-if="topics.length > 1" class="topic-trigger-more">+{{ topics.length - 1 }}</text>
      </view>
      <view class="topic-trigger-action">
        <text class="topic-hash">#</text>
        <text>话题</text>
      </view>
    </view>

    <view
      v-if="pickerOpen"
      class="topic-picker-overlay"
      data-testid="topic-picker-overlay"
      @touchmove.stop.prevent
    >
      <view class="topic-picker-mask" @tap="closePicker" />
      <view class="topic-sheet" data-testid="topic-picker-sheet" @tap.stop>
        <view class="topic-sheet-head">
          <text class="topic-sheet-title">添加话题</text>
          <text class="topic-sheet-done" @tap="closePicker">完成</text>
        </view>

        <view v-if="topics.length > 0" class="topic-sheet-chips">
          <view
            v-for="(topic, index) in topics"
            :key="topic"
            class="topic-sheet-chip"
            @tap="remove(index)"
          >
            <text>#{{ topic }}</text>
            <text class="topic-remove">×</text>
          </view>
        </view>

        <view class="topic-input-row">
          <text class="topic-input-hash">#</text>
          <input
            class="topic-input"
            data-testid="topic-picker-input"
            :value="draft"
            placeholder="输入话题，最多20个字"
            placeholder-class="topic-input-placeholder"
            confirm-type="done"
            maxlength="-1"
            @input="draft = String(($event as any).detail.value || '')"
            @confirm="add"
          />
          <button class="topic-add" size="mini" :disabled="topics.length >= MAX_TOPIC_COUNT" @tap="add">添加</button>
        </view>
        <text class="topic-count">{{ topics.length }}/{{ MAX_TOPIC_COUNT }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { appendTopic, MAX_TOPIC_COUNT, normalizeTopics, removeTopic } from '../../utils/topics'

const props = defineProps<{
  modelValue: string[] | undefined | null
}>()
const emit = defineEmits<{
  (event: 'update:modelValue', value: string[]): void
}>()

const pickerOpen = ref(false)
const draft = ref('')
const topics = computed(() => {
  try {
    return normalizeTopics(Array.isArray(props.modelValue) ? props.modelValue : [])
  } catch {
    return []
  }
})

function openPicker() {
  pickerOpen.value = true
}

function closePicker() {
  pickerOpen.value = false
}

function add() {
  try {
    const candidate = normalizeTopics([draft.value])
    if (candidate.length === 0) {
      uni.showToast({ title: '请输入话题', icon: 'none' })
      return
    }
    const next = appendTopic(topics.value, candidate[0])
    if (next.length === topics.value.length) {
      uni.showToast({ title: '话题已添加', icon: 'none' })
      draft.value = ''
      return
    }
    emit('update:modelValue', next)
    draft.value = ''
  } catch (error: any) {
    uni.showToast({ title: String(error?.message || '话题格式不正确'), icon: 'none' })
  }
}

function remove(index: number) {
  emit('update:modelValue', removeTopic(topics.value, index))
}
</script>

<style lang="scss" scoped>
.topic-picker {
  min-width: 0;
  width: 100%;
}

.topic-picker-overlay {
  position: fixed;
  z-index: 1200;
  inset: 0;
  display: flex;
  align-items: flex-end;
}

.topic-picker-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
}

.topic-trigger {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12rpx;
  overflow: hidden;
}

.topic-trigger-chips {
  min-width: 0;
  flex: 1;
  display: flex;
  gap: 12rpx;
  overflow: hidden;
}

.topic-trigger-chip {
  flex: 0 0 auto;
  max-width: 220rpx;
  overflow: hidden;
  color: #ff2442;
  font-size: 28rpx;
  line-height: 44rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.topic-trigger-more {
  flex: 0 0 auto;
  color: #999;
  font-size: 24rpx;
  line-height: 44rpx;
  white-space: nowrap;
}

.topic-trigger-action {
  flex: 0 0 auto;
  min-height: 64rpx;
  padding: 0 24rpx;
  display: flex;
  align-items: center;
  gap: 8rpx;
  border: 1rpx solid #e8e8e8;
  border-radius: 999rpx;
  color: #333;
  font-size: 28rpx;
  line-height: 44rpx;
  background: #fff;
  box-sizing: border-box;
}

.topic-hash,
.topic-input-hash {
  color: #ff2442;
  font-weight: 600;
}

.topic-sheet {
  position: relative;
  z-index: 1;
  width: 100%;
  padding: 32rpx 32rpx calc(36rpx + env(safe-area-inset-bottom));
  border-radius: 32rpx 32rpx 0 0;
  background: #fff;
  box-sizing: border-box;
}

.topic-sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.topic-sheet-title {
  color: #181818;
  font-size: 36rpx;
  font-weight: 600;
  line-height: 52rpx;
}

.topic-sheet-done {
  color: #ff2442;
  font-size: 30rpx;
  line-height: 48rpx;
}

.topic-sheet-chips {
  margin-top: 24rpx;
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}

.topic-sheet-chip {
  padding: 10rpx 18rpx;
  display: flex;
  align-items: center;
  gap: 10rpx;
  border-radius: 999rpx;
  color: #ff2442;
  font-size: 28rpx;
  line-height: 40rpx;
  background: #fff1f3;
}

.topic-remove {
  color: #999;
  font-size: 30rpx;
}

.topic-input-row {
  min-height: 88rpx;
  margin-top: 28rpx;
  padding: 0 20rpx;
  display: flex;
  align-items: center;
  gap: 12rpx;
  border-radius: 16rpx;
  background: #f6f7f9;
  box-sizing: border-box;
}

.topic-input {
  min-width: 0;
  flex: 1;
  color: #181818;
  font-size: 30rpx;
}

.topic-input-placeholder {
  color: #a6a6a6;
}

.topic-add {
  margin: 0;
  padding: 0 20rpx;
  border: 0;
  border-radius: 999rpx;
  color: #fff;
  background: #ff2442;
  font-size: 26rpx;
  line-height: 56rpx;
}

.topic-add::after {
  border: 0;
}

.topic-add[disabled] {
  color: #fff;
  background: #d8d8d8;
}

.topic-count {
  display: block;
  margin-top: 12rpx;
  color: #999;
  font-size: 24rpx;
  line-height: 34rpx;
  text-align: right;
}
</style>
