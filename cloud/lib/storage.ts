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
    .then(res => res.fileList[0].tempFileURL)
}
