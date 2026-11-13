import crypto from 'node:crypto';

/**
 * Signing for direct-to-Cloudinary uploads.
 *
 * The browser still sends the file straight to Cloudinary — a clip of a
 * damaged garment can be tens of megabytes and has no business travelling
 * through Railway — but it can no longer do so on its own.
 *
 * It used to upload against an *unsigned* preset, which is by definition an
 * open endpoint: the cloud name and preset name are both readable in the page
 * source, so anyone could POST arbitrary files into the account without ever
 * visiting the shop. The 25MB check in the client stopped nothing, because
 * the client is the part an abuser replaces. The preset's own limits were the
 * only real defence, and limits are not access control.
 *
 * Now each upload needs a signature this server produces, and this server
 * only produces one for a caller who has already proved an order number and
 * the email on it. The API secret never leaves Railway.
 */

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;
const UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET || 'return';
const FOLDER = process.env.CLOUDINARY_FOLDER || 'morbei/returns';

/**
 * All three are needed. With only the cloud name the old unsigned path would
 * still have worked; this is deliberately stricter, so a half-configured
 * deployment turns uploads off rather than quietly falling back to the open
 * endpoint it is meant to replace.
 */
export const uploadsConfigured = Boolean(CLOUD_NAME && API_KEY && API_SECRET);

/**
 * Cloudinary's scheme: sort the parameters by name, join as a query string,
 * append the API secret, and SHA-1 the result. `file`, `api_key`,
 * `resource_type` and `cloud_name` are excluded by their spec.
 *
 * Everything signed here is therefore fixed: a caller cannot move the upload
 * to another folder or swap the preset without invalidating the signature.
 */
export function signUpload() {
    if (!uploadsConfigured) return null;

    const params = {
        folder: FOLDER,
        timestamp: Math.floor(Date.now() / 1000),
        upload_preset: UPLOAD_PRESET,
    };

    const toSign = Object.keys(params)
        .sort()
        .map((k) => `${k}=${params[k]}`)
        .join('&');

    const signature = crypto.createHash('sha1').update(toSign + API_SECRET).digest('hex');

    return {
        cloudName: CLOUD_NAME,
        apiKey: API_KEY,
        uploadPreset: UPLOAD_PRESET,
        folder: FOLDER,
        timestamp: params.timestamp,
        signature,
    };
}
