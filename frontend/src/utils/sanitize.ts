import DOMPurify from "dompurify";

const REMOTE_PROTOCOL = /^(https?:)?\/\//i;

export interface SanitizedHtml {
    html: string;
    /** Remote images were stripped; re-run unblocked to restore them. */
    hasBlockedRemoteContent: boolean;
}

/**
 * Sanitize a message body.
 *
 * Links are forced into a new unprivileged tab, and with `blockRemoteContent`
 * (the default) remote image sources are parked on a data attribute so senders
 * cannot fire tracking pixels until the reader opts in.
 */
export const sanitizeEmailHtml = (
    dirty: string | null | undefined,
    { blockRemoteContent = true }: { blockRemoteContent?: boolean } = {}
): SanitizedHtml => {
    if (!dirty) return { html: "", hasBlockedRemoteContent: false };

    let blocked = false;

    const hardenNode = (node: Element) => {
        if (node.tagName === "A") {
            node.setAttribute("target", "_blank");
            node.setAttribute("rel", "noopener noreferrer nofollow");
            return;
        }

        if (node.tagName === "IMG" && blockRemoteContent) {
            const src = node.getAttribute("src") || "";
            if (!REMOTE_PROTOCOL.test(src)) return;

            blocked = true;
            node.setAttribute("data-blocked-src", src);
            node.removeAttribute("src");
            node.removeAttribute("srcset");
        }
    };

    DOMPurify.addHook("afterSanitizeAttributes", hardenNode);

    try {
        const html = DOMPurify.sanitize(dirty, {
            USE_PROFILES: { html: true },
            FORBID_TAGS: ["style", "form", "input", "button", "iframe"],
            FORBID_ATTR: ["formaction", "background", "ping"],
            ADD_ATTR: ["target", "data-blocked-src"],
        });

        return { html, hasBlockedRemoteContent: blocked };
    } finally {
        DOMPurify.removeHook("afterSanitizeAttributes");
    }
};

/** Plain-text fallback rendered when a message has no HTML part. */
export const textToHtml = (text?: string | null) => {
    if (!text) return "";
    const escaped = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    return `<p>${escaped
        .replace(/\n{2,}/g, "</p><p>")
        .replace(/\n/g, "<br>")}</p>`;
};
