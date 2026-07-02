import * as jwt from "jsonwebtoken";
import { SignOptions } from "jsonwebtoken";
import * as bcrypt from "bcrypt";
import * as dotenv from "dotenv";
import { createHash } from "crypto";

dotenv.config();
const ACCESS_TOKEN_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || "";
const REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || "";

export interface RefreshTokenPayload extends jwt.JwtPayload {
    id: string;
    sessionId: string;
    companyId?: string;
    type: "refresh";
}
export class encrypt {
    static async encryptPassword(password: string) {
        return bcrypt.hashSync(password, 12);
    }
    static comparePassword(password: string, hashPassword: string) {
        return bcrypt.compareSync(password, hashPassword);
    }

    static generateAccessToken(payload: { id: string; role: string }, expiresIn: SignOptions["expiresIn"] = "4h") {
        return jwt.sign({ id: payload.id, role: payload.role, type: "access" }, ACCESS_TOKEN_SECRET, { expiresIn });
    }

    static generateRefreshToken(
        payload: { id: string; sessionId: string; companyId?: string },
        expiresIn: SignOptions["expiresIn"] = "1d"
    ) {
        return jwt.sign({ ...payload, type: "refresh" }, REFRESH_TOKEN_SECRET, { expiresIn });
    }

    static verifyRefreshToken(token: string, ignoreExpiration = false): RefreshTokenPayload {
        return jwt.verify(token, REFRESH_TOKEN_SECRET, { ignoreExpiration }) as RefreshTokenPayload;
    }

    static hashToken(token: string) {
        return createHash("sha256").update(token).digest("hex");
    }
}
