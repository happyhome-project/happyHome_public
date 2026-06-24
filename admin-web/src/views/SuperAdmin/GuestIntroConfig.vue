<template>
  <div class="guest-intro-config">
    <div class="page-header">
      <div>
        <h2>样板社群引导</h2>
        <p>配置未登录用户第一次看到样板社群时的弹窗文案。已登录用户不会看到这个弹窗。</p>
      </div>
      <div class="header-actions">
        <el-button @click="load" :loading="loading">刷新</el-button>
        <el-button @click="resetToDefault" :disabled="loading || saving">恢复默认</el-button>
        <el-button type="primary" @click="save(false)" :loading="saving">保存文案</el-button>
        <el-button type="warning" @click="save(true)" :loading="saving">发布新版本</el-button>
      </div>
    </div>

    <div class="config-grid">
      <el-card shadow="never" class="form-card" v-loading="loading">
        <el-form label-width="116px" label-position="left">
          <el-form-item label="启用弹窗">
            <el-switch v-model="form.enabled" />
            <span class="form-tip">关闭后，未登录用户也不会看到这段引导。</span>
          </el-form-item>
          <el-form-item label="当前版本">
            <el-tag effect="plain">{{ form.version }}</el-tag>
            <span class="form-tip">保存文案不会改变版本；发布新版本会让未登录且看过旧版本的人重新看到。</span>
          </el-form-item>
          <el-form-item label="标题" required>
            <el-input v-model="form.title" maxlength="40" show-word-limit />
          </el-form-item>
          <el-form-item label="正文" required>
            <el-input
              v-model="form.body"
              type="textarea"
              :rows="4"
              maxlength="140"
              show-word-limit
            />
          </el-form-item>
          <el-form-item label="三条说明" required>
            <div class="feature-editor">
              <div v-for="(item, index) in form.features" :key="item.key || index" class="feature-row">
                <el-input v-model="item.label" maxlength="6" show-word-limit class="feature-label" />
                <el-input v-model="item.text" maxlength="28" show-word-limit />
              </div>
            </div>
          </el-form-item>
          <el-form-item label="主按钮" required>
            <el-input v-model="form.primaryActionText" maxlength="14" show-word-limit />
          </el-form-item>
          <el-form-item label="次按钮" required>
            <el-input v-model="form.secondaryActionText" maxlength="18" show-word-limit />
          </el-form-item>
        </el-form>
      </el-card>

      <div class="preview-wrap">
        <div class="phone-preview">
          <div class="preview-card">
            <div class="preview-title">{{ form.title }}</div>
            <div class="preview-body">{{ form.body }}</div>
            <div class="preview-list">
              <div v-for="item in form.features" :key="item.key" class="preview-row">
                <span class="preview-label">{{ item.label }}</span>
                <span class="preview-text">{{ item.text }}</span>
              </div>
            </div>
            <button class="preview-primary" type="button">{{ form.primaryActionText }}</button>
            <button class="preview-secondary" type="button">{{ form.secondaryActionText }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import { ElMessageBox } from 'element-plus/es/components/message-box/index'
import { appConfigApi, type GuestIntroConfig } from '../../api/cloud'
import { DEFAULT_GUEST_INTRO_CONFIG } from '../../../../cloud/shared/guest-intro-config'

const loading = ref(false)
const saving = ref(false)
const form = ref<GuestIntroConfig>(cloneConfig(DEFAULT_GUEST_INTRO_CONFIG))

function cloneConfig(config: GuestIntroConfig): GuestIntroConfig {
  return {
    ...config,
    features: config.features.map((item) => ({ ...item })),
  }
}

function normalizeFormForSave(): GuestIntroConfig {
  return {
    ...form.value,
    title: form.value.title.trim(),
    body: form.value.body.trim(),
    primaryActionText: form.value.primaryActionText.trim(),
    secondaryActionText: form.value.secondaryActionText.trim(),
    features: form.value.features.map((item) => ({
      key: item.key.trim(),
      label: item.label.trim(),
      text: item.text.trim(),
    })),
  }
}

function validate(config: GuestIntroConfig): boolean {
  if (!config.title) return warn('标题不能为空')
  if (!config.body) return warn('正文不能为空')
  if (!config.primaryActionText) return warn('主按钮不能为空')
  if (!config.secondaryActionText) return warn('次按钮不能为空')
  if (config.features.length !== 3) return warn('说明必须保持三条')
  if (config.features.some((item) => !item.label || !item.text)) return warn('三条说明的标签和内容都不能为空')
  return true
}

function warn(message: string): false {
  ElMessage.warning(message)
  return false
}

async function load() {
  loading.value = true
  try {
    const result = await appConfigApi.getGuestIntro()
    form.value = cloneConfig(result.config)
  } finally {
    loading.value = false
  }
}

function resetToDefault() {
  form.value = cloneConfig(DEFAULT_GUEST_INTRO_CONFIG)
}

async function save(publishNewVersion: boolean) {
  const payload = normalizeFormForSave()
  if (!validate(payload)) return
  if (publishNewVersion) {
    try {
      await ElMessageBox.confirm(
        '发布新版本后，未登录且看过旧版本的用户会再次看到弹窗；已登录用户仍然不会看到。',
        '发布新版本',
        { type: 'warning', confirmButtonText: '发布', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
  }

  saving.value = true
  try {
    const result = await appConfigApi.updateGuestIntro(payload, publishNewVersion)
    form.value = cloneConfig(result.config)
    ElMessage.success(publishNewVersion ? '已发布新版本' : '已保存文案')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.guest-intro-config {
  padding: 24px;
}
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 20px;
}
.page-header h2 {
  margin: 0 0 8px;
  font-size: 24px;
  color: #1f2937;
}
.page-header p {
  margin: 0;
  color: #6b7280;
  line-height: 1.6;
}
.header-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
.config-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 22px;
  align-items: start;
}
.form-card {
  min-width: 0;
}
.form-tip {
  margin-left: 12px;
  color: #8a8f98;
  font-size: 13px;
}
.feature-editor {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.feature-row {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 10px;
}
.preview-wrap {
  position: sticky;
  top: 20px;
}
.phone-preview {
  width: 360px;
  min-height: 640px;
  padding: 54px 18px;
  border-radius: 30px;
  background: #d8d2ca;
  box-shadow: 0 22px 60px rgba(15, 23, 42, 0.16);
}
.preview-card {
  padding: 24px 18px 20px;
  border-radius: 18px;
  background: #fdfbf8;
  box-shadow: 0 12px 36px rgba(30, 26, 22, 0.16);
}
.preview-title {
  color: #1e1a16;
  font-size: 21px;
  font-weight: 700;
  line-height: 1.32;
}
.preview-body {
  margin-top: 10px;
  color: #514c48;
  font-size: 14px;
  line-height: 1.75;
}
.preview-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-top: 16px;
}
.preview-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 34px;
  padding: 6px 10px;
  border-radius: 9px;
  background: #ece9e5;
}
.preview-label {
  flex: 0 0 auto;
  min-width: 48px;
  color: #1d4e2b;
  font-weight: 700;
  font-size: 13px;
}
.preview-text {
  min-width: 0;
  color: #514c48;
  font-size: 13px;
}
.preview-primary,
.preview-secondary {
  width: 100%;
  height: 43px;
  border: 0;
  font-weight: 700;
  cursor: default;
}
.preview-primary {
  margin-top: 18px;
  border-radius: 24px;
  background: #1e1a16;
  color: #fdfbf8;
}
.preview-secondary {
  margin-top: 8px;
  background: transparent;
  color: #1d4e2b;
}

@media (max-width: 980px) {
  .page-header {
    flex-direction: column;
  }
  .config-grid {
    grid-template-columns: 1fr;
  }
  .preview-wrap {
    position: static;
  }
}
</style>
