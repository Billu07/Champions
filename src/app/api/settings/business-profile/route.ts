import { fail, ok } from "@/lib/http";
import { requestHasAdminSession } from "@/lib/auth";
import {
  getBusinessProfile,
  updateBusinessProfile,
  uploadResumableMedia,
  type BusinessProfileUpdate,
} from "@/lib/whatsapp";

export const runtime = "nodejs";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Meta caps profile photos at ~5MB.

export async function GET(request: Request) {
  if (!(await requestHasAdminSession(request))) {
    return fail("Unauthorized", 401);
  }

  try {
    return ok({ profile: await getBusinessProfile() });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to read profile", 502);
  }
}

export async function POST(request: Request) {
  if (!(await requestHasAdminSession(request))) {
    return fail("Unauthorized", 401);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("Expected multipart form data", 400);
  }

  const update: BusinessProfileUpdate = {};

  // Text fields — only include ones explicitly present so we never blank out
  // a field the form didn't render. Empty string is a valid "clear this".
  for (const key of ["about", "address", "description", "email", "vertical"] as const) {
    const value = form.get(key);
    if (typeof value === "string") {
      update[key] = value.trim();
    }
  }

  const websites = form.get("websites");
  if (typeof websites === "string") {
    update.websites = websites
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  // Optional photo: upload to get a handle, then attach it to the update.
  const photo = form.get("photo");
  if (photo instanceof File && photo.size > 0) {
    if (!ALLOWED_IMAGE_TYPES.includes(photo.type)) {
      return fail("Profile photo must be a JPG or PNG image", 400);
    }
    if (photo.size > MAX_IMAGE_BYTES) {
      return fail("Profile photo must be 5MB or smaller", 400);
    }

    try {
      const handle = await uploadResumableMedia({
        data: photo,
        mimeType: photo.type,
        fileName: photo.name || "profile.jpg",
      });
      update.profile_picture_handle = handle;
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Photo upload failed", 502);
    }
  }

  if (Object.keys(update).length === 0) {
    return fail("Nothing to update", 400);
  }

  try {
    await updateBusinessProfile(update);
    return ok({ profile: await getBusinessProfile() });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to update profile", 502);
  }
}
