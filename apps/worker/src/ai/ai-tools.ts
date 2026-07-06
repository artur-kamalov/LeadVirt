import { z } from "zod";
import { prisma, type Prisma } from "@leadvirt/db";
import type { AiActionType } from "@leadvirt/ai";
import { redactSensitiveText } from "@leadvirt/observability";

const leadStatusSchema = z.enum(["NEW", "IN_PROGRESS", "QUALIFIED", "BOOKED", "ORDERED", "SENT_TO_CRM", "CLOSED", "LOST"]);
const prioritySchema = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]);

const leadUpdateCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal("lead.update"),
  input: z
    .object({
      leadId: z.string().min(1),
      summary: z.string().trim().min(1).max(500).optional(),
      interest: z.string().trim().min(1).max(160).optional()
    })
    .refine((value) => Boolean(value.summary || value.interest), "lead.update requires summary or interest")
});

const leadNoteCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal("lead.note.create"),
  input: z.object({
    leadId: z.string().min(1),
    title: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(1000)
  })
});

const leadStatusCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal("lead.status.change"),
  input: z.object({
    leadId: z.string().min(1),
    status: leadStatusSchema,
    reason: z.string().trim().min(1).max(300)
  })
});

const bookingProposalCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal("booking.proposal.create"),
  input: z.object({
    leadId: z.string().min(1),
    title: z.string().trim().min(1).max(160),
    startsAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "startsAt must be a valid datetime"),
    notes: z.string().trim().max(1000).optional()
  })
});

const taskCreateCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal("task.create"),
  input: z.object({
    leadId: z.string().min(1),
    assignedToUserId: z.string().min(1).optional(),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(1000).optional(),
    priority: prioritySchema.default("NORMAL")
  })
});

const aiToolCallSchema = z.discriminatedUnion("type", [
  leadUpdateCallSchema,
  leadNoteCallSchema,
  leadStatusCallSchema,
  bookingProposalCallSchema,
  taskCreateCallSchema
]);

export type AiToolCall = z.infer<typeof aiToolCallSchema>;

export interface AiToolResult {
  callId: string;
  type: AiToolCall["type"];
  status: "SUCCESS" | "SKIPPED" | "FAILED";
  entityType?: string;
  entityId?: string;
  reason?: string;
}

export interface PlanAiToolCallsInput {
  tenantId: string;
  leadId?: string | null;
  currentLeadStatus?: string | null;
  requestedByUserId?: string | null;
  graphRunId: string;
  conversationId: string;
  normalizedText: string;
  extractedFields: Record<string, unknown>;
  recommendationAction: AiActionType | "none";
  recommendationReason: string;
  qualityPassed: boolean;
  handoffRequired: boolean;
  retrievedContext: Array<{ title: string; content: string }>;
}

export interface ExecuteAiToolCallsInput {
  tenantId: string;
  graphRunId: string;
  conversationId: string;
  calls: AiToolCall[];
}

function textField(fields: Record<string, unknown>, key: string) {
  const value = fields[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function callId(graphRunId: string, suffix: string) {
  return `${graphRunId}:${suffix}`;
}

function validDate(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function firstExactDateTime(text: string) {
  const iso = text.match(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})?\b/u)?.[0];
  const isoDate = validDate(iso);
  if (isoDate) return isoDate;

  const local = text.match(/\b(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?\b/u);
  if (!local) return undefined;
  return validDate(`${local[1]}T${local[2]}:00+03:00`);
}

function bookingCandidate(input: PlanAiToolCallsInput) {
  const haystack = [input.normalizedText, ...input.retrievedContext.map((item) => `${item.title} ${item.content}`)].join("\n");
  return firstExactDateTime(haystack);
}

function hasExplicitBookingIntent(input: PlanAiToolCallsInput) {
  const haystack = input.normalizedText.toLowerCase();
  return /\b(book|booking|appointment|schedule|slot)\b/u.test(haystack) || /запис|брон|слот|окн[оа]/iu.test(haystack);
}

function statusTimestamp(status: z.infer<typeof leadStatusSchema>, date: Date): Prisma.LeadUpdateInput {
  if (status === "QUALIFIED") return { qualifiedAt: date };
  if (status === "BOOKED") return { bookedAt: date };
  if (status === "SENT_TO_CRM") return { sentToCrmAt: date };
  if (status === "CLOSED" || status === "LOST") return { closedAt: date };
  return {};
}

async function ensureLead(tenantId: string, leadId: string) {
  return prisma.lead.findFirst({
    where: {
      id: leadId,
      tenantId,
      deletedAt: null
    },
    select: { id: true, status: true }
  });
}

async function ensureConversation(tenantId: string, conversationId: string) {
  return prisma.conversation.findFirst({
    where: {
      id: conversationId,
      tenantId,
      deletedAt: null
    },
    select: { id: true, leadId: true }
  });
}

async function userBelongsToTenant(tenantId: string, userId: string) {
  const membership = await prisma.membership.findFirst({
    where: {
      tenantId,
      userId,
      user: { deletedAt: null }
    },
    select: { id: true }
  });
  return Boolean(membership);
}

export function planAiToolCalls(input: PlanAiToolCallsInput): AiToolCall[] {
  if (!input.leadId) return [];

  const calls: AiToolCall[] = [];
  const summary = textField(input.extractedFields, "summary");
  const interest = textField(input.extractedFields, "interest");

  if (summary || interest) {
    calls.push(
      aiToolCallSchema.parse({
        id: callId(input.graphRunId, "lead-update"),
        type: "lead.update",
        input: {
          leadId: input.leadId,
          ...(summary ? { summary } : {}),
          ...(interest ? { interest } : {})
        }
      })
    );
  }

  calls.push(
    aiToolCallSchema.parse({
      id: callId(input.graphRunId, "lead-note"),
      type: "lead.note.create",
      input: {
        leadId: input.leadId,
        title: "AI processing note",
        message: input.qualityPassed
          ? `Recommendation: ${input.recommendationAction}. ${input.recommendationReason}`
          : `Quality gate blocked an automatic action. ${input.recommendationReason}`
      }
    })
  );

  if (input.currentLeadStatus === "NEW") {
    calls.push(
      aiToolCallSchema.parse({
        id: callId(input.graphRunId, "status-in-progress"),
        type: "lead.status.change",
        input: {
          leadId: input.leadId,
          status: "IN_PROGRESS",
          reason: "AI started processing the lead"
        }
      })
    );
  }

  const startsAt =
    input.qualityPassed && (input.recommendationAction === "create_booking_draft" || hasExplicitBookingIntent(input))
      ? bookingCandidate(input)
      : undefined;
  if (startsAt) {
    calls.push(
      aiToolCallSchema.parse({
        id: callId(input.graphRunId, "booking-proposal"),
        type: "booking.proposal.create",
        input: {
          leadId: input.leadId,
          title: interest ? `Booking proposal: ${interest}` : "Booking proposal",
          startsAt: startsAt.toISOString(),
          notes: `Created by AI graph ${input.graphRunId}. Manager must confirm before final booking.`
        }
      })
    );
    calls.push(
      aiToolCallSchema.parse({
        id: callId(input.graphRunId, "status-booked"),
        type: "lead.status.change",
        input: {
          leadId: input.leadId,
          status: "BOOKED",
          reason: "AI created a draft booking proposal"
        }
      })
    );
  }

  if (input.handoffRequired || (input.qualityPassed && input.recommendationAction === "request_human_handoff")) {
    calls.push(
      aiToolCallSchema.parse({
        id: callId(input.graphRunId, "handoff-task"),
        type: "task.create",
        input: {
          leadId: input.leadId,
          ...(input.requestedByUserId ? { assignedToUserId: input.requestedByUserId } : {}),
          title: "Review AI handoff",
          description: input.recommendationReason,
          priority: "HIGH"
        }
      })
    );
  }

  return calls;
}

export async function executeAiToolCalls(input: ExecuteAiToolCallsInput): Promise<AiToolResult[]> {
  const results: AiToolResult[] = [];
  const conversation = await ensureConversation(input.tenantId, input.conversationId);
  if (!conversation) {
    return input.calls.map((call) => ({
      callId: call.id,
      type: call.type,
      status: "SKIPPED",
      reason: "conversation_not_found"
    }));
  }

  for (const rawCall of input.calls) {
    const parsed = aiToolCallSchema.safeParse(rawCall);
    if (!parsed.success) {
      results.push({
        callId: rawCall.id,
        type: rawCall.type,
        status: "FAILED",
        reason: parsed.error.issues.map((issue) => issue.message).join("; ")
      });
      continue;
    }

    const call = parsed.data;
    const lead = await ensureLead(input.tenantId, call.input.leadId);
    if (!lead) {
      results.push({ callId: call.id, type: call.type, status: "SKIPPED", reason: "lead_not_found" });
      continue;
    }
    if (conversation.leadId && conversation.leadId !== call.input.leadId) {
      results.push({ callId: call.id, type: call.type, status: "SKIPPED", reason: "lead_not_in_conversation" });
      continue;
    }

    try {
      if (call.type === "lead.update") {
        const lead = await prisma.lead.update({
          where: { id: call.input.leadId },
          data: {
            ...(call.input.summary ? { summary: call.input.summary } : {}),
            ...(call.input.interest ? { interest: call.input.interest } : {}),
            updatedAt: new Date()
          },
          select: { id: true }
        });
        results.push({ callId: call.id, type: call.type, status: "SUCCESS", entityType: "lead", entityId: lead.id });
        continue;
      }

      if (call.type === "lead.note.create") {
        const event = await prisma.leadEvent.create({
          data: {
            tenantId: input.tenantId,
            leadId: call.input.leadId,
            type: "ai_tool_note",
            title: call.input.title,
            message: call.input.message,
            metadata: {
              graphRunId: input.graphRunId,
              conversationId: input.conversationId,
              toolCallId: call.id
            }
          }
        });
        results.push({ callId: call.id, type: call.type, status: "SUCCESS", entityType: "lead_event", entityId: event.id });
        continue;
      }

      if (call.type === "lead.status.change") {
        const now = new Date();
        const lead = await prisma.lead.update({
          where: { id: call.input.leadId },
          data: {
            status: call.input.status,
            ...statusTimestamp(call.input.status, now),
            updatedAt: now
          },
          select: { id: true }
        });
        await prisma.leadEvent.create({
          data: {
            tenantId: input.tenantId,
            leadId: call.input.leadId,
            type: "ai_tool_status_changed",
            title: "AI changed lead status",
            message: call.input.reason,
            metadata: {
              graphRunId: input.graphRunId,
              conversationId: input.conversationId,
              toolCallId: call.id,
              status: call.input.status
            }
          }
        });
        results.push({ callId: call.id, type: call.type, status: "SUCCESS", entityType: "lead", entityId: lead.id });
        continue;
      }

      if (call.type === "booking.proposal.create") {
        const startsAt = new Date(call.input.startsAt);
        const booking = await prisma.booking.create({
          data: {
            tenantId: input.tenantId,
            leadId: call.input.leadId,
            title: call.input.title,
            startsAt,
            endsAt: new Date(startsAt.getTime() + 60 * 60_000),
            status: "DRAFT",
            notes: call.input.notes ?? null,
            metadata: {
              graphRunId: input.graphRunId,
              conversationId: input.conversationId,
              toolCallId: call.id,
              requiresManagerConfirmation: true
            }
          }
        });
        await prisma.leadEvent.create({
          data: {
            tenantId: input.tenantId,
            leadId: call.input.leadId,
            type: "ai_tool_booking_proposed",
            title: "AI created booking proposal",
            message: `${call.input.title} at ${startsAt.toISOString()}`,
            metadata: {
              graphRunId: input.graphRunId,
              conversationId: input.conversationId,
              toolCallId: call.id,
              bookingId: booking.id
            }
          }
        });
        results.push({ callId: call.id, type: call.type, status: "SUCCESS", entityType: "booking", entityId: booking.id });
        continue;
      }

      if (call.type === "task.create") {
        if (call.input.assignedToUserId && !(await userBelongsToTenant(input.tenantId, call.input.assignedToUserId))) {
          results.push({ callId: call.id, type: call.type, status: "SKIPPED", reason: "assigned_user_not_in_tenant" });
          continue;
        }

        const task = await prisma.task.create({
          data: {
            tenantId: input.tenantId,
            leadId: call.input.leadId,
            assignedToUserId: call.input.assignedToUserId ?? null,
            title: call.input.title,
            description: call.input.description ?? null,
            priority: call.input.priority,
            metadata: {
              graphRunId: input.graphRunId,
              conversationId: input.conversationId,
              toolCallId: call.id
            }
          }
        });
        results.push({ callId: call.id, type: call.type, status: "SUCCESS", entityType: "task", entityId: task.id });
      }
    } catch (error) {
      results.push({
        callId: call.id,
        type: call.type,
        status: "FAILED",
        reason: error instanceof Error ? redactSensitiveText(error.message) : "tool_execution_failed"
      });
    }
  }

  return results;
}
