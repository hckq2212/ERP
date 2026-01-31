import { Router } from "express";
import { ContractAddendumController } from "../controllers/ContractAddendum.Controller";
import multer from "multer";

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const router = Router();
const controller = new ContractAddendumController();

router.post("/", controller.create);
router.post("/:id/items", controller.addItems);
router.post("/:id/upload-signed", upload.single("file"), controller.uploadSigned);
router.post("/:id/scale-down", controller.scaleDown);

export default router;
