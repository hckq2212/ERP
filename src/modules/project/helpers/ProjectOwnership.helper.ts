import { Repository } from "typeorm";
import { Contracts } from "../../contract/entities/Contract.entity";

type Actor = { id?: string; userId?: string; role?: string } | undefined | null;

type ContractOwnershipShape = {
    id?: string;
    contractCode?: string;
    name?: string;
    createdById?: string;
    createdBy?: { id?: string } | null;
    opportunity?: { createdById?: string; createdBy?: { id?: string } | null } | null;
    customer?: { createdById?: string; createdBy?: { id?: string } | null } | null;
};

const resolveActorUserId = (actor: Actor): string | undefined => actor?.userId || actor?.id;

const buildOwnershipError = (contract?: ContractOwnershipShape) => {
    const label = contract?.contractCode || contract?.name;
    const error: any = new Error(
        label
            ? `Bạn không phụ trách hợp đồng ${label} nên không thể đóng dự án này`
            : "Bạn không phụ trách hợp đồng của dự án này"
    );
    error.statusCode = 403;
    return error;
};

/**
 * Kiểm tra một hợp đồng có thuộc quyền phụ trách của actor không.
 *
 * Ưu tiên: 1. contract.createdBy -> 2. contract.opportunity.createdBy -> 3. contract.customer.createdBy
 */
export const isContractOwnedByActor = (
    actor: Actor,
    contract?: ContractOwnershipShape | null
): boolean => {
    if (!contract) return false;

    const actorUserId = resolveActorUserId(actor);
    if (!actorUserId) return false;

    const isContractCreator = contract.createdById === actorUserId
        || contract.createdBy?.id === actorUserId;
    const isOpportunityCreator = contract.opportunity?.createdById === actorUserId
        || contract.opportunity?.createdBy?.id === actorUserId;
    const isCustomerCreator = contract.customer?.createdById === actorUserId
        || contract.customer?.createdBy?.id === actorUserId;

    return Boolean(isContractCreator || isOpportunityCreator || isCustomerCreator);
};

/**
 * Guard cho đường **BD ĐÓNG DỰ ÁN TRỰC TIẾP** (`POST /projects/:id/close/direct`).
 *
 * ⚠️ LƯU Ý QUAN TRỌNG VỀ LỊCH SỬ: guard này ban đầu được viết cho đường
 * "BD tạm dừng dự án trực tiếp". Sau khi chốt lại quyền hạn (2026-09-22):
 *   - BD **KHÔNG còn** quyền tạm dừng trực tiếp (phải xin phép như PM)
 *   - BD **ĐƯỢC** quyền đóng dự án trực tiếp
 * Nên guard này nay phục vụ đường ĐÓNG dự án. Bản thân logic không đổi.
 *
 * QUAN TRỌNG: BD KHÔNG nằm trong `PROJECT_MANAGEMENT_ROLES`
 * (`Account.entity.ts:34-38` — chỉ có BOD/ADMIN/PM), nên mọi check quyền hiện có
 * (`isProjectManagementRole`) sẽ CHẶN BD. Vì vậy nhánh BD phải được kiểm tra
 * tường minh bằng helper này, không thể tái dùng `isProjectManagementRole`.
 *
 * Lưu ý: BOD/ADMIN vẫn có toàn quyền — guard này chỉ áp cho vai trò BD,
 * nên caller phải kiểm tra BOD/ADMIN trước khi gọi.
 */
export const assertBdOwnsContract = (
    actor: Actor,
    contract?: ContractOwnershipShape | null
): void => {
    if (!isContractOwnedByActor(actor, contract)) {
        throw buildOwnershipError(contract ?? undefined);
    }
};

/**
 * Biến thể tự nạp hợp đồng theo `projectId`.
 * Dùng khi service chỉ có project id trong tay (ví dụ gọi từ controller).
 */
export const assertBdOwnsProjectContract = async (
    contractRepository: Repository<Contracts> | undefined,
    actor: Actor,
    projectId: string
): Promise<void> => {
    if (!contractRepository) {
        throw new Error("ProjectOwnership.helper: cần truyền contractRepository");
    }

    const contract = await contractRepository.findOne({
        where: { project: { id: projectId } },
        relations: ["createdBy", "opportunity", "opportunity.createdBy", "customer", "customer.createdBy"]
    });

    if (!contract) {
        const error: any = new Error("Không tìm thấy hợp đồng của dự án");
        error.statusCode = 404;
        throw error;
    }

    assertBdOwnsContract(actor, contract);
};
