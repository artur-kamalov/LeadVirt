import {
  BILLING_PLAN_CATALOG,
  type PricingPlan,
  type PricingPlanCode,
} from "@leadvirt/types";

const plans = Object.fromEntries(
  BILLING_PLAN_CATALOG.map((plan) => [plan.code, plan]),
) as Record<PricingPlanCode, PricingPlan>;

function clonePlan(plan: PricingPlan): PricingPlan {
  return { ...plan, features: [...plan.features] };
}

export function billingPlanCatalog(): PricingPlan[] {
  return BILLING_PLAN_CATALOG.map(clonePlan);
}

export function billingPlanByCode(code: PricingPlanCode): PricingPlan {
  return clonePlan(plans[code]);
}

export function isPricingPlanCode(value: unknown): value is PricingPlanCode {
  return value === "START" || value === "PROFESSIONAL" || value === "BUSINESS" || value === "CORPORATE";
}
