import { Router } from "express";
import { QcController } from "../controllers/Qc.Controller";

const router = Router();
const controller = new QcController();

router.get("/product-info/:projectId", controller.productInfo);

export default router;
