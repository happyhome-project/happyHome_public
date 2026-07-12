<template>
  <view class="default-detail">
    <view class="detail-head">
      <view class="section-line">
        <text class="section-pill"><text class="section-dot"></text>{{ sectionName }}</text>
      </view>

      <text class="detail-title">{{ titleText }}</text>
      <view v-if="leadText" class="lead-card">
        <text v-if="leadLabel" class="lead-label">{{ leadLabel }}:</text>
        <text class="lead-value">{{ leadText }}</text>
      </view>
    </view>

    <view v-if="imageItems.length" class="image-module">
      <image
        v-for="(image, index) in imageItems"
        :key="`${image}-${index}`"
        :src="image"
        data-testid="detail-content-image"
        class="detail-image"
        :class="{ primary: index === 0 }"
        mode="aspectFill"
        @tap="previewImage(index)"
      />
    </view>

    <view v-if="quickFacts.length || detailFacts.length" class="fact-strip">
      <view
        v-if="quickFacts.length"
        class="fact-grid"
        :class="`count-${quickFacts.length}`"
      >
        <view v-for="fact in quickFacts" :key="fact.key" class="fact">
          <text class="fact-value" :class="{ price: fact.style === 'price', tight: fact.value.length > 6 && fact.style !== 'price' }">
            {{ fact.value }}
          </text>
          <text class="fact-label">{{ fact.label }}</text>
        </view>
      </view>

      <view v-if="detailFacts.length" class="fact-list">
        <view v-for="fact in detailFacts" :key="fact.key" class="fact-row">
          <text class="fact-row-label">{{ fact.label }}:</text>
          <text class="fact-row-value">{{ fact.value }}</text>
        </view>
      </view>
    </view>

    <view
      v-for="block in bodyBlocks"
      :key="block.key"
      class="content-block"
    >
      <text v-if="block.title" class="block-title">{{ block.title }}</text>
      <rich-text v-if="block.type === 'rich_text'" class="prose" :nodes="block.value" />
      <RichNoteRenderer v-else-if="block.type === 'rich_note'" :value="block.value" />
      <NoteBlocksRenderer v-else-if="block.type === 'note_blocks'" :blocks="block.value" />
      <text v-else class="prose-text">{{ block.value }}</text>
    </view>

    <view v-if="mediaWidgets.length" class="content-block">
      <text class="block-title">媒体资料</text>
      <view class="media-list">
        <template v-for="media in mediaWidgets" :key="media.key">
          <VideoPlayerCard
            v-for="item in media.videos"
            :key="item.itemId || item.fileID || item.url"
            :item="item"
          />
          <view
            v-for="(item, index) in media.audios"
            :key="item.fileID || index"
            class="audio-card"
            :class="{ active: isCurrentAudio(media.key, index), playing: isCurrentAudio(media.key, index) && audioStore.isPlaying }"
            @tap="playAudio(media.key, index)"
          >
            <view class="audio-play">
              <text>{{ isCurrentAudio(media.key, index) && audioStore.isPlaying ? 'Ⅱ' : '▶' }}</text>
            </view>
            <view class="audio-main">
              <text class="audio-title">{{ item.title || `音频 ${index + 1}` }}</text>
              <text class="audio-meta">{{ formatAudioDuration(item.duration) }}</text>
            </view>
          </view>
        </template>
      </view>
    </view>

    <view v-if="locationItems.length" class="content-block">
      <text class="block-title">位置</text>
      <view
        v-for="item in locationItems"
        :key="item.key"
        class="location-card"
        @tap="openLocation(item)"
      >
        <map
          class="location-map"
          :latitude="item.lat"
          :longitude="item.lng"
          :markers="item.markers"
          :scale="15"
          :enable-scroll="false"
          :enable-zoom="false"
          :enable-rotate="false"
          :enable-overlooking="false"
          @tap.stop="openLocation(item)"
        />
        <view class="location-body">
          <text class="location-name">{{ item.name }}</text>
          <text v-if="item.address" class="location-address">{{ item.address }}</text>
          <text class="location-action">打开导航</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import RichNoteRenderer from './widgets/RichNoteRenderer.vue'
import NoteBlocksRenderer from './widgets/NoteBlocksRenderer.vue'
import VideoPlayerCard from './widgets/VideoPlayerCard.vue'
import { formatWidgetValue } from '../utils/widget'
import { resolveWidgetLabel } from '../utils/widget-form'
import { isRichNoteEmpty, normalizeRichNoteContent } from '../utils/rich-note'
import { useAudioStore } from '../store/audio'

const props = defineProps<{
  post: any
  section: any
  widgets: any[]
  postMeta?: { postId?: string; postTitle?: string; sectionId?: string; communityId?: string }
}>()

type FactItem = { key: string; label: string; value: string; style?: 'price' }
type BodyBlock = { key: string; title: string; type: 'plain' | 'rich_text' | 'rich_note' | 'note_blocks'; value: any }
type LocationItem = {
  key: string
  name: string
  address: string
  lat: number
  lng: number
  markers: Array<{ id: number; latitude: number; longitude: number; title: string }>
}

const audioStore = useAudioStore()
const titleLabelNeedles = ['标题', '名称', '名字', '书名', '物品', '活动', '医生姓名', '音乐名称', '电影分类']

const sortedWidgets = computed(() =>
  (props.widgets || [])
    .slice()
    .filter((widget) => hasWidgetValue(widget))
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
)

const sectionName = computed(() => String(props.section?.name || ''))

const titleWidget = computed(() => {
  const preferred = sortedWidgets.value.find((widget) =>
    ['short_text', 'summary'].includes(widget.type) &&
    labelLooksLike(resolveWidgetLabel(widget), titleLabelNeedles)
  )
  if (preferred) return preferred
  const hasEmptyPreferredTitle = (props.widgets || []).some((widget) =>
    ['short_text', 'summary'].includes(widget.type) &&
    labelLooksLike(resolveWidgetLabel(widget), titleLabelNeedles)
  )
  if (hasEmptyPreferredTitle) return null
  return sortedWidgets.value.find((widget) => ['short_text', 'summary'].includes(widget.type))
})

const leadWidget = computed(() => {
  const summary = sortedWidgets.value.find((widget) => widget.widgetId !== titleWidget.value?.widgetId && widget.type === 'summary')
  if (summary) return summary
  return sortedWidgets.value.find((widget) =>
    widget.widgetId !== titleWidget.value?.widgetId &&
    widget.type === 'short_text' &&
    textValue(widget).length > 18
  )
})

const titleText = computed(() =>
  (titleWidget.value ? textValue(titleWidget.value) : '').trim() || sectionName.value || '帖子'
)

const leadText = computed(() =>
  leadWidget.value ? textValue(leadWidget.value).trim() : ''
)

const leadLabel = computed(() =>
  leadWidget.value ? resolveWidgetLabel(leadWidget.value).trim() : ''
)

const imageItems = computed(() => {
  const images: string[] = []
  sortedWidgets.value
    .filter((widget) => widget.type === 'image_group')
    .forEach((widget) => {
      const value = props.post?.content?.[widget.widgetId]
      if (Array.isArray(value)) {
        value.forEach((item) => {
          const image = String(item || '').trim()
          if (image) images.push(image)
        })
      }
    })
  return images
})

const factCandidates = computed<FactItem[]>(() =>
  sortedWidgets.value
    .filter((widget) =>
      ![titleWidget.value?.widgetId, leadWidget.value?.widgetId].includes(widget.widgetId) &&
      ['short_text', 'number', 'datetime'].includes(widget.type)
    )
    .map((widget) => {
      const value = factValue(widget)
      return {
        key: widget.widgetId,
        label: resolveWidgetLabel(widget),
        value,
        style: isPriceWidget(widget) ? 'price' as const : undefined,
      }
    })
    .filter((item) => item.value)
)

const quickFacts = computed(() => splitFacts(factCandidates.value).quick)
const detailFacts = computed(() => splitFacts(factCandidates.value).detail)

const bodyBlocks = computed<BodyBlock[]>(() => {
  const blocks: BodyBlock[] = []
  sortedWidgets.value.forEach((widget) => {
    if ([titleWidget.value?.widgetId, leadWidget.value?.widgetId].includes(widget.widgetId)) return
    const label = resolveWidgetLabel(widget)
    const title = bodyBlockTitle(label)
    const value = props.post?.content?.[widget.widgetId]
    if (widget.type === 'rich_text') {
      blocks.push({ key: widget.widgetId, title, type: 'rich_text', value: String(value || '') })
    } else if (widget.type === 'rich_note' && !isRichNoteEmpty(value)) {
      blocks.push({ key: widget.widgetId, title, type: 'rich_note', value })
    } else if (widget.type === 'note_blocks' && Array.isArray(value) && value.length) {
      blocks.push({ key: widget.widgetId, title, type: 'note_blocks', value })
    } else if (widget.type === 'summary') {
      const text = textValue(widget)
      if (text) blocks.push({ key: widget.widgetId, title, type: 'plain', value: text })
    }
  })
  return blocks
})

const mediaWidgets = computed(() =>
  sortedWidgets.value
    .filter((widget) => ['video_group', 'audio_group'].includes(widget.type))
    .map((widget) => {
      const value = props.post?.content?.[widget.widgetId]
      const list = Array.isArray(value) ? value : []
      return {
        key: widget.widgetId,
        videos: widget.type === 'video_group' ? list : [],
        audios: widget.type === 'audio_group'
          ? list
              .filter((item: any) => item && typeof item === 'object' && item.fileID)
              .map((item: any) => ({
                fileID: String(item.fileID || ''),
                title: String(item.title || ''),
                duration: Number(item.duration || 0),
                cover: String(item.cover || ''),
              }))
          : [],
      }
    })
    .filter((item) => item.videos.length || item.audios.length)
)

const locationItems = computed<LocationItem[]>(() =>
  sortedWidgets.value
    .filter((widget) => widget.type === 'location')
    .map((widget) => {
      const loc = parseLocation(props.post?.content?.[widget.widgetId])
      if (!loc) return null
      const label = resolveWidgetLabel(widget)
      const name = normalizeLocationTitle(loc.name, loc.address, label)
      const address = loc.address && loc.address !== name ? loc.address : ''
      return {
        key: widget.widgetId,
        name,
        address,
        lat: loc.lat,
        lng: loc.lng,
        markers: [{
          id: 1,
          latitude: loc.lat,
          longitude: loc.lng,
          title: name,
        }],
      }
    })
    .filter((item): item is LocationItem => Boolean(item))
)

function hasWidgetValue(widget: any) {
  const value = props.post?.content?.[widget.widgetId]
  if (widget.visibility === 'member' && (value === undefined || value === null || value === '')) return true
  if (widget.type === 'rich_note') return !isRichNoteEmpty(value)
  if (widget.type === 'note_blocks') return Array.isArray(value) && value.length > 0
  return value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0)
}

function textValue(widget: any) {
  const value = props.post?.content?.[widget.widgetId]
  if (widget.visibility === 'member' && (value === undefined || value === null || value === '')) {
    return '加入后可查看联系电话'
  }
  if (widget.type === 'rich_note') return normalizeRichNoteContent(value).text.trim()
  return formatWidgetValue(value, widget.type).trim()
}

function factValue(widget: any) {
  const raw = props.post?.content?.[widget.widgetId]
  if (widget.visibility === 'member' && (raw === undefined || raw === null || raw === '')) {
    return '加入后可查看联系电话'
  }
  if (widget.type === 'number') {
    const value = formatWidgetValue(raw, widget.type).trim()
    return value ? `${value}${widget.unit ? ' ' + widget.unit : ''}` : ''
  }
  return formatWidgetValue(raw, widget.type).trim()
}

function splitFacts(facts: FactItem[]) {
  const quick: FactItem[] = []
  const detail: FactItem[] = []
  facts.forEach((fact) => {
    if (quick.length < 4 && !shouldUseFactRow(fact)) {
      quick.push(fact)
    } else {
      detail.push(fact)
    }
  })
  return { quick, detail }
}

function shouldUseFactRow(fact: FactItem) {
  const value = fact.value.trim()
  const dateLike = /^[\d\s年月日周一二三四五六七八九十:：.\/~\-—到至上午下午晚上早中晚点、]+$/.test(value)
  if (dateLike) return false
  return value.length > 12
}

function labelLooksLike(label: string, needles: string[]) {
  const normalized = String(label || '').replace(/\s/g, '')
  return needles.some((needle) => normalized.includes(needle))
}

function isPriceWidget(widget: any) {
  const label = resolveWidgetLabel(widget)
  const fieldKey = String(widget.fieldKey || '').toLowerCase()
  return fieldKey.includes('price') || labelLooksLike(label, ['价格', '费用', '预算'])
}

function bodyBlockTitle(label: string) {
  const normalized = String(label || '').replace(/\s/g, '')
  if (['正文', '内容', '正文内容', '详情内容'].includes(normalized)) return ''
  return String(label || '').trim()
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

function normalizeLocationTitle(name: string, address: string, label: string) {
  const cleanName = String(name || '').trim()
  const cleanAddress = String(address || '').trim()
  const genericNames = ['位置', '地点', '定位', '目的地', '目的地位置']
  if (cleanName && !genericNames.includes(cleanName)) return cleanName
  if (cleanAddress) return cleanAddress
  const cleanLabel = String(label || '').trim()
  return cleanLabel || '位置'
}

function openLocation(item: LocationItem) {
  uni.openLocation({
    latitude: item.lat,
    longitude: item.lng,
    address: item.address,
    name: item.name || item.address || '位置',
    scale: 16,
  })
}

function previewImage(index: number) {
  uni.previewImage({
    current: imageItems.value[index],
    urls: imageItems.value,
  })
}

function isCurrentAudio(mediaKey: string, index: number) {
  const media = mediaWidgets.value.find((item) => item.key === mediaKey)
  const track = media?.audios[index]
  return Boolean(
    track &&
    audioStore.currentMeta?.postId === props.postMeta?.postId &&
    audioStore.currentPlaylist[audioStore.currentIndex]?.fileID === track.fileID,
  )
}

async function playAudio(mediaKey: string, index: number) {
  const media = mediaWidgets.value.find((item) => item.key === mediaKey)
  if (!media || media.audios.length === 0) return
  await audioStore.playPlaylist(media.audios, index, {
    postId: String(props.postMeta?.postId || ''),
    postTitle: String(props.postMeta?.postTitle || titleText.value || ''),
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

</script>

<style lang="scss" scoped>
.default-detail {
  padding: 0 0 $hh-space-sm;
}

.detail-head {
  padding: 0 0 $hh-space-md;
}

.section-line {
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex-wrap: wrap;
}

.section-pill {
  display: inline-flex;
  align-items: center;
  gap: 8rpx;
  min-height: 44rpx;
  padding: 0 18rpx;
  border: 1rpx solid var(--hh-color-line);
  border-radius: $hh-radius-full;
  background: var(--hh-color-card);
  color: var(--hh-color-text-secondary);
  font-size: var(--hh-text-caption-lg-size);
  font-weight: $hh-font-weight-medium;
}

.section-dot {
  width: 10rpx;
  height: 10rpx;
  border-radius: 999rpx;
  background: var(--hh-color-brand-primary);
}

.detail-title {
  display: block;
  margin-top: 28rpx;
  font-family: $hh-font-serif;
  font-size: var(--hh-text-heading-lg-size);
  line-height: var(--hh-text-heading-lg-line);
  font-weight: $hh-font-weight-bold;
  color: var(--hh-color-text-primary);
  letter-spacing: $hh-tracking-serif-sm;
}

.lead-card {
  margin-top: 22rpx;
  padding: 20rpx 24rpx;
  border: 1rpx solid var(--hh-color-brand-line);
  border-radius: var(--hh-radius-card);
  background: var(--hh-color-card-soft);
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
}

.lead-label {
  flex: 0 0 auto;
  color: var(--hh-color-text-tertiary);
  font-size: var(--hh-text-caption-lg-size);
  line-height: 1.55;
}

.lead-value {
  min-width: 0;
  flex: 1;
  color: var(--hh-color-text-secondary);
  font-size: var(--hh-text-body-base-size);
  line-height: 1.55;
  font-weight: $hh-font-weight-medium;
  white-space: pre-wrap;
  word-break: break-word;
}

.image-module {
  margin-top: $hh-space-lg;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12rpx;
}

.detail-image {
  width: 100%;
  height: 210rpx;
  border-radius: var(--hh-radius-card);
  background: $hh-surface-2;
}

.detail-image.primary {
  grid-column: 1 / -1;
  height: 420rpx;
  border-radius: var(--hh-radius-card);
}

.fact-strip {
  margin-top: $hh-space-lg;
  border: 1rpx solid var(--hh-color-line);
  border-radius: var(--hh-radius-card);
  overflow: hidden;
  background: var(--hh-color-card);
}

.fact-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rpx;
  background: var(--hh-color-line-soft);
}

.fact-grid.count-1 {
  grid-template-columns: 1fr;
}

.fact-grid.count-3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.fact {
  min-height: 126rpx;
  padding: 24rpx;
  background: var(--hh-color-card);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10rpx;
}

.fact-grid.count-1 .fact,
.fact-grid.count-2 .fact {
  min-height: 108rpx;
  padding-top: 22rpx;
  padding-bottom: 22rpx;
}

.fact-grid.count-3 .fact {
  min-height: 112rpx;
  padding: 20rpx 14rpx;
}

.fact-value {
  font-family: $hh-font-serif;
  font-size: 34rpx;
  line-height: 1.22;
  font-weight: $hh-font-weight-bold;
  color: var(--hh-color-text-primary);
  word-break: break-all;
}

.fact-grid.count-3 .fact-value {
  font-size: 29rpx;
}

.fact-value.tight {
  font-family: $hh-font-sans;
  font-size: 28rpx;
}

.fact-grid.count-3 .fact-value.tight {
  font-size: 25rpx;
}

.fact-value.price {
  color: #9a5c18;
}

.fact-label {
  font-size: 23rpx;
  color: var(--hh-color-text-tertiary);
}

.fact-list {
  border-top: 1rpx solid var(--hh-color-line-soft);
  background: var(--hh-color-card);
}

.fact-list:first-child {
  border-top: 0;
}

.fact-row {
  display: flex;
  align-items: flex-start;
  gap: 18rpx;
  padding: 22rpx 24rpx;
  border-top: 1rpx solid var(--hh-color-line-soft);
}

.fact-row:first-child {
  border-top: 0;
}

.fact-row-label {
  flex: 0 0 140rpx;
  color: var(--hh-color-text-tertiary);
  font-size: var(--hh-text-caption-lg-size);
  line-height: 1.5;
}

.fact-row-value {
  min-width: 0;
  flex: 1;
  color: var(--hh-color-text-secondary);
  font-size: var(--hh-text-body-base-size);
  line-height: 1.5;
  font-weight: $hh-font-weight-medium;
  word-break: break-word;
}

.content-block {
  margin-top: $hh-space-xl;
  padding-top: $hh-space-lg;
  border-top: 1rpx solid var(--hh-color-line-soft);
}

.block-title {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: $hh-space-md;
  color: var(--hh-color-text-primary);
  font-size: var(--hh-text-heading-sm-size);
  font-weight: $hh-font-weight-bold;
}

.block-title::before {
  content: '';
  width: 7rpx;
  height: 34rpx;
  border-radius: 999rpx;
  background: var(--hh-color-brand-primary);
  flex: 0 0 auto;
}

.prose,
.prose-text {
  color: var(--hh-color-text-primary);
  font-size: var(--hh-text-body-lg-size);
  line-height: 1.82;
  white-space: pre-wrap;
  word-break: break-word;
}

.media-list {
  display: grid;
  gap: $hh-space-md;
}

.audio-card {
  display: flex;
  align-items: center;
  gap: $hh-space-md;
  padding: $hh-space-md;
  background: var(--hh-color-card);
  border: 1rpx solid var(--hh-color-line);
  border-radius: var(--hh-radius-card);
}

.audio-card.active {
  border-color: var(--hh-color-brand-line);
  background: var(--hh-color-brand-soft);
}

.audio-play {
  width: 60rpx;
  height: 60rpx;
  border-radius: 999rpx;
  background: var(--hh-color-brand-primary);
  color: $hh-surface-1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24rpx;
  font-weight: $hh-font-weight-bold;
  flex: 0 0 auto;
}

.audio-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.audio-title {
  font-size: 28rpx;
  color: var(--hh-color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.audio-meta {
  font-size: 23rpx;
  color: var(--hh-color-text-tertiary);
}

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

.location-body {
  padding: $hh-space-md;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.location-name {
  font-size: 29rpx;
  font-weight: $hh-font-weight-bold;
  color: var(--hh-color-text-primary);
}

.location-address {
  font-size: 25rpx;
  line-height: 1.55;
  color: var(--hh-color-text-tertiary);
}

.location-action {
  margin-top: 4rpx;
  color: var(--hh-color-brand-strong);
  font-size: 25rpx;
  font-weight: $hh-font-weight-medium;
}
</style>
