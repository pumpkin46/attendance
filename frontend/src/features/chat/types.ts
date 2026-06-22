/** Chat feature types — mirror backend/app/schemas/chat.py. */

export type ConversationType = 'direct' | 'group' | 'channel'
export type MemberRole = 'owner' | 'admin' | 'member'

export interface ChatUser {
  id: number
  name: string
  email?: string | null
}

export interface ChatAttachment {
  id: number
  kind: 'image' | 'file' | 'audio'
  filename: string
  content_type: string
  size_bytes: number
  url: string
}

export interface ChatReaction {
  emoji: string
  count: number
  user_ids: number[]
  /** True when the current user is among `user_ids`. */
  me: boolean
}

export interface ChatReplyPreview {
  id: number
  sender_name?: string | null
  body?: string | null
}

export interface ChatMessage {
  id: number
  conversation_id: number
  sender: ChatUser | null
  type: 'text' | 'system'
  body?: string | null
  reply_to?: ChatReplyPreview | null
  attachments: ChatAttachment[]
  reactions: ChatReaction[]
  mention_user_ids: number[]
  edited_at?: string | null
  deleted_at?: string | null
  created_at?: string | null
}

export interface ChatMember {
  user_id: number
  name: string
  email?: string | null
  role: MemberRole
  is_muted: boolean
  last_read_message_id: number
}

export interface ChatConversation {
  id: number
  type: ConversationType
  /** Group/channel name, or the counterpart's name for a direct conversation. */
  name?: string | null
  topic?: string | null
  is_archived: boolean
  last_message_at?: string | null
  created_at?: string | null
  unread_count: number
  counterpart: ChatUser | null
  member_count: number
  last_message: ChatMessage | null
  members?: ChatMember[] | null
  my_role?: MemberRole | null
  joined: boolean
  is_pinned: boolean
}

export interface ChatChannel {
  id: number
  name?: string | null
  topic?: string | null
  member_count: number
  joined: boolean
}

export interface ChatContact {
  id: number
  name: string
  email?: string | null
  online: boolean
}

export interface ChatMessagePage {
  data: ChatMessage[]
  has_more: boolean
}

/** A pending file selected in the composer, before upload. */
export interface PendingAttachment {
  id: string
  file: File
  previewUrl?: string
}
