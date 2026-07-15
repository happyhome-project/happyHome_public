<template>
  <div class="collaboration-template-page" data-testid="collaboration-template-page">
    <div class="page-header">
      <div>
        <el-breadcrumb separator="/">
          <el-breadcrumb-item>超级管理员</el-breadcrumb-item>
          <el-breadcrumb-item>协作模板</el-breadcrumb-item>
        </el-breadcrumb>
        <h3>全局协作模板</h3>
      </div>
      <div class="header-actions">
        <el-button :loading="loading" @click="loadTemplates">刷新</el-button>
        <el-button type="primary" data-testid="collaboration-template-create" @click="openCreate">
          新建协作模板
        </el-button>
      </div>
    </div>

    <el-alert
      title="这里的模板会同时影响所有社群"
      description="社区管理员仍可管理自己社群内的帖子，但只有超级管理员可以新增、修改、停用或删除全局协作模板。已有帖子的模板不能做不兼容的控件结构变更。"
      type="warning"
      :closable="false"
      show-icon
      class="global-alert"
    />

    <el-table :data="templates" v-loading="loading" border>
      <el-table-column label="图标" width="76" align="center">
        <template #default="{ row }"><span class="template-icon">{{ row.icon || '·' }}</span></template>
      </el-table-column>
      <el-table-column prop="name" label="模板名称" min-width="180" />
      <el-table-column prop="systemKey" label="系统键" min-width="210" />
      <el-table-column prop="order" label="排序" width="90" />
      <el-table-column label="控件" width="90" align="center">
        <template #default="{ row }">{{ row.widgets?.length || 0 }}</template>
      </el-table-column>
      <el-table-column label="互动" min-width="150">
        <template #default="{ row }">
          <el-tag size="small" :type="row.enableComment ? 'success' : 'info'">评论{{ row.enableComment ? '开' : '关' }}</el-tag>
          <el-tag size="small" :type="row.enableLike ? 'success' : 'info'" class="inline-tag">点赞{{ row.enableLike ? '开' : '关' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
            {{ row.status === 'active' ? '已启用' : '已停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" min-width="310" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="openWidgets(row)">控件</el-button>
          <el-button size="small" @click="openEdit(row)">编辑</el-button>
          <el-button size="small" :type="row.status === 'active' ? 'warning' : 'success'" plain @click="toggleStatus(row)">
            {{ row.status === 'active' ? '停用' : '启用' }}
          </el-button>
          <el-button
            size="small"
            type="danger"
            plain
            :disabled="Boolean(row.protectedSystemKey)"
            :title="row.protectedSystemKey ? '内置模板不能删除' : ''"
            @click="deleteTemplate(row)"
          >删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="showEditor"
      :title="editingTemplateId ? '编辑全局协作模板' : '新建全局协作模板'"
      width="560px"
      :close-on-click-modal="false"
    >
      <el-form label-width="96px">
        <el-form-item label="模板名称" required>
          <el-input v-model="form.name" maxlength="40" show-word-limit placeholder="例如：邻里互助" />
        </el-form-item>
        <el-form-item label="入口图标">
          <el-input v-model="form.icon" maxlength="12" placeholder="例如：🤝" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.order" :min="0" :precision="0" />
        </el-form-item>
        <el-form-item label="允许评论"><el-switch v-model="form.enableComment" /></el-form-item>
        <el-form-item label="允许点赞"><el-switch v-model="form.enableLike" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditor = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showWidgetDialog"
      title="全局模板控件配置"
      width="min(1180px, calc(100vw - 48px))"
      top="6vh"
      :destroy-on-close="true"
      :close-on-click-modal="false"
    >
      <WidgetEditor
        v-if="showWidgetDialog"
        :key="widgetTemplateId"
        :collaboration-template-id="widgetTemplateId"
        embedded
        @saved="handleWidgetsSaved"
      />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import { ElMessageBox } from 'element-plus/es/components/message-box/index'
import { collaborationTemplateApi } from '../../api/cloud'
import WidgetEditor from '../CommunityAdmin/WidgetEditor.vue'

const templates = ref<any[]>([])
const loading = ref(false)
const saving = ref(false)
const showEditor = ref(false)
const showWidgetDialog = ref(false)
const editingTemplateId = ref('')
const widgetTemplateId = ref('')
const form = ref({
  name: '',
  icon: '',
  order: 0,
  enableComment: true,
  enableLike: true,
})

onMounted(loadTemplates)

async function loadTemplates() {
  loading.value = true
  try {
    const response = await collaborationTemplateApi.listAdmin()
    templates.value = response.templates || []
  } catch (error: any) {
    ElMessage.error(error?.message || '全局协作模板加载失败')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingTemplateId.value = ''
  form.value = {
    name: '',
    icon: '',
    order: templates.value.length,
    enableComment: true,
    enableLike: true,
  }
  showEditor.value = true
}

function openEdit(template: any) {
  editingTemplateId.value = String(template?._id || '')
  form.value = {
    name: String(template?.name || ''),
    icon: String(template?.icon || ''),
    order: Number(template?.order || 0),
    enableComment: template?.enableComment !== false,
    enableLike: template?.enableLike !== false,
  }
  showEditor.value = true
}

async function submit() {
  const name = form.value.name.trim()
  if (!name) {
    ElMessage.warning('请填写模板名称')
    return
  }
  saving.value = true
  try {
    if (editingTemplateId.value) {
      await collaborationTemplateApi.updateAdmin({
        templateId: editingTemplateId.value,
        ...form.value,
        name,
      })
      ElMessage.success('全局模板已更新')
    } else {
      await collaborationTemplateApi.createAdmin({ ...form.value, name })
      ElMessage.success('全局模板已创建，请继续配置控件')
    }
    showEditor.value = false
    await loadTemplates()
  } catch (error: any) {
    ElMessage.error(error?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

function openWidgets(template: any) {
  widgetTemplateId.value = String(template?._id || '')
  if (!widgetTemplateId.value) return
  showWidgetDialog.value = true
}

async function handleWidgetsSaved() {
  await loadTemplates()
}

async function toggleStatus(template: any) {
  const disabled = template?.status === 'active'
  try {
    if (disabled) {
      await ElMessageBox.confirm(
        `停用「${template.name}」后，所有社群都不能再用它发布新帖；历史帖子仍可查看和管理。`,
        '确认停用全局模板',
        { type: 'warning', confirmButtonText: '停用', cancelButtonText: '取消' },
      )
    }
    await collaborationTemplateApi.disableAdmin(String(template?._id || ''), disabled)
    ElMessage.success(disabled ? '模板已全局停用' : '模板已全局启用')
    await loadTemplates()
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(error?.message || '状态切换失败')
  }
}

async function deleteTemplate(template: any) {
  if (template?.protectedSystemKey) return
  try {
    await ElMessageBox.confirm(
      `确认删除全局模板「${template.name}」吗？只有从未产生帖子且非内置的模板可以删除。`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
    await collaborationTemplateApi.deleteAdmin(String(template?._id || ''))
    ElMessage.success('模板已删除')
    await loadTemplates()
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(error?.message || '删除失败')
  }
}
</script>

<style scoped>
.collaboration-template-page { padding: 0; }
.page-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 16px; }
.page-header h3 { margin: 10px 0 0; }
.header-actions { display: flex; gap: 10px; }
.global-alert { margin-bottom: 16px; }
.template-icon { font-size: 24px; }
.inline-tag { margin-left: 8px; }
</style>
