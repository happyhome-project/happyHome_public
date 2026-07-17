// cloud/lib/storage.ts
import cloud from 'wx-server-sdk'
import tcb from '@cloudbase/node-sdk'
import { inspectRemoteObjectWithFetch, type RemoteObjectMetadata } from './member-video-upload'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const tcbApp = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV })

export async function uploadFile(
  cloudPath: string,
  fileContent: Buffer
): Promise<string> {
  const res = await cloud.uploadFile({ cloudPath, fileContent })
  return res.fileID
}

export async function deleteFile(fileIDs: string[]): Promise<void> {
  await cloud.deleteFile({ fileList: fileIDs })
}

export function getTempUrl(fileID: string): Promise<string> {
  return cloud.getTempFileURL({ fileList: [fileID] })
    .then((res: { fileList: Array<{ tempFileURL: string }> }) => res.fileList[0].tempFileURL)
}

export function getCurrentEnvironmentId(): string {
  const wxContext = cloud.getWXContext() as { ENV?: string }
  return String(wxContext?.ENV || process.env.TCB_ENV || process.env.SCF_NAMESPACE || '').trim()
}

export function inspectRemoteObject(url: string): Promise<RemoteObjectMetadata> {
  return inspectRemoteObjectWithFetch(url, globalThis.fetch as any)
}

export interface UploadMetadata {
  cloudPath: string
  fileId: string
  url: string
  token: string
  authorization: string
  cosFileId: string
}

export async function requestUploadMetadata(cloudPath: string): Promise<UploadMetadata> {
  const res: any = await tcbApp.getUploadMetadata({ cloudPath })
  const data = res?.data ?? res
  return {
    cloudPath,
    fileId: data.fileId ?? data.fileID,
    url: data.url,
    token: data.token,
    authorization: data.authorization,
    cosFileId: data.cosFileId,
  }
}
