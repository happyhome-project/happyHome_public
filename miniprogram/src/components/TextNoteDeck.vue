<template>
  <view class="text-note-deck">
    <scroll-view
      class="text-note-deck__viewport"
      scroll-x
      :show-scrollbar="false"
      :enhanced="true"
      @scroll="handleScroll"
    >
      <view class="text-note-deck__track">
        <view
          v-for="page in resolvedDeck.pages"
          :key="`${resolvedDeck.theme}-${page.pageNumber}`"
          class="text-note-deck__slide"
        >
          <TextNoteCover
            :title="page.title"
            :body="page.body"
            :theme="resolvedDeck.theme"
            :page-kind="page.kind"
            :page-number="page.pageNumber"
            :total-pages="page.totalPages"
          />
        </view>
      </view>
    </scroll-view>
    <view v-if="resolvedDeck.pages.length > 1" class="text-note-deck__progress" aria-hidden="true">
      <view
        v-for="page in resolvedDeck.pages"
        :key="`progress-${page.pageNumber}`"
        class="text-note-deck__progress-dot"
        :class="{ 'text-note-deck__progress-dot--active': currentPage === page.pageNumber }"
      />
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import TextNoteCover from './TextNoteCover.vue'
import {
  createTextNoteDeck,
  type TextNoteDeck,
  type TextNoteTheme,
} from '../utils/text-note'

const props = withDefaults(defineProps<{
  deck?: TextNoteDeck | null
  title?: string
  body?: string
  theme?: TextNoteTheme | string
}>(), {
  deck: null,
  title: '',
  body: '',
  theme: 'paper',
})

const resolvedDeck = computed(() => props.deck || createTextNoteDeck({
  title: props.title,
  body: props.body,
  theme: props.theme,
}))
const currentPage = ref(1)

watch(
  () => `${resolvedDeck.value.theme}:${resolvedDeck.value.pages.length}`,
  () => {
    currentPage.value = 1
  },
)

function handleScroll(event: any) {
  const pageCount = resolvedDeck.value.pages.length
  if (pageCount <= 1) {
    currentPage.value = 1
    return
  }
  const detail = event?.detail || {}
  const scrollLeft = Math.max(0, Number(detail.scrollLeft || 0))
  const scrollWidth = Math.max(0, Number(detail.scrollWidth || 0))
  const fallbackStep = Number((uni as any).upx2px?.(636) || 318)
  const step = scrollWidth > 0 ? scrollWidth / pageCount : fallbackStep
  currentPage.value = Math.min(pageCount, Math.max(1, Math.round(scrollLeft / Math.max(1, step)) + 1))
}
</script>

<style lang="scss" scoped>
.text-note-deck {
  width: 100%;
}

.text-note-deck__viewport {
  width: 100%;
  white-space: nowrap;
}

.text-note-deck__track {
  display: inline-flex;
  align-items: flex-start;
  gap: 16rpx;
  min-width: 100%;
  padding-right: 56rpx;
  box-sizing: border-box;
}

.text-note-deck__slide {
  width: min(620rpx, calc(100vw - 112rpx));
  flex: 0 0 min(620rpx, calc(100vw - 112rpx));
  white-space: normal;
}

.text-note-deck__progress {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10rpx;
  min-height: 28rpx;
  margin-top: 16rpx;
}

.text-note-deck__progress-dot {
  width: 10rpx;
  height: 10rpx;
  border-radius: 999rpx;
  background: rgba(24, 24, 24, 0.18);
  transition: width 160ms ease, background-color 160ms ease;
}

.text-note-deck__progress-dot--active {
  width: 28rpx;
  background: var(--hh-color-brand-primary);
}
</style>
