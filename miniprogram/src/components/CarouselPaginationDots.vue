<template>
  <view
    v-if="pagination.count > 1"
    class="carousel-pagination-dots"
    data-testid="carousel-pagination-dots"
    aria-hidden="true"
  >
    <text
      v-for="pageIndex in pagination.indexes"
      :key="`carousel-pagination-dot-${pageIndex}`"
      class="carousel-pagination-dot"
      :class="{ 'carousel-pagination-dot--active': pageIndex === pagination.currentIndex }"
    />
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getCarouselPaginationState } from '../utils/carousel-pagination'

const props = withDefaults(defineProps<{
  count?: number
  currentIndex?: number
}>(), {
  count: 0,
  currentIndex: 0,
})

const pagination = computed(() => getCarouselPaginationState(
  props.count,
  props.currentIndex,
))
</script>

<style lang="scss" scoped>
.carousel-pagination-dots {
  height: 46rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
  background: #fff;
}

.carousel-pagination-dot {
  width: 10rpx;
  height: 10rpx;
  border-radius: 999rpx;
  background: #d7d7d7;
  transition: width 160ms ease, background-color 160ms ease;
}

.carousel-pagination-dot--active {
  width: 14rpx;
  background: #ff2442;
}
</style>
