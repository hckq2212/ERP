import { EventEmitter } from "events";
import { Quotations } from "../entity/Quotation.entity";

class QuotationEmitter extends EventEmitter {}

export const quotationEmitter = new QuotationEmitter();

export const QUOTATION_EVENTS = {
    CREATED: "quotation_created",
    UPDATED: "quotation_updated",
    APPROVED: "quotation_approved",
    REJECTED: "quotation_rejected",
    DELETED: "quotation_deleted",
};
