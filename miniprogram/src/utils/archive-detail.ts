function commonNativeArchiveSection(currentPost: Record<string, any>) {
  return {
    _id: '',
    communityId: currentPost.communityId,
    name: '沉淀区',
    type: 'evergreen',
    status: 'active',
    icon: '',
    order: 0,
    enableComment: true,
    enableLike: true,
    createdAt: currentPost.createdAt || '',
  }
}

export function buildNativeArchiveDetailSection(currentPost: Record<string, any>) {
  const common = commonNativeArchiveSection(currentPost)
  if (currentPost.format === 'image_text') return Object.assign({}, common, {
    displayTemplate: 'image_note',
    widgets: [
      { widgetId: 'image_note_images', fieldKey: 'images', type: 'image_group', label: '图片', required: true, order: 0, showInList: false },
      { widgetId: 'image_note_title', fieldKey: 'title', type: 'short_text', label: '标题', required: true, order: 1, showInList: true },
      { widgetId: 'image_note_body', fieldKey: 'body', type: 'rich_note', label: '正文', required: false, order: 2, showInList: false },
      { widgetId: 'image_note_topics', fieldKey: 'topics', type: 'topic', label: '话题', required: false, order: 3, showInList: false },
      { widgetId: 'image_note_location', fieldKey: 'location', type: 'location', label: '地点', required: false, order: 4, showInList: false },
    ],
  })
  if (currentPost.format === 'video') return Object.assign({}, common, {
    displayTemplate: 'default',
    widgets: [
      { widgetId: 'archive_video_title', fieldKey: 'title', type: 'short_text', label: '标题', required: true, order: 0, showInList: true },
      { widgetId: 'archive_video_body', fieldKey: 'body', type: 'rich_note', label: '正文', required: false, order: 1, showInList: false },
      { widgetId: 'archive_video_videos', fieldKey: 'videos', type: 'video_group', label: '视频', required: true, order: 2, showInList: false },
      { widgetId: 'archive_video_location', fieldKey: 'location', type: 'location', label: '地点', required: false, order: 3, showInList: false },
    ],
  })
  return Object.assign({}, common, {
    displayTemplate: 'text_note',
    widgets: [
      { widgetId: 'title', fieldKey: 'title', type: 'short_text', label: '标题', required: true, order: 0, showInList: true },
      { widgetId: 'body', fieldKey: 'body', type: 'rich_note', label: '正文', required: true, order: 1, showInList: false },
      { widgetId: 'archive_text_topics', fieldKey: 'topics', type: 'topic', label: '话题', required: false, order: 2, showInList: false },
      { widgetId: 'archive_text_location', fieldKey: 'location', type: 'location', label: '设置地点', required: false, order: 3, showInList: false },
    ],
  })
}

export function normalizeNativeArchiveDetailPost(currentPost: Record<string, any>) {
  if (currentPost?.area !== 'archive' || currentPost?.sectionId) return currentPost
  const content = currentPost.content || {}
  if (currentPost.format === 'image_text') return Object.assign({}, currentPost, {
    content: Object.assign({}, content, {
      image_note_images: content.images,
      image_note_title: content.title,
      image_note_body: content.body,
      image_note_topics: currentPost.topics || [],
      image_note_location: content.location,
    }),
  })
  if (currentPost.format === 'video') return Object.assign({}, currentPost, {
    content: Object.assign({}, content, {
      archive_video_title: content.title,
      archive_video_body: content.body,
      archive_video_videos: content.videos,
      archive_video_location: content.location,
    }),
  })
  if (currentPost.format === 'text') return Object.assign({}, currentPost, {
    content: Object.assign({}, content, {
      archive_text_topics: currentPost.topics || [],
      archive_text_location: content.location,
    }),
  })
  return currentPost
}
