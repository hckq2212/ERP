import crypto from 'crypto';

export class ClientSignatureHelper {
    /**
     * SHA-256 hex của raw body. Multipart không ký nội dung.
     */
    static computeBodyHash(raw: Buffer | undefined, contentType = ''): string {
        if (contentType.toLowerCase().startsWith('multipart/form-data')) {
            return 'MULTIPART';
        }
        return crypto.createHash('sha256').update(raw ?? Buffer.alloc(0)).digest('hex');
    }

    /**
     * Tạo chuỗi chuẩn hóa canonical string:
     * METHOD\n/api/path?query\nTIMESTAMP\nNONCE\nBODY_HASH
     */
    static buildCanonicalString(
        method: string,
        pathWithQuery: string,
        timestamp: string,
        nonce: string,
        bodyHash: string
    ): string {
        return [method.toUpperCase(), pathWithQuery, timestamp, nonce, bodyHash].join('\n');
    }

    /**
     * Xác minh chữ ký HMAC-SHA256 (Mobile App)
     * Nhận hex 64 ký tự và so sánh an toàn timingSafeEqual
     */
    static verifyHmac(canonical: string, receivedHex: string, secret: string): boolean {
        if (!secret || !/^[0-9a-f]{64}$/i.test(receivedHex || '')) {
            return false;
        }
        try {
            const expected = crypto.createHmac('sha256', secret).update(canonical).digest();
            const receivedBuf = Buffer.from(receivedHex, 'hex');
            if (receivedBuf.length !== expected.length) {
                return false;
            }
            return crypto.timingSafeEqual(receivedBuf, expected);
        } catch {
            return false;
        }
    }

    /**
     * Xác minh chữ ký số RSA-SHA256 (Server-to-Server)
     */
    static verifyRsa(canonical: string, signatureBase64: string, publicKeyPem: string): boolean {
        if (!signatureBase64 || !publicKeyPem) {
            return false;
        }
        try {
            const verifier = crypto.createVerify('SHA256');
            verifier.update(canonical);
            verifier.end();
            return verifier.verify(publicKeyPem, signatureBase64, 'base64');
        } catch {
            return false;
        }
    }
}
