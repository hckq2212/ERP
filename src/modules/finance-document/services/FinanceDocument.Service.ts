import { AppDataSource } from "../../../data-source";
import { SecurityService } from "../../../shared/services/Security.Service";
import { Contracts } from "../../contract/entities/Contract.entity";
import { Users } from "../../user/entities/User.entity";
import { AcceptanceMinutes } from "../entities/AcceptanceMinute.entity";
import { VatInvoices } from "../entities/VatInvoice.entity";

type DocumentActor = { id: string; role: string; userId?: string };
type CreateDocumentInput = { contractId: string; name: string; fileUrl: string };

export class FinanceDocumentService {
    private contractRepository = AppDataSource.getRepository(Contracts);
    private acceptanceRepository = AppDataSource.getRepository(AcceptanceMinutes);
    private invoiceRepository = AppDataSource.getRepository(VatInvoices);

    async getByContract(contractId: string, actor: DocumentActor) {
        await this.getAccessibleContract(contractId, actor);
        const [acceptanceMinutes, vatInvoices] = await Promise.all([
            this.acceptanceRepository.find({
                where: { contract: { id: contractId } },
                relations: ["createdBy"],
                order: { createdAt: "DESC" }
            }),
            this.invoiceRepository.find({
                where: { contract: { id: contractId } },
                relations: ["createdBy"],
                order: { createdAt: "DESC" }
            })
        ]);
        return { acceptanceMinutes, vatInvoices };
    }

    async createAcceptanceMinute(data: CreateDocumentInput, actor: DocumentActor) {
        const contract = await this.getAccessibleContract(data.contractId, actor);
        this.validate(data);
        return this.acceptanceRepository.save(this.acceptanceRepository.create({
            name: data.name.trim(),
            fileUrl: data.fileUrl.trim(),
            contract,
            createdBy: actor.userId ? ({ id: actor.userId } as Users) : undefined
        }));
    }

    async createVatInvoice(data: CreateDocumentInput, actor: DocumentActor) {
        const contract = await this.getAccessibleContract(data.contractId, actor);
        this.validate(data);
        return this.invoiceRepository.save(this.invoiceRepository.create({
            name: data.name.trim(),
            fileUrl: data.fileUrl.trim(),
            contract,
            createdBy: actor.userId ? ({ id: actor.userId } as Users) : undefined
        }));
    }

    private validate(data: CreateDocumentInput) {
        if (!data.name?.trim() || !data.fileUrl?.trim()) {
            throw new Error("Tên tài liệu và link file là bắt buộc");
        }
        try {
            const url = new URL(data.fileUrl);
            if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
        } catch {
            throw new Error("Link file không hợp lệ");
        }
    }

    private async getAccessibleContract(contractId: string, actor: DocumentActor) {
        const filters: any = SecurityService.getContractFilters(actor);
        const where = (Array.isArray(filters) ? filters : [filters]).map(filter => ({ ...filter, id: contractId }));
        const contract = await this.contractRepository.findOne({ where });
        if (!contract) {
            throw Object.assign(new Error("Không tìm thấy hợp đồng hoặc không có quyền truy cập"), { statusCode: 404 });
        }
        return contract;
    }
}
