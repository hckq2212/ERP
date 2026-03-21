export const nameRegex = /^[a-zA-ZÀ-ỹ0-9\s]+$/;
export const phoneRegex = /^\+?[0-9]{10,15}$/;
export const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Mã số thuế: 10 chữ số hoặc 13 chữ số (N1...N10 - N11N12N13)
export const taxIdRegex = /^\d{10}(\s?-\s?\d{3})?$/;

// Hàm dùng chung cho FE và BE nếu cần, nhưng hiện tại chạy trên Backend
export const validateCustomerData = (data: any) => {
    if (data.name && !nameRegex.test(data.name)) throw new Error("Tên không được chứa ký tự đặc biệt");
    if (data.email && !emailRegex.test(data.email)) throw new Error("Email không hợp lệ");
    if (data.taxId && !taxIdRegex.test(data.taxId)) throw new Error("Mã số thuế không hợp lệ (Phải là 10 số hoặc 13 số định dạng XXXXXXXXXX-XXX)");
    if (data.phone && !phoneRegex.test(data.phone)) throw new Error("Số điện thoại không hợp lệ");
    if (data.idNumber && !nameRegex.test(data.idNumber)) throw new Error("Số CMND/Hộ chiếu không được chứa ký tự đặc biệt");
};

export const validateLeadData = (data: any) => {
    if (data.leadName && !nameRegex.test(data.leadName)) throw new Error("Tên Lead không được chứa ký tự đặc biệt");
    if (data.leadEmail && !emailRegex.test(data.leadEmail)) throw new Error("Email Lead không hợp lệ");
    if (data.leadTaxId && !taxIdRegex.test(data.leadTaxId)) throw new Error("Mã số thuế Lead không hợp lệ (Phải là 10 số hoặc 13 số định dạng XXXXXXXXXX-XXX)");
    if (data.leadPhone && !phoneRegex.test(data.leadPhone)) throw new Error("Số điện thoại Lead không hợp lệ");
};
