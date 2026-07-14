<template>
  <div class="topic-page">
    <div class="page-header">
      <div><el-button @click="$router.back()">返回</el-button><h2>沉淀区话题</h2></div>
      <el-button type="primary" @click="openAdd">添加话题</el-button>
    </div>
    <el-alert :closable="false" type="info" title="首页先保留历史沉淀板块对应的话题，再按这里的手动排序补充，剩余位置由热门话题填充。" />
    <el-table :data="topics" v-loading="loading" border>
      <el-table-column prop="displayName" label="话题" min-width="180" />
      <el-table-column label="来源" min-width="210">
        <template #default="{ row }">
          <el-tag v-if="row.origins.includes('legacy')" type="success">历史板块</el-tag>
          <el-tag v-if="row.origins.includes('admin')" type="primary">手动配置</el-tag>
          <el-tag v-if="row.origins.includes('organic')" type="info">帖子热门</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="首页展示" width="120"><template #default="{ row }"><el-switch v-model="row.enabled" @change="saveRow(row)" /></template></el-table-column>
      <el-table-column label="手动顺序" width="150"><template #default="{ row }"><el-input-number v-model="row.adminOrder" :min="0" controls-position="right" @change="saveRow(row)" /></template></el-table-column>
      <el-table-column label="操作" width="180"><template #default="{ row }"><el-button size="small" @click="openEdit(row)">改名</el-button><el-button v-if="row.origins.includes('admin')" size="small" type="danger" @click="removeManual(row)">移除手动配置</el-button></template></el-table-column>
    </el-table>
    <el-dialog v-model="dialogVisible" :title="editing ? '编辑话题' : '添加话题'" width="460px">
      <el-form label-width="80px"><el-form-item label="话题名称"><el-input v-model="form.displayName" maxlength="24" /></el-form-item><el-form-item label="顺序"><el-input-number v-model="form.adminOrder" :min="0" /></el-form-item></el-form>
      <template #footer><el-button @click="dialogVisible=false">取消</el-button><el-button type="primary" :loading="saving" @click="submit">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { archiveTopicApi, type ArchiveTopicConfig } from '../../api/cloud'
const route = useRoute()
const communityId = String(route.params.communityId || '')
const topics = ref<ArchiveTopicConfig[]>([])
const loading = ref(false), saving = ref(false), dialogVisible = ref(false)
const editing = ref<ArchiveTopicConfig | null>(null)
const form = reactive({ displayName: '', adminOrder: 0 })
async function load() { loading.value = true; try { topics.value = (await archiveTopicApi.list(communityId)).topics || [] } finally { loading.value = false } }
function openAdd() { editing.value = null; form.displayName = ''; form.adminOrder = topics.value.length; dialogVisible.value = true }
function openEdit(row: ArchiveTopicConfig) { editing.value = row; form.displayName = row.displayName; form.adminOrder = row.adminOrder || 0; dialogVisible.value = true }
async function submit() { if (!form.displayName.trim()) return; saving.value = true; try { await archiveTopicApi.save({ communityId, topicKey: editing.value?.topicKey, displayName: form.displayName, adminOrder: form.adminOrder }); dialogVisible.value = false; ElMessage.success('已保存'); await load() } finally { saving.value = false } }
async function saveRow(row: ArchiveTopicConfig) { await archiveTopicApi.save({ communityId, topicKey: row.topicKey, displayName: row.displayName, enabled: row.enabled, adminOrder: row.adminOrder }); ElMessage.success('已更新') }
async function removeManual(row: ArchiveTopicConfig) { await ElMessageBox.confirm('只移除手动配置来源；历史或帖子来源仍会保留。', '确认移除'); await archiveTopicApi.save({ communityId, topicKey: row.topicKey, displayName: row.displayName, removeAdmin: true }); await load() }
onMounted(load)
</script>

<style scoped>.topic-page{padding:24px}.page-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}.page-header>div{display:flex;align-items:center;gap:14px}.el-alert{margin-bottom:18px}.el-tag+.el-tag{margin-left:6px}</style>
