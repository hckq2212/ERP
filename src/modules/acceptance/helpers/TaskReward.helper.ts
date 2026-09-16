export const calculateTaskReward = (
    budgetValue: number,
    subtaskAllocationValues: number[]
) => {
    const budget = Number.isFinite(budgetValue) ? Math.max(0, budgetValue) : 0;
    const allocated = subtaskAllocationValues.reduce((total, value) => (
        Number.isFinite(value) ? total + Math.max(0, value) : total
    ), 0);

    return Math.max(0, budget - allocated);
};

type PercentageAllocation = {
    id: string;
    allocationPercent: number;
};

/**
 * Converts an approved percentage plan to rewards with three-decimal precision.
 * Remaining milli-Vinicoin units are assigned by largest remainder so the
 * settled total always matches the percentage share of the parent pool.
 */
export const calculatePercentageRewards = (
    budgetValue: number,
    allocations: PercentageAllocation[]
) => {
    const budgetUnits = Math.max(0, Math.round(Number(budgetValue || 0) * 1_000));
    const normalized = allocations
        .map(item => ({
            id: item.id,
            basisPoints: Math.max(0, Math.min(10_000, Math.round(Number(item.allocationPercent || 0) * 100)))
        }))
        .sort((left, right) => left.id.localeCompare(right.id));
    const totalBasisPoints = Math.min(
        10_000,
        normalized.reduce((total, item) => total + item.basisPoints, 0)
    );
    const targetUnits = Math.round((budgetUnits * totalBasisPoints) / 10_000);
    const rewards = normalized.map(item => {
        const exactUnits = (budgetUnits * item.basisPoints) / 10_000;
        const units = Math.floor(exactUnits);
        return { ...item, units, remainder: exactUnits - units };
    });
    let remainingUnits = targetUnits - rewards.reduce((total, item) => total + item.units, 0);

    [...rewards]
        .sort((left, right) => right.remainder - left.remainder || left.id.localeCompare(right.id))
        .forEach(item => {
            if (remainingUnits <= 0) return;
            const target = rewards.find(reward => reward.id === item.id);
            if (target) target.units += 1;
            remainingUnits -= 1;
        });

    return new Map(rewards.map(item => [item.id, item.units / 1_000]));
};
