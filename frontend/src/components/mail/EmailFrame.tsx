import React, {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from "react";

/**
 * Only images carrying both dimensions are scaled down: the UA derives their
 * aspect ratio from the attributes, whereas a lone `height` is often a retina
 * asset that `height: auto` would blow up to its intrinsic size.
 */
const FRAME_DOCUMENT = `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><style>
html{overflow:hidden;color-scheme:light}
body{margin:0;padding:12px;overflow-x:auto;overflow-y:hidden;background:#fff;color:#111827;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;font-size:14px;overflow-wrap:break-word}
img:not([height]),img[width][height]{max-width:100%;height:auto}
</style></head><body></body></html>`;

interface EmailFrameProps {
    /** Must already be sanitized; the frame only isolates styles. */
    html: string;
    title?: string;
}

/**
 * Message HTML is authored for a bare mail client, so it is kept out of the
 * app stylesheet (and vice versa). Scripts stay disabled; `allow-same-origin`
 * exists only so the parent can write the body and measure its height.
 */
const EmailFrame: React.FC<EmailFrameProps> = ({
    html,
    title = "Message body",
}) => {
    const frameRef = useRef<HTMLIFrameElement>(null);
    const [doc, setDoc] = useState<Document | null>(null);
    const [height, setHeight] = useState(0);

    const measure = useCallback(() => {
        const root = frameRef.current?.contentDocument?.documentElement;
        if (root) setHeight(Math.ceil(root.getBoundingClientRect().height));
    }, []);

    useLayoutEffect(() => {
        if (!doc) return;
        doc.body.innerHTML = html;
        measure();
    }, [doc, html, measure]);

    // Width only: reacting to our own height changes would feed back through
    // any viewport-relative units in the message.
    useEffect(() => {
        const frame = frameRef.current;
        if (!frame) return;

        let width = 0;
        const observer = new ResizeObserver(([entry]) => {
            if (entry.contentRect.width === width) return;
            width = entry.contentRect.width;
            measure();
        });
        observer.observe(frame);
        return () => observer.disconnect();
    }, [measure]);

    return (
        <iframe
            ref={frameRef}
            title={title}
            srcDoc={FRAME_DOCUMENT}
            sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            onLoad={(event) => {
                const loaded = event.currentTarget.contentDocument;
                if (!loaded) return;
                loaded.addEventListener("load", measure, true);
                loaded.addEventListener("error", measure, true);
                setDoc(loaded);
            }}
            style={{ height }}
            className="block w-full rounded-md border-0 bg-white"
        />
    );
};

export default EmailFrame;
