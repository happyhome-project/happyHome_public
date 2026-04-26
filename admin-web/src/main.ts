import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import router from './router'
import App from './App.vue'
import { registerUnauthorizedHandler } from './api/cloud'
import { useAuthStore } from './stores/auth'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia).use(ElementPlus).use(router)

// 401/403 → 自动清空 session 并回到登录页
const authStore = useAuthStore(pinia)
registerUnauthorizedHandler(() => {
  authStore.clear()
  if (router.currentRoute.value.name !== 'login') {
    router.push({ name: 'login' })
  }
})

app.mount('#app')
