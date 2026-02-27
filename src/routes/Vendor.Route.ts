import { Router } from "express";
import { VendorController } from "../controllers/Vendor.Controller";
import multer from "multer";

const router = Router();
const vendorController = new VendorController();

// Multer config
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const uploadIdCards = upload.fields([
    { name: "idCardFront", maxCount: 1 },
    { name: "idCardBack", maxCount: 1 }
]);

router.get("/", vendorController.getAll);
router.get("/by-job/:jobId", vendorController.getByJob);
router.get("/:id", vendorController.getOne);
router.post("/", uploadIdCards, vendorController.create);
router.patch("/:id", uploadIdCards, vendorController.update);
router.delete("/:id", vendorController.delete);

// Vendor Jobs
router.get("/:id/jobs", vendorController.getJobs);
router.post("/:id/jobs/:jobId", vendorController.addJob);
router.patch("/:id/jobs/:jobId", vendorController.addJob);
router.delete("/:id/jobs/:jobId", vendorController.removeJob);

export default router;
