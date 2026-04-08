<template>
  <div class="widget-editor">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h3>控件配置</h3>
      <div>
        <el-button @click="addWidget">+ 添加控件</el-button>
        <el-button type="primary" @click="save" :loading="saving" :disabled="listCount > 3" style="margin-left: 8px;">保存</el-button>
      </div>
    </div>

    <el-alert
      v-if="listCount > 3"
      title="列表显示字段不能超过3个"
      type="error"
      style="margin-bottom: 16px;"
    />

    <draggable v-model="widgets" item-key="widgetId" handle=".drag-handle">
      <template #item="{ element: widget }">
        <el-card class="widget-card" style="margin-bottom: 12px;">
          <div style="display: flex; align-items: flex-start; gap: 12px;">
            <div class="drag-handle" style="cursor: grab; font-size: 20px; color: #ccc; padding-top: 4px;">⠿</div>
            <el-form label-width="120px" style="flex: 1;">
              <el-form-item label="控件类型">
                <el-select v-model="widget.type" :disabled="!widget._isNew" style="width: 200px;">
                  <el-option label="短文字" value="short_text" />
                  <el-option label="一句话简介" value="summary" />
                  <el-option label="日期时间" value="datetime" />
                  <el-option label="数字" value="number" />
                  <el-option label="图片组" value="image_group" />
                  <el-option label="富文本" value="rich_text" />
                  <el-option label="地图位置" value="location" />
                </el-select>
              </el-form-item>
              <el-form-item label="标签名">
                <el-input v-model="widget.label" style="width: 200px;" />
              </el-form-item>
              <el-form-item label="fieldKey">
                <el-input v-model="widget.fieldKey" style="width: 200px;" placeholder="可读标识" />
              </el-form-item>
              <el-form-item label="必填">
                <el-switch v-model="widget.required" />
              </el-form-item>
              <el-form-item label="在列表显示">
                <el-switch
                  v-model="widget.showInList"
                  :disabled="!isListDisplayable(widget.type)"
                />
                <span v-if="!isListDisplayable(widget.type)" style="margin-left: 8px; color: #999; font-size: 12px;">该类型不支持列表展示</span>
              </el-form-item>
            </el-form>
            <el-button type="danger" size="small" @click="removeWidget(widget)" style="margin-top: 4px;">删除</el-button>
          </div>
        </el-card>
      </template>
    </draggable>

    <el-empty v-if="widgets.length === 0" description="暂无控件，点击「添加控件」开始配置" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import draggable from 'vuedraggable'
import { sectionApi } from '../../api/cloud'
import { LIST_DISPLAYABLE_TYPES } from '../../../../cloud/shared/types'
import { v4 as uuidv4 } from 'uuid'
import { ElMessage } from 'element-plus'

const route = useRoute()
const sectionId = route.params.sectionId as string
const communityId = route.query.communityId as string
const widgets = ref<any[]>([])
const saving = ref(false)

const listCount = computed(() => widgets.value.filter(w => w.showInList).length)

function isListDisplayable(type: string) {
  return LIST_DISPLAYABLE_TYPES.includes(type as any)
}

onMounted(async () => {
  try {
    const res = await sectionApi.get(sectionId) as any
    widgets.value = (res.section?.widgets ?? []).map((w: any) => ({ ...w, _isNew: false }))
  } catch (e: any) {
    ElMessage.error(e.message || '加载失败')
  }
})

function addWidget() {
  widgets.value.push({
    widgetId: uuidv4(),
    type: 'short_text',
    label: '新控件',
    fieldKey: `field_${Date.now()}`,
    required: false,
    order: widgets.value.length,
    showInList: false,
    _isNew: true,
  })
}

function removeWidget(widget: any) {
  widgets.value = widgets.value.filter(w => w.widgetId !== widget.widgetId)
}

async function save() {
  if (listCount.value > 3) {
    ElMessage.error('列表显示字段不能超过3个')
    return
  }
  saving.value = true
  try {
    // Strip internal _isNew flag before sending
    const orderedWidgets = widgets.value.map(({ _isNew, ...w }, i) => ({ ...w, order: i }))
    await sectionApi.updateWidgets({ sectionId, communityId, widgets: orderedWidgets })
    ElMessage.success('保存成功')
  } catch (e: any) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.widget-editor { padding: 0; }
</style>
