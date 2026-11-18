import { URL } from "url";
import dns from "dns/promises";
import net from "net";

/**
 * Kiểm tra xem một địa chỉ IPv4 có thuộc dải Private, Loopback, hoặc Cloud Metadata không
 */
function isPrivateOrReservedIPv4(ip: string): boolean {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) {
        return true;
    }

    const [b0, b1] = parts;

    // 0.0.0.0/8 (Mạng hiện tại)
    if (b0 === 0) return true;
    // 127.0.0.0/8 (Loopback)
    if (b0 === 127) return true;
    // 10.0.0.0/8 (Private A)
    if (b0 === 10) return true;
    // 172.16.0.0/12 (Private B: 172.16.0.0 – 172.31.255.255)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
    // 192.168.0.0/16 (Private C)
    if (b0 === 192 && b1 === 168) return true;
    // 169.254.0.0/16 (Link-local / Cloud Metadata như AWS, GCP, Azure, DigitalOcean)
    if (b0 === 169 && b1 === 254) return true;
    // 100.64.0.0/10 (Carrier Grade NAT)
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;
    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (b0 >= 224) return true;

    return false;
}

/**
 * Kiểm tra xem một địa chỉ IPv6 có thuộc dải Private, Loopback không
 */
function isPrivateOrReservedIPv6(ip: string): boolean {
    const normalized = ip.toLowerCase();
    // Loopback
    if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
    // Unspecified
    if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") return true;
    // Unique Local Address (fc00::/7)
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    // Link-local Address (fe80::/10)
    if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
    // IPv4-mapped IPv6 (::ffff:127.0.0.1)
    if (normalized.startsWith("::ffff:")) {
        const v4Part = normalized.slice(7);
        if (net.isIPv4(v4Part)) {
            return isPrivateOrReservedIPv4(v4Part);
        }
    }

    return false;
}

const BLOCKED_HOSTNAMES = new Set([
    "localhost",
    "127.0.0.1",
    "::1",
    "0.0.0.0",
    "169.254.169.254",
    "metadata.google.internal",
    "instance-data"
]);

/**
 * Xác thực URL tải file an toàn, ngăn chặn tấn công SSRF (Server-Side Request Forgery)
 */
export async function validateSafeUrl(rawUrl: string): Promise<URL> {
    if (!rawUrl || typeof rawUrl !== "string") {
        throw new Error("Đường dẫn tải file không được để trống");
    }

    let parsed: URL;
    try {
        parsed = new URL(rawUrl.trim());
    } catch {
        throw new Error("Định dạng URL không hợp lệ");
    }

    // 1. Chỉ chấp nhận HTTP/HTTPS
    if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("Giao thức không an toàn. Chỉ chấp nhận HTTP hoặc HTTPS");
    }

    const hostname = parsed.hostname.toLowerCase();

    // 2. Kiểm tra danh sách hostname cấm
    if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
        throw new Error("Địa chỉ máy chủ nội bộ bị cấm truy cập (SSRF)");
    }

    // 3. Nếu hostname là địa chỉ IP trực tiếp
    if (net.isIPv4(hostname)) {
        if (isPrivateOrReservedIPv4(hostname)) {
            throw new Error("Truy cập dải địa chỉ IP nội bộ bị từ chối (SSRF)");
        }
        return parsed;
    }

    if (net.isIPv6(hostname)) {
        if (isPrivateOrReservedIPv6(hostname)) {
            throw new Error("Truy cập dải địa chỉ IPv6 nội bộ bị từ chối (SSRF)");
        }
        return parsed;
    }

    // 4. Phân giải DNS kiểm tra IP thật để chống DNS Rebinding
    try {
        const resolved = await dns.lookup(hostname, { all: true });
        for (const item of resolved) {
            if (item.family === 4 && isPrivateOrReservedIPv4(item.address)) {
                throw new Error("Tên miền phân giải về địa chỉ IP nội bộ bị cấm (SSRF)");
            }
            if (item.family === 6 && isPrivateOrReservedIPv6(item.address)) {
                throw new Error("Tên miền phân giải về địa chỉ IPv6 nội bộ bị cấm (SSRF)");
            }
        }
    } catch (dnsError: any) {
        if (dnsError.message?.includes("SSRF")) {
            throw dnsError;
        }
        throw new Error(`Không thể phân giải tên miền: ${dnsError.message}`);
    }

    return parsed;
}
