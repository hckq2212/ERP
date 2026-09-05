import { Router } from "express";
import { ContractAddendumController } from "../controllers/ContractAddendum.Controller";
import multer from "multer";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const router = Router();
const controller = new ContractAddendumController();

router.post("/", controller.create);
router.post("/:id/items", controller.addItems);
router.post("/:id/upload-signed", controller.uploadSigned);
router.post("/:id/scale-down", controller.scaleDown);
router.post("/:id/sale-approve", roleMiddleware(["BD", "ADMIN_SALE"]), controller.saleApprove);
router.post("/:id/sale-reject", roleMiddleware(["BD", "ADMIN_SALE"]), controller.saleReject);
router.post("/:id/bod-approve", roleMiddleware(["BOD", "ADMIN"]), controller.bodApprove);
router.post("/:id/bod-reject", roleMiddleware(["BOD", "ADMIN"]), controller.bodReject);

export default router;
