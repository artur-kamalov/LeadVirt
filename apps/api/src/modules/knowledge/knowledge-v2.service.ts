import { randomUUID } from "node:crypto";
import { HttpStatus, Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma, type KnowledgeV2Settings } from "@leadvirt/db";
import {
  compareKnowledgeCanonicalText,
  knowledgeV2TenantDefaultScopeHash,
  type KnowledgeV2PersistedScope,
} from "@leadvirt/knowledge";
import type {
  KnowledgeV2ActorView,
  KnowledgeV2ApproverRole,
  KnowledgeV2CreateFactRequest,
  KnowledgeV2CreateGuidanceRuleRequest,
  KnowledgeV2EvidenceView,
  KnowledgeV2EmbeddingProviderPolicy,
  KnowledgeV2FactAction,
  KnowledgeV2FactDecisionRequest,
  KnowledgeV2FactPage,
  KnowledgeV2FactView,
  KnowledgeV2GuidanceCondition,
  KnowledgeV2GuidanceDecisionRequest,
  KnowledgeV2GuidanceRuleAction,
  KnowledgeV2GuidanceRulePage,
  KnowledgeV2GuidanceRuleView,
  KnowledgeV2JsonValue,
  KnowledgeV2ModelProcessorPolicy,
  KnowledgeV2MutationResult,
  KnowledgeV2PublicationScheduleView,
  KnowledgeV2RetrievalProcessorPolicy,
  KnowledgeV2ScopeInput,
  KnowledgeV2SecurityClassification,
  KnowledgeV2SettingsView,
  KnowledgeV2UpdateFactRequest,
  KnowledgeV2UpdateGuidanceRuleRequest,
  KnowledgeV2UpdateSettingsRequest,
} from "@leadvirt/types";
import type { RequestContext } from "../../common/request-context.js";
import { AppConfigService } from "../../config/app-config.service.js";
import { PrismaService } from "../database/prisma.service.js";
import type { KnowledgeV2FactListQueryDto } from "./dto/knowledge-v2-fact.dto.js";
import type { KnowledgeV2GuidanceListQueryDto } from "./dto/knowledge-v2-guidance.dto.js";
import {
  isKnowledgeV2GuidanceCondition,
  isKnowledgeV2PublicationSchedule,
} from "./dto/knowledge-v2-validation.js";
import {
  assertIfMatch,
  canonicalKnowledgeV2Hash,
  decodeKnowledgeV2Cursor,
  encodeKnowledgeV2Cursor,
  knowledgeV2Error,
  strongKnowledgeV2Etag,
} from "./knowledge-v2-http.js";
import {
  KnowledgeV2IdempotencyService,
  type KnowledgeV2IdempotencyResult,
} from "./knowledge-v2-idempotency.service.js";
import { enqueueKnowledgeV2ContentReconciliation } from "./knowledge-v2-content-reconciliation.service.js";
import { knowledgeV2ScopeView as scopeView } from "./knowledge-v2-scope.js";

const factInclude = {
  versions: {
    orderBy: { versionNumber: "desc" },
    take: 1,
    include: { evidence: true },
  },
} satisfies Prisma.KnowledgeV2FactInclude;

const guidanceInclude = {
  versions: {
    orderBy: { versionNumber: "desc" },
    take: 1,
    include: { evidence: true },
  },
} satisfies Prisma.KnowledgeV2GuidanceRuleInclude;

type FactRecord = Prisma.KnowledgeV2FactGetPayload<{ include: typeof factInclude }>;
type FactVersionRecord = FactRecord["versions"][number];
type GuidanceRecord = Prisma.KnowledgeV2GuidanceRuleGetPayload<{
  include: typeof guidanceInclude;
}>;
type GuidanceVersionRecord = GuidanceRecord["versions"][number];
type EvidenceRecord = FactVersionRecord["evidence"][number];
type ActorMap = ReadonlyMap<string, KnowledgeV2ActorView>;

type EvidenceHashSource = Pick<
  EvidenceRecord,
  | "kind"
  | "legacyRevisionId"
  | "label"
  | "locator"
  | "isPublic"
  | "sourceReference"
  | "elementReference"
  | "quoteHash"
  | "confidence"
  | "metadata"
>;

interface FactMaterial {
  normalizedValue: KnowledgeV2JsonValue;
  displayValue: string | null;
  localizedValues: Prisma.JsonValue | null;
  unit: string | null;
  currency: string | null;
  timeZone: string | null;
  locale: string;
  localeBehavior: FactVersionRecord["localeBehavior"];
  scope: Prisma.InputJsonObject | null;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
  riskLevel: FactVersionRecord["riskLevel"];
  authority: FactVersionRecord["authority"];
  extractionConfidence: number | null;
  extractionModelVersion: string | null;
}

interface GuidanceMaterial {
  title: string;
  ruleType: GuidanceVersionRecord["ruleType"];
  condition: KnowledgeV2GuidanceCondition;
  instruction: string;
  outcome: Prisma.JsonValue | null;
  priority: number;
  tieBreakKey: string;
  tieBreakPolicy: string;
  scope: Prisma.InputJsonObject | null;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
  riskLevel: GuidanceVersionRecord["riskLevel"];
  requiredApproverRole: KnowledgeV2ApproverRole | null;
  examples: string[];
}

const defaultSettings = {
  defaultLocale: "en",
  supportedLocales: ["en"],
  defaultScope: null,
  defaultScopeGeneration: 0,
  defaultScopeHash: null,
  autoPublishPolicy: "OFF" as const,
  publicationApprovalPolicy: "OWNER_OR_ADMIN" as const,
  publicationSchedule: null,
  embeddingProviderPolicy: null,
  retrievalProcessorPolicy: null,
  modelProcessorPolicy: null,
  etag: 1,
};

const embeddingClassificationOrder: KnowledgeV2SecurityClassification[] = [
  "PUBLIC",
  "INTERNAL",
  "CUSTOMER_PERSONAL",
  "SENSITIVE",
  "SECRET",
];

function record(value: Prisma.JsonValue | null | undefined): Record<string, Prisma.JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function strings(value: Prisma.JsonValue | undefined) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function sortedUnique(values: readonly string[] | undefined) {
  return [...new Set(values ?? [])].sort(compareKnowledgeCanonicalText);
}

function canonicalLocale(value: string) {
  try {
    const canonical = Intl.getCanonicalLocales(value)[0];
    if (!canonical) throw new Error("missing canonical locale");
    return canonical;
  } catch {
    throw knowledgeV2Error(
      HttpStatus.BAD_REQUEST,
      "KNOWLEDGE_VALIDATION_LOCALE_INVALID",
      "The locale is invalid.",
      { field: "locale" },
    );
  }
}

function canonicalLocales(values: readonly string[]) {
  return [...new Set(values.map(canonicalLocale))];
}

function canonicalScope(
  value: KnowledgeV2ScopeInput | null | undefined,
): Prisma.InputJsonObject | null {
  if (value === null || value === undefined) return null;
  return {
    brandIds: sortedUnique(value.brandIds),
    locationIds: sortedUnique(value.locationIds),
    channelTypes: sortedUnique(value.channelTypes),
    assistantIds: sortedUnique(value.assistantIds),
    audiences: sortedUnique(value.audiences),
    segments: sortedUnique(value.segments),
    locales: sortedUnique(value.locales?.map(canonicalLocale)),
  };
}

function assertExplicitScopeAudience(scope: Prisma.InputJsonObject | null, field = "scope") {
  if (scope === null) return;
  const audiences = scope.audiences;
  if (!Array.isArray(audiences) || audiences.length === 0) {
    throw knowledgeV2Error(
      HttpStatus.BAD_REQUEST,
      "KNOWLEDGE_VALIDATION_SCOPE_AUDIENCE_REQUIRED",
      "An explicit knowledge scope must include at least one audience.",
      { field: `${field}.audiences` },
    );
  }
}

function optionalJson(value: Prisma.JsonValue | Prisma.InputJsonValue | null | undefined) {
  return value === null || value === undefined ? Prisma.DbNull : value;
}

function scheduleJson(
  value: KnowledgeV2UpdateSettingsRequest["publicationSchedule"] | Prisma.JsonValue,
) {
  if (value === null || value === undefined) return Prisma.DbNull;
  const source = value as {
    timeZone: string;
    daysOfWeek: number[];
    hour: number;
    minute: number;
  };
  return {
    timeZone: source.timeZone,
    daysOfWeek: [...source.daysOfWeek].sort((left, right) => left - right),
    hour: source.hour,
    minute: source.minute,
  } satisfies Prisma.InputJsonObject;
}

function requiredJson(value: KnowledgeV2JsonValue | KnowledgeV2GuidanceCondition) {
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function dateInput(value: string | null | undefined, field: string): Date | null {
  if (value === null || value === undefined) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw knowledgeV2Error(
      HttpStatus.BAD_REQUEST,
      "KNOWLEDGE_VALIDATION_TIMESTAMP_INVALID",
      "The effective date is invalid.",
      { field },
    );
  }
  return parsed;
}

function assertDateWindow(effectiveFrom: Date | null, effectiveUntil: Date | null) {
  if (effectiveFrom && effectiveUntil && effectiveUntil <= effectiveFrom) {
    throw knowledgeV2Error(
      HttpStatus.BAD_REQUEST,
      "KNOWLEDGE_VALIDATION_EFFECTIVE_WINDOW_INVALID",
      "effectiveUntil must be later than effectiveFrom.",
      { field: "effectiveUntil" },
    );
  }
}

function dateValue(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

function assertNoEvidenceIds(evidenceIds: string[] | undefined) {
  if ((evidenceIds?.length ?? 0) > 0) {
    throw knowledgeV2Error(
      HttpStatus.BAD_REQUEST,
      "KNOWLEDGE_VALIDATION_EVIDENCE_REFERENCES_UNSUPPORTED",
      "Existing evidence cannot be attached through this endpoint yet.",
      { field: "evidenceIds" },
    );
  }
}

function mutationResult<T>(result: KnowledgeV2IdempotencyResult<T>): KnowledgeV2MutationResult<T> {
  return {
    resource: result.responseBody,
    idempotencyReplayed: result.idempotencyReplayed,
  };
}

function actorMapForContext(context: RequestContext): ActorMap {
  return new Map([
    [
      context.userId,
      {
        id: context.userId,
        displayName: context.user.name?.trim() || "Workspace member",
      },
    ],
  ]);
}

function evidenceHashValue(evidence: EvidenceHashSource) {
  return {
    kind: evidence.kind,
    legacyRevisionId: evidence.legacyRevisionId,
    label: evidence.label,
    locator: evidence.locator,
    isPublic: evidence.isPublic,
    sourceReference: evidence.sourceReference,
    elementReference: evidence.elementReference,
    quoteHash: evidence.quoteHash,
    confidence: evidence.confidence,
    metadata: evidence.metadata,
  };
}

function evidenceView(evidence: EvidenceRecord): KnowledgeV2EvidenceView {
  const source = record(evidence.sourceReference);
  const sourceId = typeof source.sourceId === "string" ? source.sourceId : null;
  const documentId = typeof source.documentId === "string" ? source.documentId : null;
  const revisionId =
    evidence.legacyRevisionId ?? (typeof source.revisionId === "string" ? source.revisionId : null);
  return {
    id: evidence.id,
    sourceId,
    documentId,
    revisionId,
    label: evidence.label,
    locator: evidence.locator,
    isPublic: evidence.isPublic,
  };
}

function canEdit(context: RequestContext) {
  return context.role === "OWNER" || context.role === "ADMIN" || context.role === "MANAGER";
}

function canVerifyRisk(context: RequestContext, riskLevel: string) {
  if (context.role === "OWNER" || context.role === "ADMIN") return true;
  return context.role === "MANAGER" && riskLevel !== "HIGH" && riskLevel !== "CRITICAL";
}

function canApproveRole(context: RequestContext, requiredRole: KnowledgeV2ApproverRole | null) {
  if (requiredRole === "OWNER") return context.role === "OWNER";
  if (requiredRole === "ADMIN") return context.role === "OWNER" || context.role === "ADMIN";
  return canEdit(context);
}

function approverRole(value: string | null): KnowledgeV2ApproverRole | null {
  return value === "OWNER" || value === "ADMIN" || value === "MANAGER" ? value : null;
}

function canViewScope(context: RequestContext, value: Prisma.JsonValue | null) {
  if (context.role === "OWNER" || context.role === "ADMIN" || context.role === "MANAGER") {
    return true;
  }
  return !scopeView(value).audiences.includes("INTERNAL");
}

function factActions(context: RequestContext, version: FactVersionRecord): KnowledgeV2FactAction[] {
  if (!canEdit(context)) return [];
  const actions: KnowledgeV2FactAction[] = ["EDIT"];
  if (version.verificationStatus !== "VERIFIED" && canVerifyRisk(context, version.riskLevel)) {
    actions.push("VERIFY");
  }
  if (version.verificationStatus !== "REJECTED") actions.push("REJECT");
  return actions;
}

function guidanceActions(
  context: RequestContext,
  version: GuidanceVersionRecord,
): KnowledgeV2GuidanceRuleAction[] {
  if (!canEdit(context)) return [];
  const actions: KnowledgeV2GuidanceRuleAction[] = ["EDIT"];
  if (
    version.reviewStatus !== "APPROVED" &&
    version.reviewStatus !== "DISABLED" &&
    canVerifyRisk(context, version.riskLevel) &&
    canApproveRole(context, approverRole(version.requiredApproverRole))
  ) {
    actions.push("APPROVE");
  }
  if (version.reviewStatus !== "REJECTED" && version.reviewStatus !== "DISABLED") {
    actions.push("REJECT");
  }
  if (version.reviewStatus !== "DISABLED") actions.push("DISABLE");
  return actions;
}

function guidanceCondition(value: Prisma.JsonValue): KnowledgeV2GuidanceCondition {
  if (!isKnowledgeV2GuidanceCondition(value)) {
    throw knowledgeV2Error(
      HttpStatus.INTERNAL_SERVER_ERROR,
      "KNOWLEDGE_DEPENDENCY_GUIDANCE_CONDITION_INVALID",
      "A guidance rule could not be read safely.",
    );
  }
  return value as KnowledgeV2GuidanceCondition;
}

function examplesView(value: Prisma.JsonValue | null) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

@Injectable()
export class KnowledgeV2Service {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeV2IdempotencyService)
    private readonly idempotency: KnowledgeV2IdempotencyService,
    @Optional() @Inject(AppConfigService) private readonly config?: AppConfigService,
  ) {}

  async getSettings(context: RequestContext): Promise<KnowledgeV2SettingsView> {
    const [settings, tenant] = await Promise.all([
      this.prisma.knowledgeV2Settings.findUnique({ where: { tenantId: context.tenantId } }),
      this.prisma.tenant.findUnique({
        where: { id: context.tenantId },
        select: { id: true, createdAt: true },
      }),
    ]);
    if (!tenant) throw this.notFound("settings");
    if (!settings) {
      return {
        version: defaultSettings.etag,
        etag: strongKnowledgeV2Etag("settings", context.tenantId, defaultSettings.etag),
        defaultLocale: defaultSettings.defaultLocale,
        supportedLocales: defaultSettings.supportedLocales,
        defaultScope: defaultSettings.defaultScope,
        defaultScopeGeneration: defaultSettings.defaultScopeGeneration,
        defaultScopeHash: defaultSettings.defaultScopeHash,
        autoPublishPolicy: defaultSettings.autoPublishPolicy,
        publicationApprovalPolicy: defaultSettings.publicationApprovalPolicy,
        publicationSchedule: null,
        embeddingProviderPolicy: null,
        retrievalProcessorPolicy: null,
        modelProcessorPolicy: null,
        createdAt: tenant.createdAt.toISOString(),
        updatedAt: tenant.createdAt.toISOString(),
        updatedBy: null,
      };
    }
    return this.settingsView(settings);
  }

  async updateSettings(
    context: RequestContext,
    input: KnowledgeV2UpdateSettingsRequest,
    idempotencyKey: string,
    ifMatch: string[],
  ): Promise<KnowledgeV2MutationResult<KnowledgeV2SettingsView>> {
    this.assertSettingsEditor(context);
    const result = await this.idempotency.execute(
      {
        tenantId: context.tenantId,
        endpoint: "PATCH:/knowledge/v2/settings",
        key: idempotencyKey,
        request: { body: input, ifMatch },
      },
      async (tx) => {
        const current = await this.lockSettings(tx, context.tenantId);
        assertIfMatch(
          ifMatch,
          strongKnowledgeV2Etag("settings", context.tenantId, current.etag),
          current.etag,
          [
            "defaultLocale",
            "supportedLocales",
            "defaultScope",
            "autoPublishPolicy",
            "publicationApprovalPolicy",
            "publicationSchedule",
            "embeddingProviderPolicy",
            "retrievalProcessorPolicy",
            "modelProcessorPolicy",
          ],
        );

        const defaultLocale = canonicalLocale(input.defaultLocale ?? current.defaultLocale);
        const supportedLocales = canonicalLocales(
          input.supportedLocales ?? current.supportedLocales,
        );
        if (!supportedLocales.includes(defaultLocale)) {
          throw knowledgeV2Error(
            HttpStatus.BAD_REQUEST,
            "KNOWLEDGE_VALIDATION_SUPPORTED_LOCALES_MISSING_DEFAULT",
            "supportedLocales must include defaultLocale.",
            { field: "supportedLocales" },
          );
        }
        const currentDefaultScope = this.storedDefaultScope(current);
        const defaultScope =
          input.defaultScope === undefined
            ? currentDefaultScope
            : canonicalScope(input.defaultScope);
        assertExplicitScopeAudience(defaultScope, "defaultScope");
        this.assertSupportedLocales(
          { defaultLocale, supportedLocales },
          null,
          defaultScope,
          "defaultScope",
        );
        const defaultScopeHash = defaultScope
          ? knowledgeV2TenantDefaultScopeHash(defaultScope as unknown as KnowledgeV2PersistedScope)
          : null;
        const defaultScopeChanged = defaultScopeHash !== current.defaultScopeHash;
        const defaultScopeGeneration =
          current.defaultScopeGeneration + (defaultScopeChanged ? 1 : 0);
        const autoPublishPolicy = input.autoPublishPolicy ?? current.autoPublishPolicy;
        const publicationSchedule =
          input.publicationSchedule === undefined
            ? current.publicationSchedule
            : input.publicationSchedule;
        const embeddingProviderPolicy =
          input.embeddingProviderPolicy === undefined
            ? this.embeddingProviderPolicy(current.embeddingProviderPolicy)
            : input.embeddingProviderPolicy === null
              ? null
              : this.validateEmbeddingProviderPolicy(input.embeddingProviderPolicy);
        const retrievalProcessorPolicy =
          input.retrievalProcessorPolicy === undefined
            ? this.retrievalProcessorPolicy(current.retrievalProcessorPolicy)
            : input.retrievalProcessorPolicy === null
              ? null
              : this.validateRetrievalProcessorPolicy(input.retrievalProcessorPolicy);
        const modelProcessorPolicy =
          input.modelProcessorPolicy === undefined
            ? this.modelProcessorPolicy(current.modelProcessorPolicy)
            : input.modelProcessorPolicy === null
              ? null
              : this.validateModelProcessorPolicy(input.modelProcessorPolicy);
        if (autoPublishPolicy === "SCHEDULED" && !publicationSchedule) {
          throw knowledgeV2Error(
            HttpStatus.BAD_REQUEST,
            "KNOWLEDGE_VALIDATION_PUBLICATION_SCHEDULE_REQUIRED",
            "A publication schedule is required for scheduled publishing.",
            { field: "publicationSchedule" },
          );
        }

        const updated = await tx.knowledgeV2Settings.update({
          where: { tenantId: context.tenantId },
          data: {
            defaultLocale,
            supportedLocales,
            defaultScope: optionalJson(defaultScope),
            defaultScopeGeneration,
            defaultScopeHash,
            autoPublishPolicy,
            publicationApprovalPolicy:
              input.publicationApprovalPolicy ?? current.publicationApprovalPolicy,
            publicationSchedule: scheduleJson(publicationSchedule),
            embeddingProviderPolicy:
              embeddingProviderPolicy === null
                ? Prisma.DbNull
                : (embeddingProviderPolicy as Prisma.InputJsonObject),
            retrievalProcessorPolicy:
              retrievalProcessorPolicy === null
                ? Prisma.DbNull
                : (retrievalProcessorPolicy as unknown as Prisma.InputJsonObject),
            modelProcessorPolicy:
              modelProcessorPolicy === null
                ? Prisma.DbNull
                : (modelProcessorPolicy as unknown as Prisma.InputJsonObject),
            draftGeneration: { increment: 1 },
            etag: { increment: 1 },
          },
        });
        await this.audit(tx, context, "knowledge.v2.settings_updated", context.tenantId, {
          version: updated.etag,
          defaultLocale,
          supportedLocales,
          previousDefaultScopeGeneration: current.defaultScopeGeneration,
          previousDefaultScopeHash: current.defaultScopeHash,
          defaultScopeGeneration,
          defaultScopeHash,
          defaultScopeChanged,
          autoPublishPolicy,
          publicationApprovalPolicy: updated.publicationApprovalPolicy,
          embeddingProviderPolicyHash: embeddingProviderPolicy
            ? canonicalKnowledgeV2Hash(embeddingProviderPolicy)
            : null,
          retrievalProcessorPolicyHash: retrievalProcessorPolicy
            ? canonicalKnowledgeV2Hash(retrievalProcessorPolicy)
            : null,
          modelProcessorPolicyHash: modelProcessorPolicy
            ? canonicalKnowledgeV2Hash(modelProcessorPolicy)
            : null,
        });
        return {
          httpStatus: HttpStatus.OK,
          responseBody: this.settingsView(updated, actorMapForContext(context).get(context.userId)),
          responseRef: context.tenantId,
        };
      },
    );
    return mutationResult(result);
  }

  async listFacts(
    context: RequestContext,
    query: KnowledgeV2FactListQueryDto,
  ): Promise<KnowledgeV2FactPage> {
    const cursor = decodeKnowledgeV2Cursor(query.cursor);
    const limit = query.limit ?? 25;
    const take = Math.min((limit + 1) * 4, 404);
    const rows = await this.prisma.knowledgeV2Fact.findMany({
      where: {
        tenantId: context.tenantId,
        deletedAt: null,
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.createdAt) } },
                { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
              ],
            }
          : {}),
        ...(query.query
          ? {
              AND: [
                {
                  OR: [
                    { factKey: { contains: query.query, mode: "insensitive" } },
                    { entityType: { contains: query.query, mode: "insensitive" } },
                    { fieldType: { contains: query.query, mode: "insensitive" } },
                    {
                      versions: {
                        some: { displayValue: { contains: query.query, mode: "insensitive" } },
                      },
                    },
                  ],
                },
              ],
            }
          : {}),
      },
      include: factInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
    });
    const actorMap = await this.actorMap(
      context,
      rows.flatMap((row) => {
        const version = row.versions[0];
        return version?.verifiedByUserId ? [version.verifiedByUserId] : [];
      }),
    );
    const activeFactVersionIds = await this.activeFactVersionIds(context.tenantId);
    const matching = rows.filter((row) => {
      const version = row.versions[0];
      if (!version || !canViewScope(context, version.scope)) return false;
      if (
        query.query &&
        ![row.factKey, row.entityType, row.fieldType, version.displayValue ?? ""]
          .join("\n")
          .toLocaleLowerCase()
          .includes(query.query.toLocaleLowerCase())
      ) {
        return false;
      }
      if (query.riskLevel && version.riskLevel !== query.riskLevel) return false;
      if (query.authority && version.authority !== query.authority) return false;
      if (query.verificationStatus && version.verificationStatus !== query.verificationStatus) {
        return false;
      }
      if (query.lifecycleStatus && version.lifecycleStatus !== query.lifecycleStatus) return false;
      if (query.locale && version.locale !== canonicalLocale(query.locale)) return false;
      return true;
    });
    const pageRows = matching.slice(0, limit);
    const hasNextPage = matching.length > limit || rows.length === take;
    const cursorRow = pageRows.at(-1) ?? (hasNextPage ? rows.at(-1) : undefined);
    return {
      items: pageRows.map((row) => this.factView(context, row, actorMap, activeFactVersionIds)),
      pageInfo: {
        limit,
        hasNextPage,
        nextCursor:
          hasNextPage && cursorRow
            ? encodeKnowledgeV2Cursor({
                createdAt: cursorRow.createdAt.toISOString(),
                id: cursorRow.id,
              })
            : null,
      },
    };
  }

  async createFact(
    context: RequestContext,
    input: KnowledgeV2CreateFactRequest,
    idempotencyKey: string,
  ): Promise<KnowledgeV2MutationResult<KnowledgeV2FactView>> {
    this.assertEditor(context);
    assertNoEvidenceIds(input.evidenceIds);
    const result = await this.idempotency.execute(
      {
        tenantId: context.tenantId,
        endpoint: "POST:/knowledge/v2/facts",
        key: idempotencyKey,
        request: input,
      },
      async (tx) => {
        if (input.authority !== undefined && input.authority !== "MANUAL") {
          throw knowledgeV2Error(
            HttpStatus.BAD_REQUEST,
            "KNOWLEDGE_VALIDATION_AUTHORITY_READ_ONLY",
            "Manual fact creation cannot assert imported or verified authority.",
            { field: "authority" },
          );
        }
        const settings = await this.lockSettings(tx, context.tenantId);
        const existing = await tx.knowledgeV2Fact.findUnique({
          where: {
            tenantId_factKey: { tenantId: context.tenantId, factKey: input.factKey },
          },
          select: { id: true },
        });
        if (existing) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_CONFLICT_FACT_KEY_EXISTS",
            "A fact with this key already exists.",
            { field: "factKey" },
          );
        }
        await this.assertEntity(tx, context.tenantId, input.entityId, input.entityType);
        const material = this.factMaterial(input, null, settings);
        const fact = await tx.knowledgeV2Fact.create({
          data: {
            tenantId: context.tenantId,
            factKey: input.factKey,
            entityType: input.entityType,
            entityId: input.entityId ?? null,
            fieldType: input.fieldType,
            latestVersionNumber: 1,
            createdByUserId: context.userId,
            updatedByUserId: context.userId,
          },
        });
        const createdAt = new Date();
        const manualEvidence = this.manualEvidence(context, material.scope);
        const immutableHash = this.factHash({
          fact,
          versionNumber: 1,
          material,
          lifecycleStatus: "DRAFT",
          verificationStatus: "UNVERIFIED",
          changeReason: null,
          supersedesVersionId: null,
          createdByUserId: context.userId,
          verifiedByUserId: null,
          verifiedAt: null,
          rejectedByUserId: null,
          rejectedAt: null,
          createdAt,
          evidence: [manualEvidence],
        });
        const version = await tx.knowledgeV2FactVersion.create({
          data: {
            tenantId: context.tenantId,
            factId: fact.id,
            versionNumber: 1,
            ...this.factVersionData(material),
            immutableHash,
            createdByUserId: context.userId,
            createdAt,
          },
        });
        await this.createManualEvidence(tx, context.tenantId, manualEvidence, {
          factVersionId: version.id,
          guidanceRuleVersionId: null,
        });
        const draftGeneration = await this.bumpDraftGeneration(tx, context.tenantId);
        await enqueueKnowledgeV2ContentReconciliation(tx, {
          tenantId: context.tenantId,
          resourceType: "FACT",
          resourceId: fact.id,
          resourceGeneration: fact.generation,
          versionId: version.id,
          versionNumber: version.versionNumber,
          versionHash: version.immutableHash,
          draftGeneration,
          action: "CREATE",
          actorUserId: context.userId,
          requestedRole: context.role,
          mutationIdempotencyKey: idempotencyKey,
        });
        await this.audit(tx, context, "knowledge.v2.fact_created", fact.id, {
          factKey: fact.factKey,
          entityType: fact.entityType,
          fieldType: fact.fieldType,
          version: 1,
        });
        const record = await this.getFactRecord(tx, context.tenantId, fact.id);
        return {
          httpStatus: HttpStatus.CREATED,
          responseBody: this.factView(context, record, actorMapForContext(context)),
          responseRef: fact.id,
        };
      },
    );
    return mutationResult(result);
  }

  async updateFact(
    context: RequestContext,
    id: string,
    input: KnowledgeV2UpdateFactRequest,
    idempotencyKey: string,
    ifMatch: string[],
  ): Promise<KnowledgeV2MutationResult<KnowledgeV2FactView>> {
    this.assertEditor(context);
    assertNoEvidenceIds(input.evidenceIds);
    return this.mutateFact(context, id, input, idempotencyKey, ifMatch, "update");
  }

  async verifyFact(
    context: RequestContext,
    id: string,
    input: KnowledgeV2FactDecisionRequest,
    idempotencyKey: string,
    ifMatch: string[],
  ): Promise<KnowledgeV2MutationResult<KnowledgeV2FactView>> {
    this.assertEditor(context);
    return this.mutateFact(context, id, input, idempotencyKey, ifMatch, "verify");
  }

  async rejectFact(
    context: RequestContext,
    id: string,
    input: KnowledgeV2FactDecisionRequest,
    idempotencyKey: string,
    ifMatch: string[],
  ): Promise<KnowledgeV2MutationResult<KnowledgeV2FactView>> {
    this.assertEditor(context);
    return this.mutateFact(context, id, input, idempotencyKey, ifMatch, "reject");
  }

  async listGuidance(
    context: RequestContext,
    query: KnowledgeV2GuidanceListQueryDto,
  ): Promise<KnowledgeV2GuidanceRulePage> {
    const cursor = decodeKnowledgeV2Cursor(query.cursor);
    const limit = query.limit ?? 25;
    const take = Math.min((limit + 1) * 4, 404);
    const rows = await this.prisma.knowledgeV2GuidanceRule.findMany({
      where: {
        tenantId: context.tenantId,
        deletedAt: null,
        ...(query.type ? { ruleType: query.type } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.createdAt) } },
                { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
              ],
            }
          : {}),
        ...(query.query
          ? {
              AND: [
                {
                  OR: [
                    { title: { contains: query.query, mode: "insensitive" } },
                    { ruleKey: { contains: query.query, mode: "insensitive" } },
                    {
                      versions: {
                        some: { instruction: { contains: query.query, mode: "insensitive" } },
                      },
                    },
                  ],
                },
              ],
            }
          : {}),
      },
      include: guidanceInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
    });
    const actorMap = await this.actorMap(
      context,
      rows.flatMap((row) => {
        const version = row.versions[0];
        return version?.approvedByUserId ? [version.approvedByUserId] : [];
      }),
    );
    const matching = rows.filter((row) => {
      const version = row.versions[0];
      if (!version || !canViewScope(context, version.scope)) return false;
      if (
        query.query &&
        ![version.title, version.instruction, version.tieBreakKey]
          .join("\n")
          .toLocaleLowerCase()
          .includes(query.query.toLocaleLowerCase())
      ) {
        return false;
      }
      if (query.type && version.ruleType !== query.type) return false;
      if (query.riskLevel && version.riskLevel !== query.riskLevel) return false;
      if (query.reviewStatus && version.reviewStatus !== query.reviewStatus) return false;
      if (
        query.locale &&
        !scopeView(version.scope).locales.includes(canonicalLocale(query.locale))
      ) {
        return false;
      }
      return true;
    });
    const pageRows = matching.slice(0, limit);
    const hasNextPage = matching.length > limit || rows.length === take;
    const cursorRow = pageRows.at(-1) ?? (hasNextPage ? rows.at(-1) : undefined);
    return {
      items: pageRows.map((row) => this.guidanceView(context, row, actorMap)),
      pageInfo: {
        limit,
        hasNextPage,
        nextCursor:
          hasNextPage && cursorRow
            ? encodeKnowledgeV2Cursor({
                createdAt: cursorRow.createdAt.toISOString(),
                id: cursorRow.id,
              })
            : null,
      },
    };
  }

  async createGuidanceRule(
    context: RequestContext,
    input: KnowledgeV2CreateGuidanceRuleRequest,
    idempotencyKey: string,
  ): Promise<KnowledgeV2MutationResult<KnowledgeV2GuidanceRuleView>> {
    this.assertEditor(context);
    assertNoEvidenceIds(input.evidenceIds);
    const result = await this.idempotency.execute(
      {
        tenantId: context.tenantId,
        endpoint: "POST:/knowledge/v2/guidance",
        key: idempotencyKey,
        request: input,
      },
      async (tx) => {
        const settings = await this.lockSettings(tx, context.tenantId);
        const material = this.guidanceMaterial(input, null, settings);
        const ruleKey = `manual:${randomUUID()}`;
        const rule = await tx.knowledgeV2GuidanceRule.create({
          data: {
            tenantId: context.tenantId,
            ruleKey,
            title: material.title,
            ruleType: material.ruleType,
            latestVersionNumber: 1,
            createdByUserId: context.userId,
            updatedByUserId: context.userId,
          },
        });
        const createdAt = new Date();
        const manualEvidence = this.manualEvidence(context, material.scope);
        const immutableHash = this.guidanceHash({
          rule,
          versionNumber: 1,
          material,
          reviewStatus: "DRAFT",
          changeReason: null,
          supersedesVersionId: null,
          createdByUserId: context.userId,
          approvedByUserId: null,
          approvedAt: null,
          rejectedByUserId: null,
          rejectedAt: null,
          createdAt,
          evidence: [manualEvidence],
        });
        const version = await tx.knowledgeV2GuidanceRuleVersion.create({
          data: {
            tenantId: context.tenantId,
            guidanceRuleId: rule.id,
            versionNumber: 1,
            ...this.guidanceVersionData(material),
            immutableHash,
            createdByUserId: context.userId,
            createdAt,
          },
        });
        await this.createManualEvidence(tx, context.tenantId, manualEvidence, {
          factVersionId: null,
          guidanceRuleVersionId: version.id,
        });
        const draftGeneration = await this.bumpDraftGeneration(tx, context.tenantId);
        await enqueueKnowledgeV2ContentReconciliation(tx, {
          tenantId: context.tenantId,
          resourceType: "GUIDANCE_RULE",
          resourceId: rule.id,
          resourceGeneration: rule.generation,
          versionId: version.id,
          versionNumber: version.versionNumber,
          versionHash: version.immutableHash,
          draftGeneration,
          action: "CREATE",
          actorUserId: context.userId,
          requestedRole: context.role,
          mutationIdempotencyKey: idempotencyKey,
        });
        await this.audit(tx, context, "knowledge.v2.guidance_created", rule.id, {
          ruleType: rule.ruleType,
          riskLevel: material.riskLevel,
          version: 1,
        });
        const record = await this.getGuidanceRecord(tx, context.tenantId, rule.id);
        return {
          httpStatus: HttpStatus.CREATED,
          responseBody: this.guidanceView(context, record, actorMapForContext(context)),
          responseRef: rule.id,
        };
      },
    );
    return mutationResult(result);
  }

  async updateGuidanceRule(
    context: RequestContext,
    id: string,
    input: KnowledgeV2UpdateGuidanceRuleRequest,
    idempotencyKey: string,
    ifMatch: string[],
  ): Promise<KnowledgeV2MutationResult<KnowledgeV2GuidanceRuleView>> {
    this.assertEditor(context);
    assertNoEvidenceIds(input.evidenceIds);
    return this.mutateGuidance(context, id, input, idempotencyKey, ifMatch, "update");
  }

  async approveGuidanceRule(
    context: RequestContext,
    id: string,
    input: KnowledgeV2GuidanceDecisionRequest,
    idempotencyKey: string,
    ifMatch: string[],
  ): Promise<KnowledgeV2MutationResult<KnowledgeV2GuidanceRuleView>> {
    this.assertEditor(context);
    return this.mutateGuidance(context, id, input, idempotencyKey, ifMatch, "approve");
  }

  async rejectGuidanceRule(
    context: RequestContext,
    id: string,
    input: KnowledgeV2GuidanceDecisionRequest,
    idempotencyKey: string,
    ifMatch: string[],
  ): Promise<KnowledgeV2MutationResult<KnowledgeV2GuidanceRuleView>> {
    this.assertEditor(context);
    return this.mutateGuidance(context, id, input, idempotencyKey, ifMatch, "reject");
  }

  async disableGuidanceRule(
    context: RequestContext,
    id: string,
    input: KnowledgeV2GuidanceDecisionRequest,
    idempotencyKey: string,
    ifMatch: string[],
  ): Promise<KnowledgeV2MutationResult<KnowledgeV2GuidanceRuleView>> {
    this.assertEditor(context);
    return this.mutateGuidance(context, id, input, idempotencyKey, ifMatch, "disable");
  }

  private async mutateFact(
    context: RequestContext,
    id: string,
    input: KnowledgeV2UpdateFactRequest | KnowledgeV2FactDecisionRequest,
    idempotencyKey: string,
    ifMatch: string[],
    operation: "update" | "verify" | "reject",
  ): Promise<KnowledgeV2MutationResult<KnowledgeV2FactView>> {
    const result = await this.idempotency.execute(
      {
        tenantId: context.tenantId,
        endpoint: `${operation === "update" ? "PATCH" : "POST"}:/knowledge/v2/facts/${id}${
          operation === "update" ? "" : `/${operation}`
        }`,
        key: idempotencyKey,
        request: { body: input, ifMatch },
      },
      async (tx) => {
        const settings = await this.lockSettings(tx, context.tenantId);
        await this.lockFact(tx, context.tenantId, id);
        const current = await this.getFactRecord(tx, context.tenantId, id);
        const previous = current.versions[0];
        if (!previous || previous.versionNumber !== current.latestVersionNumber) {
          throw this.invalidVersionDependency("fact");
        }
        assertIfMatch(
          ifMatch,
          strongKnowledgeV2Etag("fact", current.id, current.etag),
          current.latestVersionNumber,
          [
            "normalizedValue",
            "displayValue",
            "locale",
            "scope",
            "effectiveWindow",
            "riskLevel",
            "authority",
            "verificationStatus",
          ],
        );
        if (operation === "verify" && !canVerifyRisk(context, previous.riskLevel)) {
          throw this.permissionDenied("High-risk facts require an owner or admin to verify them.");
        }
        const requestedAction = operation === "verify" ? "VERIFY" : "REJECT";
        if (operation !== "update" && !factActions(context, previous).includes(requestedAction)) {
          throw this.actionNotAllowed();
        }
        if (
          operation === "update" &&
          (input as KnowledgeV2UpdateFactRequest).authority !== undefined &&
          (input as KnowledgeV2UpdateFactRequest).authority !== previous.authority
        ) {
          throw knowledgeV2Error(
            HttpStatus.BAD_REQUEST,
            "KNOWLEDGE_VALIDATION_AUTHORITY_READ_ONLY",
            "Fact authority is derived from provenance and verification, not edited directly.",
            { field: "authority" },
          );
        }

        let material =
          operation === "update"
            ? this.factMaterial(input as KnowledgeV2UpdateFactRequest, previous, settings)
            : this.factMaterial({}, previous, settings);
        if (
          operation === "verify" &&
          (material.authority === "MANUAL" || material.authority === "IMPORTED") &&
          (context.role === "OWNER" || context.role === "ADMIN")
        ) {
          material = { ...material, authority: "OWNER_VERIFIED" };
        }
        const versionNumber = current.latestVersionNumber + 1;
        const createdAt = new Date();
        const changeReason =
          operation === "update"
            ? ((input as KnowledgeV2UpdateFactRequest).changeReason ?? null)
            : ((input as KnowledgeV2FactDecisionRequest).note ?? null);
        const editorEvidence = this.manualEvidence(context, material.scope);
        const successorEvidence = [...previous.evidence, editorEvidence];
        const verificationStatus =
          operation === "verify"
            ? ("VERIFIED" as const)
            : operation === "reject"
              ? ("REJECTED" as const)
              : ("UNVERIFIED" as const);
        const verifiedAt = operation === "verify" ? createdAt : null;
        const rejectedAt = operation === "reject" ? createdAt : null;
        const immutableHash = this.factHash({
          fact: current,
          versionNumber,
          material,
          lifecycleStatus: "DRAFT",
          verificationStatus,
          changeReason,
          supersedesVersionId: previous.id,
          createdByUserId: context.userId,
          verifiedByUserId: operation === "verify" ? context.userId : null,
          verifiedAt,
          rejectedByUserId: operation === "reject" ? context.userId : null,
          rejectedAt,
          createdAt,
          evidence: successorEvidence,
        });

        const cas = await tx.knowledgeV2Fact.updateMany({
          where: {
            id: current.id,
            tenantId: context.tenantId,
            etag: current.etag,
            latestVersionNumber: current.latestVersionNumber,
          },
          data: {
            latestVersionNumber: versionNumber,
            generation: { increment: 1 },
            etag: { increment: 1 },
            updatedByUserId: context.userId,
          },
        });
        if (cas.count !== 1) throw this.concurrentMutation();
        const version = await tx.knowledgeV2FactVersion.create({
          data: {
            tenantId: context.tenantId,
            factId: current.id,
            versionNumber,
            ...this.factVersionData(material),
            lifecycleStatus: "DRAFT",
            verificationStatus,
            changeReason,
            supersedesVersionId: previous.id,
            immutableHash,
            createdByUserId: context.userId,
            verifiedByUserId: operation === "verify" ? context.userId : null,
            verifiedAt,
            rejectedByUserId: operation === "reject" ? context.userId : null,
            rejectedAt,
            createdAt,
          },
        });
        await this.cloneEvidence(tx, previous.evidence, {
          factVersionId: version.id,
          guidanceRuleVersionId: null,
        });
        await this.createManualEvidence(tx, context.tenantId, editorEvidence, {
          factVersionId: version.id,
          guidanceRuleVersionId: null,
        });
        const draftGeneration = await this.bumpDraftGeneration(tx, context.tenantId);
        await enqueueKnowledgeV2ContentReconciliation(tx, {
          tenantId: context.tenantId,
          resourceType: "FACT",
          resourceId: current.id,
          resourceGeneration: current.generation + 1,
          versionId: version.id,
          versionNumber: version.versionNumber,
          versionHash: version.immutableHash,
          draftGeneration,
          action: operation === "update" ? "UPDATE" : operation === "verify" ? "VERIFY" : "REJECT",
          actorUserId: context.userId,
          requestedRole: context.role,
          mutationIdempotencyKey: idempotencyKey,
        });
        const auditAction =
          operation === "update" ? "updated" : operation === "verify" ? "verified" : "rejected";
        await this.audit(tx, context, `knowledge.v2.fact_${auditAction}`, current.id, {
          factKey: current.factKey,
          version: versionNumber,
          versionId: version.id,
          verificationStatus,
        });
        const updated = await this.getFactRecord(tx, context.tenantId, current.id);
        return {
          httpStatus: HttpStatus.OK,
          responseBody: this.factView(context, updated, actorMapForContext(context)),
          responseRef: current.id,
        };
      },
    );
    return mutationResult(result);
  }

  private async mutateGuidance(
    context: RequestContext,
    id: string,
    input: KnowledgeV2UpdateGuidanceRuleRequest | KnowledgeV2GuidanceDecisionRequest,
    idempotencyKey: string,
    ifMatch: string[],
    operation: "update" | "approve" | "reject" | "disable",
  ): Promise<KnowledgeV2MutationResult<KnowledgeV2GuidanceRuleView>> {
    const result = await this.idempotency.execute(
      {
        tenantId: context.tenantId,
        endpoint: `${operation === "update" ? "PATCH" : "POST"}:/knowledge/v2/guidance/${id}${
          operation === "update" ? "" : `/${operation}`
        }`,
        key: idempotencyKey,
        request: { body: input, ifMatch },
      },
      async (tx) => {
        const settings = await this.lockSettings(tx, context.tenantId);
        await this.lockGuidance(tx, context.tenantId, id);
        const current = await this.getGuidanceRecord(tx, context.tenantId, id);
        const previous = current.versions[0];
        if (!previous || previous.versionNumber !== current.latestVersionNumber) {
          throw this.invalidVersionDependency("guidance rule");
        }
        assertIfMatch(
          ifMatch,
          strongKnowledgeV2Etag("guidance-rule", current.id, current.etag),
          current.latestVersionNumber,
          [
            "title",
            "type",
            "condition",
            "instruction",
            "priority",
            "scope",
            "effectiveWindow",
            "riskLevel",
            "reviewStatus",
          ],
        );
        if (
          operation === "approve" &&
          (!canVerifyRisk(context, previous.riskLevel) ||
            !canApproveRole(context, approverRole(previous.requiredApproverRole)))
        ) {
          throw this.permissionDenied(
            "This guidance rule requires an owner or admin, or a stronger configured approver.",
          );
        }
        const requestedAction =
          operation === "approve" ? "APPROVE" : operation === "reject" ? "REJECT" : "DISABLE";
        if (
          operation !== "update" &&
          !guidanceActions(context, previous).includes(requestedAction)
        ) {
          throw this.actionNotAllowed();
        }

        const material =
          operation === "update"
            ? this.guidanceMaterial(
                input as KnowledgeV2UpdateGuidanceRuleRequest,
                previous,
                settings,
              )
            : this.guidanceMaterial({}, previous, settings);
        const versionNumber = current.latestVersionNumber + 1;
        const createdAt = new Date();
        const changeReason =
          operation === "update"
            ? ((input as KnowledgeV2UpdateGuidanceRuleRequest).changeReason ?? null)
            : ((input as KnowledgeV2GuidanceDecisionRequest).note ?? null);
        const editorEvidence = this.manualEvidence(context, material.scope);
        const successorEvidence = [...previous.evidence, editorEvidence];
        const reviewStatus =
          operation === "approve"
            ? ("APPROVED" as const)
            : operation === "reject"
              ? ("REJECTED" as const)
              : operation === "disable"
                ? ("DISABLED" as const)
                : ("DRAFT" as const);
        const approvedAt = operation === "approve" ? createdAt : null;
        const rejectedAt = operation === "reject" ? createdAt : null;
        const immutableHash = this.guidanceHash({
          rule: current,
          versionNumber,
          material,
          reviewStatus,
          changeReason,
          supersedesVersionId: previous.id,
          createdByUserId: context.userId,
          approvedByUserId: operation === "approve" ? context.userId : null,
          approvedAt,
          rejectedByUserId: operation === "reject" ? context.userId : null,
          rejectedAt,
          createdAt,
          evidence: successorEvidence,
        });

        const cas = await tx.knowledgeV2GuidanceRule.updateMany({
          where: {
            id: current.id,
            tenantId: context.tenantId,
            etag: current.etag,
            latestVersionNumber: current.latestVersionNumber,
          },
          data: {
            title: material.title,
            ruleType: material.ruleType,
            latestVersionNumber: versionNumber,
            generation: { increment: 1 },
            etag: { increment: 1 },
            updatedByUserId: context.userId,
          },
        });
        if (cas.count !== 1) throw this.concurrentMutation();
        const version = await tx.knowledgeV2GuidanceRuleVersion.create({
          data: {
            tenantId: context.tenantId,
            guidanceRuleId: current.id,
            versionNumber,
            ...this.guidanceVersionData(material),
            reviewStatus,
            changeReason,
            supersedesVersionId: previous.id,
            immutableHash,
            createdByUserId: context.userId,
            approvedByUserId: operation === "approve" ? context.userId : null,
            approvedAt,
            rejectedByUserId: operation === "reject" ? context.userId : null,
            rejectedAt,
            createdAt,
          },
        });
        await this.cloneEvidence(tx, previous.evidence, {
          factVersionId: null,
          guidanceRuleVersionId: version.id,
        });
        await this.createManualEvidence(tx, context.tenantId, editorEvidence, {
          factVersionId: null,
          guidanceRuleVersionId: version.id,
        });
        const draftGeneration = await this.bumpDraftGeneration(tx, context.tenantId);
        await enqueueKnowledgeV2ContentReconciliation(tx, {
          tenantId: context.tenantId,
          resourceType: "GUIDANCE_RULE",
          resourceId: current.id,
          resourceGeneration: current.generation + 1,
          versionId: version.id,
          versionNumber: version.versionNumber,
          versionHash: version.immutableHash,
          draftGeneration,
          action:
            operation === "update"
              ? "UPDATE"
              : operation === "approve"
                ? "APPROVE"
                : operation === "reject"
                  ? "REJECT"
                  : "DISABLE",
          actorUserId: context.userId,
          requestedRole: context.role,
          mutationIdempotencyKey: idempotencyKey,
        });
        const auditAction =
          operation === "update"
            ? "updated"
            : operation === "approve"
              ? "approved"
              : operation === "reject"
                ? "rejected"
                : "disabled";
        await this.audit(tx, context, `knowledge.v2.guidance_${auditAction}`, current.id, {
          ruleType: material.ruleType,
          version: versionNumber,
          versionId: version.id,
          reviewStatus,
        });
        const updated = await this.getGuidanceRecord(tx, context.tenantId, current.id);
        return {
          httpStatus: HttpStatus.OK,
          responseBody: this.guidanceView(context, updated, actorMapForContext(context)),
          responseRef: current.id,
        };
      },
    );
    return mutationResult(result);
  }

  private factMaterial(
    input: KnowledgeV2CreateFactRequest | KnowledgeV2UpdateFactRequest,
    current: FactVersionRecord | null,
    settings: Pick<KnowledgeV2Settings, "defaultLocale" | "supportedLocales">,
  ): FactMaterial {
    const normalizedValue =
      input.normalizedValue !== undefined
        ? input.normalizedValue
        : (current?.normalizedValue as KnowledgeV2JsonValue | undefined);
    if (normalizedValue === undefined) {
      throw knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_VALIDATION_INPUT_INVALID",
        "The request contains invalid fields.",
        {
          fieldErrors: [
            {
              field: "normalizedValue",
              code: "KNOWLEDGE_VALIDATION_IS_DEFINED",
              message: "normalizedValue is required.",
            },
          ],
        },
      );
    }
    const locale = canonicalLocale(
      input.locale === undefined
        ? (current?.locale ?? settings.defaultLocale)
        : (input.locale ?? settings.defaultLocale),
    );
    const scope =
      input.scope === undefined
        ? this.canonicalStoredScope(current?.scope ?? null)
        : canonicalScope(input.scope);
    assertExplicitScopeAudience(scope);
    this.assertSupportedLocales(settings, locale, scope);
    const effectiveFrom =
      input.effectiveFrom === undefined
        ? (current?.effectiveFrom ?? null)
        : dateInput(input.effectiveFrom, "effectiveFrom");
    const effectiveUntil =
      input.effectiveUntil === undefined
        ? (current?.effectiveUntil ?? null)
        : dateInput(input.effectiveUntil, "effectiveUntil");
    assertDateWindow(effectiveFrom, effectiveUntil);

    return {
      normalizedValue,
      displayValue:
        input.displayValue === undefined ? (current?.displayValue ?? null) : input.displayValue,
      localizedValues: current?.localizedValues ?? null,
      unit: input.unit === undefined ? (current?.unit ?? null) : input.unit,
      currency: input.currency === undefined ? (current?.currency ?? null) : input.currency,
      timeZone: input.timeZone === undefined ? (current?.timeZone ?? null) : input.timeZone,
      locale,
      localeBehavior: input.localeBehavior ?? current?.localeBehavior ?? "LANGUAGE_NEUTRAL",
      scope,
      effectiveFrom,
      effectiveUntil,
      riskLevel: input.riskLevel ?? current?.riskLevel ?? "LOW",
      authority: input.authority ?? current?.authority ?? "MANUAL",
      extractionConfidence: current?.extractionConfidence ?? null,
      extractionModelVersion: current?.extractionModelVersion ?? null,
    };
  }

  private guidanceMaterial(
    input: KnowledgeV2CreateGuidanceRuleRequest | KnowledgeV2UpdateGuidanceRuleRequest,
    current: GuidanceVersionRecord | null,
    settings: Pick<KnowledgeV2Settings, "defaultLocale" | "supportedLocales">,
  ): GuidanceMaterial {
    const title = input.title ?? current?.title;
    const ruleType = input.type ?? current?.ruleType;
    const condition = input.condition ?? (current ? guidanceCondition(current.conditionAst) : null);
    const instruction = input.instruction ?? current?.instruction;
    const priority = input.priority ?? current?.priority;
    const tieBreakKey = input.tieBreakKey ?? current?.tieBreakKey;
    if (
      title === undefined ||
      ruleType === undefined ||
      condition === null ||
      instruction === undefined ||
      priority === undefined ||
      tieBreakKey === undefined
    ) {
      throw knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_VALIDATION_INPUT_INVALID",
        "The request contains invalid fields.",
        {
          fieldErrors: [
            {
              field: "request",
              code: "KNOWLEDGE_VALIDATION_GUIDANCE_FIELDS_REQUIRED",
              message: "The guidance rule is incomplete.",
            },
          ],
        },
      );
    }
    const scope =
      input.scope === undefined
        ? this.canonicalStoredScope(current?.scope ?? null)
        : canonicalScope(input.scope);
    assertExplicitScopeAudience(scope);
    this.assertSupportedLocales(settings, null, scope);
    const effectiveFrom =
      input.effectiveFrom === undefined
        ? (current?.effectiveFrom ?? null)
        : dateInput(input.effectiveFrom, "effectiveFrom");
    const effectiveUntil =
      input.effectiveUntil === undefined
        ? (current?.effectiveUntil ?? null)
        : dateInput(input.effectiveUntil, "effectiveUntil");
    assertDateWindow(effectiveFrom, effectiveUntil);

    return {
      title,
      ruleType,
      condition,
      instruction,
      outcome: current?.outcome ?? null,
      priority,
      tieBreakKey,
      tieBreakPolicy: current?.tieBreakPolicy ?? "stable_rule_key",
      scope,
      effectiveFrom,
      effectiveUntil,
      riskLevel: input.riskLevel ?? current?.riskLevel ?? "LOW",
      requiredApproverRole:
        input.requiredApproverRole === undefined
          ? approverRole(current?.requiredApproverRole ?? null)
          : input.requiredApproverRole,
      examples:
        input.examples === undefined
          ? examplesView(current?.examples ?? null)
          : [...input.examples],
    };
  }

  private factVersionData(material: FactMaterial) {
    return {
      normalizedValue: requiredJson(material.normalizedValue),
      displayValue: material.displayValue,
      localizedValues: optionalJson(material.localizedValues),
      unit: material.unit,
      currency: material.currency,
      timeZone: material.timeZone,
      locale: material.locale,
      scope: optionalJson(material.scope),
      localeBehavior: material.localeBehavior,
      effectiveFrom: material.effectiveFrom,
      effectiveUntil: material.effectiveUntil,
      riskLevel: material.riskLevel,
      authority: material.authority,
      lifecycleStatus: "DRAFT" as const,
      verificationStatus: "UNVERIFIED" as const,
      extractionConfidence: material.extractionConfidence,
      extractionModelVersion: material.extractionModelVersion,
    };
  }

  private guidanceVersionData(material: GuidanceMaterial) {
    return {
      title: material.title,
      ruleType: material.ruleType,
      conditionAst: requiredJson(material.condition),
      instruction: material.instruction,
      outcome: optionalJson(material.outcome),
      priority: material.priority,
      tieBreakPolicy: material.tieBreakPolicy,
      tieBreakKey: material.tieBreakKey,
      scope: optionalJson(material.scope),
      effectiveFrom: material.effectiveFrom,
      effectiveUntil: material.effectiveUntil,
      riskLevel: material.riskLevel,
      requiredApproverRole: material.requiredApproverRole,
      examples: material.examples as Prisma.InputJsonArray,
      reviewStatus: "DRAFT" as const,
    };
  }

  private factHash(input: {
    fact: Pick<FactRecord, "id" | "factKey" | "entityType" | "entityId" | "fieldType">;
    versionNumber: number;
    material: FactMaterial;
    lifecycleStatus: FactVersionRecord["lifecycleStatus"];
    verificationStatus: FactVersionRecord["verificationStatus"];
    changeReason: string | null;
    supersedesVersionId: string | null;
    createdByUserId: string | null;
    verifiedByUserId: string | null;
    verifiedAt: Date | null;
    rejectedByUserId: string | null;
    rejectedAt: Date | null;
    createdAt: Date;
    evidence: EvidenceHashSource[];
  }) {
    return canonicalKnowledgeV2Hash({
      schemaVersion: 1,
      factId: input.fact.id,
      factKey: input.fact.factKey,
      entityType: input.fact.entityType,
      entityId: input.fact.entityId,
      fieldType: input.fact.fieldType,
      versionNumber: input.versionNumber,
      normalizedValue: input.material.normalizedValue,
      displayValue: input.material.displayValue,
      localizedValues: input.material.localizedValues,
      unit: input.material.unit,
      currency: input.material.currency,
      timeZone: input.material.timeZone,
      locale: input.material.locale,
      localeBehavior: input.material.localeBehavior,
      scope: input.material.scope,
      effectiveFrom: dateValue(input.material.effectiveFrom),
      effectiveUntil: dateValue(input.material.effectiveUntil),
      riskLevel: input.material.riskLevel,
      authority: input.material.authority,
      lifecycleStatus: input.lifecycleStatus,
      verificationStatus: input.verificationStatus,
      extractionConfidence: input.material.extractionConfidence,
      extractionModelVersion: input.material.extractionModelVersion,
      changeReason: input.changeReason,
      supersedesVersionId: input.supersedesVersionId,
      createdByUserId: input.createdByUserId,
      verifiedByUserId: input.verifiedByUserId,
      verifiedAt: dateValue(input.verifiedAt),
      rejectedByUserId: input.rejectedByUserId,
      rejectedAt: dateValue(input.rejectedAt),
      createdAt: input.createdAt.toISOString(),
      evidence: input.evidence.map(evidenceHashValue),
    });
  }

  private guidanceHash(input: {
    rule: Pick<GuidanceRecord, "id" | "ruleKey">;
    versionNumber: number;
    material: GuidanceMaterial;
    reviewStatus: GuidanceVersionRecord["reviewStatus"];
    changeReason: string | null;
    supersedesVersionId: string | null;
    createdByUserId: string | null;
    approvedByUserId: string | null;
    approvedAt: Date | null;
    rejectedByUserId: string | null;
    rejectedAt: Date | null;
    createdAt: Date;
    evidence: EvidenceHashSource[];
  }) {
    return canonicalKnowledgeV2Hash({
      schemaVersion: 1,
      guidanceRuleId: input.rule.id,
      ruleKey: input.rule.ruleKey,
      versionNumber: input.versionNumber,
      title: input.material.title,
      ruleType: input.material.ruleType,
      condition: input.material.condition,
      instruction: input.material.instruction,
      outcome: input.material.outcome,
      priority: input.material.priority,
      tieBreakPolicy: input.material.tieBreakPolicy,
      tieBreakKey: input.material.tieBreakKey,
      scope: input.material.scope,
      effectiveFrom: dateValue(input.material.effectiveFrom),
      effectiveUntil: dateValue(input.material.effectiveUntil),
      riskLevel: input.material.riskLevel,
      requiredApproverRole: input.material.requiredApproverRole,
      examples: input.material.examples,
      reviewStatus: input.reviewStatus,
      changeReason: input.changeReason,
      supersedesVersionId: input.supersedesVersionId,
      createdByUserId: input.createdByUserId,
      approvedByUserId: input.approvedByUserId,
      approvedAt: dateValue(input.approvedAt),
      rejectedByUserId: input.rejectedByUserId,
      rejectedAt: dateValue(input.rejectedAt),
      createdAt: input.createdAt.toISOString(),
      evidence: input.evidence.map(evidenceHashValue),
    });
  }

  private settingsView(
    settings: KnowledgeV2Settings,
    updatedBy?: KnowledgeV2ActorView,
  ): KnowledgeV2SettingsView {
    const defaultScope = this.storedDefaultScope(settings);
    let publicationSchedule: KnowledgeV2PublicationScheduleView | null = null;
    if (settings.publicationSchedule !== null) {
      if (!isKnowledgeV2PublicationSchedule(settings.publicationSchedule)) {
        throw knowledgeV2Error(
          HttpStatus.INTERNAL_SERVER_ERROR,
          "KNOWLEDGE_DEPENDENCY_PUBLICATION_SCHEDULE_INVALID",
          "The publication schedule could not be read safely.",
        );
      }
      const value = settings.publicationSchedule as unknown as {
        timeZone: string;
        daysOfWeek: number[];
        hour: number;
        minute: number;
      };
      publicationSchedule = {
        timeZone: value.timeZone,
        daysOfWeek: [...value.daysOfWeek].sort((left, right) => left - right),
        hour: value.hour,
        minute: value.minute,
      };
    }
    return {
      version: settings.etag,
      etag: strongKnowledgeV2Etag("settings", settings.tenantId, settings.etag),
      defaultLocale: canonicalLocale(settings.defaultLocale),
      supportedLocales: canonicalLocales(settings.supportedLocales),
      defaultScope: defaultScope ? scopeView(defaultScope as unknown as Prisma.JsonValue) : null,
      defaultScopeGeneration: settings.defaultScopeGeneration,
      defaultScopeHash: settings.defaultScopeHash,
      autoPublishPolicy: settings.autoPublishPolicy,
      publicationApprovalPolicy: settings.publicationApprovalPolicy,
      publicationSchedule,
      embeddingProviderPolicy: this.embeddingProviderPolicy(settings.embeddingProviderPolicy),
      retrievalProcessorPolicy: this.retrievalProcessorPolicy(settings.retrievalProcessorPolicy),
      modelProcessorPolicy: this.modelProcessorPolicy(settings.modelProcessorPolicy),
      createdAt: settings.createdAt.toISOString(),
      updatedAt: settings.updatedAt.toISOString(),
      updatedBy: updatedBy ?? null,
    };
  }

  private embeddingProviderPolicy(value: Prisma.JsonValue | null) {
    if (value === null) return null;
    if (typeof value !== "object" || Array.isArray(value)) {
      throw knowledgeV2Error(
        HttpStatus.INTERNAL_SERVER_ERROR,
        "KNOWLEDGE_DEPENDENCY_EMBEDDING_POLICY_INVALID",
        "The embedding provider policy could not be read safely.",
      );
    }
    const policy = value as Record<string, Prisma.JsonValue>;
    const allowed = policy.allowedClassifications;
    if (
      policy.schemaVersion !== 1 ||
      typeof policy.policyVersion !== "string" ||
      !policy.policyVersion ||
      policy.approved !== true ||
      policy.provider !== "openai-compatible" ||
      typeof policy.deployment !== "string" ||
      !policy.deployment ||
      typeof policy.region !== "string" ||
      !policy.region ||
      !Array.isArray(allowed) ||
      allowed.length === 0 ||
      new Set(allowed).size !== allowed.length ||
      allowed.some(
        (item) =>
          typeof item !== "string" ||
          !embeddingClassificationOrder.includes(item as KnowledgeV2SecurityClassification),
      )
    ) {
      throw knowledgeV2Error(
        HttpStatus.INTERNAL_SERVER_ERROR,
        "KNOWLEDGE_DEPENDENCY_EMBEDDING_POLICY_INVALID",
        "The embedding provider policy could not be read safely.",
      );
    }
    return {
      schemaVersion: 1,
      policyVersion: policy.policyVersion,
      approved: true,
      provider: "openai-compatible",
      deployment: policy.deployment,
      region: policy.region,
      allowedClassifications: [...allowed].sort(
        (left, right) =>
          embeddingClassificationOrder.indexOf(left as KnowledgeV2SecurityClassification) -
          embeddingClassificationOrder.indexOf(right as KnowledgeV2SecurityClassification),
      ) as KnowledgeV2SecurityClassification[],
    } satisfies KnowledgeV2EmbeddingProviderPolicy;
  }

  private validateEmbeddingProviderPolicy(value: KnowledgeV2EmbeddingProviderPolicy) {
    const policy = this.embeddingProviderPolicy(value as unknown as Prisma.JsonValue);
    const config = this.config;
    if (
      !policy ||
      !config ||
      !config.knowledgeEmbeddingProviderApproved ||
      policy.policyVersion !== config.knowledgeV2EmbeddingPolicyVersion ||
      policy.deployment !== config.knowledgeV2EmbeddingDeployment ||
      policy.region !== config.knowledgeV2EmbeddingRegion
    ) {
      throw knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_VALIDATION_EMBEDDING_POLICY_INVALID",
        "The embedding provider policy does not match the approved deployment.",
        { field: "embeddingProviderPolicy" },
      );
    }
    const ceiling = embeddingClassificationOrder.indexOf(
      config.knowledgeV2ExternalEmbeddingMaxClassification,
    );
    if (
      policy.allowedClassifications.some(
        (classification) => embeddingClassificationOrder.indexOf(classification) > ceiling,
      )
    ) {
      throw knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_VALIDATION_EMBEDDING_CLASSIFICATION_DENIED",
        "The embedding provider policy exceeds the configured classification ceiling.",
        { field: "embeddingProviderPolicy.allowedClassifications" },
      );
    }
    return policy;
  }

  private retrievalProcessorPolicy(
    value: Prisma.JsonValue | null,
  ): KnowledgeV2RetrievalProcessorPolicy | null {
    if (value === null) return null;
    const policy = record(value);
    const queryEmbedding = record(policy.queryEmbedding);
    const reranker = record(policy.reranker);
    const queryClassifications = this.processorClassifications(
      queryEmbedding.allowedClassifications,
    );
    const rerankerClassifications = this.processorClassifications(reranker.allowedClassifications);
    if (
      policy.schemaVersion !== 1 ||
      typeof policy.policyVersion !== "string" ||
      !policy.policyVersion ||
      policy.approved !== true ||
      queryEmbedding.provider !== "openai-compatible" ||
      typeof queryEmbedding.deployment !== "string" ||
      !queryEmbedding.deployment ||
      typeof queryEmbedding.region !== "string" ||
      !queryEmbedding.region ||
      typeof reranker.provider !== "string" ||
      !reranker.provider ||
      typeof reranker.model !== "string" ||
      !reranker.model ||
      typeof reranker.version !== "string" ||
      !reranker.version ||
      typeof reranker.region !== "string" ||
      !reranker.region ||
      !queryClassifications ||
      !rerankerClassifications
    ) {
      throw knowledgeV2Error(
        HttpStatus.INTERNAL_SERVER_ERROR,
        "KNOWLEDGE_DEPENDENCY_RETRIEVAL_PROCESSOR_POLICY_INVALID",
        "The retrieval processor policy could not be read safely.",
      );
    }
    return {
      schemaVersion: 1,
      policyVersion: policy.policyVersion,
      approved: true,
      queryEmbedding: {
        provider: "openai-compatible",
        deployment: queryEmbedding.deployment,
        region: queryEmbedding.region,
        allowedClassifications: queryClassifications,
      },
      reranker: {
        provider: reranker.provider,
        model: reranker.model,
        version: reranker.version,
        region: reranker.region,
        allowedClassifications: rerankerClassifications,
      },
    };
  }

  private processorClassifications(value: Prisma.JsonValue | undefined) {
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      new Set(value).size !== value.length ||
      value.some(
        (item) =>
          typeof item !== "string" ||
          !embeddingClassificationOrder.includes(item as KnowledgeV2SecurityClassification),
      )
    ) {
      return null;
    }
    return [...value].sort(
      (left, right) =>
        embeddingClassificationOrder.indexOf(left as KnowledgeV2SecurityClassification) -
        embeddingClassificationOrder.indexOf(right as KnowledgeV2SecurityClassification),
    ) as KnowledgeV2SecurityClassification[];
  }

  private validateRetrievalProcessorPolicy(value: KnowledgeV2RetrievalProcessorPolicy) {
    const policy = this.retrievalProcessorPolicy(value as unknown as Prisma.JsonValue);
    const config = this.config;
    if (
      !policy ||
      !config ||
      !config.knowledgeEmbeddingProviderApproved ||
      !config.knowledgeV2RerankerApproved ||
      policy.policyVersion !== config.knowledgeV2RetrievalPolicyVersion ||
      policy.queryEmbedding.provider !== "openai-compatible" ||
      policy.queryEmbedding.deployment !== config.knowledgeV2EmbeddingDeployment ||
      policy.queryEmbedding.region !== config.knowledgeV2EmbeddingRegion ||
      policy.reranker.provider !== config.knowledgeV2RerankerProvider ||
      policy.reranker.model !== config.knowledgeV2RerankerModel ||
      policy.reranker.version !== config.knowledgeV2RerankerVersion ||
      policy.reranker.region !== config.knowledgeV2RerankerRegion
    ) {
      throw knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_VALIDATION_RETRIEVAL_PROCESSOR_POLICY_INVALID",
        "The retrieval processor policy does not match the approved deployments.",
        { field: "retrievalProcessorPolicy" },
      );
    }
    const queryCeiling = embeddingClassificationOrder.indexOf(
      config.knowledgeV2QueryEmbeddingMaxClassification,
    );
    const rerankerCeiling = embeddingClassificationOrder.indexOf(
      config.knowledgeV2RerankerMaxClassification,
    );
    if (
      policy.queryEmbedding.allowedClassifications.some(
        (classification) => embeddingClassificationOrder.indexOf(classification) > queryCeiling,
      ) ||
      policy.reranker.allowedClassifications.some(
        (classification) => embeddingClassificationOrder.indexOf(classification) > rerankerCeiling,
      )
    ) {
      throw knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_VALIDATION_RETRIEVAL_PROCESSOR_CLASSIFICATION_DENIED",
        "The retrieval processor policy exceeds a configured classification ceiling.",
        { field: "retrievalProcessorPolicy" },
      );
    }
    return policy;
  }

  private modelProcessorPolicy(
    value: Prisma.JsonValue | null,
  ): KnowledgeV2ModelProcessorPolicy | null {
    if (value === null) return null;
    const policy = record(value);
    const groundedAnswer = record(policy.groundedAnswer);
    const classifications = this.processorClassifications(groundedAnswer.allowedClassifications);
    if (
      policy.schemaVersion !== 1 ||
      typeof policy.policyVersion !== "string" ||
      !policy.policyVersion ||
      policy.approved !== true ||
      typeof policy.promptPolicyVersion !== "string" ||
      !policy.promptPolicyVersion ||
      typeof groundedAnswer.provider !== "string" ||
      !groundedAnswer.provider ||
      typeof groundedAnswer.model !== "string" ||
      !groundedAnswer.model ||
      typeof groundedAnswer.version !== "string" ||
      !groundedAnswer.version ||
      typeof groundedAnswer.region !== "string" ||
      !groundedAnswer.region ||
      !classifications
    ) {
      throw knowledgeV2Error(
        HttpStatus.INTERNAL_SERVER_ERROR,
        "KNOWLEDGE_DEPENDENCY_MODEL_PROCESSOR_POLICY_INVALID",
        "The model processor policy could not be read safely.",
      );
    }
    return {
      schemaVersion: 1,
      policyVersion: policy.policyVersion,
      approved: true,
      promptPolicyVersion: policy.promptPolicyVersion,
      groundedAnswer: {
        provider: groundedAnswer.provider,
        model: groundedAnswer.model,
        version: groundedAnswer.version,
        region: groundedAnswer.region,
        allowedClassifications: classifications,
      },
    };
  }

  private validateModelProcessorPolicy(value: KnowledgeV2ModelProcessorPolicy) {
    const policy = this.modelProcessorPolicy(value as unknown as Prisma.JsonValue);
    const config = this.config;
    if (
      !policy ||
      !config ||
      !config.knowledgeV2GroundedAnswerApproved ||
      policy.policyVersion !== config.knowledgeV2ModelProcessorPolicyVersion ||
      policy.promptPolicyVersion !== config.knowledgeV2GroundedPromptPolicyVersion ||
      policy.groundedAnswer.provider !== config.knowledgeV2GroundedAnswerProvider ||
      policy.groundedAnswer.model !== config.knowledgeV2GroundedAnswerModel ||
      policy.groundedAnswer.version !== config.knowledgeV2GroundedAnswerVersion ||
      policy.groundedAnswer.region !== config.knowledgeV2GroundedAnswerRegion
    ) {
      throw knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_VALIDATION_MODEL_PROCESSOR_POLICY_INVALID",
        "The model processor policy does not match the approved grounded-answer deployment.",
        { field: "modelProcessorPolicy" },
      );
    }
    const ceiling = embeddingClassificationOrder.indexOf(
      config.knowledgeV2ModelProcessorMaxClassification,
    );
    if (
      policy.groundedAnswer.allowedClassifications.some(
        (classification) => embeddingClassificationOrder.indexOf(classification) > ceiling,
      )
    ) {
      throw knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_VALIDATION_MODEL_PROCESSOR_CLASSIFICATION_DENIED",
        "The model processor policy exceeds the configured classification ceiling.",
        { field: "modelProcessorPolicy.groundedAnswer.allowedClassifications" },
      );
    }
    return policy;
  }

  private factView(
    context: RequestContext,
    fact: FactRecord,
    actors: ActorMap,
    activeFactVersionIds: ReadonlySet<string> = new Set(),
  ): KnowledgeV2FactView {
    const version = fact.versions[0];
    if (!version || version.versionNumber !== fact.latestVersionNumber) {
      throw this.invalidVersionDependency("fact");
    }
    const canViewPrivateEvidence =
      context.role === "OWNER" || context.role === "ADMIN" || context.role === "MANAGER";
    const evidence = version.evidence
      .filter((item) => canViewPrivateEvidence || item.isPublic)
      .sort((left, right) => compareKnowledgeCanonicalText(left.id, right.id))
      .map(evidenceView);
    return {
      id: fact.id,
      versionId: version.id,
      version: version.versionNumber,
      etag: strongKnowledgeV2Etag("fact", fact.id, fact.etag),
      factKey: fact.factKey,
      entityType: fact.entityType,
      entityId: fact.entityId,
      fieldType: fact.fieldType,
      normalizedValue: version.normalizedValue as KnowledgeV2JsonValue,
      displayValue: version.displayValue,
      unit: version.unit,
      currency: version.currency,
      timeZone: version.timeZone,
      locale: version.locale,
      localeBehavior: version.localeBehavior,
      scope: scopeView(version.scope),
      effectiveFrom: dateValue(version.effectiveFrom),
      effectiveUntil: dateValue(version.effectiveUntil),
      riskLevel: version.riskLevel,
      authority: version.authority,
      lifecycleStatus:
        version.lifecycleStatus === "ARCHIVED"
          ? "ARCHIVED"
          : activeFactVersionIds.has(version.id)
            ? "PUBLISHED"
            : "DRAFT",
      verificationStatus: version.verificationStatus,
      evidence,
      allowedActions: factActions(context, version),
      createdAt: fact.createdAt.toISOString(),
      updatedAt: fact.updatedAt.toISOString(),
      verifiedAt: dateValue(version.verifiedAt),
      verifiedBy: version.verifiedByUserId ? (actors.get(version.verifiedByUserId) ?? null) : null,
    };
  }

  private guidanceView(
    context: RequestContext,
    rule: GuidanceRecord,
    actors: ActorMap,
  ): KnowledgeV2GuidanceRuleView {
    const version = rule.versions[0];
    if (!version || version.versionNumber !== rule.latestVersionNumber) {
      throw this.invalidVersionDependency("guidance rule");
    }
    const canViewPrivateEvidence =
      context.role === "OWNER" || context.role === "ADMIN" || context.role === "MANAGER";
    const evidence = version.evidence
      .filter((item) => canViewPrivateEvidence || item.isPublic)
      .sort((left, right) => compareKnowledgeCanonicalText(left.id, right.id))
      .map(evidenceView);
    return {
      id: rule.id,
      versionId: version.id,
      version: version.versionNumber,
      etag: strongKnowledgeV2Etag("guidance-rule", rule.id, rule.etag),
      title: version.title,
      type: version.ruleType,
      condition: guidanceCondition(version.conditionAst),
      instruction: version.instruction,
      priority: version.priority,
      tieBreakKey: version.tieBreakKey,
      scope: scopeView(version.scope),
      effectiveFrom: dateValue(version.effectiveFrom),
      effectiveUntil: dateValue(version.effectiveUntil),
      riskLevel: version.riskLevel,
      requiredApproverRole: approverRole(version.requiredApproverRole),
      examples: examplesView(version.examples),
      evidence,
      reviewStatus: version.reviewStatus,
      allowedActions: guidanceActions(context, version),
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
      approvedAt: dateValue(version.approvedAt),
      approvedBy: version.approvedByUserId ? (actors.get(version.approvedByUserId) ?? null) : null,
    };
  }

  private canonicalStoredScope(value: Prisma.JsonValue | null): Prisma.InputJsonObject | null {
    if (value === null) return null;
    const view = scopeView(value);
    return canonicalScope({
      brandIds: view.brandIds,
      locationIds: view.locationIds,
      channelTypes: view.channelTypes,
      assistantIds: view.assistantIds,
      audiences: view.audiences,
      segments: view.segments,
      locales: view.locales,
    });
  }

  private storedDefaultScope(
    settings: Pick<
      KnowledgeV2Settings,
      "defaultScope" | "defaultScopeGeneration" | "defaultScopeHash"
    >,
  ): Prisma.InputJsonObject | null {
    if (settings.defaultScope === null) {
      if (settings.defaultScopeHash !== null || settings.defaultScopeGeneration < 0) {
        throw this.invalidStoredDefaultScope();
      }
      return null;
    }
    const scope = this.canonicalStoredScope(settings.defaultScope);
    if (
      scope === null ||
      !Array.isArray(scope.audiences) ||
      scope.audiences.length === 0 ||
      !Number.isInteger(settings.defaultScopeGeneration) ||
      settings.defaultScopeGeneration <= 0 ||
      !settings.defaultScopeHash ||
      !/^[a-f0-9]{64}$/u.test(settings.defaultScopeHash) ||
      knowledgeV2TenantDefaultScopeHash(scope as unknown as KnowledgeV2PersistedScope) !==
        settings.defaultScopeHash
    ) {
      throw this.invalidStoredDefaultScope();
    }
    return scope;
  }

  private invalidStoredDefaultScope() {
    return knowledgeV2Error(
      HttpStatus.CONFLICT,
      "KNOWLEDGE_PERMISSION_SCOPE_INVALID",
      "The stored tenant default knowledge scope is invalid.",
    );
  }

  private assertSupportedLocales(
    settings: Pick<KnowledgeV2Settings, "defaultLocale" | "supportedLocales">,
    locale: string | null,
    scope: Prisma.InputJsonObject | null,
    scopeField = "scope",
  ) {
    const supported = new Set(canonicalLocales(settings.supportedLocales));
    if (locale && !supported.has(locale)) {
      throw knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_VALIDATION_LOCALE_NOT_SUPPORTED",
        "The locale is not enabled for this workspace.",
        { field: "locale" },
      );
    }
    const scopedLocales = scope ? strings(scope.locales as Prisma.JsonValue) : [];
    if (scopedLocales.some((item) => !supported.has(canonicalLocale(item)))) {
      throw knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_VALIDATION_SCOPE_LOCALE_NOT_SUPPORTED",
        "The scope contains a locale that is not enabled for this workspace.",
        { field: `${scopeField}.locales` },
      );
    }
  }

  private manualEvidence(context: RequestContext, scope: Prisma.InputJsonObject | null) {
    const view = scopeView(scope as Prisma.JsonValue | null);
    const sourceReference = {
      origin: "knowledge_editor",
      provenanceVersion: 1,
    } satisfies Prisma.InputJsonObject;
    return {
      id: randomUUID(),
      kind: "MANUAL" as const,
      legacyRevisionId: null,
      label: "Manual workspace entry",
      locator: null,
      isPublic: view.audiences.includes("PUBLIC"),
      sourceReference,
      elementReference: null,
      quoteHash: null,
      confidence: null,
      metadata: sourceReference,
      createdByUserId: context.userId,
    };
  }

  private async createManualEvidence(
    tx: Prisma.TransactionClient,
    tenantId: string,
    evidence: ReturnType<KnowledgeV2Service["manualEvidence"]>,
    link: { factVersionId: string | null; guidanceRuleVersionId: string | null },
  ) {
    await tx.knowledgeV2Evidence.create({
      data: {
        id: evidence.id,
        tenantId,
        kind: evidence.kind,
        factVersionId: link.factVersionId,
        guidanceRuleVersionId: link.guidanceRuleVersionId,
        label: evidence.label,
        isPublic: evidence.isPublic,
        sourceReference: evidence.sourceReference,
        metadata: evidence.metadata,
        createdByUserId: evidence.createdByUserId,
      },
    });
  }

  private async cloneEvidence(
    tx: Prisma.TransactionClient,
    evidence: EvidenceRecord[],
    link: { factVersionId: string | null; guidanceRuleVersionId: string | null },
  ) {
    if (evidence.length === 0) return;
    await tx.knowledgeV2Evidence.createMany({
      data: evidence.map((item) => ({
        id: randomUUID(),
        tenantId: item.tenantId,
        kind: item.kind,
        factVersionId: link.factVersionId,
        guidanceRuleVersionId: link.guidanceRuleVersionId,
        legacyRevisionId: item.legacyRevisionId,
        label: item.label,
        locator: item.locator,
        isPublic: item.isPublic,
        sourceReference: optionalJson(item.sourceReference),
        elementReference: optionalJson(item.elementReference),
        quoteHash: item.quoteHash,
        confidence: item.confidence,
        metadata: optionalJson(item.metadata),
        createdByUserId: item.createdByUserId,
      })),
    });
  }

  private async actorMap(context: RequestContext, actorIds: string[]): Promise<ActorMap> {
    const result = new Map(actorMapForContext(context));
    const ids = [...new Set(actorIds)].filter((id) => id !== context.userId);
    if (ids.length === 0) return result;
    const memberships = await this.prisma.membership.findMany({
      where: { tenantId: context.tenantId, userId: { in: ids } },
      select: { user: { select: { id: true, name: true } } },
    });
    for (const membership of memberships) {
      result.set(membership.user.id, {
        id: membership.user.id,
        displayName: membership.user.name?.trim() || "Workspace member",
      });
    }
    return result;
  }

  private async activeFactVersionIds(tenantId: string) {
    const pointer = await this.prisma.activeKnowledgePublication.findUnique({
      where: { tenantId_targetKey: { tenantId, targetKey: "workspace-v2" } },
      select: {
        publication: {
          select: {
            corpusKind: true,
            items: {
              where: { itemType: "FACT_VERSION" },
              select: { factVersionId: true },
            },
          },
        },
      },
    });
    if (pointer?.publication.corpusKind !== "STRUCTURED_V2") return new Set<string>();
    return new Set(
      pointer.publication.items.flatMap((item) => (item.factVersionId ? [item.factVersionId] : [])),
    );
  }

  private async lockSettings(tx: Prisma.TransactionClient, tenantId: string) {
    const tenants = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "Tenant"
      WHERE "id" = ${tenantId}
      FOR UPDATE
    `);
    if (tenants.length !== 1) throw this.notFound("settings");
    await tx.knowledgeV2Settings.upsert({
      where: { tenantId },
      create: { tenantId },
      update: {},
    });
    await tx.$queryRaw<Array<{ tenantId: string }>>(Prisma.sql`
      SELECT "tenantId"
      FROM "KnowledgeV2Settings"
      WHERE "tenantId" = ${tenantId}
      FOR UPDATE
    `);
    return tx.knowledgeV2Settings.findUniqueOrThrow({ where: { tenantId } });
  }

  private async lockFact(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "KnowledgeV2Fact"
      WHERE "tenantId" = ${tenantId} AND "id" = ${id} AND "deletedAt" IS NULL
      FOR UPDATE
    `);
    if (rows.length !== 1) throw this.notFound("fact");
  }

  private async lockGuidance(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "KnowledgeV2GuidanceRule"
      WHERE "tenantId" = ${tenantId} AND "id" = ${id} AND "deletedAt" IS NULL
      FOR UPDATE
    `);
    if (rows.length !== 1) throw this.notFound("guidance rule");
  }

  private async getFactRecord(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const fact = await tx.knowledgeV2Fact.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: factInclude,
    });
    if (!fact) throw this.notFound("fact");
    return fact;
  }

  private async getGuidanceRecord(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const rule = await tx.knowledgeV2GuidanceRule.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: guidanceInclude,
    });
    if (!rule) throw this.notFound("guidance rule");
    return rule;
  }

  private async assertEntity(
    tx: Prisma.TransactionClient,
    tenantId: string,
    entityId: string | null | undefined,
    entityType: string,
  ) {
    if (!entityId) return;
    const entity = await tx.knowledgeV2Entity.findFirst({
      where: { id: entityId, tenantId, deletedAt: null },
      select: { entityType: true },
    });
    if (!entity || entity.entityType !== entityType) {
      throw knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_VALIDATION_ENTITY_INVALID",
        "The entity is not available for this fact.",
        { field: "entityId" },
      );
    }
  }

  private async bumpDraftGeneration(tx: Prisma.TransactionClient, tenantId: string) {
    const result = await tx.knowledgeV2Settings.update({
      where: { tenantId },
      data: { draftGeneration: { increment: 1 } },
      select: { draftGeneration: true },
    });
    return result.draftGeneration;
  }

  private async audit(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    action: string,
    entityId: string,
    payload: Prisma.InputJsonObject,
  ) {
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action,
        entityType: "knowledge_v2",
        entityId,
        payload,
      },
    });
  }

  private assertEditor(context: RequestContext) {
    if (!canEdit(context)) {
      throw this.permissionDenied("This role cannot change workspace knowledge.");
    }
  }

  private assertSettingsEditor(context: RequestContext) {
    if (context.role !== "OWNER" && context.role !== "ADMIN") {
      throw this.permissionDenied("Only an owner or admin can change knowledge settings.");
    }
  }

  private permissionDenied(message: string) {
    return knowledgeV2Error(HttpStatus.FORBIDDEN, "KNOWLEDGE_PERMISSION_ACTION_DENIED", message);
  }

  private notFound(resource: string) {
    return knowledgeV2Error(
      HttpStatus.NOT_FOUND,
      "KNOWLEDGE_CONFLICT_RESOURCE_NOT_FOUND",
      `The ${resource} was not found.`,
    );
  }

  private invalidVersionDependency(resource: string) {
    return knowledgeV2Error(
      HttpStatus.INTERNAL_SERVER_ERROR,
      "KNOWLEDGE_DEPENDENCY_VERSION_INVALID",
      `The latest ${resource} version could not be read safely.`,
    );
  }

  private concurrentMutation() {
    return knowledgeV2Error(
      HttpStatus.CONFLICT,
      "KNOWLEDGE_CONFLICT_CONCURRENT_MUTATION",
      "The resource changed while the mutation was being applied.",
      { retryable: true },
    );
  }

  private actionNotAllowed() {
    return knowledgeV2Error(
      HttpStatus.CONFLICT,
      "KNOWLEDGE_CONFLICT_ACTION_NOT_ALLOWED",
      "This action is not available for the current version.",
    );
  }
}
