<template>
  <div class="topic-admin-editor">
    <div v-if="topics.length" class="topic-tags" aria-label="已添加话题">
      <el-tag
        v-for="(topic, index) in topics"
        :key="topic.toLowerCase()"
        closable
        effect="plain"
        round
        @close="removeTopic(index)"
      >
        #{{ topic }}
      </el-tag>
    </div>

    <div class="topic-input-row">
      <el-input
        v-model="draft"
        class="topic-input"
        :disabled="topics.length >= MAX_TOPIC_COUNT"
        placeholder="输入话题，例如：周末遛娃"
        clearable
        @keyup.enter.prevent="addTopic"
      >
        <template #prepend>#</template>
      </el-input>
      <el-button
        :disabled="topics.length >= MAX_TOPIC_COUNT || !draft.trim()"
        @click="addTopic"
      >
        添加
      </el-button>
    </div>

    <div class="topic-meta" :class="{ invalid: draftLength > MAX_TOPIC_LENGTH }">
      <span>最多 {{ MAX_TOPIC_COUNT }} 个话题，输入开头的 # 会自动去除并去重</span>
      <span>{{ draftLength }}/{{ MAX_TOPIC_LENGTH }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import {
  MAX_TOPIC_COUNT,
  MAX_TOPIC_LENGTH,
  appendTopic,
  normalizeTopicText,
  topicUnicodeLength,
  validateAndNormalizeTopics,
} from '../utils/topics'

const props = defineProps<{ modelValue: string[] | unknown }>()
const emit = defineEmits<{
  (event: 'update:modelValue', value: string[]): void
}>()

const draft = ref('')
const topics = computed(() => {
  const result = validateAndNormalizeTopics(props.modelValue)
  return result.ok ? result.topics : []
})
const draftLength = computed(() => topicUnicodeLength(normalizeTopicText(draft.value)))

function addTopic() {
  const result = appendTopic(topics.value, draft.value)
  if (!result.ok) {
    ElMessage.warning(result.message)
    return
  }
  emit('update:modelValue', result.topics)
  draft.value = ''
  if (result.duplicate) ElMessage.info('该话题已添加')
}

function removeTopic(index: number) {
  emit('update:modelValue', topics.value.filter((_, itemIndex) => itemIndex !== index))
}
</script>

<style scoped>
.topic-admin-editor {
  display: grid;
  gap: 10px;
  max-width: 680px;
}

.topic-tags,
.topic-input-row,
.topic-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.topic-input {
  flex: 1 1 360px;
}

.topic-meta {
  justify-content: space-between;
  color: #909399;
  font-size: 12px;
  line-height: 1.5;
}

.topic-meta.invalid {
  color: #f56c6c;
}
</style>
