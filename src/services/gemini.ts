import type {
  GeminiAnalyzeResponse,
  GeminiImageResponse,
  GeminiGenerateRequest,
  GeminiQualityResponse,
  GenerationQualityCheck,
  PlacementSettings,
  SceneAnalysis,
  TrialPlacementPlan,
  UploadedImage
} from "../types";
import { perspectiveLabels } from "../constants";
import { buildAnalysisPrompt, buildCameraVariationPrompt, buildGenerationPrompt, buildQualityPrompt, buildVirtualRoomPrompt } from "./prompt";
import { assertDistinctCameraViews, compressDataUrlToImage, removeGreenScreen } from "./image";
import { resolvePlacementPlan } from "./placement";

let geminiEndpoint = "/api/gemini";

export function setGeminiEndpoint(url: string) {
  geminiEndpoint = cleanEndpoint(url) || "/api/gemini";
}

export async function analyzeScene(
  roomImage: UploadedImage,
  beddingImage: UploadedImage | null,
  roomReferenceImages: UploadedImage[],
  model: string,
  extraContext: string,
  extraPrompt: string[],
  userRequirements = ""
): Promise<SceneAnalysis> {
  const response = await postGemini<GeminiAnalyzeResponse>({
    mode: "analyze",
    model,
    roomImage,
    roomReferenceImages,
    ...(beddingImage ? { beddingImage } : {}),
    systemPrompt: buildAnalysisPrompt(extraContext, extraPrompt, userRequirements)
  });

  return normalizeSceneAnalysis(response.analysis);
}

/** Frontend fallback: even a legacy/local API response must never leak objects into an editable text field. */
export function normalizeSceneAnalysis(value: unknown): SceneAnalysis {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    roomSummary: readableText(source.roomSummary, "已识别卧室空间与地面关系。"),
    beddingSummary: readableText(source.beddingSummary, "已识别床具主体、材质和外观。"),
    beddingIdentity: normalizeBeddingIdentity(source.beddingIdentity, source.beddingSummary),
    lighting: readableText(source.lighting, "已判断主要光线方向。"),
    perspective: readableText(source.perspective, "已判断卧室透视。"),
    placementAdvice: readableText(source.placementAdvice, "建议按空间动线自然摆放。"),
    constraints: readableList(source.constraints, ["保持卧室主体结构不变"]),
    placementPlan: resolvePlacementPlan(normalizePlacementPlan(source.placementPlan, source.placementAdvice))
  };
}

function normalizeBeddingIdentity(value: unknown, fallback: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const summary = readableText(fallback, "目标床具参考图中的产品主体");
  return {
    sizeSense: readableText(source.sizeSense, "以参考图为准"),
    silhouette: readableText(source.silhouette, summary),
    headboard: readableText(source.headboard, "以参考图为准"),
    frame: readableText(source.frame, "以参考图为准"),
    mattress: readableText(source.mattress, "以参考图为准"),
    material: readableText(source.material, "以参考图为准"),
    color: readableText(source.color, "以参考图为准"),
    details: readableList(source.details, ["以参考图可见细节为准"])
  };
}

function normalizePlacementPlan(value: unknown, fallbackAdvice: unknown): TrialPlacementPlan {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const fallback = readableText(fallbackAdvice, "根据卧室空间、床头墙和通行动线自然摆放目标床具。");
  return {
    summary: readableText(source.summary, fallback),
    placement: readableText(source.placement, "由 AI 根据卧室空间、动线和视觉焦点选择合适位置"),
    facing: readableText(source.facing, "根据主要视觉焦点和用户要求确定朝向"),
    scale: readableText(source.scale, "保持与卧室尺度和透视关系协调"),
    preserve: readableList(source.preserve, ["保留未被用户明确要求移除的原有结构、家具与装饰"]),
    remove: readableList(source.remove, ["无明确移除对象"]),
    avoid: readableList(source.avoid, ["不要遮挡门、窗、衣柜、主要通道、采光和床头柜/插座位置"]),
    rationale: readableList(source.rationale, [fallback]),
    candidates: normalizeCandidates(source.candidates),
    selectedCandidateId: readableText(source.selectedCandidateId, "")
  };
}

function normalizeCandidates(value: unknown) {
  const items = Array.isArray(value) ? value : [];
  return items.map((item, index) => {
    const source = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      id: readableText(source.id, `candidate-${index + 1}`),
      label: readableText(source.label, `候选方案 ${index + 1}`),
      placement: readableText(source.placement, "由 AI 根据空间动线选择合适位置"),
      facing: readableText(source.facing, "面向主要视觉焦点"),
      scale: readableText(source.scale, "按卧室透视协调缩放"),
      score: Number.isFinite(Number(source.score)) ? Number(source.score) : 0.5,
      reasons: readableList(source.reasons, ["符合空间视觉关系"]),
      blocksWalkway: source.blocksWalkway === true,
      conflictsWithPreservedItems: source.conflictsWithPreservedItems === true,
      violatesUserRequirements: source.violatesUserRequirements === true
    };
  });
}

function readableText(value: unknown, fallback: string): string {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const text = value.map((item) => readableText(item, "")).filter(Boolean).join("；");
    return text || fallback;
  }
  if (value && typeof value === "object") {
    const text = Object.values(value as Record<string, unknown>).map((item) => readableText(item, "")).filter(Boolean).join("；");
    return text || fallback;
  }
  return fallback;
}

function readableList(value: unknown, fallback: string[]): string[] {
  const items = Array.isArray(value) ? value : value == null ? [] : [value];
  const result = items.map((item) => readableText(item, "")).filter(Boolean);
  return result.length ? result : fallback;
}

export async function generatePlacementImages(
  roomImage: UploadedImage,
  beddingImage: UploadedImage,
  roomReferenceImages: UploadedImage[],
  analysis: SceneAnalysis,
  settings: PlacementSettings,
  extraContext: string,
  extraPrompt: string[]
): Promise<GeminiImageResponse["images"]> {
  const requestedPerspectives = (["wide", "medium", "close"] as const).filter((perspective) => settings.perspectives.includes(perspective));
  const masterSettings: PlacementSettings = { ...settings, perspectives: requestedPerspectives };
  const perspectivePrompts = Object.fromEntries([
    ["wide", buildGenerationPrompt(analysis, masterSettings, "wide", extraContext, extraPrompt)],
    ...requestedPerspectives.filter((perspective) => perspective !== "wide").map((perspective) => [
      perspective,
      buildCameraVariationPrompt(analysis, masterSettings, perspective, extraContext, extraPrompt)
    ])
  ]);

  const response = await postGemini<GeminiImageResponse>({
    mode: "generate",
    model: settings.model,
    roomImage,
    roomReferenceImages,
    beddingImage,
    analysis,
    settings: masterSettings,
    systemPrompt: "请生成一张用于派生多个镜头的远景主图。",
    perspectivePrompts
  });

  const masterImageUrl = response.images.find((image) => image.perspective === "wide")?.imageUrl;
  if (!masterImageUrl) throw new Error("未获得远景主图，无法校验镜头结果");
  const imageByPerspective = new Map(response.images.map((image) => [image.perspective, image.imageUrl]));
  try {
    await assertDistinctCameraViews(
      masterImageUrl,
      requestedPerspectives.filter((perspective) => perspective !== "wide").flatMap((perspective) => {
        const imageUrl = imageByPerspective.get(perspective);
        return imageUrl ? [imageUrl] : [];
      })
    );
  } catch (error) {
    const antiLazyPrompt = "上一轮结果因模型偷懒被系统拒绝：中近景/近景只是远景的裁切、缩放或局部放大，没有真实改变相机机位。请重新生成真实不同机位；禁止返回任何裁切、缩放、局部放大或几乎相同构图。";
    const retryPerspectivePrompts = Object.fromEntries([
      ["wide", `${antiLazyPrompt}\n\n${buildGenerationPrompt(analysis, masterSettings, "wide", extraContext, extraPrompt)}`],
      ...requestedPerspectives.filter((perspective) => perspective !== "wide").map((perspective) => [
        perspective,
        `${antiLazyPrompt}\n\n${buildCameraVariationPrompt(analysis, masterSettings, perspective, extraContext, extraPrompt)}`
      ])
    ]);
    const retryResponse = await postGemini<GeminiImageResponse>({
      mode: "generate",
      model: settings.model,
      roomImage,
      roomReferenceImages,
      beddingImage,
      analysis,
      settings: masterSettings,
      systemPrompt: `${antiLazyPrompt}\n\n请生成一张用于派生多个镜头的远景主图。`,
      perspectivePrompts: retryPerspectivePrompts
    });
    const retryMasterImageUrl = retryResponse.images.find((image) => image.perspective === "wide")?.imageUrl;
    if (!retryMasterImageUrl) throw new Error("未获得远景主图，无法校验镜头结果");
    const retryImageByPerspective = new Map(retryResponse.images.map((image) => [image.perspective, image.imageUrl]));
    await assertDistinctCameraViews(
      retryMasterImageUrl,
      requestedPerspectives.filter((perspective) => perspective !== "wide").flatMap((perspective) => {
        const imageUrl = retryImageByPerspective.get(perspective);
        return imageUrl ? [imageUrl] : [];
      })
    ).catch(() => {
      throw error instanceof Error
        ? error
        : new Error("镜头变化不足，已拦截本次结果。请重新生成，系统不会把裁切或缩放当作不同视角。");
    });
    return requestedPerspectives
      .map((perspective) => ({ perspective, title: perspectiveLabels[perspective], imageUrl: retryImageByPerspective.get(perspective) }))
      .filter((image): image is { perspective: PlacementSettings["perspectives"][number]; title: string; imageUrl: string } => Boolean(image.imageUrl));
  }
  return requestedPerspectives
    .map((perspective) => ({ perspective, title: perspectiveLabels[perspective], imageUrl: imageByPerspective.get(perspective) }))
    .filter((image): image is { perspective: PlacementSettings["perspectives"][number]; title: string; imageUrl: string } => Boolean(image.imageUrl));
}

export async function generateVirtualRoomImages(
  beddingImage: UploadedImage,
  analysis: SceneAnalysis,
  settings: PlacementSettings,
  extraContext: string,
  extraPrompt: string[]
): Promise<GeminiImageResponse["images"]> {
  const requestedPerspectives = (["wide", "medium", "close"] as const).filter((perspective) => settings.perspectives.includes(perspective));
  const masterSettings: PlacementSettings = { ...settings, perspectives: requestedPerspectives };
  const perspectivePrompts = Object.fromEntries(requestedPerspectives.map((perspective) => [
    perspective,
    buildVirtualRoomPrompt(analysis, masterSettings, perspective, extraContext, extraPrompt)
  ]));

  const response = await postGemini<GeminiImageResponse>({
    mode: "generate",
    model: settings.model,
    beddingImage,
    analysis,
    settings: masterSettings,
    systemPrompt: "请根据目标床具参考图生成同一虚拟卧室的多视角摆放效果，不要请求卧室原图。",
    perspectivePrompts
  });

  const imageByPerspective = new Map(response.images.map((image) => [image.perspective, image.imageUrl]));
  return requestedPerspectives
    .map((perspective) => ({ perspective, title: perspectiveLabels[perspective], imageUrl: imageByPerspective.get(perspective) }))
    .filter((image): image is { perspective: PlacementSettings["perspectives"][number]; title: string; imageUrl: string } => Boolean(image.imageUrl));
}

export async function extractBeddingForeground(beddingImage: UploadedImage, settings: PlacementSettings): Promise<UploadedImage> {
  const response = await postGemini<GeminiImageResponse>({
    mode: "cutout", model: settings.model, beddingImage,
    settings: { ...settings, perspectives: ["wide"] },
    systemPrompt: "这是床具抠图任务，不是室内设计或摆放任务。只提取输入照片中的同一张完整床具产品，绝对保留其整体比例、床头造型、床架轮廓、床垫厚度、软包/木质/金属材质、颜色、可见纹理、缝线、拉扣、床脚和可见配件。删除人物、地面、墙面、地毯、文字和全部背景。输出画面只能有一张完整床具，置于纯 RGB(0,255,0) 绿色背景；绿色区域必须完全均匀、无阴影、无渐变、无其他物体。",
    perspectivePrompts: { wide: "输出用于后续合成的单张床具前景，不要改变产品设计。" }
  });
  const imageUrl = response.images.find((image) => image.perspective === "wide")?.imageUrl;
  if (!imageUrl) throw new Error("Gemini 未返回床具前景图");
  const dataUrl = await removeGreenScreen(imageUrl);
  return compressDataUrlToImage(dataUrl, `${beddingImage.fileName.replace(/\.[^.]+$/, "")}-foreground.jpg`, 820, 0.64, 300 * 1024);
}

export async function eraseExistingBeds(roomImage: UploadedImage, settings: PlacementSettings): Promise<UploadedImage> {
  const response = await postGemini<GeminiImageResponse>({
    mode: "erase",
    model: settings.model,
    roomImage,
    settings: { ...settings, perspectives: ["wide"] },
    systemPrompt: "这是卧室场景清场任务，不是重新设计卧室。识别并移除输入卧室照片中所有原有床、床垫、床架和明显冲突的床品主体。用周围真实的地面、墙面、窗帘、地毯、床头墙、背景和光影自然补全被遮挡区域，形成可用于床具摆放的干净空场景。必须保留所有非床具的建筑结构、门窗、衣柜、床头柜、插座、灯具、地面、墙面、地毯、窗帘、植物和其他家具；不得改变卧室布局、视角、机位、材质、颜色、光线和任何非床具物体。输出同一机位的单张干净卧室图，画面中不得出现原有床或床垫。",
    perspectivePrompts: { wide: "只输出已移除原有床具的干净卧室场景，不添加任何新家具。" }
  });
  const imageUrl = response.images.find((image) => image.perspective === "wide")?.imageUrl;
  if (!imageUrl) throw new Error("Gemini 未返回干净卧室场景图");
  return compressDataUrlToImage(imageUrl, `${roomImage.fileName.replace(/\.[^.]+$/, "")}-clear.jpg`, 960, 0.66, 420 * 1024);
}

export async function checkGeneratedPlacement(
  roomImage: UploadedImage,
  beddingImage: UploadedImage,
  roomReferenceImages: UploadedImage[],
  resultImageUrl: string,
  analysis: SceneAnalysis,
  settings: PlacementSettings,
  extraContext: string,
  extraPrompt: string[]
): Promise<GenerationQualityCheck> {
  const resultImage = await compressDataUrlToImage(resultImageUrl, "quality-check.jpg", 820, 0.64, 300 * 1024);
  const response = await postGemini<GeminiQualityResponse>({
    mode: "quality",
    model: settings.model,
    roomImage,
    roomReferenceImages,
    beddingImage,
    resultImage,
    analysis,
    settings,
    systemPrompt: buildQualityPrompt(analysis, settings, extraContext, extraPrompt)
  });
  return response.quality;
}

function dataUrlToImage(dataUrl: string): Pick<UploadedImage, "base64" | "mimeType"> {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) {
    throw new Error("生成结果格式异常，暂时无法进行质量检查");
  }
  return { mimeType: match[1] as UploadedImage["mimeType"], base64: match[2] };
}

async function postGemini<T>(payload: GeminiGenerateRequest): Promise<T> {
  const body = JSON.stringify(payload);
  const bodySize = new Blob([body]).size;
  if (bodySize > 3.5 * 1024 * 1024) {
    throw new Error("请求图片体积仍然过大，可能被服务端拒绝。请减少补充角度图片，或上传分辨率更低的卧室/床具图后重试。");
  }
  const response = await fetch(geminiEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    if (response.status === 404 || response.status === 405) {
      throw new Error(`Gemini 接口地址不可用：${geminiEndpoint} 返回 ${response.status}，请确认主站传入的是 Vercel 工具 API 地址`);
    }
    throw new Error(`Gemini 接口返回异常：${response.status}`);
  }

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || "AI 处理失败");
  }
  return data as T;
}

function cleanEndpoint(value?: string): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") {
    return "";
  }
  return trimmed;
}



