export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
export const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024; // 25MB (theo Rule 29 trong MEMORY.md)

export const ALLOWED_EXTENSIONS = new Set([
    // Văn phòng & Tài liệu
    "pdf", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "txt", "log", "md", "json",
    // Tệp nén
    "zip", "rar", "7z", "tar", "gz",
    // Hình ảnh (Lưu ý: Không cho phép .svg vì rủi ro nhúng script XSS)
    "jpg", "jpeg", "png", "webp", "gif",
    // Âm thanh (voice chat)
    "mp3", "wav", "ogg", "m4a",
    // Video
    "mp4", "mov", "webm"
]);

export const BANNED_EXTENSIONS = new Set([
    "exe", "bat", "cmd", "sh", "bin", "msi", "apk", "vbs", "ps1",
    "scr", "jar", "com", "pif", "reg", "dll", "sys", "app", "deb", "rpm",
    "html", "htm", "svg", "js", "mjs", "cjs", "php", "py", "rb", "pl"
]);

/**
 * Trích xuất đuôi mở rộng từ tên tệp (chống kỹ thuật bypass double extension: payload.pdf.exe)
 */
export function extractExtension(filename: string): string {
    if (!filename || typeof filename !== "string") return "";
    const clean = filename.split("?")[0].split("#")[0].trim();
    const parts = clean.split(".");
    if (parts.length <= 1) return "";
    return parts[parts.length - 1].toLowerCase();
}

/**
 * Kiểm tra tên tệp có chứa nhiều đuôi nguy hiểm (ví dụ invoice.pdf.exe) hay không
 */
export function hasDangerousDoubleExtension(filename: string): boolean {
    if (!filename || typeof filename !== "string") return false;
    const clean = filename.split("?")[0].split("#")[0].trim().toLowerCase();
    const parts = clean.split(".");
    if (parts.length > 2) {
        // Kiểm tra xem có bất kỳ phần mở rộng nào ở đuôi thuộc danh sách cấm
        for (let i = 1; i < parts.length; i++) {
            if (BANNED_EXTENSIONS.has(parts[i])) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Kiểm tra tính hợp lệ và an toàn của mảng tệp đính kèm trong phòng chat
 */
export function validateChatAttachments(attachments?: any[]): void {
    if (!attachments) return;
    if (!Array.isArray(attachments)) {
        throw new Error("Dữ liệu tệp đính kèm không đúng định dạng danh sách");
    }

    if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
        throw new Error(`Một tin nhắn chỉ được đính kèm tối đa ${MAX_ATTACHMENTS_PER_MESSAGE} tệp`);
    }

    for (let i = 0; i < attachments.length; i++) {
        const att = attachments[i];
        if (!att || typeof att !== "object") {
            throw new Error(`Tệp đính kèm thứ ${i + 1} không hợp lệ`);
        }

        const fileName = String(att.name || "").trim();
        const fileUrl = String(att.url || "").trim();
        const fileSize = Number(att.size || 0);

        // 1. Kiểm tra URL bắt buộc phải là https:// hợp lệ
        if (!fileUrl) {
            throw new Error(`Tệp đính kèm "${fileName || i + 1}" thiếu đường dẫn tệp (URL)`);
        }

        if (!/^https?:\/\//i.test(fileUrl)) {
            throw new Error(`Đường dẫn tệp "${fileName || fileUrl}" không hợp lệ hoặc chứa scheme nguy hiểm`);
        }

        // 2. Kiểm tra tên tệp chống Path Traversal và ký tự điều khiển
        if (fileName) {
            if (fileName.includes("..") || fileName.includes("/") || fileName.includes("\\") || /[\0\r\n]/.test(fileName)) {
                throw new Error(`Tên tệp "${fileName}" chứa ký tự không hợp lệ`);
            }

            if (hasDangerousDoubleExtension(fileName)) {
                throw new Error(`Tệp "${fileName}" chứa định dạng mở rộng nguy hiểm dạng kép`);
            }

            const ext = extractExtension(fileName);
            if (BANNED_EXTENSIONS.has(ext)) {
                throw new Error(`Định dạng tệp .${ext} bị cấm tuyệt đối vì lý do an toàn thông tin`);
            }

            if (!ALLOWED_EXTENSIONS.has(ext)) {
                throw new Error(`Định dạng tệp .${ext} không nằm trong danh mục được phép tải lên hệ thống Chat`);
            }
        }

        // 3. Kiểm tra dung lượng tệp tối đa 25MB
        if (fileSize > MAX_ATTACHMENT_SIZE_BYTES) {
            const sizeMb = (fileSize / (1024 * 1024)).toFixed(1);
            throw new Error(`Tệp "${fileName || fileUrl}" có dung lượng (${sizeMb}MB) vượt quá giới hạn 25MB cho phép`);
        }
    }
}
