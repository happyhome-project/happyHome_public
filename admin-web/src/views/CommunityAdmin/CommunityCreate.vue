<template>
  <div data-testid="community-create-page" style="max-width: 720px;">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h3>创建社区</h3>
      <el-button @click="$router.back()">返回</el-button>
    </div>
    <el-alert
      v-if="authStore.isCommunityAdmin"
      type="info"
      show-icon
      :closable="false"
      style="margin-bottom: 16px;"
      title="提交后会进入待审批状态，超级管理员审批通过后才会在小程序端展示。"
    />
    <el-form :model="form" label-width="100px" @submit.prevent="submit">
      <el-form-item label="社区名称" required>
        <el-input data-testid="create-name" v-model="form.name" maxlength="30" show-word-limit />
      </el-form-item>
      <el-form-item label="简介" required>
        <el-input data-testid="create-description" v-model="form.description" type="textarea" :rows="3" maxlength="200" show-word-limit />
      </el-form-item>
      <el-form-item label="封面图 URL">
        <el-input data-testid="create-cover" v-model="form.coverImage" placeholder="cloud:// 或 https:// 均可，稍后可在小程序端替换" />
      </el-form-item>
      <el-form-item label="地址">
        <el-input data-testid="create-address" v-model="form.location.address" />
      </el-form-item>
      <el-form-item label="加入方式">
        <el-radio-group v-model="form.joinType">
          <el-radio value="open">自由加入</el-radio>
          <el-radio value="approval">需审批</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item>
        <el-button data-testid="create-submit" type="primary" native-type="submit" :loading="submitting">
          {{ authStore.isSuperAdmin ? '直接创建（会立即启用）' : '提交申请' }}
        </el-button>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus/es/components/message/index'
import { communityApi } from '../../api/cloud'
import { useAuthStore } from '../../stores/auth'

const router = useRouter()
const authStore = useAuthStore()
const submitting = ref(false)

const form = ref({
  name: '',
  description: '',
  coverImage: '',
  location: { address: '', lat: 0, lng: 0 },
  joinType: 'open' as 'open' | 'approval',
})

async function submit() {
  if (submitting.value) return
  if (!form.value.name.trim() || !form.value.description.trim()) {
    ElMessage.warning('请填写社区名称和简介')
    return
  }
  submitting.value = true
  try {
    await communityApi.createAdmin({
      name: form.value.name.trim(),
      description: form.value.description.trim(),
      coverImage: form.value.coverImage.trim(),
      location: { ...form.value.location },
      joinType: form.value.joinType,
    })
    ElMessage.success(authStore.isSuperAdmin ? '创建成功' : '已提交，等待审批')
    router.push({ name: 'communities' })
  } catch (e: any) {
    const msg = e?.response?.data?.error || e?.message || '创建失败'
    ElMessage.error(msg)
  } finally {
    submitting.value = false
  }
}
</script>
