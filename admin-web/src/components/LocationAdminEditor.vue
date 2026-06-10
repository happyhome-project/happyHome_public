<template>
  <div class="location-admin-editor">
    <el-input
      v-model="local.address"
      class="address-input"
      placeholder="地点名称或线路轨迹地址"
      @input="emitValue"
    />
    <div class="coord-row">
      <el-input-number
        v-model="local.lat"
        :precision="6"
        :step="0.000001"
        placeholder="纬度"
        @change="emitValue"
      />
      <el-input-number
        v-model="local.lng"
        :precision="6"
        :step="0.000001"
        placeholder="经度"
        @change="emitValue"
      />
    </div>
    <div class="muted-tip">经纬度用于小程序详情页地图定位；暂时按真实目的地人工填写。</div>
  </div>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue'

type LocationValue = { address: string; lat: number | string; lng: number | string }

const props = defineProps<{ modelValue: LocationValue | unknown }>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: LocationValue): void
}>()

const local = reactive<LocationValue>(normalize(props.modelValue))

watch(
  () => props.modelValue,
  (value) => {
    Object.assign(local, normalize(value))
  },
  { deep: true },
)

function normalize(value: unknown): LocationValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { address: '', lat: 0, lng: 0 }
  }
  const raw = value as Record<string, unknown>
  return {
    address: String(raw.address || ''),
    lat: raw.lat === '' || raw.lat === undefined || raw.lat === null ? 0 : Number(raw.lat),
    lng: raw.lng === '' || raw.lng === undefined || raw.lng === null ? 0 : Number(raw.lng),
  }
}

function emitValue() {
  emit('update:modelValue', {
    address: String(local.address || '').trim(),
    lat: Number(local.lat || 0),
    lng: Number(local.lng || 0),
  })
}
</script>

<style scoped>
.location-admin-editor {
  display: grid;
  gap: 8px;
  max-width: 620px;
}

.address-input {
  max-width: 520px;
}

.coord-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.muted-tip {
  color: #909399;
  font-size: 12px;
}
</style>
