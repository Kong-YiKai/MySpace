import { z } from 'zod';

export const sourceAssetSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['text', 'image', 'video']),
  uri: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  mimeType: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).superRefine((source, context) => {
  if (!source.uri && !source.content) {
    context.addIssue({ code: 'custom', message: 'Source requires uri or content' });
  }
  if (source.type !== 'text' && !source.uri) {
    context.addIssue({ code: 'custom', message: `${source.type} source requires uri` });
  }
});

export const generationRequestSchema = z.object({
  requestId: z.string().min(1),
  sources: z.array(sourceAssetSchema).min(1),
  prompt: z.string().optional(),
  providerId: z.string().min(1).optional(),
  quality: z.enum(['draft', 'standard', 'high']).default('standard'),
  requirements: z.record(z.string(), z.unknown()).default({}),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

