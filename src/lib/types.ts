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
  context?: {
    id?: string;
    from?: string;
  };
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

export type BroadcastAudienceCategory =
  | "sales_team"
  | "head_office"
  | "drivers"
  | "customers"
  | "all"
  | "custom";

export type BroadcastRouteTargetType = "person" | "group";

export type BroadcastRouteSource =
  | "manual"
  | "tag"
  | "mention"
  | "ai_group"
  | "ai_person"
  | "mixed";

export type BroadcastDeliveryLifecycleStatus =
  | "accepted"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

export type BroadcastPreviewRequest = {
  message: string;
  audienceCategory?: BroadcastAudienceCategory;
  selectedEmployeeIds?: string[];
  selectedTagKeys?: string[];
  useAiRouting?: boolean;
};

export type BroadcastPreviewRoute = {
  routeId: string;
  instruction: string;
  targetType: BroadcastRouteTargetType;
  targetLabel: string;
  source: BroadcastRouteSource;
  confidence: number;
  recipientEmployeeIds: string[];
  unresolvedTargets: string[];
};

export type BroadcastSendRequest = {
  originalMessage: string;
  finalMessage: string;
  audienceCategory: BroadcastAudienceCategory;
  reviewedRoutes: Array<{
    routeId: string;
    targetLabel: string;
    source: BroadcastRouteSource;
    recipientEmployeeIds: string[];
    message: string;
  }>;
  allowEmptyRecipients?: boolean;
};

export type ReportKind = "individual_daily" | "team_daily" | "team_weekly" | "team_monthly";
