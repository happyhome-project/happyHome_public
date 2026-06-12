export type UserRole = 'user' | 'superAdmin'
export type AdminRole = 'superAdmin' | 'communityAdmin'
export type AdminAccountStatus = 'active' | 'disabled'
export type JoinType = 'open' | 'approval'
export type CommunityStatus = 'pending' | 'active' | 'rejected' | 'disabled'
export type MemberRole = 'admin' | 'member'
export type MemberStatus = 'pending' | 'active' | 'rejected' | 'left'
export type PostStatus = 'active' | 'deleted'
export type PostAuditStatus = 'pending' | 'pass' | 'review' | 'rejected'
export type AuditProvider = 'wechat' | 'tencent_ci' | 'manual'
export type AuditTargetType = 'text' | 'image' | 'audio' | 'video'

export type SectionType = 'realtime' | 'evergreen'
export type SectionStatus = 'active' | 'dormant' | 'archived'
export type SectionDisplayTemplate = 'default' | 'guide_note'

export type WidgetType =
  | 'short_text'
  | 'summary'
  | 'datetime'
  | 'number'
  | 'image_group'
  | 'rich_text'
  | 'note_blocks'
  | 'rich_note'
  | 'location'
  | 'attendance'
  | 'video_group'
  | 'audio_group'
  | 'admin_notice'

export const LIST_DISPLAYABLE_TYPES: WidgetType[] = [
  'short_text',
  'summary',
  'datetime',
  'number',
  'attendance',
]

export type VideoSource =
  | 'cos'
  | 'channels_feed'
  | 'channels_live'
  | 'miniprogram'
  | 'h5'
  | 'app_link'

export interface VideoItemBase {
  itemId: string
  title: string
  cover?: string
  duration?: number
  description?: string
}

export interface VideoItemCos extends VideoItemBase {
  source: 'cos'
  fileID: string
  allowDownload?: boolean
  allowShare?: boolean
}

export interface VideoItemChannelsFeed extends VideoItemBase {
  source: 'channels_feed'
  finderUserName: string
  feedId: string
  nonceId?: string
}

export interface VideoItemChannelsLive extends VideoItemBase {
  source: 'channels_live'
  finderUserName: string
  nonceId: string
}

export interface VideoItemMiniprogram extends VideoItemBase {
  source: 'miniprogram'
  appId: string
  path?: string
  envVersion?: 'release' | 'trial' | 'develop'
}

export interface VideoItemH5 extends VideoItemBase {
  source: 'h5'
  url: string
}

export interface VideoItemAppLink extends VideoItemBase {
  source: 'app_link'
  url: string
  hint?: string
}

export type VideoItem =
  | VideoItemCos
  | VideoItemChannelsFeed
  | VideoItemChannelsLive
  | VideoItemMiniprogram
  | VideoItemH5
  | VideoItemAppLink

export type AudioExt = 'mp3' | 'm4a' | 'aac' | 'wav'
export const AUDIO_ALLOWED_EXTS: AudioExt[] = ['mp3', 'm4a', 'aac', 'wav']
export const AUDIO_MAX_SIZE_BYTES = 50 * 1024 * 1024

export interface AudioTrack {
  fileID: string
  title: string
  duration: number
  size: number
  ext: AudioExt
  cover?: string
}

export interface NoteTextBlock {
  blockId: string
  type: 'text'
  text: string
}

export interface NoteImageBlock {
  blockId: string
  type: 'image'
  fileID: string
}

export type NoteBlock = NoteTextBlock | NoteImageBlock

export interface RichNoteContent {
  format: 'markdown'
  markdown: string
  html: string
  text: string
  imageFileIDs: string[]
  schemaVersion: 1
}

export interface Widget {
  widgetId: string
  type: WidgetType
  label: string
  fieldKey: string
  required: boolean
  order: number
  showInList: boolean
  locked?: boolean
  unit?: string
  capacity?: number
  noticeContent?: string
}

export interface AttendancePreviewUser {
  userId: string
  nickName: string
  avatarUrl: string
  seatCount?: number
}

export interface AttendanceSummary {
  count: number
  occupiedSeats: number
  capacity?: number
  isFull: boolean
  isJoined: boolean
  mySeatCount?: number
  previewUsers: AttendancePreviewUser[]
}

export type AttendanceSummaryByWidget = Record<string, AttendanceSummary>

export interface User {
  _id: string
  nickName: string
  avatarUrl: string
  role: UserRole
  createdAt: string
}

export interface GeoLocation {
  name?: string
  address: string
  lat: number
  lng: number
  coordSystem?: 'gcj02'
  source?: 'amap' | 'wechat' | 'manual'
  adjusted?: boolean
  amapPoiId?: string
  province?: string
  city?: string
  district?: string
}

export interface Community {
  _id: string
  name: string
  description: string
  coverImage: string
  location: GeoLocation
  joinType: JoinType
  creatorId: string
  status: CommunityStatus
  memberCount: number
  createdAt: string
  motto?: string
  mottoCite?: string
}

export interface CommunityMember {
  _id: string
  communityId: string
  userId: string
  role: MemberRole
  status: MemberStatus
  appliedAt: string
  joinedAt?: string
  rejectedAt?: string
  leftAt?: string
}

export interface Section {
  _id: string
  communityId: string
  name: string
  icon: string
  order: number
  enableComment: boolean
  enableLike: boolean
  widgets: Widget[]
  createdAt: string
  type: SectionType
  status: SectionStatus
  displayTemplate?: SectionDisplayTemplate
  accentColor?: string
}

export interface SectionWithPostCount extends Section {
  postCount: number
}

export type PostContentValue = string | number | string[] | GeoLocation | VideoItem[] | AudioTrack[] | NoteBlock[] | RichNoteContent
export type PostContent = Record<string, PostContentValue>

export interface PostAttendanceMember {
  _id: string
  postId: string
  widgetId: string
  communityId: string
  sectionId: string
  userId: string
  seatCount?: number
  joinedAt: string
}

export interface Post {
  _id: string
  communityId: string
  sectionId: string
  authorId: string
  status: PostStatus
  auditStatus?: PostAuditStatus
  auditReason?: string
  auditUpdatedAt?: string
  pendingContent?: PostContent | null
  pendingAuditStatus?: PostAuditStatus
  pendingAuditReason?: string
  pendingSubmittedAt?: string
  content: PostContent
  commentCount: number
  likeCount: number
  createdAt: string
  updatedAt: string
  isPinned?: boolean
  pinnedAt?: string
  pinnedByAccountId?: string
  isFeatured?: boolean
  featuredAt?: string
  featuredByAccountId?: string
  adminEditedAt?: string
  adminEditedByAccountId?: string
  adminEditedByUsername?: string
  attendanceSummaryByWidget?: AttendanceSummaryByWidget
}

export interface ContentAuditTask {
  _id: string
  postId: string
  communityId: string
  sectionId: string
  widgetId?: string
  contentSlot: 'content' | 'pendingContent'
  targetType: AuditTargetType
  provider: AuditProvider
  status: PostAuditStatus
  targetLabel: string
  targetRef?: string
  traceId?: string
  jobId?: string
  suggest?: string
  label?: string | number
  reason?: string
  raw?: any
  createdAt: string
  updatedAt: string
}

export interface AdminAccount {
  _id: string
  username: string
  passwordHash: string
  passwordSalt: string
  userId: string
  role: AdminRole
  status: AdminAccountStatus
  createdAt: string
  createdBy: string
}

export interface AdminSession {
  _id: string
  accountId: string
  role: AdminRole
  userId: string
  username: string
  createdAt: string
  expiresAt: string
}

export interface AdminCtx {
  accountId: string
  role: AdminRole
  userId: string
  username: string
}
