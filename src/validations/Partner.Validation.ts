import { PartnerType } from "../entity/Vendor.entity"; // Assuming it's the same enum, or we just compare the string

export const nameRegex = /^[a-zA-ZÀ-ỹ0-9\s]+$/;
export const phoneRegex = /^\+?[0-9]{10,15}$/;
export const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const taxIdRegex = /^\d{10}(\s?-\s?\d{3})?$/; // Ma so thue doanh nghiep
export const idCardRegex = /^(\d{9}|\d{12})$/; // CMND 9 so hoac CCCD 12 so

export const validatePartnerData = (data: any) => {
    if (data.name && !nameRegex.test(data.name)) throw new Error("Tên không được chứa ký tự đặc biệt");
    if (data.phone && !phoneRegex.test(data.phone)) throw new Error("Số điện thoại không hợp lệ");
    if (data.email && !emailRegex.test(data.email)) throw new Error("Email không hợp lệ");

    if (data.taxId) {
        if (data.type === 'INDIVIDUAL') {
            if (!idCardRegex.test(data.taxId)) throw new Error("Chứng minh nhân dân/Căn cước công dân không hợp lệ (Phải là 9 hoặc 12 số)");
        } else {
            // Default to BUSINESS or if type is missing but implied business
            if (!taxIdRegex.test(data.taxId)) throw new Error("Mã số thuế không hợp lệ (Phải là 10 số hoặc 13 số định dạng XXXXXXXXXX-XXX)");
        }
    }
};
