import { EventEmitter } from "events";
import { Contracts } from "../entity/Contract.entity";

class ContractEmitter extends EventEmitter {}

export const contractEmitter = new ContractEmitter();

export const CONTRACT_EVENTS = {
    CREATED: "contract_created",
    UPDATED: "contract_updated",
    SIGNED: "contract_signed",
    COMPLETED: "contract_completed",
    DELETED: "contract_deleted",
};
