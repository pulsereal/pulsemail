/**
 * Attachments and .eml exports go through axios so the Authorization and
 * X-Mailbox headers are applied; that means we get a Blob rather than a URL the
 * browser can navigate to, and have to synthesise the download ourselves.
 */
export const saveBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    // Revoking synchronously cancels the download in Safari.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** Pull the filename out of a Content-Disposition header, if the server sent one. */
export const filenameFromHeaders = (
    headers: Record<string, unknown> | undefined,
    fallback: string
) => {
    const disposition = String(headers?.["content-disposition"] || "");
    const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    if (!match) return fallback;

    try {
        return decodeURIComponent(match[1]);
    } catch {
        return match[1];
    }
};
