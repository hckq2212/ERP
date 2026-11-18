import { Router } from "express";
import { CustomerController } from "../controllers/Customer.Controller";
import { validationMiddleware } from "../../../shared/middlewares/Validation.Middleware";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";
import { CreateCustomerDTO, UpdateCustomerDTO } from "../dto/Customer.dto";

const router = Router();
const customerController = new CustomerController();

const customerManageRoles = roleMiddleware(["ADMIN", "BOD", "BD", "ADMIN_SALE", "ACCOUNTANT"]);

router.get("/", customerController.getAll);
router.get("/tax-lookup/:taxId", customerController.lookupTax);
router.get("/:id", customerController.getOne);
router.post("/", customerManageRoles, validationMiddleware(CreateCustomerDTO), customerController.create);
router.put("/:id", customerManageRoles, validationMiddleware(UpdateCustomerDTO), customerController.update);
router.delete("/:id", roleMiddleware(["ADMIN", "BOD"]), customerController.delete);

export default router;
