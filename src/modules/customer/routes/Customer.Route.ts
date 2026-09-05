import { Router } from "express";
import { CustomerController } from "../controllers/Customer.Controller";
import { validationMiddleware } from "../../../shared/middlewares/Validation.Middleware";
import { CreateCustomerDTO, UpdateCustomerDTO } from "../dto/Customer.dto";

const router = Router();
const customerController = new CustomerController();

router.get("/", customerController.getAll);
router.get("/:id", customerController.getOne);
router.post("/", validationMiddleware(CreateCustomerDTO), customerController.create);
router.put("/:id", validationMiddleware(UpdateCustomerDTO), customerController.update);
router.delete("/:id", customerController.delete);

export default router;
