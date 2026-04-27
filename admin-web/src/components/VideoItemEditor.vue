<template>
  <el-card class="video-item-editor" shadow="never">
    <template #header>
      <div class="card-header">
        <span class="title">视频条目 #{{ index + 1 }}</span>
        <el-button type="danger" size="small" link @click="$emit('remove')">删除此条</el-button>
      </div>
    </template>

    <el-form label-width="120px" size="small">
      <el-form-item label="来源">
        <el-radio-group v-model="local.source" @change="onSourceChange">
          <el-radio value="cos">自托管视频</el-radio>
          <el-radio value="channels_feed">视频号 Feed</el-radio>
          <el-radio value="channels_live">视频号直播</el-radio>
          <el-radio value="miniprogram">其他小程序</el-radio>
          <el-radio value="h5">H5 链接</el-radio>
          <el-radio value="app_link">App 链接（复制）</el-radio>
        </el-radio-group>
      </el-form-item>

      <el-form-item label="标题" required>
        <el-input v-model="local.title" placeholder="必填，将显示在视频卡片上" />
      </el-form-item>
      <el-form-item label="时长（秒）">
        <el-input-number v-model="local.duration" :min="0" :precision="0" placeholder="可选" />
      </el-form-item>
      <el-form-item label="简介">
        <el-input v-model="local.description" type="textarea" :rows="2" placeholder="可选" />
      </el-form-item>
      <el-form-item label="封面图">
        <VideoUploader v-model="local.cover" kind="cover" />
      </el-form-item>

      <template v-if="local.source === 'cos'">
        <el-form-item label="视频文件" required>
          <VideoUploader v-model="local.fileID" kind="video" />
        </el-form-item>
        <el-form-item label="允许下载到相册">
          <el-switch v-model="local.allowDownload" />
        </el-form-item>
        <el-form-item label="允许分享给好友">
          <el-switch v-model="local.allowShare" />
        </el-form-item>
      </template>

      <template v-else-if="local.source === 'channels_feed'">
        <el-form-item label="finderUserName" required>
          <el-input v-model="local.finderUserName" placeholder="sph 或 finder 开头的视频号 ID" />
        </el-form-item>
        <el-form-item label="feedId" required>
          <el-input v-model="local.feedId" placeholder="视频 ID（export/... 格式）" />
        </el-form-item>
        <el-form-item label="nonceId">
          <el-input v-model="local.nonceId" placeholder="可选" />
        </el-form-item>
      </template>

      <template v-else-if="local.source === 'channels_live'">
        <el-form-item label="finderUserName" required>
          <el-input v-model="local.finderUserName" />
        </el-form-item>
        <el-form-item label="nonceId" required>
          <el-input v-model="local.nonceId" />
        </el-form-item>
      </template>

      <template v-else-if="local.source === 'miniprogram'">
        <el-alert
          type="warning"
          :closable="false"
          show-icon
          style="margin-bottom: 12px;"
          title="此 appId 须先加入小程序后台「跳转白名单」"
          description="否则用户点击会失败。在 manifest.json 的 mp-weixin.navigateToMiniProgramAppIdList 也要补上。"
        />
        <el-form-item label="appId" required>
          <el-input v-model="local.appId" placeholder="目标小程序 appId（wx 开头）" />
        </el-form-item>
        <el-form-item label="path">
          <el-input v-model="local.path" placeholder="pages/xxx/index?id=1（可选）" />
        </el-form-item>
        <el-form-item label="环境">
          <el-select v-model="local.envVersion" style="width: 200px;">
            <el-option label="release（线上版）" value="release" />
            <el-option label="trial（体验版）" value="trial" />
            <el-option label="develop（开发版）" value="develop" />
          </el-select>
        </el-form-item>
      </template>

      <el-form-item v-else-if="local.source === 'h5'" label="H5 URL" required>
        <el-input v-model="local.url" placeholder="https://..." />
      </el-form-item>

      <template v-else-if="local.source === 'app_link'">
        <el-alert
          type="info"
          :closable="false"
          show-icon
          style="margin-bottom: 12px;"
          title="原生 App 链接"
          description="微信小程序无法直接拉起第三方 App。点击此条目时会复制链接到剪贴板，并提示用户去对应 App 粘贴打开。"
        />
        <el-form-item label="App URL" required>
          <el-input v-model="local.url" placeholder="https://... 或 deeplink" />
        </el-form-item>
        <el-form-item label="提示文案">
          <el-input v-model="local.hint" placeholder="如：链接已复制，请到抖音 App 粘贴打开" />
        </el-form-item>
      </template>
    </el-form>
  </el-card>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue'
import VideoUploader from './VideoUploader.vue'

const props = defineProps<{
  modelValue: any
  index: number
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: any): void
  (e: 'remove'): void
}>()

const local = reactive<Record<string, any>>({ ...(props.modelValue || {}) })

const COMMON_KEYS = ['itemId', 'source', 'title', 'cover', 'duration', 'description']

watch(local, () => emit('update:modelValue', { ...local }), { deep: true })

function onSourceChange() {
  for (const key of Object.keys(local)) {
    if (!COMMON_KEYS.includes(key)) delete local[key]
  }
  if (local.source === 'cos') {
    local.allowDownload = true
    local.allowShare = true
    local.fileID = ''
  } else if (local.source === 'miniprogram') {
    local.envVersion = 'release'
  }
}
</script>

<style scoped>
.video-item-editor { margin-bottom: 16px; }
.card-header { display: flex; justify-content: space-between; align-items: center; }
.title { font-weight: 600; }
</style>
