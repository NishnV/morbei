import { returnsAPI } from './api';

/**
 * Direct browser uploads for return photos and videos.
 *
 * The file still goes from the shopper's device straight to Cloudinary and
 * never through our server. That is the point: a short clip of a damaged
 * garment can be tens of megabytes, which is not something to push through a
 * Railway dyno or hold in Postgres, and the upload keeps working while our
 * API is busy.
 *
 * What changed is permission. This used to post against an *unsigned*
 * preset, which is by definition an open endpoint — the cloud name and the
 * preset name are both readable in the page source, so anyone could upload
 * arbitrary files into the account without ever visiting the shop. The size
 * check below is still here because it gives a shopper a useful message, but
 * it was never a control: the client is the part an abuser replaces.
 *
 * Each upload now asks our server to sign it, and our server only signs for a
 * caller who has already proved an order number and the email on it. Nothing
 * about Cloudinary is baked into this bundle any more — no cloud name, no
 * preset, no key.
 */

export const MAX_FILES = 6;
export const MAX_BYTES = 25 * 1024 * 1024;

/**
 * @param {File} file
 * @param {{orderNumber: string|number, email: string}} proof the same pair
 *        the lookup took, so the server can decide whether to sign at all.
 * @returns {Promise<string>} the delivered URL, which is what the return
 *          request stores. The server accepts only URLs on this cloud.
 */
export async function uploadFile(file, proof) {
    if (file.size > MAX_BYTES) {
        throw new Error(`${file.name} is larger than 25MB.`);
    }

    // One signature per file. They are short-lived by design, so fetching
    // them up front and reusing one across a slow multi-file upload would
    // start failing partway through.
    let signed;
    try {
        signed = await returnsAPI.uploadSignature(proof.orderNumber, proof.email);
    } catch {
        throw new Error('Could not start the upload. Please try again.');
    }

    const body = new FormData();
    body.append('file', file);
    body.append('api_key', signed.apiKey);
    body.append('timestamp', signed.timestamp);
    body.append('signature', signed.signature);
    // Must match what was signed, byte for byte, or Cloudinary rejects it.
    body.append('upload_preset', signed.uploadPreset);
    body.append('folder', signed.folder);

    // `auto` so one endpoint takes both photographs and video.
    const res = await fetch(`https://api.cloudinary.com/v1_1/${signed.cloudName}/auto/upload`, {
        method: 'POST',
        body,
    });
    if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.error?.message || `Could not upload ${file.name}.`);
    }
    const data = await res.json();
    return data.secure_url;
}
