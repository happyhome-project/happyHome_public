<template>
  <view class="default-detail">
    <view class="detail-head">
      <view class="section-line">
        <text class="section-pill"><text class="section-dot"></text>{{ sectionName }}</text>
        <text v-if="contentShapeLabel" class="shape-label">{{ contentShapeLabel }}</text>
      </view>

      <text class="detail-title">{{ titleText }}</text>
      <text v-if="leadText" class="detail-lead">{{ leadText }}</text>

      <view class="byline">
        <view class="author">
          <text class="avatar">{{ authorInitial }}</text>
          <view class="author-main">
            <text class="author-name">{{ authorName }}</text>
            <text class="article-time">{{ shortDate }}</text>
          </view>
        </view>
      </view>
    </view>

    <view v-if="imageItems.length" class="image-module">
      <image
        v-for="(image, index) in imageItems"
        :key="`${image}-${index}`"
        :src="image"
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
          <text class="fact-row-label">{{ fact.label }}</text>
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
        <view class="map-surface">
          <text class="map-pin"></text>
        </view>
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
type LocationItem = { key: string; name: string; address: string; lat: number; lng: number }

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

const authorName = computed(() => String(props.post?.authorNickname || '社区邻居').trim() || '社区邻居')
const authorInitial = computed(() => authorName.value.slice(0, 1) || '邻')
const shortDate = computed(() => formatShortDate(props.post?.createdAt))

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
    const value = props.post?.content?.[widget.widgetId]
    if (widget.type === 'rich_text') {
      blocks.push({ key: widget.widgetId, title: label, type: 'rich_text', value: String(value || '') })
    } else if (widget.type === 'rich_note' && !isRichNoteEmpty(value)) {
      blocks.push({ key: widget.widgetId, title: label, type: 'rich_note', value })
    } else if (widget.type === 'note_blocks' && Array.isArray(value) && value.length) {
      blocks.push({ key: widget.widgetId, title: label, type: 'note_blocks', value })
    } else if (widget.type === 'summary') {
      const text = textValue(widget)
      if (text) blocks.push({ key: widget.widgetId, title: label, type: 'plain', value: text })
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
      }
    })
    .filter((item): item is LocationItem => Boolean(item))
)

const contentShapeLabel = computed(() => {
  if (imageItems.value.length) return '图文资料'
  if (mediaWidgets.value.length) return '媒体资料'
  if (bodyBlocks.value.length) return '说明资料'
  return '信息卡片'
})

function hasWidgetValue(widget: any) {
  const value = props.post?.content?.[widget.widgetId]
  if (widget.type === 'rich_note') return !isRichNoteEmpty(value)
  if (widget.type === 'note_blocks') return Array.isArray(value) && value.length > 0
  return value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0)
}

function textValue(widget: any) {
  const value = props.post?.content?.[widget.widgetId]
  if (widget.type === 'rich_note') return normalizeRichNoteContent(value).text.trim()
  return formatWidgetValue(value, widget.type).trim()
}

function factValue(widget: any) {
  if (widget.type === 'number') {
    const value = formatWidgetValue(props.post?.content?.[widget.widgetId], widget.type).trim()
    return value ? `${value}${widget.unit ? ' ' + widget.unit : ''}` : ''
  }
  return formatWidgetValue(props.post?.content?.[widget.widgetId], widget.type).trim()
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

function formatShortDate(value: unknown): string {
  if (!value) return ''
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}月${date.getDate()}日`
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
  border: 1rpx solid $hh-ink-line;
  border-radius: $hh-radius-full;
  background: $hh-surface-1;
  color: $hh-ink-2;
  font-size: 24rpx;
  font-weight: $hh-font-weight-medium;
}

.section-dot {
  width: 10rpx;
  height: 10rpx;
  border-radius: 999rpx;
  background: $hh-accent;
}

.shape-label {
  font-family: $hh-font-mono;
  font-size: 20rpx;
  letter-spacing: 0.12em;
  color: $hh-ink-3;
}

.detail-title {
  display: block;
  margin-top: 28rpx;
  font-family: $hh-font-serif;
  font-size: 44rpx;
  line-height: 1.24;
  font-weight: $hh-font-weight-bold;
  color: $hh-ink-1;
  letter-spacing: $hh-tracking-serif-sm;
}

.detail-lead {
  display: block;
  margin-top: 18rpx;
  font-size: 28rpx;
  line-height: 1.78;
  color: $hh-ink-2;
  white-space: pre-wrap;
}

.byline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 28rpx;
  padding-top: 24rpx;
  border-top: 1rpx solid $hh-ink-line-2;
}

.author {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.avatar {
  width: 56rpx;
  height: 56rpx;
  border-radius: 999rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: $hh-accent-wash;
  border: 1rpx solid $hh-accent-line;
  color: $hh-accent-ink;
  font-size: 24rpx;
  font-weight: $hh-font-weight-bold;
  flex: 0 0 auto;
}

.author-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.author-name {
  max-width: 420rpx;
  color: $hh-ink-1;
  font-size: 26rpx;
  font-weight: $hh-font-weight-bold;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.article-time {
  color: $hh-ink-3;
  font-size: 22rpx;
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
  border-radius: $hh-radius-sm;
  background: $hh-surface-2;
}

.detail-image.primary {
  grid-column: 1 / -1;
  height: 420rpx;
  border-radius: $hh-radius-md;
}

.fact-strip {
  margin-top: $hh-space-lg;
  border: 1rpx solid $hh-ink-line;
  border-radius: $hh-radius-lg;
  overflow: hidden;
  background: $hh-surface-1;
}

.fact-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rpx;
  background: $hh-ink-line-2;
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
  background: $hh-surface-1;
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
  color: $hh-ink-1;
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
  color: $hh-ink-3;
}

.fact-list {
  border-top: 1rpx solid $hh-ink-line-2;
  background: $hh-surface-1;
}

.fact-list:first-child {
  border-top: 0;
}

.fact-row {
  display: grid;
  grid-template-columns: 132rpx minmax(0, 1fr);
  gap: 18rpx;
  padding: 24rpx;
  border-top: 1rpx solid $hh-ink-line-2;
}

.fact-row:first-child {
  border-top: 0;
}

.fact-row-label {
  color: $hh-ink-3;
  font-size: 24rpx;
  line-height: 1.55;
}

.fact-row-value {
  color: $hh-ink-2;
  font-size: 27rpx;
  line-height: 1.62;
  font-weight: $hh-font-weight-medium;
  word-break: break-word;
}

.content-block {
  margin-top: $hh-space-xl;
  padding-top: $hh-space-lg;
  border-top: 1rpx solid $hh-ink-line-2;
}

.block-title {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: $hh-space-md;
  color: $hh-ink-1;
  font-size: 30rpx;
  font-weight: $hh-font-weight-bold;
}

.block-title::before {
  content: '';
  width: 7rpx;
  height: 34rpx;
  border-radius: 999rpx;
  background: $hh-accent;
  flex: 0 0 auto;
}

.prose,
.prose-text {
  color: $hh-ink-1;
  font-size: 29rpx;
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
  background: $hh-surface-1;
  border: 1rpx solid $hh-ink-line-2;
  border-radius: $hh-radius-md;
}

.audio-card.active {
  border-color: $hh-accent-line;
  background: $hh-accent-wash;
}

.audio-play {
  width: 60rpx;
  height: 60rpx;
  border-radius: 999rpx;
  background: $hh-accent;
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
  color: $hh-ink-1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.audio-meta {
  font-size: 23rpx;
  color: $hh-ink-3;
}

.location-card {
  overflow: hidden;
  border: 1rpx solid $hh-ink-line;
  border-radius: $hh-radius-lg;
  background: $hh-surface-1;
}

.map-surface {
  height: 172rpx;
  position: relative;
  background:
    linear-gradient(135deg, rgba(49, 105, 73, 0.16), transparent 48%),
    linear-gradient(225deg, rgba(71, 102, 135, 0.14), transparent 46%),
    $hh-surface-2;
}

.map-pin {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 28rpx;
  height: 28rpx;
  transform: translate(-50%, -50%);
  border-radius: 999rpx 999rpx 999rpx 0;
  background: $hh-accent;
  transform: translate(-50%, -50%) rotate(-45deg);
  box-shadow: 0 8rpx 18rpx rgba(0, 0, 0, 0.16);
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
  color: $hh-ink-1;
}

.location-address {
  font-size: 25rpx;
  line-height: 1.55;
  color: $hh-ink-3;
}

.location-action {
  margin-top: 4rpx;
  color: $hh-accent-ink;
  font-size: 25rpx;
  font-weight: $hh-font-weight-medium;
}
</style>
