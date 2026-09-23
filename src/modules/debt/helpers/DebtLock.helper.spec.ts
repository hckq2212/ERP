import assert from "node:assert/strict";
import test from "node:test";
import { ContractStatus } from "../../contract/entities/Contract.entity";
import { DebtStatus } from "../entities/Debt.entity";
import {
    isDebtLocked,
    assertDebtNotLocked,
    isContractClosed,
    assertContractNotClosed,
    resolveDebtStatusAfterPayment
} from "./DebtLock.helper";

/** Helper để tạo debt rút gọn cho test (chỉ cần status/name). */
const debt = (status: DebtStatus, name?: string) => ({ status, name }) as any;

test("isDebtLocked: nhan dien dung trang thai LOCKED", () => {
    assert.equal(isDebtLocked(debt(DebtStatus.LOCKED)), true);
    assert.equal(isDebtLocked(debt(DebtStatus.UNPAID)), false);
    assert.equal(isDebtLocked(debt(DebtStatus.PARTIAL)), false);
    assert.equal(isDebtLocked(debt(DebtStatus.PAID)), false);
    assert.equal(isDebtLocked(debt(DebtStatus.OVERDUE)), false);
    assert.equal(isDebtLocked(null), false);
    assert.equal(isDebtLocked(undefined), false);
});

test("assertDebtNotLocked: no LOCKED bi chan voi 409", () => {
    assert.throws(
        () => assertDebtNotLocked(debt(DebtStatus.LOCKED, "Phai thu dot 3")),
        (error: any) => {
            assert.equal(error.statusCode, 409);
            assert.match(error.message, /khóa/);
            assert.match(error.message, /Phai thu dot 3/);
            return true;
        }
    );
});

test("assertDebtNotLocked: cac trang thai khac duoc phep qua", () => {
    for (const status of [DebtStatus.UNPAID, DebtStatus.PARTIAL, DebtStatus.PAID, DebtStatus.OVERDUE]) {
        assert.doesNotThrow(() => assertDebtNotLocked(debt(status)), `${status} phai duoc phep`);
    }
    assert.doesNotThrow(() => assertDebtNotLocked(null));
    assert.doesNotThrow(() => assertDebtNotLocked(undefined));
});

test("isContractClosed: nhan dien dung hop dong da dong", () => {
    assert.equal(isContractClosed({ status: ContractStatus.COMPLETED } as any), true);
    assert.equal(isContractClosed({ status: ContractStatus.CANCELLED } as any), true);
    assert.equal(isContractClosed({ status: ContractStatus.SIGNED } as any), false);
    assert.equal(isContractClosed({ status: ContractStatus.DRAFT } as any), false);
    assert.equal(isContractClosed(null), false);
    assert.equal(isContractClosed(undefined), false);
});

test("assertContractNotClosed: hop dong da ket thuc bi chan voi 409", () => {
    for (const status of [ContractStatus.COMPLETED, ContractStatus.CANCELLED]) {
        assert.throws(
            () => assertContractNotClosed({ status } as any),
            (error: any) => {
                assert.equal(error.statusCode, 409);
                return true;
            }
        );
    }
});

test("assertContractNotClosed: hop dong dang hoat dong duoc phep", () => {
    assert.doesNotThrow(() => assertContractNotClosed({ status: ContractStatus.SIGNED } as any));
    assert.doesNotThrow(() => assertContractNotClosed({ status: ContractStatus.DRAFT } as any));
    assert.doesNotThrow(() => assertContractNotClosed(null));
    assert.doesNotThrow(() => assertContractNotClosed(undefined));
});

// FIX #2 - debt LOCKED KHONG bao gio bi ghi de trang thai
test("FIX #2: LOCKED tra ve null (giu nguyen) trong MOI truong hop thanh toan", () => {
    assert.equal(resolveDebtStatusAfterPayment(DebtStatus.LOCKED, 0, 1000), null);
    assert.equal(resolveDebtStatusAfterPayment(DebtStatus.LOCKED, 300, 1000), null);
    assert.equal(resolveDebtStatusAfterPayment(DebtStatus.LOCKED, 1000, 1000), null);
    assert.equal(resolveDebtStatusAfterPayment(DebtStatus.LOCKED, 2000, 1000), null);
});

test("debt khong khoa: tinh lai trang thai binh thuong", () => {
    assert.equal(resolveDebtStatusAfterPayment(DebtStatus.UNPAID, 0, 1000), DebtStatus.UNPAID);
    assert.equal(resolveDebtStatusAfterPayment(DebtStatus.UNPAID, 300, 1000), DebtStatus.PARTIAL);
    assert.equal(resolveDebtStatusAfterPayment(DebtStatus.UNPAID, 1000, 1000), DebtStatus.PAID);
    assert.equal(resolveDebtStatusAfterPayment(DebtStatus.PARTIAL, 0, 1000), DebtStatus.UNPAID);
    assert.equal(resolveDebtStatusAfterPayment(DebtStatus.OVERDUE, 1000, 1000), DebtStatus.PAID);
});

test("debt amount = 0 thi khong bao gio thanh PAID", () => {
    assert.equal(resolveDebtStatusAfterPayment(DebtStatus.UNPAID, 0, 0), DebtStatus.UNPAID);
    assert.equal(resolveDebtStatusAfterPayment(DebtStatus.UNPAID, 500, 0), DebtStatus.PARTIAL);
});