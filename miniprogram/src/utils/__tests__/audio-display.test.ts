import { describe, expect, test } from 'vitest'
import * as audioDisplay from '../audio-display'

describe('audio display formatting', () => {
  test('describes immediate buffering feedback only for the current post', () => {
    const resolveAudioPlaybackFeedback = (audioDisplay as any).resolveAudioPlaybackFeedback
    expect(typeof resolveAudioPlaybackFeedback).toBe('function')

    expect(resolveAudioPlaybackFeedback({
      isCurrentPost: true,
      playbackPending: true,
      playbackError: '',
    })).toEqual({ loading: true, message: '正在缓冲…' })

    expect(resolveAudioPlaybackFeedback({
      isCurrentPost: false,
      playbackPending: true,
      playbackError: '',
    })).toEqual({ loading: false, message: '' })
  })

  test('describes retryable failure feedback only for the current post', () => {
    const resolveAudioPlaybackFeedback = (audioDisplay as any).resolveAudioPlaybackFeedback

    expect(resolveAudioPlaybackFeedback({
      isCurrentPost: true,
      playbackPending: false,
      playbackError: '音频加载失败，请重试',
    })).toEqual({ loading: false, message: '音频加载失败，请重试' })

    expect(resolveAudioPlaybackFeedback({
      isCurrentPost: false,
      playbackPending: false,
      playbackError: '音频加载失败，请重试',
    })).toEqual({ loading: false, message: '' })
  })

  test('formats feed and player durations without inventing invalid time', () => {
    const formatAudioDuration = (audioDisplay as any).formatAudioDuration
    expect(typeof formatAudioDuration).toBe('function')
    expect(formatAudioDuration(629)).toBe('10:29')
    expect(formatAudioDuration(3723)).toBe('1:02:03')
    expect(formatAudioDuration(Number.NaN)).toBe('00:00')
  })

  test('keeps canonical audio IDs for playback and never persists display fallbacks into tracks', () => {
    const toAudioPlayerTracks = (audioDisplay as any).toAudioPlayerTracks
    expect(typeof toAudioPlayerTracks).toBe('function')
    const result = toAudioPlayerTracks([
      { fileID: 'cloud://audio/one.mp3', title: '第一轨', duration: 18, size: 1024, ext: 'mp3', cover: 'cloud://covers/one.jpg' },
      { fileID: 'https://cdn.example/two.m4a', title: '第二轨', duration: 27, size: 2048, ext: 'm4a' },
    ])

    expect(result).toEqual([
      { fileID: 'cloud://audio/one.mp3', title: '第一轨', duration: 18, cover: 'cloud://covers/one.jpg' },
      { fileID: 'https://cdn.example/two.m4a', title: '第二轨', duration: 27 },
    ])
    expect(result[1].cover).not.toBe('/static/audio/default-audio-cover.jpg')
  })

  test('resolves current, post-level, then bundled cover fallbacks without using audio file IDs', () => {
    const collectAudioCoverSources = (audioDisplay as any).collectAudioCoverSources
    const resolveAudioDisplayCover = (audioDisplay as any).resolveAudioDisplayCover
    expect(typeof collectAudioCoverSources).toBe('function')
    expect(typeof resolveAudioDisplayCover).toBe('function')
    const tracks = [
      { fileID: 'cloud://audio/one.mp3', title: '第一轨', duration: 18, cover: 'cloud://covers/one.jpg' },
      { fileID: 'cloud://audio/two.mp3', title: '第二轨', duration: 27, cover: 'cloud://covers/two.jpg' },
      { fileID: 'cloud://audio/three.mp3', title: '第三轨', duration: 36 },
    ]
    const resolved = {
      'cloud://covers/one.jpg': 'https://tmp.example/one.jpg',
      'cloud://covers/two.jpg': '',
    }

    expect(collectAudioCoverSources(tracks)).toEqual(['cloud://covers/one.jpg', 'cloud://covers/two.jpg'])
    expect(resolveAudioDisplayCover(tracks[0], tracks, resolved)).toBe('https://tmp.example/one.jpg')
    expect(resolveAudioDisplayCover(tracks[1], tracks, resolved)).toBe('https://tmp.example/one.jpg')
    expect(resolveAudioDisplayCover(tracks[2], tracks, resolved)).toBe('https://tmp.example/one.jpg')
    expect(resolveAudioDisplayCover(tracks[2], tracks, {})).toBe('/static/audio/default-audio-cover.jpg')
  })
})
