import { Router } from "express";
import { CustomerController } from "../controllers/Customer.Controller";
import { authMiddleware } from "../middlewares/Auth.Middleware";
import { validationMiddleware } from "../middlewares/Validation.Middleware";
import { CreateCustomerDTO, UpdateCustomerDTO } from "../dto/Customer.dto";

const router = Router();
const customerController = new CustomerController();

router.get("/", authMiddleware, customerController.getAll);
router.get("/:id", authMiddleware, customerController.getOne);
router.post("/", authMiddleware, validationMiddleware(CreateCustomerDTO), customerController.create);
router.put("/:id", authMiddleware, validationMiddleware(UpdateCustomerDTO), customerController.update);
router.delete("/:id", authMiddleware, customerController.delete);

export default router;
