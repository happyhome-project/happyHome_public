export type UserRole = 'user' | 'superAdmin'
export type JoinType = 'open' | 'approval'
export type CommunityStatus = 'pending' | 'active' | 'rejected' | 'disabled'
export type MemberRole = 'admin' | 'member'
export type MemberStatus = 'pending' | 'active' | 'rejected' | 'left'
export type PostStatus = 'active' | 'deleted'

export type SectionType = 'realtime' | 'evergreen'
export type SectionStatus = 'active' | 'dormant' | 'archived'

export type WidgetType =
  | 'short_text'
  | 'summary'
  | 'datetime'
  | 'number'
  | 'image_group'
  | 'rich_text'
  | 'location'
  | 'attendance'

export const LIST_DISPLAYABLE_TYPES: WidgetType[] = [
  'short_text',
  'summary',
  'datetime',
  'number',
  'attendance',
]

export interface Widget {
  widgetId: string
  type: WidgetType
  label: string
  fieldKey: string
  required: boolean
  order: number
  showInList: boolean
  unit?: string
  capacity?: number
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
  address: string
  lat: number
  lng: number
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
  accentColor?: string
}

export interface SectionWithPostCount extends Section {
  postCount: number
}

export type PostContentValue = string | number | string[] | GeoLocation
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
  content: PostContent
  commentCount: number
  likeCount: number
  createdAt: string
  updatedAt: string
  attendanceSummaryByWidget?: AttendanceSummaryByWidget
}
