const express = require("express");
const { authenticateToken, requireAdmin } = require("../middleware/auth");
const AgentService = require("../services/AgentService");
const { EVENTS, PERMISSIONS } = require("../services/AgentService");
const WebhookDispatcher = require("../services/WebhookDispatcher");
const AgentMailWatcher = require("../services/AgentMailWatcher");

// Global admins manage every agent. Domain admins see and manage only agents
// whose whole scope lies inside their domains; anything else is a 404 so the
// existence of other domains' agents is not disclosed.

const router = express.Router();
const admin = [authenticateToken, requireAdmin];

const agents = AgentService.shared();
const dispatcher = WebhookDispatcher.shared();
const watcher = AgentMailWatcher.shared();

const handle = (fn) => async (req, res) => {
    try {
        await fn(req, res);
    } catch (error) {
        const status = error.status || 500;
        if (status >= 500) {
            console.error(`${req.method} ${req.originalUrl} failed:`, error);
        }
        res.status(status).json({
            error: status >= 500 ? "Request failed" : error.message,
        });
    }
};

router.get(
    "/",
    admin,
    handle(async (req, res) => {
        res.json({
            success: true,
            agents: await agents.list(req.adminInfo),
            events: EVENTS,
            permissions: PERMISSIONS,
            watcher: watcher.status(),
            canGrantAll: req.adminInfo.adminType === "global",
        });
    })
);

router.post(
    "/",
    admin,
    handle(async (req, res) => {
        const created = await agents.create(
            req.body,
            req.adminInfo,
            req.user.email
        );
        res.status(201).json({ success: true, ...created });
    })
);

router.get(
    "/:id",
    admin,
    handle(async (req, res) => {
        res.json({
            success: true,
            agent: await agents.get(req.params.id, req.adminInfo),
        });
    })
);

router.put(
    "/:id",
    admin,
    handle(async (req, res) => {
        res.json({
            success: true,
            agent: await agents.update(req.params.id, req.body, req.adminInfo),
        });
    })
);

router.delete(
    "/:id",
    admin,
    handle(async (req, res) => {
        await agents.remove(req.params.id, req.adminInfo);
        res.json({ success: true });
    })
);

router.post(
    "/:id/rotate-key",
    admin,
    handle(async (req, res) => {
        res.json({
            success: true,
            ...(await agents.rotateKey(req.params.id, req.adminInfo)),
        });
    })
);

router.post(
    "/:id/rotate-secret",
    admin,
    handle(async (req, res) => {
        res.json({
            success: true,
            ...(await agents.rotateSecret(req.params.id, req.adminInfo)),
        });
    })
);

router.post(
    "/:id/test",
    admin,
    handle(async (req, res) => {
        const row = await agents.managedRow(req.params.id, req.adminInfo);
        res.json({ success: true, result: await dispatcher.ping(row) });
    })
);

router.get(
    "/:id/deliveries",
    admin,
    handle(async (req, res) => {
        res.json({
            success: true,
            deliveries: await agents.deliveries(req.params.id, req.adminInfo, {
                limit: req.query.limit,
                status: req.query.status,
            }),
        });
    })
);

router.post(
    "/:id/deliveries/:deliveryId/redeliver",
    admin,
    handle(async (req, res) => {
        await agents.redeliver(
            req.params.id,
            req.params.deliveryId,
            req.adminInfo
        );
        res.json({ success: true });
    })
);

module.exports = router;
