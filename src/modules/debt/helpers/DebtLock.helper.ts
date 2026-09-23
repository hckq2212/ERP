import { Debts, DebtStatus } from "../entities/Debt.entity";
import { Contracts, ContractStatus } from "../../contract/entities/Contract.entity";

const LOCKED_MESSAGE =
    "Công nợ đã bị khóa do dự án đã đóng. Không thể thay đổi khoản thu này.";

/** Debt có đang bị khóa không (đã chốt sổ do dự án đóng). */
export const isDebtLocked = (
    debt?: Pick<Debts, "status"> | null
): boolean => debt?.status === DebtStatus.LOCKED;

const buildLockedError = (debtName?: string) => {
    const error: any = new Error(
        debtName ? `${LOCKED_MESSAGE} (Khoản: ${debtName})` : LOCKED_MESSAGE
    );
    error.statusCode = 409;
    return error;
};

/**
 * Chặn mọi thao tác ghi lên công nợ đã khóa.
 *
 * Nghiệp vụ: khách thanh toán TRƯỚC theo từng milestone. Khi dự án bị đóng sớm,
 * các milestone của những đợt phía sau không còn được thu nữa -> `closeProject()`
 * khóa chúng lại. Từ đó khoản nợ là read-only: không ghi thanh toán, không xóa.
 */
export const assertDebtNotLocked = (
    debt?: Pick<Debts, "status" | "name"> | null
): void => {
    if (isDebtLocked(debt)) throw buildLockedError(debt?.name);
};

/**
 * Hợp đồng đã kết thúc chưa (COMPLETED / CANCELLED).
 *
 * Dùng để chặn KÍCH HOẠT công nợ mới.
 *
 * ⚠️ Phải kiểm tra theo trạng thái HỢP ĐỒNG, KHÔNG chỉ theo `debt.status === LOCKED`
 * — vì milestone CHƯA TỪNG được kích hoạt thì chưa có debt nào để mà khóa.
 * Đây chính là lỗ hổng khiến việc khóa công nợ bị vô hiệu âm thầm (FIX #1).
 */
export const isContractClosed = (
    contract?: Pick<Contracts, "status"> | null
): boolean => Boolean(
    contract && [
        ContractStatus.COMPLETED,
        ContractStatus.CANCELLED
    ].includes(contract.status)
);

export const assertContractNotClosed = (
    contract?: Pick<Contracts, "status" | "contractCode"> | null
): void => {
    if (!isContractClosed(contract)) return;

    const label = contract?.contractCode ? ` ${contract.contractCode}` : "";
    const error: any = new Error(
        `Hợp đồng${label} đã kết thúc nên không thể kích hoạt công nợ mới.`
    );
    error.statusCode = 409;
    throw error;
};

/**
 * Trạng thái debt mới sau khi tính lại từ các lượt thanh toán.
 *
 * ⚠️ FIX #2: debt `LOCKED` TUYỆT ĐỐI không được ghi đè.
 * Nghiệp vụ: khách thanh toán TRƯỚC ⇒ dự án đã đóng thì không thể còn nợ chưa thu.
 * Nếu không chặn, mỗi lần có người gọi `updateDebtStatus` (kể cả xoá payment) thì
 * `LOCKED` sẽ bị âm thầm mở khóa về `UNPAID`/`PARTIAL`/`OVERDUE`.
 *
 * @returns Trạng thái mới, hoặc `null` nghĩa là GIỮ NGUYÊN (không đổi gì).
 */
export const resolveDebtStatusAfterPayment = (
    currentStatus: DebtStatus,
    totalPaid: number,
    debtAmount: number
): DebtStatus | null => {
    if (currentStatus === DebtStatus.LOCKED) return null;

    if (debtAmount > 0 && totalPaid >= debtAmount) return DebtStatus.PAID;
    if (totalPaid > 0) return DebtStatus.PARTIAL;
    return DebtStatus.UNPAID;
};