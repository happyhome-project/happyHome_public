import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const detailSource = readFileSync(resolve(process.cwd(), 'src/pages/detail/index.vue'), 'utf8')
const createSource = readFileSync(resolve(process.cwd(), 'src/pages/create/index.vue'), 'utf8')
const profileSource = readFileSync(resolve(process.cwd(), 'src/pages/profile/index.vue'), 'utf8')
const pagesSource = readFileSync(resolve(process.cwd(), 'src/pages.json'), 'utf8')
const myPostsSource = readFileSync(resolve(process.cwd(), 'src/pages/my-posts/index.vue'), 'utf8')
const myActivitiesSource = readFileSync(resolve(process.cwd(), 'src/pages/my-activities/index.vue'), 'utf8')
const authorPostColumnsSource = readFileSync(resolve(process.cwd(), 'src/components/AuthorPostColumns.vue'), 'utf8')
const cloudApiSource = readFileSync(resolve(process.cwd(), 'src/api/cloud.ts'), 'utf8')
const emptyIllustrationSource = readFileSync(resolve(process.cwd(), 'src/static/profile/my-activities-empty.svg'), 'utf8')
const imageNoteDetailSource = readFileSync(resolve(process.cwd(), 'src/components/ImageNoteDetailView.vue'), 'utf8')

describe('author post management UI contract', () => {
  test('uses a quiet author entry and a horizontal Xiaohongshu-style icon sheet', () => {
    expect(detailSource).toContain('data-testid="post-settings-trigger"')
    expect(detailSource).toContain('编辑和设置')
    expect(detailSource).toContain('data-testid="post-settings-sheet"')
    expect(detailSource).toContain('class="post-settings-actions"')
    expect(detailSource).toContain('/static/post-settings/edit.svg')
    expect(detailSource).toContain('/static/post-settings/delete.svg')
    expect(detailSource).toContain('笔记设置')
  })

  test('routes the edit action into the shared create page', () => {
    expect(detailSource).toMatch(/pages\/create\/index\?editPostId=/)
    expect(detailSource).toContain('data-testid="post-settings-edit"')
    expect(detailSource).toContain('data-testid="post-settings-delete"')
  })
})

describe('my posts entry and Xiaohongshu-style feed contract', () => {
  test('opens a real authored-post route from profile', () => {
    expect(profileSource).toContain("item.key === 'posts'")
    expect(profileSource).toContain("/pages/my-posts/index")
    expect(pagesSource).toContain('pages/my-posts/index')
  })

  test('loads authored posts into two cover-first columns', () => {
    expect(myPostsSource).toContain('await postApi.listMine(')
    expect(myPostsSource).toContain('<AuthorPostColumns')
    expect(authorPostColumnsSource).toContain('class="author-post-columns"')
    expect(authorPostColumnsSource).toContain('<TextNoteCover')
    expect(myPostsSource).toContain('data-testid="my-posts-page"')
    expect(authorPostColumnsSource).toContain('data-testid="author-post-card"')
  })
})

describe('my activities participation contract', () => {
  test('opens a real activity route and loads the server-composed activity relationship', () => {
    expect(profileSource).toContain("item.key === 'activity'")
    expect(profileSource).toContain('/pages/my-activities/index')
    expect(pagesSource).toContain('pages/my-activities/index')
    expect(cloudApiSource).toContain('listMyActivities')
    expect(myActivitiesSource).toContain('await postApi.listMyActivities(')
    expect(myActivitiesSource).toContain('<AuthorPostColumns')
  })

  test('renders the requested warm illustrated empty state with both discovery and creation actions', () => {
    expect(myActivitiesSource).toContain('您还没参加任何活动')
    expect(myActivitiesSource).toContain('独乐乐不如众乐乐，快去参加或者发起活动吧~')
    expect(myActivitiesSource).toContain('/static/profile/my-activities-empty.svg')
    expect(myActivitiesSource).toContain('去看看活动')
    expect(myActivitiesSource).toContain('发起活动')
    expect(myActivitiesSource).toContain("uni.switchTab({ url: '/pages/index/index' })")
    expect(myActivitiesSource).toContain("uni.navigateTo({ url: '/pages/create/index?mode=collaboration' })")
    expect(emptyIllustrationSource).toContain('#FF6B4A')
    expect(emptyIllustrationSource).toContain('#FFC53D')
    expect(emptyIllustrationSource).toContain('#20C997')
  })
})

describe('image note detail polish', () => {
  test('keeps carousel position visible and renders location as a compact text chip', () => {
    expect(imageNoteDetailSource).toContain('class="image-note-dots"')
    expect(imageNoteDetailSource).toContain('class="image-note-dot"')
    expect(imageNoteDetailSource).toContain('class="image-note-location-text"')
    expect(imageNoteDetailSource).not.toContain('class="image-note-location-address"')
  })
})

describe('shared create page edit mode contract', () => {
  test('loads, pre-fills, and updates an existing post', () => {
    expect(createSource).toContain("const editPostId = ref('')")
    expect(createSource).toContain('await loadPostForEdit(String(options?.editPostId || \'\'))')
    expect(createSource).toContain('await postApi.get(editPostId.value)')
    expect(createSource).toContain('Object.assign(formData,')
    expect(createSource).toContain('await postApi.update(editPostId.value')
    expect(createSource).toContain("isEditMode ? '保存中...' :")
    expect(createSource).toContain("isEditMode ? '保存' :")
  })
})
