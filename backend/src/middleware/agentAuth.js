const AgentService = require("../services/AgentService");
const User = require("../models/User");
const { clientIp } = require("./auth");

const agents = AgentService.shared();

/** Resolves `Authorization: Bearer pm_agent_...` to an active agent row. */
const authenticateAgent = async (req, res, next) => {
    const [scheme, token] = (req.get("Authorization") || "").split(" ");

    if (scheme !== "Bearer" || !token) {
        return res.status(401).json({ error: "Agent API key required" });
    }

    try {
        const agent = await agents.findByApiKey(token.trim());
        if (!agent) {
            return res
                .status(401)
                .json({ error: "Invalid or revoked agent API key" });
        }

        req.agent = agent;
        next();
    } catch (error) {
        console.error("Agent authentication error:", error);
        res.status(500).json({ error: "Agent authentication failed" });
    }
};

/**
 * Pins the request to `:mailbox` after checking the agent holds `permission`
 * and the mailbox is inside its scope. Scope is checked before existence so
 * an agent cannot probe for mailboxes it was never granted.
 */
const requireAgentMailbox = (permission) => async (req, res, next) => {
    try {
        if (!(req.agent.permissions || []).includes(permission)) {
            return res.status(403).json({
                error: `This agent does not have the "${permission}" permission`,
            });
        }

        const mailbox = String(req.params.mailbox || "")
            .trim()
            .toLowerCase();
        if (!(await agents.covers(req.agent, mailbox))) {
            return res
                .status(403)
                .json({ error: "Mailbox is outside this agent's scope" });
        }

        const target = await User.findByEmail(mailbox);
        if (!target || Number(target.active) !== 1) {
            return res.status(404).json({ error: "Mailbox not found" });
        }

        req.mailbox = mailbox;
        await User.logMailboxAccess(
            `agent:${req.agent.id}`,
            mailbox,
            clientIp(req)
        );

        next();
    } catch (error) {
        console.error("Agent mailbox scope error:", error);
        res.status(500).json({ error: "Failed to resolve mailbox scope" });
    }
};

/**
 * Gate a directory route (domains, mailboxes, aliases, domain admins) on
 * `permission`, and stand in for requireAdmin by setting req.adminInfo to the
 * agent's effective rights so the shared provisioning routes apply unchanged.
 */
const requireAgentDirectory = (permission) => async (req, res, next) => {
    try {
        if (!(req.agent.permissions || []).includes(permission)) {
            return res.status(403).json({
                error: `This agent does not have the "${permission}" permission`,
            });
        }

        req.adminInfo = await agents.effectiveAdminInfo(req.agent);
        if (!req.adminInfo.isAdmin) {
            return res.status(403).json({
                error: "This agent has no domains it is allowed to administer",
            });
        }

        next();
    } catch (error) {
        console.error("Agent directory scope error:", error);
        res.status(500).json({ error: "Failed to resolve agent scope" });
    }
};

/** Creating or deleting whole domains needs an all-mailbox agent. */
const requireAgentGlobalScope = (req, res, next) => {
    if (req.adminInfo?.adminType === "global") return next();
    res.status(403).json({
        error: "Only an agent scoped to all mailboxes, created by a global admin, can add or remove domains",
    });
};

module.exports = {
    authenticateAgent,
    requireAgentMailbox,
    requireAgentDirectory,
    requireAgentGlobalScope,
};
