import { NextResponse } from "next/server";
import { env } from "@/lib/config";
import { processInboundWebhookPayload } from "@/lib/scheduling";
import {
  insertBroadcastDeliveryEvent,
  insertMessageEvent,
  updateBroadcastDeliveryStatusByMessageId,
  updateScheduledDeliveryStatusByMessageId,
} from "@/lib/repository";
import type { BroadcastDeliveryLifecycleStatus } from "@/lib/types";

type WebhookStatus = {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: Array<{ message?: string; title?: string; details?: string }>;
};

function parseStatuses(payload: Record<string, unknown>): WebhookStatus[] {
  const entry = Array.isArray(payload.entry) ? payload.entry : [];
  const statuses: WebhookStatus[] = [];

  for (const item of entry as Array<{ changes?: Array<{ value?: { statuses?: WebhookStatus[] } }> }>) {
    for (const change of item.changes ?? []) {
      for (const status of change.value?.statuses ?? []) {
        statuses.push(status);
      }
    }
  }

  return statuses;
}

function normalizeStatus(value: string | undefined): BroadcastDeliveryLifecycleStatus | null {
  const raw = String(value ?? "").toLowerCase();
  if (raw === "sent" || raw === "delivered" || raw === "read" || raw === "failed") {
    return raw;
  }
  return null;
}

function statusFailureReason(status: WebhookStatus): string | null {
  const first = status.errors?.[0];
  if (!first) return null;
  return first.message || first.title || first.details || null;
}

// Persist only the fields we read back, not the full status object, to keep
// stored payloads small (free-tier storage).
function compactStatus(status: WebhookStatus): Record<string, unknown> {
  return {
    id: status.id ?? null,
    status: status.status ?? null,
    timestamp: status.timestamp ?? null,
    recipient_id: status.recipient_id ?? null,
    errors: status.errors ?? null,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  try {
    const inbound = await processInboundWebhookPayload(payload);

    const statuses = parseStatuses(payload);
    let statusesProcessed = 0;
    let statusesMatched = 0;

    for (const status of statuses) {
      const messageId = status.id?.trim();
      const normalized = normalizeStatus(status.status);
      if (!messageId || !normalized) continue;

      const occurredAt = status.timestamp
        ? new Date(Number(status.timestamp) * 1000).toISOString()
        : new Date().toISOString();
      const failureReason = statusFailureReason(status);

      const updated = await updateBroadcastDeliveryStatusByMessageId({
        whatsappMessageId: messageId,
        status: normalized,
        failureReason,
        occurredAt,
        payload: compactStatus(status),
      });

      // Scheduled messages track delivery in their own table; the message id
      // belongs to one or the other, so the non-matching update is a no-op.
      if (!updated.deliveryId) {
        await updateScheduledDeliveryStatusByMessageId({
          whatsappMessageId: messageId,
          status: normalized,
          failureReason,
          occurredAt,
          payload: compactStatus(status),
        });
      }

      await insertBroadcastDeliveryEvent({
        deliveryId: updated.deliveryId,
        campaignId: updated.campaignId,
        employeeId: updated.employeeId,
        whatsappMessageId: messageId,
        status: normalized,
        failureReason,
        occurredAt,
        payload: compactStatus(status),
      });

      if (updated.employeeId) {
        await insertMessageEvent({
          employeeId: updated.employeeId,
          direction: "outbound",
          category: `ceo_broadcast_status_${normalized}`,
          whatsappMessageId: messageId,
          payload: compactStatus(status),
          messageText: null,
          receivedAt: occurredAt,
        });
        statusesMatched += 1;
      }

      statusesProcessed += 1;
    }

    return NextResponse.json({
      ok: true,
      inbound,
      statuses: {
        processed: statusesProcessed,
        matched: statusesMatched,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: (error as Error).message,
      },
      { status: 500 },
    );
  }
}
