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

<style scoped>
.widget-editor { margin-bottom: 32rpx; }
.label { font-size: 28rpx; color: #333; margin-bottom: 12rpx; display: block; }
.required { color: #ff4444; margin-left: 4rpx; }
/* 微信小程序 <input> 原生组件对 CSS padding 的渲染有自己的 hack，直接
   在 input 上加 padding + 设宽度会让 placeholder 显示区被截断（"请输入标题"
   变 "请㈩入标题"）。终极解法：把 padding 放在外层容器，input 本身不带
   padding、自适应宽度。再用 placeholder-class 保证占位样式稳定。*/
.input-wrap {
  background: #f8f8f8;
  border-radius: 12rpx;
  padding: 20rpx 24rpx;
}
.input {
  font-size: 28rpx;
  width: 100%;
  min-height: 40rpx;
  background: transparent;
}
.textarea-wrap {
  background: #f8f8f8;
  border-radius: 12rpx;
  padding: 20rpx 24rpx;
}
.input-placeholder {
  color: #bbb;
  font-size: 28rpx;
}
.picker-display { background: #f8f8f8; border-radius: 12rpx; padding: 20rpx 24rpx; font-size: 28rpx; color: #666; }
.image-uploader { display: flex; flex-wrap: wrap; gap: 16rpx; }
.thumb-wrap { position: relative; width: 160rpx; height: 160rpx; }
.thumb { width: 160rpx; height: 160rpx; border-radius: 12rpx; }
.thumb-del { position: absolute; top: -10rpx; right: -10rpx; width: 36rpx; height: 36rpx; background: rgba(0,0,0,0.5); color: #fff; border-radius: 50%; font-size: 28rpx; line-height: 36rpx; text-align: center; }
.add-btn { width: 160rpx; height: 160rpx; background: #f8f8f8; border-radius: 12rpx; display: flex; align-items: center; justify-content: center; }
.add-icon { font-size: 60rpx; color: #ccc; }
.location-picker { background: #f8f8f8; border-radius: 12rpx; padding: 20rpx 24rpx; }
.location-value { margin-bottom: 16rpx; }
.address { display: block; font-size: 28rpx; color: #333; }
.coord { display: block; font-size: 24rpx; color: #999; margin-top: 6rpx; }
.location-actions { display: flex; gap: 16rpx; }
.loc-btn { margin: 0; background: #333; color: #fff; font-size: 24rpx; line-height: 1.8; }
.loc-btn.clear { background: #999; }
.textarea { font-size: 28rpx; width: 100%; min-height: 200rpx; background: transparent; }
</style>
