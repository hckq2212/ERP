import { AppDataSource } from "../data-source";
import { Accounts } from "../entity/Account.entity";
import { Companies } from "../entity/Company.entity";
import { CompanyMemberRole, CompanyMembers } from "../entity/CompanyMember.entity";
import { Users } from "../entity/User.entity";
import { encrypt } from "../helpers/helpers";
import { COMPANY_ACCESS_DENIED_MESSAGE } from "../middlewares/Tenant.Middleware";

export class AuthService {
    private accountRepository = AppDataSource.getRepository(Accounts);
    private userRepository = AppDataSource.getRepository(Users);
    private memberRepository = AppDataSource.getRepository(CompanyMembers);

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
        const accessTokenExp = rememberMe ? "30d" : "4h";
        const refreshTokenExp = rememberMe ? "30d" : "1d";

        const accessToken = encrypt.generateAccessToken({ id: account.id, role: account.role }, accessTokenExp);
        const refreshToken = encrypt.generateRefreshToken({ id: account.id, role: account.role }, refreshTokenExp);

        return {
            accessToken,
            refreshToken,
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
