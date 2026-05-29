<template>
  <view class="post-card" @tap="$emit('tap')">
    <view class="preview-fields">
      <view v-for="field in preview" :key="field.label" class="field" :class="{ 'attendance-field': field.type === 'attendance' }">
        <template v-if="field.type === 'attendance'">
          <view class="attendance-meta">
            <text class="field-label">{{ field.label }}</text>
            <text class="field-value">{{ field.value }}</text>
          </view>
          <view class="attendance-avatars">
            <image
              v-for="user in field.previewUsers || []"
              :key="user.userId"
              :src="avatarSrc(user.avatarUrl)"
              class="avatar"
              mode="aspectFill"
            />
          </view>
        </template>
        <template v-else>
          <text class="field-label">{{ field.label }}</text>
          <text class="field-value">{{ field.value }}</text>
        </template>
      </view>
      <view v-if="preview.length === 0" class="empty-preview">
        <text>暂无摘要信息</text>
      </view>
    </view>
    <text class="time">{{ formattedTime }}</text>
  </view>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getListPreview } from '../utils/widget'
import { resolveCloudFileUrls } from '../utils/cloud-file-url'

const props = defineProps<{ post: any; section: any }>()
defineEmits(['tap'])

const fallbackAvatar = '/static/avatar-default.png'
const resolvedAvatarUrls = ref<Record<string, string>>({})

const preview = computed(() => {
  if (!props.post || !props.section) return []
  return getListPreview(props.post, props.section)
})

function avatarSrc(rawUrl: unknown) {
  const url = String(rawUrl || '').trim()
  if (!url) return fallbackAvatar
  return resolvedAvatarUrls.value[url] || url
}

watch(
  preview,
  async (fields) => {
    const urls = fields
      .flatMap((field: any) => field.type === 'attendance' ? (field.previewUsers || []) : [])
      .map((user: any) => String(user?.avatarUrl || '').trim())
      .filter(Boolean)
    if (urls.length === 0) return
    try {
      resolvedAvatarUrls.value = {
        ...resolvedAvatarUrls.value,
        ...(await resolveCloudFileUrls(urls)),
      }
    } catch {
      // Keep original URLs when temp URL resolution is unavailable.
    }
  },
  { immediate: true, deep: true },
)

const formattedTime = computed(() => {
  if (!props.post?.createdAt) return ''
  const d = new Date(props.post.createdAt)
  return `${d.getMonth() + 1}/${d.getDate()}`
})
</script>

<style lang="scss" scoped>
.post-card {
  background: $hh-color-surface;
  border-radius: $hh-radius-md;
  padding: $hh-space-md $hh-space-lg;
  margin-bottom: $hh-space-sm;
  box-shadow: $hh-shadow-card;
}

.field {
  display: flex;
  align-items: center;
  margin-bottom: $hh-space-xs;
}

.attendance-field {
  align-items: flex-start;
  justify-content: space-between;
  gap: $hh-space-sm;
}

.attendance-meta {
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
}

.attendance-avatars {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.avatar {
  width: 44rpx;
  height: 44rpx;
  border-radius: 50%;
  border: 2rpx solid #fff;
  margin-left: -10rpx;
  background: $hh-color-bg-sub;
}

.avatar:first-child {
  margin-left: 0;
}

.field-label {
  font-size: $hh-font-caption;
  color: $hh-color-text-mute;
  margin-right: $hh-space-sm;
  flex-shrink: 0;
}

.field-value {
  font-size: $hh-font-body;
  color: $hh-color-text;
}

.time {
  font-size: $hh-font-caption;
  color: $hh-color-text-mute;
  display: block;
  margin-top: $hh-space-sm;
  text-align: right;
}

.empty-preview {
  color: $hh-color-text-mute;
  font-size: $hh-font-caption;
}
</style>
