import { respondWithJSON } from "./json";
import { getBearerToken } from "../auth";
import { validateJWT } from "../auth";
import { getVideo, type Video } from "../db/videos";
import { BadRequestError, UserForbiddenError } from "./errors";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { updateVideo } from "../db/videos";
import { rm } from "node:fs/promises";
import { type ApiConfig } from "../config";
import { S3Client, type BunRequest } from "bun";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const MAX_UPLOAD_SIZE = 1 << 30;
  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);
  const uuid = req.params.videoId;
  const videoMetadata = getVideo(cfg.db, uuid) as Video;
  const formData = await req.formData();
  const file = formData.get("video");
  const randomName = randomBytes(32).toString("hex");

  if (!(file instanceof File)) {
    throw new BadRequestError("Video file missing");
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Reduce video size");
  }

  if (file.type != "video/mp4") {
    throw new BadRequestError("change file type");
  }

  if (videoMetadata?.userID != userID) {
    throw new UserForbiddenError("Not Allowed");
  }

  const path = join(cfg.assetsRoot, `${randomName}.${file.type.split("/")[1]}`);

  await Bun.write(path, file);
  const aspectRatio = await getVideoAspectRatio(path);
  const processedOutputFilePath = await processVideoForFastStart(path);
  const s3File = cfg.s3Client.file(`${aspectRatio}/${path.split("/")[1]}`);
  await s3File.write(Bun.file(processedOutputFilePath), { type: file.type });

  await rm(path);
  await rm(processedOutputFilePath);

  const key = `${aspectRatio}/${path.split("/")[1]}`;
  const videoUrl = `https://${cfg.s3CfDistribution}/${key}`;

  videoMetadata.videoURL = videoUrl;
  const response = updateVideo(cfg.db, videoMetadata);


  return respondWithJSON(200, videoMetadata);
}

export async function getVideoAspectRatio(filePath: any) {
  const proc = Bun.spawn(
    `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of json ${filePath}`.split(
      " ",
    ),
  );
  if ((await proc.exited) != 0) {
    throw new BadRequestError("error while ffprobe");
  }
  const stdoutText = await new Response(proc.stdout).text();
  const stderrText = await new Response(proc.stderr).text();

  if (stderrText) {
    throw new BadRequestError("error while ffprobe");
  }
  const data = JSON.parse(stdoutText);
  const height = data.streams[0].height;
  const width = data.streams[0].width;

  const ratio = width / height;
  const epsilon = 0.05;

  if (Math.abs(ratio - 16 / 9) < epsilon) {
    return "landscape";
  } else if (Math.abs(ratio - 9 / 16) < epsilon) {
    return "portrait";
  } else {
    return "other";
  }
}

async function processVideoForFastStart(inputFilePath: any) {
  const outputFilePath = `${inputFilePath}.processed`;
  const proc = Bun.spawn(
    `ffmpeg -i ${inputFilePath} -movflags faststart -map_metadata 0 -codec copy -f mp4 ${outputFilePath}`.split(
      " ",
    ),
  );
  if ((await proc.exited) != 0) {
    throw new BadRequestError("error while ffmpeg");
  }
  const stdoutText = await new Response(proc.stdout).text();

  return outputFilePath;
}


