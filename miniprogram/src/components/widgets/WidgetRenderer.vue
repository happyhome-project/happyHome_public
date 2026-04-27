<template>
  <view class="widget-item" v-if="hasValue || widget.required">
    <text class="label">{{ displayLabel }}</text>
    <view class="value">
      <text v-if="['short_text', 'summary', 'number'].includes(widget.type)">
        {{ displayValue }}{{ widget.type === 'number' && widget.unit ? ' ' + widget.unit : '' }}
      </text>
      <text v-else-if="widget.type === 'datetime'">{{ formatDatetime(rawValue) }}</text>
      <view v-else-if="widget.type === 'image_group'" class="images">
        <image
          v-for="(img, i) in (rawValue as string[])"
          :key="i"
          :src="img"
          mode="aspectFill"
          class="thumb"
          @tap="previewImage(i)"
        />
      </view>
      <view v-else-if="widget.type === 'video_group'" class="videos">
        <VideoPlayerCard
          v-for="item in (rawValue as any[])"
          :key="item.itemId"
          :item="item"
        />
      </view>
      <rich-text
        v-else-if="widget.type === 'rich_text'"
        :nodes="rawValue as string"
      />
      <view
        v-else-if="widget.type === 'location'"
        class="location-value"
        @tap="openLocation"
      >
        <text>{{ locationText }}</text>
      </view>
      <text v-else class="empty-value">-</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { formatWidgetValue } from '../../utils/widget'
import { resolveWidgetLabel } from '../../utils/widget-form'
import VideoPlayerCard from './VideoPlayerCard.vue'

const props = defineProps<{ widget: any; content: Record<string, any> }>()

const displayLabel = computed(() => resolveWidgetLabel(props.widget))
const rawValue = computed(() => props.content[props.widget.widgetId])
const hasValue = computed(() => {
  const v = rawValue.value
  return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)
})
const displayValue = computed(() => formatWidgetValue(rawValue.value, props.widget.type))
const locationText = computed(() => {
  const loc = parseLocation(rawValue.value)
  if (!loc) return '-'
  return loc.address || `${loc.lat}, ${loc.lng}`
})

function formatDatetime(val: any): string {
  if (!val) return '-'
  const d = new Date(val)
  if (Number.isNaN(d.getTime())) return String(val)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

function previewImage(index: number) {
  wx.previewImage({
    current: (rawValue.value as string[])[index],
    urls: rawValue.value as string[],
  })
}

function parseLocation(value: any): { address: string; lat: number; lng: number } | null {
  if (!value || typeof value !== 'object') return null
  const lat = Number(value.lat)
  const lng = Number(value.lng)
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null
  return {
    address: String(value.address || ''),
    lat,
    lng,
  }
}

function openLocation() {
  const loc = parseLocation(rawValue.value)
  if (!loc) return
  wx.openLocation({
    latitude: loc.lat,
    longitude: loc.lng,
    address: loc.address,
    name: displayLabel.value || '位置',
    scale: 16,
  })
}
</script>

<style lang="scss" scoped>
.widget-item { padding: $hh-space-md 0; border-bottom: 1rpx solid $hh-color-divider; }
.label { font-size: $hh-font-caption; color: $hh-color-text-mute; display: block; margin-bottom: $hh-space-xs; }
.value { font-size: $hh-font-body-lg; color: $hh-color-text; }
.images { display: flex; flex-wrap: wrap; gap: $hh-space-sm; }
.thumb { width: 160rpx; height: 160rpx; border-radius: $hh-radius-sm; }
.videos { display: block; }
.location-value {
  color: $hh-color-info;
  text-decoration: underline;
}
.empty-value { color: $hh-color-text-mute; }
</style>
