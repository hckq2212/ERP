import axios from "axios";
import { RedisService } from "../../../shared/services/Redis.Service";

export interface TaxLookupResult {
    name: string;
    address: string;
    status?: string;
    internationalName?: string;
    shortName?: string;
    taxDepartment?: string;
}

const CACHE_TTL_FOUND = 3 * 24 * 60 * 60; // 3 ngày
const CACHE_TTL_NOT_FOUND = 10 * 60;      // 10 phút

export class TaxLookupService {
    private readonly timeoutMs = 5000;

    /**
     * Tra cứu thông tin MST qua VietQR (primary) và XInvoice (fallback),
     * kết hợp cache Redis phân cấp để tối ưu hiệu năng và tránh bị rate limit.
     */
    async lookup(taxId: string): Promise<TaxLookupResult | null> {
        if (!taxId) return null;

        const cleanTaxId = taxId.replace(/[\s-]/g, "");
        if (!/^\d{10}(\d{3})?$/.test(cleanTaxId)) {
            throw new Error("Mã số thuế không đúng định dạng (phải gồm 10 hoặc 13 chữ số)");
        }

        const cacheKey = `tax_lookup:${cleanTaxId}`;

        // 1. Kiểm tra cache Redis
        try {
            const cached = await RedisService.get(cacheKey);
            if (cached) {
                if (cached === "NOT_FOUND") {
                    return null;
                }
                return JSON.parse(cached) as TaxLookupResult;
            }
        } catch (err: any) {
            console.warn(`[TaxLookup] Lỗi đọc cache Redis cho MST ${cleanTaxId}:`, err.message);
        }

        // 2. Thử Provider 1: VietQR
        let result = await this.fetchFromVietQR(cleanTaxId);

        // 3. Fallback Provider 2: XInvoice (nếu VietQR lỗi hoặc không có dữ liệu)
        if (!result) {
            result = await this.fetchFromXInvoice(cleanTaxId);
        }

        // 4. Lưu cache kết quả
        try {
            if (result) {
                await RedisService.set(cacheKey, JSON.stringify(result), CACHE_TTL_FOUND);
            } else {
                await RedisService.set(cacheKey, "NOT_FOUND", CACHE_TTL_NOT_FOUND);
            }
        } catch (err: any) {
            console.warn(`[TaxLookup] Lỗi ghi cache Redis cho MST ${cleanTaxId}:`, err.message);
        }

        return result;
    }

    private async fetchFromVietQR(cleanTaxId: string): Promise<TaxLookupResult | null> {
        try {
            const response = await axios.get(`https://api.vietqr.io/v2/business/${cleanTaxId}`, {
                timeout: this.timeoutMs,
                headers: {
                    "Accept": "application/json",
                    "User-Agent": "Getvini-ERP/1.0"
                }
            });

            const res = response.data;
            if (res && res.code === "00" && res.data && res.data.name) {
                return {
                    name: res.data.name,
                    address: res.data.address || "",
                    status: res.data.status,
                    internationalName: res.data.internationalName || "",
                    shortName: res.data.shortName || "",
                    taxDepartment: res.data.taxDepartment || ""
                };
            }
            return null;
        } catch (error: any) {
            console.warn(`[TaxLookup] VietQR thất bại cho MST ${cleanTaxId}:`, error.message);
            return null;
        }
    }

    private async fetchFromXInvoice(cleanTaxId: string): Promise<TaxLookupResult | null> {
        try {
            const response = await axios.get(`https://api.xinvoice.vn/gdt-api/tax-payer/${cleanTaxId}`, {
                timeout: this.timeoutMs,
                headers: {
                    "Accept": "application/json",
                    "User-Agent": "Getvini-ERP/1.0"
                }
            });

            const res = response.data;
            if (res && res.code === "00" && res.data && res.data.name) {
                return {
                    name: res.data.name,
                    address: res.data.address || "",
                    status: res.data.status,
                    internationalName: res.data.internationalName || "",
                    shortName: res.data.shortName || "",
                    taxDepartment: res.data.taxDepartment || ""
                };
            }
            return null;
        } catch (error: any) {
            console.warn(`[TaxLookup] XInvoice fallback thất bại cho MST ${cleanTaxId}:`, error.message);
            return null;
        }
    }
}
