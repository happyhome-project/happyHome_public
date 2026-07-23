<template>
  <view class="archive-waterfall">
    <view v-if="loading && !hasCards" class="archive-waterfall__skeletons">
      <view v-for="index in 4" :key="index" class="archive-waterfall__skeleton"></view>
    </view>
    <view v-else-if="error && !hasCards" class="archive-waterfall__state">
      <text>内容暂时没有加载出来</text><button @tap="$emit('retry')">重试</button>
    </view>
    <view v-else-if="!hasCards" class="archive-waterfall__state archive-waterfall__state--empty">
      <text class="archive-waterfall__empty-title">还没有人分享</text>
      <text class="archive-waterfall__empty-copy">从一张照片或一段文字开始吧</text>
      <button @tap="$emit('publish')">去发布</button>
    </view>
    <view v-else class="archive-waterfall__columns">
      <view v-for="(column, index) in columns" :key="index" class="archive-waterfall__column">
        <view v-for="card in column" :key="card.postId" class="archive-waterfall__card" @tap="$emit('post', card)">
          <view v-if="card.cover.kind === 'video'" class="archive-waterfall__video-cover">
            <image
              v-if="card.cover.src"
              :src="card.cover.src"
              mode="aspectFill"
              class="archive-waterfall__cover"
              @load="$emit('cover-load', card)"
              @error="$emit('cover-error', card)"
            />
            <view v-else class="archive-waterfall__video-placeholder"><text>视频</text></view>
            <view class="archive-waterfall__video-play"><text>▶</text></view>
          </view>
          <template v-else-if="card.cover.kind === 'image'">
            <image
              v-if="card.cover.src"
              :src="card.cover.src"
              mode="widthFix"
              class="archive-waterfall__cover"
              @load="$emit('cover-load', card)"
              @error="$emit('cover-error', card)"
            />
            <view v-else class="archive-waterfall__image-placeholder" aria-label="图片暂不可用" />
          </template>
          <TextNoteCover v-else :title="card.title" :body="String(card.post?.content?.body?.text || '')" :theme="card.cover.theme as any" />
          <view class="archive-waterfall__main">
            <text class="archive-waterfall__title">{{ card.title }}</text>
            <view v-if="card.topics.length" class="archive-waterfall__topics"><text>#{{ card.topics[0] }}</text></view>
            <view class="archive-waterfall__meta"><text>{{ card.authorName }}</text><text>♡ {{ card.post?.likeCount || 0 }}</text></view>
          </view>
        </view>
      </view>
    </view>
    <view v-if="loading && hasCards" class="archive-waterfall__more"><text>加载中...</text></view>
    <view v-else-if="hasCards && hasMore" class="archive-waterfall__more" @tap="$emit('load-more')"><text>加载更多</text></view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import TextNoteCover from './TextNoteCover.vue'
import type { ArchiveFeedCard, ArchiveFeedColumns } from '../utils/archive-feed'
const props = defineProps<{ columns: ArchiveFeedColumns; loading: boolean; error: string; hasMore: boolean }>()
defineEmits<{
  (event: 'post' | 'cover-load' | 'cover-error', card: ArchiveFeedCard): void
  (event: 'publish' | 'retry' | 'load-more'): void
}>()
const hasCards = computed(() => props.columns[0].length + props.columns[1].length > 0)
</script>

<style scoped>
.archive-waterfall { padding: 18rpx var(--hh-page-x) 44rpx; background: var(--hh-color-card); min-height: 520rpx; }
.archive-waterfall__columns,.archive-waterfall__skeletons { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 14rpx; align-items: start; }
.archive-waterfall__column { display: flex; flex-direction: column; gap: 14rpx; min-width: 0; }
.archive-waterfall__card { overflow: hidden; border-radius: 16rpx; background: #fff; }
.archive-waterfall__cover { display: block; width: 100%; min-height: 220rpx; background: #eee; }
.archive-waterfall__image-placeholder { width: 100%; height: 300rpx; background: linear-gradient(110deg,#f1f1f1 18%,#f7f7f7 38%,#f1f1f1 58%); background-size: 200% 100%; animation: shimmer 1.2s linear infinite; }
.archive-waterfall__video-cover { position: relative; width: 100%; height: 300rpx; overflow: hidden; background: #171923; }
.archive-waterfall__video-cover .archive-waterfall__cover { width: 100%; height: 100%; min-height: 0; }
.archive-waterfall__video-placeholder { display: flex; width: 100%; height: 100%; align-items: center; justify-content: center; background: linear-gradient(145deg,#272b3d,#11131c); color: rgba(255,255,255,.48); font-size: 34rpx; letter-spacing: 8rpx; }
.archive-waterfall__video-play { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
.archive-waterfall__video-play text { display: flex; width: 68rpx; height: 68rpx; align-items: center; justify-content: center; padding-left: 4rpx; border-radius: 50%; background: rgba(255,255,255,.92); color: #222; font-size: 28rpx; box-shadow: 0 4rpx 18rpx rgba(0,0,0,.2); }
.archive-waterfall__main { padding: 16rpx 16rpx 18rpx; }
.archive-waterfall__title { display: -webkit-box; overflow: hidden; color: #151515; font-size: 28rpx; font-weight: 600; line-height: 40rpx; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.archive-waterfall__topics { margin-top: 8rpx; color: #666; font-size: 22rpx; }
.archive-waterfall__meta { display: flex; justify-content: space-between; margin-top: 16rpx; color: #8a8a8a; font-size: 22rpx; }
.archive-waterfall__skeleton { height: 360rpx; border-radius: 16rpx; background: linear-gradient(100deg,#eee 20%,#f7f7f7 40%,#eee 60%); background-size: 200% 100%; animation: shimmer 1.2s infinite; }
.archive-waterfall__state { display: flex; min-height: 420rpx; flex-direction: column; align-items: center; justify-content: center; gap: 18rpx; color: #777; font-size: 26rpx; }
.archive-waterfall__state button { margin: 0; border: 0; border-radius: 999rpx; background: #111; color: #fff; font-size: 26rpx; }
.archive-waterfall__empty-title { color: #222; font-size: 32rpx; font-weight: 650; }.archive-waterfall__empty-copy{color:#999}.archive-waterfall__more{text-align:center;padding:28rpx;color:#999;font-size:24rpx}
@keyframes shimmer { to { background-position: -200% 0; } }
</style>
