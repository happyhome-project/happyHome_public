// cloud/lib/storage.ts
import cloud from 'wx-server-sdk'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

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

export interface UploadMetadata {
  cloudPath: string
  fileId: string
  url: string
  token: string
  authorization: string
  cosFileId: string
}

export async function requestUploadMetadata(cloudPath: string): Promise<UploadMetadata> {
  const res: any = await (cloud as any).getUploadMetadata({ cloudPath })
  return {
    cloudPath,
    fileId: res.fileId ?? res.fileID,
    url: res.url,
    token: res.token,
    authorization: res.authorization,
    cosFileId: res.cosFileId,
  }
}
