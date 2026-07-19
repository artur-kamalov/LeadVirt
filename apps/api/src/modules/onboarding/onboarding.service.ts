import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { OnboardingState } from "@leadvirt/types";
import type { Prisma } from "@leadvirt/db";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import { BusinessProfileService } from "../business-profile/business-profile.service.js";
import { lockKnowledgeV2CorpusTransition } from "../knowledge/knowledge-v2-transition-lock.js";
import {
  normalizeOnboardingUpdate,
  type AdvanceOnboardingDto,
  CompleteOnboardingStepDto,
  type UpdateOnboardingDto,
} from "./dto/update-onboarding.dto.js";

const ONBOARDING_STEPS = ["business", "channels", "scenario", "company", "crm", "launch"] as const;

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonBlank(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

@Injectable()
export class OnboardingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessProfileService) private readonly businessProfile: BusinessProfileService,
  ) {}

  async state(context: RequestContext): Promise<OnboardingState> {
    const state = await this.ensureState(context);
    return this.mapState(state);
  }

  async update(
    context: RequestContext,
    dto: UpdateOnboardingDto,
    ifMatch?: string | string[],
  ): Promise<OnboardingState> {
    const normalized = normalizeOnboardingUpdate(dto);
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await this.businessProfile.updateOnboardingInTransaction(
        tx,
        context,
        normalized,
        ifMatch,
      );
      await this.log(tx, context, "onboarding.updated", {
        currentStep: updated.state.currentStep,
      });
      return updated;
    });
    await this.businessProfile.dispatch(result, context.tenantId);
    return this.mapState(result.state);
  }

  async completeStep(
    context: RequestContext,
    dto: CompleteOnboardingStepDto,
  ): Promise<OnboardingState> {
    const state = await this.prisma.$transaction(async (tx) => {
      await lockKnowledgeV2CorpusTransition(tx, context.tenantId);
      const current = await this.ensureState(context, tx);
      const completedSteps = this.completedSteps(current.completedSteps);
      this.assertStepReady(dto.step, current.data, completedSteps);
      if (!completedSteps.includes(dto.step)) completedSteps.push(dto.step);
      const updated = await tx.onboardingState.update({
        where: { tenantId: context.tenantId },
        data: {
          completedSteps,
          currentStep: dto.step,
          completedAt:
            dto.step === "launch" ? (current.completedAt ?? new Date()) : current.completedAt,
        },
      });
      await this.log(tx, context, "onboarding.step_completed", { step: dto.step });
      return updated;
    });
    return this.mapState(state);
  }

  async advance(
    context: RequestContext,
    dto: AdvanceOnboardingDto,
    ifMatch?: string | string[],
  ): Promise<OnboardingState> {
    const normalized = normalizeOnboardingUpdate(dto.data !== undefined ? { data: dto.data } : {});
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await this.businessProfile.updateOnboardingInTransaction(
        tx,
        context,
        normalized,
        ifMatch,
      );
      const completedSteps = this.completedSteps(updated.state.completedSteps);
      this.assertStepReady(dto.step, updated.state.data, completedSteps);
      if (!completedSteps.includes(dto.step)) completedSteps.push(dto.step);
      const stepIndex = ONBOARDING_STEPS.indexOf(dto.step as (typeof ONBOARDING_STEPS)[number]);
      const currentStepIndex = ONBOARDING_STEPS.indexOf(
        updated.state.currentStep as (typeof ONBOARDING_STEPS)[number],
      );
      const nextStep =
        ONBOARDING_STEPS[
          Math.max(currentStepIndex, Math.min(stepIndex + 1, ONBOARDING_STEPS.length - 1))
        ] ?? "launch";
      const state = await tx.onboardingState.update({
        where: { tenantId: context.tenantId },
        data: {
          completedSteps,
          currentStep: nextStep,
          completedAt:
            dto.step === "launch"
              ? (updated.state.completedAt ?? new Date())
              : updated.state.completedAt,
        },
      });
      await this.log(tx, context, "onboarding.updated", {
        currentStep: state.currentStep,
        completedStep: dto.step,
      });
      await this.log(tx, context, "onboarding.step_completed", { step: dto.step });
      return {
        state,
        eventId: updated.eventId,
        reconciliationEventIds: updated.reconciliationEventIds,
      };
    });
    await this.businessProfile.dispatch(
      {
        eventId: result.eventId,
        reconciliationEventIds: result.reconciliationEventIds,
      },
      context.tenantId,
    );
    return this.mapState(result.state);
  }

  private async ensureState(context: RequestContext, tx: Prisma.TransactionClient = this.prisma) {
    return tx.onboardingState.upsert({
      where: { tenantId: context.tenantId },
      update: {},
      create: {
        tenantId: context.tenantId,
        currentStep: "business",
        completedSteps: [],
        data: {},
      },
    });
  }

  private mapState(state: Awaited<ReturnType<typeof this.ensureState>>): OnboardingState {
    return {
      businessProfileVersion: state.businessProfileVersion,
      businessProfileEtag: this.businessProfile.profileEtag(
        state.tenantId,
        state.businessProfileVersion,
      ),
      businessProfileUpdatedAt: state.businessProfileUpdatedAt.toISOString(),
      currentStep: state.currentStep,
      completedSteps: this.completedSteps(state.completedSteps),
      data:
        typeof state.data === "object" && state.data !== null && !Array.isArray(state.data)
          ? state.data
          : {},
      completedAt: state.completedAt?.toISOString() ?? null,
    };
  }

  private completedSteps(value: Prisma.JsonValue | null): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  }

  private assertStepReady(step: string, value: Prisma.JsonValue | null, completedSteps: string[]) {
    const stepIndex = ONBOARDING_STEPS.indexOf(step as (typeof ONBOARDING_STEPS)[number]);
    const missingPrerequisite = ONBOARDING_STEPS.slice(0, Math.max(stepIndex, 0)).find(
      (candidate) => !completedSteps.includes(candidate),
    );
    if (missingPrerequisite) {
      throw new BadRequestException({
        code: "ONBOARDING_STEP_ORDER_INVALID",
        message: `Complete ${missingPrerequisite} before ${step}.`,
      });
    }

    const data = record(value);
    const companyInfo = record(data.companyInfo);
    const dataReady = (candidate: (typeof ONBOARDING_STEPS)[number]) =>
      candidate === "business"
        ? nonBlank(data.businessType)
        : candidate === "channels"
          ? Array.isArray(data.selectedChannels) && data.selectedChannels.length > 0
          : candidate === "scenario"
            ? nonBlank(data.scenario)
            : candidate === "company"
              ? nonBlank(companyInfo.name) &&
                nonBlank(companyInfo.description) &&
                nonBlank(data.timezone)
              : candidate === "crm"
                ? nonBlank(data.crm)
                : true;
    const valid =
      step === "launch"
        ? ONBOARDING_STEPS.slice(0, -1).every(
            (candidate) => completedSteps.includes(candidate) && dataReady(candidate),
          )
        : dataReady(step as (typeof ONBOARDING_STEPS)[number]);
    if (!valid) {
      throw new BadRequestException({
        code: "ONBOARDING_STEP_INCOMPLETE",
        message: `Complete the required ${step} information before continuing.`,
      });
    }
  }

  private async log(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    action: string,
    payload: Prisma.JsonObject,
  ) {
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action,
        entityType: "onboarding",
        entityId: context.tenantId,
        payload,
      },
    });
  }
}
