import type { ChannelId, StageId, Temp } from "./shared";

export interface Lead {
  id: string;
  conversationId?: string;
  apiLeadId?: string;
  name: string;
  channel: ChannelId;
  stage: StageId;
  temp: Temp;
  source: string;
  value: number;
  manager: string;
  service: string;
  lastMessage: string;
  time: string;
  unread: number;
  ai: boolean;
}

export interface ChatMessage {
  id: string;
  from: "client" | "ai" | "manager";
  text: string;
  time: string;
  attachments?: ChatAttachment[];
}

export interface ChatAttachment {
  id: string;
  filename?: string | null;
  mimeType?: string | null;
  url: string;
  sizeBytes?: number | null;
}
