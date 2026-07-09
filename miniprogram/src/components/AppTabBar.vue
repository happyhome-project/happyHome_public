<template>
  <view>
    <view v-if="showPublishSheet" class="publish-mask" @tap="closePublishSheet">
      <view class="publish-sheet" @tap.stop>
        <view class="publish-grid">
          <button
            v-for="option in publishOptions"
            :key="option.section._id"
            class="publish-option"
            @tap="handlePublishOption(option.section)"
          >
            <view class="publish-icon" :class="`publish-icon--${option.tone}`">
              <image class="publish-icon-image" :src="option.iconSrc" mode="aspectFit" />
            </view>
            <text class="publish-label">{{ option.section.name }}</text>
          </button>
        </view>
        <button class="publish-close" aria-label="关闭发布面板" @tap="closePublishSheet">
          <text>×</text>
        </button>
      </view>
    </view>

    <view class="app-tabbar" aria-label="主导航">
      <button
        class="tab-btn"
        :class="{ active: props.current === 'home' }"
        @tap="go('home')"
      >
        <text>首&nbsp;&nbsp;页</text>
        <view class="active-dot"></view>
      </button>

      <button class="fab-btn" aria-label="发布" @tap="go('create')">
        <view class="fab-pill">
          <text class="fab-plus">+</text>
        </view>
      </button>

      <button
        class="tab-btn"
        :class="{ active: props.current === 'profile' }"
        @tap="go('profile')"
      >
        <text>我&nbsp;&nbsp;的</text>
        <view class="active-dot"></view>
      </button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useCommunityStore } from '../store/community'
import {
  APP_TABS,
  CREATE_SECTION_INTENT_KEY,
  type AppTabKey,
  getTabByKey,
  hideNativeTabBar,
} from '../utils/app-tabbar'

const props = defineProps<{ current: AppTabKey }>()
const communityStore = useCommunityStore()
const showPublishSheet = ref(false)
const HOME_TAB_RETAP_EVENT = 'happyhome:home-tab-retap'

const activePublishSections = computed(() =>
  (communityStore.currentSections || []).filter((section: any) => (
    (section?.status || 'active') === 'active' && isPublishableSection(section)
  ))
)

const publishOptions = computed(() =>
  activePublishSections.value.slice(0, 8).map((section: any, index: number) => {
    const meta = resolvePublishMeta(section?.name, index)
    return {
      section,
      tone: meta.tone,
      iconSrc: meta.iconSrc,
    }
  })
)

onMounted(() => {
  hideNativeTabBar()
})

function go(key: AppTabKey) {
  if (key === 'create') {
    openPublishSheet()
    return
  }
  closePublishSheet()
  const target = getTabByKey(key)
  if (!target) return
  hideNativeTabBar()
  if (props.current === key) {
    if (key === 'home') {
      ;(uni as any).$emit?.(HOME_TAB_RETAP_EVENT)
    }
    return
  }
  uni.switchTab({ url: target.path })
}

function openPublishSheet() {
  hideNativeTabBar()
  if (publishOptions.value.length === 0) {
    openCreatePage()
    return
  }
  showPublishSheet.value = true
}

function closePublishSheet() {
  showPublishSheet.value = false
}

function handlePublishOption(section: any) {
  const sectionId = String(section?._id || '')
  if (!sectionId) return
  const returnTo = props.current === 'create' ? '' : (getTabByKey(props.current)?.path || '')
  try {
    uni.setStorageSync(CREATE_SECTION_INTENT_KEY, {
      sectionId,
      createdAt: Date.now(),
      returnTo,
      source: 'tabbar.publish',
    })
  } catch (_error) {}
  closePublishSheet()
  ;(uni as any).$emit?.('happyhome:create-section-intent', { sectionId, returnTo })
  if (props.current !== 'create') {
    openCreatePage(returnTo)
  }
}

function currentReturnTo() {
  if (props.current === 'profile') return '/pages/profile/index'
  if (props.current === 'home') return '/pages/index/index'
  return ''
}

function openCreatePage(returnTo = currentReturnTo()) {
  const query = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''
  uni.navigateTo({ url: `/pages/create/index${query}` })
}

function isPublishableSection(section: any) {
  const name = String(section?.name || '').trim()
  const systemKey = String(section?.systemKey || '')
  if (systemKey === 'activity_invite' || name === '出游邀约' || name === '活动召集') return false

  const widgets = Array.isArray(section?.widgets) ? section.widgets : []
  if (widgets.length === 0) return false
  return widgets.some((widget: any) => {
    const type = String(widget?.type || '')
    return !['admin_notice', 'video_group', 'audio_group'].includes(type)
  })
}

function resolvePublishMeta(name: unknown, index: number) {
  const text = String(name || '').trim()
  if (/亲子|出游|攻略|路线/.test(text)) return { tone: 'family', iconSrc: '/static/publish-icons/family.svg' }
  if (/闲置|交易|二手|转让/.test(text)) return { tone: 'trade', iconSrc: '/static/publish-icons/trade.svg' }
  if (/活动|公告|通知|组局/.test(text)) return { tone: 'notice', iconSrc: '/static/publish-icons/notice.svg' }
  if (/失物|招领|寻物/.test(text)) return { tone: 'lost', iconSrc: '/static/publish-icons/lost.svg' }
  if (/邻里|互助|求助|帮忙/.test(text)) return { tone: 'neighbor', iconSrc: '/static/publish-icons/neighbor.svg' }
  if (/拼车|顺风|车/.test(text)) return { tone: 'car', iconSrc: '/static/publish-icons/car.svg' }
  const tones = ['family', 'trade', 'notice', 'lost', 'neighbor', 'car']
  const iconByTone: Record<string, string> = {
    family: '/static/publish-icons/family.svg',
    trade: '/static/publish-icons/trade.svg',
    notice: '/static/publish-icons/notice.svg',
    lost: '/static/publish-icons/lost.svg',
    neighbor: '/static/publish-icons/neighbor.svg',
    car: '/static/publish-icons/car.svg',
  }
  const tone = tones[index % tones.length]
  return {
    tone,
    iconSrc: iconByTone[tone],
  }
}

void APP_TABS
</script>

<style lang="scss" scoped>
.publish-mask {
  position: fixed;
  inset: 0;
  z-index: $hh-z-sticky + 20;
  background: rgba(0, 0, 0, 0.65);
}

.publish-sheet {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  min-height: 648rpx;
  padding: 48rpx 40rpx calc(64rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
  border-radius: 32rpx 32rpx 0 0;
  background: #fff;
  box-shadow: 0 -8rpx 16rpx rgba(0, 0, 0, 0.06), 0 -32rpx 80rpx rgba(0, 0, 0, 0.1);
}

.publish-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  column-gap: 18rpx;
  row-gap: 32rpx;
  width: 100%;
}

.publish-option {
  width: 100%;
  min-height: 154rpx;
  padding: 0;
  margin: 0;
  border: 0;
  background: transparent;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 15rpx;
}

.publish-icon {
  width: 104rpx;
  height: 104rpx;
  border-radius: 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.publish-icon-image {
  width: 72rpx;
  height: 72rpx;
  display: block;
}

.publish-icon--family {
  background: #fff2d9;
}

.publish-icon--trade {
  background: #e7f2ff;
}

.publish-icon--notice {
  background: #e8f8f0;
}

.publish-icon--lost {
  background: #fff0df;
}

.publish-icon--neighbor {
  background: #dff7ff;
}

.publish-icon--car {
  background: #e1f7ed;
}

.publish-label {
  width: 112rpx;
  color: var(--hh-color-text-secondary);
  font-size: var(--hh-text-body-base-size);
  line-height: var(--hh-text-body-base-line);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.publish-close {
  width: 80rpx;
  height: 80rpx;
  margin: 96rpx auto 0;
  padding: 0;
  border: 0;
  border-radius: $hh-radius-full;
  background: #f4f4f4;
  color: var(--hh-color-text-primary);
  font-size: 48rpx;
  line-height: 80rpx;
  text-align: center;
}

.app-tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: $hh-z-sticky;
  height: calc(98rpx + env(safe-area-inset-bottom));
  padding: 0 64rpx env(safe-area-inset-bottom);
  display: grid;
  grid-template-columns: 1fr 176rpx 1fr;
  align-items: center;
  background: rgba(255, 255, 255, 0.94);
  border-top: 1rpx solid var(--hh-color-line-soft);
  backdrop-filter: blur(24rpx);
  box-shadow: 0 -12rpx 36rpx rgba(31, 35, 32, 0.05);
}

button {
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  line-height: 1;
}

button::after {
  border: 0;
}

.tab-btn {
  width: 112rpx;
  height: 84rpx;
  justify-self: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6rpx;
  color: var(--hh-color-text-tertiary);
  font-size: var(--hh-text-caption-lg-size);
  font-weight: $hh-font-weight-medium;
}

.tab-btn text {
  white-space: pre;
}

.tab-btn.active {
  color: var(--hh-color-brand-primary);
  font-weight: $hh-font-weight-bold;
}

.active-dot {
  width: 7rpx;
  height: 7rpx;
  border-radius: $hh-radius-full;
  background: transparent;
}

.tab-btn.active .active-dot {
  background: var(--hh-color-brand-primary);
}

.fab-btn {
  width: 128rpx;
  height: 98rpx;
  margin: 0 auto;
  justify-self: center;
  display: flex;
  align-items: center;
  justify-content: center;
}

.fab-pill {
  width: 112rpx;
  height: 112rpx;
  border-radius: $hh-radius-full;
  background: var(--hh-color-brand-primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 16rpx 34rpx rgba(61, 173, 125, 0.28);
}

.fab-plus {
  font-size: 56rpx;
  line-height: 56rpx;
  font-weight: $hh-font-weight-regular;
}
</style>
