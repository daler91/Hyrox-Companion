import { Router } from "express";

import legacyRouter from "../workouts";

// Compatibility composition point for workout route capability modules.
const router = Router();
router.use(legacyRouter);

export default router;
