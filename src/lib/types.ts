export type SlotKey = "morning" | "noon" | "afternoon" | "evening";

export type SlotDefinition = {
  key: SlotKey;
  label: string;
  startHour: number;
  startMinute: number;
};

export type WhatsAppInboundMessage = {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: {
    body?: string;
  };
  location?: {
    latitude?: number;
    longitude?: number;
    name?: string;
    address?: string;
  };
};

export type MentionMatch = {
  employeeId: string;
  fullName: string;
  confidence: number;
  reason: string;
};

export type BroadcastPreviewRequest = {
  message: string;
  selectedEmployeeIds?: string[];
  selectedTagKeys?: string[];
};

export type BroadcastSendRequest = {
  originalMessage: string;
  finalMessage: string;
  recipientEmployeeIds: string[];
  audienceType: "manual" | "tag" | "mention" | "mixed";
};

export type ReportKind = "individual_daily" | "team_daily" | "team_weekly";
