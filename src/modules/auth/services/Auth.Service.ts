import { AppDataSource } from "../../../data-source";
import { Accounts } from "../../account/entities/Account.entity";
import { Users } from "../../user/entities/User.entity";
import { encrypt } from "../../../shared/helpers/helpers";
import { validatePasswordStrength } from "../../../shared/helpers/PasswordPolicy.helper";
import { RefreshSessions } from "../entities/RefreshSession.entity";
import { ulid } from "ulid";
import { validateSync } from "class-validator";
import { LoginDto } from "../validations/Login.dto";
import { assertAccountIdentifiersAvailable, identifierMatches } from "../../account/services/AccountIdentifier";

export const SESSION_EXPIRED_CODE = "SESSION_EXPIRED";
const ACCESS_TOKEN_TTL_SECONDS = 2 * 60 * 60;
const DEFAULT_REFRESH_TTL_SECONDS = 24 * 60 * 60;
const REMEMBER_REFRESH_TTL_SECONDS = 30 * DEFAULT_REFRESH_TTL_SECONDS;

export class AuthService {
    private accountRepository = AppDataSource.getRepository(Accounts);
    private userRepository = AppDataSource.getRepository(Users);
    private refreshSessionRepository = AppDataSource.getRepository(RefreshSessions);

    async register(data: any) {
        const { username, password, email, fullName, phoneNumber, birthday } = data;

        validatePasswordStrength(password);
        const hashedPassword = await encrypt.encryptPassword(password);

        const account = new Accounts();
        account.username = username;
        account.password = hashedPassword;
        account.email = email;

        const user = new Users();
        user.fullName = fullName;
        user.phoneNumber = phoneNumber;
        user.birthday = birthday || null;

        await AppDataSource.transaction(async (transactionalEntityManager) => {
            await assertAccountIdentifiersAvailable(transactionalEntityManager, account);
            const savedUser = await transactionalEntityManager.save(user);
            account.user = savedUser;
            account.userId = savedUser.id;
            await transactionalEntityManager.save(account);
        });

        return { message: "Đăng ký thành công" };
    }

    async login(data: Partial<LoginDto> | null | undefined) {
        const credentials = Object.assign(new LoginDto(), {
            username: data?.username,
            password: data?.password,
            rememberMe: data?.rememberMe
        });
        if (validateSync(credentials).length) {
            throw Object.assign(new Error("Thông tin đăng nhập không hợp lệ"), { statusCode: 400 });
        }
        const { username, password, rememberMe } = credentials;

        const matchingAccounts = await this.accountRepository.find({
            where: [
                { username: identifierMatches(username) },
                { email: identifierMatches(username) }
            ],
            relations: ["user"]
        });
        // Preserve an unambiguous exact match for legacy accounts that differ only in case.
        const exactMatches = matchingAccounts.filter(account => account.username === username || account.email === username);
        const candidates = exactMatches.length ? exactMatches : matchingAccounts;
        const account = candidates.length === 1 ? candidates[0] : undefined;

        // Chống timing attack: Nếu tài khoản không tồn tại, vẫn chạy phép so sánh bcrypt giả
        if (!account || !account.isActive) {
            encrypt.comparePassword(password || "", "$2b$12$e8p.n2d1a3f4a5k6e7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y");
            throw new Error("Tên đăng nhập hoặc mật khẩu không chính xác");
        }

        // Kiểm tra xem tài khoản có đang trong thời gian bị tạm khóa hay không (5 lần sai -> khóa 15 phút)
        if (account.lockedUntil && new Date(account.lockedUntil) > new Date()) {
            const remainingSeconds = Math.ceil((new Date(account.lockedUntil).getTime() - Date.now()) / 1000);
            const remainingMinutes = Math.ceil(remainingSeconds / 60);
            const err: any = new Error(`Tài khoản tạm thời bị khóa do nhập sai nhiều lần. Vui lòng thử lại sau ${remainingMinutes} phút hoặc liên hệ quản trị viên.`);
            err.statusCode = 429;
            err.retryAfter = remainingSeconds;
            throw err;
        }

        const isPasswordValid = encrypt.comparePassword(password, account.password);
        if (!isPasswordValid) {
            // Tăng số lần đăng nhập sai bằng câu lệnh nguyên tử (Atomic Update) chống race-condition
            await this.accountRepository.createQueryBuilder()
                .update(Accounts)
                .set({ failedLoginAttempts: () => '"failedLoginAttempts" + 1' })
                .where("id = :id", { id: account.id })
                .execute();

            const refreshed = await this.accountRepository.findOne({
                where: { id: account.id },
                select: ["id", "failedLoginAttempts"]
            });

            const currentAttempts = refreshed?.failedLoginAttempts ?? (account.failedLoginAttempts + 1);
            if (currentAttempts >= 5) {
                const lockoutTime = new Date(Date.now() + 15 * 60 * 1000); // 15 phút
                await this.accountRepository.update(account.id, {
                    lockedUntil: lockoutTime,
                    failedLoginAttempts: 5
                });
            }

            throw new Error("Tên đăng nhập hoặc mật khẩu không chính xác");
        }

        // Đăng nhập thành công: Reset lại bộ đếm failedLoginAttempts và gỡ lockedUntil nếu có
        if (account.failedLoginAttempts > 0 || account.lockedUntil) {
            await this.accountRepository.update(account.id, {
                failedLoginAttempts: 0,
                lockedUntil: null
            });
        }

        const user = account.user;

        const refreshTtlSeconds = rememberMe ? REMEMBER_REFRESH_TTL_SECONDS : DEFAULT_REFRESH_TTL_SECONDS;
        const sessionId = ulid();
        const accessToken = encrypt.generateAccessToken({
            id: account.id,
            role: account.role
        }, ACCESS_TOKEN_TTL_SECONDS);
        const refreshToken = encrypt.generateRefreshToken(
            { id: account.id, sessionId },
            refreshTtlSeconds
        );

        await this.refreshSessionRepository.save(this.refreshSessionRepository.create({
            id: sessionId,
            account,
            accountId: account.id,
            tokenHash: encrypt.hashToken(refreshToken),
            expiresAt: new Date(Date.now() + refreshTtlSeconds * 1000)
        }));

        return {
            accessToken,
            refreshToken,
            accessMaxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
            refreshMaxAge: refreshTtlSeconds * 1000,
            rememberMe,
            user: {
                id: user?.id,
                fullName: user?.fullName,
                role: account.role
            }
        };
    }

    async refresh(rawRefreshToken: string | undefined) {
        if (!rawRefreshToken) throw new Error(SESSION_EXPIRED_CODE);

        let payload;
        try {
            payload = encrypt.verifyRefreshToken(rawRefreshToken);
        } catch {
            throw new Error(SESSION_EXPIRED_CODE);
        }

        if (payload.type !== "refresh" || !payload.sessionId) {
            throw new Error(SESSION_EXPIRED_CODE);
        }

        const result = await AppDataSource.transaction(async (manager) => {
            const sessionRepository = manager.getRepository(RefreshSessions);
            const lockedSession = await sessionRepository.createQueryBuilder("session")
                .where("session.id = :sessionId", { sessionId: payload.sessionId })
                .setLock("pessimistic_write")
                .getOne();

            if (!lockedSession) return null;

            const session = await sessionRepository.findOne({
                where: { id: lockedSession.id },
                relations: ["account", "account.user"]
            });

            if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) return null;

            if (
                session.accountId !== payload.id ||
                session.tokenHash !== encrypt.hashToken(rawRefreshToken)
            ) {
                session.revokedAt = new Date();
                await sessionRepository.save(session);
                return null;
            }

            const account = session.account;
            const user = account?.user;
            if (!account?.isActive || !user?.id) {
                session.revokedAt = new Date();
                await sessionRepository.save(session);
                return null;
            }

            const remainingSeconds = Math.floor((session.expiresAt.getTime() - Date.now()) / 1000);
            if (remainingSeconds <= 0) return null;

            const accessToken = encrypt.generateAccessToken(
                { id: account.id, role: account.role },
                ACCESS_TOKEN_TTL_SECONDS
            );
            const refreshToken = encrypt.generateRefreshToken(
                { id: account.id, sessionId: session.id },
                remainingSeconds
            );
            session.tokenHash = encrypt.hashToken(refreshToken);
            await sessionRepository.save(session);

            return {
                accessToken,
                refreshToken,
                accessMaxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
                refreshMaxAge: remainingSeconds * 1000,
                userId: user.id
            };
        });

        if (!result) throw new Error(SESSION_EXPIRED_CODE);
        return result;
    }

    async logout(rawRefreshToken: string | undefined) {
        if (!rawRefreshToken) return;

        try {
            const payload = encrypt.verifyRefreshToken(rawRefreshToken, true);
            if (payload.type !== "refresh" || !payload.sessionId) return;
            const session = await this.refreshSessionRepository.findOneBy({ id: payload.sessionId, accountId: payload.id });
            if (session) {
                session.revokedAt = new Date();
                await this.refreshSessionRepository.save(session);
            }
        } catch {
            // Invalid cookies are still cleared by the controller.
        }
    }

    async getMe(accountId: string) {
        const account = await this.accountRepository.findOne({
            where: { id: accountId },
            relations: ["user"]
        });

        if (!account) {
            throw new Error("Không tìm thấy tài khoản");
        }

        return {
            id: account.user?.id,
            fullName: account.user?.fullName,
            phoneNumber: account.user?.phoneNumber,
            birthday: account.user?.birthday,
            role: account.role,
            username: account.username,
            email: account.email
        };
    }
}
