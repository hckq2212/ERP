import { Router } from "express";
import { CustomerController } from "../controllers/Customer.Controller";
import { authMiddleware } from "../middlewares/Auth.Middleware";

const router = Router();
const customerController = new CustomerController();

router.get("/", authMiddleware, customerController.getAll);
router.get("/:id", authMiddleware, customerController.getOne);
router.post("/", authMiddleware, customerController.create);
router.put("/:id", authMiddleware, customerController.update);
router.delete("/:id", authMiddleware, customerController.delete);

export default router;
