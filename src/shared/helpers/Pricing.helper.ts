export const calculateRecommendedSellingPrice = (costAtSale: number): number => {
    const cost = Number(costAtSale || 0);
    if (cost <= 0) return 0;
    return Math.ceil((cost / 0.6) / 10000) * 10000;
};
