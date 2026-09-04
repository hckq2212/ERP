import { Router } from "express";
import { ContractAddendumController } from "../controllers/ContractAddendum.Controller";
import multer from "multer";
import { authMiddleware } from "../middlewares/Auth.Middleware";
import { roleMiddleware } from "../middlewares/Role.Middleware";

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const router = Router();
const controller = new ContractAddendumController();

router.post("/", controller.create);
router.post("/:id/items", controller.addItems);
router.post("/:id/upload-signed", controller.uploadSigned);
router.post("/:id/scale-down", controller.scaleDown);
router.post("/:id/sale-approve", authMiddleware, roleMiddleware(["BD", "ADMIN_SALE"]), controller.saleApprove);
router.post("/:id/sale-reject", authMiddleware, roleMiddleware(["BD", "ADMIN_SALE"]), controller.saleReject);
router.post("/:id/bod-approve", authMiddleware, roleMiddleware(["BOD", "ADMIN"]), controller.bodApprove);
router.post("/:id/bod-reject", authMiddleware, roleMiddleware(["BOD", "ADMIN"]), controller.bodReject);

export default router;
