<template>
  <div class="location-admin-editor">
    <div class="search-row">
      <el-input
        v-model="query"
        class="keyword-input"
        placeholder="输入目的地名称或详细地址"
        clearable
        @keyup.enter="searchLocations"
      />
      <el-input
        v-model="region"
        class="region-input"
        placeholder="城市/区域，可选"
        clearable
        @keyup.enter="searchLocations"
      />
      <el-button type="primary" :icon="Search" :loading="searching" @click="searchLocations">
        搜索
      </el-button>
    </div>

    <div v-if="searchCandidates.length" class="candidate-list">
      <button
        v-for="candidate in searchCandidates"
        :key="candidate.id || `${candidate.lng},${candidate.lat}`"
        class="candidate-item"
        :class="{ active: selectedCandidateKey === candidateKey(candidate) }"
        type="button"
        @click="selectCandidate(candidate)"
      >
        <span class="candidate-name">{{ candidate.name || candidate.address }}</span>
        <span class="candidate-address">{{ candidate.address }}</span>
      </button>
    </div>

    <div v-if="hasSelectedPoint" class="selected-summary">
      <div>
        <div class="selected-name">{{ local.name || local.address || '已选择目的地' }}</div>
        <div class="selected-address">{{ local.address || '暂无地址文本' }}</div>
      </div>
      <el-tag size="small" effect="plain" :type="local.adjusted ? 'warning' : 'success'">
        {{ local.adjusted ? '已微调' : '高德候选点' }}
      </el-tag>
    </div>

    <div class="map-shell" :class="{ empty: !hasSelectedPoint }">
      <div ref="mapContainer" class="mapContainer amap-canvas" />
      <div v-if="!amapJsKey" class="map-placeholder">
        <span>已保存候选点坐标</span>
        <small>配置 VITE_AMAP_JS_KEY 后可在地图上拖动微调</small>
      </div>
      <div v-else-if="!hasSelectedPoint" class="map-placeholder">
        <span>先搜索并选择目的地</span>
        <small>选中后可拖动标记，或点击地图微调</small>
      </div>
    </div>

    <div class="coord-row">
      <span>GCJ-02</span>
      <span>纬度 {{ coordinateText(local.lat) }}</span>
      <span>经度 {{ coordinateText(local.lng) }}</span>
    </div>
    <div class="muted-tip">
      后台使用高德选点；小程序端按同一 GCJ-02 坐标调用微信地图导航。不要从 GPS/百度坐标直接粘贴到这里。
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import { Search } from '@element-plus/icons-vue'
import { geoApi, type GeoSearchCandidate } from '../api/cloud'

type LocationValue = {
  name?: string
  address: string
  lat: number | string
  lng: number | string
  coordSystem?: 'gcj02'
  source?: 'amap' | 'wechat' | 'manual'
  adjusted?: boolean
  amapPoiId?: string
  province?: string
  city?: string
  district?: string
}

declare global {
  interface Window {
    AMap?: any
    _AMapSecurityConfig?: Record<string, string>
    __happyHomeAmapLoader?: Promise<any>
  }
}

const props = defineProps<{ modelValue: LocationValue | unknown }>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: LocationValue): void
}>()

const amapJsKey = String(import.meta.env.VITE_AMAP_JS_KEY || '').trim()
const amapSecurityCode = String(import.meta.env.VITE_AMAP_SECURITY_CODE || '').trim()
const mapContainer = ref<HTMLDivElement | null>(null)
const query = ref('')
const region = ref('')
const searching = ref(false)
const searchCandidates = ref<GeoSearchCandidate[]>([])
const selectedCandidateKey = ref('')
const local = reactive<LocationValue>(normalize(props.modelValue))

let mapInstance: any = null
let markerInstance: any = null

watch(
  () => props.modelValue,
  (value) => {
    Object.assign(local, normalize(value))
    query.value = local.name || local.address || query.value
    selectedCandidateKey.value = candidateKey(local)
    void updateMapPoint()
  },
  { deep: true },
)

onMounted(() => {
  query.value = local.name || local.address || ''
  selectedCandidateKey.value = candidateKey(local)
  void updateMapPoint()
})

onBeforeUnmount(() => {
  if (mapInstance?.destroy) mapInstance.destroy()
  mapInstance = null
  markerInstance = null
})

const hasSelectedPoint = ref(hasValidCoordinate(local))

watch(
  () => [local.lat, local.lng, local.address, local.name],
  () => {
    hasSelectedPoint.value = hasValidCoordinate(local)
  },
)

function normalize(value: unknown): LocationValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      name: '',
      address: '',
      lat: 0,
      lng: 0,
      coordSystem: 'gcj02',
      source: 'amap',
      adjusted: false,
    }
  }
  const raw = value as Record<string, unknown>
  return {
    name: String(raw.name || ''),
    address: String(raw.address || ''),
    lat: raw.lat === '' || raw.lat === undefined || raw.lat === null ? 0 : Number(raw.lat),
    lng: raw.lng === '' || raw.lng === undefined || raw.lng === null ? 0 : Number(raw.lng),
    coordSystem: raw.coordSystem === 'gcj02' ? 'gcj02' : 'gcj02',
    source: raw.source === 'wechat' || raw.source === 'manual' ? raw.source : 'amap',
    adjusted: raw.adjusted === true,
    amapPoiId: String(raw.amapPoiId || raw.id || ''),
    province: String(raw.province || ''),
    city: String(raw.city || ''),
    district: String(raw.district || ''),
  }
}

function hasValidCoordinate(value: LocationValue) {
  const lat = Number(value.lat)
  const lng = Number(value.lng)
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0)
  )
}

function coordinateText(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? n.toFixed(6) : '-'
}

function candidateKey(value: Pick<LocationValue, 'lat' | 'lng'> | GeoSearchCandidate) {
  const lat = Number(value.lat)
  const lng = Number(value.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return ''
  return `${lng.toFixed(6)},${lat.toFixed(6)}`
}

function emitValue() {
  emit('update:modelValue', {
    name: String(local.name || '').trim(),
    address: String(local.address || '').trim(),
    lat: Number(local.lat || 0),
    lng: Number(local.lng || 0),
    coordSystem: 'gcj02',
    source: local.source || 'amap',
    adjusted: local.adjusted === true,
    amapPoiId: String(local.amapPoiId || ''),
    province: String(local.province || ''),
    city: String(local.city || ''),
    district: String(local.district || ''),
  })
}

async function searchLocations() {
  const keyword = query.value.trim()
  if (!keyword) {
    ElMessage.warning('请输入目的地名称或地址')
    return
  }
  searching.value = true
  try {
    const res = await geoApi.searchLocation({ keyword, region: region.value.trim() })
    searchCandidates.value = res.candidates || []
    if (!searchCandidates.value.length) {
      ElMessage.warning('没有找到候选点，请换一个更具体的名称')
      return
    }
    selectCandidate(searchCandidates.value[0])
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || err?.message || '高德地点检索失败')
  } finally {
    searching.value = false
  }
}

function selectCandidate(candidate: GeoSearchCandidate) {
  Object.assign(local, {
    name: candidate.name || candidate.address,
    address: candidate.address || candidate.name,
    lat: Number(candidate.lat),
    lng: Number(candidate.lng),
    coordSystem: 'gcj02',
    source: 'amap',
    adjusted: false,
    amapPoiId: candidate.id || '',
    province: candidate.province || '',
    city: candidate.city || '',
    district: candidate.district || '',
  })
  selectedCandidateKey.value = candidateKey(candidate)
  emitValue()
  void updateMapPoint()
}

function applyAdjustedPoint(lng: number, lat: number) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return
  local.lng = Number(lng.toFixed(6))
  local.lat = Number(lat.toFixed(6))
  local.coordSystem = 'gcj02'
  local.source = 'amap'
  local.adjusted = true
  selectedCandidateKey.value = candidateKey(local)
  emitValue()
  void updateMapPoint()
}

function extractLngLat(lnglat: any) {
  const lng = typeof lnglat?.getLng === 'function' ? lnglat.getLng() : lnglat?.lng
  const lat = typeof lnglat?.getLat === 'function' ? lnglat.getLat() : lnglat?.lat
  return { lng: Number(lng), lat: Number(lat) }
}

async function loadAmap() {
  if (!amapJsKey) return null
  if (window.AMap) return window.AMap
  if (amapSecurityCode) {
    window._AMapSecurityConfig = { securityJsCode: amapSecurityCode }
  }
  if (!window.__happyHomeAmapLoader) {
    window.__happyHomeAmapLoader = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(amapJsKey)}`
      script.async = true
      script.onload = () => resolve(window.AMap)
      script.onerror = () => reject(new Error('高德地图 JS 加载失败'))
      document.head.appendChild(script)
    })
  }
  return window.__happyHomeAmapLoader
}

async function ensureMap() {
  if (!mapContainer.value || !hasValidCoordinate(local)) return null
  const AMap = await loadAmap()
  if (!AMap) return null
  await nextTick()
  if (!mapInstance) {
    mapInstance = new AMap.Map(mapContainer.value, {
      zoom: 15,
      center: [Number(local.lng), Number(local.lat)],
      resizeEnable: true,
    })
    markerInstance = new AMap.Marker({
      position: [Number(local.lng), Number(local.lat)],
      draggable: true,
      cursor: 'move',
      anchor: 'bottom-center',
    })
    mapInstance.add(markerInstance)
    markerInstance.on('dragend', (event: any) => {
      const point = extractLngLat(event?.lnglat)
      applyAdjustedPoint(point.lng, point.lat)
    })
    mapInstance.on('click', (event: any) => {
      const point = extractLngLat(event?.lnglat)
      applyAdjustedPoint(point.lng, point.lat)
    })
  }
  return mapInstance
}

async function updateMapPoint() {
  if (!hasValidCoordinate(local)) return
  try {
    const map = await ensureMap()
    if (!map) return
    const position = [Number(local.lng), Number(local.lat)]
    markerInstance?.setPosition(position)
    map.setCenter(position)
  } catch (err: any) {
    ElMessage.warning(err?.message || '地图预览加载失败，可先保存候选点坐标')
  }
}
</script>

<style scoped>
.location-admin-editor {
  display: grid;
  gap: 10px;
  max-width: 760px;
}

.search-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.keyword-input {
  flex: 1 1 280px;
}

.region-input {
  flex: 0 0 180px;
}

.candidate-list {
  display: grid;
  gap: 8px;
  max-height: 220px;
  overflow: auto;
}

.candidate-item {
  display: grid;
  gap: 4px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  text-align: left;
  cursor: pointer;
}

.candidate-item.active {
  border-color: #3a6a45;
  background: #f3f8f1;
}

.candidate-name {
  color: #1f2d1f;
  font-weight: 600;
}

.candidate-address {
  color: #606266;
  font-size: 12px;
  line-height: 1.4;
}

.selected-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid #d8e2d0;
  border-radius: 6px;
  background: #fbfdf9;
}

.selected-name {
  color: #1f2d1f;
  font-weight: 600;
}

.selected-address {
  margin-top: 4px;
  color: #606266;
  font-size: 12px;
}

.map-shell {
  position: relative;
  min-height: 280px;
  overflow: hidden;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #f5f7fa;
}

.map-shell.empty .amap-canvas {
  opacity: 0;
}

.amap-canvas {
  width: 100%;
  height: 280px;
}

.map-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #606266;
  background: linear-gradient(135deg, #eef4e8, #f8f5ec);
  pointer-events: none;
}

.map-placeholder small {
  color: #909399;
}

.coord-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  color: #606266;
  font-size: 12px;
}

.muted-tip {
  color: #909399;
  font-size: 12px;
  line-height: 1.5;
}
</style>
