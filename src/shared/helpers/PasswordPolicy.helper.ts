/**
 * Helper kiểm tra độ mạnh của mật khẩu theo chuẩn OWASP ASVS v4.0
 */
export function validatePasswordStrength(password: string): void {
    if (!password || typeof password !== "string") {
        throw new Error("Mật khẩu không được để trống");
    }
    if (password.length < 8) {
        throw new Error("Mật khẩu phải có độ dài tối thiểu từ 8 ký tự trở lên");
    }
    if (password.length > 128) {
        throw new Error("Mật khẩu không được vượt quá 128 ký tự");
    }
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    if (!hasUpper || !hasLower || !hasNumber) {
        throw new Error("Mật khẩu phải chứa ít nhất 1 chữ hoa, 1 chữ thường và 1 chữ số");
    }
}
