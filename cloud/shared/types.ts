// cloud/shared/types.ts

export type UserRole = 'user' | 'superAdmin'
export type JoinType = 'open' | 'approval'
export type CommunityStatus = 'pending' | 'active' | 'rejected' | 'disabled'
export type MemberRole = 'admin' | 'member'
export type MemberStatus = 'pending' | 'active' | 'rejected' | 'left'
export type PostStatus = 'active' | 'deleted'

// Section 行为类型
// - realtime: 实时协作板块（拼车/签到/活动）。首页会把 status='active' 的置顶到"正在进行"。
// - evergreen: 沉淀展示板块（好店/课件）。始终作为归档分组卡渲染，不参与 status 切换。
export type SectionType = 'realtime' | 'evergreen'

// Section 运行状态（仅对 realtime 类型有实际意义；evergreen 固定为 'active'）
// - active: 置顶脉冲区（实时）/ 常驻归档卡（沉淀）
// - dormant: 折叠到首页底部的"休眠板块"（仅 realtime）
// - archived: 不在首页显示，仅社区内访问（仅 realtime）
export type SectionStatus = 'active' | 'dormant' | 'archived'

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
  motto?: string          // 社区格言/引文（首页 quote 区展示，可选）
  mottoCite?: string      // 引文出处（如"民谚"、作者名）
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
  // 双类型 + 三态模型
  type: SectionType                // 实时协作 vs 沉淀展示
  status: SectionStatus            // active/dormant/archived（evergreen 永远 'active'）
  accentColor?: string             // 可选，首页卡片左彩条色（hex）；不填则按序循环
}

// 扩展：首页聚合场景下返回的 section，附带后端算出的 postCount
export interface SectionWithPostCount extends Section {
  postCount: number
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
