<template>
  <view class="widget-editor" :class="editorClasses">
    <text v-if="showOuterLabel" class="label">
      {{ displayLabel }}
      <text v-if="widget.required" class="required">*</text>
    </text>

    <view
      v-if="useMultilineTextInput"
      class="textarea-wrap text-field-wrap"
    >
      <textarea
        :value="modelValue as string"
        :placeholder="inputPlaceholder"
        placeholder-class="input-placeholder"
        class="textarea text-field-textarea"
        auto-height
        maxlength="-1"
        @input="emit('update:modelValue', ($event as any).detail.value)"
      />
    </view>

    <view
      v-else-if="['short_text', 'summary'].includes(widget.type)"
      class="input-wrap"
    >
      <input
        :value="modelValue as string"
        :placeholder="inputPlaceholder"
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
        placeholder="选择日期时间"
        :border="false"
        hide-second
        return-type="string"
        @change="onDatetimeChange"
      >
        <view class="datetime-field">
          <image
            class="datetime-field-icon"
            src="/static/publish-icons/calendar.svg"
            mode="aspectFit"
          />
          <text
            class="datetime-field-value"
            :class="{ 'datetime-field-value--placeholder': !datetimeDisplayValue }"
          >
            {{ datetimeDisplayValue || '选择日期时间' }}
          </text>
        </view>
      </uni-datetime-picker>
    </view>

    <view v-else-if="widget.type === 'number'" class="input-wrap">
      <input
        type="number"
        :value="numberInputValue"
        :placeholder="inputPlaceholder"
        placeholder-class="input-placeholder"
        class="input"
        @input="emit('update:modelValue', Number(($event as any).detail.value))"
      />
    </view>

    <view v-else-if="widget.type === 'image_group'" class="image-uploader">
      <view
        v-for="(img, i) in imageModelValue"
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

    <view
      v-else-if="widget.type === 'location'"
      class="location-picker"
      :class="{ 'location-picker--selected': isSelectedFigmaLocation }"
      @tap="chooseLocation"
    >
      <template v-if="isSelectedFigmaLocation && locationValue">
        <view class="location-selected-head">
          <view class="location-selected-title">
            <text>{{ displayLabel }}</text>
            <text v-if="widget.required" class="required">*</text>
          </view>
          <view class="location-selected-actions">
            <text class="location-clear-text" @tap.stop="clearLocation">清除</text>
            <text class="location-pin-mini">⌖</text>
          </view>
        </view>
        <view class="location-selected-card">
          <view class="location-map-ghost"></view>
          <view class="location-selected-content">
            <text class="address">{{ locationValue.name || locationValue.address || '已选择位置' }}</text>
            <text
              v-if="locationValue.address && locationValue.name && locationValue.address !== locationValue.name"
              class="location-region"
            >
              {{ locationValue.address }}
            </text>
          </view>
          <text class="location-card-pin">●</text>
        </view>
      </template>
      <template v-else>
        <view v-if="locationValue" class="location-value">
          <text class="address">{{ locationValue.name || locationValue.address || '已选择位置' }}</text>
          <text v-if="variant !== 'figma'" class="coord">{{ locationValue.lat }}, {{ locationValue.lng }}</text>
        </view>
        <view class="location-actions">
          <button class="loc-btn" size="mini" @tap.stop="chooseLocation">{{ locationValue ? '重新选择' : '去选择' }}</button>
          <text v-if="variant === 'figma'" class="location-pin-mini">⌖</text>
          <button
            v-if="locationValue"
            class="loc-btn clear"
            size="mini"
            @tap.stop="clearLocation"
          >
            清除
          </button>
        </view>
      </template>
    </view>

    <view v-else-if="widget.type === 'rich_text'" class="textarea-wrap">
      <textarea
        :value="modelValue as string"
        :placeholder="inputPlaceholder"
        placeholder-class="input-placeholder"
        class="textarea"
        @input="emit('update:modelValue', ($event as any).detail.value)"
      />
    </view>

    <NoteBlocksEditor
      v-else-if="widget.type === 'note_blocks'"
      :model-value="modelValue"
      :minimal="variant === 'figma'"
      :placeholder="inputPlaceholder"
      :allow-images="allowRichNoteImages"
      @update:model-value="emit('update:modelValue', $event)"
    />

    <RichNoteEditor
      v-else-if="widget.type === 'rich_note'"
      :model-value="modelValue"
      :allow-images="allowRichNoteImages"
      :minimal="variant === 'figma' && guideRole === 'body'"
      :placeholder="inputPlaceholder"
      @update:model-value="emit('update:modelValue', $event)"
    />

    <view v-else-if="widget.type === 'video_group' || widget.type === 'audio_group'" class="video-readonly">
      <text class="readonly-hint">该控件由管理员维护，无需在此填写</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { resolveWidgetLabel } from '../../utils/widget-form'
import NoteBlocksEditor from './NoteBlocksEditor.vue'
import RichNoteEditor from './RichNoteEditor.vue'

const props = withDefaults(defineProps<{
  widget: any
  modelValue: any
  allowRichNoteImages?: boolean
  variant?: 'default' | 'figma'
  embedded?: boolean
  hideLabel?: boolean
  placeholder?: string
  guideRole?: 'cover' | 'title' | 'body' | ''
}>(), {
  allowRichNoteImages: true,
  variant: 'default',
  embedded: false,
  hideLabel: false,
  placeholder: '',
  guideRole: '',
})
const emit = defineEmits(['update:modelValue'])

interface GeoLocationValue {
  address: string
  name?: string
  lat: number
  lng: number
}

const displayLabel = computed(() => resolveWidgetLabel(props.widget))
const variant = computed(() => props.variant)
const locationValue = computed<GeoLocationValue | null>(() => {
  const val = props.modelValue
  if (!val || typeof val !== 'object') return null
  if (typeof val.lat !== 'number' || typeof val.lng !== 'number') return null
  return {
    address: String(val.address || ''),
    name: String(val.name || ''),
    lat: Number(val.lat),
    lng: Number(val.lng),
  }
})
const isSelectedFigmaLocation = computed(() =>
  variant.value === 'figma' &&
  String(props.widget?.type || '') === 'location' &&
  !!locationValue.value
)
const widgetId = computed(() => String(props.widget?.widgetId || ''))
const normalizedFieldKey = computed(() => String(props.widget?.fieldKey || '').toLowerCase())
const normalizedLabel = computed(() => String(displayLabel.value || '').replace(/\s/g, ''))
const useMultilineTextInput = computed(() =>
  variant.value === 'figma' &&
  ['short_text', 'summary'].includes(String(props.widget?.type || '')) &&
  (
    widgetId.value === 'activity_invite_title' ||
    (normalizedFieldKey.value === 'title' && normalizedLabel.value.includes('邀约'))
  )
)
const showOuterLabel = computed(() => !props.hideLabel && !isSelectedFigmaLocation.value)
const isLineWidget = computed(() =>
  variant.value === 'figma' &&
  ['short_text', 'summary', 'number', 'datetime', 'location'].includes(String(props.widget?.type || '')) &&
  !isSelectedFigmaLocation.value &&
  !useMultilineTextInput.value
)
const editorClasses = computed(() => ({
  'widget-editor--figma': variant.value === 'figma',
  'widget-editor--embedded': props.embedded,
  'widget-editor--hide-label': props.hideLabel,
  'widget-editor--line': isLineWidget.value,
  'widget-editor--multiline-text': useMultilineTextInput.value,
  'widget-editor--block': variant.value === 'figma' && !isLineWidget.value,
  [`widget-editor--guide-${props.guideRole}`]: !!props.guideRole,
  [`widget-editor--${String(props.widget?.type || 'unknown')}`]: true,
}))
const inputPlaceholder = computed(() => {
  const custom = String(props.placeholder || '').trim()
  if (custom) return custom
  return variant.value === 'figma' ? '请输入' : `请输入${displayLabel.value}`
})
const numberInputValue = computed(() => {
  const value = props.modelValue
  return String(value === undefined || value === null ? '' : value)
})
const imageModelValue = computed<string[]>(() => (
  Array.isArray(props.modelValue) ? props.modelValue as string[] : []
))

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

const datetimeDisplayValue = computed(() => datetimePickerValue.value.slice(0, 16))

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

function addImage() {
  wx.chooseMedia({
    count: 9,
    mediaType: ['image'],
    success: (res: any) => {
      const current = Array.isArray(props.modelValue) ? props.modelValue as string[] : []
      const files = Array.isArray(res.tempFiles) ? res.tempFiles : []
      emit('update:modelValue', current.concat(files.map((f: any) => f.tempFilePath)))
    },
  })
}

function removeImage(index: number) {
  const current = Array.isArray(props.modelValue) ? (props.modelValue as string[]).slice() : []
  current.splice(index, 1)
  emit('update:modelValue', current)
}

function chooseLocation() {
  wx.chooseLocation({
    success: (res: any) => {
      emit('update:modelValue', {
        address: res.address || res.name || '',
        name: res.name || '',
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
.widget-editor {
  min-width: 0;
  max-width: 100%;
  margin-bottom: $hh-space-lg;
  box-sizing: border-box;
}
.label { font-size: var(--hh-text-body-base-size); color: var(--hh-color-text-primary); margin-bottom: $hh-space-sm; display: block; font-weight: $hh-font-weight-medium; }
.required { color: $hh-color-danger; margin-left: 4rpx; }
.input-wrap {
  min-width: 0;
  max-width: 100%;
  background: var(--hh-color-card);
  border: 1rpx solid var(--hh-color-line);
  border-radius: var(--hh-radius-card);
  padding: $hh-space-md;
  box-sizing: border-box;
}
.input {
  font-size: var(--hh-text-body-base-size);
  width: 100%;
  min-width: 0;
  max-width: 100%;
  min-height: 40rpx;
  background: transparent;
  color: var(--hh-color-text-primary);
  box-sizing: border-box;
}
.textarea-wrap {
  min-width: 0;
  max-width: 100%;
  background: var(--hh-color-card);
  border: 1rpx solid var(--hh-color-line);
  border-radius: var(--hh-radius-card);
  padding: $hh-space-md;
  box-sizing: border-box;
}
.input-placeholder {
  color: var(--hh-color-text-tertiary);
  font-size: var(--hh-text-body-base-size);
}
.datetime-picker {
  display: block;
  min-width: 0;
  max-width: 100%;
  width: 100%;
}
.datetime-field {
  width: 100%;
  min-height: 64rpx;
  padding: 0 16rpx;
  display: flex;
  align-items: center;
  gap: 8rpx;
  border: 1rpx solid #e6e8eb;
  border-radius: 8rpx;
  background: #fff;
  box-sizing: border-box;
}
.datetime-field-icon {
  width: 40rpx;
  height: 40rpx;
  flex-shrink: 0;
}
.datetime-field-value {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: #181818;
  font-size: var(--hh-text-body-base-size);
  line-height: var(--hh-text-body-base-line);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.datetime-field-value--placeholder {
  color: #a6a6a6;
}
.image-uploader { display: flex; flex-wrap: wrap; gap: $hh-space-sm; min-width: 0; max-width: 100%; }
.thumb-wrap { position: relative; width: 188rpx; height: 188rpx; }
.thumb { width: 188rpx; height: 188rpx; border-radius: var(--hh-radius-card); }
.thumb-del { position: absolute; top: -10rpx; right: -10rpx; width: 36rpx; height: 36rpx; background: $hh-color-mask; color: $hh-color-text-inverse; border-radius: $hh-radius-full; font-size: $hh-font-body; line-height: 36rpx; text-align: center; }
.add-btn { width: 188rpx; height: 188rpx; background: var(--hh-color-card); border: 1rpx dashed var(--hh-color-brand-line); border-radius: var(--hh-radius-card); display: flex; align-items: center; justify-content: center; }
.add-icon { font-size: 60rpx; color: var(--hh-color-brand-primary); }
.location-picker {
  min-width: 0;
  max-width: 100%;
  background: var(--hh-color-card);
  border: 1rpx solid var(--hh-color-line);
  border-radius: var(--hh-radius-card);
  padding: $hh-space-md;
  box-sizing: border-box;
}
.location-value { margin-bottom: $hh-space-sm; }
.address { display: block; font-size: var(--hh-text-body-base-size); color: var(--hh-color-text-primary); }
.coord { display: block; font-size: var(--hh-text-caption-lg-size); color: var(--hh-color-text-tertiary); margin-top: $hh-space-xs; }
.location-actions { display: flex; gap: $hh-space-sm; }
.loc-btn { margin: 0; background: var(--hh-color-brand-primary); color: #fff; font-size: var(--hh-text-caption-lg-size); line-height: 1.8; border: none; }
.loc-btn.clear { background: var(--hh-color-text-tertiary); }
.textarea { font-size: var(--hh-text-body-base-size); width: 100%; min-height: 240rpx; background: transparent; color: var(--hh-color-text-primary); }
.video-readonly { background: var(--hh-color-card); border: 1rpx solid var(--hh-color-line); border-radius: var(--hh-radius-card); padding: $hh-space-md; }
.readonly-hint { font-size: var(--hh-text-caption-lg-size); color: var(--hh-color-text-tertiary); }

.widget-editor--figma {
  width: 100%;
  max-width: 100%;
  margin-bottom: 0;
  padding: 32rpx;
  border-radius: 24rpx;
  background: #fff;
  box-sizing: border-box;
  overflow: hidden;
}

.widget-editor--figma .label {
  font-size: 32rpx;
  font-weight: 400;
  line-height: 48rpx;
  color: #181818;
  margin-bottom: 0;
}

.widget-editor--figma .required {
  margin-left: 8rpx;
  color: #d53d3c;
}

.widget-editor--line {
  min-height: 112rpx;
  display: flex;
  align-items: center;
  gap: 32rpx;
}

.widget-editor--line .label {
  flex-shrink: 0;
  max-width: 284rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.widget-editor--line .input-wrap,
.widget-editor--line .textarea-wrap,
.widget-editor--line .location-picker {
  flex: 1;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}

.widget-editor--line .datetime-picker {
  flex: 1;
  min-width: 0;
  max-width: 100%;
  overflow: visible;
}

.widget-editor--figma.widget-editor--datetime {
  overflow: visible;
}

.widget-editor--figma.widget-editor--multiline-text {
  display: block;
  min-height: 0;
}

.widget-editor--figma.widget-editor--multiline-text .label {
  margin-bottom: 20rpx;
}

.widget-editor--figma .input-wrap,
.widget-editor--figma .textarea-wrap,
.widget-editor--figma .location-picker,
.widget-editor--figma .video-readonly {
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.widget-editor--figma .input {
  min-height: 48rpx;
  font-size: 32rpx;
  line-height: 48rpx;
  text-align: right;
  color: #181818;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.widget-editor--figma .textarea {
  min-height: 400rpx;
  padding-top: 0;
  font-size: 32rpx;
  line-height: 48rpx;
}

.widget-editor--figma.widget-editor--multiline-text .text-field-textarea {
  min-height: 96rpx;
  max-height: 192rpx;
  color: #181818;
  font-size: 32rpx;
  line-height: 48rpx;
  text-align: left;
}

.widget-editor--figma .input-placeholder {
  color: #a6a6a6;
  font-size: 32rpx;
}

.widget-editor--figma .image-uploader {
  margin-top: 24rpx;
  gap: 16rpx;
}

.widget-editor--figma .thumb-wrap,
.widget-editor--figma .thumb,
.widget-editor--figma .add-btn {
  width: 160rpx;
  height: 160rpx;
}

.widget-editor--figma .add-btn {
  border: 0;
  background: #f7f7f7;
}

.widget-editor--figma .add-icon {
  color: #a6a6a6;
  font-size: 64rpx;
  font-weight: 300;
}

.widget-editor--figma .location-picker {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16rpx;
}

.widget-editor--figma .location-picker--selected {
  display: block;
  width: 100%;
}

.location-selected-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24rpx;
  min-height: 48rpx;
}

.location-selected-title {
  display: flex;
  align-items: flex-start;
  gap: 8rpx;
  color: #181818;
  font-size: 32rpx;
  font-weight: 400;
  line-height: 48rpx;
}

.location-selected-actions {
  display: flex;
  align-items: center;
  gap: 16rpx;
  color: var(--hh-color-brand-primary);
  font-size: 32rpx;
  line-height: 48rpx;
}

.location-clear-text {
  color: var(--hh-color-brand-primary);
}

.location-pin-mini {
  color: var(--hh-color-brand-primary);
  font-size: 32rpx;
  line-height: 1;
}

.location-selected-card {
  position: relative;
  overflow: hidden;
  width: 100%;
  min-height: 148rpx;
  margin-top: 16rpx;
  padding: 24rpx;
  border-radius: 16rpx;
  box-sizing: border-box;
  background: linear-gradient(90deg, #edf9fd 0%, #f5fffb 62%, #fff 100%);
}

.location-map-ghost {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 58%;
  opacity: 0.55;
  background:
    radial-gradient(circle at 64% 34%, rgba(61, 173, 125, 0.18) 0 10rpx, transparent 11rpx),
    linear-gradient(135deg, rgba(61, 173, 125, 0.05), rgba(93, 193, 234, 0.12)),
    repeating-linear-gradient(26deg, transparent 0 22rpx, rgba(61, 173, 125, 0.12) 23rpx 25rpx);
}

.location-selected-content {
  position: relative;
  z-index: 1;
  max-width: 70%;
}

.widget-editor--figma .location-selected-card .address {
  overflow: hidden;
  color: #181818;
  font-size: var(--hh-text-heading-sm-size);
  font-weight: $hh-font-weight-bold;
  line-height: var(--hh-text-heading-sm-line);
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.location-region {
  display: block;
  overflow: hidden;
  margin-top: 4rpx;
  color: var(--hh-color-text-tertiary);
  font-size: var(--hh-text-body-base-size);
  line-height: var(--hh-text-body-base-line);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.location-card-pin {
  position: absolute;
  z-index: 1;
  right: 108rpx;
  top: 40rpx;
  color: #ef3434;
  font-size: 28rpx;
  line-height: 1;
}

.widget-editor--figma .location-value {
  flex: 1;
  min-width: 0;
  max-width: 100%;
  margin-bottom: 0;
  text-align: right;
}

.widget-editor--figma .address {
  overflow: hidden;
  color: #181818;
  font-size: 32rpx;
  line-height: 48rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.widget-editor--figma .location-actions {
  flex-shrink: 0;
  gap: 16rpx;
}

.widget-editor--figma :deep(.uni-date),
.widget-editor--figma :deep(.uni-date-editor) {
  min-width: 0 !important;
  max-width: 100% !important;
  width: 100% !important;
  box-sizing: border-box;
}

.widget-editor--figma .loc-btn {
  padding: 0;
  background: transparent;
  color: var(--hh-color-brand-primary);
  font-size: 32rpx;
  line-height: 48rpx;
}

.widget-editor--figma .loc-btn::after {
  border: none;
}

.widget-editor--figma .loc-btn.clear {
  background: transparent;
  color: var(--hh-color-brand-primary);
}

.widget-editor--figma .rich-note-editor {
  margin-top: 16rpx;
}

.widget-editor--figma.widget-editor--rich_note,
.widget-editor--figma.widget-editor--rich_text {
  min-height: 400rpx;
}

.widget-editor--guide-cover,
.widget-editor--guide-title,
.widget-editor--guide-body {
  padding: 0;
  min-height: 0;
  border-radius: 0;
  background: transparent;
}

.widget-editor--guide-cover .image-uploader {
  margin-top: 0;
}

.widget-editor--guide-cover .thumb-wrap,
.widget-editor--guide-cover .thumb,
.widget-editor--guide-cover .add-btn {
  width: 160rpx;
  height: 160rpx;
}

.widget-editor--guide-title {
  display: block;
}

.widget-editor--guide-title .input {
  min-height: 56rpx;
  font-size: var(--hh-text-heading-md-size);
  font-weight: $hh-font-weight-bold;
  line-height: var(--hh-text-heading-md-line);
  text-align: left;
}

.widget-editor--guide-title .input-placeholder {
  font-size: var(--hh-text-heading-md-size);
  line-height: var(--hh-text-heading-md-line);
}

.widget-editor--guide-body {
  min-height: 400rpx;
}

.widget-editor--guide-body .rich-note-editor {
  margin-top: 0;
}

.widget-editor--guide-body .textarea {
  min-height: 400rpx;
  padding: 0;
  font-size: var(--hh-text-body-lg-size);
  line-height: var(--hh-text-body-lg-line);
}

.widget-editor--embedded {
  border-radius: 0;
}

.widget-editor--embedded + .widget-editor--embedded {
  border-top: 1rpx solid #f1f1f1;
}

.widget-editor--guide-cover + .widget-editor--guide-title,
.widget-editor--guide-title + .widget-editor--guide-body {
  border-top: 0;
}
</style>
