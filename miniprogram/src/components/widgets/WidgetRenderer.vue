<template>
  <view
    v-if="hasValue || widget.required"
    class="widget-item"
    :class="[`widget-${widget.type}`, { 'is-guide-note': variant === 'guide_note' }]"
  >
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
      <view v-else-if="widget.type === 'audio_group'" class="audio-list">
        <view
          v-for="(item, index) in audioTracks"
          :key="item.fileID || index"
          class="audio-card"
          :class="{ active: isCurrentAudio(index), playing: isCurrentAudio(index) && audioStore.isPlaying }"
          @tap="playAudio(index)"
        >
          <view class="audio-play">
            <text>{{ isCurrentAudio(index) && audioStore.isPlaying ? 'Ⅱ' : '▶' }}</text>
          </view>
          <view class="audio-main">
            <text class="audio-title">{{ item.title || `音频 ${index + 1}` }}</text>
            <text class="audio-meta">{{ formatAudioDuration(item.duration) }}</text>
          </view>
        </view>
      </view>
      <rich-text
        v-else-if="widget.type === 'rich_text'"
        :nodes="rawValue as string"
      />
      <NoteBlocksRenderer
        v-else-if="widget.type === 'note_blocks'"
        :blocks="rawValue"
      />
      <RichNoteRenderer
        v-else-if="widget.type === 'rich_note'"
        :value="rawValue"
      />
      <view
        v-else-if="widget.type === 'location'"
        class="location-card"
        @tap="openLocation"
      >
        <map
          v-if="locationPreview"
          class="location-map"
          :latitude="locationPreview.lat"
          :longitude="locationPreview.lng"
          :markers="locationPreview.markers"
          :scale="15"
          :enable-scroll="false"
          :enable-zoom="false"
          :enable-rotate="false"
          :enable-overlooking="false"
          @tap.stop="openLocation"
        />
        <view class="location-meta">
          <text class="location-name">{{ locationPreview?.name || locationText }}</text>
          <text v-if="locationPreview?.address" class="location-address">{{ locationPreview.address }}</text>
          <text class="location-action">打开导航</text>
        </view>
      </view>
      <text v-else class="empty-value">-</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { formatWidgetValue } from '../../utils/widget'
import { resolveWidgetLabel } from '../../utils/widget-form'
import { useAudioStore } from '../../store/audio'
import VideoPlayerCard from './VideoPlayerCard.vue'
import NoteBlocksRenderer from './NoteBlocksRenderer.vue'
import RichNoteRenderer from './RichNoteRenderer.vue'
import { isRichNoteEmpty } from '../../utils/rich-note'
import { clientLog } from '../../utils/client-log'

const props = defineProps<{
  widget: any
  content: Record<string, any>
  postMeta?: { postId?: string; postTitle?: string; sectionId?: string; communityId?: string }
  variant?: 'default' | 'guide_note'
}>()

const audioStore = useAudioStore()
const displayLabel = computed(() => resolveWidgetLabel(props.widget))
const rawValue = computed(() => props.content[props.widget.widgetId])
const audioTracks = computed(() =>
  Array.isArray(rawValue.value)
    ? rawValue.value
        .filter((item: any) => item && typeof item === 'object' && item.fileID)
        .map((item: any) => ({
          fileID: String(item.fileID || ''),
          title: String(item.title || ''),
          duration: Number(item.duration || 0),
          cover: String(item.cover || ''),
        }))
    : []
)
const hasValue = computed(() => {
  const v = rawValue.value
  if (props.widget.type === 'rich_note') return !isRichNoteEmpty(v)
  return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)
})
const displayValue = computed(() => formatWidgetValue(rawValue.value, props.widget.type))
const locationText = computed(() => {
  const loc = parseLocation(rawValue.value)
  if (!loc) return '-'
  return loc.name || loc.address || `${loc.lat}, ${loc.lng}`
})
const locationPreview = computed(() => {
  const loc = parseLocation(rawValue.value)
  if (!loc) return null
  const name = loc.name || loc.address || displayLabel.value || '位置'
  return {
    ...loc,
    name,
    markers: [{
      id: 1,
      latitude: loc.lat,
      longitude: loc.lng,
      title: name,
    }],
  }
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

function parseLocation(value: any): { name: string; address: string; lat: number; lng: number } | null {
  if (!value || typeof value !== 'object') return null
  const lat = Number(value.lat)
  const lng = Number(value.lng)
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null
  return {
    name: String(value.name || ''),
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
    name: loc.name || loc.address || displayLabel.value || '位置',
    scale: 16,
  })
}

function isCurrentAudio(index: number) {
  const track = audioTracks.value[index]
  return Boolean(
    track &&
    audioStore.currentMeta?.postId === props.postMeta?.postId &&
    audioStore.currentPlaylist[audioStore.currentIndex]?.fileID === track.fileID,
  )
}

async function playAudio(index: number) {
  if (audioTracks.value.length === 0) return
  await audioStore.playPlaylist(audioTracks.value, index, {
    postId: String(props.postMeta?.postId || ''),
    postTitle: String(props.postMeta?.postTitle || ''),
    sectionId: String(props.postMeta?.sectionId || ''),
    communityId: String(props.postMeta?.communityId || ''),
  })
}

function formatAudioDuration(value: unknown): string {
  const total = Math.max(0, Math.round(Number(value || 0)))
  if (!total) return '--:--'
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function logWidget(stage: string) {
  clientLog('debug', 'widget.render.' + stage, {
    widgetId: props.widget?.widgetId || '',
    widgetType: props.widget?.type || '',
    label: displayLabel.value,
    hasValue: hasValue.value,
    valueIsArray: Array.isArray(rawValue.value),
    valueType: rawValue.value === null ? 'null' : typeof rawValue.value,
    postId: props.postMeta?.postId || '',
    sectionId: props.postMeta?.sectionId || '',
  })
}

onMounted(() => {
  logWidget('mounted')
})

watch(hasValue, () => {
  logWidget('hasValueChanged')
})
</script>

<style lang="scss" scoped>
.widget-item { padding: $hh-space-md 0; border-bottom: 1rpx solid var(--hh-color-line-soft); }
.label { font-size: var(--hh-text-caption-lg-size); color: var(--hh-color-text-tertiary); display: block; margin-bottom: $hh-space-xs; }
.value { font-size: var(--hh-text-body-lg-size); color: var(--hh-color-text-primary); }
.images { display: flex; flex-wrap: wrap; gap: $hh-space-sm; }
.thumb { width: 188rpx; height: 188rpx; border-radius: var(--hh-radius-card); }
.videos { display: block; }
.audio-list { display: grid; gap: $hh-space-sm; }
.audio-card {
  display: flex;
  align-items: center;
  gap: $hh-space-sm;
  padding: $hh-space-md;
  background: var(--hh-color-card);
  border: 1rpx solid var(--hh-color-line);
  border-radius: var(--hh-radius-card);
}
.audio-card.active {
  border-color: var(--hh-color-brand-primary);
  background: var(--hh-color-brand-soft);
}
.audio-play {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  background: var(--hh-color-brand-primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24rpx;
  font-weight: $hh-font-weight-bold;
  flex: 0 0 auto;
}
.audio-main { min-width: 0; display: flex; flex-direction: column; gap: 4rpx; }
.audio-title {
  font-size: $hh-font-body;
  color: var(--hh-color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.audio-meta { font-size: var(--hh-text-caption-lg-size); color: var(--hh-color-text-tertiary); }
.location-card {
  overflow: hidden;
  border: 1rpx solid var(--hh-color-line);
  border-radius: var(--hh-radius-card);
  background: var(--hh-color-card);
}

.location-map {
  width: 100%;
  height: 172rpx;
  display: block;
  background: $hh-surface-2;
}

.location-meta {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding: $hh-space-md;
}

.location-name {
  color: var(--hh-color-text-primary);
  font-size: var(--hh-text-body-base-size);
  font-weight: $hh-font-weight-bold;
}

.location-address {
  color: var(--hh-color-text-tertiary);
  font-size: var(--hh-text-caption-lg-size);
  line-height: 1.5;
}

.location-action {
  color: var(--hh-color-brand-primary);
  font-size: var(--hh-text-caption-lg-size);
  font-weight: $hh-font-weight-medium;
}
.empty-value { color: $hh-color-text-mute; }

.widget-item.is-guide-note {
  padding: 16rpx 0;
  border-bottom: none;
}

.widget-item.is-guide-note.widget-short_text {
  padding-top: 4rpx;
  padding-bottom: 20rpx;
}

.widget-item.is-guide-note.widget-short_text .label,
.widget-item.is-guide-note.widget-summary .label,
.widget-item.is-guide-note.widget-image_group .label,
.widget-item.is-guide-note.widget-rich_text .label,
.widget-item.is-guide-note.widget-rich_note .label {
  display: none;
}

.widget-item.is-guide-note.widget-short_text .value,
.widget-item.is-guide-note.widget-summary .value {
  font-family: $hh-font-serif;
  font-size: var(--hh-text-heading-lg-size);
  line-height: var(--hh-text-heading-lg-line);
  color: var(--hh-color-text-primary);
  font-weight: $hh-font-weight-bold;
}

.widget-item.is-guide-note.widget-image_group .images {
  display: grid;
  grid-template-columns: 1fr;
  gap: 18rpx;
}

.widget-item.is-guide-note.widget-image_group .thumb {
  width: 100%;
  height: 420rpx;
  border-radius: var(--hh-radius-card);
  background: $hh-surface-2;
}

.widget-item.is-guide-note.widget-rich_text .value,
.widget-item.is-guide-note.widget-rich_note .value {
  font-size: var(--hh-text-body-lg-size);
  line-height: 1.78;
  color: var(--hh-color-text-primary);
}

.widget-item.is-guide-note.widget-location {
  margin-top: 12rpx;
  padding: 18rpx 22rpx;
  border: 1rpx solid var(--hh-color-line);
  border-radius: var(--hh-radius-card);
  background: var(--hh-color-card);
}

.widget-item.is-guide-note.widget-location .label {
  margin-bottom: 4rpx;
}
</style>
