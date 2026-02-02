import * as jwt from "jsonwebtoken";
import { SignOptions } from "jsonwebtoken";
import * as bcrypt from "bcrypt";
import * as dotenv from "dotenv";

dotenv.config();
const { JWT_SECRET = "" } = process.env;
export class encrypt {
    static async encryptPassword(password: string) {
        return bcrypt.hashSync(password, 12);
    }
    static comparePassword(password: string, hashPassword: string) {
        return bcrypt.compareSync(password, hashPassword);
    }

    static generateAccessToken(payload: { id: string; role: string }, expiresIn: SignOptions["expiresIn"] = "2h") {
        return jwt.sign({ id: payload.id, role: payload.role }, JWT_SECRET, { expiresIn });
    }
    static generateRefreshToken(payload: { id: string; role: string }, expiresIn: SignOptions["expiresIn"] = "1d") {
        return jwt.sign({ id: payload.id, role: payload.role }, JWT_SECRET, { expiresIn });
    }
}