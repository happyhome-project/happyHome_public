<template>
  <canvas
    canvas-id="community-share-image-canvas"
    class="community-share-image-canvas"
    width="500"
    height="400"
  />
</template>

<script setup lang="ts">
import { getCurrentInstance, onMounted, ref, watch } from 'vue'
import { resolveCloudFileUrl } from '../utils/cloud-file-url'
import {
  COMMUNITY_AVATAR_BACKGROUND,
  COMMUNITY_AVATAR_FONT_WEIGHT,
  COMMUNITY_AVATAR_FOREGROUND,
  communityInitial,
} from '../utils/community-avatar'
import {
  buildCommunityShareImageKey,
  selectPreparedCommunityShareImage,
  type PreparedCommunityShareImage,
} from '../utils/community-share'
import { clientLog } from '../utils/client-log'

const CANVAS_ID = 'community-share-image-canvas'
const CANVAS_WIDTH = 500
const CANVAS_HEIGHT = 400
const INITIAL_FONT_SIZE = 160

const props = defineProps<{
  communityId?: string
  communityName?: string
  coverImage?: string
}>()

const emit = defineEmits<{
  'update:image-url': [imageUrl: string]
}>()

const instance = getCurrentInstance()
const prepared = ref<PreparedCommunityShareImage | null>(null)
let mounted = false
let preparationVersion = 0

function currentKey(): string {
  return buildCommunityShareImageKey({
    id: props.communityId,
    name: props.communityName,
    coverImage: props.coverImage,
  })
}

function publish(key: string, imageUrl: string) {
  prepared.value = { key, imageUrl }
  emit('update:image-url', selectPreparedCommunityShareImage(currentKey(), prepared.value))
}

function probeImage(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    uni.getImageInfo({
      src,
      success: () => resolve(),
      fail: reject,
    })
  })
}

function exportInitialImage(name: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const context = uni.createCanvasContext(CANVAS_ID, instance?.proxy as any)
    context.setFillStyle(COMMUNITY_AVATAR_BACKGROUND)
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    context.setFillStyle(COMMUNITY_AVATAR_FOREGROUND)
    context.setTextAlign('center')
    context.setTextBaseline('middle')
    context.setFontSize(INITIAL_FONT_SIZE)
    ;(context as any).font = `normal ${COMMUNITY_AVATAR_FONT_WEIGHT} ${INITIAL_FONT_SIZE}px sans-serif`
    context.fillText(communityInitial(name), CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2)
    context.draw(false, () => {
      uni.canvasToTempFilePath({
        canvasId: CANVAS_ID,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        destWidth: CANVAS_WIDTH,
        destHeight: CANVAS_HEIGHT,
        fileType: 'png',
        success: (result) => resolve(result.tempFilePath),
        fail: reject,
      }, instance?.proxy as any)
    })
  })
}

async function prepare() {
  if (!mounted) return
  const version = ++preparationVersion
  const key = currentKey()
  const coverImage = String(props.coverImage || '').trim()
  const name = String(props.communityName || '').trim()
  prepared.value = null
  emit('update:image-url', '')

  try {
    if (coverImage) {
      const resolvedCover = await resolveCloudFileUrl(coverImage)
      if (resolvedCover) {
        await probeImage(resolvedCover)
        if (version === preparationVersion && key === currentKey()) publish(key, resolvedCover)
        return
      }
    }
    const initialImage = await exportInitialImage(name)
    if (version === preparationVersion && key === currentKey()) publish(key, initialImage)
  } catch (error) {
    if (coverImage) {
      try {
        const initialImage = await exportInitialImage(name)
        if (version === preparationVersion && key === currentKey()) publish(key, initialImage)
        return
      } catch (fallbackError) {
        clientLog('warn', 'community.share.initial.image.fail', { error: fallbackError })
      }
    } else {
      clientLog('warn', 'community.share.initial.image.fail', { error })
    }
  }
}

watch(
  () => [props.communityId, props.communityName, props.coverImage],
  () => { void prepare() },
)

onMounted(() => {
  mounted = true
  void prepare()
})
</script>

<style scoped>
.community-share-image-canvas {
  position: fixed;
  left: -10000px;
  top: -10000px;
  width: 500px;
  height: 400px;
  pointer-events: none;
}
</style>
