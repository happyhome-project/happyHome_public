<template>
  <view class="widget-editor">
    <text class="label">
      {{ widget.label }}
      <text v-if="widget.required" class="required">*</text>
    </text>

    <view
      v-if="['short_text', 'summary'].includes(widget.type)"
      class="input-wrap"
    >
      <input
        :value="modelValue as string"
        :placeholder="`请输入${widget.label}`"
        placeholder-class="input-placeholder"
        class="input"
        @input="emit('update:modelValue', ($event as any).detail.value)"
      />
    </view>

    <picker
      v-else-if="widget.type === 'datetime'"
      mode="dateTime"
      :value="modelValue as string"
      @change="emit('update:modelValue', ($event as any).detail.value)"
    >
      <view class="picker-display">
        {{ modelValue || `选择${widget.label}` }}
      </view>
    </picker>

    <view v-else-if="widget.type === 'number'" class="input-wrap">
      <input
        type="number"
        :value="String(modelValue ?? '')"
        :placeholder="`请输入${widget.label}`"
        placeholder-class="input-placeholder"
        class="input"
        @input="emit('update:modelValue', Number(($event as any).detail.value))"
      />
    </view>

    <view v-else-if="widget.type === 'image_group'" class="image-uploader">
      <view
        v-for="(img, i) in ((modelValue as string[]) ?? [])"
        :key="i"
        class="thumb-wrap"
      >
        <image :src="img" mode="aspectFill" class="thumb" />
        <view class="thumb-del" @tap="removeImage(i)">×</view>
      </view>
      <view class="add-btn" @tap="addImage">
        <text class="add-icon">+</text>
      </view>
    </view>

    <view v-else-if="widget.type === 'location'" class="location-picker">
      <view v-if="locationValue" class="location-value">
        <text class="address">{{ locationValue.address || '已选择位置' }}</text>
        <text class="coord">{{ locationValue.lat }}, {{ locationValue.lng }}</text>
      </view>
      <view class="location-actions">
        <button class="loc-btn" size="mini" @tap="chooseLocation">选择位置</button>
        <button
          v-if="locationValue"
          class="loc-btn clear"
          size="mini"
          @tap="clearLocation"
        >
          清除
        </button>
      </view>
    </view>

    <view v-else-if="widget.type === 'rich_text'" class="textarea-wrap">
      <textarea
        :value="modelValue as string"
        :placeholder="`请输入${widget.label}`"
        placeholder-class="input-placeholder"
        class="textarea"
        @input="emit('update:modelValue', ($event as any).detail.value)"
      />
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ widget: any; modelValue: any }>()
const emit = defineEmits(['update:modelValue'])

interface GeoLocationValue {
  address: string
  lat: number
  lng: number
}

const locationValue = computed<GeoLocationValue | null>(() => {
  const val = props.modelValue
  if (!val || typeof val !== 'object') return null
  if (typeof val.lat !== 'number' || typeof val.lng !== 'number') return null
  return {
    address: String(val.address || ''),
    lat: Number(val.lat),
    lng: Number(val.lng),
  }
})

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

function removeImage(index: number) {
  const current = [...((props.modelValue as string[]) ?? [])]
  current.splice(index, 1)
  emit('update:modelValue', current)
}

function chooseLocation() {
  wx.chooseLocation({
    success: (res: any) => {
      emit('update:modelValue', {
        address: res.address || res.name || '',
        lat: Number(res.latitude),
        lng: Number(res.longitude),
      })
    },
    fail: (err: any) => {
      const msg = String(err?.errMsg || '')
      if (msg.includes('cancel')) return
      uni.showToast({ title: '选择位置失败', icon: 'none' })
    },
  })
}

function clearLocation() {
  emit('update:modelValue', null)
}
</script>

<style lang="scss" scoped>
.widget-editor { margin-bottom: $hh-space-lg; }
.label { font-size: $hh-font-body; color: $hh-color-text; margin-bottom: $hh-space-sm; display: block; }
.required { color: $hh-color-danger; margin-left: 4rpx; }
/* 微信小程序 <input> 原生组件对 CSS padding 的渲染有自己的 hack，直接
   在 input 上加 padding + 设宽度会让 placeholder 显示区被截断。
   终极解法：把 padding 放在外层容器，input 本身不带 padding、自适应宽度。*/
.input-wrap {
  background: $hh-color-bg-sub;
  border-radius: $hh-radius-sm;
  padding: $hh-space-md;
}
.input {
  font-size: $hh-font-body;
  width: 100%;
  min-height: 40rpx;
  background: transparent;
  color: $hh-color-text;
}
.textarea-wrap {
  background: $hh-color-bg-sub;
  border-radius: $hh-radius-sm;
  padding: $hh-space-md;
}
.input-placeholder {
  color: $hh-color-text-mute;
  font-size: $hh-font-body;
}
.picker-display { background: $hh-color-bg-sub; border-radius: $hh-radius-sm; padding: $hh-space-md; font-size: $hh-font-body; color: $hh-color-text-sub; }
.image-uploader { display: flex; flex-wrap: wrap; gap: $hh-space-sm; }
.thumb-wrap { position: relative; width: 160rpx; height: 160rpx; }
.thumb { width: 160rpx; height: 160rpx; border-radius: $hh-radius-sm; }
.thumb-del { position: absolute; top: -10rpx; right: -10rpx; width: 36rpx; height: 36rpx; background: $hh-color-mask; color: $hh-color-text-inverse; border-radius: $hh-radius-full; font-size: $hh-font-body; line-height: 36rpx; text-align: center; }
.add-btn { width: 160rpx; height: 160rpx; background: $hh-color-bg-sub; border-radius: $hh-radius-sm; display: flex; align-items: center; justify-content: center; }
.add-icon { font-size: 60rpx; color: $hh-color-text-mute; }
.location-picker { background: $hh-color-bg-sub; border-radius: $hh-radius-sm; padding: $hh-space-md; }
.location-value { margin-bottom: $hh-space-sm; }
.address { display: block; font-size: $hh-font-body; color: $hh-color-text; }
.coord { display: block; font-size: $hh-font-caption; color: $hh-color-text-mute; margin-top: $hh-space-xs; }
.location-actions { display: flex; gap: $hh-space-sm; }
.loc-btn { margin: 0; background: $hh-color-primary; color: $hh-color-text-inverse; font-size: $hh-font-caption; line-height: 1.8; border: none; }
.loc-btn.clear { background: $hh-color-text-mute; }
.textarea { font-size: $hh-font-body; width: 100%; min-height: 200rpx; background: transparent; color: $hh-color-text; }
</style>
