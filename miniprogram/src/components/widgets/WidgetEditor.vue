<template>
  <view class="widget-editor">
    <text class="label">
      {{ displayLabel }}
      <text v-if="widget.required" class="required">*</text>
    </text>

    <view
      v-if="['short_text', 'summary'].includes(widget.type)"
      class="input-wrap"
    >
      <input
        :value="modelValue as string"
        :placeholder="`请输入${displayLabel}`"
        placeholder-class="input-placeholder"
        class="input"
        @input="emit('update:modelValue', ($event as any).detail.value)"
      />
    </view>

    <view v-else-if="widget.type === 'datetime'" class="datetime-picker">
      <!-- 一次 popup 同时选 年/月/日/时/分；不能选过去、只能在当前年内（年列固定 1 项）-->
      <uni-datetime-picker
        type="datetime"
        :value="datetimePickerValue"
        :start="datetimeRangeStart"
        :end="datetimeRangeEnd"
        :placeholder="`选择${displayLabel}`"
        return-type="string"
        @change="onDatetimeChange"
      />
    </view>

    <view v-else-if="widget.type === 'number'" class="input-wrap">
      <input
        type="number"
        :value="String(modelValue ?? '')"
        :placeholder="`请输入${displayLabel}`"
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
        :placeholder="`请输入${displayLabel}`"
        placeholder-class="input-placeholder"
        class="textarea"
        @input="emit('update:modelValue', ($event as any).detail.value)"
      />
    </view>

    <view v-else-if="widget.type === 'video_group'" class="video-readonly">
      <text class="readonly-hint">该控件由管理员维护，无需在此填写</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { resolveWidgetLabel } from '../../utils/widget-form'

const props = defineProps<{ widget: any; modelValue: any }>()
const emit = defineEmits(['update:modelValue'])

interface GeoLocationValue {
  address: string
  lat: number
  lng: number
}

const displayLabel = computed(() => resolveWidgetLabel(props.widget))

// datetime 控件：用 uni-datetime-picker 统一一次点开 5 列（年/月/日/时/分）
// 存储格式保持 ISO-like "YYYY-MM-DDTHH:mm:00"（后端 validateRequiredWidgets 兼容）
// 选择器内部用 "YYYY-MM-DD HH:mm:ss" 空格分隔，进出要转换。
function pad2(n: number) { return String(n).padStart(2, '0') }

// 存储值 → 选择器显示值（T → 空格）
const datetimePickerValue = computed(() => {
  const v = props.modelValue
  if (!v || typeof v !== 'string') return ''
  return v.replace('T', ' ').slice(0, 19)
})

// 范围：从"现在"起到今年底，年列只剩 1 个选项即视觉上锁定为今年
const datetimeRangeStart = computed(() => {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`
})
const datetimeRangeEnd = computed(() => `${new Date().getFullYear()}-12-31 23:59:59`)

function onDatetimeChange(value: any) {
  // uni-datetime-picker 在 return-type="string" 时 @change 直接传 "YYYY-MM-DD HH:mm:ss"
  const v = typeof value === 'string' ? value : String(value?.detail?.value || value?.value || '')
  if (!v) {
    emit('update:modelValue', '')
    return
  }
  // 空格 → T，截到分钟精度 + ":00" 秒
  const normalized = v.trim().replace(' ', 'T').slice(0, 16) + ':00'
  emit('update:modelValue', normalized)
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
.datetime-picker {
  /* uni-datetime-picker 自带外观，容器用全宽块级即可 */
  display: block;
}
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
.video-readonly { background: $hh-color-bg-sub; border-radius: $hh-radius-sm; padding: $hh-space-md; }
.readonly-hint { font-size: $hh-font-caption; color: $hh-color-text-mute; }
</style>
