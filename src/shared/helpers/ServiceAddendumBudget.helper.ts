import { Decimal } from "decimal.js";
import { resolveServiceBudget } from "./ServiceBudget.helper";

/** Only ADD_SERVICES uses this validation; existing monthly-work behavior is unchanged. */
export function resolveAddendumBudget(
    service: { isBudget?: boolean } | null | undefined, input: unknown, existingBudget: unknown = 0
): number {
    const value = input ?? existingBudget ?? 0;
    if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") {
        throw new Error("Ngân sách phải là số nguyên đồng không âm hợp lệ");
    }
    let budget: Decimal;
    try { budget = new Decimal(value); } catch {
        throw new Error("Ngân sách phải là số nguyên đồng không âm hợp lệ");
    }
    if (!budget.isFinite() || !budget.isInteger() || budget.lt(0) || budget.gt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("Ngân sách phải là số nguyên đồng không âm hợp lệ");
    }
    return resolveServiceBudget(service, budget.toNumber(), existingBudget);
}

export function calculateServiceAddendumCost(items: { cost?: number; budget?: number; quantity?: number }[]): number {
    return items.reduce((sum, item) => sum.plus(
        new Decimal(item.cost ?? 0).plus(item.budget ?? 0).mul(item.quantity ?? 1)
    ), new Decimal(0)).toNumber();
}
