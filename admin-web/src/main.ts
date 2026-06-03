import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { ElAlert } from 'element-plus/es/components/alert/index'
import { ElAvatar } from 'element-plus/es/components/avatar/index'
import { ElBadge } from 'element-plus/es/components/badge/index'
import { ElBreadcrumb, ElBreadcrumbItem } from 'element-plus/es/components/breadcrumb/index'
import { ElButton } from 'element-plus/es/components/button/index'
import { ElCard } from 'element-plus/es/components/card/index'
import { ElAside, ElContainer, ElMain } from 'element-plus/es/components/container/index'
import { ElDatePicker } from 'element-plus/es/components/date-picker/index'
import { ElDescriptions, ElDescriptionsItem } from 'element-plus/es/components/descriptions/index'
import { ElDialog } from 'element-plus/es/components/dialog/index'
import { ElDivider } from 'element-plus/es/components/divider/index'
import { ElDropdown, ElDropdownItem, ElDropdownMenu } from 'element-plus/es/components/dropdown/index'
import { ElEmpty } from 'element-plus/es/components/empty/index'
import { ElForm, ElFormItem } from 'element-plus/es/components/form/index'
import { ElIcon } from 'element-plus/es/components/icon/index'
import { ElImage } from 'element-plus/es/components/image/index'
import { ElInput } from 'element-plus/es/components/input/index'
import { ElInputNumber } from 'element-plus/es/components/input-number/index'
import { ElLoading } from 'element-plus/es/components/loading/index'
import { ElMenu, ElMenuItem } from 'element-plus/es/components/menu/index'
import { ElProgress } from 'element-plus/es/components/progress/index'
import { ElRadio, ElRadioGroup } from 'element-plus/es/components/radio/index'
import { ElOption, ElSelect } from 'element-plus/es/components/select/index'
import { ElSwitch } from 'element-plus/es/components/switch/index'
import { ElTable, ElTableColumn } from 'element-plus/es/components/table/index'
import { ElTabPane, ElTabs } from 'element-plus/es/components/tabs/index'
import { ElTag } from 'element-plus/es/components/tag/index'
import { ElTooltip } from 'element-plus/es/components/tooltip/index'
import { ElUpload } from 'element-plus/es/components/upload/index'
import 'element-plus/dist/index.css'
import router from './router'
import App from './App.vue'
import { registerUnauthorizedHandler } from './api/cloud'
import { useAuthStore } from './stores/auth'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
;[
  ElAlert,
  ElAside,
  ElAvatar,
  ElBadge,
  ElBreadcrumb,
  ElBreadcrumbItem,
  ElButton,
  ElCard,
  ElContainer,
  ElDatePicker,
  ElDescriptions,
  ElDescriptionsItem,
  ElDialog,
  ElDivider,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElIcon,
  ElImage,
  ElInput,
  ElInputNumber,
  ElLoading,
  ElMain,
  ElMenu,
  ElMenuItem,
  ElOption,
  ElProgress,
  ElRadio,
  ElRadioGroup,
  ElSelect,
  ElSwitch,
  ElTable,
  ElTableColumn,
  ElTabPane,
  ElTabs,
  ElTag,
  ElTooltip,
  ElUpload,
].forEach((plugin) => app.use(plugin))
app.use(router)

// 401/403 → 自动清空 session 并回到登录页
const authStore = useAuthStore(pinia)
registerUnauthorizedHandler(() => {
  authStore.clear()
  if (router.currentRoute.value.name !== 'login') {
    router.push({ name: 'login' })
  }
})

app.mount('#app')
