import type { SourceBlock, SourceDocument } from "@prep-forge/schemas";

export type Visibility = "public" | "personal";

/** SourceBlock minus the fields only the pipeline can fill (run/document ids). */
export type BlockDraft = Omit<SourceBlock, "importRunId" | "sourceDocumentId">;

/** A scanned file. status mirrors source_documents. */
export interface ScannedDoc {
  doc: Omit<SourceDocument, "importRunId">;
  /** absolute path on disk (read-only). */
  absPath: string;
  /** path relative to the snapshot root (stored as source_path). */
  relPath: string;
}

/** A parsed candidate domain entity ready for staging. */
export interface Candidate {
  entityType: string;
  naturalKey: string;
  visibility: Visibility;
  /** full domain object incl. id/origin/visibility/provenance — validated at publish. */
  payload: Record<string, unknown>;
  block: BlockDraft;
}

/** An import error / warning / quarantine, before run/document ids are attached. */
export interface Issue {
  severity: "error" | "warning" | "quarantine";
  kind: string;
  message: string;
  sourcePath?: string;
  headingPath?: string[];
  rawBlock?: string;
  sourceBlockId?: string;
}

export interface ParseResult {
  candidates: Candidate[];
  blocks: BlockDraft[];
  issues: Issue[];
}

export const emptyResult = (): ParseResult => ({ candidates: [], blocks: [], issues: [] });

export function mergeResults(...results: ParseResult[]): ParseResult {
  const out = emptyResult();
  for (const r of results) {
    out.candidates.push(...r.candidates);
    out.blocks.push(...r.blocks);
    out.issues.push(...r.issues);
  }
  return out;
}
