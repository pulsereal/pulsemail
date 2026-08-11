const express = require("express");
const {
    authenticateToken,
    requireGlobalAdmin,
} = require("../middleware/auth");
const LLMSettingsService = require("../services/LLMSettingsService");
const ClassificationWorker = require("../services/ClassificationWorker");
const { ImportanceService } = require("../services/ImportanceService");

const router = express.Router();

// Only a global admin configures the LLM endpoint: the key is billable and the
// setting is server-wide, so a per-domain admin has no business changing it.
const globalAdmin = [authenticateToken, requireGlobalAdmin];

const settings = LLMSettingsService.shared();
const worker = ClassificationWorker.shared();
const importance = ImportanceService.shared();

router.get("/settings", globalAdmin, async (req, res) => {
    try {
        res.json({
            success: true,
            settings: await settings.redacted(),
            worker: worker.status(),
        });
    } catch (error) {
        console.error("Read LLM settings error:", error);
        res.status(500).json({ error: "Failed to read AI settings" });
    }
});

router.put("/settings", globalAdmin, async (req, res) => {
    try {
        const saved = await settings.save(req.body, req.user.email);

        // Reflect the switch immediately rather than at the next interval.
        if (saved.enabled && saved.classify_enabled) worker.start();
        else worker.stop();

        res.json({ success: true, settings: saved, worker: worker.status() });
    } catch (error) {
        if (error.status === 400) {
            return res.status(400).json({ error: error.message });
        }
        console.error("Save LLM settings error:", error);
        res.status(500).json({ error: "Failed to save AI settings" });
    }
});

/**
 * Sends one trivial completion. Accepts an optional draft configuration in the
 * body so the administrator can verify a change before committing it.
 */
router.post("/settings/test", globalAdmin, async (req, res) => {
    try {
        res.json({ success: true, result: await settings.test(req.body) });
    } catch (error) {
        console.error("LLM connection test error:", error);
        res.status(500).json({ error: "Failed to reach the LLM endpoint" });
    }
});

router.get("/usage", globalAdmin, async (req, res) => {
    try {
        const days = Math.min(90, Math.max(1, Number(req.query.days) || 14));

        res.json({
            success: true,
            usage: await settings.usageSummary(days),
            today: await settings.messagesToday("classification"),
            classifications: await importance.stats(),
        });
    } catch (error) {
        console.error("LLM usage error:", error);
        res.status(500).json({ error: "Failed to read AI usage" });
    }
});

/** Runs a classification pass immediately instead of waiting for the timer. */
router.post("/classify/run", globalAdmin, async (req, res) => {
    try {
        const mailboxes = Array.isArray(req.body?.mailboxes)
            ? req.body.mailboxes
            : null;

        res.json({
            success: true,
            result: await worker.runCycle({ mailboxes }),
        });
    } catch (error) {
        console.error("Manual classification run error:", error);
        res.status(500).json({ error: "Classification run failed" });
    }
});

module.exports = router;
