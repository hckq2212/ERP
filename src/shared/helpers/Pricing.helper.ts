import { asFiniteNumber } from "./PricingTax.helper";

/** Biên lợi nhuận gộp mục tiêu, tính theo % trên GIÁ BÁN (không phải markup trên giá vốn). */
export const TARGET_GROSS_MARGIN_PERCENT = 40;

/** Bước làm tròn LÊN theo bội số này (đồng). */
export const RECOMMENDED_PRICE_STEP = 10000;

/**
 * Giá bán đề xuất (chưa VAT) = giá vốn / (1 - biên), làm tròn LÊN bội số RECOMMENDED_PRICE_STEP.
 * - Chỉ là gợi ý; giá thỏa thuận thực tế do Sale nhập.
 * - Đầu vào không hợp lệ, <= 0 hoặc Infinity trả về 0.
 * - Epsilon 1e-9 triệt tiêu sai số dấu phẩy động trong phép chia với quy mô giá vốn thông thường của ERP.
 */
export const calculateRecommendedSellingPrice = (
    costAtSale: unknown,
    marginPercent: number = TARGET_GROSS_MARGIN_PERCENT
): number => {
    const cost = asFiniteNumber(costAtSale);
    if (cost <= 0) return 0;

    // Giới hạn an toàn cho margin trong khoảng [0, 99.99%] tránh chia cho 0
    const validMargin = Number.isFinite(marginPercent) && marginPercent >= 0 && marginPercent < 100
        ? marginPercent
        : TARGET_GROSS_MARGIN_PERCENT;

    const raw = (cost * 100) / (100 - validMargin);

    return Math.ceil(raw / RECOMMENDED_PRICE_STEP - 1e-9) * RECOMMENDED_PRICE_STEP;
};
