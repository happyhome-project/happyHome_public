<template>
  <view
    class="text-note-deck"
    data-testid="text-note-deck"
    :data-page-count="resolvedDeck.pages.length"
    :data-current-page="displayPage"
    :data-theme="resolvedDeck.theme"
  >
    <swiper
      class="text-note-deck__viewport"
      :current="displayPage - 1"
      :circular="false"
      :duration="260"
      :disable-touch="resolvedDeck.pages.length <= 1"
      @change="handleChange"
    >
      <swiper-item
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
      </swiper-item>
    </swiper>
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
  currentPage?: number
}>(), {
  deck: null,
  title: '',
  body: '',
  theme: 'paper',
  currentPage: 1,
})

const emit = defineEmits<{
  (event: 'page-change', page: number): void
}>()

const resolvedDeck = computed(() => props.deck || createTextNoteDeck({
  title: props.title,
  body: props.body,
  theme: props.theme,
}))
const displayPage = ref(1)

const deckSignature = computed(() => {
  const pages = resolvedDeck.value.pages
  return `${resolvedDeck.value.theme}:${pages.length}:${pages[0]?.title || ''}:${pages[pages.length - 1]?.sourceBody.length || 0}`
})

watch(
  () => props.currentPage,
  (requestedPage) => {
    displayPage.value = clampPage(requestedPage)
  },
  { immediate: true },
)

watch(deckSignature, () => {
  displayPage.value = clampPage(props.currentPage)
})

function clampPage(value: unknown) {
  const pageCount = Math.max(1, resolvedDeck.value.pages.length)
  const requested = Math.round(Number(value || 1))
  return Math.min(pageCount, Math.max(1, Number.isFinite(requested) ? requested : 1))
}

function handleChange(event: any) {
  const nextPage = clampPage(Number(event?.detail?.current || 0) + 1)
  displayPage.value = nextPage
  emit('page-change', nextPage)
}
</script>

<style lang="scss" scoped>
.text-note-deck {
  width: 100%;
}

.text-note-deck__viewport {
  aspect-ratio: 370 / 498;
  width: 100%;
  height: auto;
}

.text-note-deck__slide {
  width: 100%;
  height: 100%;
}
</style>
