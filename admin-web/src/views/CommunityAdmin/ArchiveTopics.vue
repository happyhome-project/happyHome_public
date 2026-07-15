<template>
  <div class="topic-page">
    <div class="page-header"><h2>沉淀区话题</h2><el-button type="primary" @click="openAdd">添加话题</el-button></div>
    <el-alert :closable="false" type="info" title="拖动左侧把手即可调整首页顺序；首页展示“全部”及最多 7 个已开启话题。" />
    <div v-loading="loading" class="topic-list">
      <draggable v-model="topics" item-key="topicKey" handle=".drag-handle" @start="beginDrag" @end="saveOrder">
        <template #item="{ element: row, index }">
          <div class="topic-row">
            <button class="drag-handle" type="button" aria-label="拖动排序">⠿</button>
            <div class="topic-name">{{ row.displayName }}</div>
            <div class="topic-count">{{ row.recentPostCount || 0 }} 篇帖子</div>
            <label class="enabled-label">首页展示 <el-switch :model-value="row.enabled" @change="setEnabled(row, $event)" /></label>
            <el-button size="small" :disabled="index === 0" @click="move(index, -1)">上移</el-button>
            <el-button size="small" :disabled="index === topics.length - 1" @click="move(index, 1)">下移</el-button>
            <el-button size="small" @click="openEdit(row)">改名</el-button>
            <el-button size="small" type="danger" @click="remove(row)">删除</el-button>
          </div>
        </template>
      </draggable>
      <el-empty v-if="!loading && topics.length === 0" description="暂无话题" />
    </div>
    <el-dialog v-model="dialogVisible" :title="editing ? '改名' : '添加话题'" width="460px">
      <el-form label-width="80px"><el-form-item label="话题名称"><el-input v-model="form.displayName" maxlength="20" /></el-form-item></el-form>
      <template #footer><el-button @click="dialogVisible=false">取消</el-button><el-button type="primary" :loading="saving" @click="submit">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import draggable from 'vuedraggable'
import { archiveTopicApi, type ArchiveTopicConfig } from '../../api/cloud'

const route = useRoute()
const communityId = String(route.params.communityId || '')
const topics = ref<ArchiveTopicConfig[]>([])
const revision = ref(0)
const loading = ref(false), saving = ref(false), dialogVisible = ref(false)
const editing = ref<ArchiveTopicConfig | null>(null)
const form = reactive({ displayName: '' })
let orderSnapshot: ArchiveTopicConfig[] = []

async function load() {
  loading.value = true
  try { const result = await archiveTopicApi.list(communityId); topics.value = result.topics || []; revision.value = result.orderRevision || 0 }
  finally { loading.value = false }
}
function openAdd() { editing.value = null; form.displayName = ''; dialogVisible.value = true }
function openEdit(row: ArchiveTopicConfig) { editing.value = row; form.displayName = row.displayName; dialogVisible.value = true }
async function submit() {
  if (!form.displayName.trim()) return
  saving.value = true
  try {
    if (editing.value) await archiveTopicApi.rename({ communityId, topicKey: editing.value.topicKey, displayName: form.displayName })
    else await archiveTopicApi.create({ communityId, displayName: form.displayName })
    dialogVisible.value = false; ElMessage.success('已保存'); await load()
  } finally { saving.value = false }
}
async function setEnabled(row: ArchiveTopicConfig, value: string | number | boolean) {
  const previous = row.enabled
  row.enabled = value !== false
  try { await archiveTopicApi.setEnabled({ communityId, topicKey: row.topicKey, enabled: row.enabled }) }
  catch (error) { row.enabled = previous; ElMessage.error('更新失败，已恢复原状态'); throw error }
}
function beginDrag() { orderSnapshot = topics.value.slice() }
async function persistOrder(snapshot: ArchiveTopicConfig[]) {
  try {
    const result = await archiveTopicApi.reorder({ communityId, orderedTopicKeys: topics.value.map(topic => topic.topicKey), expectedRevision: revision.value })
    revision.value = result.orderRevision
  } catch (error) {
    topics.value = snapshot
    ElMessage.error('排序保存失败，已恢复原顺序')
    await load()
  }
}
function saveOrder() { void persistOrder(orderSnapshot) }
function move(index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= topics.value.length) return
  const snapshot = topics.value.slice()
  const [item] = topics.value.splice(index, 1)
  topics.value.splice(target, 0, item)
  void persistOrder(snapshot)
}
async function remove(row: ArchiveTopicConfig) {
  await ElMessageBox.confirm(
    `删除“${row.displayName}”后，它会立即从首页和后台列表消失。帖子和帖子里的 #话题不会删除，帖子仍会出现在“全部”中；以后再次使用同名话题时会作为新话题重新启用。`,
    '确认删除话题', { type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger' },
  )
  try { const result = await archiveTopicApi.delete({ communityId, topicKey: row.topicKey, expectedRevision: revision.value }); revision.value = result.orderRevision; topics.value = topics.value.filter(topic => topic.topicKey !== row.topicKey) }
  catch (error) { ElMessage.error('删除失败，列表已重新加载'); await load(); throw error }
}
onMounted(load)
</script>

<style scoped>
.topic-page{padding:24px}.page-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}.el-alert{margin-bottom:18px}.topic-list{min-height:160px;border:1px solid #ebeef5;border-radius:4px;background:#fff}.topic-row{display:flex;align-items:center;gap:12px;min-height:64px;padding:0 18px;border-bottom:1px solid #ebeef5}.drag-handle{border:0;background:transparent;color:#909399;font-size:22px;cursor:grab}.drag-handle:active{cursor:grabbing}.topic-name{min-width:180px;font-weight:500}.topic-count{flex:1;color:#909399}.enabled-label{display:flex;align-items:center;gap:8px;color:#606266}
</style>
