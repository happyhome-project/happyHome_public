import { createSSRApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { installSafeNav } from './utils/safe-nav'

// 全局保护：让重复点击的导航调用不再抛出 unhandledRejection
installSafeNav()

export function createApp() {
  const app = createSSRApp(App)
  // uni-app App type 与 pinia v3 的 Plugin 类型定义存在差异，这里显式断言后安装
  const pinia = createPinia()
  app.use(pinia as any)
  return { app }
}
