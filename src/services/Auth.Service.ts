import { AppDataSource } from "../data-source";
import { Accounts } from "../entity/Account.entity";
import { Users } from "../entity/User.entity";
import { encrypt } from "../helpers/helpers";

export class AuthService {
    private accountRepository = AppDataSource.getRepository(Accounts);
    private userRepository = AppDataSource.getRepository(Users);

    async register(data: any) {
        const { username, password, email, fullName, phoneNumber } = data;

        // Check if account already exists
        const existingAccount = await this.accountRepository.findOne({
            where: [{ username }, { email }]
        });

        if (existingAccount) {
            throw new Error("Tên đăng nhập hoặc email đã tồn tại");
        }

        // Hash password
        const hashedPassword = await encrypt.encryptPassword(password);

        // Create Account
        const account = new Accounts();
        account.username = username;
        account.password = hashedPassword;
        account.email = email;

        // Create User
        const user = new Users();
        user.fullName = fullName;
        user.phoneNumber = phoneNumber;

        // Link and Save
        await AppDataSource.transaction(async (transactionalEntityManager) => {
            const savedAccount = await transactionalEntityManager.save(account);
            user.account = savedAccount;
            await transactionalEntityManager.save(user);
        });

        return { message: "Đăng ký thành công" };
    }

    async login(data: any) {
        const { username, password } = data;

        // Find account (by username or email)
        const account = await this.accountRepository.findOne({
            where: [{ username }, { email: username }],
            relations: ["user"]
        });

        if (!account) {
            throw new Error("Tên đăng nhập hoặc mật khẩu không chính xác");
        }

        // Compare password
        const isPasswordValid = encrypt.comparePassword(password, account.password);
        if (!isPasswordValid) {
            throw new Error("Tên đăng nhập hoặc mật khẩu không chính xác");
        }

        // Generate tokens
        const { rememberMe } = data;
        const accessTokenExp = rememberMe ? "30d" : "2h";
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
                role: account.role
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
