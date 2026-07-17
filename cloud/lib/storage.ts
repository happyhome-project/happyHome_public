// cloud/lib/storage.ts
import cloud from 'wx-server-sdk'
import tcb from '@cloudbase/node-sdk'
import { createReadStream } from 'fs'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
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

/**
 * Materialize a client-uploaded object into a new server-selected path.
 * The returned object is a snapshot of the bytes downloaded by the cloud
 * function, so callers can verify that snapshot before persisting its fileID.
 */
export async function materializeFile(sourceFileID: string, destinationPath: string): Promise<string> {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'happyhome-member-video-'))
  const tempFilePath = join(tempDirectory, 'object')
  try {
    await tcbApp.downloadFile({ fileID: sourceFileID, tempFilePath })
    const result = await tcbApp.uploadFile({
      cloudPath: destinationPath,
      fileContent: createReadStream(tempFilePath),
    })
    const fileID = String((result as any)?.fileID || '')
    if (!fileID) throw new Error('无法固化上传文件')
    return fileID
  } finally {
    await rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined)
  }
}

export function getTempUrl(fileID: string): Promise<string> {
  return cloud.getTempFileURL({ fileList: [fileID] })
    .then((res: { fileList: Array<{ tempFileURL: string }> }) => res.fileList[0].tempFileURL)
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
