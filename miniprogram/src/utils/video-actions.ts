// 视频条目跨端操作封装：播放 / 下载 / 分享 / 跳转
// VideoItem 来源类型对照：
//   cos            自托管 COS 视频   → 当前页面播放 / 下载 / 分享
//   channels_feed  视频号 feed       → wx.openChannelsActivity
//   channels_live  视频号直播        → wx.openChannelsLive
//   miniprogram    其他微信小程序    → wx.navigateToMiniProgram
//   h5             外部 H5 链接      → web-view 页（mp）/ window.open（H5）
//   app_link       原生 App 链接     → 复制到剪贴板 + Toast 提示

import { callCloud } from '../api/cloud'
import type { VideoItem, VideoItemCos } from '../../../cloud/shared/types'

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — wx 仅在 mp-weixin 环境注入，H5 不可用
const _wx: any = typeof wx !== 'undefined' ? wx : undefined
const IS_H5 = !_wx?.cloud?.callFunction

export interface PlayContext {
  setSrc: (src: string) => void
}

/**
 * 把 cloud:// fileID 转成可在当前端播放的 URL。
 * - mp-weixin：原生 video 组件支持 cloud://，直接返回原 fileID
 * - H5：调云函数 post.getMediaUrl 换 https 临时 URL
 * - 已经是 https：透传
 */
export async function resolvePlayUrl(fileID: string | undefined): Promise<string> {
  if (!fileID) return ''
  if (fileID.startsWith('http://') || fileID.startsWith('https://')) return fileID
  if (!IS_H5 && fileID.startsWith('cloud://')) return fileID
  const res = await callCloud<{ url: string }>('post', 'getMediaUrl', { fileID })
  return res?.url || ''
}

/** 当前页面播放（cos / h5；其他来源 → openExternal） */
export async function playInline(item: VideoItem, ctx: PlayContext): Promise<void> {
  if (item.source === 'cos') {
    const src = await resolvePlayUrl((item as VideoItemCos).fileID)
    ctx.setSrc(src)
    return
  }
  if (item.source === 'h5') {
    if (IS_H5) {
      try { (window as any).open?.(item.url, '_blank') } catch { /* noop */ }
      return
    }
    uni.navigateTo({ url: `/pages/web-view/index?url=${encodeURIComponent(item.url)}` })
    return
  }
  await openExternal(item)
}

/** 跳转到对应 App / 视频号 / 小程序 / 复制 app_link */
export async function openExternal(item: VideoItem): Promise<void> {
  if (IS_H5) {
    uni.showToast({ title: '请用微信小程序打开查看', icon: 'none' })
    return
  }

  if (item.source === 'channels_feed') {
    _wx.openChannelsActivity({
      finderUserName: item.finderUserName,
      feedId: item.feedId,
      ...(item.nonceId ? { nonceId: item.nonceId } : {}),
      fail: (err: any) => uni.showToast({
        title: `打开视频号失败：${err?.errMsg || '未知错误'}`,
        icon: 'none',
      }),
    })
    return
  }

  if (item.source === 'channels_live') {
    _wx.openChannelsLive({
      finderUserName: item.finderUserName,
      nonceId: item.nonceId,
      fail: (err: any) => uni.showToast({
        title: `打开直播失败：${err?.errMsg || '未知错误'}`,
        icon: 'none',
      }),
    })
    return
  }

  if (item.source === 'miniprogram') {
    _wx.navigateToMiniProgram({
      appId: item.appId,
      ...(item.path ? { path: item.path } : {}),
      envVersion: item.envVersion || 'release',
      fail: (err: any) => {
        const msg = String(err?.errMsg || '')
        if (msg.includes('not in navigateToMiniProgramAppIdList')) {
          uni.showToast({ title: '该小程序未在跳转白名单，请联系管理员', icon: 'none' })
        } else {
          uni.showToast({ title: `跳转失败：${msg || '未知错误'}`, icon: 'none' })
        }
      },
    })
    return
  }

  if (item.source === 'app_link') {
    uni.setClipboardData({
      data: item.url,
      success: () => uni.showToast({
        title: item.hint || '链接已复制，请到对应 App 中粘贴打开',
        icon: 'none',
        duration: 2500,
      }),
    })
    return
  }
}

/** 下载到相册（仅 cos + mp-weixin） */
export async function downloadToAlbum(item: VideoItem): Promise<void> {
  if (item.source !== 'cos') {
    uni.showToast({ title: '该视频不支持下载', icon: 'none' })
    return
  }
  if (IS_H5) {
    uni.showToast({ title: '请用微信小程序打开下载', icon: 'none' })
    return
  }

  uni.showLoading({ title: '下载中...', mask: true })
  try {
    const httpUrl = await resolvePlayUrl((item as VideoItemCos).fileID)
    if (!httpUrl) throw new Error('无法获取视频地址')

    const dl: any = await new Promise((resolve, reject) =>
      _wx.downloadFile({ url: httpUrl, success: resolve, fail: reject })
    )
    if (dl.statusCode !== 200) throw new Error(`下载失败 (${dl.statusCode})`)

    await new Promise((resolve, reject) =>
      _wx.saveVideoToPhotosAlbum({ filePath: dl.tempFilePath, success: resolve, fail: reject })
    )
    uni.showToast({ title: '已保存到相册', icon: 'success' })
  } catch (err: any) {
    const msg = String(err?.errMsg || err?.message || '')
    if (msg.includes('auth deny') || msg.includes('saveVideoToPhotosAlbum:fail auth')) {
      uni.showModal({
        title: '需要相册权限',
        content: '保存视频需要授权写入相册，请在设置中开启。',
        confirmText: '去设置',
        success: (r) => { if (r.confirm) uni.openSetting({}) },
      })
    } else {
      uni.showToast({ title: msg || '下载失败', icon: 'none' })
    }
  } finally {
    uni.hideLoading()
  }
}

/** 分享文件给微信好友 / 文件助手（仅 cos + mp-weixin） */
export async function shareToWeChat(item: VideoItem): Promise<void> {
  if (item.source !== 'cos') {
    uni.showToast({ title: '该视频不支持分享', icon: 'none' })
    return
  }
  if (IS_H5) {
    uni.showToast({ title: '请用微信小程序打开分享', icon: 'none' })
    return
  }

  uni.showLoading({ title: '准备分享...', mask: true })
  try {
    const httpUrl = await resolvePlayUrl((item as VideoItemCos).fileID)
    if (!httpUrl) throw new Error('无法获取视频地址')
    const dl: any = await new Promise((resolve, reject) =>
      _wx.downloadFile({ url: httpUrl, success: resolve, fail: reject })
    )
    if (dl.statusCode !== 200) throw new Error(`下载失败 (${dl.statusCode})`)
    uni.hideLoading()
    _wx.shareFileMessage({
      filePath: dl.tempFilePath,
      fileName: `${item.title || 'video'}.mp4`,
      fail: (err: any) => uni.showToast({
        title: `分享失败：${err?.errMsg || '未知错误'}`,
        icon: 'none',
      }),
    })
  } catch (err: any) {
    uni.hideLoading()
    uni.showToast({ title: String(err?.message || '分享失败'), icon: 'none' })
  }
}
