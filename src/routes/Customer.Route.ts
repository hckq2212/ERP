import { Router } from "express";
import { CustomerController } from "../controllers/Customer.Controller";

const router = Router();
const customerController = new CustomerController();

router.get("/", customerController.getAll);
router.get("/:id", customerController.getOne);
router.post("/", customerController.create);
router.put("/:id", customerController.update);
router.delete("/:id", customerController.delete);

export default router;
