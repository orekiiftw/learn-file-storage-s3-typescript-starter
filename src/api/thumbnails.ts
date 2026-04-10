import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { join } from "node:path"
import { randomBytes } from "node:crypto";






export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const formData = await req.formData();
  const file = formData.get("thumbnail");
  if (!(file instanceof File)) {
    throw new BadRequestError("Thumbnail file missing");
  }
  
  const MAX_UPLOAD_SIZE = 10 << 20
  
  if (file.size > MAX_UPLOAD_SIZE){
    throw new BadRequestError("Reduce thumbnail size")
  }
  
  const mediaType = file.type
  const imageData = await file.arrayBuffer()
  const randomName = randomBytes(32).toString("base64url")
  const thumbnailUrl = `http://localhost:${cfg.port}/assets/${randomName}.${mediaType.split("/")[1]}`
  const videoMetadata = getVideo(cfg.db, videoId)
  if (videoMetadata?.userID != userID){
    throw new UserForbiddenError("Not Allowed")
  }
  
  const path = join(cfg.assetsRoot, `${randomName}.${mediaType.split("/")[1]}`);
  
  await Bun.write(path, imageData)
  
  videoMetadata.thumbnailURL = thumbnailUrl
  const response = updateVideo(cfg.db, videoMetadata)
  return respondWithJSON(200,videoMetadata)
  
}
