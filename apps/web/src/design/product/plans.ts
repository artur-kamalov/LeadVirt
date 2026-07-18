import { BILLING_PLAN_CATALOG, type PricingPlanCode } from "@leadvirt/types";

export interface Plan {
  id: "start" | "pro" | "business" | "corporate";
  code: PricingPlanCode;
  name: string;
  priceMonthlyRub: number;
  popular?: boolean;
}

const acquisitionId: Record<PricingPlanCode, Plan["id"]> = {
  START: "start",
  PROFESSIONAL: "pro",
  BUSINESS: "business",
  CORPORATE: "corporate",
};

export const plans: Plan[] = BILLING_PLAN_CATALOG.map((plan) => ({
  id: acquisitionId[plan.code],
  code: plan.code,
  name: plan.name,
  priceMonthlyRub: plan.priceMonthlyRub ?? 0,
  ...(plan.popular ? { popular: true } : {}),
}));
