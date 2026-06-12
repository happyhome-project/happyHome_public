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
      <div class="selected-actions">
        <el-tag size="small" effect="plain" :type="local.adjusted ? 'warning' : 'success'">
          {{ local.adjusted ? '已微调' : '高德候选点' }}
        </el-tag>
        <el-button size="small" :loading="mapConfigLoading" @click="openMapDialog">
          打开大地图微调
        </el-button>
      </div>
    </div>

    <div class="map-entry" :class="{ disabled: !hasSelectedPoint }">
      <div>
        <div class="map-entry-title">目的地地图</div>
        <div class="map-entry-desc">{{ mapEntryDescription }}</div>
      </div>
      <el-button
        type="primary"
        plain
        :loading="mapConfigLoading"
        :disabled="!hasSelectedPoint"
        @click="openMapDialog"
      >
        打开地图
      </el-button>
    </div>

    <div v-if="mapConfigError" class="map-config-warning">
      {{ mapConfigError }}
    </div>

    <div class="coord-row">
      <span>GCJ-02</span>
      <span>纬度 {{ coordinateText(local.lat) }}</span>
      <span>经度 {{ coordinateText(local.lng) }}</span>
    </div>
    <div class="muted-tip">
      后台使用高德选点；小程序端按同一 GCJ-02 坐标调用微信地图导航。不要从 GPS/百度坐标直接粘贴到这里。
    </div>

    <el-dialog
      v-model="mapDialogVisible"
      class="location-map-dialog"
      title="目的地地图微调"
      width="min(1080px, 96vw)"
      top="4vh"
      destroy-on-close
      @opened="handleMapDialogOpened"
      @closed="handleMapDialogClosed"
    >
      <div class="map-dialog-layout">
        <div class="map-dialog-info">
          <div>
            <div class="dialog-location-name">{{ local.name || local.address || '已选择目的地' }}</div>
            <div class="dialog-location-address">{{ local.address || '暂无地址文本' }}</div>
          </div>
          <div class="dialog-coords">
            <span>纬度 {{ coordinateText(local.lat) }}</span>
            <span>经度 {{ coordinateText(local.lng) }}</span>
          </div>
          <div class="dialog-hint">拖动红色标记，或点击地图上的目标位置完成微调。</div>
        </div>

        <div class="map-dialog-canvas-shell">
          <div ref="mapContainer" class="mapContainer amap-canvas dialog-map" />
          <div v-if="mapConfigLoading" class="map-placeholder">
            <span>正在读取地图配置</span>
            <small>请稍等</small>
          </div>
          <div v-else-if="!amapJsKey" class="map-placeholder">
            <span>高德地图 JS Key 未配置</span>
            <small>请配置 AMAP_JS_KEY，或部署 admin-web 时配置 VITE_AMAP_JS_KEY</small>
          </div>
        </div>
      </div>
      <template #footer>
        <div class="dialog-footer">
          <span>{{ local.adjusted ? '已使用微调坐标' : '当前为高德候选点坐标' }}</span>
          <el-button type="primary" @click="mapDialogVisible = false">完成</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import { Search } from '@element-plus/icons-vue'
import { geoApi, type GeoSearchCandidate } from '../api/cloud'
import { hasValidLocationCoordinate } from '../utils/locationValidation'

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

const buildTimeAmapJsKey = String(import.meta.env.VITE_AMAP_JS_KEY || '').trim()
const buildTimeAmapSecurityCode = String(import.meta.env.VITE_AMAP_SECURITY_CODE || '').trim()
const mapContainer = ref<HTMLDivElement | null>(null)
const query = ref('')
const region = ref('')
const searching = ref(false)
const searchCandidates = ref<GeoSearchCandidate[]>([])
const selectedCandidateKey = ref('')
const mapDialogVisible = ref(false)
const local = reactive<LocationValue>(normalize(props.modelValue))
const mapConfig = reactive({
  jsKey: buildTimeAmapJsKey,
  securityCode: buildTimeAmapSecurityCode,
  loaded: Boolean(buildTimeAmapJsKey),
  loading: false,
  error: '',
})

const amapJsKey = computed(() => mapConfig.jsKey.trim())
const mapConfigLoading = computed(() => mapConfig.loading)
const mapConfigError = computed(() => mapConfig.error)
const hasSelectedPoint = computed(() => hasValidCoordinate(local))
const mapEntryDescription = computed(() => {
  if (!hasSelectedPoint.value) return '先搜索并选择目的地，再打开大地图微调坐标。'
  if (mapConfig.loading) return '正在读取高德地图配置。'
  if (!amapJsKey.value && mapConfig.loaded) return '已保存候选点坐标，但当前缺少地图 JS Key。'
  return '打开大地图后可拖动标记或点击地图微调目的地。'
})

let mapInstance: any = null
let markerInstance: any = null
let mapConfigLoadPromise: Promise<void> | null = null
let mapResizeInterval: number | null = null
let mapResourceObserver: PerformanceObserver | null = null

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
  void loadRuntimeMapConfig()
})

onBeforeUnmount(() => {
  destroyMap()
})

watch(
  () => [local.lat, local.lng],
  () => {
    void updateMapPoint()
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
  return hasValidLocationCoordinate(value)
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

async function loadRuntimeMapConfig(force = false) {
  if (!force && mapConfig.loaded) return
  if (mapConfigLoadPromise) return mapConfigLoadPromise
  mapConfig.loading = true
  mapConfig.error = ''
  mapConfigLoadPromise = (async () => {
    try {
      const res = await geoApi.getMapConfig()
      const runtimeKey = String(res?.jsKey || '').trim()
      const runtimeSecurityCode = String(res?.securityCode || '').trim()
      if (runtimeKey) mapConfig.jsKey = runtimeKey
      if (runtimeSecurityCode) mapConfig.securityCode = runtimeSecurityCode
      if (!runtimeKey && !mapConfig.jsKey) {
        mapConfig.error = '未读取到高德地图 JS Key，请配置 AMAP_JS_KEY 或 VITE_AMAP_JS_KEY'
      }
    } catch (err: any) {
      if (!mapConfig.jsKey) {
        mapConfig.error = err?.response?.data?.error || err?.message || '读取高德地图配置失败'
      }
    } finally {
      mapConfig.loaded = true
      mapConfig.loading = false
      mapConfigLoadPromise = null
    }
  })()
  return mapConfigLoadPromise
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
    selectedCandidateKey.value = candidateKey(local)
    ElMessage.success(`找到 ${searchCandidates.value.length} 个候选点，请选择最准确的位置`)
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

async function openMapDialog() {
  if (!hasSelectedPoint.value) {
    ElMessage.warning('请先搜索并选择目的地')
    return
  }
  await loadRuntimeMapConfig()
  if (!amapJsKey.value) {
    ElMessage.warning(mapConfig.error || '高德地图 JS Key 未配置，暂时无法打开地图微调')
    return
  }
  destroyMap()
  mapDialogVisible.value = true
  window.setTimeout(() => {
    void updateMapPoint()
  }, 420)
}

async function loadAmap() {
  const jsKey = amapJsKey.value
  if (!jsKey) return null
  if (mapConfig.securityCode) {
    window._AMapSecurityConfig = { securityJsCode: mapConfig.securityCode }
  }
  if (window.AMap) return window.AMap
  if (!window.__happyHomeAmapLoader) {
    window.__happyHomeAmapLoader = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(jsKey)}`
      script.async = true
      script.onload = () => resolve(window.AMap)
      script.onerror = () => {
        window.__happyHomeAmapLoader = undefined
        reject(new Error('高德地图 JS 加载失败'))
      }
      document.head.appendChild(script)
    })
  }
  return window.__happyHomeAmapLoader
}

function hasReadyMapContainer() {
  const el = mapContainer.value
  if (!el) return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

async function waitForMapContainer(maxFrames = 24) {
  if (hasReadyMapContainer()) return
  await nextTick()
  await new Promise<void>((resolve) => {
    let stableFrames = 0
    const check = (remainingFrames: number) => {
      if (hasReadyMapContainer()) {
        stableFrames += 1
      } else {
        stableFrames = 0
      }
      if (stableFrames >= 2 || remainingFrames <= 0) {
        resolve()
        return
      }
      requestAnimationFrame(() => check(remainingFrames - 1))
    }
    check(maxFrames)
  })
}

async function ensureMap() {
  if (!mapDialogVisible.value || !hasValidCoordinate(local)) return null
  await waitForMapContainer()
  if (!mapContainer.value) return null
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
    syncMapCenter(mapInstance, [Number(local.lng), Number(local.lat)])
    markerInstance.on('dragend', (event: any) => {
      const point = extractLngLat(event?.lnglat)
      applyAdjustedPoint(point.lng, point.lat)
    })
    mapInstance.on('click', (event: any) => {
      const point = extractLngLat(event?.lnglat)
      applyAdjustedPoint(point.lng, point.lat)
    })
    mapInstance.on?.('complete', () => scheduleMapResize(mapInstance))
  }
  return mapInstance
}

function syncMapCenter(map: any, position: number[]) {
  if (typeof map.setZoomAndCenter === 'function') {
    map.setZoomAndCenter(15, position, false, 0)
    return
  }
  map.setZoom?.(15)
  map.setCenter(position)
}

function scheduleMapResize(map: any) {
  const refresh = () => {
    if (!mapDialogVisible.value || !hasValidCoordinate(local)) return
    const position = [Number(local.lng), Number(local.lat)]
    map.resize?.()
    syncMapCenter(map, position)
    window.dispatchEvent(new Event('resize'))
  }
  if (mapResourceObserver) mapResourceObserver.disconnect()
  if ('PerformanceObserver' in window) {
    try {
      mapResourceObserver = new PerformanceObserver((list) => {
        const hasAmapRenderResource = list
          .getEntries()
          .some((entry) => /web_map\/get_tile|o4\.amap\.com\/style|o4\.amap\.com\/icon/.test(entry.name))
        if (hasAmapRenderResource) {
          refresh()
          requestAnimationFrame(refresh)
          window.setTimeout(refresh, 120)
        }
      })
      mapResourceObserver.observe({ type: 'resource', buffered: true })
    } catch {
      mapResourceObserver = null
    }
  }
  requestAnimationFrame(() => {
    refresh()
    requestAnimationFrame(refresh)
  })
  ;[320, 1200, 2400, 4000].forEach((delay) => {
    window.setTimeout(refresh, delay)
  })
  if (mapResizeInterval !== null) window.clearInterval(mapResizeInterval)
  let refreshCount = 0
  mapResizeInterval = window.setInterval(() => {
    refresh()
    refreshCount += 1
    if (refreshCount >= 12 && mapResizeInterval !== null) {
      window.clearInterval(mapResizeInterval)
      mapResizeInterval = null
    }
  }, 1000)
}

async function updateMapPoint() {
  if (!mapDialogVisible.value || !hasValidCoordinate(local)) return
  try {
    const map = await ensureMap()
    if (!map) return
    const position = [Number(local.lng), Number(local.lat)]
    markerInstance?.setPosition(position)
    syncMapCenter(map, position)
    map.resize?.()
    scheduleMapResize(map)
  } catch (err: any) {
    ElMessage.warning(err?.message || '地图预览加载失败，可先保存候选点坐标')
  }
}

async function handleMapDialogOpened() {
  await nextTick()
  await waitForMapContainer()
  await updateMapPoint()
}

function handleMapDialogClosed() {
  destroyMap()
}

function destroyMap() {
  if (mapResourceObserver) {
    mapResourceObserver.disconnect()
    mapResourceObserver = null
  }
  if (mapResizeInterval !== null) {
    window.clearInterval(mapResizeInterval)
    mapResizeInterval = null
  }
  if (mapInstance?.destroy) mapInstance.destroy()
  mapInstance = null
  markerInstance = null
}
</script>

<style scoped>
.location-admin-editor {
  display: grid;
  gap: 10px;
  max-width: 820px;
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

.selected-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}

.map-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 14px;
  border: 1px solid #d8e2d0;
  border-radius: 6px;
  background: #f8fbf5;
}

.map-entry.disabled {
  border-color: #e5e7eb;
  background: #f8f8f8;
}

.map-entry-title {
  color: #1f2d1f;
  font-size: 14px;
  font-weight: 600;
}

.map-entry-desc {
  margin-top: 4px;
  color: #606266;
  font-size: 12px;
  line-height: 1.45;
}

.map-config-warning {
  padding: 9px 12px;
  border: 1px solid #f1d8a7;
  border-radius: 6px;
  color: #8a5b00;
  background: #fff8e8;
  font-size: 12px;
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

.map-dialog-layout {
  display: grid;
  gap: 14px;
}

.map-dialog-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border: 1px solid #e2e8dc;
  border-radius: 6px;
  background: #fbfdf9;
}

.dialog-location-name {
  color: #1f2d1f;
  font-size: 16px;
  font-weight: 700;
}

.dialog-location-address {
  margin-top: 4px;
  color: #606266;
  font-size: 13px;
}

.dialog-coords {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  color: #606266;
  font-size: 12px;
}

.dialog-hint {
  flex: 0 0 190px;
  color: #6c7a64;
  font-size: 12px;
  line-height: 1.5;
  text-align: right;
}

.map-dialog-canvas-shell {
  position: relative;
  min-height: 68vh;
  overflow: hidden;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #f5f7fa;
}

.amap-canvas {
  width: 100%;
  height: 68vh;
  min-height: 560px;
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

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: #606266;
  font-size: 12px;
}

@media (max-width: 720px) {
  .selected-summary,
  .map-entry,
  .map-dialog-info,
  .dialog-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .selected-actions {
    justify-content: flex-start;
  }

  .dialog-coords,
  .dialog-hint {
    justify-content: flex-start;
    text-align: left;
  }

  .dialog-hint {
    flex-basis: auto;
  }

  .amap-canvas,
  .map-dialog-canvas-shell {
    min-height: 520px;
  }
}
</style>
