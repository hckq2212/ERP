import { AppDataSource } from "../data-source";
import { Accounts } from "../entity/Account.entity";
import { Companies } from "../entity/Company.entity";
import { CompanyMemberRole, CompanyMembers } from "../entity/CompanyMember.entity";
import { Users } from "../entity/User.entity";
import { encrypt } from "../helpers/helpers";
import { COMPANY_ACCESS_DENIED_MESSAGE } from "../middlewares/Tenant.Middleware";
import { RefreshSessions } from "../entity/RefreshSession.entity";
import { ulid } from "ulid";

export const SESSION_EXPIRED_CODE = "SESSION_EXPIRED";
const ACCESS_TOKEN_TTL_SECONDS = 30 * 60;
const DEFAULT_REFRESH_TTL_SECONDS = 24 * 60 * 60;
const REMEMBER_REFRESH_TTL_SECONDS = 30 * DEFAULT_REFRESH_TTL_SECONDS;

export class AuthService {
    private accountRepository = AppDataSource.getRepository(Accounts);
    private userRepository = AppDataSource.getRepository(Users);
    private memberRepository = AppDataSource.getRepository(CompanyMembers);
    private refreshSessionRepository = AppDataSource.getRepository(RefreshSessions);

    async register(data: any, company?: Companies) {
        const { username, password, email, fullName, phoneNumber } = data;

        const existingAccount = await this.accountRepository.findOne({
            where: [{ username }, { email }]
        });

        if (existingAccount) {
            throw new Error("Tên đăng nhập hoặc email đã tồn tại");
        }

        const hashedPassword = await encrypt.encryptPassword(password);

        const account = new Accounts();
        account.username = username;
        account.password = hashedPassword;
        account.email = email;

        const user = new Users();
        user.fullName = fullName;
        user.phoneNumber = phoneNumber;

        await AppDataSource.transaction(async (transactionalEntityManager) => {
            const savedAccount = await transactionalEntityManager.save(account);
            user.account = savedAccount;
            const savedUser = await transactionalEntityManager.save(user);

            if (company) {
                const member = transactionalEntityManager.create(CompanyMembers, {
                    company,
                    user: savedUser,
                    role: CompanyMemberRole.MEMBER
                });
                await transactionalEntityManager.save(member);
            }
        });

        return { message: "Đăng ký thành công" };
    }

    async login(data: any, company?: Companies) {
        const { username, password } = data;

        const account = await this.accountRepository.findOne({
            where: [{ username }, { email: username }],
            relations: ["user"]
        });

        if (!account) {
            throw new Error("Tên đăng nhập hoặc mật khẩu không chính xác");
        }

        const isPasswordValid = encrypt.comparePassword(password, account.password);
        if (!isPasswordValid) {
            throw new Error("Tên đăng nhập hoặc mật khẩu không chính xác");
        }

        if (company) {
            if (!account.user?.id) {
                throw new Error(COMPANY_ACCESS_DENIED_MESSAGE);
            }

            const member = await this.memberRepository.findOne({
                where: {
                    company: { id: company.id },
                    user: { id: account.user.id }
                }
            });

            if (!member) {
                throw new Error(COMPANY_ACCESS_DENIED_MESSAGE);
            }
        }

        const { rememberMe } = data;
        const refreshTtlSeconds = rememberMe ? REMEMBER_REFRESH_TTL_SECONDS : DEFAULT_REFRESH_TTL_SECONDS;
        const sessionId = ulid();
        const accessToken = encrypt.generateAccessToken({ id: account.id, role: account.role }, ACCESS_TOKEN_TTL_SECONDS);
        const refreshToken = encrypt.generateRefreshToken(
            { id: account.id, sessionId, companyId: company?.id },
            refreshTtlSeconds
        );

        await this.refreshSessionRepository.save(this.refreshSessionRepository.create({
            id: sessionId,
            account,
            accountId: account.id,
            company,
            companyId: company?.id ?? null,
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
                id: account.user?.id,
                fullName: account.user?.fullName,
                role: account.role,
                company: company ? {
                    id: company.id,
                    name: company.name,
                    slug: company.slug
                } : undefined
            }
        };
    }

    async refresh(rawRefreshToken: string | undefined, company?: Companies) {
        if (!rawRefreshToken) throw new Error(SESSION_EXPIRED_CODE);
        const requestedCompanyId = company?.id ?? null;

        let payload;
        try {
            payload = encrypt.verifyRefreshToken(rawRefreshToken);
        } catch {
            throw new Error(SESSION_EXPIRED_CODE);
        }

        if (payload.type !== "refresh" || !payload.sessionId || (payload.companyId ?? null) !== requestedCompanyId) {
            throw new Error(SESSION_EXPIRED_CODE);
        }

        const result = await AppDataSource.transaction(async (manager) => {
            const sessionRepository = manager.getRepository(RefreshSessions);
            const session = await sessionRepository.findOne({
                where: { id: payload.sessionId },
                relations: ["account", "account.user"],
                lock: { mode: "pessimistic_write" }
            });

            if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) return null;

            if (
                session.accountId !== payload.id ||
                session.companyId !== requestedCompanyId ||
                session.tokenHash !== encrypt.hashToken(rawRefreshToken)
            ) {
                session.revokedAt = new Date();
                await sessionRepository.save(session);
                return null;
            }

            const account = session.account;
            if (!account?.isActive || !account.user?.id) {
                session.revokedAt = new Date();
                await sessionRepository.save(session);
                return null;
            }

            if (company) {
                const member = await manager.getRepository(CompanyMembers).findOne({
                    where: { company: { id: company.id }, user: { id: account.user.id } }
                });
                if (!member) {
                    session.revokedAt = new Date();
                    await sessionRepository.save(session);
                    return null;
                }
            }

            const remainingSeconds = Math.floor((session.expiresAt.getTime() - Date.now()) / 1000);
            if (remainingSeconds <= 0) return null;

            const accessToken = encrypt.generateAccessToken(
                { id: account.id, role: account.role },
                ACCESS_TOKEN_TTL_SECONDS
            );
            const refreshToken = encrypt.generateRefreshToken(
                { id: account.id, sessionId: session.id, companyId: company?.id },
                remainingSeconds
            );
            session.tokenHash = encrypt.hashToken(refreshToken);
            await sessionRepository.save(session);

            return {
                accessToken,
                refreshToken,
                accessMaxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
                refreshMaxAge: remainingSeconds * 1000
            };
        });

        if (!result) throw new Error(SESSION_EXPIRED_CODE);
        return result;
    }

    async logout(rawRefreshToken: string | undefined, company?: Companies) {
        if (!rawRefreshToken) return;

        try {
            const payload = encrypt.verifyRefreshToken(rawRefreshToken, true);
            if (payload.type !== "refresh" || (payload.companyId ?? null) !== (company?.id ?? null) || !payload.sessionId) return;
            const session = await this.refreshSessionRepository.findOneBy({ id: payload.sessionId, accountId: payload.id });
            if (session && session.companyId === (company?.id ?? null)) {
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
            role: account.role,
            username: account.username,
            email: account.email
        };
    }
}
