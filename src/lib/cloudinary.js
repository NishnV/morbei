/**
 * Direct browser uploads for return photos and videos.
 *
 * The file goes from the shopper's device to Cloudinary and never through our
 * server. That is the point: a short clip of a damaged garment can be tens of
 * megabytes, which is not something to push through a Railway dyno or hold in
 * Postgres, and the upload keeps working while our API is busy.
 *
 * Unsigned, using a preset that Cloudinary restricts. The preset name is
 * public by necessity — anything the browser sends can be read — so the
 * limits that matter (file size, formats, folder) are set on the preset in
 * the Cloudinary console, not here.
 */
const CLOUD = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

export const uploadsConfigured = Boolean(CLOUD && PRESET);

export const MAX_FILES = 6;
export const MAX_BYTES = 25 * 1024 * 1024;

/**
 * @returns {Promise<string>} the delivered URL, which is what the return
 *          request stores. The server accepts only URLs on this cloud.
 */
export async function uploadFile(file) {
    if (!uploadsConfigured) throw new Error('Uploads are not configured.');
    if (file.size > MAX_BYTES) {
        throw new Error(`${file.name} is larger than 25MB.`);
    }

    const body = new FormData();
    body.append('file', file);
    body.append('upload_preset', PRESET);

    // `auto` so one endpoint takes both photographs and video.
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/auto/upload`, {
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
