import { AppDataSource } from "../data-source";
import { ReferralPartners } from "../entity/ReferralPartner.entity";
import { validatePartnerData } from "../validations/Partner.Validation";
import { RedisService } from "./Redis.Service";

export class ReferralPartnerService {
    private referralPartnerRepository = AppDataSource.getRepository(ReferralPartners);

    async getAll() {
        return await RedisService.fetchWithCache('referral-partners:all', 3600, async () => {
            return await this.referralPartnerRepository.find({
                relations: ["customers", "opportunities", "contracts"],
                order: {
                    createdAt: "DESC"
                }
            });
        });
    }

    async getOne(id: string) {
        return await RedisService.fetchWithCache(`referral-partners:detail:${id}`, 3600, async () => {
            const partner = await this.referralPartnerRepository.findOne({
                where: { id },
                relations: ["customers", "opportunities", "contracts"]
            });
            if (!partner) throw new Error("Không tìm thấy đối tác");
            return partner;
        });
    }

    async create(data: any) {
        validatePartnerData(data);
        const partner = this.referralPartnerRepository.create(data);
        const saved = await this.referralPartnerRepository.save(partner);

        // Invalidate list cache
        await RedisService.deleteCache('referral-partners:all*');

        return saved;
    }

    async update(id: string, data: any) {
        validatePartnerData(data);
        const partner = await this.getOne(id);
        Object.assign(partner, data);
        const saved = await this.referralPartnerRepository.save(partner);

        // Invalidate caches
        await RedisService.deleteCache('referral-partners:all*');
        await RedisService.deleteCache(`referral-partners:detail:${id}*`);

        return saved;
    }

    async delete(id: string) {
        const partner = await this.getOne(id);

        // Check if partner has related data
        if (partner.customers?.length > 0 || partner.opportunities?.length > 0 || partner.contracts?.length > 0) {
            throw new Error("Không thể xóa đối tác đã có dữ liệu liên quan (khách hàng, cơ hội hoặc hợp đồng)");
        }

        await this.referralPartnerRepository.remove(partner);

        // Invalidate caches
        await RedisService.deleteCache('referral-partners:all*');
        await RedisService.deleteCache(`referral-partners:detail:${id}*`);

        return { message: "Xóa đối tác thành công" };
    }

    // Get partner statistics
    async getStatistics(id: string) {
        const partner = await this.getOne(id);

        const totalCustomers = partner.customers?.length || 0;
        const totalOpportunities = partner.opportunities?.length || 0;
        const totalContracts = partner.contracts?.length || 0;

        // Calculate total commission (from contracts)
        const totalCommission = partner.contracts?.reduce((sum, contract) => {
            return sum + (Number(contract.partnerCommission) || 0);
        }, 0) || 0;

        // Calculate paid commission
        const paidCommission = partner.contracts?.reduce((sum, contract) => {
            if (contract.partnerCommissionStatus === "PAID") {
                return sum + (Number(contract.partnerCommission) || 0);
            }
            return sum;
        }, 0) || 0;

        // Calculate pending commission
        const pendingCommission = totalCommission - paidCommission;

        return {
            partnerId: id,
            partnerName: partner.name,
            totalCustomers,
            totalOpportunities,
            totalContracts,
            totalCommission,
            paidCommission,
            pendingCommission
        };
    }
}
