import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const DEFAULT_VAT_RATE = 8;

export type MoneyInput = string | number | Decimal | null | undefined;

export type PricingTotalsDecimal = {
    sellingPrice: Decimal;
    vatRate: Decimal;
    vatAmount: Decimal;
    totalWithVat: Decimal;
};

export type PricingTotals = {
    sellingPrice: number;
    vatRate: number;
    vatAmount: number;
    totalWithVat: number;
};

/**
 * Parse an unknown/string/number value directly into Decimal without passing through native Number().
 * Tuân thủ hành vi tương thích:
 * - undefined: fallback (ví dụ vatRate mặc định 8%, quantity mặc định 1)
 * - null hoặc "": trả về 0 (ví dụ VAT rỗng = 0%, quantity rỗng = 0)
 */
export const toDecimal = (value: unknown, fallback: Decimal.Value = 0): Decimal => {
    if (value === undefined) return new Decimal(fallback);
    if (value === null || value === "") return new Decimal(0);
    if (value instanceof Decimal) return value;
    try {
        const d = new Decimal(value as Decimal.Value);
        return d.isFinite() ? d : new Decimal(fallback);
    } catch {
        return new Decimal(fallback);
    }
};

export const asFiniteNumber = (value: unknown, fallback = 0): number => {
    const d = toDecimal(value, fallback);
    const num = d.toNumber();
    return Number.isFinite(num) ? num : fallback;
};

/** Giá bán được làm tròn duy nhất ở cấp đơn giá, đến 1 đồng theo ROUND_HALF_CEIL (tương thích chính xác với Math.round). */
export const roundUnitSellingPriceDecimal = (value: unknown): Decimal =>
    toDecimal(value).toDecimalPlaces(0, Decimal.ROUND_HALF_CEIL);

export const roundUnitSellingPrice = (value: unknown): number =>
    roundUnitSellingPriceDecimal(value).toNumber();

export const calculatePricingTotalsDecimal = (
    sellingPrice: unknown,
    vatRate: unknown = DEFAULT_VAT_RATE
): PricingTotalsDecimal => {
    const net = toDecimal(sellingPrice);
    const rate = toDecimal(vatRate, DEFAULT_VAT_RATE);
    // Giữ nguyên quy tắc: VAT không làm tròn ở cấp lưu DB
    const vatAmount = net.mul(rate).div(100);
    const totalWithVat = net.plus(vatAmount);

    return {
        sellingPrice: net,
        vatRate: rate,
        vatAmount,
        totalWithVat
    };
};

export const calculatePricingTotals = (
    sellingPrice: unknown,
    vatRate: unknown = DEFAULT_VAT_RATE
): PricingTotals => {
    const dec = calculatePricingTotalsDecimal(sellingPrice, vatRate);
    return {
        sellingPrice: dec.sellingPrice.toNumber(),
        vatRate: dec.vatRate.toNumber(),
        vatAmount: dec.vatAmount.toNumber(),
        totalWithVat: dec.totalWithVat.toNumber()
    };
};

export const calculateLinePricingDecimal = (
    unitSellingPrice: unknown,
    quantity: unknown = 1,
    vatRate: unknown = DEFAULT_VAT_RATE
): PricingTotalsDecimal & { unitSellingPrice: Decimal; quantity: Decimal } => {
    const roundedUnitPrice = roundUnitSellingPriceDecimal(unitSellingPrice);
    const normalizedQuantity = toDecimal(quantity, 1);
    const lineSellingPrice = roundedUnitPrice.mul(normalizedQuantity);
    const totals = calculatePricingTotalsDecimal(lineSellingPrice, vatRate);

    return {
        ...totals,
        unitSellingPrice: roundedUnitPrice,
        quantity: normalizedQuantity
    };
};

export const calculateLinePricing = (
    unitSellingPrice: unknown,
    quantity: unknown = 1,
    vatRate: unknown = DEFAULT_VAT_RATE
): PricingTotals & { unitSellingPrice: number; quantity: number } => {
    const dec = calculateLinePricingDecimal(unitSellingPrice, quantity, vatRate);
    return {
        sellingPrice: dec.sellingPrice.toNumber(),
        vatRate: dec.vatRate.toNumber(),
        vatAmount: dec.vatAmount.toNumber(),
        totalWithVat: dec.totalWithVat.toNumber(),
        unitSellingPrice: dec.unitSellingPrice.toNumber(),
        quantity: dec.quantity.toNumber()
    };
};

export const getContractCollectibleTotalDecimal = (contract: {
    sellingPrice?: unknown;
    vatRate?: unknown;
    totalWithVat?: unknown;
}): Decimal => {
    const storedGross = toDecimal(contract.totalWithVat);
    if (storedGross.gt(0)) return storedGross;
    return calculatePricingTotalsDecimal(contract.sellingPrice, contract.vatRate).totalWithVat;
};

export const getContractCollectibleTotal = (contract: {
    sellingPrice?: unknown;
    vatRate?: unknown;
    totalWithVat?: unknown;
}): number => {
    return getContractCollectibleTotalDecimal(contract).toNumber();
};
