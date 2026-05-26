<template>
  <div data-testid="admin-account-page">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h3>管理员账号</h3>
      <div style="display: flex; gap: 8px;">
        <el-button data-testid="admin-create-entry" type="primary" @click="openCreate">新建账号</el-button>
        <el-button @click="load" :loading="loading">刷新</el-button>
      </div>
    </div>

    <el-table :data="accounts" v-loading="loading" data-testid="admin-account-table">
      <el-table-column prop="username" label="用户名" min-width="160" />
      <el-table-column label="角色" width="140">
        <template #default="{ row }">
          <el-tag :type="row.role === 'superAdmin' ? 'danger' : 'primary'">
            {{ row.role === 'superAdmin' ? '超级管理员' : '社区管理员' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="userId" label="绑定微信 openId" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">
          <span v-if="row.userId">{{ row.userId }}</span>
          <span v-else style="color: #c0c4cc;">未绑定</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="120">
        <template #default="{ row }">
          <el-tag v-if="row.status === 'active'" type="success">启用</el-tag>
          <el-tag v-else type="info">停用</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="保护原因" min-width="180">
        <template #default="{ row }">
          <el-tag v-if="row.creatorCommunityCount > 0" type="warning" effect="plain">
            社区创建者账号
          </el-tag>
          <span v-else style="color: #c0c4cc;">-</span>
        </template>
      </el-table-column>
      <el-table-column prop="createdAt" label="创建时间" width="200" />
      <el-table-column label="操作" width="360">
        <template #default="{ row }">
          <el-button size="small" @click="openReset(row)">重置密码</el-button>
          <el-button size="small" @click="openBind(row)">绑定微信</el-button>
          <el-tooltip
            :disabled="canDelete(row)"
            content="该账号是未删除社区的创建者账号，需先永久删除对应社区后才能删除账号"
            placement="top"
          >
            <span>
              <el-button
                size="small"
                type="danger"
                :disabled="!canDelete(row)"
                @click="deleteAccount(row)"
              >删除</el-button>
            </span>
          </el-tooltip>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="showCreate" title="新建管理员账号" width="440px">
      <el-form :model="createForm" label-width="100px">
        <el-form-item label="用户名" required>
          <el-input data-testid="admin-create-username" v-model="createForm.username" maxlength="32" />
        </el-form-item>
        <el-form-item label="密码" required>
          <el-input data-testid="admin-create-password" v-model="createForm.password" type="password" show-password />
        </el-form-item>
        <el-form-item label="角色" required>
          <el-radio-group v-model="createForm.role">
            <el-radio value="communityAdmin">社区管理员</el-radio>
            <el-radio value="superAdmin">超级管理员</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="绑定 openId">
          <el-input v-model="createForm.userId" placeholder="可留空，后续再绑定" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button data-testid="admin-create-submit" type="primary" :loading="submitting" @click="submitCreate">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showReset" title="重置密码" width="420px">
      <el-form>
        <el-form-item label="新密码">
          <el-input v-model="resetForm.password" type="password" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showReset = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitReset">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showBind" title="绑定微信 openId" width="420px">
      <el-form>
        <el-form-item label="openId">
          <el-input v-model="bindForm.openId" placeholder="用户的微信 openId" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showBind = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitBind">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { adminAccountApi } from '../../api/cloud'
import { useAuthStore } from '../../stores/auth'

const accounts = ref<any[]>([])
const loading = ref(false)
const submitting = ref(false)
const auth = useAuthStore()

const showCreate = ref(false)
const showReset = ref(false)
const showBind = ref(false)

const createForm = ref({ username: '', password: '', role: 'communityAdmin' as 'superAdmin' | 'communityAdmin', userId: '' })
const resetForm = ref({ accountId: '', password: '' })
const bindForm = ref({ accountId: '', openId: '' })

onMounted(load)

async function load() {
  loading.value = true
  try {
    const res = await adminAccountApi.list() as any
    accounts.value = res.accounts || []
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  createForm.value = { username: '', password: '', role: 'communityAdmin', userId: '' }
  showCreate.value = true
}

async function submitCreate() {
  if (!createForm.value.username.trim()) return ElMessage.warning('用户名不能为空')
  if (createForm.value.password.length < 6) return ElMessage.warning('密码至少 6 位')
  submitting.value = true
  try {
    await adminAccountApi.create({
      username: createForm.value.username.trim(),
      password: createForm.value.password,
      role: createForm.value.role,
      userId: createForm.value.userId.trim() || undefined,
    })
    ElMessage.success('已创建')
    showCreate.value = false
    await load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '创建失败')
  } finally {
    submitting.value = false
  }
}

function openReset(row: any) {
  resetForm.value = { accountId: row._id, password: '' }
  showReset.value = true
}

async function submitReset() {
  if (resetForm.value.password.length < 6) return ElMessage.warning('密码至少 6 位')
  submitting.value = true
  try {
    await adminAccountApi.resetPassword(resetForm.value.accountId, resetForm.value.password)
    ElMessage.success('已重置；该账号所有 session 已踢下线')
    showReset.value = false
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '重置失败')
  } finally {
    submitting.value = false
  }
}

function openBind(row: any) {
  bindForm.value = { accountId: row._id, openId: row.userId || '' }
  showBind.value = true
}

async function submitBind() {
  submitting.value = true
  try {
    await adminAccountApi.bindWechat(bindForm.value.accountId, bindForm.value.openId.trim())
    ElMessage.success('已保存')
    showBind.value = false
    await auth.fetchMe()
    await load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '保存失败')
  } finally {
    submitting.value = false
  }
}

function canDelete(row: any) {
  return Number(row.creatorCommunityCount || 0) === 0
}

async function deleteAccount(row: any) {
  if (!canDelete(row)) {
    ElMessage.warning('该账号是未删除社区的创建者账号，不能删除')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认删除账号「${row.username}」？该账号所有 session 将被踢下线，此操作不可恢复。`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch { return }
  try {
    await adminAccountApi.delete(row._id)
    ElMessage.success('已删除')
    await load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '删除失败')
  }
}
</script>
