export const DEFAULT_VAT_RATE = 8;

export type PricingTotals = {
    sellingPrice: number;
    vatRate: number;
    vatAmount: number;
    totalWithVat: number;
};

const asFiniteNumber = (value: unknown, fallback = 0): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

/** Giá bán được làm tròn duy nhất ở cấp đơn giá, đến 1 đồng. */
export const roundUnitSellingPrice = (value: unknown): number =>
    Math.round(asFiniteNumber(value));

export const calculatePricingTotals = (
    sellingPrice: unknown,
    vatRate: unknown = DEFAULT_VAT_RATE
): PricingTotals => {
    const net = asFiniteNumber(sellingPrice);
    const rate = asFiniteNumber(vatRate, DEFAULT_VAT_RATE);
    const vatAmount = net * rate / 100;

    return {
        sellingPrice: net,
        vatRate: rate,
        vatAmount,
        totalWithVat: net + vatAmount
    };
};

export const calculateLinePricing = (
    unitSellingPrice: unknown,
    quantity: unknown = 1,
    vatRate: unknown = DEFAULT_VAT_RATE
): PricingTotals & { unitSellingPrice: number; quantity: number } => {
    const roundedUnitPrice = roundUnitSellingPrice(unitSellingPrice);
    const normalizedQuantity = asFiniteNumber(quantity, 1);
    const totals = calculatePricingTotals(roundedUnitPrice * normalizedQuantity, vatRate);

    return {
        ...totals,
        unitSellingPrice: roundedUnitPrice,
        quantity: normalizedQuantity
    };
};

export const getContractCollectibleTotal = (contract: {
    sellingPrice?: unknown;
    vatRate?: unknown;
    totalWithVat?: unknown;
}): number => {
    const storedGross = asFiniteNumber(contract.totalWithVat);
    if (storedGross > 0) return storedGross;
    return calculatePricingTotals(contract.sellingPrice, contract.vatRate).totalWithVat;
};
