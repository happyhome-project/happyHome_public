<template>
  <view class="widget-editor">
    <text class="label">
      {{ widget.label }}
      <text v-if="widget.required" class="required">*</text>
    </text>

    <input
      v-if="['short_text', 'summary'].includes(widget.type)"
      :value="modelValue as string"
      :placeholder="`请输入${widget.label}`"
      class="input"
      @input="emit('update:modelValue', ($event as any).detail.value)"
    />

    <picker
      v-else-if="widget.type === 'datetime'"
      mode="date"
      :value="modelValue as string"
      @change="emit('update:modelValue', ($event as any).detail.value)"
    >
      <view class="picker-display">
        {{ modelValue || `选择${widget.label}` }}
      </view>
    </picker>

    <input
      v-else-if="widget.type === 'number'"
      type="number"
      :value="String(modelValue ?? '')"
      :placeholder="`请输入${widget.label}`"
      class="input"
      @input="emit('update:modelValue', Number(($event as any).detail.value))"
    />

    <view v-else-if="widget.type === 'image_group'" class="image-uploader">
      <image
        v-for="(img, i) in ((modelValue as string[]) ?? [])"
        :key="i"
        :src="img"
        mode="aspectFill"
        class="thumb"
      />
      <view class="add-btn" @tap="addImage">
        <text class="add-icon">+</text>
      </view>
    </view>

    <textarea
      v-else-if="widget.type === 'rich_text'"
      :value="modelValue as string"
      :placeholder="`请输入${widget.label}`"
      class="textarea"
      @input="emit('update:modelValue', ($event as any).detail.value)"
    />
  </view>
</template>

<script setup lang="ts">
const props = defineProps<{ widget: any; modelValue: any }>()
const emit = defineEmits(['update:modelValue'])

function addImage() {
  wx.chooseMedia({
    count: 9,
    mediaType: ['image'],
    success: (res: any) => {
      const current = (props.modelValue as string[]) ?? []
      emit('update:modelValue', [...current, ...res.tempFiles.map((f: any) => f.tempFilePath)])
    },
  })
}
</script>

<style scoped>
.widget-editor { margin-bottom: 32rpx; }
.label { font-size: 28rpx; color: #333; margin-bottom: 12rpx; display: block; }
.required { color: #ff4444; margin-left: 4rpx; }
.input { background: #f8f8f8; border-radius: 12rpx; padding: 20rpx 24rpx; font-size: 28rpx; width: 100%; box-sizing: border-box; }
.picker-display { background: #f8f8f8; border-radius: 12rpx; padding: 20rpx 24rpx; font-size: 28rpx; color: #666; }
.image-uploader { display: flex; flex-wrap: wrap; gap: 16rpx; }
.thumb { width: 160rpx; height: 160rpx; border-radius: 12rpx; }
.add-btn { width: 160rpx; height: 160rpx; background: #f8f8f8; border-radius: 12rpx; display: flex; align-items: center; justify-content: center; }
.add-icon { font-size: 60rpx; color: #ccc; }
.textarea { background: #f8f8f8; border-radius: 12rpx; padding: 20rpx 24rpx; font-size: 28rpx; width: 100%; min-height: 200rpx; box-sizing: border-box; }
</style>
