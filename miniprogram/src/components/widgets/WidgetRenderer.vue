<template>
  <view class="widget-item" v-if="hasValue || widget.required">
    <text class="label">{{ widget.label }}</text>
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

const props = defineProps<{ widget: any; content: Record<string, any> }>()

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
  if (isNaN(d.getTime())) return String(val)
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`
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
    name: props.widget.label || '位置',
    scale: 16,
  })
}
</script>

<style scoped>
.widget-item { padding: 20rpx 0; border-bottom: 1rpx solid #f5f5f5; }
.label { font-size: 26rpx; color: #999; display: block; margin-bottom: 8rpx; }
.value { font-size: 30rpx; color: #333; }
.images { display: flex; flex-wrap: wrap; gap: 12rpx; }
.thumb { width: 160rpx; height: 160rpx; border-radius: 8rpx; }
.location-value {
  color: #1976d2;
  text-decoration: underline;
}
.empty-value { color: #ccc; }
</style>
