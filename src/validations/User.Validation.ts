export const nameRegex = /^[a-zA-ZÀ-ỹ0-9\s]+$/;
export const phoneRegex = /^\+?[0-9]{10,15}$/;
export const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validateUserData = (data: any) => {
    // Validate User fields
    if (data.fullName && !nameRegex.test(data.fullName)) throw new Error("Họ tên không được chứa ký tự đặc biệt");
    if (data.phoneNumber && !phoneRegex.test(data.phoneNumber)) throw new Error("Số điện thoại không hợp lệ");
    
    // Validate Account fields
    if (data.email && !emailRegex.test(data.email)) throw new Error("Email không hợp lệ");
};
