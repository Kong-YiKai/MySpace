import type {
  GenerationJob,
  GenerationRequest,
  PlatformEvent,
} from '@spatial-intelligence/contracts';

export interface CreateGenerationJobInput {
  jobId: string;
  request: GenerationRequest;
  idempotencyKey: string;
  now: string;
}

export interface CreateGenerationJobResult {
  job: GenerationJob;
  created: boolean;
}

export interface GenerationJobRepository {
  create(input: CreateGenerationJobInput): Promise<CreateGenerationJobResult>;
  findById(jobId: string): Promise<GenerationJob | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<GenerationJob | null>;
  apply(event: PlatformEvent): Promise<GenerationJob | null>;
}

export interface EventPublisher {
  publish(event: PlatformEvent): Promise<void>;
  close?(): Promise<void>;
}
