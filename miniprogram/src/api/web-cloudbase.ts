type PublicWebCloudbaseEnv = {
  envId: string
  accessKey: string
}

type WebCloudbaseSdk = {
  default: {
    init(config: { env: string; accessKey: string }): WebCloudbaseApp
  }
}

type WebCloudbaseAuth = {
  getLoginState(): Promise<any>
  signIn(params: Record<string, any>): Promise<any>
  signOut(): Promise<any>
}

type WebCloudbaseApp = {
  auth(): WebCloudbaseAuth
  callFunction(options: { name: string; data: object }): Promise<{ result: any }>
}

type WebCloudbaseDependencies = {
  env: PublicWebCloudbaseEnv
  loadSdk: () => Promise<WebCloudbaseSdk>
}

export function createWebCloudbaseApi(dependencies: WebCloudbaseDependencies) {
  let instances: Promise<{ app: WebCloudbaseApp; auth: WebCloudbaseAuth }> | undefined

  function getInstances() {
    if (!instances) {
      const { envId, accessKey } = dependencies.env
      const missing = [
        !envId && 'VITE_CLOUDBASE_ENV_ID',
        !accessKey && 'VITE_CLOUDBASE_ACCESS_KEY',
      ].filter(Boolean)
      if (missing.length) {
        throw new Error(`[web-cloudbase] missing public configuration: ${missing.join(', ')}`)
      }
      instances = dependencies.loadSdk().then(({ default: Cloudbase }) => {
        const app = Cloudbase.init({ env: envId, accessKey })
        return { app, auth: app.auth() }
      })
    }
    return instances
  }

  return {
    async getLoginState() {
      const { auth } = await getInstances()
      return auth.getLoginState()
    },
    async signIn(params: Record<string, any>) {
      const { auth } = await getInstances()
      return auth.signIn(params)
    },
    async signOut() {
      const { auth } = await getInstances()
      return auth.signOut()
    },
    async callFunction(name: string, data: object = {}) {
      const { app } = await getInstances()
      const response = await app.callFunction({ name, data })
      return response.result
    },
  }
}

const viteEnv = (import.meta as any).env || {}
const singleton = createWebCloudbaseApi({
  env: {
    envId: String(viteEnv.VITE_CLOUDBASE_ENV_ID || '').trim(),
    accessKey: String(viteEnv.VITE_CLOUDBASE_ACCESS_KEY || '').trim(),
  },
  loadSdk: () => import('@cloudbase/js-sdk'),
})

export const getLoginState = singleton.getLoginState
export const signIn = singleton.signIn
export const signOut = singleton.signOut
export const callFunction = singleton.callFunction
