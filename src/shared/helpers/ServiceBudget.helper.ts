export function validateIsBudget(value: unknown): void {
    if (value !== undefined && typeof value !== "boolean") {
        throw new Error("isBudget phải là Boolean (true hoặc false)");
    }
}

export function resolveServiceBudget(
    service: { isBudget?: boolean; name?: string } | null | undefined,
    input: unknown,
    existingBudget: unknown = 0
): number {
    const previous = Number(existingBudget ?? 0);
    const budget = Number(input ?? previous);

    if (service?.isBudget !== true) {
        if (budget !== previous) {
            throw new Error("Dịch vụ không cho phép thay đổi ngân sách");
        }
        return previous;
    }

    return budget;
}
