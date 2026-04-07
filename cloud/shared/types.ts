// cloud/shared/types.ts

export type UserRole = 'user' | 'superAdmin'
export type JoinType = 'open' | 'approval'
export type CommunityStatus = 'pending' | 'active' | 'disabled'
export type MemberRole = 'admin' | 'member'
export type MemberStatus = 'pending' | 'active' | 'rejected' | 'left'
export type PostStatus = 'active' | 'deleted'

export type WidgetType =
  | 'short_text'
  | 'summary'
  | 'datetime'
  | 'number'
  | 'image_group'
  | 'rich_text'
  | 'location'

// 可在列表展示的控件类型
export const LIST_DISPLAYABLE_TYPES: WidgetType[] = [
  'short_text', 'summary', 'datetime', 'number'
]

export interface Widget {
  widgetId: string        // UUID，创建后不可变
  type: WidgetType
  label: string           // 可修改
  fieldKey: string        // 可修改，仅用于可读性，不作为 content key
  required: boolean
  order: number
  showInList: boolean     // 最多3个为 true，后端强制校验
  unit?: string           // 仅 number 类型使用
}

export interface User {
  _id: string             // WeChat openId
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
  creatorId: string       // 仅记录创建者，不代表当前权限
  status: CommunityStatus
  memberCount: number
  createdAt: string
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
}

// post.content 的 key 是 widgetId（UUID），不是 fieldKey
// value 涵盖所有控件类型：文字/数字/图片数组/地图位置
export type PostContentValue = string | number | string[] | GeoLocation
export type PostContent = Record<string, PostContentValue>

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
}
