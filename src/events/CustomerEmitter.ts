import { EventEmitter } from "events";
import { Customers } from "../entity/Customer.entity";

class CustomerEmitter extends EventEmitter {}

export const customerEmitter = new CustomerEmitter();

export const CUSTOMER_EVENTS = {
    CREATED: "customer_created",
    UPDATED: "customer_updated",
    DELETED: "customer_deleted",
};
