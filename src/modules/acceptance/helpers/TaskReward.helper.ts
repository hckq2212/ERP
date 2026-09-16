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

