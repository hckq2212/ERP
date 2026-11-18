import { AppDataSource } from "../../../data-source";
import { Accounts } from "../../account/entities/Account.entity";
import { Users } from "../../user/entities/User.entity";
import { RefreshSessions } from "../../auth/entities/RefreshSession.entity";
import { encrypt } from "../../../shared/helpers/helpers";
import { validatePasswordStrength } from "../../../shared/helpers/PasswordPolicy.helper";
import { IsNull } from "typeorm";

export class ProfileService {
    private accountRepository = AppDataSource.getRepository(Accounts);
    private userRepository = AppDataSource.getRepository(Users);

    async getProfile(accountId: string) {
        const account = await this.accountRepository.findOne({
            where: { id: accountId },
            relations: ["user"]
        });

        if (!account) throw new Error("Không tìm thấy tài khoản");

        const user = account.user;

        return {
            id: user?.id,
            accountId: account.id,
            fullName: user?.fullName,
            phoneNumber: user?.phoneNumber,
            birthday: user?.birthday,
            avatarUrl: user?.avatarUrl,
            portfolioUrl: user?.portfolioUrl,
            hobbies: user?.hobbies,
            username: account.username,
            email: account.email,
            role: account.role,
            vinicoin: account.vinicoin,
            vinicoinTotal: account.vinicoinTotal,
            vinicoinWithdrawn: account.vinicoinWithdrawn
        };
    }

    async updateProfile(accountId: string, data: any) {
        const account = await this.accountRepository.findOne({
            where: { id: accountId },
            relations: ["user"]
        });

        if (!account) throw new Error("Không tìm thấy tài khoản");

        const { fullName, phoneNumber, birthday, email, password, oldPassword, currentPassword, avatarUrl, portfolioUrl, hobbies } = data;

        // 1. Update Password if provided (Kiểm tra xác thực mật khẩu cũ + chính sách độ phức tạp + thu hồi phiên cũ)
        if (password) {
            const previousPassword = oldPassword || currentPassword;
            if (!previousPassword) {
                throw new Error("Vui lòng nhập mật khẩu hiện tại để xác nhận đổi mật khẩu");
            }
            const isOldValid = encrypt.comparePassword(previousPassword, account.password);
            if (!isOldValid) {
                throw new Error("Mật khẩu hiện tại không chính xác");
            }
            validatePasswordStrength(password);
            account.password = await encrypt.encryptPassword(password);

            // Thu hồi toàn bộ Refresh Sessions cũ để bắt buộc đăng nhập lại
            await AppDataSource.getRepository(RefreshSessions).update(
                { accountId: account.id, revokedAt: IsNull() },
                { revokedAt: new Date() }
            );
        }

        // 2. Tuân thủ Rule 29: Khóa quyền tự đổi email qua Profile, chỉ ADMIN mới có quyền đổi email
        if (email && email !== account.email) {
            throw new Error("Chỉ quản trị viên hệ thống (ADMIN) mới có quyền thay đổi Email tài khoản");
        }

        // 3. Update User fields
        await AppDataSource.transaction(async (transactionalEntityManager) => {
            if (account.user) {
                if (fullName !== undefined) account.user.fullName = fullName;
                if (phoneNumber !== undefined) account.user.phoneNumber = phoneNumber;
                if (birthday !== undefined) account.user.birthday = birthday || null;
                if (avatarUrl !== undefined) account.user.avatarUrl = avatarUrl;
                if (portfolioUrl !== undefined) account.user.portfolioUrl = portfolioUrl || null;
                if (hobbies !== undefined) account.user.hobbies = Array.isArray(hobbies) ? hobbies : null;
                await transactionalEntityManager.save(account.user);
            }
            await transactionalEntityManager.save(account);
        });

        return this.getProfile(accountId);
    }
}
